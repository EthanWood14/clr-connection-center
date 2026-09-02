/**
 * The office TV's SECOND feed.
 *
 * `GET /api/tv/:token/feed` drives the moment pipeline — the scorecard, the
 * events cursor, the celebrations. It is polled every ten seconds and a thrown
 * query there loses the whole wall. So the board pages that came later got
 * their own endpoint (`/pages`) and their own module, and nothing here can be
 * reached from the feed.
 *
 * Everything in this file is arithmetic over plain values: the three windows,
 * the lead-source coverage maths, the fifteen-minute active rule, and the
 * previous-business-day anchor. The route runs the SQL and hands rows over, so
 * the rules can be tested without a database.
 */
import { addIsoDays } from "./business-day";

// ── windows ─────────────────────────────────────────────────────────────────

export interface TvPageWindows {
  /** Business today, as the route resolved it. */
  today: string;
  /** Monday of this week — the same start the fast feed uses. */
  weekStart: string;
  /** The 1st of the calendar month `today` falls in. */
  monthStart: string;
  /**
   * The earliest date any of the three windows needs, so one scan can answer
   * all of them. Early in a month the week reaches back further than the 1st;
   * on a Monday the 1st reaches back further than the week.
   */
  from: string;
}

/** The weekday of an ISO date, read at noon UTC so no offset can move it. */
function dayOfWeek(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function tvPageWindows(today: string): TvPageWindows {
  // Monday start, matching the feed exactly: Sunday is the END of a week here,
  // not the start of one, so the wall never resets on a Sunday morning.
  const weekStart = addIsoDays(today, -((dayOfWeek(today) + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  return { today, weekStart, monthStart, from: weekStart < monthStart ? weekStart : monthStart };
}

// ── the previous business day ───────────────────────────────────────────────

/**
 * The weekday before `businessDate`.
 *
 * EOD reports are anchored here rather than to today, because the deadline is
 * 4pm the NEXT business day: during the working day there are legitimately
 * zero reports for today, and a board showing "0 of 13 submitted" all morning
 * would be reporting the deadline, not the team.
 *
 * Pass business today (the 7pm rollover already applied). At 6:59pm Friday
 * that is Friday, so this returns Thursday; at 7:00pm it is Saturday, so this
 * returns Friday — the day that just ended.
 *
 * Weekends only. Company holidays are not modelled anywhere in C3, so this
 * does not pretend to know about them.
 */
export function previousBusinessDay(businessDate: string, maxLookbackDays = 10): string {
  for (let back = 1; back <= maxLookbackDays; back += 1) {
    const candidate = addIsoDays(businessDate, -back);
    const dow = dayOfWeek(candidate);
    if (dow !== 0 && dow !== 6) return candidate;
  }
  return addIsoDays(businessDate, -1);
}

// ── lead source ─────────────────────────────────────────────────────────────

/**
 * The first date lead_source is worth reading.
 *
 * The field was rolled out on 2026-08-13. Measured on prod on 2026-09-02:
 * 1 of 1,951 transfers before that date carry a source (0.1%), and 792 of 957
 * after it (83%). Charting June and July would put "blank" at the top of the
 * board as if it were a lead source, which is a lie about where the business
 * comes from.
 */
export const LEAD_SOURCE_TRUSTED_FROM = "2026-08-13";

export interface LeadSourceCoverage {
  /** Transfers in the window. */
  total: number;
  /** How many of them carry a non-empty lead source. */
  withSource: number;
  /** 0-100, or null when the window is empty — a dash, never a fake 0%. */
  pct: number | null;
}

export function leadSourceCoverage(total: number, withSource: number): LeadSourceCoverage {
  const t = Math.max(0, Math.round(Number(total) || 0));
  // A source can never be counted more times than there are transfers; a
  // mismatched pair of queries would otherwise print "112%" on a wall.
  const w = Math.min(t, Math.max(0, Math.round(Number(withSource) || 0)));
  return { total: t, withSource: w, pct: t > 0 ? Math.round((w / t) * 100) : null };
}

// ── who is actually on the phone ────────────────────────────────────────────

export const ACTIVE_WINDOW_SECONDS = 15 * 60;

/**
 * What this measures, said out loud, because it is NOT presence.
 *
 * CallTools sends no presence signal. The obvious-looking one is a trap:
 * callsync_agent_activity_daily.observed_at is a FEED heartbeat — on prod
 * every row for the day carries the identical stamp, including the people with
 * zero active seconds — so it says when C3 last heard from CallTools, not when
 * anyone last worked.
 */
export const ACTIVE_WINDOW_LABEL = "active in the last 15 minutes";

export interface ActiveSignals {
  /** Now, in epoch ms. */
  nowMs: number;
  /** When this person's CallTools active-seconds last actually CHANGED. */
  secondsChangedAt?: string | null;
  /** Their most recent per-call event stamp. */
  lastEventAt?: string | null;
}

function ageSeconds(nowMs: number, stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const t = Date.parse(String(stamp));
  if (!Number.isFinite(t)) return null;
  // A stamp slightly ahead of us is clock skew between the feed and this box,
  // not the future. Clamp rather than discard.
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

/**
 * How long ago this person last did something, or null if that was more than
 * fifteen minutes ago (or never). Either signal counts: active seconds that
 * went UP, or a call event.
 */
export function activeAgoSeconds(signals: ActiveSignals): number | null {
  const ages = [
    ageSeconds(signals.nowMs, signals.secondsChangedAt),
    ageSeconds(signals.nowMs, signals.lastEventAt),
  ].filter((n): n is number => n !== null && n <= ACTIVE_WINDOW_SECONDS);
  return ages.length ? Math.min(...ages) : null;
}

/** How many of these people are active. Nulls are not "0 seconds ago". */
export function activeCount(rows: Array<{ activeAgo: number | null }>): number {
  return rows.reduce((n, r) => n + (r.activeAgo === null ? 0 : 1), 0);
}

// ── who the floor owes work to ──────────────────────────────────────────────

/** The fortnight the starved page measures. */
export const STARVED_WINDOW_DAYS = 14;

/**
 * The first date a transfer counts toward the starved window.
 *
 * Fourteen whole days back, with today sitting on top of them rather than
 * spending one of the fourteen. Today is only ever a part-day — at 9am it holds
 * almost nothing — so counting it as a full day of the window would make every
 * morning read as though the floor had stopped sending work out.
 *
 * Measured on prod on 2026-09-02 this is 2026-08-19, and that is the window the
 * numbers on this page were read off: Derek Bullen 6, Sean Murphy 8, Cole Thomas
 * Fairon 14, Michael Kim 17, Shervin Mohseni 34, Christopher Redoble 294.
 */
export function starvedWindowStart(today: string, days: number = STARVED_WINDOW_DAYS): string {
  const n = Math.round(Number(days));
  return addIsoDays(today, -(Number.isFinite(n) && n > 0 ? n : STARVED_WINDOW_DAYS));
}

export interface StarvedRow {
  name: string;
  /** Transfers RECEIVED in the window. Zero is a real answer, not a missing one. */
  transfers: number;
  /** Their most recent transfer of all time, so a zero can still say how long ago. */
  lastAt?: string | null;
  /** loan_officers.needs_transfers — a human asking for work to be sent here. */
  needsTransfers?: boolean;
}

/**
 * Fewest received first, then by name.
 *
 * `needsTransfers` is deliberately NOT part of this ordering. It earns a badge
 * on the page, and a loud one — but sorting by it would put Christopher Redoble
 * at the head of a starvation list, and he took 294 transfers in the same
 * fortnight the bottom of the list took six. The rank has to mean one thing.
 *
 * `priority_tier` is not part of it either: every one of the 17 active LOs on
 * prod sits at tier 2, so it separates nobody and would only add noise.
 */
export function compareStarved(a: StarvedRow, b: StarvedRow): number {
  const count = (r: StarvedRow) => {
    const n = Math.round(Number(r?.transfers));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return count(a) - count(b) || String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

/** The same rule over a list, leaving the caller's array alone. */
export function orderStarved<T extends StarvedRow>(rows: T[]): T[] {
  return [...(rows ?? [])].sort(compareStarved);
}
