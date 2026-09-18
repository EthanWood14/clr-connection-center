import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OVERDUE_TASK_MANAGER_EMAIL_OPT_OUT,
  overdueTaskEmailRecipients,
  shouldEmailOverdueTaskToManager,
} from "../server/clr-task-overdue-email";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("Chris Redoble is intentionally off overdue-task manager email", () => {
  assert.ok(
    OVERDUE_TASK_MANAGER_EMAIL_OPT_OUT.includes("credoble@westcapitallending.com"),
    "credoble@ must be on the opt-out list — that is the switch Ethan asked for",
  );
  assert.equal(shouldEmailOverdueTaskToManager("credoble@westcapitallending.com"), false);
  assert.equal(shouldEmailOverdueTaskToManager("  Credoble@WestCapitalLending.com "), false);
  assert.equal(shouldEmailOverdueTaskToManager("chris.redoble@westcapitallending.com"), false);
});

test("other managers and the assignee still receive overdue-task email", () => {
  assert.equal(shouldEmailOverdueTaskToManager("spetrie@westcapitallending.com"), true);
  assert.equal(shouldEmailOverdueTaskToManager("scott.petrie@westcapitallending.com"), true);

  const recipients = overdueTaskEmailRecipients({
    assigneeEmail: "clr@westcapitallending.com",
    managerEmails: [
      "spetrie@westcapitallending.com",
      "credoble@westcapitallending.com",
      "chris.redoble@westcapitallending.com",
      "SPETRIE@westcapitallending.com",
    ],
  });

  assert.deepEqual(recipients, [
    "clr@westcapitallending.com",
    "spetrie@westcapitallending.com",
  ]);
});

test("an assignee who is also Chris still gets the overdue email as the worker", () => {
  // Opt-out is manager-only. If credoble@ were somehow the assignee, the work
  // notice must still reach them — only the manager BCC is suppressed.
  const recipients = overdueTaskEmailRecipients({
    assigneeEmail: "credoble@westcapitallending.com",
    managerEmails: ["credoble@westcapitallending.com", "spetrie@westcapitallending.com"],
  });
  assert.deepEqual(recipients, [
    "credoble@westcapitallending.com",
    "spetrie@westcapitallending.com",
  ]);
});

test("late/overdue task email path in routes uses the opt-out helper", () => {
  const alert = routes.slice(
    routes.indexOf("async function alertOverdueClrTasks"),
    routes.indexOf('cron.schedule("* * * * *"', routes.indexOf("async function alertOverdueClrTasks")) + 120,
  );
  assert.match(alert, /overdueTaskEmailRecipients\(/);
  assert.match(alert, /managerEmails:\s*attendanceManagerEmails\(Number\(task\.org_id\)\)/);
  // Must not BCC the raw manager list without the filter — that is how Chris
  // was getting daily "done late" mail.
  assert.doesNotMatch(
    alert,
    /recipients = Array\.from\(new Set\(\[\s*\.\.\.\(assigneeEmail/,
    "raw manager BCC must go through overdueTaskEmailRecipients",
  );
});

test("assignment email path is untouched by the overdue opt-out", () => {
  // Guardrail: stopping late/overdue manager mail must not disable assignment
  // notices Ethan still wants.
  assert.match(routes, /from "\.\/clr-task-assignment-email"/);
  assert.match(routes, /notifyTaskAssignment|emailTaskAssignment/);
  assert.doesNotMatch(
    readFileSync(join(root, "server/clr-task-assignment-email.ts"), "utf8"),
    /OVERDUE_TASK_MANAGER_EMAIL_OPT_OUT|credoble@westcapitallending\.com/,
  );
});
