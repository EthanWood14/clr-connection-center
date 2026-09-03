// Pace-day arithmetic for the Transfer Scorecard's month-to-date projection.
//
// The scorecard projects month-end from the pace so far: transfers divided by
// the days already worked, multiplied by the days the month will have. Which
// days count as "worked" is the whole question, and the answer here is Ethan's:
// SUNDAYS DO NOT COUNT. Saturday does. Counting Sundays as zero-transfer days
// drags the daily rate down and understates every projection by about a
// seventh.
//
// -------------------------------------------------------------------------
// THIS IS DELIBERATELY NOT THE SAME RULE AS THE COMP ESTIMATE. DO NOT MERGE.
// -------------------------------------------------------------------------
// server/business-day.ts exports countWeekdaysInMonth, which excludes Saturday
// AND Sunday, and server/routes.ts's projected comp/pay estimate uses it to
// price a CLR's month-end transfers. So the same CLR can show one projected
// number on the scorecard and a different one in the comp email: this counter
// treats Saturday as a working day and that one does not.
//
// That difference is intentional and was asked for. The scorecard is a live
// activity read, and Saturdays do produce transfers; the comp estimate is a
// money number with its own history. If you are here to "harmonise" the two
// projections, don't — change the one you were actually asked to change, and
// leave this comment standing for whoever arrives next.
//
// This lives in shared/ rather than server/ because its only caller is the
// manager dashboard (client/src/pages/manager-dashboard.tsx). Client code must
// never import from server/.

/**
 * Is this calendar date a Sunday?
 *
 * Built at NOON UTC, exactly as server/business-day.ts's isWeekday does. A date
 * pinned at midnight can be nudged onto the adjacent calendar day by a DST
 * offset, and an adjacent day is a different weekday — which would silently
 * make a Sunday count, or a Monday not. Noon leaves twelve hours of slack on
 * either side, so no real-world DST shift can move it.
 */
function isSunday(year: number, month: number, day: number): boolean {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay() === 0;
}

/**
 * Count non-Sunday days in a month, from the 1st through `throughDay` inclusive.
 *
 * `month` is 1-based (1 = January), matching countWeekdaysInMonth.
 *
 * Omit `throughDay` for the whole month — that is the multiplier half of the
 * pace. Pass today's day-of-month for the divisor half.
 *
 * Pinned edges, so callers can rely on them:
 *   - `throughDay` past the end of the month CLAMPS to the last day, so 31 in a
 *     30-day month counts the 30 days that exist.
 *   - `throughDay` of 0, a negative, or NaN returns 0 — there is no such thing
 *     as a negative number of worked days.
 *   - A month outside 1..12, or a non-integer year/month, returns 0 rather than
 *     rolling over into a neighbouring year. Date.UTC(y, 13, 0) would happily
 *     hand back January of the next year; a wrong month should not quietly
 *     answer with the wrong month's data.
 *
 * A 0 return is safe downstream: the dashboard only projects when daysElapsed
 * is greater than 0, so a nonsense window shows "—" instead of a number.
 */
export function countNonSundaysInMonth(year: number, month: number, throughDay?: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return 0;
  if (month < 1 || month > 12) return 0;
  // Day 0 of the NEXT month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = Math.min(throughDay ?? lastDay, lastDay);
  if (!(end >= 1)) return 0; // catches 0, negatives and NaN
  let count = 0;
  for (let day = 1; day <= end; day++) {
    if (!isSunday(year, month, day)) count++;
  }
  return count;
}
