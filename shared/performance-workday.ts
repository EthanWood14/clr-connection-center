import { dayAvailabilityWeight, type DayAvailabilityContext } from "./half-day";
import { isCompanyHoliday } from "./company-holidays";

// Fixed effective date: never move the historical rule as time passes.
export const PERFORMANCE_WORKDAY_CUTOFF = "2026-07-21";
export const PERFORMANCE_WORKDAY_DESCRIPTION = "A transfer or at least 1 hour of CallTools active time; before July 21, 2026, calls or a transfer. Approved full days off are excluded; half days count as 0.5.";

/** Performance only. Attendance, payroll and training tenure are separate. */
export function isPerformanceWorkday(
  date: string,
  transferCredit: number | null | undefined,
  callToolsActiveSeconds: number | null | undefined,
  calls: number | null | undefined,
): boolean {
  const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (date < PERFORMANCE_WORKDAY_CUTOFF) return positive(transferCredit) || positive(calls);
  return positive(transferCredit) || (positive(callToolsActiveSeconds) && callToolsActiveSeconds! >= 3600);
}

export type PerformanceDay = {
  userId: number;
  date: string;
  transfers: number;
  calls: number;
  callToolsActiveSeconds: number;
};

export function performanceDayWeight(row: PerformanceDay, availability?: DayAvailabilityContext | null): number {
  return isPerformanceWorkday(row.date, row.transfers, row.callToolsActiveSeconds, row.calls)
    ? dayAvailabilityWeight(row.userId, row.date, availability) : 0;
}

export function performanceDaysByUser(rows: readonly PerformanceDay[], availability?: DayAvailabilityContext | null): Map<number, number> {
  const result = new Map<number, number>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.userId}:${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const weight = performanceDayWeight(row, availability);
    if (weight > 0) result.set(row.userId, (result.get(row.userId) ?? 0) + weight);
  }
  return result;
}

/** Forecast only: future availability is unknown activity, never "days worked".
 * Preserve the scorecard's non-Sunday schedule, with holidays and time off out.
 */
export function remainingPerformancePaceDays(userId: number, today: string, availability?: DayAvailabilityContext): number {
  const cursor = new Date(`${today}T12:00:00Z`);
  if (!Number.isFinite(cursor.getTime())) return 0;
  const month = cursor.getUTCMonth();
  let days = 0;
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCMonth() === month) {
    const date = cursor.toISOString().slice(0, 10);
    if (cursor.getUTCDay() !== 0 && !isCompanyHoliday(date)) days += dayAvailabilityWeight(userId, date, availability);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function projectPerformanceTransfers(transfers: number, workedDays: number, remainingDays: number): number | null {
  return workedDays > 0 ? Math.round(transfers + transfers / workedDays * Math.max(0, remainingDays)) : null;
}
