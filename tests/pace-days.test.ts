import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { countNonSundaysInMonth } from "../shared/pace-days";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");
const helper = readFileSync(join(root, "shared/pace-days.ts"), "utf8");

// ---------------------------------------------------------------------------
// The counter itself
// ---------------------------------------------------------------------------

test("a month that STARTS on a Sunday loses that first day", () => {
  // February 2026 runs Sun 1 -> Sat 28. Sundays: 1, 8, 15, 22 (four of them).
  assert.equal(countNonSundaysInMonth(2026, 2, 1), 0, "the 1st is itself a Sunday");
  assert.equal(countNonSundaysInMonth(2026, 2, 2), 1, "Monday the 2nd is the first worked day");
  assert.equal(countNonSundaysInMonth(2026, 2, 7), 6, "one Sunday dropped from the first seven days");
  assert.equal(countNonSundaysInMonth(2026, 2), 28 - 4, "28 days minus 4 Sundays");
});

test("a month that ENDS on a Sunday loses that last day", () => {
  // May 2026 runs Fri 1 -> Sun 31. Sundays: 3, 10, 17, 24, 31 (five of them).
  assert.equal(countNonSundaysInMonth(2026, 5, 30), 30 - 4, "through the 30th, four Sundays gone");
  assert.equal(
    countNonSundaysInMonth(2026, 5, 31),
    countNonSundaysInMonth(2026, 5, 30),
    "the 31st is a Sunday, so running to month end adds nothing",
  );
  assert.equal(countNonSundaysInMonth(2026, 5), 31 - 5, "31 days minus 5 Sundays");
});

test("February counts right in a leap year and a common year", () => {
  // 2024: Thu 1 -> Thu 29, Sundays 4, 11, 18, 25.
  assert.equal(countNonSundaysInMonth(2024, 2), 29 - 4);
  assert.equal(countNonSundaysInMonth(2024, 2, 29), 25, "the 29th exists and is a Thursday");
  // 2026: Sun 1 -> Sat 28, Sundays 1, 8, 15, 22.
  assert.equal(countNonSundaysInMonth(2026, 2), 28 - 4);
  // The leap day is a real worked day, so the leap year comes out one ahead.
  assert.equal(countNonSundaysInMonth(2024, 2) - countNonSundaysInMonth(2026, 2), 1);
});

test("throughDay past the end of the month clamps instead of running on", () => {
  // February 2026 has 28 days. Asking for the 29th, 31st or 400th cannot invent
  // days, and must never bleed into March.
  const whole = countNonSundaysInMonth(2026, 2);
  assert.equal(countNonSundaysInMonth(2026, 2, 29), whole);
  assert.equal(countNonSundaysInMonth(2026, 2, 31), whole);
  assert.equal(countNonSundaysInMonth(2026, 2, 400), whole);
  // Same in a 30-day month: 31 counts the 30 days that exist.
  assert.equal(countNonSundaysInMonth(2026, 9, 31), countNonSundaysInMonth(2026, 9));
});

test("nonsense inputs return 0 rather than a plausible-looking wrong number", () => {
  // Zero and negative days: there is no such thing as negative worked days.
  assert.equal(countNonSundaysInMonth(2026, 9, 0), 0);
  assert.equal(countNonSundaysInMonth(2026, 9, -5), 0);
  assert.equal(countNonSundaysInMonth(2026, 9, NaN), 0);
  // Out-of-range months. Date.UTC(2026, 13, 0) would happily hand back January
  // 2027 (31 days); answering with a different month's calendar is worse than
  // refusing, so this returns 0.
  assert.equal(countNonSundaysInMonth(2026, 13), 0);
  assert.equal(countNonSundaysInMonth(2026, 0), 0);
  assert.equal(countNonSundaysInMonth(2026, -1), 0);
  assert.equal(countNonSundaysInMonth(2026, 9.5), 0);
  assert.equal(countNonSundaysInMonth(NaN, 9), 0);
  // 0 is the safe answer downstream: the dashboard only projects when
  // daysElapsed > 0, so a broken window renders a dash instead of a number.
  assert.match(dash, /pace\.daysElapsed > 0/, "the projection still guards on a positive divisor");
});

test("every month of a year adds up, and only Sundays are ever dropped", () => {
  for (let m = 1; m <= 12; m++) {
    const lastDay = new Date(Date.UTC(2026, m, 0)).getUTCDate();
    let sundays = 0;
    for (let d = 1; d <= lastDay; d++) {
      if (new Date(Date.UTC(2026, m - 1, d, 12, 0, 0)).getUTCDay() === 0) sundays++;
    }
    // Saturdays are worked days here. If any Saturday were being dropped the
    // total would land below lastDay - sundays, which this equality catches.
    assert.equal(countNonSundaysInMonth(2026, m), lastDay - sundays, `2026-${m}`);
    assert.ok(sundays >= 4 && sundays <= 5, `2026-${m} should have 4 or 5 Sundays`);
  }
});

// ---------------------------------------------------------------------------
// The dashboard has to use it on BOTH sides of the ratio
// ---------------------------------------------------------------------------

test("the MTD pace divides AND multiplies by non-Sundays", () => {
  const start = dash.indexOf('pace={scorecardRange === "mtd"');
  assert.ok(start > 0, "the MTD pace block still exists");
  const block = dash.slice(start, dash.indexOf("})() : undefined}", start));

  assert.match(dash, /import \{ countNonSundaysInMonth \} from "@shared\/pace-days";/,
    "the dashboard imports the shared counter");
  assert.match(block, /daysElapsed:\s*countNonSundaysInMonth\(\s*y\s*,\s*m\s*,\s*d\s*\)/,
    "the DIVISOR counts non-Sundays elapsed so far");
  assert.match(block, /daysInMonth:\s*countNonSundaysInMonth\(\s*y\s*,\s*m\s*\)/,
    "the MULTIPLIER counts non-Sundays in the whole month");

  // The old raw-calendar arithmetic must be gone from BOTH halves. Half-doing
  // this is the real hazard: dividing by non-Sundays while still multiplying by
  // calendar days inflates every CLR by about a seventh.
  assert.ok(!/getUTCDate\(\)/.test(block), "no raw calendar day-count left in the pace block");
  assert.ok(!/w\.days/.test(block), "the raw elapsed-calendar-days field is no longer used");
});

test("mixing the two rules would inflate every projection by about a seventh", () => {
  // Same CLR, same month, two ways of counting. Only the first is correct.
  const transfers = 60;
  const elapsed = countNonSundaysInMonth(2026, 9, 21);   // 18
  const whole = countNonSundaysInMonth(2026, 9);         // 26
  const correct = Math.round((transfers / elapsed) * whole);
  const mixed = Math.round((transfers / elapsed) * 30);  // non-Sundays / calendar days
  assert.equal(correct, 87);
  assert.equal(mixed, 100);
  assert.ok(mixed / correct > 1.1, "the mixed version is materially higher, not a rounding wobble");
});

test("the screen says Sundays are not counted", () => {
  const legendStart = dash.indexOf('{scorecardRange === "mtd" && (');
  assert.ok(legendStart > 0, "the MTD tier legend still exists");
  const legend = dash.slice(legendStart, legendStart + 900);
  assert.match(legend, /Sundays not counted/i, "the tier legend spells the rule out");
  // And the Pace column header carries it too, at zero cost in table density.
  assert.match(dash, /title="Projected month-end transfers\. Sundays are not counted as worked days\."/);
});

// ---------------------------------------------------------------------------
// Worked example - check this one by hand
// ---------------------------------------------------------------------------

test("worked example: 60 transfers by 21 September 2026 projects to 87", () => {
  // September 2026: Tue 1 -> Wed 30, so 30 calendar days.
  //   Sundays:   6, 13, 20, 27  -> 4 of them
  //   Saturdays: 5, 12, 19, 26  -> 4 of them, and they DO count here
  //
  // Divisor (worked so far, 1st..21st): 21 - Sundays {6,13,20}    = 21 - 3 = 18
  // Multiplier (worked all month):      30 - Sundays {6,13,20,27} = 30 - 4 = 26
  //
  //   60 / 18             = 3.3333... transfers per worked day
  //   3.3333... * 26      = 86.666...
  //   Math.round(86.666)  = 87
  const elapsed = countNonSundaysInMonth(2026, 9, 21);
  const whole = countNonSundaysInMonth(2026, 9);
  assert.equal(elapsed, 18);
  assert.equal(whole, 26);
  assert.equal(Math.round((60 / elapsed) * whole), 87);

  // For contrast, the two rules this is NOT.
  // Raw calendar days, which is what shipped before: 60 / 21 * 30 = 85.714 -> 86
  assert.equal(Math.round((60 / 21) * 30), 86);
  // Weekdays only, which is the comp estimate in server/routes.ts (Saturdays
  // dropped as well): divisor 21 - {5,6,12,13,19,20} = 15, multiplier 30 - 8 = 22
  //   60 / 15 * 22 = 88
  assert.equal(Math.round((60 / 15) * 22), 88);
  // 87 vs 88 is the deliberate divergence: Saturday is a worked day on the
  // scorecard and is not one in the comp estimate. Do not "harmonise" it.
});

test("the helper documents the deliberate split from the comp estimate", () => {
  assert.match(helper, /countWeekdaysInMonth/, "names the other rule");
  assert.match(helper, /server\/routes\.ts/, "names where the other rule lives");
  assert.match(helper, /intentional/i, "says the difference is on purpose");
  // The noon-UTC trick, and why it is there.
  assert.match(helper, /Date\.UTC\(year, month - 1, day, 12, 0, 0\)/);
  assert.match(helper, /DST/, "explains that noon is what stops a DST shift moving the date");
});

test("noon UTC keeps the weekday stable across a DST boundary", () => {
  // 8 March 2026 is a US spring-forward Sunday, and 1 November 2026 is a
  // fall-back Sunday that is also the 1st of its month.
  assert.equal(new Date(Date.UTC(2026, 2, 8, 12, 0, 0)).getUTCDay(), 0, "the 8th is a Sunday");
  assert.equal(countNonSundaysInMonth(2026, 3, 8), 6, "the 1st is a Sunday too: 8 days - 2 Sundays");
  assert.equal(new Date(Date.UTC(2026, 10, 1, 12, 0, 0)).getUTCDay(), 0);
  assert.equal(countNonSundaysInMonth(2026, 11, 1), 0);
});
