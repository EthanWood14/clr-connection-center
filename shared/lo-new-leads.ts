/**
 * Fresh assigned-LO leads are part of Shotgun (4.122.24+).
 *
 * When LeadVault reports a lead for one of today's assigned LOs, C3 records it
 * and immediately publishes a Shotgun lead so it shares offer / claim /
 * presence / reclaim / bounceback / SLA with every other Shotgun lead — not a
 * forever-separate card system.
 *
 * Assignee head-start (kept at 45s, not 0): measured 15 Sep 2026, every lead
 * alerted exactly ONE person — the CLR assigned to that LO that day — and
 * people who see one take it in about half a minute. Zero head-start would be
 * cleaner code, but would yank a lead off the assignee mid-reach for the
 * Ready pool. Documented choice: keep ~45s exclusive preferred-assignee
 * offers, then normal Ready CLR Shotgun rotation.
 *
 * The old parallel path (assignee card → floor card → escalate at 3 minutes)
 * is shrunk: once the Shotgun lead exists, ShotgunOfferAlert is the claim UX.
 * lo_new_leads remains the idempotent arrival log + link to shotgun_lead_id.
 */
export const LO_NEW_LEAD_CLAIM_WINDOW_MS = 3 * 60_000;
/**
 * How long preferred assignees get the Shotgun offer to themselves before the
 * Ready CLR rotation opens. Same value as the former floor head-start.
 */
export const LO_NEW_LEAD_FLOOR_AFTER_MS = 45_000;
/** Alias — head-start before Ready Shotgun rotation. */
export const LO_NEW_LEAD_HEAD_START_MS = LO_NEW_LEAD_FLOOR_AFTER_MS;
/** Only a lead that landed this recently is announced; older ones are history, not arrivals. */
export const LO_NEW_LEAD_FRESH_MS = 10 * 60_000;

export type LoNewLeadStatus = "new" | "claimed" | "escalated" | "escalate_failed";

/** When an unclaimed lead first seen at `firstSeenAt` would have gone to Shotgun under the old 3-minute path (safety-net cutoff). */
export function loNewLeadEscalateAt(firstSeenAt: string): string {
  return new Date(Date.parse(firstSeenAt) + LO_NEW_LEAD_CLAIM_WINDOW_MS).toISOString();
}

/** Seconds left in the legacy claim window, floored at zero. */
export function loNewLeadSecondsLeft(escalateAt: string | null | undefined, nowMs: number = Date.now()): number {
  const at = Date.parse(String(escalateAt ?? ""));
  return Number.isFinite(at) ? Math.max(0, (at - nowMs) / 1000) : 0;
}

/** When preferred-assignee head-start ends and Ready rotation opens. */
export function loNewLeadFloorAt(firstSeenAt: string): string {
  return new Date(Date.parse(firstSeenAt) + LO_NEW_LEAD_FLOOR_AFTER_MS).toISOString();
}

export function loNewLeadHeadStartUntil(firstSeenAt: string): string {
  return new Date(Date.parse(firstSeenAt) + LO_NEW_LEAD_HEAD_START_MS).toISOString();
}

/**
 * Whether an unclaimed parallel-card lead is open to any Ready CLR at `nowMs`
 * (legacy floor). Prefer Shotgun rotation once shotgun_lead_id is set.
 */
export function loNewLeadIsOpenToFloor(firstSeenAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const at = Date.parse(String(firstSeenAt ?? ""));
  if (!Number.isFinite(at)) return false;
  return nowMs >= at + LO_NEW_LEAD_FLOOR_AFTER_MS && nowMs < at + LO_NEW_LEAD_CLAIM_WINDOW_MS;
}

/** Whether a feed lead is a fresh arrival worth announcing at `nowMs`. */
export function loNewLeadIsFresh(landedAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const at = Date.parse(String(landedAt ?? ""));
  return Number.isFinite(at) && at <= nowMs + 30_000 && nowMs - at <= LO_NEW_LEAD_FRESH_MS;
}
