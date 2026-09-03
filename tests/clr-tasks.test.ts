import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nextTaskDueAt } from "../shared/clr-tasks";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-tasks.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const sidebar = readFileSync(join(root, "client/src/components/app-sidebar.tsx"), "utf8");
const popup = readFileSync(join(root, "client/src/components/task-overdue-popup.tsx"), "utf8");

test("recurring deadlines advance to the first future cycle", () => {
  assert.equal(nextTaskDueAt("2026-08-17T17:00:00.000Z", "daily", new Date("2026-08-17T18:00:00.000Z")), "2026-08-18T17:00:00.000Z");
  assert.equal(nextTaskDueAt("2026-08-21T17:00:00.000Z", "weekdays", new Date("2026-08-21T18:00:00.000Z")), "2026-08-24T17:00:00.000Z");
  assert.equal(nextTaskDueAt("2026-01-31T17:00:00.000Z", "monthly", new Date("2026-01-31T18:00:00.000Z")), "2026-02-28T17:00:00.000Z");
  assert.equal(nextTaskDueAt("2026-08-17T17:00:00.000Z", "none"), null);
  assert.equal(nextTaskDueAt("2026-08-17T17:00:00.000Z", "custom_weekly", new Date("2026-08-17T18:00:00.000Z"), [1, 3, 5]), "2026-08-19T17:00:00.000Z");
  assert.equal(nextTaskDueAt("2026-08-21T17:00:00.000Z", "custom_weekly", new Date("2026-08-21T18:00:00.000Z"), [1, 3, 5]), "2026-08-24T17:00:00.000Z");
});

test("task storage preserves independent occurrences, completion history, and retryable alerts", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS clr_tasks/);
  assert.match(storage, /schedule_days TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS clr_task_completions/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS clr_task_alerts/);
  assert.match(storage, /UNIQUE\(task_id, due_at\)/);
  assert.match(storage, /spawned_next_task_id INTEGER/);
  assert.match(storage, /recurrence_timezone TEXT NOT NULL DEFAULT 'America\/Los_Angeles'/);
  assert.match(storage, /idx_clr_tasks_series_due/);
  assert.match(storage, /next_email_at TEXT/);
  assert.match(storage, /last_email_error TEXT/);
});

test("managers assign tasks while CLRs can only complete their own", () => {
  const create = routes.slice(routes.indexOf('app.post("/api/clr-tasks"'), routes.indexOf('app.patch("/api/clr-tasks/:id"'));
  assert.match(create, /requireManagerOrAdmin/);
  assert.match(create, /Choose an active CLR in this organization/);
  const complete = routes.slice(routes.indexOf('app.post("/api/clr-tasks/:id/complete"'), routes.indexOf('async function alertOverdueClrTasks'));
  assert.match(complete, /Number\(task\.assigned_user_id\) !== userId/);
  assert.match(complete, /nextTaskOccurrenceForRow/);
  assert.match(complete, /spawnNextTaskOccurrence/);
  assert.match(complete, /clr_task_completions/);
});

test("an overdue occurrence alerts once in-app and retries email until accepted", () => {
  const alert = routes.slice(routes.indexOf("async function alertOverdueClrTasks"), routes.indexOf('cron.schedule("* * * * *"', routes.indexOf("async function alertOverdueClrTasks")) + 120);
  assert.match(alert, /INSERT OR IGNORE INTO clr_task_alerts/);
  assert.match(alert, /if \(claimed\.changes\)/, "in-app and push alert only on first overdue detection");
  assert.match(alert, /for \(const manager of managers\)/);
  assert.match(alert, /userId: Number\(task\.assigned_user_id\), type: "task_overdue"/);
  assert.match(alert, /attendanceManagerEmails\(Number\(task\.org_id\)\)/,
    "configured manager recipients such as Scott receive overdue-task email too");
  assert.match(alert, /sendPushToUsers/);
  assert.match(alert, /\{ immediate: true \}/, "the alert is not marked sent before Resend accepts it");
  assert.match(alert, /nextOverdueReminderAt/);
  assert.match(alert, /overdueEmailRetryAt/);
  assert.match(alert, /last_email_error/);
});

test("the task center is a ready-to-use manager and CLR workflow", () => {
  assert.match(app, /path="\/tasks" component=\{ClrTasks\}/);
  assert.match(sidebar, /title: "Tasks"/);
  assert.match(page, /CLR Task Center/);
  assert.match(page, /Custom weekdays/);
  assert.match(page, /Monday, Wednesday, and Friday/);
  assert.match(page, /Assign task/);
  assert.match(page, /Mark done/);
  assert.match(page, /completion history/i);
  assert.match(page, /Due in 24h/);
  assert.match(page, /OVERDUE/);
  assert.match(page, /You have an overdue task/);
  assert.match(page, /Every weekday/);
  assert.match(app, /!isDemo && <TaskOverduePopup \/>/, "read-only demo accounts must not get a reminder they cannot complete");
  assert.match(popup, /task-overdue-popup/);
  assert.match(popup, /Remind me in 30m/);
  assert.match(popup, /DailyReportGateActive/);
  assert.match(popup, /EodLockGateActive/);
});

test("assignment sends the CLR an in-app alert, push, and email", () => {
  const create = routes.slice(routes.indexOf('app.post("/api/clr-tasks"'), routes.indexOf('app.patch("/api/clr-tasks/:id"'));
  assert.match(create, /type: "task_assigned"/);
  assert.match(create, /sendPushToUser\(assignedUserId/);
  assert.match(create, /emailTaskAssignment\(assignee/);
  // The subject line has to be in the notifier's own renderer. Matched against
  // the whole file it would still pass with the string stranded anywhere else,
  // including in a route that never sends anything.
  const emailHelper = routes.slice(routes.indexOf("const emailTaskAssignment = ("), routes.indexOf("const announceSpawnedTaskOccurrence"));
  assert.match(emailHelper, /`New C3 task: \$\{taskTitle\}`/);
  // And the deadline it prints is the helper's, never a bare toLocaleString on
  // a users.timezone that can be blank — see clr-task-assignment-email.test.ts.
  assert.match(create, /formatTaskDueLabel\(due, assignee\.timezone\)/);
  assert.doesNotMatch(create, /timeZone:/);
});
