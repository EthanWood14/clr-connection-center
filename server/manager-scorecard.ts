export type TransferScorecardRangeKey = "today" | "3d" | "7d" | "14d" | "30d" | "90d" | "mtd";

export type TransferScorecardWindow = {
  startDate: string;
  endDate: string;
  days: number;
  label: string;
};

const PREVIOUS_DAYS: Array<[TransferScorecardRangeKey, number]> = [
  // Zero previous days — today alone. Managers wanted to see the board as it
  // stands right now, not blended into a week where a strong morning is
  // invisible against six other days.
  ["today", 0],
  ["3d", 3],
  ["7d", 7],
  ["14d", 14],
  ["30d", 30],
  ["90d", 90],
];

/** The 1st of the month `date` falls in. */
function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** How many days of this month have happened, counting today. */
function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10)) || 1;
}

function subtractCalendarDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

// Scorecard ranges include both endpoints. For example, the 7-day selection
// deliberately includes the calendar date seven days before today.
export function buildTransferScorecardWindows(
  today: string,
): Record<TransferScorecardRangeKey, TransferScorecardWindow> {
  const rolling = Object.fromEntries(PREVIOUS_DAYS.map(([key, previousDays]) => [key, {
    startDate: subtractCalendarDays(today, previousDays),
    endDate: today,
    days: previousDays + 1,
    // "0 days" would be both wrong and unreadable for the single-day window.
    label: previousDays === 0 ? "Today" : `${previousDays} days`,
  }])) as Record<TransferScorecardRangeKey, TransferScorecardWindow>;

  // Month to date is the one window that is not "the last N days": it starts
  // on the 1st and grows through the month, so on the 3rd it covers three
  // days and on the 31st it covers thirty-one. Comparing it against a fixed
  // 30-day window would quietly mislead early in the month.
  rolling.mtd = {
    startDate: firstOfMonth(today),
    endDate: today,
    days: dayOfMonth(today),
    label: "Month to date",
  };
  return rolling;
}

/**
 * The same stretch of the previous month, for an honest month-over-month
 * comparison.
 *
 * The dashboard used to measure this month to TODAY and the previous month in
 * FULL, so on the 2nd it read two days against thirty-one and every metric
 * looked catastrophic. This returns the 1st through the same day number, and
 * clamps when the previous month is shorter — comparing the 31st of a 31-day
 * month against the 30th is the closest honest answer available.
 */
export function priorMonthToDate(today: string): { startDate: string; endDate: string } {
  const [y, m, d] = today.split("-").map(Number);
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  const daysInPrev = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const day = Math.min(d, daysInPrev);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    startDate: `${prevYear}-${pad(prevMonth)}-01`,
    endDate: `${prevYear}-${pad(prevMonth)}-${pad(day)}`,
  };
}
