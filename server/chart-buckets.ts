/**
 * Bucketing for the CLR profile activity chart.
 *
 * The chart used to be day-only and blanked entirely past 120 days, so "all
 * time" showed nothing at all. A day bar is right for a month; past a quarter
 * it is 180 unreadable slivers, and over all time it is thousands. These
 * helpers pick a bucket width from the span and fold days into it.
 *
 * Pure functions with no database or Express dependency — importing
 * server/routes.ts from a test boots the whole server (crons included) and
 * hangs, so anything that needs testing lives here instead.
 */

export type BucketWidth = "day" | "week" | "month";

/** Series carried by every bucket. Keys match the client's DAILY_SERIES. */
export interface ActivityPoint {
  date: string;
  callMinutes: number;
  dialpadCalls: number;
  callToolsCalls: number;
  conversations: number;
  transfers: number;
  appointments: number;
}

export interface Bucket extends ActivityPoint {
  /** Inclusive last day covered, for the tooltip. Equals `date` for day width. */
  endDate: string;
  /** Days in this bucket that fell inside the requested range. */
  dayCount: number;
  /** True when every day in the bucket was approved time off. */
  allTimeOff: boolean;
  /** Days in this bucket the CLR was on approved time off. */
  timeOffDays: number;
}

/** Day width up to a quarter; weekly to about 18 months; monthly beyond. */
export const DAY_BUCKET_MAX_DAYS = 92;
export const WEEK_BUCKET_MAX_DAYS = 550;

export function chooseBucketWidth(startDate: string, endDate: string): BucketWidth {
  const span = daysBetween(startDate, endDate);
  if (span <= DAY_BUCKET_MAX_DAYS) return "day";
  if (span <= WEEK_BUCKET_MAX_DAYS) return "week";
  return "month";
}

export function daysBetween(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T12:00:00Z`);
  const b = Date.parse(`${endDate}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}

/**
 * Sunday-anchored, to agree with resolveNamedPeriod's own "this week" (which
 * runs Sunday..Saturday). A naive floor(index / 7) from the range start would
 * agree with neither that nor the calendar.
 */
export function weekStart(date: string): string {
  return addDays(date, -dayOfWeek(date));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m, 0, 12, 0, 0)).toISOString().slice(0, 10);
}

function bucketKeyFor(date: string, width: BucketWidth): string {
  if (width === "day") return date;
  if (width === "week") return weekStart(date);
  return monthStart(date);
}

function bucketEndFor(key: string, width: BucketWidth): string {
  if (width === "day") return key;
  if (width === "week") return addDays(key, 6);
  return monthEnd(key);
}

const SERIES_KEYS = [
  "callMinutes", "dialpadCalls", "callToolsCalls",
  "conversations", "transfers", "appointments",
] as const;

export function pointIsEmpty(p: ActivityPoint): boolean {
  return SERIES_KEYS.every((k) => !Number(p[k]));
}

export interface BuildBucketsInput {
  startDate: string;
  endDate: string;
  /** Per-day values, already resolved from the feeds. */
  dayValue: (date: string) => ActivityPoint;
  /** Dates the CLR was on approved time off. */
  timeOffDays?: Set<string>;
  width?: BucketWidth;
  /**
   * Drop Saturdays and Sundays that had no activity. A CLR is not expected to
   * work a weekend, so an empty weekend bar reads as a bad day when it is just
   * a day off — but a weekend they DID work still belongs on the chart.
   * Only meaningful at day width; weekends fold into their week or month.
   */
  hideEmptyWeekends?: boolean;
}

export function buildBuckets(input: BuildBucketsInput): { width: BucketWidth; buckets: Bucket[] } {
  const width = input.width ?? chooseBucketWidth(input.startDate, input.endDate);
  const hideEmptyWeekends = input.hideEmptyWeekends ?? true;
  const timeOff = input.timeOffDays ?? new Set<string>();

  const byKey = new Map<string, Bucket>();
  const order: string[] = [];

  for (let d = input.startDate; d <= input.endDate; d = addDays(d, 1)) {
    const point = input.dayValue(d);
    const off = timeOff.has(d);

    // A quiet weekend is not a workday that went badly — leave it out. A
    // weekend with real activity is kept, because that is worth seeing.
    if (width === "day" && hideEmptyWeekends && isWeekend(d) && pointIsEmpty(point) && !off) continue;

    const key = bucketKeyFor(d, width);
    let b = byKey.get(key);
    if (!b) {
      b = {
        date: key,
        endDate: bucketEndFor(key, width),
        dayCount: 0,
        timeOffDays: 0,
        allTimeOff: false,
        callMinutes: 0, dialpadCalls: 0, callToolsCalls: 0,
        conversations: 0, transfers: 0, appointments: 0,
      };
      byKey.set(key, b);
      order.push(key);
    }
    b.dayCount += 1;
    if (off) b.timeOffDays += 1;
    for (const k of SERIES_KEYS) b[k] += Number(point[k]) || 0;
  }

  // A week or month bucket must not advertise coverage past the range it was
  // asked for — the last one is usually partial.
  for (const b of Array.from(byKey.values())) {
    if (b.endDate > input.endDate) b.endDate = input.endDate;
    b.allTimeOff = b.dayCount > 0 && b.timeOffDays === b.dayCount;
  }

  // Recharts plots in array order and never sorts.
  order.sort();
  return { width, buckets: order.map((k) => byKey.get(k)!) };
}

/**
 * Least-squares fit over the buckets, returned as the endpoints of the line so
 * the client can draw it without a stats dependency. Null when there is not
 * enough to fit, or when the fit would be meaningless (every value identical).
 */
export function trendLine(values: number[]): { from: number; to: number; slope: number } | null {
  const n = values.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sx += i; sy += values[i]; sxy += i * values[i]; sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const from = intercept;
  const to = intercept + slope * (n - 1);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to, slope };
}
