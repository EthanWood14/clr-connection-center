import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { recurringCompDueDate, recurringCompIsDue } from "../server/recurring-comp";

test("recurring comp waits for its configured day of the month", () => {
  assert.equal(recurringCompIsDue("2026-08-01", 15, "2026-07"), false);
  assert.equal(recurringCompIsDue("2026-08-14", 15, "2026-07"), false);
  assert.equal(recurringCompIsDue("2026-08-15", 15, "2026-07"), true);
  assert.equal(recurringCompIsDue("2026-08-16", 15, "2026-07"), true);
  assert.equal(recurringCompIsDue("2026-08-15", 15, "2026-08"), false);
});

test("month-end recurring comp clamps to the last calendar day", () => {
  assert.equal(recurringCompDueDate("2026-02-01", 31), "2026-02-28");
  assert.equal(recurringCompDueDate("2028-02-01", 31), "2028-02-29");
  assert.equal(recurringCompDueDate("2026-04-01", 31), "2026-04-30");
  assert.equal(recurringCompDueDate("2026-05-01", 31), "2026-05-31");
});

test("recurring day is wired through storage, scheduling, and the comp UI", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../client/src/pages/comp-requests.tsx", import.meta.url), "utf8");

  assert.match(routes, /day_of_month INTEGER NOT NULL DEFAULT 1/);
  assert.match(routes, /recurringCompIsDue\(todayStr/);
  assert.match(routes, /dayOfMonth: Number\(r\.day_of_month \?\? 1\)/);
  assert.match(page, /saved day of the month/);
  assert.doesNotMatch(page, /1st of (each|every) month/);
});
