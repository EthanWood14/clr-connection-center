/**
 * Days the office is closed.
 *
 * A weekday is not automatically a working day. Labor Day 2026 was a Monday:
 * the whole team was off, and C3 counted it as an ordinary weekday everywhere
 * — so it chased people for an EOD report they were never going to file, it
 * divided the month's pace by a day nobody worked, and it counted a day off as
 * a day somebody failed to show up.
 *
 * ONE LIST, read by everything that asks whether a date is a working day.
 * There were five separate answers to that question in the codebase (the
 * business-day helpers, the comp floor, the pace calculator, the client
 * charts, and a hand-rolled loop in the EOD reminder cron); a holiday added to
 * three of the five would be worse than no holiday at all, because the
 * disagreement would be invisible.
 *
 * TO ADD A HOLIDAY: put the date in OBSERVED below. Dates are ISO
 * "YYYY-MM-DD", and they are the LOCAL business date, not UTC — the same
 * strings the rest of the app stores.
 */

/**
 * The dates the office is closed, newest last.
 *
 * Deliberately explicit rather than computed from a rule like "first Monday in
 * September". Which federal holidays a company actually closes for is a
 * business decision, not a calendar fact — half of them are ordinary working
 * days at most brokerages — so each one is here because somebody said so.
 */
export const OBSERVED: readonly string[] = [
  // Labor Day. Owner, 7 Sep 2026.
  "2026-09-07",
];

const OBSERVED_SET: ReadonlySet<string> = new Set(OBSERVED);

/** ISO "YYYY-MM-DD", loosely — enough to reject a Date or a timestamp. */
function isoOf(value: unknown): string {
  const s = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

/** Is the office closed on this date? */
export function isCompanyHoliday(date: unknown): boolean {
  const iso = isoOf(date);
  return iso.length > 0 && OBSERVED_SET.has(iso);
}

/**
 * Is this a day work is expected — a weekday the office is open?
 *
 * The single definition. Anything that used to ask "is it Mon-Fri" and meant
 * "is it a working day" should ask this instead.
 */
export function isWorkday(date: unknown): boolean {
  const iso = isoOf(date);
  if (!iso) return false;
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  // Noon UTC so a timezone offset can never move the date across midnight.
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !OBSERVED_SET.has(iso);
}

/** Build the ISO date for a year/month/day, so callers need not format it. */
export function isoFor(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Holidays inside a month, from the 1st through `throughDay` inclusive.
 *
 * What the counters subtract. Weekend holidays are NOT counted — a Saturday
 * the office is closed is not a day of work lost, and subtracting it from a
 * weekday count would remove a day that was never in the count.
 */
export function holidaysInMonth(year: number, month: number, throughDay?: number): string[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = Math.min(throughDay ?? lastDay, lastDay);
  if (!(end >= 1)) return [];
  const out: string[] = [];
  for (let day = 1; day <= end; day += 1) {
    const iso = isoFor(year, month, day);
    if (!OBSERVED_SET.has(iso)) continue;
    const dow = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
    if (dow === 0 || dow === 6) continue; // never in a weekday count to begin with
    out.push(iso);
  }
  return out;
}

/**
 * Holidays that fall on a non-Sunday, for the pace calculator.
 *
 * The pace deliberately counts Saturdays (owner's rule: Sundays only are out),
 * so a Saturday holiday DOES need subtracting there even though it does not
 * from a Mon-Fri count. The two subtractions differ because the two counts do.
 */
export function nonSundayHolidaysInMonth(year: number, month: number, throughDay?: number): string[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = Math.min(throughDay ?? lastDay, lastDay);
  if (!(end >= 1)) return [];
  const out: string[] = [];
  for (let day = 1; day <= end; day += 1) {
    const iso = isoFor(year, month, day);
    if (!OBSERVED_SET.has(iso)) continue;
    if (new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay() === 0) continue;
    out.push(iso);
  }
  return out;
}
