import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BUSINESS_DAY_ROLLOVER_HOUR as SERVER_ROLLOVER_HOUR,
  businessTodayInTz as serverBusinessToday,
  countWeekdaysInMonth,
  previousWeekdaysFromBusinessDate,
  requiredEodWeekdaysInTz,
} from "../server/business-day";
import {
  BUSINESS_DAY_ROLLOVER_HOUR as CLIENT_ROLLOVER_HOUR,
  businessTodayInTz as clientBusinessToday,
} from "../client/src/lib/business-day";

const PACIFIC = "America/Los_Angeles";

test("server and client stay on the current date until exactly 7pm PDT", () => {
  const formerUtcBug = new Date("2026-07-25T00:00:00.000Z"); // Fri Jul 24, 5:00pm PDT
  const before = new Date("2026-07-25T01:59:59.999Z"); // Fri Jul 24, 6:59:59pm PDT
  const cutoff = new Date("2026-07-25T02:00:00.000Z"); // Fri Jul 24, 7:00pm PDT

  assert.equal(SERVER_ROLLOVER_HOUR, 19);
  assert.equal(CLIENT_ROLLOVER_HOUR, 19);
  assert.equal(serverBusinessToday(PACIFIC, formerUtcBug), "2026-07-24");
  assert.equal(clientBusinessToday(PACIFIC, formerUtcBug), "2026-07-24");
  assert.equal(serverBusinessToday(PACIFIC, before), "2026-07-24");
  assert.equal(clientBusinessToday(PACIFIC, before), "2026-07-24");
  assert.equal(serverBusinessToday(PACIFIC, cutoff), "2026-07-25");
  assert.equal(clientBusinessToday(PACIFIC, cutoff), "2026-07-25");
});

test("the 7pm boundary remains fixed through Pacific standard time", () => {
  const formerUtcBug = new Date("2026-01-10T00:00:00.000Z"); // Fri Jan 9, 4:00pm PST
  const before = new Date("2026-01-10T02:59:59.999Z"); // Fri Jan 9, 6:59:59pm PST
  const cutoff = new Date("2026-01-10T03:00:00.000Z"); // Fri Jan 9, 7:00pm PST

  assert.equal(serverBusinessToday(PACIFIC, formerUtcBug), "2026-01-09");
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, formerUtcBug),
    ["2026-01-08", "2026-01-07", "2026-01-06"],
  );
  assert.equal(serverBusinessToday(PACIFIC, before), "2026-01-09");
  assert.equal(clientBusinessToday(PACIFIC, before), "2026-01-09");
  assert.equal(serverBusinessToday(PACIFIC, cutoff), "2026-01-10");
  assert.equal(clientBusinessToday(PACIFIC, cutoff), "2026-01-10");
});

test("Friday's report becomes required at 7pm and weekends are skipped", () => {
  const formerUtcBug = new Date("2026-07-25T00:00:00.000Z"); // Friday, 5:00pm PDT
  const beforeCutoff = serverBusinessToday(
    PACIFIC,
    new Date("2026-07-25T01:59:59.999Z"),
  );
  const atCutoff = serverBusinessToday(
    PACIFIC,
    new Date("2026-07-25T02:00:00.000Z"),
  );

  assert.deepEqual(
    previousWeekdaysFromBusinessDate(beforeCutoff),
    ["2026-07-23", "2026-07-22", "2026-07-21"],
  );
  assert.deepEqual(
    previousWeekdaysFromBusinessDate(atCutoff),
    ["2026-07-24", "2026-07-23", "2026-07-22"],
  );
  assert.deepEqual(
    previousWeekdaysFromBusinessDate("2026-07-27"),
    ["2026-07-24", "2026-07-23", "2026-07-22"],
  );
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, formerUtcBug),
    ["2026-07-23", "2026-07-22", "2026-07-21"],
  );
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, new Date("2026-07-25T02:00:00.000Z")),
    ["2026-07-24", "2026-07-23", "2026-07-22"],
  );
});

test("the morning activity gate can only ask for a completed workday", () => {
  const routes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server/routes.ts"), "utf8");
  const gate = routes.slice(
    routes.indexOf('app.get("/api/call-logs/check-previous-day"'),
    routes.indexOf('app.get("/api/call-logs"'),
  );
  assert.match(gate, /requiredEodWeekdaysInTz\(timezone, new Date\(\), 1, 7\)\[0\]/);
  assert.doesNotMatch(gate, /businessTodayForRequest/);
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, new Date("2026-08-18T15:00:00.000Z"), 1, 7),
    ["2026-08-17"],
    "Tuesday morning must ask for Monday, never Tuesday",
  );
});

test("weekday counting excludes Saturdays and Sundays", () => {
  // August 2026: the 1st is a Saturday, the 31st a Monday. 21 weekdays.
  assert.equal(countWeekdaysInMonth(2026, 8), 21);
  // Through Tue Aug 4 -> Mon 3rd + Tue 4th only; the 1st and 2nd are a weekend.
  assert.equal(countWeekdaysInMonth(2026, 8, 4), 2);
  // Through Sun Aug 2 -> still zero weekdays elapsed.
  assert.equal(countWeekdaysInMonth(2026, 8, 2), 0);

  // February 2026 starts on a Sunday and has 28 days -> exactly 20 weekdays.
  assert.equal(countWeekdaysInMonth(2026, 2), 20);
  // A leap February with a 29th that lands on a Friday counts one more.
  assert.equal(countWeekdaysInMonth(2028, 2), 21);
});

test("weekday counting clamps a day past the end of the month", () => {
  // Asking for the 31st of a 30-day month must not invent a day.
  assert.equal(countWeekdaysInMonth(2026, 9, 31), countWeekdaysInMonth(2026, 9));
  assert.equal(countWeekdaysInMonth(2026, 2, 31), countWeekdaysInMonth(2026, 2));
});

test("the month-end comp estimate paces on weekdays, not calendar days", () => {
  // The MTD email extrapolates each CLR's transfers to month-end. Dividing by
  // elapsed calendar days counted weekends as zero-transfer days, understating
  // every projection; both sides of the ratio must be weekday counts.
  const routes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server/routes.ts"), "utf8");
  const projected = routes.slice(
    routes.indexOf("// Projected mode (Wednesday MTD)"),
    routes.indexOf("Estimate only — not final pay."),
  );
  assert.match(projected, /countWeekdaysInMonth\(ey, em, ed\)/, "elapsed must be weekdays through the report date");
  assert.match(projected, /countWeekdaysInMonth\(ey, em\)/, "the month total must be weekdays too");
  assert.match(projected, /mtd \/ weekdaysElapsed\) \* weekdaysInMonth/, "the ratio must use both weekday counts");
  // \b matters: "weekdaysElapsed" contains "daysElapsed" as a substring.
  assert.ok(!/\bdaysElapsed\b|\bdaysInMonth\b/.test(projected), "no calendar-day pacing may remain");
  assert.match(projected, /Math\.max\(1, countWeekdaysInMonth/, "a weekend-only window must not divide by zero");
});
