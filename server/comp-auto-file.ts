/**
 * Monthly transfer comp, filed by the machine instead of by the CLR.
 *
 * Two rules live here, and both of them decide what a person is asked to be
 * paid:
 *
 *  1. On the 2nd of each month, file last month's transfer comp request for
 *     every CLR who has not already filed one themselves.
 *  2. From transfer month October 2026 onward, the three CLRs with the best
 *     write-up percentage get +10% and the three worst get -10%; the same
 *     again, independently, on the transfer-placement score. Only CLRs with
 *     at least 37.5 transfers that month are ranked at all.
 *
 * Everything in this file is arithmetic over plain values — no database, no
 * cron, no imports from routes.ts — the same shape as server/tv-pages.ts, so
 * every rule above can be tested without booting the server.
 *
 * WIRING (deliberately not done in this pass). When this is hooked up, the
 * caller must mirror processRecurringComp() in server/routes.ts exactly:
 *
 *   for each period in autoFileDuePeriods(businessToday, ledger.lastFiledPeriod):
 *     load the month's stats + that month's existing comp_requests
 *     plan = planTransferCompAutoFile({ period, today, stats, existing })
 *     ONE db.transaction():
 *       UPDATE ledger SET last_filed_period=? WHERE ... AND last_filed_period != ?
 *       if claimed.changes !== 1 -> bail (a concurrent tick already has it)
 *       INSERT each plan.file row into comp_requests
 *     then: audit log, notification, approver email
 *
 * The claim and the INSERTs must share one transaction for the same reason
 * they do there: a stamp that sticks without the rows means a month silently
 * never files, and a month that never files is a person not getting paid.
 *
 * The placement score (server/transfer-priority.ts) is taken as a plain input.
 * It is being reworked, so nothing here imports it or assumes how it is built
 * — only that a HIGHER score is better (PLACEMENT_SCORE_HIGHER_IS_BETTER).
 */
import { resolveEmailTransferCompRateCents } from "./comp-rate";

// ── what a transfers request is ─────────────────────────────────────────────

/** The comp category these requests are filed under. */
export const TRANSFER_COMP_CATEGORY = "transfers";

/**
 * Older category keys that display as Transfers (server/routes.ts ~9288).
 * Read only — nothing new is ever filed under these. They are here so an old
 * row still counts as "already submitted" and cannot be double-filed.
 */
export const LEGACY_TRANSFER_COMP_CATEGORIES: string[] = ["leads", "appointments"];

/**
 * Statuses that mean "this month is spoken for".
 *
 * `denied` is in the list on purpose: a human already looked at that ask and
 * said no, and re-filing an identical request automatically would re-ask a
 * question that was answered. A CLR whose request was denied for being wrong
 * re-files it themselves. `draft` is in the list because a draft is a CLR
 * mid-way through filing, and filing underneath them creates the duplicate.
 */
export const COVERING_STATUSES: string[] = ["draft", "pending", "approved", "denied"];

// ── when it files ───────────────────────────────────────────────────────────

/** The day of the month the previous month's request is due. Ethan: "the 2nd". */
export const AUTO_FILE_DAY_OF_MONTH = 2;

/**
 * How far back a late run will reach.
 *
 * A missed tick (server down, a deploy over the month boundary) must still
 * file — on the 3rd, on the 10th, or the following month if that is when the
 * process next runs. The cap bounds the blast radius of a very stale ledger:
 * a box that has been off for half a year files the last three months, not
 * six, and the rest is a human decision.
 */
export const AUTO_FILE_CATCHUP_MONTHS = 3;

/**
 * The first transfer month this may ever file for.
 *
 * Without a floor, the first run on a fresh ledger would try to back-file
 * history that was already paid by hand. September 2026 is the first month
 * that ends after this code exists.
 */
export const AUTO_FILE_EARLIEST_PERIOD = "2026-09";

/** Below this, nothing is filed — a $0.00 request is noise, not pay. */
export const AUTO_FILE_MIN_TRANSFERS = 1;

// ── the bumps ───────────────────────────────────────────────────────────────

/** Ethan: "starting for the transfer month of october". Earlier months file flat. */
export const BUMP_EFFECTIVE_FROM_PERIOD = "2026-10";

/**
 * Transfers needed to be ranked at all. Ethan: "37.5 transfers or more".
 *
 * Transfer counts are whole numbers, so the half is what makes the line
 * unambiguous: 37 is out, 38 is in, and nobody sits exactly on it. Below the
 * line a CLR is neither bumped up nor down — a light month should not earn a
 * +/-10% verdict off a handful of write-ups.
 */
export const BUMP_MIN_TRANSFERS = 37.5;

/** "the 3 CLR's with the highest ... with the 3 worst ...". */
export const BUMP_GROUP_SIZE = 3;

/**
 * The smallest pool that can name a top 3 and a bottom 3 at all.
 *
 * With five eligible CLRs the two groups overlap and the same person is both
 * best and worst. Rather than invent a rule for that, no one is bumped: the
 * month files flat and the note says why.
 */
export const BUMP_MIN_POOL = BUMP_GROUP_SIZE * 2;

/** One bump, in basis points of the BASE amount. 1000 bps = 10%. */
export const BUMP_STEP_BPS = 1000;

/**
 * NOT COMPOUNDING — Ethan's word — read as ADDITIVE ON THE BASE.
 *
 * In plain words: each bump is worth 10% OF THE BASE AMOUNT, and they are
 * added together before the money is worked out. Top 3 on both metrics is
 * +20% of base (not 1.1 x 1.1 = +21%). Top 3 on one and bottom 3 on the other
 * is exactly the base. The worst case is -20%.
 *
 * If Ethan meant the other reading — apply one bump, then the second to the
 * already-bumped figure — this constant and applyBumps() are the one-line
 * change, and nothing else in this file needs to move.
 */
export const BUMP_COMBINE: "additive-on-base" = "additive-on-base";

/**
 * Which end of the placement score is good.
 *
 * transfer-priority.ts is being reworked. If the reworked score turns out to
 * be "lower is better" (a rank, a wait time), flip this one flag rather than
 * inverting values at the call site, where it would be invisible.
 */
export const PLACEMENT_SCORE_HIGHER_IS_BETTER = true;

export type BumpMetric = "writeUp" | "placement";

/** The two metrics, in the order they appear in the audit note. */
export const BUMP_METRICS: Array<{ key: BumpMetric; label: string }> = [
  { key: "writeUp", label: "write-up %" },
  { key: "placement", label: "placement score" },
];

// ── period arithmetic ───────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function isIsoDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export function isPeriod(value: unknown): boolean {
  const s = String(value ?? "");
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** The "YYYY-MM" an ISO date falls in. */
export function periodOf(iso: string): string {
  return String(iso ?? "").slice(0, 7);
}

/**
 * Month names are spelled out here rather than run through
 * toLocaleDateString so a pay string cannot change with the runtime's locale
 * data, and so the same list is both the writer and the parser.
 */
export function monthLabel(period: string): string {
  if (!isPeriod(period)) return String(period ?? "");
  return `${MONTH_NAMES[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
}

export function addPeriodMonths(period: string, months: number): string {
  if (!isPeriod(period)) return String(period ?? "");
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const total = y * 12 + (m - 1) + Math.trunc(months);
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

export function previousPeriod(period: string): string { return addPeriodMonths(period, -1); }
export function nextPeriod(period: string): string { return addPeriodMonths(period, 1); }

/** The last calendar day of a period, as an ISO date. */
export function lastDayOfPeriod(period: string): string {
  if (!isPeriod(period)) return String(period ?? "");
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

/** The date in `today`'s own month on which last month's request comes due. */
export function autoFileDueDate(today: string): string {
  return `${periodOf(today)}-${String(AUTO_FILE_DAY_OF_MONTH).padStart(2, "0")}`;
}

/** The month a run on `today` is filing for: the previous calendar month. */
export function autoFileTargetPeriod(today: string): string {
  return previousPeriod(periodOf(today));
}

/**
 * Every period a run on `today` should file, oldest first.
 *
 * Follows the spirit of recurringCompIsDue: a tick may catch up AFTER the
 * scheduled day but never before it. Before the 2nd, last month is not yet
 * due — but a month older than that is already overdue and files on any day.
 *
 * A null ledger (first run ever) files only the newest due period, so turning
 * this on does not back-file months that were already paid by hand.
 */
export function autoFileDuePeriods(today: string, lastFiledPeriod: string | null | undefined): string[] {
  if (!isIsoDate(today)) return [];
  const target = autoFileTargetPeriod(today);
  if (!isPeriod(target)) return [];
  // Before the 2nd, the newest month we may file is the one before last month.
  const newest = today >= autoFileDueDate(today) ? target : previousPeriod(target);
  if (newest < AUTO_FILE_EARLIEST_PERIOD) return [];

  const stamped = isPeriod(lastFiledPeriod) ? String(lastFiledPeriod) : null;
  let from = stamped ? nextPeriod(stamped) : newest;
  if (from < AUTO_FILE_EARLIEST_PERIOD) from = AUTO_FILE_EARLIEST_PERIOD;
  const oldestAllowed = addPeriodMonths(newest, -(AUTO_FILE_CATCHUP_MONTHS - 1));
  if (from < oldestAllowed) from = oldestAllowed;

  const out: string[] = [];
  for (let p = from; p <= newest; p = nextPeriod(p)) {
    out.push(p);
    if (out.length >= AUTO_FILE_CATCHUP_MONTHS) break; // belt and braces
  }
  return out;
}

/** True when a run on `today` has at least one period to file. */
export function autoFileIsDue(today: string, lastFiledPeriod: string | null | undefined): boolean {
  return autoFileDuePeriods(today, lastFiledPeriod).length > 0;
}

// ── "already submitted" ─────────────────────────────────────────────────────

/** A comp_requests row, in the shape mapComp() hands out. */
export interface CompRequestRow {
  id?: number | null;
  userId: number;
  category?: string | null;
  status?: string | null;
  description?: string | null;
  note?: string | null;
  expenseDate?: string | null;
  requestedAt?: string | null;
  createdAt?: string | null;
}

export function isTransferCompCategory(category: unknown): boolean {
  const c = String(category ?? "").trim().toLowerCase();
  if (c === TRANSFER_COMP_CATEGORY) return true;
  return LEGACY_TRANSFER_COMP_CATEGORIES.indexOf(c) >= 0;
}

const MONTH_NAME_RE = new RegExp(`\\b(${MONTH_NAMES.join("|")})\\s+(20\\d{2})\\b`, "gi");
const PERIOD_RE = /\b(20\d{2})-(0[1-9]|1[0-2])\b/g;
const MONTH_NAMES_LOWER = MONTH_NAMES.map((n) => n.toLowerCase());

/**
 * Every month a piece of free text names, as "YYYY-MM".
 *
 * Both spellings count: "October 2026" (what the Comp Requests helper button
 * writes into the description) and "2026-10" (what a date does).
 */
export function periodsNamedIn(text: unknown): string[] {
  const s = String(text ?? "");
  const found: string[] = [];
  const add = (p: string) => { if (found.indexOf(p) < 0) found.push(p); };
  let m: RegExpExecArray | null;
  MONTH_NAME_RE.lastIndex = 0;
  while ((m = MONTH_NAME_RE.exec(s)) !== null) {
    const idx = MONTH_NAMES_LOWER.indexOf(m[1].toLowerCase());
    if (idx >= 0) add(`${m[2]}-${String(idx + 1).padStart(2, "0")}`);
  }
  PERIOD_RE.lastIndex = 0;
  while ((m = PERIOD_RE.exec(s)) !== null) add(`${m[1]}-${m[2]}`);
  return found;
}

/**
 * Does this request cover `period`?
 *
 * THE RULE, strictly in this order — the first source that names ANY month
 * settles it, and the later sources are not consulted:
 *   1. It must be a transfers-category request in a covering status.
 *   2. The DESCRIPTION. It covers `period` only if `period` is among the
 *      months named there.
 *   3. Otherwise the NOTE, the same way.
 *   4. Otherwise expense_date's month.
 *   5. Naming nothing and dating nothing covers nothing.
 *
 * Text beats expense_date on purpose. A CLR who files September's transfers
 * on 3 October and dates the expense 2026-10-03 has written "September 2026"
 * in the description; trusting the date there would both let September file
 * twice AND wrongly block October.
 *
 * Description beats note for the same reason, one layer down, and this one
 * bit in a test before it could bite in payroll: an auto-filed note opens
 * "Auto-filed 2026-11-02 for October 2026". Reading the two fields together
 * made every October request look like it also covered November, which would
 * have suppressed the whole team's November filing. The description is the
 * field the month belongs in — the Comp Requests helper button writes it
 * there and so does buildAutoFileDescription — and the note is only consulted
 * for a hand-written request that named the month nowhere else.
 */
export function compRequestCoversPeriod(row: CompRequestRow, period: string): boolean {
  if (!row || !isPeriod(period)) return false;
  if (!isTransferCompCategory(row.category)) return false;
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status && COVERING_STATUSES.indexOf(status) < 0) return false;
  const fromDescription = periodsNamedIn(row.description);
  if (fromDescription.length > 0) return fromDescription.indexOf(period) >= 0;
  const fromNote = periodsNamedIn(row.note);
  if (fromNote.length > 0) return fromNote.indexOf(period) >= 0;
  const expense = String(row.expenseDate ?? "");
  if (isIsoDate(expense)) return periodOf(expense) === period;
  return false;
}

/** Every existing request that already covers `period` for this CLR. */
export function findCoveringRequests(
  rows: CompRequestRow[] | null | undefined,
  userId: number,
  period: string,
): CompRequestRow[] {
  return (rows ?? []).filter((r) => Number(r?.userId) === Number(userId) && compRequestCoversPeriod(r, period));
}

/**
 * Transfers requests that name no month and carry no expense date, filed in or
 * just after `period`.
 *
 * These cannot be matched to a month, so they neither block nor confirm. The
 * plan files anyway (a skipped month is invisible; a duplicate ask is not) and
 * carries a WARNING line so the approver sees the possible double before they
 * approve money.
 */
export function untaggedTransferRequests(
  rows: CompRequestRow[] | null | undefined,
  userId: number,
  period: string,
): CompRequestRow[] {
  const window = [period, nextPeriod(period)];
  return (rows ?? []).filter((r) => {
    if (Number(r?.userId) !== Number(userId)) return false;
    if (!isTransferCompCategory(r?.category)) return false;
    const status = String(r?.status ?? "").trim().toLowerCase();
    if (status && COVERING_STATUSES.indexOf(status) < 0) return false;
    if (periodsNamedIn(`${r.description ?? ""}\n${r.note ?? ""}`).length > 0) return false;
    if (isIsoDate(String(r.expenseDate ?? ""))) return false;
    const filed = String(r.requestedAt ?? r.createdAt ?? "").slice(0, 7);
    return window.indexOf(filed) >= 0;
  });
}

// ── the pool and the ranking ────────────────────────────────────────────────

/** One CLR's month, as the caller reads it out of the database. */
export interface ClrMonthStats {
  userId: number;
  name?: string | null;
  /** Explicit false pauses this CLR. Undefined is treated as active. */
  active?: boolean;
  /** Transfers logged in the period. */
  transfers: number;
  /** summarizeCompleteness().pct — 0-100, or null when there was nothing to score. */
  writeUpPct?: number | null;
  /** The transfer-placement score. Plain input; higher is better. */
  placementScore?: number | null;
  /** users.transfer_comp_cents — a saved flat rate, or null for the volume tiers. */
  transferRateCents?: number | null;
}

export function isActive(stat: ClrMonthStats): boolean {
  return stat?.active !== false;
}

/**
 * Who can be ranked: active CLRs at or above the transfer threshold.
 *
 * Inactive CLRs are left out entirely. They are not getting a request filed
 * (see planTransferCompAutoFile), and counting someone who is not being paid
 * would move everybody else's rank.
 */
export function bumpPool(stats: ClrMonthStats[] | null | undefined): ClrMonthStats[] {
  return (stats ?? []).filter((s) => isActive(s) && Number(s?.transfers ?? 0) >= BUMP_MIN_TRANSFERS);
}

export interface RankEntry { userId: number; value: number; }

/** The metric's value for a CLR, or null when they cannot be ranked on it. */
export function metricValue(stat: ClrMonthStats, metric: BumpMetric): number | null {
  const raw = metric === "writeUp" ? stat?.writeUpPct : stat?.placementScore;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (metric === "placement" && !PLACEMENT_SCORE_HIGHER_IS_BETTER) return -n;
  return n;
}

function valueGroups(entries: RankEntry[], descending: boolean): RankEntry[][] {
  const sorted = entries.slice().sort((a, b) => (descending ? b.value - a.value : a.value - b.value));
  const groups: RankEntry[][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const last = groups.length > 0 ? groups[groups.length - 1] : null;
    if (last && last[0].value === sorted[i].value) last.push(sorted[i]);
    else groups.push([sorted[i]]);
  }
  return groups;
}

/**
 * The top group. A tie at the boundary EXTENDS it.
 *
 * Two CLRs on the same write-up percentage are the same performance, and
 * nothing here is allowed to split them by id or by surname. So if 3rd and
 * 4th are level, both get the +10%: a tie never costs anybody money.
 *
 * If that would swallow the whole pool — everyone on the same number — nobody
 * is the top three, and the group is empty.
 */
export function topTieGroup(entries: RankEntry[]): RankEntry[] {
  const groups = valueGroups(entries, true);
  const out: RankEntry[] = [];
  for (let i = 0; i < groups.length && out.length < BUMP_GROUP_SIZE; i += 1) {
    for (let j = 0; j < groups[i].length; j += 1) out.push(groups[i][j]);
  }
  return out.length >= entries.length ? [] : out;
}

/**
 * The bottom group. A tie at the boundary SHRINKS it.
 *
 * The mirror of the rule above, pointed the same way: a tie never costs
 * anybody money. Only whole tied groups that fit inside three are docked, so
 * three CLRs level on the 2nd-worst number are all spared rather than one of
 * them being picked to lose 10%.
 */
export function bottomTieGroup(entries: RankEntry[]): RankEntry[] {
  const groups = valueGroups(entries, false);
  const out: RankEntry[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    if (out.length + groups[i].length > BUMP_GROUP_SIZE) break;
    for (let j = 0; j < groups[i].length; j += 1) out.push(groups[i][j]);
  }
  return out.length >= entries.length ? [] : out;
}

/** Competition ranks (1, 2, 2, 4) over the pool, best first. */
export function competitionRanks(entries: RankEntry[]): Array<{ userId: number; value: number; rank: number }> {
  const groups = valueGroups(entries, true);
  const out: Array<{ userId: number; value: number; rank: number }> = [];
  let seen = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const rank = seen + 1;
    for (let j = 0; j < groups[i].length; j += 1) {
      out.push({ userId: groups[i][j].userId, value: groups[i][j].value, rank });
    }
    seen += groups[i].length;
  }
  return out;
}

/** One bump, and everything the approver needs to check it. */
export interface BumpDetail {
  metric: BumpMetric;
  metricLabel: string;
  direction: "up" | "down";
  bps: number;
  /** Rank within the metric's ranked pool, best = 1, ties sharing a rank. */
  rank: number;
  /** How many CLRs were ranked on this metric. */
  of: number;
  /** The CLR's own value, as ranked. */
  value: number;
}

export interface MetricRanking {
  metric: BumpMetric;
  metricLabel: string;
  /** How many pool members had a usable value for this metric. */
  ranked: number;
  /** Empty when the metric could not be ranked, or when everyone tied. */
  bumps: BumpDetail[];
  /** Which userIds got the bumps, for a quick lookup. */
  byUserId: Array<{ userId: number; bump: BumpDetail }>;
  /** Set when nobody was bumped on this metric. */
  reason: string | null;
}

/**
 * Rank one metric across the pool and hand back the bumps it earns.
 *
 * The minimum pool size is checked against the RANKED count, not the pool
 * count: a metric only four CLRs have a value for cannot name a clean top and
 * bottom three, however big the pool around it is.
 */
export function rankMetric(pool: ClrMonthStats[], metric: BumpMetric): MetricRanking {
  const match = BUMP_METRICS.filter((m) => m.key === metric);
  const label = match.length > 0 ? match[0].label : String(metric);
  const entries: RankEntry[] = [];
  for (let i = 0; i < pool.length; i += 1) {
    const v = metricValue(pool[i], metric);
    if (v !== null) entries.push({ userId: Number(pool[i].userId), value: v });
  }
  const out: MetricRanking = { metric, metricLabel: label, ranked: entries.length, bumps: [], byUserId: [], reason: null };
  if (entries.length < BUMP_MIN_POOL) {
    out.reason = `only ${entries.length} CLR${entries.length === 1 ? "" : "s"} had a ${label} to rank, under the ${BUMP_MIN_POOL} needed`;
    return out;
  }
  const ranks = competitionRanks(entries);
  const rankOf = (userId: number): { rank: number; value: number } => {
    const hit = ranks.filter((r) => r.userId === userId);
    return hit.length > 0 ? { rank: hit[0].rank, value: hit[0].value } : { rank: 0, value: 0 };
  };
  const topIds = topTieGroup(entries).map((t) => t.userId);
  const bottomIds = bottomTieGroup(entries).map((b) => b.userId);
  // Belt and braces: the pool-swallow guards above should make this impossible,
  // but nobody is ever both bumped up and down for the same metric.
  const overlap = topIds.filter((id) => bottomIds.indexOf(id) >= 0);

  const push = (userId: number, direction: "up" | "down") => {
    if (overlap.indexOf(userId) >= 0) return;
    const r = rankOf(userId);
    const detail: BumpDetail = {
      metric, metricLabel: label, direction,
      bps: direction === "up" ? BUMP_STEP_BPS : -BUMP_STEP_BPS,
      rank: r.rank, of: entries.length, value: r.value,
    };
    out.bumps.push(detail);
    out.byUserId.push({ userId, bump: detail });
  };
  for (let i = 0; i < topIds.length; i += 1) push(topIds[i], "up");
  for (let i = 0; i < bottomIds.length; i += 1) push(bottomIds[i], "down");
  if (out.bumps.length === 0) out.reason = `every ranked CLR had the same ${label}`;
  return out;
}

// ── money ───────────────────────────────────────────────────────────────────

/**
 * Round to whole cents, halves AWAY FROM ZERO.
 *
 * Math.round() breaks halves toward +Infinity, which would make -1234.5 round
 * to -1234 while +1234.5 rounds to +1235 — a +10% and a -10% on the same base
 * would then not be mirror images.
 */
export function roundCents(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export interface BumpedAmount {
  baseCents: number;
  totalBps: number;
  deltaCents: number;
  amountCents: number;
}

/**
 * Apply the bumps to a base amount.
 *
 * The percentages are summed FIRST and the money is worked out ONCE, from the
 * base. That is what BUMP_COMBINE means, and it is also why nothing can drift:
 * +10% and -10% sum to 0 bps, so the delta is exactly 0 cents and the amount
 * is exactly the base — whatever the base is.
 */
export function applyBumps(baseCents: number, bumps: BumpDetail[] | null | undefined): BumpedAmount {
  const base = roundCents(baseCents);
  let totalBps = 0;
  const list = bumps ?? [];
  for (let i = 0; i < list.length; i += 1) totalBps += Number(list[i]?.bps ?? 0);
  const deltaCents = roundCents((base * totalBps) / 10000);
  const amountCents = Math.max(0, base + deltaCents);
  return { baseCents: base, totalBps, deltaCents, amountCents };
}

/** "$1,500.00". Written out rather than localized so a pay string is fixed. */
export function formatMoneyCents(cents: number): string {
  const n = roundCents(cents);
  const abs = Math.abs(n);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** "+10%" / "-10%" / "0%" from basis points. */
export function formatBps(bps: number): string {
  const n = Math.trunc(Number(bps) || 0);
  const pct = n / 100;
  const body = `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2)}%`;
  return n > 0 ? `+${body}` : body;
}

// ── the audit string ────────────────────────────────────────────────────────

/**
 * The one-line description on the request.
 *
 * Keeps the shape the Comp Requests helper button already writes — "Monthly
 * transfer request — October 2026 (150 transfers @ $10.00)" — so the month is
 * where both a human and compRequestCoversPeriod() look for it, then says it
 * was auto-filed and what the adjustment came to.
 */
export function buildAutoFileDescription(args: {
  period: string;
  transfers: number;
  rateCents: number;
  bumps: BumpDetail[];
  amount: BumpedAmount;
}): string {
  const n = Math.trunc(Number(args.transfers) || 0);
  const head = `Monthly transfer request — ${monthLabel(args.period)} (${n} transfer${n === 1 ? "" : "s"} @ ${formatMoneyCents(args.rateCents)})`;
  const tags = args.bumps.map((b) => `${formatBps(b.bps)} ${b.metricLabel}`).join(", ");
  const adj = args.bumps.length > 0 ? `${tags} · net ${formatBps(args.amount.totalBps)}` : "no adjustment";
  return `${head} — auto-filed · ${adj} · ${formatMoneyCents(args.amount.amountCents)}`.slice(0, 300);
}

/**
 * The note: the whole calculation, in words, on the request itself.
 *
 * An approver must be able to see the base, every bump, the rank and metric
 * that earned it, and the total — without opening this file.
 */
export function buildAutoFileNote(args: {
  period: string;
  today: string;
  transfers: number;
  rateCents: number;
  bumps: BumpDetail[];
  amount: BumpedAmount;
  poolSize: number;
  clrCount: number;
  noBumpReason: string | null;
  warnings: string[];
}): string {
  const label = monthLabel(args.period);
  const n = Math.trunc(Number(args.transfers) || 0);
  const lines: string[] = [];
  lines.push(`Auto-filed ${args.today} for ${label} (the previous calendar month).`);
  lines.push(`Base: ${n} transfer${n === 1 ? "" : "s"} x ${formatMoneyCents(args.rateCents)} = ${formatMoneyCents(args.amount.baseCents)}.`);
  if (args.bumps.length > 0) {
    lines.push(`Adjustments — each is ${formatBps(BUMP_STEP_BPS)} of the BASE, added together, never compounded:`);
    for (let i = 0; i < args.bumps.length; i += 1) {
      const b = args.bumps[i];
      const where = b.direction === "up" ? `top ${BUMP_GROUP_SIZE}` : `bottom ${BUMP_GROUP_SIZE}`;
      lines.push(`  ${formatBps(b.bps)}  ${b.metricLabel} — ${where}, rank ${b.rank} of ${b.of} (${b.value})`);
    }
    lines.push(`Net ${formatBps(args.amount.totalBps)} = ${formatMoneyCents(args.amount.deltaCents)}.`);
  } else if (args.noBumpReason) {
    lines.push(`No adjustment: ${args.noBumpReason}.`);
  }
  lines.push(`Total requested: ${formatMoneyCents(args.amount.amountCents)}.`);
  lines.push(`Bump pool: CLRs with at least ${BUMP_MIN_TRANSFERS} transfers in ${label} — ${args.poolSize} of ${args.clrCount}.`);
  for (let i = 0; i < args.warnings.length; i += 1) lines.push(`WARNING: ${args.warnings[i]}`);
  return lines.join("\n");
}

// ── the plan ────────────────────────────────────────────────────────────────

export type SkipReason = "inactive" | "already-filed" | "no-transfers";

export interface AutoFileSkip {
  userId: number;
  userName: string;
  reason: SkipReason;
  detail: string;
}

/** One request the caller should INSERT, already priced and already explained. */
export interface AutoFileItem {
  userId: number;
  userName: string;
  period: string;
  monthLabel: string;
  category: string;
  transfers: number;
  rateCents: number;
  baseCents: number;
  deltaCents: number;
  totalBps: number;
  amountCents: number;
  bumps: BumpDetail[];
  inPool: boolean;
  description: string;
  note: string;
  /** The last day of the month being paid for, not the day it was filed. */
  expenseDate: string;
  warnings: string[];
}

export interface AutoFilePlan {
  period: string;
  monthLabel: string;
  today: string;
  /** True once the bump gate has opened for this period. */
  bumpsActive: boolean;
  poolSize: number;
  clrCount: number;
  rankings: MetricRanking[];
  file: AutoFileItem[];
  skipped: AutoFileSkip[];
  /** Plan-level notes for the operator — never a reason to skip anybody. */
  warnings: string[];
  totalCents: number;
}

/**
 * Everything one month's run should file, and everything it deliberately did not.
 *
 * Pure: hand it the month, the day, one row per CLR and the existing comp
 * requests, and it hands back rows. It writes nothing and reads nothing.
 */
export function planTransferCompAutoFile(input: {
  period: string;
  today: string;
  stats: ClrMonthStats[] | null | undefined;
  existing?: CompRequestRow[] | null;
}): AutoFilePlan {
  const period = String(input?.period ?? "");
  const today = String(input?.today ?? "");
  const label = monthLabel(period);
  const stats = (input?.stats ?? []).filter((s) => s && Number.isFinite(Number(s.userId)));
  const existing = input?.existing ?? [];
  const expenseDate = lastDayOfPeriod(period);

  const pool = bumpPool(stats);
  const bumpsActive = isPeriod(period) && period >= BUMP_EFFECTIVE_FROM_PERIOD;
  const poolTooSmall = pool.length < BUMP_MIN_POOL;

  const rankings: MetricRanking[] = [];
  const warnings: string[] = [];
  if (bumpsActive && !poolTooSmall) {
    for (let i = 0; i < BUMP_METRICS.length; i += 1) rankings.push(rankMetric(pool, BUMP_METRICS[i].key));
    for (let i = 0; i < rankings.length; i += 1) {
      if (rankings[i].reason) warnings.push(`No ${rankings[i].metricLabel} bumps in ${label}: ${rankings[i].reason}.`);
    }
  } else if (bumpsActive) {
    warnings.push(
      `No bumps in ${label}: the pool had ${pool.length} CLR${pool.length === 1 ? "" : "s"} at or above ` +
      `${BUMP_MIN_TRANSFERS} transfers, under the ${BUMP_MIN_POOL} needed to name a top ${BUMP_GROUP_SIZE} ` +
      `and a bottom ${BUMP_GROUP_SIZE} without the same person landing in both.`,
    );
  }

  const bumpsFor = (userId: number): BumpDetail[] => {
    const out: BumpDetail[] = [];
    for (let i = 0; i < rankings.length; i += 1) {
      const hit = rankings[i].byUserId.filter((b) => b.userId === userId);
      for (let j = 0; j < hit.length; j += 1) out.push(hit[j].bump);
    }
    return out;
  };

  const poolIds = pool.map((p) => Number(p.userId));
  const file: AutoFileItem[] = [];
  const skipped: AutoFileSkip[] = [];

  for (let i = 0; i < stats.length; i += 1) {
    const s = stats[i];
    const userId = Number(s.userId);
    const userName = String(s.name ?? "").trim() || `User #${userId}`;
    const transfers = Math.max(0, Math.trunc(Number(s.transfers ?? 0) || 0));
    const plural = transfers === 1 ? "" : "s";

    if (!isActive(s)) {
      skipped.push({ userId, userName, reason: "inactive", detail: `inactive — ${transfers} transfer${plural} in ${label} were not filed` });
      // Loud, because this is earned money nobody is being asked to approve.
      if (transfers >= AUTO_FILE_MIN_TRANSFERS) {
        warnings.push(`${userName} logged ${transfers} transfer${plural} in ${label} but is inactive — nothing was filed. File by hand if they are still owed.`);
      }
      continue;
    }
    if (transfers < AUTO_FILE_MIN_TRANSFERS) {
      skipped.push({ userId, userName, reason: "no-transfers", detail: `no transfers logged in ${label}` });
      continue;
    }
    const covering = findCoveringRequests(existing, userId, period);
    if (covering.length > 0) {
      const how = covering.map((c) => `#${c.id ?? "?"} (${String(c.status ?? "unknown")})`).join(", ");
      skipped.push({ userId, userName, reason: "already-filed", detail: `${label} is already covered by ${how}` });
      continue;
    }

    const rateCents = resolveEmailTransferCompRateCents(transfers, s.name, s.transferRateCents ?? null);
    const baseCents = roundCents(transfers * rateCents);
    const inPool = poolIds.indexOf(userId) >= 0;
    const bumps = inPool ? bumpsFor(userId) : [];
    const amount = applyBumps(baseCents, bumps);

    let noBumpReason: string | null = null;
    if (bumps.length === 0) {
      if (!bumpsActive) noBumpReason = `the write-up and placement bumps start with transfer month ${monthLabel(BUMP_EFFECTIVE_FROM_PERIOD)}`;
      else if (poolTooSmall) noBumpReason = `the bump pool had ${pool.length} CLR${pool.length === 1 ? "" : "s"}, under the ${BUMP_MIN_POOL} needed`;
      else if (!inPool) noBumpReason = `${transfers} transfer${plural} is under the ${BUMP_MIN_TRANSFERS}-transfer pool minimum`;
      else noBumpReason = `in the pool of ${pool.length} but in neither the top ${BUMP_GROUP_SIZE} nor the bottom ${BUMP_GROUP_SIZE} on either metric`;
    }

    const itemWarnings: string[] = [];
    const untagged = untaggedTransferRequests(existing, userId, period);
    if (untagged.length > 0) {
      const how = untagged.map((c) => `#${c.id ?? "?"} (${String(c.status ?? "unknown")})`).join(", ");
      itemWarnings.push(`POSSIBLE DUPLICATE — ${userName} has a transfers request naming no month: ${how}. Filed anyway so the month is not silently missed; deny this one if it is the same money.`);
    }

    file.push({
      userId, userName, period, monthLabel: label,
      category: TRANSFER_COMP_CATEGORY,
      transfers, rateCents,
      baseCents: amount.baseCents,
      deltaCents: amount.deltaCents,
      totalBps: amount.totalBps,
      amountCents: amount.amountCents,
      bumps, inPool,
      description: buildAutoFileDescription({ period, transfers, rateCents, bumps, amount }),
      note: buildAutoFileNote({
        period, today, transfers, rateCents, bumps, amount,
        poolSize: pool.length, clrCount: stats.length,
        noBumpReason, warnings: itemWarnings,
      }),
      expenseDate,
      warnings: itemWarnings,
    });
    for (let w = 0; w < itemWarnings.length; w += 1) warnings.push(itemWarnings[w]);
  }

  let totalCents = 0;
  for (let i = 0; i < file.length; i += 1) totalCents += file[i].amountCents;

  return {
    period, monthLabel: label, today,
    bumpsActive, poolSize: pool.length, clrCount: stats.length,
    rankings, file, skipped, warnings, totalCents,
  };
}

/**
 * The row a planned item becomes once it is inserted.
 *
 * Exists so a second run can be fed the first run's output and prove it files
 * nothing the second time — the same check the real ledger + INSERT does, but
 * without a database.
 */
export function autoFiledRequestRow(item: AutoFileItem, id?: number): CompRequestRow {
  return {
    id: id ?? null,
    userId: item.userId,
    category: item.category,
    status: "pending",
    description: item.description,
    note: item.note,
    expenseDate: item.expenseDate,
    requestedAt: `${item.expenseDate}T00:00:00.000Z`,
    createdAt: `${item.expenseDate}T00:00:00.000Z`,
  };
}
