/**
 * comp-floor.ts — the monthly transfer floor, pro-rated by the weekdays a CLR
 * was actually here.
 *
 * Ethan: "in the final MTD [end of month] email, make it so that the minimum
 * floor of 75 is subtracted by weekdays that were off or sick (any that had no
 * activity of any sort)."
 *
 * So: 75 transfers is the bar for a WHOLE month of weekdays. A CLR who was off
 * for part of the month faces a smaller bar, in proportion to the weekdays they
 * were here. Nothing in this file decides what happens to anybody's money — it
 * produces the adjusted floor, the weekdays off, and a met / not-met verdict,
 * and that is deliberately all it produces. See "WHAT THIS DOES NOT DO" below.
 *
 * Everything here is arithmetic over plain values — no database, no cron, no
 * imports from routes.ts — the same shape as server/comp-auto-file.ts and
 * server/tv-pages.ts, so every rule can be tested without booting the server.
 *
 * ── THE RULE, in words ─────────────────────────────────────────────────────
 *
 *  1. A weekday is Mon-Fri, exactly as server/business-day.ts's
 *     countWeekdaysInMonth counts them — that is the definition the comp email
 *     already uses one section higher (the projected branch), so the floor uses
 *     it too. NOT the Sunday-only rule in shared/pace-days.ts: that one is the
 *     scorecard's, it counts Saturday as a working day, and its own comment
 *     says not to merge the two.
 *
 *  2. A weekday counts as WORKED when there is a trace that this CLR was
 *     PRESENT that day, from any source (see ACTIVITY_SIGNALS). A weekday in
 *     the month with no such trace is OFF. Weekend days are never counted
 *     either way, so a CLR who was away all weekend is unaffected — which is
 *     the point.
 *
 *  3. adjusted floor = 75 x (weekdays worked / weekdays in the whole month),
 *     rounded DOWN to a whole transfer.
 *
 *     Ethan's phrasing is the subtraction form: each weekday off SUBTRACTS one
 *     day's share of the floor (75 / weekdays-in-month, about 3.4 in a
 *     22-weekday month). The two readings are the same arithmetic ONLY when
 *     every weekday of the month was in scope:
 *         75 - off x (75 / total) === 75 x (total - off) / total
 *             ...holds exactly when worked + off === total.
 *     That is false for every mid-month starter, every leaver, and every
 *     partial-month run, because those months also carry weekdaysOutOfScope
 *     days that are neither worked nor off. Then worked = total - off -
 *     outOfScope, the out-of-scope days lower the floor as well, and "75 minus
 *     days off" OVERSTATES the bar. The proportional form in the first line is
 *     the definition; the subtraction form is a shorthand that is exact only
 *     while weekdaysOutOfScope is 0. Every row reports both counts, so the
 *     email can show the working either way without having to guess.
 *
 *     The denominator is always the FULL month, so the numbers stay comparable
 *     between two CLRs who were off for different amounts of it.
 *
 *  4. Met means transfers >= adjusted floor. Exactly equal is MET: a floor is a
 *     minimum, and hitting it is hitting it.
 *
 * ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not withhold comp, change a rate, gate a bonus, or alter any amount.
 * Ethan has not said what missing the floor should DO, so nothing here decides
 * it. The email shows the floor, the days off and the verdict; what a miss is
 * worth is a decision for a human, and when that decision is made it belongs in
 * the caller, not in this file.
 *
 * ── ROUNDING, and why DOWN ─────────────────────────────────────────────────
 *
 * The exact floor is usually fractional (18 of 22 weekdays worked = 61.36
 * transfers) and transfers are whole numbers, so a whole-number bar has to be
 * chosen. It rounds DOWN, so the published bar is never HIGHER than the exact
 * proportional share. This affects pay; when the arithmetic has to give, it
 * gives in the CLR's favour. `adjustedFloorExact` carries the unrounded number
 * for anyone who wants to show the working.
 *
 * ── ERRING TOWARD "WORKED", and its one limit ──────────────────────────────
 *
 * Marking a worked day as OFF docks a real day's worth off a real person's
 * floor for a day they were here. Every judgement call about AMBIGUOUS evidence
 * therefore falls the same way:
 *   - ANY signal, of any kind, in any quantity, makes the day worked. One
 *     check-in with nothing after it counts. There is no "enough activity"
 *     threshold and there must not be one.
 *   - Activity beats every other input. A day with a trace is worked even if it
 *     sits outside the CLR's recorded employment window, and even if approved
 *     time off was booked for it.
 *
 * The limit — and it is the whole reason this file exists — is that a row which
 * RECORDS AN ABSENCE is not ambiguous evidence of presence. It is evidence of
 * the opposite. When a manager marks somebody absent or late-without-check-in,
 * C3 writes a row on that person's date; reading it as "a trace, therefore
 * worked" reclassifies precisely the days this floor is meant to catch. Erring
 * toward worked resolves doubt. It does not overrule a record that says the
 * person was not here. See the morning_checkins entry in ACTIVITY_SIGNALS.
 *
 * The caller passes the activity in. This file never queries — see
 * ACTIVITY_SIGNALS for the full list of traces C3 records, and union them all.
 */
import { isIsoDate, isPeriod, monthLabel, periodOf, lastDayOfPeriod } from "./comp-auto-file";
import { businessTodayInTz, BUSINESS_DAY_DEFAULT_TZ, BUSINESS_DAY_ROLLOVER_HOUR } from "./business-day";

// ── the constants ───────────────────────────────────────────────────────────

/** Ethan: "the minimum floor of 75". Transfers, for a full month of weekdays. */
export const FULL_MONTH_TRANSFER_FLOOR = 75;

/** Halves and every other fraction go DOWN — never round a pay bar upward. */
export const FLOOR_ROUNDING: "down" = "down";

/**
 * Approved time off is treated EXACTLY like sickness or any other day away: the
 * day is off, and it lowers the floor by its one day's share.
 *
 * The alternative — lifting approved leave out of the month entirely, dropping
 * it from the denominator as well — is a harsher rule, not a kinder one: a CLR
 * with 5 approved days who worked the other 17 of 22 weekdays would face
 * 75 x 17/17 = 75 rather than 75 x 17/22 = 57. That is a decision about
 * somebody's pay that has not been asked for, so it is not made here.
 *
 * Approved leave is still reported separately (approvedLeaveWeekdaysOff), so
 * the email can show "4 days off, 3 of them approved leave" without this file
 * deciding anything. If Ethan wants leave excluded from the month instead, this
 * flag and the one branch in compFloorForClr() are the change.
 */
export const APPROVED_LEAVE_REDUCES_FLOOR = true;

// ── the activity signals ────────────────────────────────────────────────────

export interface ActivitySignal {
  /** Stable key, usable for an activeDatesBySignal map. */
  key: string;
  /** What it means in plain words. */
  label: string;
  /**
   * Where the dates come from: table, the date column, the person column, and
   * — this part matters — the PREDICATE. A source listed without its predicate
   * is how "a manager marked you absent" became "you were here"; every entry
   * below carries the exact condition under which the row proves presence.
   */
  source: string;
  /**
   * Whether the date column is already a C3 business date, or a timestamp that
   * has to be converted with businessDateOf() before it means anything.
   *
   * C3's date columns ("date", "report_date", "log_date", "activity_date",
   * "session_date", "stat_date") are already Pacific business dates, written
   * through businessTodayForRequest / businessTodayInTz. The `*_at` columns are
   * instants — usually UTC, and SQLite's datetime('now') writes them with no
   * timezone marker at all. Slicing ten characters off one of those yields the
   * UTC calendar date, which is the wrong day for anything logged between 5pm
   * and midnight Pacific. Pass those through businessDateOf().
   */
  dateKind: "business_date" | "timestamp";
  /**
   * True for the sources that also feed the "active workday" union behind the
   * 20-workday training clock and transfers-per-working-day (server/routes.ts
   * clrAllTimeTotals / clrWorkdayRatesByUser, server/clr-workday-rate.ts).
   *
   * "Canonical" means the same TABLE, not necessarily the same predicate. Two
   * of the seven are read differently here, on purpose, and both differences
   * are recorded in the entries below: the floor ignores manager-written
   * check-in rows, and the floor accepts an all-zero EOD report. The training
   * clock counts up toward a 20-day ramp, where a stray extra day costs a
   * trainee nothing; this file looks for the days somebody was NOT here, where
   * the same stray day raises a pay bar. The two questions are not the same
   * question, so the two predicates are not the same predicate.
   */
  canonical: boolean;
  /**
   * True when the table holds ONE row per person, overwritten in place, so its
   * timestamp can only ever name a single date for all time. Such a source is
   * near-useless across a month and must never be presented as coverage; it is
   * listed only so nobody rediscovers it and wires it up believing it works.
   * PER_DAY_ACTIVITY_SIGNALS is this list with them removed.
   */
  singleRowPerUser?: boolean;
  note?: string;
}

/**
 * Every per-person, per-day trace C3 records that PROVES SOMEBODY WAS PRESENT,
 * as far as this file's author could find them. The caller unions the ones it
 * can read.
 *
 * ── which direction the risk runs ──
 *
 * The intuition that "more sources is always safer" is backwards here, and the
 * comment that used to sit in this spot said so out loud. Work it through:
 * every extra source can only move a day from OFF to WORKED. More worked days
 * is a bigger numerator; a bigger numerator is a HIGHER floor; a higher floor
 * is a HARSHER bar. So:
 *
 *   - Adding a signal RAISES the floor. Omitting one LOWERS it.
 *   - A WRONG signal — one that fires on a day nobody was here — is therefore
 *     the dangerous kind. It charges a real person a full day's share of the
 *     bar for a day they were absent, which is the exact failure this feature
 *     exists to prevent.
 *   - A MISSING signal only ever makes the bar kinder. It is still a bug and it
 *     should still be fixed, but it does not take money off anybody.
 *
 * The test for adding a source is therefore not "is it a row with a person and
 * a date on it" but "does a row here PROVE a human was at work on that date".
 * Rows that a manager, a cron, or a polling feed can write about an absent
 * person fail that test, and the predicates below are what keep them out.
 *
 * This list is documentation with a type on it — nothing here queries.
 */
export const ACTIVITY_SIGNALS: readonly ActivitySignal[] = [
  // ---- the canonical seven (same tables as the training clock) -------------
  {
    key: "lead_outcomes",
    label: "Lead outcomes logged (transfers, appointments, fell-through, callbacks, no-answer, deferrals, future contacts)",
    source: "lead_outcomes.date / assistant_id",
    dateKind: "business_date", canonical: true,
  },
  {
    key: "daily_call_logs",
    label: "Calls logged for the day",
    source: "daily_call_logs.log_date / assistant_id, calls_made > 0",
    dateKind: "business_date", canonical: true,
  },
  {
    key: "callsync_activity_events",
    label: "CallTools/CallSync call + disposition events",
    source: "callsync_activity_events.activity_date / assistant_id",
    dateKind: "business_date", canonical: true,
    note: "Written only for a calltools.outcome carrying a contact key, or a calltools.call with active seconds — that is, a dispositioned call. A CallTools day that produced active seconds but no disposition leaves NO row here; it shows up in callsync_agent_activity_daily instead, which is why that signal is also on this list.",
  },
  {
    key: "eod_reports",
    label: "An end-of-day report was submitted, whatever the numbers on it say",
    source: "eod_reports.report_date / assistant_id — ANY submitted row",
    dateKind: "business_date", canonical: true,
    note: "DELIBERATELY NOT the training clock's predicate. That union requires one of calls_made / messages_sent / additional_conversations / calltools_conversations / calltools_active_seconds / dialpad_calls / transfers / appointments to be > 0, so a filed report with all-zero counters does not count there. Here it must count: POST /api/eod-reports refuses a report with no written note (\"Notes are required - say how the day went\") and refuses unanswered accountability questions, so a row in this table is a written account of a day, typed by a person, on a day they were at work. A quiet day is still a day at work. Reading zeroes as absence would dock the floor of exactly the people who showed up and filed.",
  },
  {
    key: "dialpad_daily_stats",
    label: "Dialpad calls",
    source: "dialpad_daily_stats.stat_date / user_id, calls > 0",
    dateKind: "business_date", canonical: true,
  },
  {
    key: "morning_checkins",
    label: "A real morning check-in — one the CLR submitted themselves",
    source: "morning_checkins.date / user_id, manually_marked_late = 0",
    dateKind: "business_date", canonical: true,
    note: "THE PREDICATE IS LOAD-BEARING; without it this signal inverts the whole feature. A row in this table does not mean somebody was here. POST /api/checkin/manual-lates lets a manager record that a person who never checked in was late or absent, and storage.markMissingCheckinLate() INSERTS a morning_checkins row for that date with manually_marked_late=1, on_time=0, and checked_in_at set to the moment the MANAGER clicked. Reading 'any row' as presence therefore turns every marked absence into a worked day — precisely the days this floor exists to find. The check-in page already draws this exact line (isRealCheckin = checkin && !manually_marked_late) and so does this signal. Somebody who genuinely worked but never checked in is not harmed: their calls, outcomes, EOD or clock punch land in the other signals. Excused absences never reach this table at all — storage.assertNoAttendanceCheckin refuses an absence excuse when a check-in row exists, and they live in attendance_excuse_requests instead — so an excused absence is already not a signal here.",
  },
  {
    key: "time_clock_entries",
    label: "Time clock punch",
    source: "time_clock_entries.date(clock_in) / user_id",
    dateKind: "business_date", canonical: true,
    note: "clock_in is an instant, but the training clock reads it as date(clock_in) and that is the shape callers already have. If reading the raw column instead, convert it with businessDateOf().",
  },

  // ---- other dialing platforms C3 records per CLR per day ------------------
  {
    key: "mojo_sessions",
    label: "A Mojo dialer session",
    source: "mojo_sessions.session_date / clr_user_id",
    dateKind: "business_date", canonical: false,
    note: "A whole dialing platform the canonical seven cannot see. POST /api/mojo/import/csv aggregates a call export per (date, agent) and writes mojo_sessions and mojo_contacts — and nothing else: no lead_outcomes, no daily_call_logs, no callsync rows. So a day covered only by a Mojo import leaves no trace in any canonical source and reads as a day off. The webhook path (source='webhook') writes the same table.",
  },
  {
    key: "callsync_agent_activity_daily",
    label: "CallTools active seconds accumulated for the day",
    source: "callsync_agent_activity_daily.activity_date / assistant_id, active_seconds > 0",
    dateKind: "business_date", canonical: false,
    note: "The ONLY table the calltools.agent_activity webhook writes, so a CLR whose CallTools day produced active-second heartbeats but no dispositioned call has no CallTools trace anywhere else. The predicate is required, and it is the same trap as morning_checkins: the feed writes a row for EVERY polled agent, including agents sitting at zero seconds, and the schema says so in as many words ('observed_at is a FEED heartbeat, not activity'). A bare row proves the poll ran, not that a person did. active_seconds > 0 (equivalently seconds_changed_at IS NOT NULL) is the part that means somebody worked.",
  },

  // ---- everything else C3 stamps with a person and a day ------------------
  // Any of these on their own means somebody was working. The canonical seven
  // are the tables other C3 features already agree on; these are the rest of
  // the traces, and the floor should use them because an EOD-less day spent on
  // training or admin is still not a day off.
  {
    key: "lead_source_outcomes",
    label: "Logged a result on the Input Results page",
    source: "lead_source_outcomes.date / assistant_id",
    dateKind: "business_date", canonical: false,
    note: "One row per CLR per day with its own business date, stamped from businessTodayForRequest at write time, and missing from the canonical union entirely. One caveat: a manager may log on behalf of a CLR, in which case assistant_id is the CLR and the typing was somebody else's. Unlike a schedule approval, what is being recorded IS that CLR's work, so it stays a presence signal.",
  },
  {
    key: "eod_activities",
    label: "EOD 'additional activity' line items (follow-ups, emails, LO contact, training, project work, admin)",
    source: "eod_activities.report_date / assistant_id",
    dateKind: "business_date", canonical: false,
    note: "Largely redundant now that eod_reports no longer demands non-zero counters. Kept because a line item can exist for a report row a given caller did not read.",
  },
  {
    key: "clr_task_completions",
    label: "Assigned CLR task marked complete",
    source: "clr_task_completions.completed_at / completed_by_user_id",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "chat_messages",
    label: "Team chat message (or a 'Grab It' lead claim)",
    source: "chat_messages.created_at / user_id, and claimed_at / claimed_by",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "shotgun_offer_events",
    label: "Answered a Shotgun lead offer",
    source: "shotgun_offer_events.responded_at / user_id (response != 'pending')",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "shotgun_readiness",
    label: "Marked themselves ready for Shotgun leads",
    source: "shotgun_readiness.heartbeat_at / user_id",
    dateKind: "timestamp", canonical: false, singleRowPerUser: true,
    note: "WARNING — one row per (org_id, user_id), overwritten in place, so heartbeat_at can only ever yield ONE date for all time: the most recent one. It says nothing about the rest of the month, and if it is the only signal a caller wires up, 21 of a month's 22 weekdays read as absent. Exactly the defect already flagged on eod_drafts. Use it alongside real per-day sources, or not at all — see PER_DAY_ACTIVITY_SIGNALS.",
  },
  {
    key: "lap_result_events",
    label: "Acted on a LAP result package (upload, note, link)",
    source: "lap_result_events.created_at / actor_user_id",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "lap_package_notes",
    label: "Wrote a LAP package / lead note",
    source: "lap_package_notes.created_at / author user id",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "training_test_attempts",
    label: "Took the CLR training test",
    source: "training_test_attempts.taken_at / user_id",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "comp_requests",
    label: "Filed or edited a comp request",
    source: "comp_requests.requested_at / created_at / user_id",
    dateKind: "timestamp", canonical: false,
    note: "Also comp_requests.training_dates — the days a CLR spent training someone else, which is work with no calls on it. Those are business dates already, not instants.",
  },
  {
    key: "forum_posts",
    label: "Posted or answered in the forum",
    source: "forum_posts.created_at, forum_answers.created_at / author user id",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "app_reviews",
    label: "Filed an app review / suggestion",
    source: "app_reviews.created_at / user_id",
    dateKind: "timestamp", canonical: false,
  },
  {
    key: "audit_logs",
    label: "Anything the audit log attributes to them",
    source: "audit_logs.created_at / user_id",
    dateKind: "timestamp", canonical: false,
    note: "The broadest net available — an audited action is proof of presence, because user_id on an audit row is the ACTOR.",
  },
  {
    key: "notification_reads",
    label: "Read a notification in the app",
    source: "notification_reads.read_at / user_id",
    dateKind: "timestamp", canonical: false,
    note: "Presence, not productivity. Included because the question asked is 'was there ANY trace', not 'did they produce'.",
  },
  {
    key: "manager_summons",
    label: "Raised or cleared a manager summons",
    source: "manager_summons.raised_at / raised_by, cleared_at / cleared_by",
    dateKind: "timestamp", canonical: false,
    note: "Keyed on the ACTOR columns deliberately. manager_summons.user_id is the person summoned, which would be somebody else's presence.",
  },
  {
    key: "attendance_excuse_requests",
    label: "Filed their OWN late/absence excuse",
    source: "attendance_excuse_requests.requested_at / requested_by_user_id, requested_via IN ('app','portal')",
    dateKind: "timestamp", canonical: false,
    note: "Two separate traps here. (1) An excuse filed FOR a day says nothing about whether that day was worked — only the day it was FILED on is a trace, so read requested_at and never attendance_date. (2) An admin-recorded absence excuse is stored with requested_via='admin' and requested_by_user_id set to the ADMIN, so without the requested_via filter a manager's act of excusing somebody can be read as that manager's presence, or worse be joined back onto the subject. Only a self-filed request is the subject's own act.",
  },
  {
    key: "eod_drafts",
    label: "Started an EOD draft",
    source: "eod_drafts.updated_at / user_id",
    dateKind: "timestamp", canonical: false, singleRowPerUser: true,
    note: "WARNING — user_id is UNIQUE, so one row per user overwritten in place: only ever evidence about the most recent draft, never about a month.",
  },

  // ---- REMOVED, and why ---------------------------------------------------
  // weekly_schedules used to sit here as "Submitted or edited their weekly
  // schedule / weekly_schedules.submitted_at / updated_at / user_id". It was
  // wrong twice over and no predicate repairs it:
  //   1. A MANAGER's review writes to it. Reviewing a schedule runs
  //      "UPDATE weekly_schedules SET status=?, reviewer_note=?, reviewed_by=?,
  //      reviewed_at=?, updated_at=? WHERE id=? AND org_id=?" on a row keyed to
  //      the CLR's user_id — so following the inventory as written marked a CLR
  //      present on whatever day their manager happened to approve them.
  //   2. There is only ever ONE row per CLR in any case. Schedules are a single
  //      STANDING row (week_start = 'standing', UNIQUE(org_id, user_id,
  //      week_start)) overwritten in place: the eod_drafts defect again.
  // And a schedule is a statement of future intent, not a trace of a day worked.
];

/** The signals every other C3 feature already agrees on the table for. */
export const CANONICAL_ACTIVITY_SIGNALS: readonly ActivitySignal[] =
  ACTIVITY_SIGNALS.filter((s) => s.canonical);

/**
 * The signals that can actually describe a whole month — everything except the
 * one-row-per-user tables, whose timestamp names a single date no matter how
 * long the month is. This is the list a caller should wire up; the full
 * ACTIVITY_SIGNALS exists so the excluded ones stay documented rather than
 * being rediscovered and trusted.
 */
export const PER_DAY_ACTIVITY_SIGNALS: readonly ActivitySignal[] =
  ACTIVITY_SIGNALS.filter((s) => !s.singleRowPerUser);

/** Signals whose column is a raw instant and MUST go through businessDateOf(). */
export const TIMESTAMP_ACTIVITY_SIGNALS: readonly ActivitySignal[] =
  ACTIVITY_SIGNALS.filter((s) => s.dateKind === "timestamp");

// ── date helpers ────────────────────────────────────────────────────────────

/**
 * Mon-Fri, built at NOON UTC.
 *
 * Same construction as server/business-day.ts's isWeekday and
 * shared/pace-days.ts's isSunday, and for the same reason: a date pinned at
 * midnight can be nudged onto the adjacent calendar day by a DST offset, and an
 * adjacent day is a different weekday. Noon leaves twelve hours of slack.
 */
export function isWeekdayIso(iso: unknown): boolean {
  if (!isIsoDate(iso)) return false;
  const s = String(iso);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Every Mon-Fri date in a "YYYY-MM" period, ascending.
 *
 * The list form of countWeekdaysInMonth: the count matches it exactly (there is
 * a test that says so), and the dates are what lets this file intersect the
 * month with a CLR's activity.
 */
export function monthWeekdays(period: unknown): string[] {
  if (!isPeriod(period)) return [];
  const p = String(period);
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const iso = `${p}-${String(day).padStart(2, "0")}`;
    if (isWeekdayIso(iso)) out.push(iso);
  }
  return out;
}

/** Anything a caller might hand over as "the day this happened". */
export type ActivityDateInput = string | number | Date | null | undefined;

/**
 * The timezone every C3 business date is expressed in, re-exported so a caller
 * does not have to reach into business-day.ts to name it.
 */
export const COMP_FLOOR_TIME_ZONE = BUSINESS_DAY_DEFAULT_TZ;

/** The hour the C3 business day rolls over, in COMP_FLOOR_TIME_ZONE. 7pm. */
export const COMP_FLOOR_ROLLOVER_HOUR = BUSINESS_DAY_ROLLOVER_HOUR;

/**
 * A bare "YYYY-MM-DD HH:MM[:SS[.sss]]" or "YYYY-MM-DDTHH:MM[:SS[.sss]]" with no
 * Z and no +/-offset. SQLite writes exactly this shape for every C3 column
 * defaulting to datetime('now'), and it means UTC — but `new Date()` reads the
 * space form as LOCAL time, so the same stored row would resolve differently on
 * a laptop in Los Angeles and on the Railway box in UTC. It has to be pinned by
 * hand.
 */
const NAIVE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/**
 * Does this "YYYY-MM-DD" name a day that exists?
 *
 * isIsoDate() checks the SHAPE only, so "2026-13-99" and "2026-02-30" pass it.
 * Left alone they travel on as if they were dates: Date.UTC overflows them
 * onto some real day months away (2026-13-99 lands in April 2027), which can
 * make junk read as a weekday. Nothing may be called a business date unless it
 * survives a round trip.
 */
function isRealCalendarDate(iso: string): boolean {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Turn anything into the C3 BUSINESS DATE it belongs to, or null.
 *
 * This is the only correct way to get a date out of a `*_at` column, and it is
 * exported because the alternative — slicing the first ten characters — is a
 * bug this codebase has already shipped more than once. A ten-character slice
 * yields the UTC calendar date. C3's business date is Pacific and it rolls over
 * at 7pm, so between 5pm and midnight Pacific the UTC slice names TOMORROW:
 *
 *   2026-09-16T01:30:00Z  =  2026-09-15 18:30 PT  ->  business date 2026-09-15
 *                            ...the naive slice says 2026-09-16. Wrong day —
 *                            and on the 30th, the wrong MONTH, which drops the
 *                            day out of the report altogether.
 *   2026-09-16T02:30:00Z  =  2026-09-15 19:30 PT  ->  business date 2026-09-16
 *                            ...past 7pm, so this one really is the next day.
 *
 * A value that is ALREADY a plain "YYYY-MM-DD" is returned untouched: C3's date
 * columns are business dates written through businessTodayForRequest, and
 * re-interpreting one as midnight-in-some-zone would shift it. It still has to
 * name a day that exists — "2026-02-30" is a shape, not a date.
 *
 * A number is read as epoch milliseconds, because that is what Date.parse hands
 * back. A meaningless small integer therefore resolves to a 1970-era date
 * rather than to null; compFloorForClr keeps only dates inside the period being
 * reported, so such a value can never reach a floor.
 */
export function businessDateOf(
  value: ActivityDateInput,
  tz: string = COMP_FLOOR_TIME_ZONE,
): string | null {
  if (value === null || value === undefined) return null;
  const at = (d: Date): string | null =>
    Number.isFinite(d.getTime()) ? businessTodayInTz(tz, d) : null;
  if (value instanceof Date) return at(value);
  if (typeof value === "number") return Number.isFinite(value) ? at(new Date(value)) : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "") return null;
  if (isIsoDate(s)) return isRealCalendarDate(s) ? s : null;
  const naive = NAIVE_TIMESTAMP.exec(s);
  if (naive) return at(new Date(`${naive[1]}T${naive[2]}Z`));
  return at(new Date(s));
}

/**
 * businessDateOf over a list. Junk is dropped, order is preserved and
 * duplicates are kept — this is the raw conversion, not the union.
 */
export function businessDatesOf(
  values: ReadonlyArray<ActivityDateInput> | null | undefined,
  tz: string = COMP_FLOOR_TIME_ZONE,
): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const iso = businessDateOf(values[i] as ActivityDateInput, tz);
    if (iso !== null) out.push(iso);
  }
  return out;
}

/**
 * Union any number of per-signal date lists into one sorted, de-duplicated set
 * of C3 business dates.
 *
 * Every value goes through businessDateOf(), so a caller who hands over raw
 * `*_at` timestamps gets correct Pacific business dates instead of silently
 * getting UTC ones. There is no path through this function that produces a UTC
 * date. Plain "YYYY-MM-DD" values pass through untouched.
 *
 * The junk tolerance is real and load-bearing: this runs over a whole team's
 * month, and one malformed row must neither take the report down nor quietly
 * zero somebody out. Nulls, blanks, unparseable strings, plain objects and
 * non-array sources are dropped. A bare Date, a bare epoch number or a bare
 * date string handed in where a list was expected is treated as a one-element
 * list rather than iterated character by character — that read as "no activity
 * at all", and a CLR with no activity gets a floor of 0.
 */
export function unionActiveDates(
  ...sources: Array<ActivityDateInput | ReadonlyArray<ActivityDateInput>>
): string[] {
  const seen = new Set<string>();
  const take = (value: ActivityDateInput) => {
    const iso = businessDateOf(value);
    if (iso !== null) seen.add(iso);
  };
  for (let s = 0; s < sources.length; s += 1) {
    const list = sources[s];
    if (list === null || list === undefined) continue;
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i += 1) take(list[i] as ActivityDateInput);
      continue;
    }
    if (typeof list === "string" || typeof list === "number" || list instanceof Date) {
      take(list as ActivityDateInput);
      continue;
    }
    // Anything else (a plain object, a Map, a Set) is not a shape this function
    // promises to understand. Dropping it beats throwing inside a monthly email.
  }
  return Array.from(seen).sort();
}

// ── inputs ──────────────────────────────────────────────────────────────────

/** One CLR's month, as the caller reads it out of the database. */
export interface ClrMonthActivity {
  userId: number;
  name?: string | null;
  /** Transfers logged in the period — the number the floor is compared to. */
  transfers: number;
  /**
   * Every date this CLR left a trace of being present, from every source the
   * caller can read. Any order, duplicates fine, weekends fine (they are
   * ignored), dates outside the month fine (they are ignored). Business dates
   * and raw timestamps may be mixed: timestamps are converted, never sliced.
   */
  activeDates?: ReadonlyArray<ActivityDateInput>;
  /**
   * The same thing kept per signal, for callers that would rather hand over
   * their query results one source at a time. Unioned with activeDates; the two
   * are interchangeable and may both be given.
   */
  activeDatesBySignal?: Record<string, ReadonlyArray<ActivityDateInput> | null | undefined> | null;
  /**
   * Dates covered by an APPROVED time-off request. Reporting only: these do not
   * change the floor (see APPROVED_LEAVE_REDUCES_FLOOR), they only split the
   * days off into "approved leave" and "unexplained" so the email can say which
   * is which. A day with activity on it is worked regardless of what is here.
   */
  approvedTimeOffDates?: ReadonlyArray<ActivityDateInput>;
  /** users.start_date — employment start, if known. Weekdays before it are not theirs. */
  startDate?: string | null;
  /** Last day on the team, if known. Weekdays after it are not theirs. */
  endDate?: string | null;
  /** users.exclude_from_stats — passed straight through; see the note on CompFloorRow. */
  excludeFromStats?: boolean;
}

export interface CompFloorOptions {
  /**
   * The last date counted, ISO. Defaults to the last day of the period, which
   * is what the end-of-month email wants. Pass a mid-month date and the floor
   * pro-rates to the weekdays elapsed so far — the same arithmetic, applied to
   * a shorter month, and the row is marked partialMonth.
   *
   * It is a HARD bound, on the numerator as well as on the scope: activity
   * dated after it is reported in a note and not counted. Letting a
   * late-arriving row past `through` would push the worked count above the
   * elapsed weekdays and so RAISE the bar, which is the one direction a
   * pro-rate must never move.
   */
  through?: string | null;
  /** Override the base floor. Exists for tests and for a future per-CLR floor. */
  baseFloor?: number;
}

// ── output ──────────────────────────────────────────────────────────────────

export interface CompFloorRow {
  userId: number;
  name: string;
  /** Transfers in the period, as given (coerced to a whole number >= 0). */
  transfers: number;
  /** The unpro-rated floor — 75 unless the caller overrode it. Always finite. */
  baseFloor: number;
  /** The bar this CLR actually faces: whole transfers, rounded DOWN. */
  adjustedFloor: number;
  /** The same number unrounded, for showing the working. */
  adjustedFloorExact: number;
  /** What one weekday off costs: baseFloor / weekdaysInMonth. */
  floorPerWeekday: number;
  /** Mon-Fri days in the whole calendar month — always the denominator. */
  weekdaysInMonth: number;
  /** Weekdays that were this CLR's to work (employment window, `through`, plus any day they were demonstrably active). */
  weekdaysInScope: number;
  /** In-scope weekdays with at least one trace of them. */
  weekdaysWorked: number;
  /** In-scope weekdays with no trace of any kind — what reduces the floor. */
  weekdaysOff: number;
  /** Of those, the ones covered by an approved time-off request. */
  approvedLeaveWeekdaysOff: number;
  /** Of those, the ones with no approved time off behind them. */
  unexplainedWeekdaysOff: number;
  /** Weekdays that were never theirs: before they started, after they left, after `through`. */
  weekdaysOutOfScope: number;
  /** The actual dates they were off, ascending — so a person can be shown WHY. */
  offDates: string[];
  /** In-month weekdays with activity that fell after `through`, and so was not counted. */
  activeDatesAfterThrough: string[];
  /** transfers >= adjustedFloor. Exactly equal counts as met. */
  met: boolean;
  /** How many transfers short they were; 0 when met. */
  shortBy: number;
  /** No trace at all on any weekday of the month. Their floor is 0 — read the note. */
  noActivityAllMonth: boolean;
  /** The window stopped before the month did. */
  partialMonth: boolean;
  /** users.exclude_from_stats, passed through untouched. */
  excludeFromStats: boolean;
  /** Plain-words caveats for this row, safe to print in the email. */
  notes: string[];
}

export interface CompFloorReport {
  period: string;
  monthLabel: string;
  /** Last date counted (the month's last day unless the caller narrowed it). */
  through: string;
  baseFloor: number;
  weekdaysInMonth: number;
  partialMonth: boolean;
  rows: CompFloorRow[];
}

// ── the arithmetic ──────────────────────────────────────────────────────────

function wholeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * The base floor a caller actually gets, plus a note when their override was
 * not usable.
 *
 * A non-finite override (NaN, Infinity, "abc") used to produce an incoherent
 * row: baseFloor and floorPerWeekday came out Infinity — or 0, for NaN — while
 * the floor itself came out 0, so every CLR silently "met" a bar of nothing and
 * the email said so in as many words. A row has to be internally consistent or
 * it cannot be printed, so an unusable override falls back to the documented
 * default and says out loud that it did. A negative override is unusable for
 * the same reason. An explicit 0 is honoured — unusual, but a real request.
 */
function resolveBaseFloor(raw: unknown): { baseFloor: number; note: string | null } {
  if (raw === undefined || raw === null) return { baseFloor: FULL_MONTH_TRANSFER_FLOOR, note: null };
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return { baseFloor: n, note: null };
  return {
    baseFloor: FULL_MONTH_TRANSFER_FLOOR,
    note: `Ignored an unusable base floor (${String(raw)}) and used the standard ${FULL_MONTH_TRANSFER_FLOOR}.`,
  };
}

/**
 * The floor for `worked` of `total` weekdays.
 *
 *   exact = base x worked / total          (worked/total capped into 0..1)
 *   floor = the whole transfers below it
 *
 * Written as (base x worked) / total rather than base x (worked/total) so that
 * whenever the true answer IS a whole number the division lands on it exactly —
 * integer over integer is correctly rounded in IEEE 754, so no epsilon fudge is
 * needed to stop 75 arriving as 74.99999999999999 and rounding down to 74.
 */
export function proratedFloor(base: number, worked: number, total: number): { exact: number; floor: number } {
  const b = Number.isFinite(Number(base)) ? Math.max(0, Number(base)) : 0;
  const t = wholeCount(total);
  const w = Math.min(wholeCount(worked), t);
  if (b === 0 || t === 0) return { exact: 0, floor: 0 };
  const exact = (b * w) / t;
  return { exact, floor: Math.max(0, Math.floor(exact)) };
}

/**
 * One CLR's floor for one month.
 *
 * The scope — which weekdays were theirs to work — is the month's weekdays,
 * narrowed by `through` and by their employment window, and then WIDENED again
 * by any weekday they were demonstrably active on. That last step is the
 * err-toward-worked rule in code: if the dates say somebody was not employed on
 * the 3rd but the 3rd has their transfers on it, the dates are what is wrong,
 * and the day counts as worked rather than silently vanishing.
 *
 * `through` is the one bound that widening does NOT cross. An employment window
 * is a guess about somebody's dates and activity can correct it; `through` is
 * the caller saying how much of the month to count, and pushing the worked
 * count past it raises the bar using a part of the month that has not been
 * counted for anybody.
 */
export function compFloorForClr(
  period: string,
  clr: ClrMonthActivity,
  opts: CompFloorOptions = {},
): CompFloorRow {
  const base = resolveBaseFloor(opts.baseFloor);
  const baseFloor = base.baseFloor;
  const monthDays = monthWeekdays(period);
  const weekdaysInMonth = monthDays.length;
  const transfers = wholeCount(clr?.transfers);
  const name = String(clr?.name ?? "").trim() || `CLR #${Number(clr?.userId) || 0}`;
  const notes: string[] = [];
  if (base.note) notes.push(base.note);

  // Everything the caller handed over, from every source, as one set. Only
  // weekdays inside this month can matter to this month's floor.
  const bySignal: Array<ReadonlyArray<ActivityDateInput> | null | undefined> = [];
  const signalMap = clr?.activeDatesBySignal;
  if (signalMap && typeof signalMap === "object") {
    const keys = Object.keys(signalMap);
    for (let i = 0; i < keys.length; i += 1) bySignal.push(signalMap[keys[i]]);
  }
  const activeAll = unionActiveDates(clr?.activeDates, ...bySignal);
  const activeInMonth = activeAll.filter((d) => isWeekdayIso(d) && periodOf(d) === String(period));

  // The window that was theirs.
  const monthEnd = lastDayOfPeriod(String(period));
  const throughRaw = isIsoDate(opts.through) ? String(opts.through) : monthEnd;
  const through = throughRaw < monthEnd ? throughRaw : monthEnd;
  const partialMonth = weekdaysInMonth > 0 && through < monthEnd;
  const startDate = isIsoDate(clr?.startDate) ? String(clr?.startDate) : null;
  const endDate = isIsoDate(clr?.endDate) ? String(clr?.endDate) : null;
  const employed = (d: string) =>
    (startDate === null || d >= startDate) && (endDate === null || d <= endDate);

  // `through` bounds the numerator, not merely the scope: a row dated after it
  // is reported and dropped, never allowed to inflate the worked count.
  const activeDatesAfterThrough = activeInMonth.filter((d) => d > through);
  const active = new Set(activeInMonth.filter((d) => d <= through));

  const scope = monthDays.filter((d) => d <= through && (employed(d) || active.has(d)));
  const workedDates = scope.filter((d) => active.has(d));
  const offDates = scope.filter((d) => !active.has(d));
  const outsideWindowButActive = workedDates.filter((d) => !employed(d));

  // Approved leave splits the days off in two and moves none of them: an
  // approved day away is off, and off lowers the floor by one day's share.
  // That is what APPROVED_LEAVE_REDUCES_FLOOR records, and the constant is
  // where the other reading would be turned on.
  const leave = new Set(
    unionActiveDates(clr?.approvedTimeOffDates).filter((d) => isWeekdayIso(d) && periodOf(d) === String(period)),
  );
  const approvedLeaveWeekdaysOff = offDates.filter((d) => leave.has(d)).length;

  const { exact, floor } = proratedFloor(baseFloor, workedDates.length, weekdaysInMonth);
  const met = transfers >= floor;

  if (!isPeriod(period)) notes.push(`"${String(period)}" is not a YYYY-MM month — nothing could be counted.`);
  if (partialMonth) notes.push(`Partial month: counted through ${through}, not ${monthEnd}.`);
  if (startDate && startDate > `${period}-01` && periodOf(startDate) === String(period)) {
    notes.push(`Started ${startDate} — weekdays before that are not counted against them.`);
  }
  if (endDate && endDate < monthEnd && periodOf(endDate) === String(period)) {
    notes.push(`Last day ${endDate} — weekdays after that are not counted against them.`);
  }
  if (outsideWindowButActive.length > 0) {
    notes.push(`Activity on ${outsideWindowButActive.length} weekday(s) outside their recorded dates — counted as worked.`);
  }
  if (activeDatesAfterThrough.length > 0) {
    notes.push(`Activity on ${activeDatesAfterThrough.length} weekday(s) after ${through} was not counted — the window stops there.`);
  }
  if (approvedLeaveWeekdaysOff > 0) {
    notes.push(`${approvedLeaveWeekdaysOff} of the ${offDates.length} weekday(s) off are approved time off; approved leave lowers the floor exactly like any other day away.`);
  }
  const noActivityAllMonth = weekdaysInMonth > 0 && workedDates.length === 0;
  if (noActivityAllMonth) {
    notes.push("No activity of any kind on any weekday this month, so the floor pro-rates to 0 and 'met' says nothing about them. Check whether they were on the team at all.");
  }
  if (clr?.excludeFromStats) {
    notes.push("Excluded from team stats (exclude_from_stats).");
  }

  return {
    userId: Number(clr?.userId) || 0,
    name,
    transfers,
    baseFloor,
    adjustedFloor: floor,
    adjustedFloorExact: exact,
    floorPerWeekday: weekdaysInMonth > 0 ? baseFloor / weekdaysInMonth : 0,
    weekdaysInMonth,
    weekdaysInScope: scope.length,
    weekdaysWorked: workedDates.length,
    weekdaysOff: offDates.length,
    approvedLeaveWeekdaysOff,
    unexplainedWeekdaysOff: offDates.length - approvedLeaveWeekdaysOff,
    weekdaysOutOfScope: weekdaysInMonth - scope.length,
    offDates,
    activeDatesAfterThrough,
    met,
    shortBy: Math.max(0, floor - transfers),
    noActivityAllMonth,
    partialMonth,
    excludeFromStats: !!clr?.excludeFromStats,
    notes,
  };
}

/**
 * Every CLR's floor for one month, in the order they were given.
 *
 * Sorting and grouping (who is shown, whether the exclude_from_stats crowd get
 * their own block) belong to whoever renders this, exactly as they do for the
 * comp table it will sit beside.
 */
export function buildCompFloorReport(
  period: string,
  clrs: ReadonlyArray<ClrMonthActivity> | null | undefined,
  opts: CompFloorOptions = {},
): CompFloorReport {
  const monthDays = monthWeekdays(period);
  const monthEnd = lastDayOfPeriod(String(period));
  const throughRaw = isIsoDate(opts.through) ? String(opts.through) : monthEnd;
  const through = throughRaw < monthEnd ? throughRaw : monthEnd;
  // The RAW override goes down to each row so the row carries its own note when
  // it was unusable; this field shows what was actually used.
  const baseFloor = resolveBaseFloor(opts.baseFloor).baseFloor;
  return {
    period: String(period),
    monthLabel: monthLabel(String(period)),
    through,
    baseFloor,
    weekdaysInMonth: monthDays.length,
    partialMonth: monthDays.length > 0 && through < monthEnd,
    rows: (Array.isArray(clrs) ? clrs : []).map((clr) =>
      compFloorForClr(period, clr, { through, baseFloor: opts.baseFloor })),
  };
}
