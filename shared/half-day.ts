/**
 * Day availability weights for rates and goal proration.
 *
 * A half day:
 *  - is still approved time off (shows on Time Off, excuses absence when they
 *    never check in)
 *  - still gets daily LO assignments (full days are the ones taken off the
 *    rotation — "still gives them a LO")
 *  - halves that person's day weight in every /day rate and in goal proration
 *  - does not mark them late on check-in
 *
 * A full day off ("no day"):
 *  - approved time_off with day_portion=full (or non-half)
 *  - weight 0 for ALL rate denominators and goal proration — even if a check-in,
 *    dialpad row, EOD, etc. leaked into the activity union that day
 *
 * Standing half days (Rosas) and seeded one-offs are matched by roster name so
 * a rename is visible in one place rather than a stale user id.
 *
 * Prefer dayAvailabilityWeight / sumAvailabilityPortions /
 * sumWorkedAvailabilityPortions at every call site so weights cannot drift.
 */

/** Day weight applied to a half day in rate denominators and goal proration. */
export const HALF_DAY_WEIGHT = 0.5;

/** Full approved time off ("no day") — never counts toward days worked / goals. */
export const FULL_DAY_OFF_WEIGHT = 0;

export type DayPortion = "full" | "half";

/** How the absence was classified when recorded (scorecard still keys off day_portion). */
export type LeaveKind = "half" | "pto" | "sick_documented" | "sick_undocumented";

export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = {
  half: "Half day",
  pto: "Day off",
  sick_documented: "Documented sick",
  sick_undocumented: "Undocumented sick",
};

export function normalizeLeaveKind(raw: unknown): LeaveKind {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "half" || s === "half_day" || s === "pto_half") return "half";
  if (s === "sick_documented" || s === "documented_sick" || s === "sick_doc") return "sick_documented";
  if (s === "sick_undocumented" || s === "undocumented_sick" || s === "sick_undoc" || s === "sick") return "sick_undocumented";
  if (s === "pto" || s === "full" || s === "full_pto" || s === "vacation" || s === "pto_full") return "pto";
  return "pto";
}

/** day_portion for rates: only "half" is 0.5; PTO + both sick kinds are full-day (weight 0 when approved). */
export function dayPortionForLeaveKind(kind: LeaveKind): DayPortion {
  return kind === "half" ? "half" : "full";
}

export function parseLeaveKindBody(body: any): LeaveKind | null {
  const raw = body?.leaveKind ?? body?.leave_kind ?? body?.kind ?? null;
  if (raw == null || raw === "") return null;
  return normalizeLeaveKind(raw);
}


/**
 * Sets keyed as `${userId}:${YYYY-MM-DD}` (see halfDayKey).
 * Full day off and exclusions both force weight 0; full off wins over activity.
 */
export type DayAvailabilityContext = {
  halfDays?: ReadonlySet<string> | null;
  /** Approved full-day time off ("no days"). */
  fullOffDays?: ReadonlySet<string> | null;
  /** Weight-0 person-days: Jeremy one-offs + STATS_EXCLUDED_FROM (Jordon…). */
  excludedDays?: ReadonlySet<string> | null;
};

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

/** Key used in halfDays / fullOffDays / excludedDays sets: `${userId}:${YYYY-MM-DD}`. */
export function halfDayKey(userId: number, date: string): string {
  return `${userId}:${date}`;
}

export function excludedDayKeys(
  excluded: ReadonlyArray<{ userId: number; date: string }> | null | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const e of excluded ?? []) {
    const userId = Number(e.userId);
    const date = String(e.date ?? "");
    if (Number.isFinite(userId) && date) out.add(halfDayKey(userId, date));
  }
  return out;
}

/**
 * Normalize a legacy halfDays Set OR a full DayAvailabilityContext into one
 * context object so call sites cannot drift on argument order.
 */
export function asAvailabilityContext(
  halfDaysOrCtx?: ReadonlySet<string> | DayAvailabilityContext | null,
  fullOffDays?: ReadonlySet<string> | null,
  excludedDays?: ReadonlySet<string> | null,
): DayAvailabilityContext {
  if (
    halfDaysOrCtx &&
    typeof halfDaysOrCtx === "object" &&
    !(halfDaysOrCtx instanceof Set) &&
    ("halfDays" in halfDaysOrCtx || "fullOffDays" in halfDaysOrCtx || "excludedDays" in halfDaysOrCtx)
  ) {
    return halfDaysOrCtx as DayAvailabilityContext;
  }
  return {
    halfDays: (halfDaysOrCtx as ReadonlySet<string> | null | undefined) ?? null,
    fullOffDays: fullOffDays ?? null,
    excludedDays: excludedDays ?? null,
  };
}

/**
 * Single day-weight model for rates and goal proration (not weekly-pace today
 * discount — that stays in paceDayWeight):
 *   - excluded person-day → 0
 *   - full approved time off → 0 ("no day"), even if activity leaked
 *   - half day (approved or standing) → 0.5
 *   - otherwise → 1
 */
export function dayAvailabilityWeight(
  userId: number,
  date: string,
  ctx?: DayAvailabilityContext | null,
): number {
  const key = halfDayKey(userId, date);
  if (ctx?.excludedDays?.has(key)) return FULL_DAY_OFF_WEIGHT;
  if (ctx?.fullOffDays?.has(key)) return FULL_DAY_OFF_WEIGHT;
  if (ctx?.halfDays?.has(key)) return HALF_DAY_WEIGHT;
  return 1;
}

/**
 * Weight of one worked calendar date for transfers/day denominators.
 * Accepts a halfDays Set (legacy) or a full DayAvailabilityContext.
 * Does not apply the weekly-pace "today is unfinished" discount — callers that
 * need that use paceDayWeight.
 */
export function dayPortionWeight(
  userId: number,
  date: string,
  halfDaysOrCtx?: ReadonlySet<string> | DayAvailabilityContext | null,
  fullOffDays?: ReadonlySet<string> | null,
): number {
  return dayAvailabilityWeight(userId, date, asAvailabilityContext(halfDaysOrCtx, fullOffDays));
}

/** Sum of availability weights over distinct dates for one user (1dp). */
export function sumAvailabilityPortions(
  userId: number,
  dates: Iterable<string>,
  ctx?: DayAvailabilityContext | null,
): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const raw of dates) {
    const date = String(raw ?? "");
    if (!date || seen.has(date)) continue;
    seen.add(date);
    sum += dayAvailabilityWeight(userId, date, ctx);
  }
  return Math.round(sum * 10) / 10;
}

/** @deprecated Prefer sumAvailabilityPortions — same math, clearer name. */
export function sumDayPortions(
  userId: number,
  dates: Iterable<string>,
  halfDaysOrCtx?: ReadonlySet<string> | DayAvailabilityContext | null,
  fullOffDays?: ReadonlySet<string> | null,
): number {
  return sumAvailabilityPortions(userId, dates, asAvailabilityContext(halfDaysOrCtx, fullOffDays));
}

/**
 * Sum availability weights per user from (userId, date) rows. Duplicate dates
 * for the same user are ignored (first wins). Full-day off → 0 even when the
 * activity union listed that day.
 */
export function sumWorkedAvailabilityPortions(
  rows: ReadonlyArray<{ userId: number; date: string }>,
  ctx?: DayAvailabilityContext | null,
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
    out.set(userId, (out.get(userId) ?? 0) + dayAvailabilityWeight(userId, date, ctx));
  }
  out.forEach((v, k) => out.set(k, Math.round(v * 10) / 10));
  return out;
}

/** @deprecated Prefer sumWorkedAvailabilityPortions. */
export function sumWorkedDayPortions(
  rows: ReadonlyArray<{ userId: number; date: string }>,
  halfDaysOrCtx?: ReadonlySet<string> | DayAvailabilityContext | null,
  fullOffDays?: ReadonlySet<string> | null,
): Map<number, number> {
  return sumWorkedAvailabilityPortions(rows, asAvailabilityContext(halfDaysOrCtx, fullOffDays));
}

function addIsoDaysUtc(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isWeekdayIso(iso: string): boolean {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * Available weekday portions in [from, to] inclusive for goal proration.
 * Every Mon–Fri starts at weight 1; full offs → 0, half → 0.5, exclusions → 0.
 * Unlike rate denominators, this does NOT require activity on the day.
 */
export function availableWeekdayPortions(
  userId: number,
  from: string,
  to: string,
  ctx?: DayAvailabilityContext | null,
): number {
  if (!from || !to || from > to) return 0;
  let sum = 0;
  for (let d = from; d <= to; ) {
    if (isWeekdayIso(d)) sum += dayAvailabilityWeight(userId, d, ctx);
    d = addIsoDaysUtc(d, 1);
  }
  return Math.round(sum * 10) / 10;
}

/**
 * Prorate a weekly goal by available weekday portions in the MTD window.
 * `goal = weeklyGoal * (availablePortions / 5)`.
 */
export function prorateWeeklyGoal(weeklyGoal: number, availablePortions: number): number {
  const weekly = Number(weeklyGoal) || 0;
  if (weekly <= 0 || availablePortions <= 0) return 0;
  return Math.round(weekly * (availablePortions / 5));
}

/** weeksElapsed equivalent: availablePortions / 5 (1dp). */
export function weeksElapsedFromPortions(availablePortions: number): number {
  if (availablePortions <= 0) return 0;
  return Math.round((availablePortions / 5) * 10) / 10;
}

/**
 * Day weight for weekly pace: availability weight, then today's unfinished-day
 * discount. Exclusions / full offs → 0. Half day halves whatever the day would
 * have counted as (including today → 0.25 when todayWeight is 0.5).
 */
export function paceDayWeight(input: {
  userId: number;
  date: string;
  today: string;
  halfDayUserIds?: ReadonlySet<number>;
  fullOffUserIds?: ReadonlySet<number>;
  excluded?: ReadonlyArray<{ userId: number; date: string }>;
  /** Optional full context — preferred when available. */
  availability?: DayAvailabilityContext | null;
  /** Today's unfinished-day weight from weekly-pace (usually 0.5). */
  todayWeight?: number;
}): number {
  const key = halfDayKey(input.userId, input.date);
  const excluded = input.excluded ?? [];
  const ctx: DayAvailabilityContext = input.availability ?? {
    halfDays: input.halfDayUserIds?.has(input.userId) ? new Set([key]) : null,
    fullOffDays: input.fullOffUserIds?.has(input.userId) ? new Set([key]) : null,
    excludedDays: excludedDayKeys(excluded),
  };
  // When using halfDayUserIds path, still honor excluded array.
  if (!input.availability && excluded.some((e) => e.userId === input.userId && e.date === input.date)) {
    return FULL_DAY_OFF_WEIGHT;
  }
  const base = dayAvailabilityWeight(input.userId, input.date, ctx);
  if (base <= 0) return FULL_DAY_OFF_WEIGHT;
  const todayWeight = input.todayWeight ?? 0.5;
  return input.date === input.today ? base * todayWeight : base;
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
