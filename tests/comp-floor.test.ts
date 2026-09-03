import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_MONTH_TRANSFER_FLOOR,
  APPROVED_LEAVE_REDUCES_FLOOR,
  ACTIVITY_SIGNALS,
  CANONICAL_ACTIVITY_SIGNALS,
  PER_DAY_ACTIVITY_SIGNALS,
  TIMESTAMP_ACTIVITY_SIGNALS,
  COMP_FLOOR_TIME_ZONE,
  COMP_FLOOR_ROLLOVER_HOUR,
  isWeekdayIso,
  monthWeekdays,
  businessDateOf,
  unionActiveDates,
  proratedFloor,
  compFloorForClr,
  buildCompFloorReport,
  type ClrMonthActivity,
} from "../server/comp-floor";
import { countWeekdaysInMonth } from "../server/business-day";

// ── fixtures ────────────────────────────────────────────────────────────────

/** September 2026: 22 weekdays. Written out so the tests do not lean on the
 *  same function they are checking. */
const SEP = "2026-09";
const SEP_WEEKDAYS = [
  "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
  "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
  "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18",
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25",
  "2026-09-28", "2026-09-29", "2026-09-30",
];
const SEP_WEEKEND = [
  "2026-09-05", "2026-09-06", "2026-09-12", "2026-09-13",
  "2026-09-19", "2026-09-20", "2026-09-26", "2026-09-27",
];

function clr(over: Partial<ClrMonthActivity> = {}): ClrMonthActivity {
  return { userId: 1, name: "Test CLR", transfers: 0, activeDates: SEP_WEEKDAYS, ...over };
}

// ── the calendar ────────────────────────────────────────────────────────────

test("weekdays are Mon-Fri, exactly as countWeekdaysInMonth counts them", () => {
  assert.deepEqual(monthWeekdays(SEP), SEP_WEEKDAYS);
  assert.equal(monthWeekdays(SEP).length, countWeekdaysInMonth(2026, 9));
  // Every month of 2026 agrees with the comp email's existing weekday rule.
  for (let m = 1; m <= 12; m += 1) {
    const period = `2026-${String(m).padStart(2, "0")}`;
    assert.equal(monthWeekdays(period).length, countWeekdaysInMonth(2026, m), period);
  }
  for (const d of SEP_WEEKEND) assert.equal(isWeekdayIso(d), false, d);
  for (const d of SEP_WEEKDAYS) assert.equal(isWeekdayIso(d), true, d);
  assert.deepEqual(monthWeekdays("not-a-month"), []);
});

test("unionActiveDates de-duplicates and drops junk", () => {
  assert.deepEqual(
    unionActiveDates(["2026-09-02", "2026-09-01"], ["2026-09-01"], null, undefined, ["", "nope", "2026-09-03T14:00:00"]),
    ["2026-09-01", "2026-09-02", "2026-09-03"],
  );
});

// ── the base case ───────────────────────────────────────────────────────────

test("a full month present faces the whole 75", () => {
  const r = compFloorForClr(SEP, clr({ transfers: 80 }));
  assert.equal(r.baseFloor, FULL_MONTH_TRANSFER_FLOOR);
  assert.equal(r.weekdaysInMonth, 22);
  assert.equal(r.weekdaysInScope, 22);
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.weekdaysOff, 0);
  assert.deepEqual(r.offDates, []);
  assert.equal(r.adjustedFloor, 75);
  assert.equal(r.adjustedFloorExact, 75);
  assert.equal(r.met, true);
  assert.equal(r.shortBy, 0);
  assert.equal(r.partialMonth, false);
  assert.equal(r.noActivityAllMonth, false);
});

test("a full month present and short is not met", () => {
  const r = compFloorForClr(SEP, clr({ transfers: 74 }));
  assert.equal(r.adjustedFloor, 75);
  assert.equal(r.met, false);
  assert.equal(r.shortBy, 1);
});

// ── days off ────────────────────────────────────────────────────────────────

test("four weekdays off take four days' worth off the floor", () => {
  const off = ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24"];
  const r = compFloorForClr(SEP, clr({
    transfers: 61,
    activeDates: SEP_WEEKDAYS.filter((d) => off.indexOf(d) < 0),
  }));
  assert.equal(r.weekdaysWorked, 18);
  assert.equal(r.weekdaysOff, 4);
  assert.deepEqual(r.offDates, off);
  // 75 x 18/22 = 61.36..., and one weekday is worth 75/22 = 3.409...
  assert.ok(Math.abs(r.adjustedFloorExact - (75 * 18) / 22) < 1e-9);
  assert.ok(Math.abs(r.floorPerWeekday - 75 / 22) < 1e-9);
  assert.equal(r.adjustedFloor, 61);
  assert.equal(r.met, true);
  assert.equal(r.shortBy, 0);
  // The same arithmetic read Ethan's way: 75 minus one day's share per day off.
  assert.ok(Math.abs(r.adjustedFloorExact - (75 - 4 * (75 / 22))) < 1e-9);
});

test("every weekday off leaves a floor of 0", () => {
  const r = compFloorForClr(SEP, clr({ transfers: 0, activeDates: [] }));
  assert.equal(r.weekdaysInScope, 22);
  assert.equal(r.weekdaysWorked, 0);
  assert.equal(r.weekdaysOff, 22);
  assert.deepEqual(r.offDates, SEP_WEEKDAYS);
  assert.equal(r.adjustedFloor, 0);
  assert.equal(r.adjustedFloorExact, 0);
  assert.equal(r.shortBy, 0);
  assert.equal(r.noActivityAllMonth, true);
});

test("a CLR with no activity at all is flagged, not quietly passed", () => {
  const r = compFloorForClr(SEP, clr({ transfers: 0, activeDates: [] }));
  // met is true only because a zero bar is trivially cleared. The row says so
  // out loud so the email never reads as "they hit their number".
  assert.equal(r.met, true);
  assert.equal(r.noActivityAllMonth, true);
  assert.ok(r.notes.some((n) => n.toLowerCase().includes("no activity")));
});

test("a weekend-only absence changes nothing", () => {
  const present = compFloorForClr(SEP, clr({ transfers: 75 }));
  // Same CLR, now also active on every weekend day.
  const alsoWeekends = compFloorForClr(SEP, clr({
    transfers: 75,
    activeDates: [...SEP_WEEKDAYS, ...SEP_WEEKEND],
  }));
  assert.equal(present.adjustedFloor, 75);
  assert.equal(alsoWeekends.adjustedFloor, 75);
  assert.equal(alsoWeekends.weekdaysWorked, 22);
  assert.equal(alsoWeekends.weekdaysOff, 0);
  assert.deepEqual(alsoWeekends.offDates, []);
});

test("duplicate and out-of-month dates cannot inflate the worked days", () => {
  const r = compFloorForClr(SEP, clr({
    transfers: 0,
    activeDates: [...SEP_WEEKDAYS, ...SEP_WEEKDAYS, "2026-08-31", "2026-10-01"],
  }));
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.adjustedFloor, 75);
});

// ── one signal is enough ────────────────────────────────────────────────────

test("a day with only ONE kind of activity still counts as worked", () => {
  // Every weekday carries exactly one trace, and a different one each day.
  const bySignal: Record<string, string[]> = {};
  SEP_WEEKDAYS.forEach((date, i) => {
    const key = ACTIVITY_SIGNALS[i % ACTIVITY_SIGNALS.length].key;
    (bySignal[key] ??= []).push(date);
  });
  const r = compFloorForClr(SEP, clr({ transfers: 75, activeDates: [], activeDatesBySignal: bySignal }));
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.adjustedFloor, 75);

  // And the narrowest possible case: one lone check-in, nothing else all month.
  const lone = compFloorForClr(SEP, clr({
    transfers: 0,
    activeDates: [],
    activeDatesBySignal: { morning_checkins: ["2026-09-15"] },
  }));
  assert.equal(lone.weekdaysWorked, 1);
  assert.equal(lone.weekdaysOff, 21);
  assert.equal(lone.adjustedFloor, 3); // 75 x 1/22 = 3.4 -> 3
  assert.ok(CANONICAL_ACTIVITY_SIGNALS.some((s) => s.key === "morning_checkins"));
});

// ── the boundary and the rounding ───────────────────────────────────────────

test("transfers exactly equal to the adjusted floor MEET it", () => {
  const off = ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24"]; // floor 61
  const activeDates = SEP_WEEKDAYS.filter((d) => off.indexOf(d) < 0);
  const at = compFloorForClr(SEP, clr({ transfers: 61, activeDates }));
  const under = compFloorForClr(SEP, clr({ transfers: 60, activeDates }));
  const over = compFloorForClr(SEP, clr({ transfers: 62, activeDates }));
  assert.equal(at.adjustedFloor, 61);
  assert.equal(at.met, true);
  assert.equal(at.shortBy, 0);
  assert.equal(under.met, false);
  assert.equal(under.shortBy, 1);
  assert.equal(over.met, true);
});

test("the floor rounds DOWN, and lands exactly on whole answers", () => {
  assert.deepEqual(proratedFloor(75, 22, 22), { exact: 75, floor: 75 });
  assert.deepEqual(proratedFloor(75, 0, 22), { exact: 0, floor: 0 });
  // 21-weekday month (November 2026): a day is worth exactly 75/21 = 3.571...
  assert.equal(proratedFloor(75, 20, 21).floor, 71); // 71.43 -> 71
  assert.equal(proratedFloor(75, 7, 21).exact, 25);  // exactly a third
  assert.equal(proratedFloor(75, 7, 21).floor, 25);  // and not 24
  assert.equal(proratedFloor(75, 14, 21).exact, 50);
  assert.equal(proratedFloor(75, 14, 21).floor, 50);
  // 20-weekday month (February 2026): 75 x 19/20 = 71.25 -> 71.
  assert.equal(proratedFloor(75, 19, 20).floor, 71);
  // Never above the base, never below zero, never NaN.
  assert.deepEqual(proratedFloor(75, 40, 22), { exact: 75, floor: 75 });
  assert.deepEqual(proratedFloor(75, -3, 22), { exact: 0, floor: 0 });
  assert.deepEqual(proratedFloor(75, 5, 0), { exact: 0, floor: 0 });
  assert.deepEqual(proratedFloor(Number.NaN as any, 5, 22), { exact: 0, floor: 0 });

  // The rounded bar is never HIGHER than the exact share — that is the whole
  // point of rounding down, and it holds for every worked count in the month.
  for (let worked = 0; worked <= 22; worked += 1) {
    const r = proratedFloor(75, worked, 22);
    assert.ok(r.floor <= r.exact + 1e-12, `worked=${worked}`);
    assert.ok(r.floor > r.exact - 1, `worked=${worked}`);
  }
});

// ── partial months, starters and leavers ────────────────────────────────────

test("a month that has not finished pro-rates to the weekdays counted so far", () => {
  // Through Tuesday 15 September: 11 of the month's 22 weekdays have happened.
  const elapsed = SEP_WEEKDAYS.filter((d) => d <= "2026-09-15");
  const r = compFloorForClr(SEP, clr({ transfers: 37, activeDates: elapsed }), { through: "2026-09-15" });
  assert.equal(elapsed.length, 11);
  assert.equal(r.partialMonth, true);
  assert.equal(r.weekdaysInScope, 11);
  assert.equal(r.weekdaysWorked, 11);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.weekdaysOutOfScope, 11);
  assert.equal(r.adjustedFloor, 37); // 75 x 11/22 = 37.5 -> 37
  assert.equal(r.met, true);
  assert.ok(r.notes.some((n) => n.includes("Partial month")));
});

test("a mid-month starter is not charged for the weekdays before they started", () => {
  const worked = SEP_WEEKDAYS.filter((d) => d >= "2026-09-14");
  const r = compFloorForClr(SEP, clr({ transfers: 0, activeDates: worked, startDate: "2026-09-14" }));
  assert.equal(worked.length, 13);
  assert.equal(r.weekdaysInScope, 13);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.weekdaysOutOfScope, 9);
  assert.equal(r.adjustedFloor, 44); // 75 x 13/22 = 44.3 -> 44
  assert.ok(r.notes.some((n) => n.includes("Started 2026-09-14")));
});

test("a mid-month leaver is not charged for the weekdays after they left", () => {
  const worked = SEP_WEEKDAYS.filter((d) => d <= "2026-09-11");
  const r = compFloorForClr(SEP, clr({ transfers: 30, activeDates: worked, endDate: "2026-09-11" }));
  assert.equal(worked.length, 9);
  assert.equal(r.weekdaysInScope, 9);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.adjustedFloor, 30); // 75 x 9/22 = 30.68 -> 30
  assert.equal(r.met, true);
});

test("activity outside the recorded employment window still counts as worked", () => {
  // Recorded as starting on the 14th, but the 1st has their work on it.
  const worked = ["2026-09-01", ...SEP_WEEKDAYS.filter((d) => d >= "2026-09-14")];
  const r = compFloorForClr(SEP, clr({ transfers: 0, activeDates: worked, startDate: "2026-09-14" }));
  assert.equal(r.weekdaysWorked, 14);
  assert.equal(r.weekdaysInScope, 14);
  assert.equal(r.weekdaysOff, 0);
  assert.ok(r.notes.some((n) => n.includes("outside their recorded dates")));
});

// ── approved leave, and the pass-throughs ───────────────────────────────────

test("approved time off lowers the floor like any other day away, and is reported apart", () => {
  assert.equal(APPROVED_LEAVE_REDUCES_FLOOR, true);
  const leave = ["2026-09-07", "2026-09-08", "2026-09-09"];
  const sick = ["2026-09-22"];
  const away = [...leave, ...sick];
  const r = compFloorForClr(SEP, clr({
    transfers: 61,
    activeDates: SEP_WEEKDAYS.filter((d) => away.indexOf(d) < 0),
    approvedTimeOffDates: [...leave, "2026-09-05"], // a weekend leave day changes nothing
  }));
  assert.equal(r.weekdaysWorked, 18);
  assert.equal(r.weekdaysOff, 4);
  assert.equal(r.approvedLeaveWeekdaysOff, 3);
  assert.equal(r.unexplainedWeekdaysOff, 1);
  assert.equal(r.adjustedFloor, 61); // identical to four unexplained days off
  assert.ok(r.notes.some((n) => n.includes("approved time off")));
});

test("a day worked during approved leave is worked", () => {
  const r = compFloorForClr(SEP, clr({
    transfers: 0,
    activeDates: SEP_WEEKDAYS,
    approvedTimeOffDates: ["2026-09-07", "2026-09-08"],
  }));
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.approvedLeaveWeekdaysOff, 0);
  assert.equal(r.adjustedFloor, 75);
});

test("exclude_from_stats is passed through, not acted on", () => {
  const r = compFloorForClr(SEP, clr({ transfers: 10, excludeFromStats: true }));
  assert.equal(r.excludeFromStats, true);
  assert.equal(r.adjustedFloor, 75); // the number is computed the same way for everyone
  assert.equal(r.met, false);
  assert.ok(r.notes.some((n) => n.includes("exclude_from_stats")));
});

// ── the report ──────────────────────────────────────────────────────────────

test("the report carries the month's facts and one row per CLR, in order", () => {
  const report = buildCompFloorReport(SEP, [
    clr({ userId: 7, name: "Ada", transfers: 90 }),
    clr({ userId: 8, name: "Grace", transfers: 40, activeDates: SEP_WEEKDAYS.slice(0, 11) }),
    { userId: 9, transfers: 0, activeDates: [] },
  ]);
  assert.equal(report.period, SEP);
  assert.equal(report.monthLabel, "September 2026");
  assert.equal(report.through, "2026-09-30");
  assert.equal(report.weekdaysInMonth, 22);
  assert.equal(report.baseFloor, 75);
  assert.equal(report.partialMonth, false);
  assert.deepEqual(report.rows.map((r) => r.name), ["Ada", "Grace", "CLR #9"]);
  assert.deepEqual(report.rows.map((r) => r.adjustedFloor), [75, 37, 0]);
  assert.deepEqual(report.rows.map((r) => r.met), [true, true, true]);
  assert.deepEqual(report.rows.map((r) => r.weekdaysOff), [0, 11, 22]);
});

test("an empty roster and a nonsense month return nothing rather than throwing", () => {
  assert.deepEqual(buildCompFloorReport(SEP, []).rows, []);
  assert.deepEqual(buildCompFloorReport(SEP, null).rows, []);
  const junk = compFloorForClr("2026-13", clr({ transfers: 5 }));
  assert.equal(junk.weekdaysInMonth, 0);
  assert.equal(junk.adjustedFloor, 0);
  assert.equal(junk.weekdaysOff, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// THE TRACE INVENTORY
//
// Everything below this line is about ACTIVITY_SIGNALS being RIGHT rather than
// merely long. The arithmetic above is fine; the inventory it runs on is what
// decides whose day gets called a day off, and the failures it had were all of
// one shape — a row with a person and a date on it was read as "they were
// here" when the row actually recorded a manager's action, a poll's heartbeat,
// or nothing at all.
//
// Remember which way the risk runs: an extra worked day RAISES the floor. So a
// signal that fires on an absent day makes the bar harsher for the person who
// was absent, and these tests pin the predicates that stop that.
// ────────────────────────────────────────────────────────────────────────────

function signal(key: string) {
  const found = ACTIVITY_SIGNALS.filter((s) => s.key === key);
  assert.equal(found.length, 1, `expected exactly one '${key}' signal, found ${found.length}`);
  return found[0];
}

function hasSignal(key: string): boolean {
  return ACTIVITY_SIGNALS.some((s) => s.key === key);
}

/** Every weekday of September except the ones named. */
function everyDayExcept(...off: string[]): string[] {
  return SEP_WEEKDAYS.filter((d) => off.indexOf(d) < 0);
}

// ── HIGH 1: a marked absence is an absence ──────────────────────────────────

test("a manager marking someone ABSENT leaves a check-in row, and the day is still OFF", () => {
  // POST /api/checkin/manual-lates -> storage.markMissingCheckinLate() INSERTs
  // a morning_checkins row for a person who never checked in, stamped with the
  // moment the MANAGER clicked. These are the rows for 2026-09-10.
  const checkinRows = [
    ...everyDayExcept("2026-09-10").map((date) => ({ date, manually_marked_late: 0 })),
    { date: "2026-09-10", manually_marked_late: 1 }, // marked absent by a manager
  ];

  // What the signal's predicate does, in code: a row is a trace only when the
  // CLR submitted it themselves. Same line the check-in page draws with
  // isRealCheckin = checkin && !manually_marked_late.
  const realCheckins = checkinRows.filter((r) => !r.manually_marked_late).map((r) => r.date);

  const r = compFloorForClr(SEP, clr({
    transfers: 71,
    activeDates: [],
    activeDatesBySignal: { morning_checkins: realCheckins },
  }));
  assert.equal(r.weekdaysWorked, 21);
  assert.equal(r.weekdaysOff, 1);
  assert.deepEqual(r.offDates, ["2026-09-10"]);
  assert.equal(r.adjustedFloor, 71); // 75 x 21/22 = 71.59 -> 71
  assert.equal(r.met, true);

  // And what the bug cost: reading "any row" as presence gives the person a
  // full 75 for a month they were absent one day of — a harsher bar, on the
  // exact day this feature exists to find.
  const asIfAnyRowCounted = compFloorForClr(SEP, clr({
    transfers: 71,
    activeDates: [],
    activeDatesBySignal: { morning_checkins: checkinRows.map((r2) => r2.date) },
  }));
  assert.equal(asIfAnyRowCounted.weekdaysOff, 0);
  assert.equal(asIfAnyRowCounted.adjustedFloor, 75);
  assert.equal(asIfAnyRowCounted.met, false);
  assert.ok(asIfAnyRowCounted.adjustedFloor > r.adjustedFloor,
    "the bug raises the bar — that is the direction the risk runs");
});

test("the morning_checkins signal documents the manually_marked_late predicate", () => {
  const s = signal("morning_checkins");
  assert.equal(s.canonical, true);
  assert.equal(s.dateKind, "business_date");
  // The predicate must be ON the source line, not buried in prose: the source
  // line is what a person copies into a query.
  assert.ok(/manually_marked_late\s*=\s*0/.test(s.source), s.source);
  assert.ok(!/^morning_checkins\.date \/ user_id$/.test(s.source),
    "an unqualified source line is how a marked absence became a worked day");
  assert.ok((s.note ?? "").includes("markMissingCheckinLate"));
});

test("an EXCUSED absence is not a check-in, and does not count either", () => {
  // Excused absences live in attendance_excuse_requests, never in
  // morning_checkins (assertNoAttendanceCheckin refuses an excuse when a
  // check-in row exists), so there is simply no check-in trace for that day.
  // The excuse-filing signal reads requested_at — the day it was FILED — which
  // is a different day, and is the only day it may make worked.
  const r = compFloorForClr(SEP, clr({
    transfers: 0,
    activeDates: [],
    activeDatesBySignal: {
      morning_checkins: everyDayExcept("2026-09-08", "2026-09-09"),
      // Filed the excuse on the 7th, FOR the 8th and 9th.
      attendance_excuse_requests: ["2026-09-07T18:00:00Z"],
    },
    approvedTimeOffDates: ["2026-09-08", "2026-09-09"],
  }));
  assert.equal(r.weekdaysOff, 2);
  assert.deepEqual(r.offDates, ["2026-09-08", "2026-09-09"]);
  assert.equal(r.approvedLeaveWeekdaysOff, 2);
  assert.equal(r.adjustedFloor, 68); // 75 x 20/22 = 68.18 -> 68
  const s = signal("attendance_excuse_requests");
  assert.ok(s.source.includes("requested_at"));
  assert.ok(s.source.includes("requested_via"), "an admin-filed excuse is the ADMIN's action");
});

// ── HIGH 2: a filed EOD is a worked day, whatever the numbers say ───────────

test("an EOD report with every counter at zero is still a day worked", () => {
  // A CLR filed on the 10th with nothing to report: no calls, no transfers, no
  // appointments — just the written note the endpoint refuses to file without.
  const zeroCounterEod = {
    report_date: "2026-09-10",
    calls_made: 0, messages_sent: 0, additional_conversations: 0,
    calltools_conversations: 0, calltools_active_seconds: 0,
    dialpad_calls: 0, transfers: 0, appointments: 0,
    notes: "Quiet day — spent it on the retail list and the LO follow-ups.",
  };
  // The training clock's predicate would reject this row outright.
  const passesTrainingClockPredicate =
    zeroCounterEod.calls_made > 0 || zeroCounterEod.messages_sent > 0
    || zeroCounterEod.additional_conversations > 0 || zeroCounterEod.calltools_conversations > 0
    || zeroCounterEod.calltools_active_seconds > 0 || zeroCounterEod.dialpad_calls > 0
    || zeroCounterEod.transfers > 0 || zeroCounterEod.appointments > 0;
  assert.equal(passesTrainingClockPredicate, false);

  const r = compFloorForClr(SEP, clr({
    transfers: 71,
    activeDates: [],
    activeDatesBySignal: {
      morning_checkins: everyDayExcept("2026-09-10"),
      eod_reports: [zeroCounterEod.report_date], // ANY submitted row counts
    },
  }));
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.adjustedFloor, 75);
});

test("a day whose ONLY trace is an all-zero EOD is worked, not off", () => {
  const r = compFloorForClr(SEP, clr({
    transfers: 0,
    activeDates: [],
    activeDatesBySignal: { eod_reports: ["2026-09-15"] },
  }));
  assert.equal(r.weekdaysWorked, 1);
  assert.equal(r.weekdaysOff, 21);
  assert.equal(r.adjustedFloor, 3); // 75 x 1/22 = 3.4 -> 3
});

test("the eod_reports signal no longer carries the training clock's counter predicate", () => {
  const s = signal("eod_reports");
  assert.equal(s.canonical, true);
  assert.ok(/ANY submitted row/i.test(s.source), s.source);
  for (const counter of [
    "calls_made > 0", "messages_sent > 0", "transfers > 0", "appointments > 0",
    "calltools_active_seconds > 0", "dialpad_calls > 0",
  ]) {
    assert.ok(!s.source.includes(counter), `${counter} must not gate a filed report`);
  }
  assert.ok((s.note ?? "").toLowerCase().includes("notes are required"));
});

// ── HIGH 3 + MEDIUM: the platforms and pages that were missing ─────────────

test("a Mojo-only day is a worked day", () => {
  // POST /api/mojo/import/csv writes mojo_sessions and mojo_contacts and
  // NOTHING ELSE — no lead_outcomes, no daily_call_logs, no callsync rows — so
  // before mojo_sessions was on the list these days had no trace anywhere.
  const mojoOnly = ["2026-09-16", "2026-09-17", "2026-09-18"];
  const r = compFloorForClr(SEP, clr({
    transfers: 68,
    activeDates: [],
    activeDatesBySignal: {
      morning_checkins: everyDayExcept(...mojoOnly),
      mojo_sessions: mojoOnly,
    },
  }));
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.adjustedFloor, 75);

  // Without the Mojo signal those three days read as absence and the floor
  // drops — kinder, but wrong, and the report would tell a manager that
  // somebody who dialled all week took three days off.
  const withoutMojo = compFloorForClr(SEP, clr({
    transfers: 68,
    activeDates: [],
    activeDatesBySignal: { morning_checkins: everyDayExcept(...mojoOnly) },
  }));
  assert.equal(withoutMojo.weekdaysOff, 3);
  assert.deepEqual(withoutMojo.offDates, mojoOnly);

  const s = signal("mojo_sessions");
  assert.equal(s.dateKind, "business_date");
  assert.ok(s.source.includes("session_date"));
  assert.ok(s.source.includes("clr_user_id"));
});

test("a CallTools day of active seconds with no dispositioned call is a worked day", () => {
  // calltools.agent_activity writes callsync_agent_activity_daily and nothing
  // else. callsync_activity_events only gets a row for a dispositioned call,
  // so a day of dialling that never produced one is invisible without this.
  const heartbeatOnly = ["2026-09-22", "2026-09-23"];
  const r = compFloorForClr(SEP, clr({
    transfers: 70,
    activeDates: [],
    activeDatesBySignal: {
      callsync_activity_events: everyDayExcept(...heartbeatOnly),
      callsync_agent_activity_daily: heartbeatOnly,
    },
  }));
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.adjustedFloor, 75);
});

test("the CallTools daily signal requires active_seconds > 0, because a bare row is a poll heartbeat", () => {
  // The feed writes a row for EVERY polled agent, including agents sitting at
  // zero. Counting bare rows would be the morning_checkins bug on a second
  // table: a person who was absent all day still gets rows, because the poll
  // ran, and every one of those days would read as worked.
  const feedRows = [
    { activity_date: "2026-09-01", active_seconds: 4200 },
    { activity_date: "2026-09-02", active_seconds: 3900 },
    { activity_date: "2026-09-03", active_seconds: 0 }, // polled, but absent
  ];
  const worked = feedRows.filter((r) => r.active_seconds > 0).map((r) => r.activity_date);
  assert.deepEqual(worked, ["2026-09-01", "2026-09-02"]);

  const r = compFloorForClr(SEP, clr({
    transfers: 0, activeDates: [], activeDatesBySignal: { callsync_agent_activity_daily: worked },
  }));
  assert.equal(r.weekdaysWorked, 2);
  assert.ok(r.offDates.indexOf("2026-09-03") >= 0, "a zero-second poll row is not presence");

  const s = signal("callsync_agent_activity_daily");
  assert.ok(/active_seconds\s*>\s*0/.test(s.source), s.source);
  assert.ok((s.note ?? "").includes("heartbeat"));
});

test("lead_source_outcomes — the Input Results page — is on the list", () => {
  const s = signal("lead_source_outcomes");
  assert.equal(s.dateKind, "business_date");
  assert.ok(s.source.includes("lead_source_outcomes.date"));
  assert.ok(s.source.includes("assistant_id"));
  const r = compFloorForClr(SEP, clr({
    transfers: 0, activeDates: [], activeDatesBySignal: { lead_source_outcomes: ["2026-09-04"] },
  }));
  assert.equal(r.weekdaysWorked, 1);
});

// ── MEDIUM: the signals that had to go, or be warned about ────────────────

test("weekly_schedules is GONE — a manager's approval is not the CLR's presence", () => {
  // The review writes UPDATE weekly_schedules SET ... updated_at=? on a row
  // keyed to the CLR's user_id, so the inventory as written marked a CLR
  // present on whatever day their manager approved them. And there is only one
  // standing row per CLR anyway (week_start='standing'), so the column could
  // never describe a month even if the attribution were right.
  assert.equal(hasSignal("weekly_schedules"), false);
  for (const s of ACTIVITY_SIGNALS) {
    assert.ok(!s.source.includes("weekly_schedules"), `${s.key} still reads weekly_schedules`);
  }
});

test("one-row-per-user tables are flagged, and kept out of PER_DAY_ACTIVITY_SIGNALS", () => {
  // shotgun_readiness is PRIMARY KEY (org_id, user_id) and eod_drafts has
  // user_id UNIQUE: both overwritten in place, so their timestamp can only
  // ever name ONE date. eod_drafts was already warned; shotgun_readiness was
  // the same defect with no warning on it.
  for (const key of ["shotgun_readiness", "eod_drafts"]) {
    const s = signal(key);
    assert.equal(s.singleRowPerUser, true, key);
    assert.ok((s.note ?? "").includes("WARNING"), `${key} needs the warning spelled out`);
    assert.ok(PER_DAY_ACTIVITY_SIGNALS.every((p) => p.key !== key), key);
  }
  // Everything else genuinely is per-day, and the two lists differ by exactly
  // those two entries.
  assert.equal(PER_DAY_ACTIVITY_SIGNALS.length, ACTIVITY_SIGNALS.length - 2);
  assert.ok(PER_DAY_ACTIVITY_SIGNALS.length > 15);
});

test("the inventory is structurally sound: unique keys, a dateKind and a source on every entry", () => {
  const keys = ACTIVITY_SIGNALS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate signal key");
  for (const s of ACTIVITY_SIGNALS) {
    assert.ok(s.key.length > 0 && s.label.length > 0 && s.source.length > 0, s.key);
    assert.ok(s.dateKind === "business_date" || s.dateKind === "timestamp", s.key);
    assert.equal(typeof s.canonical, "boolean", s.key);
  }
  // The canonical seven are still seven, and still the same seven tables.
  assert.deepEqual(CANONICAL_ACTIVITY_SIGNALS.map((s) => s.key), [
    "lead_outcomes", "daily_call_logs", "callsync_activity_events", "eod_reports",
    "dialpad_daily_stats", "morning_checkins", "time_clock_entries",
  ]);
  // Every `*_at` source is marked as a timestamp, so nobody slices one.
  for (const s of ACTIVITY_SIGNALS) {
    if (/_at\b/.test(s.source) && !/\bdate\(/.test(s.source)) {
      assert.equal(s.dateKind, "timestamp", `${s.key} reads an instant but is not marked as one`);
    }
  }
  assert.ok(TIMESTAMP_ACTIVITY_SIGNALS.length > 0);
});

// ── MEDIUM: the timezone ───────────────────────────────────────────────────

test("a timestamp becomes the PACIFIC business date, not the UTC calendar date", () => {
  // The band that matters is 5pm-7pm Pacific: already tomorrow in UTC, still
  // today's business day here. Slicing ten characters gets every one of these
  // wrong, and this codebase has shipped that bug before.
  assert.equal(businessDateOf("2026-09-16T01:30:00Z"), "2026-09-15"); // 18:30 PT
  assert.equal("2026-09-16T01:30:00Z".slice(0, 10), "2026-09-16");    // what the slice said
  assert.equal(businessDateOf("2026-09-16T00:05:00Z"), "2026-09-15"); // 17:05 PT
  assert.equal(businessDateOf("2026-09-15T23:30:00Z"), "2026-09-15"); // 16:30 PT, same either way

  // The 7pm rollover itself: 19:00 Pacific starts the NEXT business day.
  assert.equal(businessDateOf("2026-09-16T01:59:59Z"), "2026-09-15"); // 18:59:59 PT
  assert.equal(businessDateOf("2026-09-16T02:00:00Z"), "2026-09-16"); // 19:00:00 PT exactly
  assert.equal(businessDateOf("2026-09-16T02:30:00Z"), "2026-09-16"); // 19:30 PT
  assert.equal(COMP_FLOOR_ROLLOVER_HOUR, 19);

  // A month boundary, which is where the slice stops merely mis-dating a day
  // and starts dropping it out of the report altogether.
  assert.equal(businessDateOf("2026-10-01T01:00:00Z"), "2026-09-30"); // 18:00 PT on the 30th

  // Standard time as well as daylight time — the offset is not hardcoded.
  assert.equal(businessDateOf("2026-01-16T02:30:00Z"), "2026-01-15"); // 18:30 PST
  assert.equal(businessDateOf("2026-01-16T03:30:00Z"), "2026-01-16"); // 19:30 PST

  // SQLite's datetime('now') writes UTC with no marker on it. Read as local
  // time it would resolve differently on a laptop than on the server.
  assert.equal(businessDateOf("2026-09-16 01:30:00"), "2026-09-15");
  assert.equal(businessDateOf("2026-09-16 02:30:00"), "2026-09-16");

  // Dates and epoch millis, and the junk that has to come back null.
  assert.equal(businessDateOf(new Date("2026-09-16T01:30:00Z")), "2026-09-15");
  assert.equal(businessDateOf(Date.parse("2026-09-16T01:30:00Z")), "2026-09-15");
  for (const junk of [null, undefined, "", "   ", "nope", "2026-13-99", Number.NaN, {} as any]) {
    assert.equal(businessDateOf(junk as any), null, String(junk));
  }
});

test("a plain business date is returned untouched, never re-interpreted", () => {
  // C3's date columns are already Pacific business dates. Parsing one as
  // midnight-in-some-zone would shift it, so it must pass straight through.
  for (const d of SEP_WEEKDAYS) assert.equal(businessDateOf(d), d);
  assert.equal(businessDateOf("2026-09-30"), "2026-09-30");
  assert.equal(COMP_FLOOR_TIME_ZONE, "America/Los_Angeles");
});

test("the floor counts a 6:30pm Pacific EOD on the day it was worked", () => {
  // The whole point, end to end: a CLR who files at 6:30pm Pacific on the 30th
  // has worked the 30th. A UTC slice puts that row in October, so September's
  // report shows a day off that never happened, and the offDates list names a
  // day the person was demonstrably at their desk.
  const eveningFiling = "2026-10-01T01:30:00Z"; // 2026-09-30 18:30 PT
  const r = compFloorForClr(SEP, clr({
    transfers: 75,
    activeDates: [],
    activeDatesBySignal: {
      morning_checkins: everyDayExcept("2026-09-30"),
      eod_reports: [eveningFiling],
    },
  }));
  assert.equal(r.weekdaysWorked, 22);
  assert.equal(r.weekdaysOff, 0);
  assert.deepEqual(r.offDates, []);
  assert.equal(r.adjustedFloor, 75);

  // The same instant sliced the naive way lands in October and vanishes.
  assert.equal(eveningFiling.slice(0, 10), "2026-10-01");
  const sliced = compFloorForClr(SEP, clr({
    transfers: 75,
    activeDates: [],
    activeDatesBySignal: {
      morning_checkins: everyDayExcept("2026-09-30"),
      eod_reports: [eveningFiling.slice(0, 10)],
    },
  }));
  assert.deepEqual(sliced.offDates, ["2026-09-30"]);
});

test("unionActiveDates converts timestamps rather than slicing them", () => {
  assert.deepEqual(
    unionActiveDates(["2026-09-16T01:30:00Z", "2026-09-16T02:30:00Z"]),
    ["2026-09-15", "2026-09-16"],
  );
  // Mixed business dates and instants in one call, deduplicated across both:
  // the timestamp resolves onto a date that is also in the plain list.
  assert.deepEqual(
    unionActiveDates(["2026-09-15"], ["2026-09-16T01:30:00Z"], [new Date("2026-09-16T02:30:00Z")]),
    ["2026-09-15", "2026-09-16"],
  );
});

// ── MEDIUM/LOW: robustness ─────────────────────────────────────────────────

test("`through` bounds the WORKED count, not just the scope", () => {
  // A mid-month run through the 15th, with two rows that arrived for later
  // days. Counting them would put worked (13) above the elapsed weekdays (11)
  // and raise the bar over a part of the month nobody has been measured on.
  const elapsed = SEP_WEEKDAYS.filter((d) => d <= "2026-09-15");
  assert.equal(elapsed.length, 11);
  const r = compFloorForClr(SEP, clr({
    transfers: 37,
    activeDates: [...elapsed, "2026-09-18", "2026-09-21"],
  }), { through: "2026-09-15" });
  assert.equal(r.weekdaysWorked, 11);
  assert.equal(r.weekdaysInScope, 11);
  assert.equal(r.weekdaysOff, 0);
  assert.equal(r.adjustedFloor, 37); // 75 x 11/22 = 37.5 -> 37, not 44
  assert.equal(r.met, true);
  assert.deepEqual(r.activeDatesAfterThrough, ["2026-09-18", "2026-09-21"]);
  assert.ok(r.notes.some((n) => n.includes("after 2026-09-15")));

  // The invariant that makes a partial month a partial month.
  assert.ok(r.weekdaysWorked <= elapsed.length);
});

test("an employment window can still be corrected by activity — `through` cannot", () => {
  // The two bounds are not the same kind of thing. A start date is a guess
  // about somebody and activity outranks it; `through` is the caller's own
  // instruction about how much of the month to count.
  const r = compFloorForClr(SEP, clr({
    transfers: 0,
    activeDates: ["2026-09-01", "2026-09-02", "2026-09-16"],
    startDate: "2026-09-14",
  }), { through: "2026-09-15" });
  assert.equal(r.weekdaysWorked, 2);           // the 1st and 2nd, before their start
  assert.deepEqual(r.activeDatesAfterThrough, ["2026-09-16"]);
  assert.ok(r.notes.some((n) => n.includes("outside their recorded dates")));
});

test("a nonsense baseFloor produces a coherent row instead of a free pass", () => {
  // The old code let Infinity through: baseFloor Infinity, floorPerWeekday
  // Infinity, adjustedFloor 0, met true. Every CLR passed a bar of nothing and
  // the email said so. A row is printed as a whole or not at all.
  for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, -5, "abc" as any]) {
    const r = compFloorForClr(SEP, clr({ transfers: 10 }), { baseFloor: bad });
    assert.equal(r.baseFloor, FULL_MONTH_TRANSFER_FLOOR, String(bad));
    assert.equal(r.adjustedFloor, 75, String(bad));
    assert.ok(Number.isFinite(r.floorPerWeekday), String(bad));
    assert.ok(Math.abs(r.floorPerWeekday - 75 / 22) < 1e-9, String(bad));
    assert.equal(r.met, false, String(bad));
    assert.ok(r.notes.some((n) => n.includes("unusable base floor")), String(bad));
  }
  // Every reported number agrees with every other one.
  const r = compFloorForClr(SEP, clr({ transfers: 10 }), { baseFloor: Number.POSITIVE_INFINITY });
  assert.ok(Math.abs(r.adjustedFloorExact - r.baseFloor) < 1e-9);
  assert.equal(r.shortBy, r.adjustedFloor - r.transfers);

  // An explicit override is still honoured, 0 included.
  const zero = compFloorForClr(SEP, clr({ transfers: 0 }), { baseFloor: 0 });
  assert.equal(zero.baseFloor, 0);
  assert.equal(zero.adjustedFloor, 0);
  assert.equal(zero.floorPerWeekday, 0);
  assert.equal(zero.notes.some((n) => n.includes("unusable")), false);
  assert.equal(compFloorForClr(SEP, clr({ transfers: 0 }), { baseFloor: 40 }).adjustedFloor, 40);

  // The report agrees with its rows.
  const report = buildCompFloorReport(SEP, [clr({ transfers: 10 })], { baseFloor: Number.NaN });
  assert.equal(report.baseFloor, FULL_MONTH_TRANSFER_FLOOR);
  assert.equal(report.rows[0].baseFloor, FULL_MONTH_TRANSFER_FLOOR);
  assert.ok(report.rows[0].notes.some((n) => n.includes("unusable base floor")));
});

test("unionActiveDates keeps its stated junk tolerance", () => {
  // Each of these used to fail in its own way. A non-array threw, and one bad
  // row would have taken the whole month's email down with it.
  assert.doesNotThrow(() => unionActiveDates({ nope: 1 } as any));
  assert.deepEqual(unionActiveDates({ nope: 1 } as any), []);
  assert.deepEqual(unionActiveDates(true as any, (() => 0) as any, [[]] as any), []);

  // A number IS accepted, as epoch milliseconds — that is what Date.parse
  // returns and callers do hand those over. A meaningless small integer
  // therefore resolves to a 1970-era date rather than being rejected, which is
  // harmless: compFloorForClr keeps only dates inside the period being
  // reported, so it can never reach a floor.
  assert.deepEqual(unionActiveDates(42 as any), ["1969-12-31"]);
  const strayEpoch = compFloorForClr(SEP, clr({ transfers: 0, activeDates: [42 as any] }));
  assert.equal(strayEpoch.weekdaysWorked, 0);
  assert.equal(strayEpoch.noActivityAllMonth, true);

  // A bare string was iterated character by character, so every character was
  // dropped and the answer came back "no activity" — which is a floor of 0.
  assert.deepEqual(unionActiveDates("2026-09-15" as any), ["2026-09-15"]);
  assert.deepEqual(unionActiveDates("2026-09-16T01:30:00Z" as any), ["2026-09-15"]);

  // Date objects stringify to "Tue Sep 15 2026 ..." and were dropped too.
  assert.deepEqual(unionActiveDates([new Date("2026-09-15T19:00:00Z")]), ["2026-09-15"]);
  assert.deepEqual(unionActiveDates(new Date("2026-09-15T19:00:00Z") as any), ["2026-09-15"]);
  assert.deepEqual(unionActiveDates([new Date("nope")]), []);

  // And the original contract still holds.
  assert.deepEqual(
    unionActiveDates(["2026-09-02", "2026-09-01"], ["2026-09-01"], null, undefined, ["", "nope", null, undefined]),
    ["2026-09-01", "2026-09-02"],
  );
});

test("a CLR handed junk instead of a date list is not silently marked absent all month", () => {
  // The failure mode this protects against: activeDates arrives in a shape the
  // union does not understand, every weekday reads as off, and the row says
  // "met" against a floor of 0 — which reads on the email as a pass.
  const bare = compFloorForClr(SEP, { userId: 3, transfers: 75, activeDates: "2026-09-15" as any });
  assert.equal(bare.weekdaysWorked, 1);
  assert.equal(bare.noActivityAllMonth, false);
  const dates = compFloorForClr(SEP, {
    userId: 3, transfers: 75,
    activeDates: SEP_WEEKDAYS.map((d) => new Date(d + "T15:00:00Z")) as any,
  });
  assert.equal(dates.weekdaysWorked, 22);
  assert.equal(dates.adjustedFloor, 75);
  // A signal map that is not an object must not throw either.
  assert.doesNotThrow(() => compFloorForClr(SEP, clr({ activeDatesBySignal: "nope" as any })));
});

// ── the header's own arithmetic ────────────────────────────────────────────

test("the two phrasings of the rule agree ONLY when nothing is out of scope", () => {
  const proportional = (total: number, worked: number) => (75 * worked) / total;
  const subtraction = (total: number, off: number) => 75 - off * (75 / total);

  // A whole month in scope: worked + off === total, and the two forms match.
  const whole = compFloorForClr(SEP, clr({ transfers: 0, activeDates: everyDayExcept("2026-09-03", "2026-09-10") }));
  assert.equal(whole.weekdaysOutOfScope, 0);
  assert.equal(whole.weekdaysWorked + whole.weekdaysOff, whole.weekdaysInMonth);
  assert.ok(Math.abs(whole.adjustedFloorExact - proportional(22, 20)) < 1e-9);
  assert.ok(Math.abs(whole.adjustedFloorExact - subtraction(22, 2)) < 1e-9);

  // A mid-month starter: 9 weekdays were never theirs, and the subtraction
  // form OVERSTATES the bar by exactly those days' share. The header used to
  // present the identity unconditionally, which is wrong for every starter,
  // every leaver and every partial run.
  const starter = compFloorForClr(SEP, clr({
    transfers: 0,
    activeDates: SEP_WEEKDAYS.filter((d) => d >= "2026-09-14" && d !== "2026-09-15"),
    startDate: "2026-09-14",
  }));
  assert.equal(starter.weekdaysOutOfScope, 9);
  assert.equal(starter.weekdaysWorked, 12);
  assert.equal(starter.weekdaysOff, 1);
  assert.notEqual(starter.weekdaysWorked + starter.weekdaysOff, starter.weekdaysInMonth);
  assert.ok(Math.abs(starter.adjustedFloorExact - proportional(22, 12)) < 1e-9);
  assert.ok(subtraction(22, 1) > starter.adjustedFloorExact + 1,
    "the '75 minus days off' shorthand is the harsher, wrong answer here");
  // Every row carries all three counts, so an email can show the working.
  assert.equal(
    starter.weekdaysWorked + starter.weekdaysOff + starter.weekdaysOutOfScope,
    starter.weekdaysInMonth,
  );
});
