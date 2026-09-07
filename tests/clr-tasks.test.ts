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
const scheduler = readFileSync(join(root, "server/clr-task-scheduler.ts"), "utf8");
const compPage = readFileSync(join(root, "client/src/pages/comp-requests.tsx"), "utf8");

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

// ── task pay (server/task-comp.ts), as it is wired ──────────────────────────
// The module is 64 tests of policy about money. These are about the wiring the
// policy only reaches money through: if a route stops calling it, or files the
// request outside the completion's transaction, every rule above becomes
// decoration.

test("the pay columns and the exactly-once index are added at boot", () => {
  assert.match(storage, /ALTER TABLE clr_tasks ADD COLUMN comp_amount_cents INTEGER/);
  assert.match(storage, /ALTER TABLE clr_tasks ADD COLUMN comp_reason TEXT/);
  assert.match(storage, /ALTER TABLE clr_tasks ADD COLUMN comp_set_by_user_id INTEGER/);
  assert.match(storage, /ALTER TABLE clr_tasks ADD COLUMN comp_set_at TEXT/);
  assert.match(storage, /ALTER TABLE clr_tasks ADD COLUMN comp_set_for_user_id INTEGER/);
  assert.match(routes, /ALTER TABLE comp_requests ADD COLUMN task_comp_task_id INTEGER/);
  assert.match(routes, /ALTER TABLE comp_requests ADD COLUMN task_comp_key TEXT/);
  // The index statement is the module's own constant, so it cannot drift from
  // the rule taskCompAlreadyFiled enforces in code.
  assert.match(routes, /exec\(TASK_COMP_REQUEST_UNIQUE_INDEX\)/);
  // A missing column reads exactly like an unpaid task, so boot says so loudly
  // and the feature refuses rather than silently paying nobody.
  assert.match(routes, /\[task-comp\] MISSING COLUMN\(S\)/);
  assert.match(routes, /\[task-comp\] MISSING INDEX/);
  assert.match(routes, /const taskCompReady = /);
});

test("every create and patch is judged by task-comp.ts, with the authority the route already has", () => {
  const create = routes.slice(routes.indexOf('app.post("/api/clr-tasks"'), routes.indexOf('app.patch("/api/clr-tasks/:id"'));
  const patch = routes.slice(routes.indexOf('app.patch("/api/clr-tasks/:id"'), routes.indexOf('app.get("/api/clr-tasks/comp-preview"'));
  for (const [name, route] of [["create", create], ["patch", patch]] as const) {
    assert.match(route, /parseTaskCompChange\(/, `${name} must call the module`);
    assert.match(route, /isTaskManager: taskManager\(/, `${name} must reuse taskManager(), never a second manager check`);
    assert.match(route, /req\.body \?\? \{\}/, `${name} must hand over the WHOLE body — a reassignment moves money too`);
    assert.match(route, /res\.status\(compChange\.status\)\.json\(\{ error: compChange\.error \}\)/,
      `${name} must answer with the module's own refusal, never drop the field`);
    assert.match(route, /comp_amount_cents/, `${name} must write the amount it was given`);
  }
  // The patch is the one that can hand an already-paid task to the person
  // making it, so it is judged even when it carries no comp field at all.
  assert.ok(patch.indexOf("req.body?.amountCents === undefined") < 0,
    "the module is called on EVERY patch, not only the ones carrying a comp field");
});

test("the completion files the money INSIDE the completion's own transaction", () => {
  const complete = routes.slice(routes.indexOf('app.post("/api/clr-tasks/:id/complete"'), routes.indexOf("async function alertOverdueClrTasks"));
  const opens = complete.indexOf("taskSqlite().transaction(");
  const closes = complete.indexOf("})();", opens);
  assert.ok(opens > 0 && closes > opens);
  const inside = complete.slice(opens, closes);
  assert.match(inside, /INSERT INTO clr_task_completions/);
  assert.match(inside, /UPDATE clr_tasks SET status='completed'/);
  assert.match(inside, /INSERT INTO comp_requests/,
    "a request filed in a SECOND transaction would have no exactly-once protection");
  assert.match(inside, /task_comp_task_id,task_comp_key/);
  assert.match(inside, /approval_token/);
  // processRecurringComp generates its token before its transaction and writes
  // it as a column of the same INSERT. A token attached by a later UPDATE can
  // be lost between the commit and that update.
  const token = complete.indexOf("crypto.randomBytes");
  assert.ok(token > 0 && token < opens, "the approval token is generated BEFORE the transaction");
  assert.ok(complete.indexOf("UPDATE comp_requests SET approval_token") < 0);
});

test("both required guards are real lookups, and the existing query is the module's own", () => {
  const complete = routes.slice(routes.indexOf('app.post("/api/clr-tasks/:id/complete"'), routes.indexOf("async function alertOverdueClrTasks"));
  // Run verbatim: the natural `WHERE user_id = ?` version silently defeats the
  // guard, because a task can be reassigned between two completions.
  assert.match(complete, /prepare\(TASK_COMP_EXISTING_QUERY\)\.all\(orgId, id\)/);
  assert.ok(complete.indexOf("FROM comp_requests WHERE user_id") < 0);
  // payeeActive is the same read processRecurringComp does, not a placeholder.
  assert.match(complete, /payee\.isActive \?\? payee\.is_active/);
  assert.match(complete, /payeeActive,/);
  assert.ok(complete.indexOf("payeeActive: true") < 0, "a hardcoded 'yes' would pay a deactivated account");
  assert.ok(complete.indexOf("existing: []") < 0, "an empty list is a lie that pays twice — leave it undefined and refuse");
});

test("mapComp hands out the two columns the duplicate guard is decided on", () => {
  const mapper = routes.slice(routes.indexOf("function mapComp(r: any"), routes.indexOf("function compNameMap()"));
  assert.match(mapper, /taskCompTaskId: r\.task_comp_task_id/);
  assert.match(mapper, /taskCompKey: r\.task_comp_key/);
});

test("a payee cannot delete the request that stops their task paying twice", () => {
  const start = routes.indexOf('app.delete("/api/comp/:id"');
  const remove = routes.slice(start, routes.indexOf('app.post("/api/comp/:id/attachments"', start));
  assert.match(remove, /existing\.task_comp_task_id != null && !isCompAdmin\(userId\)/);
  assert.match(remove, /filed automatically when task #/);
  assert.match(remove, /stops that task from paying twice/);
  assert.match(remove, /Ask a comp admin/, "the refusal has to say who can");
  // The refusal must sit ABOVE the delete it is refusing.
  assert.ok(remove.indexOf("task_comp_task_id != null") < remove.indexOf("DELETE FROM comp_requests"));
});

test("the recurrence engine still does not copy the pay onto the next occurrence", () => {
  // TASK_COMP_RECURRING_MODE is "this-occurrence-only", and this is the
  // mechanism behind it: an unpaid successor is unpaid because the column was
  // never copied, not because a later check remembered to skip it.
  const spawn = scheduler.slice(scheduler.indexOf("export function spawnNextTaskOccurrence"), scheduler.indexOf("export function ensureRecurringTaskOccurrences"));
  assert.match(spawn, /INSERT INTO clr_tasks/);
  assert.ok(spawn.indexOf("comp_amount_cents") < 0, "a daily paid task would otherwise file a request every day, with no ceiling");
  assert.ok(spawn.indexOf("comp_") < 0, "the successor is unpaid because no comp column is ever copied");
});

test("only a manager sees the pay field, and it states the cap before anything is typed", () => {
  assert.ok(page.indexOf("payload.taskComp?.enabled === true") > 0, "the field is offered to somebody who may use it, and nobody else");
  assert.ok(page.indexOf("Pay for this task (optional)") > 0);
  assert.ok(page.indexOf("up to {money(maxCents)} per task") > 0, "the cap is stated up front, not discovered by being refused");
  assert.ok(page.indexOf("Task pay cannot be more than ${money(maxCents)}") > 0);
  assert.ok(page.indexOf("!!payError || save.isPending") > 0, "a bad amount cannot be submitted at all");
  // Dollars in, cents stored: $50 typed here can never become $5,000.
  assert.ok(page.indexOf("Math.round(Number(raw) * 100)") > 0);
  assert.ok(page.indexOf("Amount ($)") > 0);
});

test("a repeating paid task shows the module's own exposure sentence before saving", () => {
  assert.ok(page.indexOf("/api/clr-tasks/comp-preview") > 0);
  assert.ok(page.indexOf("Before you save:") > 0);
  assert.ok(page.indexOf('data-testid="task-pay-exposure"') > 0);
  // It is the server's sentence, not a copy kept over here that can drift from
  // the rule it describes.
  assert.ok(page.indexOf("setExposure(String(result?.warning") > 0);
  const preview = routes.slice(routes.indexOf('app.get("/api/clr-tasks/comp-preview"'), routes.indexOf('app.get("/api/clr-tasks/comp-preview"') + 1400);
  assert.match(preview, /if \(!taskManager\(me\)\)/);
  assert.match(preview, /recurringCompExposure\(/);
});

test("the pay on a task is visible to the CLR doing it, and the filed request afterwards", () => {
  assert.ok(page.indexOf('data-testid="task-pay-badge"') > 0);
  assert.ok(page.indexOf("Pays {money(task.compAmountCents)}") > 0);
  assert.ok(page.indexOf("on completion") > 0);
  assert.ok(page.indexOf('data-testid="completion-pay-notice"') > 0, "the completion dialog says what the click is worth");
  assert.ok(page.indexOf("a manager still approves it") > 0, "and that it is not the money itself");
  assert.ok(page.indexOf('data-testid="task-comp-request"') > 0, "the request it became is surfaced on the task");
  assert.ok(page.indexOf("Comp request #{task.compRequestId}") > 0);
});

test("a payee cannot rewrite the amount of a request C3 filed for them", () => {
  // Editing a submitted request resubmits it with whatever amount and
  // description the body carries. On a hand-typed request that is the owner's
  // own claim; on a task-pay request it would turn the $50 a manager attached
  // into $500, looking like any other pending request by the time an approver
  // sees it. This is the same family of hole as the DELETE one.
  const start = routes.indexOf('app.patch("/api/comp/:id"');
  const patch = routes.slice(start, start + 2600);
  assert.match(patch, /existing\.task_comp_task_id != null && !isCompManager\(userId\)/);
  assert.match(patch, /not yours to change/);
  assert.ok(patch.indexOf("task_comp_task_id != null") < patch.indexOf("const amountCents = body.amountCents"),
    "the refusal must sit above the amount it protects");
});

test("the editor never asks to re-attach pay it is not changing", () => {
  // Pay is frozen on a completed or archived task, so an editor that always
  // sent the amount would turn an ordinary rename into a 409 — and an editor
  // that always sent the assignee would make that rename look like a
  // reassignment of a task carrying money.
  assert.ok(page.indexOf('const payLocked = !!task && task.status !== "active"') > 0);
  assert.ok(page.indexOf('data-testid="task-pay-locked"') > 0, "a locked amount is still shown, and says why");
  assert.ok(page.indexOf("const payChanged =") > 0);
  assert.ok(page.indexOf("...(payChanged ?") > 0);
  assert.ok(page.indexOf("...(assigneeChanged ?") > 0);
  // Clearing the pay is still an explicit null, not an omission.
  assert.ok(page.indexOf("amountCents: nextPayCents") > 0);
});

// ── the payout states, and the guard row itself ─────────────────────────────
// Rule 5 says a task pays at most once. Everything below is a way that promise
// could be broken AFTER the request exists: by the payee re-queueing their own
// paid request, or by the guard row being deleted out from under it.

test("a payee cannot flip their own task pay back to unpaid and be paid a second time", () => {
  // is_paid is writable in BOTH directions here, and `status='approved' AND
  // is_paid=0` is exactly what the payout queue selects. So an owner allowed to
  // set it can mark their own already-paid task pay unpaid and have it appear
  // on the next payout sheet — the same money, twice, with nothing to show it.
  const start = routes.indexOf('app.post("/api/comp/:id/paid"');
  const paid = routes.slice(start, routes.indexOf('app.delete("/api/comp/:id"', start));
  assert.match(paid, /existing\.task_comp_task_id != null && !isCompManager\(userId\)/);
  assert.match(paid, /payout status is not yours to set/);
  assert.match(paid, /Ask a comp manager/, "the refusal has to say who can");
  // Above every flag it protects — is_paid above all.
  const refusal = paid.indexOf("task_comp_task_id != null");
  assert.ok(refusal > 0);
  assert.ok(refusal < paid.indexOf("UPDATE comp_requests SET is_paid"), "the refusal must sit above the flag it protects");
  assert.ok(refusal < paid.indexOf("UPDATE comp_requests SET is_processing"));
  assert.ok(refusal < paid.indexOf("UPDATE comp_requests SET is_received"));
  // And this is still the queue that reads it, so the hole is real, not theoretical.
  assert.match(routes, /status='approved' AND is_paid=0 ORDER BY user_id/);
  // The switch that would have done it is not offered on their own request
  // either — a control that is always refused is worse than no control.
  assert.ok(compPage.indexOf("r.taskCompTaskId != null ? (") > 0);
  assert.ok(compPage.indexOf("Payout status is set by a comp manager") > 0);
  assert.ok(compPage.indexOf("taskCompTaskId?: number | null;") > 0, "the client has to be able to see which rows those are");
});

test("an approved or paid task-pay request cannot be deleted, and one that is gets audited", () => {
  const start = routes.indexOf('app.delete("/api/comp/:id"');
  const remove = routes.slice(start, routes.indexOf('app.post("/api/comp/:id/attachments"', start));
  // Deleting the row deletes the guard, which re-arms the task for a second
  // FULL payment — and takes the record of the first one with it.
  assert.match(remove, /existing\.task_comp_task_id != null && \(existing\.status === "approved" \|\| existing\.is_paid\)/);
  assert.match(remove, /re-arms that task for a second full payment/);
  assert.match(remove, /Deny it instead/, "the refusal has to say what to do instead");
  assert.ok(remove.indexOf('existing.status === "approved"') < remove.indexOf("DELETE FROM comp_requests"),
    "the refusal must sit above the delete it is refusing");
  // The deletes that ARE allowed name the task they re-arm, in the trail.
  assert.ok(remove.indexOf("audit({") > remove.indexOf("DELETE FROM comp_requests"),
    "audited after the row is really gone, so the entry cannot outlive a failed delete");
  assert.match(remove, /entityType: "comp_request"/);
  assert.match(remove, /can file its pay again/);
  assert.match(remove, /taskId: rearmedTaskId/);
  assert.match(remove, /action: "delete"/);
});

test("task pay is booked to the OFFICE business day, not the UTC calendar date", () => {
  const complete = routes.slice(routes.indexOf('app.post("/api/clr-tasks/:id/complete"'), routes.indexOf("async function alertOverdueClrTasks"));
  // Unsaid, the plan falls back to the completion's UTC date — which from ~5pm
  // Pacific is already tomorrow, and on the last evening of a month is the next
  // MONTH, moving the pay into a different pay period.
  assert.match(complete, /expenseDate: businessTodayInTz\(BUSINESS_DAY_DEFAULT_TZ, new Date\(completedAt\)\)/);
  // The same zone and the same helper as the filer it is matching.
  const recurring = routes.slice(routes.indexOf("async function processRecurringComp"), routes.indexOf('cron.schedule("0 */6 * * *"'));
  assert.match(recurring, /businessTodayInTz\(BUSINESS_DAY_DEFAULT_TZ\)/);
});

test("a completion that files no pay tells the person who completed it, and the trail", () => {
  const complete = routes.slice(routes.indexOf('app.post("/api/clr-tasks/:id/complete"'), routes.indexOf("async function alertOverdueClrTasks"));
  // The sentence is the module's, so it cannot drift from the rule that
  // declined; the route only decides who hears it.
  assert.match(complete, /const compNotFiledNotice = taskCompSkipNotice\(compPlan\)/);
  assert.match(complete, /\} else if \(compNotFiledNotice\) \{/);
  // The log line stays — but a console.error is nobody being told.
  assert.match(complete, /console\.error\(`\[task-comp\] task #\$\{id\} filed nothing/);
  assert.match(complete, /entityLabel: `Task pay NOT filed: \$\{String\(task\.title\)\}`/);
  assert.match(complete, /skipped: compPlan\.skipped, detail: compPlan\.skipDetail/);
  assert.match(complete, /notice: compNotFiledNotice/, "and it reaches the completing user in the response");
  // Which the client shows instead of the cheerful toast.
  assert.ok(page.indexOf("const payNotFiled =") > 0);
  assert.ok(page.indexOf("Task complete — but its pay was NOT filed") > 0);
  assert.ok(page.indexOf('variant: "destructive"') > 0, "a toast that reads like success is not being told");
});

test("the duplicate-pay 409 matches what SQLite actually says", () => {
  const complete = routes.slice(routes.indexOf('app.post("/api/clr-tasks/:id/complete"'), routes.indexOf("async function alertOverdueClrTasks"));
  // "UNIQUE constraint failed: comp_requests.task_comp_task_id" — the COLUMN.
  // Matching the INDEX name (an underscore where the dot is) could never fire,
  // so this branch was dead and every duplicate got the wrong message.
  assert.match(complete, /message\.includes\("comp_requests\.task_comp_task_id"\)/);
  assert.ok(complete.indexOf('message.includes("comp_requests_task_comp_task_id")') < 0);
  assert.ok(complete.indexOf('message.includes("comp_requests.task_comp_task_id")') < complete.indexOf('message.includes("UNIQUE")'),
    "the specific message has to be tried before the generic one");
});

test("clearing the pay goes through the same unavailable-schema gate as attaching it", () => {
  const create = routes.slice(routes.indexOf('app.post("/api/clr-tasks"'), routes.indexOf('app.patch("/api/clr-tasks/:id"'));
  const patch = routes.slice(routes.indexOf('app.patch("/api/clr-tasks/:id"'), routes.indexOf('app.get("/api/clr-tasks/comp-preview"'));
  for (const [name, route] of [["create", create], ["patch", patch]] as const) {
    // A clear writes the same five columns with nulls in them, so a gate that
    // looked at the AMOUNT waved it straight through to a missing column and an
    // opaque 500 — with no task created and nothing said about pay.
    assert.match(route, /if \(compChange\.next && !taskCompReady\)/, `${name} must gate EVERY comp write`);
    assert.ok(route.indexOf("compChange.next?.compAmountCents != null && !taskCompReady") < 0,
      `${name} must not gate on the amount — clearing carries none`);
    assert.match(route, /status\(503\)/);
    assert.match(route, /\[task-comp\] line in the server log/);
  }
});

test("an empty scheduleDays is 'schedule unknown', not Sunday", () => {
  const start = routes.indexOf('app.get("/api/clr-tasks/comp-preview"');
  const preview = routes.slice(start, start + 2200);
  // "".split(",") is [""], Number("") is 0, and 0 is a perfectly good Sunday —
  // so a custom_weekly with nothing picked answered "about 4 a month" in place
  // of the module's deliberate "C3 cannot say how often this repeats".
  assert.match(preview, /\.map\(\(d: string\) => d\.trim\(\)\)\.filter\(\(d: string\) => d !== ""\)/);
  assert.ok(preview.indexOf('.split(",").map((d: string) => Number(d)).filter') < 0,
    "the blank segment must be dropped before Number() ever sees it");
});
