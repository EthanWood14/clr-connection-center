/**
 * The Transfer Tournament — who logged the most transfers in the afternoon
 * window, 12:30–5:30 PM Pacific, today.
 *
 * Ethan, 14 Sep 2026: "add a screen in the dashboard C3 that is a tournament
 * screen, keeping track of who has the most transfers from 12:30-5:30 today."
 *
 * A transfer is in the tournament when it was LOGGED inside the window: the
 * moment the outcome was created, not the business date it was filed under.
 * Credit follows the house rule in transfer-credit.ts — a Shotgun transfer is
 * half to the publisher and half to the claimer — so the board agrees with
 * the leaderboard and comp. Ties are broken by who got there first.
 *
 * Pure: the server hands it rows and people, the tests hand it fixtures.
 */
import { transferCreditFor } from "./transfer-credit";

/**
 * Whether a tournament is on. On for 17 Sep 2026 (12:30–5:30 PT) — Ethan:
 * tournament on everyone's home pages including managers, excluding Elleine.
 * With this false the Dashboard tab and the sidebar link are gone and
 * /tournament shows the last board as a record. The 14 Sep 2026 run: Elleine
 * Asuncion won with 12.
 */
export const TOURNAMENT_ENABLED = true;
/** The most recent completed run, shown as the record while no tournament is on. */
export const LAST_TOURNAMENT_DATE = "2026-09-14";

/**
 * Helpers who should not compete / see the home board — always. Match is
 * case-insensitive on a whole word in the display name (e.g. "Elleine Asuncion").
 */
export const TOURNAMENT_EXCLUDED_NAME_RE = /\belleine\b/i;

/**
 * Date-scoped exclusions: from this Pacific calendar day inclusive forward.
 * Jordon Chang (also "Jordan Chang") — Ethan 18 Sep 2026: "jordon shouldn't
 * count since wednesday" (2026-09-16 PT). Match jordon as a whole word, or
 * "jordan chang" so demo LO "Jordan Rivera" is not pulled in.
 */
export const TOURNAMENT_EXCLUDED_FROM: readonly {
  nameRe: RegExp;
  fromDate: string;
  reason: string;
}[] = [
  {
    nameRe: /\bjordon\b|\bjordan\s+chang\b/i,
    fromDate: "2026-09-16",
    reason: "Ethan: Jordon shouldn't count since Wednesday (2026-09-16 PT)",
  },
];

/**
 * Whether this display name is out of tournament scoring / live UI.
 * Pass the tournament window's Pacific `date` ("YYYY-MM-DD") so date-scoped
 * rules only apply on/after their fromDate; omit for "today" (UI gates).
 */
export function isTournamentExcluded(
  name: string | null | undefined,
  date?: string | null,
): boolean {
  const n = String(name ?? "").trim();
  if (TOURNAMENT_EXCLUDED_NAME_RE.test(n)) return true;
  const day = (date && String(date).trim()) || todayInTz();
  for (const rule of TOURNAMENT_EXCLUDED_FROM) {
    if (day >= rule.fromDate && rule.nameRe.test(n)) return true;
  }
  return false;
}

/** Home tab / sidebar: tournament is on AND this user is not excluded today. */
export function canSeeTournamentHome(name: string | null | undefined): boolean {
  return TOURNAMENT_ENABLED && !isTournamentExcluded(name);
}

export const TOURNAMENT_TZ = "America/Los_Angeles";
export const TOURNAMENT_START = "12:30";
export const TOURNAMENT_END = "17:30";

export type TournamentWindow = {
  /** Calendar date in TOURNAMENT_TZ, "YYYY-MM-DD". */
  date: string;
  tz: string;
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
};

export type TournamentPhase = "before" | "live" | "over";

export type TournamentOutcomeRow = {
  id: number;
  assistantId?: unknown; assistant_id?: unknown;
  shotgunSenderId?: unknown; shotgun_sender_id?: unknown;
  outcomeType?: unknown; outcome_type?: unknown;
  createdAt?: unknown; created_at?: unknown;
  borrowerName?: unknown; borrower_name?: unknown;
  loName?: unknown; lo_name?: unknown;
  transferType?: unknown; transfer_type?: unknown;
};

export type TournamentPerson = { id: number; name: string };

export type TournamentTransfer = {
  id: number;
  borrowerName: string;
  loName: string;
  transferType: string;
  at: string;
  credit: number;
};

export type TournamentStanding = {
  rank: number;
  userId: number;
  name: string;
  credit: number;
  transfers: TournamentTransfer[];
  /** When their most recent credited transfer landed, or null with none. */
  latestAt: string | null;
  /** When their first credited transfer landed — the tie-breaker. */
  firstAt: string | null;
};

/** "YYYY-MM-DD" as observed in `tz`. */
export function todayInTz(nowMs: number = Date.now(), tz: string = TOURNAMENT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcMs;
}

/** A wall-clock "HH:MM" on a calendar date in `tz`, as epoch ms. */
export function wallClockToMs(date: string, hhmm: string, tz: string = TOURNAMENT_TZ): number {
  const [y, mo, d] = date.split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (![y, mo, d, hh, mm].every(Number.isFinite)) return NaN;
  const naive = Date.UTC(y, mo - 1, d, hh, mm, 0);
  // Two passes: the offset at the naive instant, then re-checked at the
  // corrected one, so a window that straddles a DST change still lands.
  let guess = naive - tzOffsetMs(naive, tz);
  guess = naive - tzOffsetMs(guess, tz);
  return guess;
}

export function tournamentWindow(date: string, tz: string = TOURNAMENT_TZ, start: string = TOURNAMENT_START, end: string = TOURNAMENT_END): TournamentWindow {
  const startMs = wallClockToMs(date, start, tz);
  const endMs = wallClockToMs(date, end, tz);
  return { date, tz, startMs, endMs, startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

export function tournamentPhase(nowMs: number, window: TournamentWindow): TournamentPhase {
  if (nowMs < window.startMs) return "before";
  if (nowMs >= window.endMs) return "over";
  return "live";
}

/**
 * When an outcome row was created, as epoch ms. Rows written by the app carry
 * an ISO string with a Z; rows from the table default carry SQLite's
 * "YYYY-MM-DD HH:MM:SS", which is UTC without saying so.
 */
export function outcomeCreatedMs(createdAt: unknown): number {
  const s = String(createdAt ?? "").trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return Date.parse(s.replace(" ", "T") + "Z");
  return Date.parse(s);
}

const str = (v: unknown) => (v == null ? "" : String(v));

/**
 * Standings for one window. Every active CLR in `people` is on the board
 * (zero is a score too), except always-excluded and date-scoped TOURNAMENT_EXCLUDED names; anyone else who
 * earned credit is added by name (also skipping excluded people).
 */
export function tournamentStandings(
  rows: ReadonlyArray<TournamentOutcomeRow> | null | undefined,
  people: ReadonlyArray<TournamentPerson>,
  window: TournamentWindow,
): TournamentStanding[] {
  const excludedIds = new Set(people.filter((p) => isTournamentExcluded(p.name, window.date)).map((p) => p.id));
  const roster = people.filter((p) => !excludedIds.has(p.id));
  const byUser = new Map<number, TournamentStanding>();
  const ensure = (id: number, name: string) => {
    let s = byUser.get(id);
    if (!s) { s = { rank: 0, userId: id, name, credit: 0, transfers: [], latestAt: null, firstAt: null }; byUser.set(id, s); }
    return s;
  };
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  for (const p of roster) ensure(p.id, p.name);

  const inWindow = (rows ?? []).filter((row) => {
    if ((row.outcomeType ?? row.outcome_type) !== "transfer") return false;
    const at = outcomeCreatedMs(row.createdAt ?? row.created_at);
    return Number.isFinite(at) && at >= window.startMs && at < window.endMs;
  }).sort((a, b) => outcomeCreatedMs(a.createdAt ?? a.created_at) - outcomeCreatedMs(b.createdAt ?? b.created_at));

  for (const row of inWindow) {
    const at = new Date(outcomeCreatedMs(row.createdAt ?? row.created_at)).toISOString();
    const maker = Number(row.assistantId ?? row.assistant_id) || 0;
    const sender = Number(row.shotgunSenderId ?? row.shotgun_sender_id) || 0;
    const credited = maker > 0 && sender > 0 && maker !== sender ? [maker, sender] : [maker, sender].filter((id) => id > 0).slice(0, 1);
    for (const who of credited) {
      if (excludedIds.has(who) || isTournamentExcluded(nameOf.get(who), window.date)) continue;
      const credit = transferCreditFor(row, who);
      if (credit <= 0) continue;
      const s = ensure(who, nameOf.get(who) ?? `CLR #${who}`);
      s.credit += credit;
      s.transfers.push({
        id: Number(row.id), credit, at,
        borrowerName: str(row.borrowerName ?? row.borrower_name) || "Borrower",
        loName: str(row.loName ?? row.lo_name),
        transferType: str(row.transferType ?? row.transfer_type),
      });
      if (!s.firstAt) s.firstAt = at;
      s.latestAt = at;
    }
  }

  const out = Array.from(byUser.values()).sort((a, b) =>
    b.credit - a.credit
    || (a.firstAt ?? "￿").localeCompare(b.firstAt ?? "￿")
    || a.name.localeCompare(b.name));
  // Shared rank on a true tie (same credit AND same first time — the same
  // shotgun transfer); otherwise the earlier CLR ranks ahead.
  out.forEach((s, i) => {
    const prev = out[i - 1];
    s.rank = prev && prev.credit === s.credit && prev.firstAt === s.firstAt ? prev.rank : i + 1;
  });
  return out;
}
