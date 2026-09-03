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
import { addIsoDays, parseWallClockInTz, BUSINESS_DAY_DEFAULT_TZ } from "./business-day";

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

// ── what is coming up ───────────────────────────────────────────────────────

/**
 * How far ahead the upcoming-appointments page looks: today and the six days
 * after it.
 *
 * A week, deliberately. Shorter and the board goes blank on a quiet Thursday
 * afternoon; longer and the top of the list stops changing, which is the
 * fastest way to teach a floor to stop reading a screen. A week is also how
 * far ahead these are actually booked — the far end of the list is next
 * Tuesday, not next month.
 */
export const UPCOMING_DAYS = 7;

/**
 * The only outcome type that is still an appointment.
 *
 * Completing one OVERWRITES the type on the same row: the Appointments page
 * PATCHes `outcomeType` to "transfer" when it lands and "fell_through" when it
 * does not, and the edit dialog can turn it into a callback or a deferral. So
 * "was it transferred, did it fall through, is it still an appointment at
 * all" is one question with one answer, and it is this column. Nothing else
 * may be trusted instead: a transferred appointment keeps its old
 * appointment_datetime forever, so a board reading the date alone would go on
 * advertising a meeting that already happened and was already logged.
 */
export const UPCOMING_APPOINTMENT_TYPE = "appointment";

/** A row as the route hands it over — already aliased out of SQL. */
export interface UpcomingApptRow {
  id?: number | null;
  outcomeType?: string | null;
  borrower?: string | null;
  /** The CLR who booked it. */
  clr?: string | null;
  /** The loan officer it is with. */
  lo?: string | null;
  appointmentDatetime?: string | null;
  followUpDate?: string | null;
}

/** One appointment, ready for the wall. */
export interface UpcomingAppointment {
  id: number;
  borrower: string;
  clr: string;
  lo: string | null;
  /** The stamp exactly as stored, for whenLabel to render. */
  at: string;
  /** That stamp as an instant, for ordering and the past/horizon tests. */
  atMs: number;
  /** False when the row names a day but no clock reading. */
  timed: boolean;
  /** The office's calendar day it falls on, YYYY-MM-DD. */
  day: string;
  isToday: boolean;
}

/**
 * Which of the two columns holds this appointment's LIVE time.
 *
 * follow_up_date first, appointment_datetime second — and that order is the
 * opposite of the reminder crons' COALESCE on purpose, because this page and
 * those crons are answering different questions. A cron asks "is there a
 * meeting time to remind about"; a wall asks "which day is this meeting
 * actually on", and on a drifted row those two columns give different answers.
 *
 * The drift is real and it is in the table already. server/tv-board.ts spells
 * it out at length: the Outcomes edit dialog used to save followUpDate alone
 * and leave appointment_datetime sitting on the ORIGINAL time, and every
 * meeting it moved before it started mirroring is still that shape. Preferring
 * appointment_datetime on one of those rows puts the abandoned slot on the
 * wall, and once that stale time passes, selectUpcomingAppointments drops the
 * meeting as "already happened" — so a meeting the office can see on its own
 * Appointments page vanishes off the board entirely.
 *
 * follow_up_date is the column the office believes, and every surface that
 * edits one agrees on that:
 *
 *  - client/src/pages/appointments.tsx sorts, groups and prints from
 *    followUpDate alone. That page IS the schedule as the floor reads it.
 *  - Its edit dialog clears appointment_datetime whenever the new follow-up
 *    carries no time, in its own words "so a stale value doesn't shadow the
 *    new follow-up date" — appointment_datetime is a mirror, not a source.
 *  - client/src/lib/appointment-datetime.ts (timeColumnsPatch) writes the
 *    follow-up as the decision and mirrors it across.
 *
 * appointment_datetime is still the fallback, and it has to be: CallSync books
 * straight into that column and leaves follow_up_date NULL, so those meetings
 * have no other time at all.
 *
 * The one place the mirror still wins is a tie-break, not a preference: when
 * the follow-up names a DAY with no clock reading and appointment_datetime
 * carries a clock reading on that SAME day, the two columns agree about the
 * day and only one of them knows the hour. That is the quick-reschedule shape
 * (appointments.tsx only mirrors a value containing a "T"), and taking the
 * time there keeps a real 2:30 PM on the wall instead of "time not set". It
 * can never move a meeting to a different day, which is the failure this
 * function exists to prevent.
 *
 * A blank string in either column counts as absent — SQL's NULLIF, in JS.
 */
export function appointmentStamp(
  row: UpcomingApptRow | null | undefined,
  tz: string = BUSINESS_DAY_DEFAULT_TZ,
): string {
  const follow = String(row?.followUpDate ?? "").trim();
  const appt = String(row?.appointmentDatetime ?? "").trim();
  if (!follow) return appt;
  if (appt && isDateOnlyStamp(follow) && !isDateOnlyStamp(appt) && appointmentDay(appt, tz) === follow) return appt;
  return follow;
}

/** A stamp that names a day and no clock reading: "2026-09-04". */
export function isDateOnlyStamp(stamp: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(stamp ?? "").trim());
}

/**
 * The instant a stamp names, on the office's own clock.
 *
 * Two things this has to get right, and C3 has shipped both of them wrong
 * somewhere before:
 *
 *  1. A stamp with no zone is a WALL CLOCK. parseWallClockInTz is the helper
 *     the appointment reminders already use for exactly this; handing the
 *     string to Date.parse instead reads it in the server's zone, and the
 *     server runs in UTC — which is how a 2:30 PM appointment once went out
 *     seven and a half hours early.
 *  2. A day with no clock reading lasts all day. Resolving "2026-09-04" at
 *     midnight would drop every date-only appointment off the board a minute
 *     into the morning it is due, which is the day it is most worth showing.
 *     It resolves at 23:59 instead, so it sits at the end of its own day and
 *     survives that day.
 */
export function appointmentInstantMs(stamp: unknown, tz: string = BUSINESS_DAY_DEFAULT_TZ): number {
  const s = String(stamp ?? "").trim();
  if (!s) return NaN;
  return parseWallClockInTz(isDateOnlyStamp(s) ? `${s}T23:59` : s, tz);
}

/**
 * The office's calendar day for a stamp — always the day whenLabel's weekday
 * will name, by construction.
 *
 * A naive stamp IS the office's wall clock, so its leading ten characters are
 * its day and converting them would be the 7:30 AM bug again. A stamp that
 * does carry a zone is a real instant, so it is converted — the same split
 * whenLabel makes for the time it prints beside this.
 */
export function appointmentDay(stamp: unknown, tz: string = BUSINESS_DAY_DEFAULT_TZ): string {
  const s = String(stamp ?? "").trim();
  if (!s) return "";
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return s.slice(0, 10);
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return s.slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(ms));
  } catch { return s.slice(0, 10); }
}

/** The last instant the page looks as far as. */
export function upcomingHorizonMs(
  today: string,
  days: number = UPCOMING_DAYS,
  tz: string = BUSINESS_DAY_DEFAULT_TZ,
): number {
  const n = Math.round(Number(days));
  const span = Number.isFinite(n) && n > 0 ? n : UPCOMING_DAYS;
  // `days` counts today, so a seven-day window ends at the end of today + 6.
  return parseWallClockInTz(`${addIsoDays(today, span - 1)}T23:59`, tz);
}

/**
 * Soonest first.
 *
 * Two appointments in the same minute are separated by borrower and then by
 * id, so the wall never reorders two rows between polls for no reason. A
 * date-only row sits at the end of its own day: the board does not know when
 * it is, and guessing 9am would put it above meetings that have a real time.
 */
export function compareUpcoming(a: UpcomingAppointment, b: UpcomingAppointment): number {
  return (a.atMs - b.atMs)
    || String(a?.borrower ?? "").localeCompare(String(b?.borrower ?? ""))
    || ((a?.id ?? 0) - (b?.id ?? 0));
}

/**
 * The appointments that are genuinely still coming.
 *
 * Four rules, in this order:
 *
 *  1. It is still an appointment. See UPCOMING_APPOINTMENT_TYPE — transferred,
 *     fell-through and converted rows all announce themselves by carrying a
 *     different outcome_type, and a row that was merely REBOOKED keeps the
 *     type and carries its new time in the same two columns, so it flows
 *     through here on its new slot — which appointmentStamp reads out of
 *     follow_up_date, because a rebooking that predates the mirror left the
 *     abandoned time behind in appointment_datetime.
 *  2. It has a time at all. An appointment with neither column filled is a row
 *     somebody has not finished; it belongs on the Appointments page's "No
 *     Date Set" list, not on a wall that claims to say what is coming up.
 *  3. It has not already happened. Measured against `nowMs`, not against
 *     midnight: a 9am appointment is not "coming up" at two in the afternoon,
 *     and a board still listing it is worse than a board listing nothing.
 *  4. It is inside the horizon.
 *
 * `today` is the PLAIN calendar date in the office's zone, deliberately not
 * the 7pm business day — the same split the check-ins make. At 7:15pm the
 * business day is already tomorrow, and anchoring on it would hide an
 * appointment at 8pm tonight and label tomorrow's as "Today".
 */
export function selectUpcomingAppointments(
  rows: UpcomingApptRow[] | null | undefined,
  opts: { nowMs: number; today: string; days?: number; tz?: string },
): UpcomingAppointment[] {
  const tz = opts?.tz || BUSINESS_DAY_DEFAULT_TZ;
  const today = String(opts?.today ?? "");
  const throughMs = upcomingHorizonMs(today, opts?.days ?? UPCOMING_DAYS, tz);
  const nowMs = Number(opts?.nowMs);
  const out: UpcomingAppointment[] = [];
  for (const r of rows ?? []) {
    if (String(r?.outcomeType ?? "") !== UPCOMING_APPOINTMENT_TYPE) continue;
    const at = appointmentStamp(r, tz);
    if (!at) continue;
    const atMs = appointmentInstantMs(at, tz);
    if (!Number.isFinite(atMs)) continue;
    if (Number.isFinite(nowMs) && atMs < nowMs) continue;
    if (Number.isFinite(throughMs) && atMs > throughMs) continue;
    const day = appointmentDay(at, tz);
    out.push({
      id: Math.round(Number(r?.id)) || 0,
      // Named, or said out loud as unnamed. A blank cell on a wall reads as a
      // broken query, not as a row somebody left half-filled.
      borrower: String(r?.borrower ?? "").trim().slice(0, 80) || "A borrower",
      clr: String(r?.clr ?? "").trim().slice(0, 80) || "A CLR",
      lo: String(r?.lo ?? "").trim().slice(0, 80) || null,
      at, atMs, timed: !isDateOnlyStamp(at), day, isToday: day === today,
    });
  }
  return out.sort(compareUpcoming);
}
