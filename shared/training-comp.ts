/**
 * Training-day pay.
 *
 * A CLR who spends a day training someone is paid a flat rate for that day,
 * rather than logging it as hours. The rate lives here so the picker and the
 * server cannot drift apart — but the amount that reaches the ledger is always
 * recomputed on the server from the day count, never taken from the client.
 */

export const TRAINING_DAY_RATES = {
  standard: { cents: 2000, label: "Standard", perDay: "$20/day" },
  double: { cents: 4000, label: "Double time", perDay: "$40/day" },
} as const;

export type TrainingRate = keyof typeof TRAINING_DAY_RATES;

export function isTrainingRate(v: unknown): v is TrainingRate {
  return v === "standard" || v === "double";
}

export function trainingRateCents(rate: unknown): number {
  return TRAINING_DAY_RATES[isTrainingRate(rate) ? rate : "standard"].cents;
}

/** Total for a set of days at the given rate. */
export function trainingAmountCents(dayCount: number, rate: unknown): number {
  const n = Math.max(0, Math.floor(Number(dayCount) || 0));
  return n * trainingRateCents(rate);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Clean a submitted set of training days: valid dates only, de-duplicated,
 * sorted, and never in the future — you cannot claim a day you have not worked.
 * `today` is passed in so the caller decides the timezone.
 */
export function normalizeTrainingDates(input: unknown, today: string, max = 31): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    const d = String(raw ?? "").slice(0, 10);
    if (!YMD.test(d)) continue;
    if (Number.isNaN(Date.parse(`${d}T12:00:00Z`))) continue;
    if (d > today) continue;
    seen.add(d);
  }
  return Array.from(seen).sort().slice(0, max);
}

/** What the request says it covers, for the approver reading the list. */
export function describeTrainingDays(dates: string[], rate: unknown): string {
  const r = TRAINING_DAY_RATES[isTrainingRate(rate) ? rate : "standard"];
  const n = dates.length;
  return `Training pay — ${n} day${n === 1 ? "" : "s"} at ${r.perDay}`;
}

export function trainingDetail(dates: string[]): string {
  return dates.join(", ");
}
