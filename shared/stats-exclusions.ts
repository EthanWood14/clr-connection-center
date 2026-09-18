/**
 * Transfer-CREDIT exclusions shared by every board that scores people:
 * TV transfers / pace / day-race, scorecards, lifetime & workday rates,
 * Ask C3, agent-stats, tournament, digests.
 *
 * Ethan via LoanWick, 18 Sep 2026 — three rules, one module:
 *  1. Jordon Chang — no credit from 2026-09-16 PT inclusive forward
 *     (Jordan Chang spelling included; demo LO "Jordan Rivera" is not matched).
 *     Pre-that-date history still credits him. Do NOT flip exclude_from_stats.
 *  2. Approved FULL day off — no credit that calendar date.
 *  3. Approved HALF day AND standing half-day rules (Rosas) — also no credit
 *     that calendar date on the boards above (same as full PTO for credit).
 *     A 0.5 day-portion weight may still apply to display-only availability /
 *     goal proration elsewhere; it must not keep half-day credit on the boards.
 *
 * Elleine stays on her existing always-off patterns — do not break those.
 */
export type StatsFromDateExclusion = {
  nameRe: RegExp;
  /** Inclusive Pacific calendar day "YYYY-MM-DD". */
  fromDate: string;
  reason: string;
};

/** Whole-word jordon, or "jordan chang" — not "Jordan Rivera". */
export const JORDON_STATS_NAME_RE = /\bjordon\b|\bjordan\s+chang\b/i;

export const STATS_EXCLUDED_FROM: readonly StatsFromDateExclusion[] = [
  {
    nameRe: JORDON_STATS_NAME_RE,
    fromDate: "2026-09-16",
    reason: "Ethan via LoanWick: Jordon must not count since Wednesday (2026-09-16 PT) for all stats",
  },
];

export function matchesStatsExcludedName(
  name: string | null | undefined,
  rule: StatsFromDateExclusion = STATS_EXCLUDED_FROM[0]!,
): boolean {
  return rule.nameRe.test(String(name ?? "").trim());
}

/** Name/from-date rule only (Jordon). Invalid/missing date does not exclude. */
export function isStatsExcluded(
  name: string | null | undefined,
  date: string | null | undefined,
): boolean {
  const day = String(date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const n = String(name ?? "").trim();
  for (const rule of STATS_EXCLUDED_FROM) {
    if (day >= rule.fromDate && rule.nameRe.test(n)) return true;
  }
  return false;
}

export type ResolvedStatsExclusion = {
  userId: number;
  fromDate: string;
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
      out.push({ userId, fromDate: rule.fromDate, name, reason: rule.reason });
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
  return resolved.some((r) => r.userId === Number(userId) && day >= r.fromDate);
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
 * Jordon from-date + every half-day key + every full-off key + extras (Jeremy).
 */
export function buildCreditExcludedPersonDays(input: {
  users: ReadonlyArray<{ id: number; name?: string | null }>;
  from: string;
  to: string;
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
    for (const date of eachIsoDateInclusive(start, input.to)) add(r.userId, date);
  }
  for (const key of input.halfDays ?? []) {
    const p = parsePersonDayKey(key);
    if (p) add(p.userId, p.date);
  }
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
  return `NOT (
    ${dateCol} >= '${fromDate}'
    AND ${userIdCol} IN (
      SELECT id FROM users WHERE
        (' ' || lower(COALESCE(name, '')) || ' ') LIKE '% jordon %'
        OR replace(lower(COALESCE(name, '')), ' ', '') LIKE '%jordanchang%'
    )
  )`;
}

/**
 * SQL AND-fragment: drop credit on approved half OR full time-off days, and on
 * standing half-day roster matches (Rosas) Mon–Fri. Requires `time_off_requests`
 * + `users`.
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
         AND r.start_date <= ${dateCol}
         AND r.end_date >= ${dateCol}
         ${orgMatch}
    )
    OR (
      CAST(strftime('%w', ${dateCol}) AS INTEGER) BETWEEN 1 AND 5
      AND ${userIdCol} IN (
        SELECT id FROM users WHERE lower(COALESCE(name, '')) LIKE '%rosas%'
      )
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
