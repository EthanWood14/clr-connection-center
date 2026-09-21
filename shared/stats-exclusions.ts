/**
 * Transfer-CREDIT exclusions shared by every board that scores people:
 * TV transfers / pace / day-race, scorecards, lifetime & workday rates,
 * Ask C3, agent-stats, tournament, digests.
 *
 * Ethan via LoanWick — two credit rules, one module:
 *  1. Jordon Chang — no credit 2026-09-16 through 2026-09-20 PT inclusive
 *     (Jordan Chang spelling included; demo LO "Jordan Rivera" is not matched).
 *     Pre-9/16 and from 9/21 onward credit him normally. Do NOT flip
 *     exclude_from_stats.
 *  2. Approved FULL day off — no credit that calendar date.
 *
 * Half days (approved leave day_portion=half AND standing Rosas weekdays) keep
 * transfer CREDIT on the boards; they only weigh 0.5 in rate denominators /
 * goal proration (shared/half-day.ts). Wiping credit on half blanked standing
 * half-day CLRs (Rosas) permanently — fixed 4.122.36.
 *
 * Elleine stays on her existing always-off patterns — do not break those.
 */
export type StatsFromDateExclusion = {
  nameRe: RegExp;
  /** Inclusive Pacific calendar day "YYYY-MM-DD". */
  fromDate: string;
  /** Inclusive end day; omit for open-ended (fromDate forward). */
  toDate?: string;
  reason: string;
};

/** Whole-word jordon, or "jordan chang" — not "Jordan Rivera". */
export const JORDON_STATS_NAME_RE = /\bjordon\b|\bjordan\s+chang\b/i;

export const STATS_EXCLUDED_FROM: readonly StatsFromDateExclusion[] = [
  {
    nameRe: JORDON_STATS_NAME_RE,
    fromDate: "2026-09-16",
    toDate: "2026-09-20",
    reason: "Ethan via LoanWick: Jordon excluded 2026-09-16 through 2026-09-20 PT inclusive; back on team credit from 2026-09-21",
  },
];

export function matchesStatsExcludedName(
  name: string | null | undefined,
  rule: StatsFromDateExclusion = STATS_EXCLUDED_FROM[0]!,
): boolean {
  return rule.nameRe.test(String(name ?? "").trim());
}

/** True when day falls in a name/from–to window (Jordon). Invalid/missing date does not exclude. */
export function isStatsExcluded(
  name: string | null | undefined,
  date: string | null | undefined,
): boolean {
  const day = String(date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const n = String(name ?? "").trim();
  for (const rule of STATS_EXCLUDED_FROM) {
    if (!rule.nameRe.test(n)) continue;
    if (day < rule.fromDate) continue;
    if (rule.toDate && day > rule.toDate) continue;
    return true;
  }
  return false;
}

export type ResolvedStatsExclusion = {
  userId: number;
  fromDate: string;
  toDate?: string;
  name: string;
  reason: string;
};

export function resolveStatsExcludedUsers(
  users: ReadonlyArray<{ id: number; name?: string | null }>,
): ResolvedStatsExclusion[] {
  const out: ResolvedStatsExclusion[] = [];
  for (const rule of STATS_EXCLUDED_FROM) {
    for (const u of users) {
      const name = String(u.name ?? "");
      if (!rule.nameRe.test(name.trim())) continue;
      const userId = Number(u.id);
      if (!Number.isSafeInteger(userId) || userId <= 0) continue;
      out.push({
        userId,
        fromDate: rule.fromDate,
        ...(rule.toDate ? { toDate: rule.toDate } : {}),
        name,
        reason: rule.reason,
      });
    }
  }
  return out;
}

export function isUserStatsExcluded(
  userId: number,
  date: string | null | undefined,
  resolved: ReadonlyArray<ResolvedStatsExclusion>,
): boolean {
  const day = String(date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return resolved.some(
    (r) =>
      r.userId === Number(userId) &&
      day >= r.fromDate &&
      !(r.toDate && day > r.toDate),
  );
}

export function eachIsoDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  if (!from || !to || from > to) return out;
  let d = from;
  while (d <= to) {
    out.push(d);
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return out;
}

/** Parse `${userId}:${YYYY-MM-DD}` keys used by halfDays / fullOffDays sets. */
export function parsePersonDayKey(key: string): { userId: number; date: string } | null {
  const m = /^(\d+):(\d{4}-\d{2}-\d{2})$/.exec(String(key ?? "").trim());
  if (!m) return null;
  return { userId: Number(m[1]), date: m[2]! };
}

/**
 * Person-days whose transfer CREDIT must be dropped on score/pace boards:
 * Jordon from–to window + every full-off key + extras (Jeremy).
 * Half-day keys are NOT credit-excluded (denom 0.5 only) — see 4.122.36.
 * `halfDays` is accepted but ignored so callers need not change overnight.
 */
export function buildCreditExcludedPersonDays(input: {
  users: ReadonlyArray<{ id: number; name?: string | null }>;
  from: string;
  to: string;
  /** Ignored for credit — half days keep transfers (4.122.36). */
  halfDays?: ReadonlySet<string> | null;
  fullOffDays?: ReadonlySet<string> | null;
  extra?: ReadonlyArray<{ userId: number; date: string }> | null;
}): Array<{ userId: number; date: string }> {
  const seen = new Set<string>();
  const out: Array<{ userId: number; date: string }> = [];
  const add = (userId: number, date: string) => {
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (date < input.from || date > input.to) return;
    const k = `${userId}:${date}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ userId, date });
  };

  for (const r of resolveStatsExcludedUsers(input.users)) {
    const start = input.from > r.fromDate ? input.from : r.fromDate;
    const endCap = r.toDate && r.toDate < input.to ? r.toDate : input.to;
    if (start > endCap) continue;
    for (const date of eachIsoDateInclusive(start, endCap)) add(r.userId, date);
  }
  void input.halfDays; // half days keep credit; weight handled in half-day.ts
  for (const key of input.fullOffDays ?? []) {
    const p = parsePersonDayKey(key);
    if (p) add(p.userId, p.date);
  }
  for (const e of input.extra ?? []) add(Number(e.userId), String(e.date));
  return out;
}

export function creditExcludedDayKeys(
  days: ReadonlyArray<{ userId: number; date: string }>,
): Set<string> {
  return new Set(days.map((d) => `${d.userId}:${d.date}`));
}

export function isCreditExcludedPersonDay(
  userId: number,
  date: string,
  excludedKeys: ReadonlySet<string>,
): boolean {
  return excludedKeys.has(`${Number(userId)}:${String(date)}`);
}

export function filterCreditRows<T extends { userId?: unknown; user_id?: unknown; date?: unknown }>(
  rows: ReadonlyArray<T>,
  opts: {
    nameByUserId?: ReadonlyMap<number, string>;
    excludedKeys?: ReadonlySet<string>;
  } = {},
): T[] {
  return (rows ?? []).filter((row) => {
    const userId = Number(row.userId ?? row.user_id);
    const date = String(row.date ?? "");
    if (opts.excludedKeys && isCreditExcludedPersonDay(userId, date, opts.excludedKeys)) return false;
    if (opts.nameByUserId && isStatsExcluded(opts.nameByUserId.get(userId), date)) return false;
    return true;
  });
}

/**
 * SQL AND-fragment: drop Jordon (from-date) credit. Requires `users(id,name)`.
 * Mirrors JORDON_STATS_NAME_RE in SQLite LIKE form — keep in sync (tests).
 */
export function jordonCreditExclusionSql(
  dateCol: string = "tc.date",
  userIdCol: string = "tc.user_id",
): string {
  const fromDate = STATS_EXCLUDED_FROM[0]?.fromDate ?? "2026-09-16";
  const toDate = STATS_EXCLUDED_FROM[0]?.toDate;
  const upper = toDate ? `AND ${dateCol} <= '${toDate}'` : "";
  return `NOT (
    ${dateCol} >= '${fromDate}'
    ${upper}
    AND ${userIdCol} IN (
      SELECT id FROM users WHERE
        (' ' || lower(COALESCE(name, '')) || ' ') LIKE '% jordon %'
        OR replace(lower(COALESCE(name, '')), ' ', '') LIKE '%jordanchang%'
    )
  )`;
}

/**
 * SQL AND-fragment: drop credit on approved FULL time-off days only.
 * Half days (day_portion=half) and standing Rosas weekdays KEEP credit —
 * they only weigh 0.5 in denominators (4.122.36). Requires `time_off_requests`.
 */
export function timeOffCreditExclusionSql(
  dateCol: string = "tc.date",
  userIdCol: string = "tc.user_id",
  orgCol: string | null = "tc.org_id",
): string {
  const orgMatch = orgCol ? `AND (r.org_id = ${orgCol} OR r.org_id IS NULL)` : "";
  return `NOT (
    EXISTS (
      SELECT 1 FROM time_off_requests r
       WHERE r.user_id = ${userIdCol}
         AND r.status = 'approved'
         AND COALESCE(r.day_portion, 'full') != 'half'
         AND r.start_date <= ${dateCol}
         AND r.end_date >= ${dateCol}
         ${orgMatch}
    )
  )`;
}

/** Combined credit-exclusion SQL for TRANSFER_CREDIT_SQL consumers. */
export function transferCreditExclusionSql(
  dateCol: string = "tc.date",
  userIdCol: string = "tc.user_id",
  orgCol: string | null = "tc.org_id",
): string {
  return `(${jordonCreditExclusionSql(dateCol, userIdCol)}) AND (${timeOffCreditExclusionSql(dateCol, userIdCol, orgCol)})`;
}
