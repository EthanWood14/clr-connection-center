/**
 * Half-day time off and one-off pace exclusions.
 *
 * A half day:
 *  - is still approved time off (shows on Time Off, excuses absence when they
 *    never check in)
 *  - still gets daily LO assignments (full days are the ones taken off the
 *    rotation — "still gives them a LO")
 *  - halves that person's day weight in transfers/day (weekly pace, scorecard,
 *    CLR stats, reporting) — days worked = sum of day portions (full=1, half=0.5)
 *  - does not mark them late on check-in
 *
 * Standing half days (Rosas) and seeded one-offs are matched by roster name so
 * a rename is visible in one place rather than a stale user id.
 */

/** Day weight applied to a half day in the transfers/day denominator. */
export const HALF_DAY_WEIGHT = 0.5;

export type DayPortion = "full" | "half";

export function normalizeDayPortion(raw: unknown): DayPortion {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "half" || s === "half_day" || s === "0.5" ? "half" : "full";
}

export function isHalfDayPortion(raw: unknown): boolean {
  return normalizeDayPortion(raw) === "half";
}

/** Match roster display names carefully — first/last tokens Ethan used. */
export const ROSTER_NAME = {
  /** Jeremy Lapiz — exclude 2026-09-17 from transfers/day. */
  jeremy: /\bjeremy\b/i,
  /** Jacqueline ("Jackie" in Ethan's ask). */
  jackie: /\bjacqueline\b|\bjackie\b/i,
  /** Chris Bermudez / Cristopher Bermudez — not Chris Redoble (LO). */
  chris: /\bbermudez\b/i,
  /** Matthew Rosas — standing half day every weekday. */
  rosas: /\brosas\b/i,
} as const;

export type NamedPersonDay = {
  /** Which roster matcher to use. */
  who: keyof typeof ROSTER_NAME;
  date: string;
  reason: string;
};

/** One-off pace exclusions: drop the person-day from transfers/day entirely. */
export const PACE_EXCLUDED_PERSON_DAYS: readonly NamedPersonDay[] = [
  {
    who: "jeremy",
    date: "2026-09-17",
    reason: "Ethan: exclude Jeremy's day from transfers/day (PT)",
  },
];

/** Seeded half-day marks (approved time-off rows, day_portion=half). */
export const SEEDED_HALF_DAYS: readonly NamedPersonDay[] = [
  { who: "jackie", date: "2026-09-17", reason: "Half day (seeded 2026-09-17 PT)" },
  { who: "chris", date: "2026-09-18", reason: "Half day (seeded 2026-09-18 PT)" },
];

/** Standing half day every weekday — Rosas. */
export const STANDING_HALF_DAY_WHO: ReadonlyArray<keyof typeof ROSTER_NAME> = ["rosas"];

export function nameMatchesWho(name: string | null | undefined, who: keyof typeof ROSTER_NAME): boolean {
  return ROSTER_NAME[who].test(String(name ?? "").trim());
}

export function resolveRosterUserIds(
  users: ReadonlyArray<{ id: number; name?: string | null }>,
  who: keyof typeof ROSTER_NAME,
): number[] {
  return users
    .filter((u) => nameMatchesWho(u.name, who))
    .map((u) => Number(u.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function standingHalfDayUserIds(
  users: ReadonlyArray<{ id: number; name?: string | null }>,
): Set<number> {
  const ids = new Set<number>();
  for (const who of STANDING_HALF_DAY_WHO) {
    for (const id of resolveRosterUserIds(users, who)) ids.add(id);
  }
  return ids;
}

/** Key used in halfDays sets: `${userId}:${YYYY-MM-DD}`. */
export function halfDayKey(userId: number, date: string): string {
  return `${userId}:${date}`;
}

/**
 * Weight of one worked calendar date for transfers/day denominators.
 * Full day = 1, half day = HALF_DAY_WEIGHT. Does not apply the weekly-pace
 * "today is unfinished" discount — callers that need that use paceDayWeight.
 */
export function dayPortionWeight(
  userId: number,
  date: string,
  halfDays?: ReadonlySet<string> | null,
): number {
  if (halfDays?.has(halfDayKey(userId, date))) return HALF_DAY_WEIGHT;
  return 1;
}

/** Sum of day portions over distinct dates for one user (1dp). */
export function sumDayPortions(
  userId: number,
  dates: Iterable<string>,
  halfDays?: ReadonlySet<string> | null,
): number {
  let sum = 0;
  for (const date of dates) sum += dayPortionWeight(userId, String(date), halfDays);
  return Math.round(sum * 10) / 10;
}

/**
 * Sum day portions per user from (userId, date) rows. Duplicate dates for the
 * same user are ignored (first wins), matching COUNT(DISTINCT day) semantics
 * with half-day weights.
 */
export function sumWorkedDayPortions(
  rows: ReadonlyArray<{ userId: number; date: string }>,
  halfDays?: ReadonlySet<string> | null,
): Map<number, number> {
  const seen = new Map<number, Set<string>>();
  const out = new Map<number, number>();
  for (const row of rows) {
    const userId = Number(row.userId);
    const date = String(row.date ?? "");
    if (!Number.isFinite(userId) || !date) continue;
    let dates = seen.get(userId);
    if (!dates) { dates = new Set(); seen.set(userId, dates); }
    if (dates.has(date)) continue;
    dates.add(date);
    out.set(userId, (out.get(userId) ?? 0) + dayPortionWeight(userId, date, halfDays));
  }
  out.forEach((v, k) => out.set(k, Math.round(v * 10) / 10));
  return out;
}

/**
 * Day weight for weekly pace: 1, HALF_DAY_WEIGHT, or 0 when the person-day is
 * excluded. `halfDayUserIds` are people on approved half-day time off that day
 * (or standing half-day). Exclusions win over half-day.
 */
export function paceDayWeight(input: {
  userId: number;
  date: string;
  today: string;
  halfDayUserIds?: ReadonlySet<number>;
  excluded?: ReadonlyArray<{ userId: number; date: string }>;
  /** Today's unfinished-day weight from weekly-pace (usually 0.5). */
  todayWeight?: number;
}): number {
  const excluded = input.excluded ?? [];
  if (excluded.some((e) => e.userId === input.userId && e.date === input.date)) return 0;
  const todayWeight = input.todayWeight ?? 0.5;
  let weight = input.date === input.today ? todayWeight : 1;
  if (input.halfDayUserIds?.has(input.userId)) {
    // Half day halves whatever the day would have counted as (including today).
    weight *= HALF_DAY_WEIGHT;
  }
  return weight;
}

export function buildPaceExclusions(
  users: ReadonlyArray<{ id: number; name?: string | null }>,
  rules: ReadonlyArray<NamedPersonDay> = PACE_EXCLUDED_PERSON_DAYS,
): Array<{ userId: number; date: string; who: string; reason: string }> {
  const out: Array<{ userId: number; date: string; who: string; reason: string }> = [];
  for (const rule of rules) {
    for (const userId of resolveRosterUserIds(users, rule.who)) {
      out.push({ userId, date: rule.date, who: rule.who, reason: rule.reason });
    }
  }
  return out;
}
