/**
 * Timed `needs_transfers` pins applied on boot (no UI login required).
 *
 * Ethan 2026-09-18: prioritize Markus Wood for one week.
 * Window is America/Los_Angeles calendar dates, inclusive.
 */

/** First name Markus + last Wood — not Ethan Wood, Mark Wood, Markus Woodward, etc. */
export const MARKUS_WOOD_NAME_RE = /^\s*markus\s+wood\b/i;

export const MARKUS_WOOD_PIN = {
  nameRe: MARKUS_WOOD_NAME_RE,
  /** Inclusive Pacific calendar day YYYY-MM-DD. */
  startDate: "2026-09-18",
  /** Inclusive Pacific calendar day YYYY-MM-DD. */
  endDate: "2026-09-25",
  reason: "Ethan 2026-09-18: prioritize Markus Wood for a week (needs_transfers pin)",
} as const;

export type TimedNeedsTransfersRule = {
  nameRe: RegExp;
  startDate: string;
  endDate: string;
  reason: string;
};

export const TIMED_NEEDS_TRANSFERS_PINS: readonly TimedNeedsTransfersRule[] = [MARKUS_WOOD_PIN];

/** Pacific calendar date YYYY-MM-DD for `when` (defaults to now). */
export function pacificCalendarDate(when: Date = new Date()): string {
  return when.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function matchesMarkusWood(name: string | null | undefined): boolean {
  return MARKUS_WOOD_NAME_RE.test(String(name ?? "").trim());
}

export function matchesTimedNeedsTransfersName(
  name: string | null | undefined,
  rule: TimedNeedsTransfersRule = MARKUS_WOOD_PIN,
): boolean {
  return rule.nameRe.test(String(name ?? "").trim());
}

/**
 * Desired pin for a timed rule on a Pacific calendar day:
 * - during [start, end]: 1 (pin on)
 * - after end: 0 (clear so the timed pin does not stick forever)
 * - before start: null (leave whatever is already set alone)
 */
export function timedNeedsTransfersDesired(
  ptDate: string,
  rule: TimedNeedsTransfersRule = MARKUS_WOOD_PIN,
): 0 | 1 | null {
  const day = String(ptDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (day < rule.startDate) return null;
  if (day <= rule.endDate) return 1;
  return 0;
}

export function isTimedNeedsTransfersWindowActive(
  ptDate: string,
  rule: TimedNeedsTransfersRule = MARKUS_WOOD_PIN,
): boolean {
  return timedNeedsTransfersDesired(ptDate, rule) === 1;
}
