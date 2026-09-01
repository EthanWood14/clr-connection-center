import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-tasks.tsx"), "utf8");

const complete = routes.slice(
  routes.indexOf('app.post("/api/clr-tasks/:id/complete"'),
  routes.indexOf("spawnNextTaskOccurrence(taskSqlite(), id)"),
);

test("completing a task requires certifying what was done", () => {
  // A tick with no words is not a record anyone can check later.
  assert.match(complete, /note\.length < 10/);
  assert.match(complete, /a completion note of at least 10 characters is required/);
  // And it is enforced on the SERVER, not just hidden in the dialog.
  assert.match(complete, /return res\.status\(400\)/);
});

test("a calling task must report how many calls were made", () => {
  assert.match(routes, /function taskWantsCallCount/);
  assert.match(routes, /\^call\b/i, "matches 'Call Meta Leads' and other Call tasks");
  assert.match(complete, /Enter how many calls you made/);
  // Nonsense counts are refused rather than stored.
  assert.match(complete, /n < 0/);
  assert.match(complete, /n > 5000/);
  // Non-calling tasks are not forced to invent a number.
  assert.match(complete, /let callsMade: number \| null = null/);
});

test("the count and the note are actually stored", () => {
  assert.match(routes, /ALTER TABLE clr_task_completions ADD COLUMN calls_made INTEGER/);
  assert.match(complete, /INSERT INTO clr_task_completions \(task_id,org_id,due_at,completed_by_user_id,completed_at,note,calls_made\)/);
});

test("history is viewable, scoped, and bounded", () => {
  const hist = routes.slice(routes.indexOf('app.get("/api/clr-tasks/history"'), routes.indexOf('app.post("/api/clr-tasks/:id/complete"'));
  assert.ok(hist.length > 0, "there must be a history endpoint");
  // A CLR sees their own; a manager sees everyone.
  assert.match(hist, /if \(!canManage\) \{ wheres\.push\("c\.completed_by_user_id=\?"\)/);
  assert.match(hist, /c\.org_id=\?/, "never crosses orgs");
  assert.match(hist, /Math\.min\(500,/, "bounded");
  // And it is reachable from the page.
  assert.match(page, /data-testid="button-task-history"/);
  assert.match(page, /data-testid="task-history-panel"/);
  assert.match(page, /data-testid="task-history-row"/);
});

test("the dialog will not submit an uncertified completion", () => {
  assert.match(page, /const MIN_NOTE = 10/);
  assert.match(page, /completionNote\.trim\(\)\.length < MIN_NOTE/);
  // The client mirrors the server rule rather than inventing its own.
  assert.match(page, /const wantsCallCount = \(title: string\) => \/\^call/);
});
