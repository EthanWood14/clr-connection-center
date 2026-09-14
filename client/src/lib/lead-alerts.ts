/** Only IDs are remembered; borrower details never go into browser storage. */
export const LEAD_ALERT_MAX_AGE_MS = 10 * 60_000;
export const LEAD_ALERT_SEEN_LIMIT = 500;

export type LoLeadAlert = {
  key: string;
  loId: number;
  loName: string;
  borrowerName: string | null;
  state: string | null;
  source: string | null;
  landedAt: string;
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
      state: string | null;
      source: string | null;
      landedAt: string | null;
    }>;
  }>;
};

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
      alerts.push({ key, loId: row.lo.id, loName: row.lo.name, borrowerName: lead.borrowerName,
        state: lead.state, source: lead.source, landedAt: lead.landedAt });
    }
  }
  // A burst is queued oldest first, not overwritten by the next polling result.
  alerts.sort((a, b) => Date.parse(a.landedAt) - Date.parse(b.landedAt));
  return { seen: [...seen].slice(-LEAD_ALERT_SEEN_LIMIT), alerts };
}

export function activeLeadAlerts(queue: LoLeadAlert[], feed: LoLeadFeed, now: number) {
  const assigned = new Set(feed.los.flatMap(row => row.lo ? [row.lo.id] : []));
  return queue.filter(alert => assigned.has(alert.loId) && now - Date.parse(alert.landedAt) <= LEAD_ALERT_MAX_AGE_MS);
}
