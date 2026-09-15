import { LO_NEW_LEAD_CLAIM_WINDOW_MS } from "@shared/lo-new-leads";

/** Only IDs are remembered; borrower details never go into browser storage. */
export const LEAD_ALERT_MAX_AGE_MS = 10 * 60_000;
export const LEAD_ALERT_SEEN_LIMIT = 500;
export const LEAD_ALERT_CHIME_INTERVAL_MS = 2_500;
export const LEAD_ALERT_SNOOZE_MS = 10_000;

/** The server's view of the lead's claim window (shared/lo-new-leads.ts). */
export type LoLeadClaim = {
  status: "new" | "claimed" | "escalated" | "escalate_failed";
  escalateAt: string | null;
  claimedBy: string | null;
  shotgunLeadId: number | null;
};

export type LoLeadAlert = {
  key: string;
  externalId: string;
  loId: number;
  loName: string;
  borrowerName: string | null;
  phone: string | null;
  state: string | null;
  source: string | null;
  landedAt: string;
  claim: LoLeadClaim | null;
  /** Somebody else's lead, unclaimed past the head start — up for grabs. */
  openToFloor?: boolean;
};

export type LoLeadFeed = {
  configured: boolean;
  stale: boolean;
  fetchedAt?: string | null;
  los: Array<{
    lo: { id: number; name: string } | null;
    leads: Array<{
      externalId: string;
      borrowerName: string | null;
      phone?: string | null;
      state: string | null;
      source: string | null;
      landedAt: string | null;
      claim?: LoLeadClaim | null;
      openToFloor?: boolean;
    }>;
  }>;
  /**
   * Leads on somebody else's loan officer that nobody claimed inside the
   * assignee's head start. Same shape as `los`; merged with it by
   * feedWithFloor so one lead pipeline handles both.
   */
  floorLos?: LoLeadFeed["los"];
};

/**
 * The feed as the alert card sees it: your own loan officers plus whatever
 * the floor has been offered. Kept here rather than in the component so the
 * merge is testable and both alert functions see the same rows.
 */
export function feedWithFloor(feed: LoLeadFeed): LoLeadFeed {
  if (!feed.floorLos?.length) return feed;
  return { ...feed, los: [...feed.los, ...feed.floorLos] };
}

/** A lead somebody already took, or that went to Shotgun, is no longer this person's to act on. */
export function claimSettled(claim: LoLeadClaim | null | undefined): boolean {
  return !!claim && claim.status !== "new";
}

export function leadAlertDeadline(alert: Pick<LoLeadAlert, "claim" | "landedAt">): number {
  return alert.claim
    ? Date.parse(alert.claim.escalateAt ?? "")
    : Date.parse(alert.landedAt) + LO_NEW_LEAD_CLAIM_WINDOW_MS;
}

export function leadAlertIsActionable(alert: Pick<LoLeadAlert, "claim" | "landedAt">, now: number): boolean {
  return !claimSettled(alert.claim) && Number.isFinite(leadAlertDeadline(alert)) && leadAlertDeadline(alert) > now;
}

export const leadAlertStorageKey = (orgId: number, userId: number) =>
  `c3-lead-alerts:v1:${orgId}:${userId}`;

export function parseSeenLeadAlerts(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-LEAD_ALERT_SEEN_LIMIT) : [];
  } catch { return []; }
}

/** Old history, reconnecting snapshots, and repeated polls are not arrivals. */
export function collectLeadAlerts(feed: LoLeadFeed, previous: string[], now: number) {
  const seen = new Set(previous);
  const alerts: LoLeadAlert[] = [];
  if (!feed.configured || feed.stale) return { seen: previous, alerts };
  for (const row of feed.los) {
    if (!row.lo) continue; // Never infer the assigned officer from a name.
    for (const lead of row.leads) {
      if (!lead.externalId || !lead.landedAt) continue;
      const at = Date.parse(lead.landedAt);
      if (!Number.isFinite(at) || at > now + 30_000 || now - at > LEAD_ALERT_MAX_AGE_MS) continue;
      const key = `${row.lo.id}:${lead.externalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Already taken, or already in Shotgun: remembered so it never pops, but
      // not shown — there is nothing for this person to do about it.
      if (!leadAlertIsActionable({ claim: lead.claim ?? null, landedAt: lead.landedAt }, now)) continue;
      alerts.push({ key, externalId: lead.externalId, loId: row.lo.id, loName: row.lo.name, borrowerName: lead.borrowerName,
        phone: lead.phone ?? null, state: lead.state, source: lead.source, landedAt: lead.landedAt, claim: lead.claim ?? null,
        openToFloor: lead.openToFloor === true });
    }
  }
  // A burst is queued oldest first, not overwritten by the next polling result.
  alerts.sort((a, b) => Date.parse(a.landedAt) - Date.parse(b.landedAt));
  return { seen: Array.from(seen).slice(-LEAD_ALERT_SEEN_LIMIT), alerts };
}

export function activeLeadAlerts(queue: LoLeadAlert[], feed: LoLeadFeed, now: number) {
  if (!feed.configured || feed.stale) return [];
  const assigned = new Set(feed.los.flatMap(row => row.lo ? [row.lo.id] : []));
  // The latest word on each lead's claim, so a card drops the moment a
  // colleague takes it or it goes to Shotgun — and shows the live countdown.
  const claims = new Map<string, { claim: LoLeadClaim | null; openToFloor: boolean }>();
  for (const row of feed.los) for (const lead of row.leads) claims.set(`${row.lo?.id}:${lead.externalId}`, {
    claim: lead.claim ?? null, openToFloor: lead.openToFloor === true,
  });
  return queue
    .filter(alert => assigned.has(alert.loId) && claims.has(alert.key))
    .map(alert => ({ ...alert, ...claims.get(alert.key)! }))
    .filter(alert => leadAlertIsActionable(alert, now));
}

/**
 * Seeing an assigned lead is not accepting it. Bring unresolved original
 * assignments back after a short snooze or reload, regardless of old "seen"
 * storage, but never re-alert the whole floor or revive a settled deadline.
 */
export function renewAssignedLeadAlerts(
  queue: LoLeadAlert[], feed: LoLeadFeed, now: number,
  snoozedUntil: Readonly<Record<string, number>> = {}, resolved: ReadonlySet<string> = new Set(),
): LoLeadAlert[] {
  if (!feed.configured || feed.stale) return [];
  const current = new Map(activeLeadAlerts(queue, feed, now).map(alert => [alert.key, alert]));
  for (const row of feed.los) {
    if (!row.lo) continue;
    for (const lead of row.leads) {
      if (lead.openToFloor || lead.claim?.status !== "new" || !lead.externalId || !lead.landedAt) continue;
      if (!leadAlertIsActionable({ claim: lead.claim, landedAt: lead.landedAt }, now)) continue;
      const key = `${row.lo.id}:${lead.externalId}`;
      current.set(key, {
        key, externalId: lead.externalId, loId: row.lo.id, loName: row.lo.name,
        borrowerName: lead.borrowerName, phone: lead.phone ?? null, state: lead.state,
        source: lead.source, landedAt: lead.landedAt, claim: lead.claim, openToFloor: false,
      });
    }
  }
  return [...current.values()]
    .filter(alert => !resolved.has(alert.key) && !(snoozedUntil[alert.key] > now))
    // Your assigned work gets first attention, not an older floor-wide card.
    .sort((a, b) => Number(!!a.openToFloor) - Number(!!b.openToFloor)
      || leadAlertDeadline(a) - leadAlertDeadline(b) || a.key.localeCompare(b.key))
    .slice(0, 40);
}
