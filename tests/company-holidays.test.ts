import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OBSERVED, isCompanyHoliday, isWorkday, isoFor,
  holidaysInMonth, nonSundayHolidaysInMonth,
} from "../shared/company-holidays";
import { countWeekdaysInMonth, nextBusinessDay, requiredEodWeekdaysInTz } from "../server/business-day";
import { countNonSundaysInMonth } from "../shared/pace-days";
import { isWeekdayIso, monthWeekdays } from "../server/comp-floor";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

// Labor Day 2026, a Monday. Owner: not a workday.
const LABOR_DAY = "2026-09-07";

test("Labor Day 2026 is on the list", () => {
  assert.ok(OBSERVED.includes(LABOR_DAY));
  assert.equal(isCompanyHoliday(LABOR_DAY), true);
  assert.equal(isWorkday(LABOR_DAY), false, "a weekday the office is shut is not a workday");
  // It really is a Monday — if this ever fails the date is wrong, not the code.
  assert.equal(new Date(`${LABOR_DAY}T12:00:00Z`).getUTCDay(), 1);
});

test("the days either side of it are unaffected", () => {
  assert.equal(isWorkday("2026-09-04"), true, "the Friday before");
  assert.equal(isWorkday("2026-09-08"), true, "the Tuesday after");
  assert.equal(isCompanyHoliday("2026-09-08"), false);
});

test("weekends are still not workdays, holiday or not", () => {
  assert.equal(isWorkday("2026-09-05"), false, "Saturday");
  assert.equal(isWorkday("2026-09-06"), false, "Sunday");
});

test("junk in is not a workday, and never throws", () => {
  for (const bad of [null, undefined, "", "nonsense", 20260907, new Date(), "2026-9-7"]) {
    assert.equal(isWorkday(bad as any), false, String(bad));
    assert.equal(isCompanyHoliday(bad as any), false, String(bad));
  }
  // A timestamp is tolerated — the date half is what matters.
  assert.equal(isCompanyHoliday("2026-09-07T14:00:00Z"), true);
});

// ── every counter that decides what a working day is ────────────────────────

test("the month's weekday count drops Labor Day", () => {
  // September 2026 has 22 Mon-Fri days; one is the holiday.
  assert.equal(countWeekdaysInMonth(2026, 9), 21);
  // Through the 7th: the 1st-4th plus the 7th is five, minus the holiday.
  assert.equal(countWeekdaysInMonth(2026, 9, 7), 4);
  // A month with no holiday in it is untouched.
  assert.equal(countWeekdaysInMonth(2026, 10), 22);
});

test("the pace calculator drops it too, while still keeping Saturdays", () => {
  // The owner's rule is Sundays only are out, so September's 26 non-Sundays
  // become 25 once the office is shut for one of them.
  assert.equal(countNonSundaysInMonth(2026, 9), 25);
  assert.equal(countNonSundaysInMonth(2026, 10), 27, "no holiday in October");
  // Through the 7th: 1-7 minus the Sunday (6th) minus the holiday (7th).
  assert.equal(countNonSundaysInMonth(2026, 9, 7), 5);
});

test("the comp floor does not count it as a weekday somebody missed", () => {
  // The 75-transfer floor is pro-rated by weekdays with no activity. A closed
  // office must not read as a day the CLR failed to turn up.
  assert.equal(isWeekdayIso(LABOR_DAY), false);
  const september = monthWeekdays("2026-09");
  assert.equal(september.includes(LABOR_DAY), false);
  assert.equal(september.length, 21, "the list and the count agree");
});

test("an EOD due 'the next business day' skips the holiday", () => {
  // Friday the 4th's report would have been due Monday the 7th.
  assert.equal(nextBusinessDay("2026-09-04"), "2026-09-08");
  // And a normal week is unchanged.
  assert.equal(nextBusinessDay("2026-09-08"), "2026-09-09");
  assert.equal(nextBusinessDay("2026-09-11"), "2026-09-14", "still skips the weekend");
});

test("nobody is asked for a report for a day the office was shut", () => {
  // The lock gate and the nag both compose from this.
  const due = requiredEodWeekdaysInTz("America/Los_Angeles", new Date("2026-09-09T18:00:00Z"), 5);
  assert.equal(due.includes(LABOR_DAY), false, "Labor Day must never be demanded");
  assert.ok(due.includes("2026-09-08"), "the Tuesday after is still expected");
  assert.ok(due.includes("2026-09-04"), "so is the Friday before");
});

test("the reminder cron asks the shared question rather than its own", () => {
  // It used to test the day-of-week inline, which is how a holiday gets
  // honoured in four places out of five.
  const cron = routes.slice(routes.indexOf("const weekdaysToCheck: string[] = [];"));
  const loop = cron.slice(0, 600);
  assert.match(loop, /if \(!isWorkday\(iso\)\) continue;/);
  assert.doesNotMatch(loop, /dow === 0 \|\| dow === 6/, "no hand-rolled weekend test should remain");
});

// ── the subtraction helpers ─────────────────────────────────────────────────

test("a weekend holiday is never subtracted from a weekday count", () => {
  // It was not in the count to begin with; subtracting it would remove a real
  // working day. holidaysInMonth is what the weekday counters would use.
  assert.deepEqual(holidaysInMonth(2026, 9), [LABOR_DAY]);
  assert.deepEqual(holidaysInMonth(2026, 10), []);
  assert.deepEqual(holidaysInMonth(2026, 9, 6), [], "not reached yet on the 6th");
  assert.deepEqual(holidaysInMonth(2026, 9, 7), [LABOR_DAY]);
});

test("the pace helper keeps Saturday holidays, because the pace keeps Saturdays", () => {
  assert.deepEqual(nonSundayHolidaysInMonth(2026, 9), [LABOR_DAY]);
  // Both helpers refuse a nonsense month rather than rolling into the next year.
  for (const [y, m] of [[2026, 13], [2026, 0], [2026.5, 9]] as Array<[number, number]>) {
    assert.deepEqual(holidaysInMonth(y, m), []);
    assert.deepEqual(nonSundayHolidaysInMonth(y, m), []);
  }
});

test("isoFor pads, so a single-digit month or day still matches the list", () => {
  assert.equal(isoFor(2026, 9, 7), LABOR_DAY);
  assert.equal(isoFor(2026, 1, 1), "2026-01-01");
});

test("every observed date is a well-formed ISO day", () => {
  for (const d of OBSERVED) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `${d} must be YYYY-MM-DD`);
    assert.equal(isCompanyHoliday(d), true);
  }
  assert.equal(new Set(OBSERVED).size, OBSERVED.length, "no duplicates");
});
