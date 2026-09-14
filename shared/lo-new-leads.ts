/**
 * A new lead for an assigned loan officer behaves like a Shotgun lead.
 *
 * When LeadVault reports a lead landing on one of today's assigned LOs, the
 * CLR(s) working that LO get it at once: a card with a tap-to-call number, a
 * notification, a push. They have CLAIM_WINDOW to say "got it". A lead nobody
 * claims in that time is handed to the Shotgun rotation, where the normal
 * twenty-second offer moves it from CLR to CLR until somebody takes it —
 * so a hot lead never sits with a person who stepped away.
 *
 * Pure so the timing can be tested without a database.
 */
export const LO_NEW_LEAD_CLAIM_WINDOW_MS = 3 * 60_000;
/** Only a lead that landed this recently is announced; older ones are history, not arrivals. */
export const LO_NEW_LEAD_FRESH_MS = 10 * 60_000;

export type LoNewLeadStatus = "new" | "claimed" | "escalated" | "escalate_failed";

/** When an unclaimed lead first seen at `firstSeenAt` goes to Shotgun. */
export function loNewLeadEscalateAt(firstSeenAt: string): string {
  return new Date(Date.parse(firstSeenAt) + LO_NEW_LEAD_CLAIM_WINDOW_MS).toISOString();
}

/** Seconds left in the claim window, floored at zero. */
export function loNewLeadSecondsLeft(escalateAt: string | null | undefined, nowMs: number = Date.now()): number {
  const at = Date.parse(String(escalateAt ?? ""));
  return Number.isFinite(at) ? Math.max(0, (at - nowMs) / 1000) : 0;
}

/** Whether a feed lead is a fresh arrival worth announcing at `nowMs`. */
export function loNewLeadIsFresh(landedAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  const at = Date.parse(String(landedAt ?? ""));
  return Number.isFinite(at) && at <= nowMs + 30_000 && nowMs - at <= LO_NEW_LEAD_FRESH_MS;
}
