// All-time CLR statistics, and how one CLR compares to the rest of the floor.
//
// The hard part is not the arithmetic, it is making the comparison fair:
//
// - Totals reward tenure. Someone six months in will out-total a strong CLR who
//   started in July no matter how good the newer one is. Every headline figure
//   here is therefore PER ACTIVE DAY, with the raw total kept alongside as
//   context rather than as the verdict.
// - An "active day" is a day the CLR actually logged calls or outcomes, not a
//   calendar day. Time off, training and part-time schedules otherwise read as
//   underperformance.
// - The team baseline is the MEDIAN, not the mean. One outlier week from one
//   person drags a mean far enough to make everyone else look below average.
// - People excluded from stats (and the CLR being viewed) are excluded from the
//   baseline, so nobody is compared against a benchmark they are inside of.
//
// Pure functions; the caller supplies the rows.

export type ClrTotals = {
  userId: number;
  name: string;
  calls: number;
  transfers: number;
  appointments: number;
  fellThrough: number;
  activeDays: number;
  firstDay: string | null;
  lastDay: string | null;
};

export type MetricKey = "transfersPerDay" | "appointmentsPerDay" | "callsPerDay" | "transferRate" | "fellThroughRate";

export const METRIC_LABELS: Record<MetricKey, string> = {
  transfersPerDay: "Transfers / active day",
  appointmentsPerDay: "Appointments / active day",
  callsPerDay: "Calls / active day",
  transferRate: "Transfers per 100 calls",
  fellThroughRate: "Fell-through rate",
};

// Lower is better for exactly one of these; the UI must not paint a low
// fell-through rate red.
export const LOWER_IS_BETTER: Record<MetricKey, boolean> = {
  transfersPerDay: false, appointmentsPerDay: false, callsPerDay: false,
  transferRate: false, fellThroughRate: true,
};

const round = (n: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function metricsFor(t: ClrTotals): Record<MetricKey, number> {
  const d = t.activeDays || 0;
  const settled = t.transfers + t.fellThrough;
  return {
    transfersPerDay: d ? round(t.transfers / d) : 0,
    appointmentsPerDay: d ? round(t.appointments / d) : 0,
    callsPerDay: d ? round(t.calls / d) : 0,
    // Per 100 calls rather than a fraction of a percent — "2.1 per 100 calls"
    // is a sentence someone can act on; "0.021" is not.
    transferRate: t.calls ? round((t.transfers / t.calls) * 100) : 0,
    fellThroughRate: settled ? round((t.fellThrough / settled) * 100, 1) : 0,
  };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round((s[mid - 1] + s[mid]) / 2);
}

export type Comparison = {
  key: MetricKey;
  label: string;
  value: number;
  teamMedian: number;
  /** Signed % difference from the team median; null when there is no baseline. */
  deltaPct: number | null;
  /** True when this CLR is on the good side of the median for THIS metric. */
  better: boolean;
  lowerIsBetter: boolean;
  /** 1 = best on the floor. Ranked among peers plus this CLR. */
  rank: number;
  outOf: number;
};

/**
 * Below this many active days a rate is noise, not a signal: two days of work
 * can put someone top or bottom of the floor on a single lucky call. The UI
 * shows the numbers either way but says plainly that the comparison is thin.
 */
export const MIN_DAYS_FOR_COMPARISON = 5;

export function comparisonIsThin(t: ClrTotals): boolean {
  return t.activeDays < MIN_DAYS_FOR_COMPARISON;
}

export function compare(subject: ClrTotals, peers: ClrTotals[]): Comparison[] {
  const mine = metricsFor(subject);
  // Peers who never worked a day carry no information and would drag every
  // baseline to zero.
  const active = peers.filter((p) => p.activeDays > 0 && p.userId !== subject.userId);
  const peerMetrics = active.map(metricsFor);

  return (Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => {
    const value = mine[key];
    const teamMedian = median(peerMetrics.map((m) => m[key]));
    const lowerIsBetter = LOWER_IS_BETTER[key];
    const pool = [value, ...peerMetrics.map((m) => m[key])];
    const sorted = [...pool].sort((a, b) => (lowerIsBetter ? a - b : b - a));
    return {
      key,
      label: METRIC_LABELS[key],
      value,
      teamMedian,
      // A zero baseline has no meaningful percentage — say so instead of
      // reporting an infinite improvement.
      deltaPct: teamMedian === 0 ? null : round(((value - teamMedian) / teamMedian) * 100, 1),
      better: lowerIsBetter ? value <= teamMedian : value >= teamMedian,
      lowerIsBetter,
      rank: sorted.indexOf(value) + 1,
      outOf: pool.length,
    };
  });
}
