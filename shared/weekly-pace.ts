/**
 * Transfers per CLR per day, by week.
 *
 * The floor's real pace, and the one number that survives a changing roster:
 * a week with twelve people and a week with seven are not comparable on
 * totals, and "per CLR per week" quietly assumes everybody worked five days.
 * So the denominator is DAYS ACTUALLY WORKED. Somebody who worked one day
 * counts as one day, not as a week; somebody who was off all week is not in
 * that week at all; and today counts as half a day, because it is not over.
 *
 * Ethan's rules, 15-16 Sep 2026, in the order he gave them:
 *  - exclude Elleine and the system accounts (the caller supplies the roster)
 *  - count somebody only once they are past their first two weeks
 *  - "someone shouldn't count for a week if they only worked a day. Count by
 *    days."
 *  - "for this week, include today as half of a day"
 *
 * Quiet week (21 Sep 2026): a CLR with zero credited transfers that week does
 * not belong in clrDays — dial/SMS/EOD activity alone must not inflate the
 * denom (Kristi). STATS_EXCLUDED_FROM people (Jordon) stay via
 * keepZeroCreditUserIds so pre-fromDate activity days still count at 0 credit.
 *
 * Half days (18 Sep 2026): an approved half day — or a standing half-day rule —
 * halves that person's day weight. A full approved day off ("no day") drops the
 * day to weight 0 even if activity leaked. A named person-day exclusion (Jeremy
 * on 2026-09-17) likewise drops both the day and any transfers that day.
 * Callers must pass from-date/Jeremy exclusions only in excludedDays — not
 * half-day credit exclusions — or half days collapse to weight 0.
 *
 * Pure, so the wallboard and any report read the same numbers from the same
 * rules rather than two lots of SQL that drift.
 */

import { paceDayWeight } from "./half-day";

/** A CLR counts from this many days after their first recorded day of work. */
export const PACE_RAMP_DAYS = 14;
/** Today is half done, so it is half a day in the denominator. */
export const PACE_TODAY_WEIGHT = 0.5;

export type PaceDay = { userId: number; date: string };
export type PaceCredit = { userId: number; date: string; credit: number };

export type PaceWeek = {
  /** Monday, "YYYY-MM-DD". */
  weekStart: string;
  /** "Jul 13" — the wall has no room for a year. */
  label: string;
  /** People who worked at least one weekday that week. */
  clrs: number;
  /** Days worked, today weighted at PACE_TODAY_WEIGHT (and half days halved). */
  clrDays: number;
  transfers: number;
  /** transfers ÷ clrDays, or null when nobody worked. */
  perClrPerDay: number | null;
  /** The week in progress: fewer days have happened than will. */
  partial: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Date arithmetic on "YYYY-MM-DD" with no timezone anywhere near it. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week `iso` falls in. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

/** Monday to Friday. Weekend work is real but it is not the week's shape. */
export function isWeekday(iso: string): boolean {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

export function weekLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function weeklyPace(input: {
  /** Every day each rostered CLR recorded any work. */
  days: ReadonlyArray<PaceDay>;
  /** Transfer credit per CLR per business date (halves for Shotgun). */
  credits: ReadonlyArray<PaceCredit>;
  /** Today in the office's timezone, "YYYY-MM-DD". */
  today: string;
  /** How many weeks back, ending with the one today is in. */
  weeks?: number;
  /**
   * User ids on an approved half day (or standing half-day rule) for a given
   * date. Keyed as `${userId}:${date}` → true.
   */
  halfDays?: ReadonlySet<string>;
  /** Approved full-day time off ("no days"). Keyed as `${userId}:${date}`. */
  fullOffDays?: ReadonlySet<string>;
  /**
   * Person-days dropped from both denominator and numerator (Jeremy one-offs,
   * STATS_EXCLUDED_FROM from-date days). Do NOT put half-day credit keys here —
   * those belong in halfDays at weight 0.5.
   */
  excludedDays?: ReadonlyArray<{ userId: number; date: string }>;
  /**
   * STATS_EXCLUDED_FROM user ids (Jordon). Their activity days stay in clrDays
   * even when the week's credited transfers are 0 — from-date may zero credit
   * while pre-fromDate Mon–Tue must still count.
   */
  keepZeroCreditUserIds?: ReadonlySet<number>;
}): PaceWeek[] {
  const { days, credits, today } = input;
  const count = Math.max(1, Math.min(52, input.weeks ?? 10));
  const halfDays = input.halfDays ?? new Set<string>();
  const fullOffDays = input.fullOffDays ?? new Set<string>();
  const excluded = input.excludedDays ?? [];
  const keepZero = input.keepZeroCreditUserIds ?? new Set<number>();

  // First day of work per person, for the ramp rule.
  const firstDay = new Map<number, string>();
  days.forEach((row) => {
    const seen = firstDay.get(row.userId);
    if (!seen || row.date < seen) firstDay.set(row.userId, row.date);
  });

  const starts: string[] = [];
  let cursor = mondayOf(today);
  for (let i = 0; i < count; i += 1) { starts.unshift(cursor); cursor = addDays(cursor, -7); }

  return starts.map((weekStart) => {
    const weekEnd = addDays(weekStart, 6);
    const inWeek = (date: string) => date >= weekStart && date <= weekEnd;
    const ramped = (userId: number) => {
      const first = firstDay.get(userId);
      return !!first && addDays(first, PACE_RAMP_DAYS) <= weekStart;
    };

    // Days worked, by person, so one person's short week is short rather than
    // dragging a whole five days of denominator behind it.
    const worked = new Map<number, number>();
    days.forEach((row) => {
      if (!inWeek(row.date) || !isWeekday(row.date) || !ramped(row.userId)) return;
      const key = `${row.userId}:${row.date}`;
      const halfSet = halfDays.has(key) ? new Set([row.userId]) : new Set<number>();
      const fullOffSet = fullOffDays.has(key) ? new Set([row.userId]) : new Set<number>();
      const weight = paceDayWeight({
        userId: row.userId,
        date: row.date,
        today,
        halfDayUserIds: halfSet,
        fullOffUserIds: fullOffSet,
        excluded,
        todayWeight: PACE_TODAY_WEIGHT,
      });
      if (weight <= 0) return;
      worked.set(row.userId, (worked.get(row.userId) ?? 0) + weight);
    });

    // Credited transfers this week, by person (before quiet drop).
    const creditByUser = new Map<number, number>();
    credits.forEach((row) => {
      if (!inWeek(row.date) || !worked.has(row.userId)) return;
      if (excluded.some((e) => e.userId === row.userId && e.date === row.date)) return;
      const n = Number(row.credit) || 0;
      if (n === 0) return;
      creditByUser.set(row.userId, (creditByUser.get(row.userId) ?? 0) + n);
    });

    // Quiet week: no credited transfers → out of clrDays, unless from-date
    // keep list (Jordon Mon–Tue at 0 credit by design).
    for (const userId of [...worked.keys()]) {
      if ((creditByUser.get(userId) ?? 0) > 0) continue;
      if (keepZero.has(userId)) continue;
      worked.delete(userId);
    }

    let clrDays = 0;
    worked.forEach((n) => { clrDays += n; });
    let transfers = 0;
    creditByUser.forEach((n, userId) => {
      if (!worked.has(userId)) return;
      transfers += n;
    });

    return {
      weekStart,
      label: weekLabel(weekStart),
      clrs: worked.size,
      clrDays: Math.round(clrDays * 10) / 10,
      transfers: Math.round(transfers * 10) / 10,
      perClrPerDay: clrDays > 0 ? Math.round((transfers / clrDays) * 100) / 100 : null,
      partial: weekEnd >= today,
    };
  });
}

/** The average of the completed weeks — what "normal" currently is. */
export function completedAverage(weeks: ReadonlyArray<PaceWeek>, last = 4): number | null {
  const done = weeks.filter((w) => !w.partial && w.perClrPerDay != null).slice(-last);
  if (!done.length) return null;
  let total = 0;
  done.forEach((w) => { total += w.perClrPerDay as number; });
  return Math.round((total / done.length) * 100) / 100;
}
