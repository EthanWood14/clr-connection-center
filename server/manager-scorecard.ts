export type TransferScorecardRangeKey = "3d" | "7d" | "14d" | "30d" | "90d";

export type TransferScorecardWindow = {
  startDate: string;
  endDate: string;
  days: number;
  label: string;
};

const PREVIOUS_DAYS: Array<[TransferScorecardRangeKey, number]> = [
  ["3d", 3],
  ["7d", 7],
  ["14d", 14],
  ["30d", 30],
  ["90d", 90],
];

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
  return Object.fromEntries(PREVIOUS_DAYS.map(([key, previousDays]) => [key, {
    startDate: subtractCalendarDays(today, previousDays),
    endDate: today,
    days: previousDays + 1,
    label: `${previousDays} days`,
  }])) as Record<TransferScorecardRangeKey, TransferScorecardWindow>;
}
