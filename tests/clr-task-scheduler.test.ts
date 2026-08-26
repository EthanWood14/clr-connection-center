import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureRecurringTaskOccurrences, nextOverdueReminderAt, nextTaskOccurrenceForRow, overdueEmailRetryAt } from "../server/clr-task-scheduler";

function dbWithTask(recurrence: string, dueAt: string, scheduleDays = "[]") {
  const db = new DatabaseSync(":memory:");
  (db as any).transaction = (fn: (...args: any[]) => any) => (...args: any[]) => {
    db.exec("BEGIN");
    try {
      const result = fn(...args);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  db.exec(`CREATE TABLE clr_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    assigned_user_id INTEGER NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    recurrence TEXT NOT NULL DEFAULT 'none',
    schedule_days TEXT NOT NULL DEFAULT '[]',
    recurrence_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    series_id INTEGER,
    spawned_next_task_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_series_due ON clr_tasks(series_id,due_at) WHERE series_id IS NOT NULL;`);
  db.prepare(`INSERT INTO clr_tasks
    (id,org_id,title,description,assigned_user_id,created_by_user_id,priority,recurrence,schedule_days,due_at,status,series_id,created_at,updated_at)
    VALUES (1,1,'Daily cleanup','Keep the queue clean',10,20,'high',?,?,?,'active',1,?,?)`)
    .run(recurrence, scheduleDays, dueAt, dueAt, dueAt);
  return db;
}

test("a late daily series preserves every missed occurrence and creates one future occurrence", () => {
  const db = dbWithTask("daily", "2026-08-21T17:00:00.000Z");
  const created = ensureRecurringTaskOccurrences(db as any, "2026-08-24T18:00:00.000Z");
  assert.equal(created.length, 4);
  const rows = db.prepare(`SELECT id,due_at,status,series_id,spawned_next_task_id FROM clr_tasks ORDER BY due_at`).all() as any[];
  assert.deepEqual(rows.map((row) => row.due_at), [
    "2026-08-21T17:00:00.000Z",
    "2026-08-22T17:00:00.000Z",
    "2026-08-23T17:00:00.000Z",
    "2026-08-24T17:00:00.000Z",
    "2026-08-25T17:00:00.000Z",
  ]);
  assert.deepEqual(rows.map((row) => row.status), ["active", "active", "active", "active", "active"]);
  assert.ok(rows.slice(0, -1).every((row) => row.spawned_next_task_id != null));
  assert.equal(rows.at(-1)?.spawned_next_task_id, null);
  assert.ok(rows.every((row) => Number(row.series_id) === 1));
  assert.equal(ensureRecurringTaskOccurrences(db as any, "2026-08-24T18:00:00.000Z").length, 0, "rerunning is idempotent");
});

test("custom weekdays catch up without inventing off-schedule deadlines", () => {
  const db = dbWithTask("custom_weekly", "2026-08-21T17:00:00.000Z", "[1,3,5]");
  ensureRecurringTaskOccurrences(db as any, "2026-08-25T18:00:00.000Z");
  const dates = (db.prepare(`SELECT due_at FROM clr_tasks ORDER BY due_at`).all() as any[]).map((row) => row.due_at);
  assert.deepEqual(dates, [
    "2026-08-21T17:00:00.000Z", // Friday
    "2026-08-24T17:00:00.000Z", // Monday
    "2026-08-26T17:00:00.000Z", // Wednesday, the one future occurrence
  ]);
});

test("completing early still prepares exactly one next occurrence", () => {
  const db = dbWithTask("weekly", "2026-08-28T17:00:00.000Z");
  db.prepare(`UPDATE clr_tasks SET status='completed' WHERE id=1`).run();
  ensureRecurringTaskOccurrences(db as any, "2026-08-25T18:00:00.000Z");
  const rows = (db.prepare(`SELECT due_at,status FROM clr_tasks ORDER BY due_at`).all() as any[])
    .map((row) => ({ due_at: String(row.due_at), status: String(row.status) }));
  assert.deepEqual(rows, [
    { due_at: "2026-08-28T17:00:00.000Z", status: "completed" },
    { due_at: "2026-09-04T17:00:00.000Z", status: "active" },
  ]);
});

test("an org-scoped task read never advances another organization's series", () => {
  const db = dbWithTask("daily", "2026-08-24T17:00:00.000Z");
  db.prepare(`INSERT INTO clr_tasks
    (id,org_id,title,description,assigned_user_id,created_by_user_id,priority,recurrence,schedule_days,due_at,status,series_id,created_at,updated_at)
    VALUES (2,2,'Other org task','',11,21,'normal','daily','[]','2026-08-24T17:00:00.000Z','active',2,'2026-08-24T17:00:00.000Z','2026-08-24T17:00:00.000Z')`).run();
  ensureRecurringTaskOccurrences(db as any, "2026-08-25T18:00:00.000Z", 500, 1);
  const counts = db.prepare(`SELECT org_id,COUNT(*) AS count FROM clr_tasks GROUP BY org_id ORDER BY org_id`).all() as any[];
  assert.deepEqual(counts.map((row) => [Number(row.org_id), Number(row.count)]), [[1, 3], [2, 1]]);
});

test("weekly recurrences keep the assignee's local time across daylight saving", () => {
  assert.equal(nextTaskOccurrenceForRow({
    due_at: "2026-10-31T00:00:00.000Z", // Fri Oct 30, 5:00 PM PDT
    recurrence: "weekly",
    schedule_days: "[]",
    recurrence_timezone: "America/Los_Angeles",
  }), "2026-11-07T01:00:00.000Z"); // Fri Nov 6, still 5:00 PM (now PST)
});

test("failed overdue email backs off, then accepted mail waits one day", () => {
  const now = new Date("2026-08-25T18:00:00.000Z");
  assert.equal(overdueEmailRetryAt(now, 0), "2026-08-25T18:05:00.000Z");
  assert.equal(overdueEmailRetryAt(now, 1), "2026-08-25T18:10:00.000Z");
  assert.equal(overdueEmailRetryAt(now, 8), "2026-08-25T19:00:00.000Z");
  assert.equal(nextOverdueReminderAt(now), "2026-08-26T18:00:00.000Z");
});
