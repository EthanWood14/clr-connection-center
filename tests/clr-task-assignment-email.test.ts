import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideTaskAssignmentEmail,
  formatTaskDueLabel,
  notifyTaskAssignment,
  shouldEmailTaskAssignment,
  taskAssigneeChanged,
  TASK_ASSIGNMENT_EMAIL_REASONS,
  type TaskAssignmentEmailDeps,
  type TaskAssignmentInput,
} from "../server/clr-task-assignment-email";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
// Create, PATCH, complete, and the overdue sweep — everything that writes a
// deadline where a person will read it.
const taskRoutes = routes.slice(
  routes.indexOf('app.post("/api/clr-tasks"'),
  routes.indexOf('cron.schedule("* * * * *"', routes.indexOf("async function alertOverdueClrTasks")),
);

/**
 * The body of `if (…) { … }`, cut out by matching braces from the guard's own
 * opening brace.
 *
 * Ordering cannot answer "is this call inside the guard?". A call moved one
 * line BELOW the closing brace still has a higher index than the guard, so an
 * index comparison passes for precisely the mutation it was written to catch:
 * every task edit mailing its assignee. Containment is the question, so the
 * block is what gets searched.
 */
function guardedBlock(source: string, opener: string): string {
  const start = source.indexOf(opener);
  assert.notEqual(start, -1, `guard not found in source: ${opener}`);
  let depth = 0;
  for (let i = start + opener.length - 1; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && (depth -= 1) === 0) return source.slice(start, i + 1);
  }
  return assert.fail(`unbalanced braces after: ${opener}`);
}

const MANAGER_ID = 3;
const CLR_ID = 41;
const OTHER_CLR_ID = 42;

function assignment(overrides: Partial<TaskAssignmentInput> = {}): TaskAssignmentInput {
  return {
    reason: "created",
    assignee: { id: CLR_ID, name: "Jordon Chang", email: "jordon@westcapitallending.com", timezone: "America/Los_Angeles" },
    task: {
      title: "Call the Tuesday callback list",
      description: "Everyone who asked for a call back this week.",
      // 5:00 PM Friday in Los Angeles, written as the UTC instant it really is.
      due: new Date("2026-09-05T00:00:00.000Z"),
      assignedBy: "Scott Petrie",
      assignedByUserId: MANAGER_ID,
    },
    ...overrides,
  };
}

/** A notifier whose mailer records instead of sending. */
function harness(deps: Partial<TaskAssignmentEmailDeps> = {}) {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const skips: string[] = [];
  const failures: string[] = [];
  const wired: TaskAssignmentEmailDeps = {
    send: (message) => { sent.push(message); return Promise.resolve("queued:1"); },
    render: (input, dueLabel) => ({
      subject: `New C3 task: ${input.task.title}`,
      html: `<p>${input.task.assignedBy} assigned you a task.</p><p>${input.task.title}</p><p>Due: ${dueLabel}</p>`
        + `<p><a href="https://www.westcapitallending.center/#/tasks">Open Task Center</a></p>`,
    }),
    log: (message) => skips.push(message),
    onError: (message) => failures.push(message),
    ...deps,
  };
  return { deps: wired, sent, skips, failures };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("assigning a task emails the CLR it landed on", () => {
  const { deps, sent } = harness();
  const decision = notifyTaskAssignment(deps, assignment());

  assert.equal(decision.send, true);
  assert.equal(decision.to, "jordon@westcapitallending.com");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "jordon@westcapitallending.com");
  // The four things the CLR needs: what, when, who, and where to go.
  assert.match(sent[0].subject, /Call the Tuesday callback list/);
  assert.match(sent[0].html, /Call the Tuesday callback list/);
  assert.match(sent[0].html, /Scott Petrie/);
  assert.match(sent[0].html, /Fri, Sep 4, 2026/);
  assert.match(sent[0].html, /westcapitallending\.center\/#\/tasks/);
});

test("assigning a task to yourself is not mailed back to you", () => {
  const { deps, sent, skips } = harness();
  const decision = notifyTaskAssignment(deps, assignment({
    assignee: { id: MANAGER_ID, name: "Scott Petrie", email: "spetrie@westcapitallending.com", timezone: "America/Los_Angeles" },
  }));

  assert.equal(decision.send, false);
  assert.equal(decision.skip, "self_assignment");
  assert.equal(sent.length, 0, "a manager who assigns work to themselves already knows");
  assert.match(skips.join("\n"), /self_assignment/);
});

test("handing a task to a different CLR emails the new one, and only on a real change", () => {
  // The task editor submits the whole row, so "did the assignee change?" is the
  // question — not "did a PATCH happen?".
  assert.equal(taskAssigneeChanged(CLR_ID, OTHER_CLR_ID), true);
  assert.equal(taskAssigneeChanged(CLR_ID, CLR_ID), false, "a retitle/re-priority/new-deadline PATCH is not an assignment");
  assert.equal(taskAssigneeChanged("41", 41), false, "sqlite hands back strings in places; compare as numbers");

  const { deps, sent } = harness();
  const decision = notifyTaskAssignment(deps, assignment({
    reason: "reassigned",
    assignee: { id: OTHER_CLR_ID, name: "Skyler Griffin", email: "skyler@westcapitallending.com", timezone: "America/Los_Angeles" },
  }));

  assert.equal(decision.send, true);
  assert.equal(sent.length, 1, "exactly one email: the person who lost the task is not notified");
  assert.equal(sent[0].to, "skyler@westcapitallending.com");
});

test("an occurrence the recurrence engine spawned is never mailed", () => {
  assert.equal(shouldEmailTaskAssignment("recurrence_spawn"), false);
  assert.equal(TASK_ASSIGNMENT_EMAIL_REASONS.includes("recurrence_spawn"), false,
    "a daily series would otherwise mail the same CLR every morning");
  assert.deepEqual([...TASK_ASSIGNMENT_EMAIL_REASONS], ["created", "reassigned"]);

  const { deps, sent, skips } = harness();
  const decision = notifyTaskAssignment(deps, assignment({ reason: "recurrence_spawn" }));

  assert.equal(decision.send, false);
  assert.equal(decision.skip, "auto_spawned_occurrence");
  assert.equal(sent.length, 0);
  assert.match(skips.join("\n"), /auto_spawned_occurrence/);
});

test("an assignee with no mailbox is skipped rather than sent to", () => {
  for (const email of [undefined, null, "", "   ", "not-an-address"]) {
    const { deps, sent } = harness();
    const decision = notifyTaskAssignment(deps, assignment({
      assignee: { id: CLR_ID, name: "No Mailbox", email, timezone: "America/Los_Angeles" },
    }));
    assert.equal(decision.send, false, `${JSON.stringify(email)} must not be mailed`);
    assert.equal(decision.skip, "no_email_address");
    assert.equal(sent.length, 0);
  }

  // Shared portal / system logins are real accounts on a domain with no MX.
  // Resend discards the whole message for one undeliverable recipient.
  const shared = decideTaskAssignmentEmail(assignment({
    assignee: { id: CLR_ID, email: "lap-shared@westcapitallending.center" },
  }));
  assert.equal(shared.send, false);
  assert.equal(shared.skip, "no_email_address");
});

test("a failing or unconfigured mailer never reaches the caller", async () => {
  // 1. The mailer rejects later (Resend down, no API key configured).
  const rejecting = harness({ send: () => Promise.reject(new Error("Email is not configured (no Resend API key).")) });
  const rejected = notifyTaskAssignment(rejecting.deps, assignment());
  assert.equal(rejected.send, true, "the decision stands; only delivery failed");
  assert.equal(typeof (rejected as any).then, "undefined", "notifyTaskAssignment is fire-and-forget, never awaited");
  await settle();
  assert.match(rejecting.failures.join("\n"), /no Resend API key/);

  // 2. The mailer throws synchronously.
  const throwing = harness({ send: () => { throw new Error("mailer exploded"); } });
  const threw = notifyTaskAssignment(throwing.deps, assignment());
  assert.match(String(threw.error), /mailer exploded/);
  assert.match(throwing.failures.join("\n"), /mailer exploded/);

  // 3. Even building the message can fail without costing anyone the task.
  const unrenderable = harness({ render: () => { throw new Error("render exploded"); } });
  assert.doesNotThrow(() => notifyTaskAssignment(unrenderable.deps, assignment()));
  assert.match(unrenderable.failures.join("\n"), /render exploded/);

  // 4. A malformed row is a skip, not a 500.
  assert.doesNotThrow(() => notifyTaskAssignment(harness().deps, undefined as any));
});

test("the deadline is written in a named timezone, never the server's clock", () => {
  // 5:00 PM Friday in Los Angeles. A server on UTC — which production is —
  // would print this as Saturday just after midnight if the zone were left off.
  const due = new Date("2026-09-05T00:00:00.000Z");
  const label = formatTaskDueLabel(due, "America/Los_Angeles");
  assert.match(label, /Fri, Sep 4, 2026/);
  assert.match(label, /5:00\s?PM/);
  assert.match(label, /PDT/, "the abbreviation says which clock the CLR is held to");
  assert.doesNotMatch(label, /Sep 5/);

  // No stored zone falls back to the office's, not to the host's.
  assert.equal(formatTaskDueLabel(due, ""), label);
  assert.equal(formatTaskDueLabel(due, null), label);
  assert.equal(formatTaskDueLabel(due, undefined), label);

  // A CLR who moved keeps their own clock.
  assert.match(formatTaskDueLabel(due, "America/New_York"), /8:00\s?PM/);

  // Junk in users.timezone must not throw inside a notification path.
  assert.equal(formatTaskDueLabel(due, "Mars/Olympus_Mons"), label);
  assert.equal(formatTaskDueLabel(new Date("nonsense"), "America/Los_Angeles"), "No deadline set");
});

test("a blank or unusable users.timezone formats the deadline instead of throwing", () => {
  const due = new Date("2026-09-05T00:00:00.000Z");
  const office = formatTaskDueLabel(due, null);
  assert.match(office, /Fri, Sep 4, 2026/);

  // users.timezone is NOT NULL in the schema, so "unset" arrives as the empty
  // string, and a CLR who moved leaves behind a zone name Intl has never heard
  // of. `??` catches neither, and the bare call is a RangeError — thrown, in
  // the task routes, AFTER the row was committed and BEFORE the assignment
  // email went out: the task existed and the CLR was never told about it.
  for (const stored of ["", "   ", "Mars/Olympus_Mons", "America/Nowhere"]) {
    assert.throws(() => due.toLocaleString("en-US", { timeZone: stored }), RangeError,
      `${JSON.stringify(stored)} is exactly what a bare toLocaleString cannot survive`);
    assert.equal(formatTaskDueLabel(due, stored), office,
      `${JSON.stringify(stored)} has to read as unset, not as a crash`);
  }

  // So no deadline in the task routes reaches Intl on its own: the assignment
  // notice, the overdue notice and the overdue email are all written by the
  // helper, as the push body already was.
  assert.doesNotMatch(taskRoutes, /timeZone:/,
    "no deadline these routes show a person names a zone to Intl itself");
  assert.match(taskRoutes, /message: `Due \$\{formatTaskDueLabel\(due, assignee\.timezone\)\}/);
  assert.match(taskRoutes, /message: `This was due \$\{formatTaskDueLabel\(new Date\(task\.due_at\), assignee\?\.timezone\)\}/);
  assert.match(taskRoutes, /const safeDue = eodActivityEsc\(formatTaskDueLabel\(new Date\(task\.due_at\), assignee\?\.timezone\)\);/);
  assert.equal((taskRoutes.match(/formatTaskDueLabel\(/g) ?? []).length, 6,
    "six deadline labels: the assignment notice and push, the reassignment push, and the overdue notice, assignee notice and email. A seventh belongs here too.");

  // A LABEL is not the only thing these routes do with a zone, and the comment
  // above this block used to claim otherwise. They also STORE one, in
  // clr_tasks.recurrence_timezone, written from `assignee.timezone ?? DEFAULT`
  // — the very non-guard that paragraph said had been eliminated. That column
  // is read back by clr-task-scheduler.ts and handed to Intl with no reader, no
  // label and no fallback: a stored blank was survivable, a stored
  // "Mars/Olympus_Mons" 500'd GET /api/clr-tasks and killed the minute overdue
  // sweep outright. Both writes ask Intl, through normalizeTimezone.
  assert.doesNotMatch(taskRoutes, /timezone \?\? BUSINESS_DAY_DEFAULT_TZ/,
    "`??` catches null and nothing else - a blank or unknown zone stores as-is");
  assert.doesNotMatch(taskRoutes, /timezone \?\? before\.recurrence_timezone/);
  assert.match(taskRoutes, /JSON\.stringify\(scheduleDays\), normalizeTimezone\(assignee\.timezone\),/,
    "the created row's zone is checked on the way into the column");
  assert.match(taskRoutes, /JSON\.stringify\(scheduleDays\), normalizeTimezone\(assignee\.timezone, normalizeTimezone\(before\.recurrence_timezone\)\),/,
    "...and so is the edited row's, including the zone it falls back to");
});

test("the routes hand the notifier the assignee it is being asked about", () => {
  // Every rule in clr-task-assignment-email.ts is about an assignee it is
  // GIVEN. The tests above hand it one directly, so all three fields below can
  // be cut at this seam - in routes.ts, one line each - with every one of those
  // tests still green. That is what makes the seam worth pinning.
  const helper = routes.slice(routes.indexOf("const emailTaskAssignment = ("), routes.indexOf("const announceSpawnedTaskOccurrence"));
  const due = new Date("2026-09-05T00:00:00.000Z");

  // 1. The mailbox. `email: null` here switches the whole feature off, and it
  //    does it quietly: no error, no failed send, just the ordinary
  //    "no_email_address" skip in the log, on every assignment, forever.
  assert.match(helper, /email: assignee\?\.email \?\? null,/);
  assert.equal(decideTaskAssignmentEmail(assignment({
    assignee: { id: CLR_ID, name: "Jordon Chang", email: null, timezone: "America/Los_Angeles" },
  })).skip, "no_email_address", "...which reads exactly like an account that has no mailbox");

  // 2. The identity. Self-assignment suppression compares the assignee's id
  //    against the assigner's, and routes.ts supplies BOTH - so zeroing this
  //    half mails a manager the task they just typed. The suppression's own
  //    test cannot see it: that test passes the ids in itself.
  assert.match(helper, /id: Number\(assignee\?\.id \?\? 0\) \|\| 0,/);
  assert.equal(decideTaskAssignmentEmail(assignment({
    assignee: { id: 0, name: "Scott Petrie", email: "spetrie@westcapitallending.com" },
  })).send, true, "an assignee with no id can never be recognised as the assigner");

  // 3. The clock. formatTaskDueLabel writes the deadline in the assignee's own
  //    zone only if it is handed one; `timezone: null` here puts every C3 task
  //    email on the office clock while "a CLR who moved keeps their own clock"
  //    goes on passing, because that test calls the formatter directly.
  assert.match(helper, /timezone: assignee\?\.timezone \?\? null,/);
  assert.notEqual(formatTaskDueLabel(due, "America/New_York"), formatTaskDueLabel(due, null),
    "...and it is a real difference: 8:00 PM Eastern against 5:00 PM Pacific");
});

test("one unusable row cannot take the overdue sweep down with it", () => {
  const sweepStart = routes.indexOf("async function alertOverdueClrTasks()");
  const sweep = routes.slice(sweepStart, routes.indexOf('cron.schedule("* * * * *"', sweepStart));
  // The catch-up is this function's first statement and the only one in it that
  // hands a stored zone to Intl. Unguarded, it threw straight past every try
  // below and out of the sweep entirely: the cron's own .catch() logged it and
  // no overdue notice, push or email went out for ANY org - and not only that
  // minute, because the next tick met the same row again.
  const guarded = guardedBlock(sweep, "try {");
  assert.match(guarded, /announceSpawnedTaskOccurrences\(ensureRecurringTaskOccurrences\(taskSqlite\(\), now\)\)/,
    "the first try in the sweep is the one around the catch-up");
  // guardedBlock stops at the try's own closing brace, so the handler is what
  // comes immediately after it - and it has to be a handler, not a `finally`.
  const afterGuard = sweep.slice(sweep.indexOf(guarded) + guarded.length);
  assert.match(afterGuard, /^ catch \(error: any\) \{[\s\S]*?console\.error\("\[clr-tasks\] overdue sweep catch-up failed:/,
    "and it records what it swallowed rather than dropping it in silence");
  assert.equal(sweep.split("ensureRecurringTaskOccurrences(").length - 1, 1,
    "one catch-up in the sweep, and it is the guarded one");
  // A try wide enough to swallow the alerting as well would satisfy the line
  // above while silently dropping the very thing this function exists to send.
  assert.doesNotMatch(guarded, /clr_task_alerts/,
    "the guard covers the catch-up alone, not the alerting it protects");
  assert.match(sweep, /INSERT OR IGNORE INTO clr_task_alerts/, "...which the sweep does still do");
});

test("the task routes announce every assignment, and only assignments", () => {
  const create = routes.slice(routes.indexOf('app.post("/api/clr-tasks"'), routes.indexOf('app.patch("/api/clr-tasks/:id"'));
  const patch = routes.slice(routes.indexOf('app.patch("/api/clr-tasks/:id"'), routes.indexOf('app.get("/api/clr-tasks/history"'));

  // Creation: the assignee, the actor who assigned it, and the reason.
  assert.match(create, /emailTaskAssignment\(assignee, \{[^}]*assignedByUserId: actorId[^}]*\}, "created"\)/);

  // Reassignment: the email has to sit INSIDE the named change check, not
  // merely somewhere after it. The guarded block is cut out and searched,
  // because the mutation worth catching — the email one line below that
  // block's closing brace, so every retitle and every moved deadline mails the
  // assignee — is indistinguishable from the correct code by index order.
  const guarded = guardedBlock(patch, "if (taskAssigneeChanged(before.assigned_user_id, assignedUserId)) {");
  assert.equal(patch.split("emailTaskAssignment(").length - 1, 1, "one email per PATCH at most");
  assert.equal(guarded.split("emailTaskAssignment(").length - 1, 1,
    "the PATCH's one email is the one inside the change check");
  assert.match(guarded, /emailTaskAssignment\(assignee, \{[^}]*assignedByUserId: actorId[^}]*\}, "reassigned"\)/);
  // The in-app notice and the push are the same decision and live there too.
  assert.match(guarded, /storage\.createNotification\(\{ userId: assignedUserId, type: "task_assigned"/);
  assert.match(guarded, /sendPushToUser\(assignedUserId, \{ title: "C3 task assigned to you"/);
  // And the block really is the guard's own rather than the rest of the route:
  // the audit entry every PATCH writes is outside it.
  assert.doesNotMatch(guarded, /audit\(\{ userId: actorId/);
  assert.match(patch, /audit\(\{ userId: actorId/, "…which the PATCH does write, unguarded");

  // Auto-spawned occurrences are offered to the same policy, which declines.
  assert.match(routes, /const announceSpawnedTaskOccurrence = \(row: any\) => \{/);
  assert.match(routes, /\}, "recurrence_spawn"\);/);
  const catchUps = [...routes.matchAll(/ensureRecurringTaskOccurrences\(taskSqlite\(\)/g)];
  assert.ok(catchUps.length >= 3, "series are still caught up on read, on completion, and on the minute cron");
  for (const call of catchUps) {
    const upToHere = routes.slice(routes.lastIndexOf("\n", call.index ?? 0) + 1, call.index ?? 0);
    assert.match(upToHere, /announceSpawnedTaskOccurrences\($/,
      "every catch-up must hand its new occurrences straight to the assignment policy");
  }
  // The catch-up is not the only door. Completing a recurring task spawns its
  // successor DIRECTLY, and scanning only ensureRecurringTaskOccurrences left
  // that call free to be detached from the policy with nothing failing:
  // occurrences created, and the decision not to mail them never made.
  const spawns = [...routes.matchAll(/spawnNextTaskOccurrence\(taskSqlite\(\)/g)];
  assert.ok(spawns.length >= 1, "the completion path still prepares its own successor");
  for (const call of spawns) {
    const upToHere = routes.slice(routes.lastIndexOf("\n", call.index ?? 0) + 1, call.index ?? 0);
    assert.match(upToHere, /announceSpawnedTaskOccurrence\($/,
      "a spawn outside the policy is an occurrence nobody decided anything about");
  }

  // The send can never fail the request that triggered it.
  assert.doesNotMatch(routes, /await emailTaskAssignment/);
  assert.doesNotMatch(routes, /await announceSpawnedTaskOccurrence/);
  const helper = routes.slice(routes.indexOf("const emailTaskAssignment = ("), routes.indexOf("const announceSpawnedTaskOccurrence"));
  // No meta argument: an assignment notice is queued behind EMAIL_SEND_DELAY_MS
  // like the rest of C3's mail, not sent immediately like the overdue alert.
  assert.match(helper, /send: \(message\) => sendEmail\(\{ to: \[message\.to\], subject: message\.subject, html: message\.html \}\),/);
  assert.match(helper, /onError: \(message: string\) => console\.error\(message\)/);
  // What the CLR is told, and a link that carries no personal data.
  assert.match(helper, /\$\{safeManager\}/);
  assert.match(helper, /\$\{safeTitle\}/);
  assert.match(helper, /Due: \$\{safeDue\}/);
  assert.match(helper, /href="https:\/\/www\.westcapitallending\.center\/#\/tasks"/);
});
