import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

import {
  recurringCompDueDate,
  recurringCompIsDue,
  recurringCompWasFiledEarly,
  repairEarlyRecurringCompRequests,
} from "../server/recurring-comp";

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

test("old first-of-month filings are recognized only before their saved day", () => {
  assert.equal(recurringCompWasFiledEarly("2026-08-02", 15, "2026-08"), true);
  assert.equal(recurringCompWasFiledEarly("2026-08-15", 15, "2026-08"), false);
  assert.equal(recurringCompWasFiledEarly("2026-08-02", 15, "2026-07"), false);
});

test("repair removes only untouched early system filings and resets their templates", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE comp_recurring (
      id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER, description TEXT,
      amount_cents INTEGER, day_of_month INTEGER, last_filed_period TEXT, updated_at TEXT
    );
    CREATE TABLE comp_requests (
      id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER, description TEXT,
      amount_cents INTEGER, status TEXT, is_paid INTEGER, reviewed_at TEXT,
      approval_token TEXT, expense_date TEXT, requested_at TEXT, created_at TEXT
    );
    CREATE TABLE comp_attachments (id INTEGER PRIMARY KEY, org_id INTEGER, comp_id INTEGER);
    INSERT INTO comp_recurring VALUES (1,1,7,'Second Codex account',2000,15,'2026-08',NULL);
    INSERT INTO comp_requests VALUES
      (10,1,7,'Second Codex account — August 2026 (recurring)',2000,'pending',0,NULL,'early',NULL,'2026-08-01T12:00:00Z','2026-08-01T12:00:00Z'),
      (11,1,7,'Second Codex account — August 2026 (recurring)',2000,'approved',0,'2026-08-02T12:00:00Z','reviewed',NULL,'2026-08-01T12:00:00Z','2026-08-01T12:00:00Z'),
      (12,1,7,'Second Codex account — August 2026 (recurring)',2000,'pending',0,NULL,'attached',NULL,'2026-08-01T12:00:00Z','2026-08-01T12:00:00Z');
    INSERT INTO comp_attachments VALUES (1,1,12);
  `);

  const repairs = repairEarlyRecurringCompRequests(db, "2026-08-02");
  assert.deepEqual(repairs, [{ templateId: 1, ownerId: 7, period: "2026-08", removed: 1 }]);
  assert.deepEqual((db.prepare("SELECT id FROM comp_requests ORDER BY id").all() as any[]).map(row => row.id), [11, 12]);
  assert.equal((db.prepare("SELECT last_filed_period FROM comp_recurring WHERE id=1").get() as any).last_filed_period, null);
  assert.deepEqual(repairEarlyRecurringCompRequests(db, "2026-08-02"), []);
  db.close();
});

test("recurring day is wired through storage, scheduling, and the comp UI", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../client/src/pages/comp-requests.tsx", import.meta.url), "utf8");

  assert.match(routes, /day_of_month INTEGER NOT NULL DEFAULT 1/);
  assert.match(routes, /recurringCompIsDue\(todayStr/);
  assert.match(routes, /dayOfMonth: Number\(r\.day_of_month \?\? 1\)/);
  const recurring = readFileSync(new URL("../server/recurring-comp.ts", import.meta.url), "utf8");
  assert.match(recurring, /status IN \('draft','pending'\)/);
  assert.match(recurring, /expense_date IS NULL/);
  assert.match(recurring, /NOT EXISTS \(\s*SELECT 1 FROM comp_attachments/);
  assert.match(page, /saved day of the month/);
  assert.doesNotMatch(page, /1st of (each|every) month/);
});
