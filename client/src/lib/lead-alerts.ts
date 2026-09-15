/** Only IDs are remembered; borrower details never go into browser storage. */
export const LEAD_ALERT_MAX_AGE_MS = 10 * 60_000;
export const LEAD_ALERT_SEEN_LIMIT = 500;

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
      if (claimSettled(lead.claim)) continue;
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
  const assigned = new Set(feed.los.flatMap(row => row.lo ? [row.lo.id] : []));
  // The latest word on each lead's claim, so a card drops the moment a
  // colleague takes it or it goes to Shotgun — and shows the live countdown.
  const claims = new Map<string, LoLeadClaim | null>();
  for (const row of feed.los) for (const lead of row.leads) claims.set(`${row.lo?.id}:${lead.externalId}`, lead.claim ?? null);
  return queue
    .filter(alert => assigned.has(alert.loId) && now - Date.parse(alert.landedAt) <= LEAD_ALERT_MAX_AGE_MS)
    .map(alert => (claims.has(alert.key) ? { ...alert, claim: claims.get(alert.key) ?? alert.claim } : alert))
    .filter(alert => !claimSettled(alert.claim));
}
