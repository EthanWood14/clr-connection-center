import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_DAY_ROLLOVER_HOUR as SERVER_ROLLOVER_HOUR,
  businessTodayInTz as serverBusinessToday,
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
