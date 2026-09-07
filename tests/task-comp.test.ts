import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  // rule 1 — who may set it
  ALLOW_SELF_ASSIGNED_TASK_COMP, TASK_COMP_LOCKED_TASK_STATUSES, TASK_COMP_TASK_COLUMNS,
  mayAttachTaskComp, parseTaskCompChange,
  // rule 2 — what is attached
  TASK_COMP_MIN_CENTS, TASK_COMP_MAX_CENTS, TASK_COMP_REASON_REQUIRED,
  TASK_COMP_REASON_MIN_LENGTH, TASK_COMP_REASON_MAX_LENGTH,
  validateTaskCompAmountCents, validateTaskCompReason, validateTaskCompExpenseDate,
  // rule 3 — who gets paid
  TASK_COMP_PAYEE, TASK_COMP_REASSIGNMENT,
  // rule 5 — exactly once
  TASK_COMP_IDEMPOTENCY_COLUMNS, TASK_COMP_MARKER_PREFIX, TASK_COMP_COVERING_STATUSES,
  TASK_COMP_REQUEST_COLUMNS, TASK_COMP_REQUEST_UNIQUE_INDEX, TASK_COMP_EXISTING_QUERY,
  taskCompletionKey, buildTaskCompMarker, readTaskCompKey, readTaskCompTaskId, taskCompAlreadyFiled,
  // rule 6 — recurring
  TASK_COMP_RECURRING_MODE, TASK_COMP_SPAWN_COPIES_AMOUNT,
  taskRecurs, occurrencesPerMonth, recurringCompExposure, normalizeTaskCompScheduleDays,
  // rule 7 — what the request says
  TASK_COMP_DESCRIPTION_TAG, TASK_COMP_MAX_DESCRIPTION_LENGTH, TASK_COMP_MAX_NOTE_LENGTH,
  buildTaskCompDescription, buildTaskCompNote,
  // rule 8 — nothing is auto-approved
  TASK_COMP_FILED_STATUS, TASK_COMP_IS_REIMBURSEMENT, TASK_COMP_CATEGORY,
  // the plan
  planTaskCompFiling, taskCompRequestRow, taskCompSkipNotice, formatMoneyCents,
  type TaskCompActor, type TaskCompTaskRow, type TaskCompletionRow, type TaskCompRequestRow,
} from "../server/task-comp";
// The office business day the completion route books this pay to — the same
// helper processRecurringComp and every other comp filer in this app uses.
import { businessTodayInTz, BUSINESS_DAY_DEFAULT_TZ } from "../server/business-day";

// ── fixtures ────────────────────────────────────────────────────────────────

const MANAGER: TaskCompActor = { userId: 9, isTaskManager: true };
const OTHER_MANAGER: TaskCompActor = { userId: 11, isTaskManager: true };
const CLR: TaskCompActor = { userId: 4, isTaskManager: false };

const SET_AT = "2026-09-07T15:00:00.000Z";
const DUE_AT = "2026-09-08T17:00:00.000Z";
const COMPLETED_AT = "2026-09-08T16:31:00.000Z";

function paidTask(over: Partial<TaskCompTaskRow> = {}): TaskCompTaskRow {
  return {
    id: 12,
    orgId: 1,
    title: "Call the Q3 renewals list",
    status: "active",
    recurrence: "none",
    assignedUserId: 4,
    compAmountCents: 5000,
    compReason: "Extra evening calling block",
    compSetByUserId: 9,
    compSetAt: SET_AT,
    compSetForUserId: 4,
    ...over,
  };
}

function completion(over: Partial<TaskCompletionRow> = {}): TaskCompletionRow {
  return { taskId: 12, orgId: 1, dueAt: DUE_AT, completedByUserId: 4, completedAt: COMPLETED_AT, ...over };
}

const NAMES = { payeeName: "Nina Reyes", completedByName: "Nina Reyes", setByName: "Dana Wu" };

/** The two REQUIRED guards, supplied by default so each test opts out on purpose. */
const GUARDS = { existing: [] as TaskCompRequestRow[], payeeActive: true };

const planFor = (task: TaskCompTaskRow, extra: Record<string, unknown> = {}) =>
  planTaskCompFiling({ task, completion: completion(), ...GUARDS, ...NAMES, ...extra } as any);

// ────────────────────────────────────────────────────────────────────────────
// RULE 1 — WHO MAY SET IT. Only a task manager. A CLR never can, not even on
// their own task, and the refusal is a refusal — not a dropped field.
// ────────────────────────────────────────────────────────────────────────────

test("only a task manager may attach pay, and authority is an INPUT", () => {
  assert.equal(mayAttachTaskComp(MANAGER), true);
  assert.equal(mayAttachTaskComp(CLR), false);
  assert.equal(mayAttachTaskComp(null), false);
  assert.equal(mayAttachTaskComp(undefined), false);
  // Nothing but the flag the route hands in decides this.
  assert.equal(mayAttachTaskComp({ userId: 1, isTaskManager: false } as TaskCompActor), false);
  assert.equal(mayAttachTaskComp({ userId: 1 } as unknown as TaskCompActor), false);
});

test("a CLR cannot set pay on their own task — and it is REFUSED, not ignored", () => {
  const change = parseTaskCompChange(CLR, paidTask({ compAmountCents: null, compReason: null }), { amountCents: 5000, reason: "I worked late" }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 403);
  assert.equal(change.next, null, "a refusal must never hand back something to write");
  assert.match(String(change.error), /only a manager/i);
});

test("a CLR cannot RAISE pay a manager already attached", () => {
  const change = parseTaskCompChange(CLR, paidTask(), { amountCents: 40000, reason: "worth more" }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 403);
  assert.equal(change.next, null);
});

test("a CLR cannot clear pay either — no comp field is theirs to touch", () => {
  const change = parseTaskCompChange(CLR, paidTask(), { amountCents: null }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 403);
});

test("a manager attaching pay writes the amount, the reason, and who set it", () => {
  const change = parseTaskCompChange(MANAGER, paidTask({ compAmountCents: null, compReason: null }), { amountCents: 5000, reason: "  Extra   evening calling block " }, SET_AT);
  assert.equal(change.ok, true);
  assert.deepEqual(change.next, {
    compAmountCents: 5000,
    compReason: "Extra evening calling block",
    compSetByUserId: 9,
    compSetAt: SET_AT,
    compSetForUserId: 4,
  });
});

test("a manager may not attach pay to a task assigned to themselves", () => {
  assert.equal(ALLOW_SELF_ASSIGNED_TASK_COMP, false);
  const change = parseTaskCompChange(MANAGER, paidTask({ assignedUserId: 9, compAmountCents: null }), { amountCents: 5000, reason: "my own task" }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 403);
  assert.match(String(change.error), /assigned to yourself/i);
  // Another manager attaching pay to that same task is fine.
  assert.equal(parseTaskCompChange(OTHER_MANAGER, paidTask({ assignedUserId: 9, compAmountCents: null }), { amountCents: 5000, reason: "covering for Dana" }, SET_AT).ok, true);
});

// ── THE ATTACK: one PATCH that reassigns the task AND attaches the pay ──────
// Two ordinary clicks in the task dialog: pick yourself in "Assigned to", type
// an amount, save. The check has to be made against the assignee the task will
// HAVE, not the one it is being changed away from.

test("SELF-DEALING IN ONE PATCH: reassigning the task to yourself while attaching the pay is refused", () => {
  const someoneElsesTask = paidTask({ assignedUserId: 4, compAmountCents: null, compReason: null });
  const change = parseTaskCompChange(
    MANAGER,
    someoneElsesTask,
    { assignedUserId: 9, amountCents: 5000, reason: "I will do this one myself" },
    SET_AT,
  );
  assert.equal(change.ok, false, "the PRE-patch assignee is not the person who would be paid");
  assert.equal(change.status, 403);
  assert.equal(change.next, null);
  assert.match(String(change.error), /assigned to yourself/i);
});

test("the same patch the other way round — reassigning AWAY from yourself — is allowed, and stamps the NEW assignee", () => {
  const myTask = paidTask({ assignedUserId: 9, compAmountCents: null, compReason: null });
  const change = parseTaskCompChange(MANAGER, myTask, { assignedUserId: 4, amountCents: 5000, reason: "handing this to Nina" }, SET_AT);
  assert.equal(change.ok, true);
  assert.equal(change.next?.compSetForUserId, 4, "the pay is stamped for the person who will hold the task");
  assert.equal(change.warnings.filter((w) => /reassigns the task from user #9 to user #4/.test(w)).length, 1);
});

test("a same-patch reassignment to a THIRD person is judged on that third person", () => {
  const change = parseTaskCompChange(OTHER_MANAGER, paidTask({ assignedUserId: 4, compAmountCents: null }), { assignedUserId: 7, amountCents: 2500, reason: "Marco is taking it" }, SET_AT);
  assert.equal(change.ok, true);
  assert.equal(change.next?.compSetForUserId, 7);
});

test("an unreadable assignedUserId REFUSES rather than falling back to the stored one", () => {
  for (const bad of [null, "", " ", "abc", 0, -3, 4.5, true, {}, []]) {
    const change = parseTaskCompChange(MANAGER, paidTask({ compAmountCents: null }), { assignedUserId: bad, amountCents: 5000, reason: "who is this for" }, SET_AT);
    assert.equal(change.ok, false, `${JSON.stringify(bad)} must not be read as an assignee`);
    assert.equal(change.status, 400);
    assert.equal(change.next, null);
  }
  // A numeric string is what an HTML form sends, and it is read.
  assert.equal(parseTaskCompChange(MANAGER, paidTask({ compAmountCents: null }), { assignedUserId: "7", amountCents: 5000, reason: "Marco" }, SET_AT).next?.compSetForUserId, 7);
});

test("a task with nobody assigned refuses the pay instead of guessing a payee", () => {
  const change = parseTaskCompChange(MANAGER, paidTask({ assignedUserId: 0, compAmountCents: null }), { amountCents: 5000, reason: "for whoever" }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 400);
  assert.match(String(change.error), /nobody assigned/i);
});

test("an unidentified actor cannot attach pay even with the manager flag set", () => {
  const ghost = { userId: 0, isTaskManager: true } as TaskCompActor;
  const change = parseTaskCompChange(ghost, paidTask({ compAmountCents: null }), { amountCents: 5000, reason: "from nobody" }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 403);
  assert.equal(change.next, null);
});

test("SELF-DEALING ONE PATCH LATER: taking an already-paid task is refused even with no comp field in the body", () => {
  // Dana attaches $50 to Nina's task (legitimate), then patches only the
  // assignee to herself. The amount travels with the task, so this is the same
  // cheque with the comp fields left out of the request.
  const change = parseTaskCompChange(MANAGER, paidTask({ assignedUserId: 4, compAmountCents: 5000 }), { assignedUserId: 9 }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 403);
  assert.equal(change.next, null);
  assert.match(String(change.error), /already carries pay/i);

  // Reassigning it to somebody else is still fine, and so is taking an UNPAID task.
  assert.equal(parseTaskCompChange(MANAGER, paidTask({ assignedUserId: 4 }), { assignedUserId: 7 }, SET_AT).ok, true);
  assert.equal(parseTaskCompChange(MANAGER, paidTask({ assignedUserId: 4, compAmountCents: null }), { assignedUserId: 9 }, SET_AT).ok, true);
});

test("touching no comp field changes nothing", () => {
  const change = parseTaskCompChange(MANAGER, paidTask(), { }, SET_AT);
  assert.equal(change.ok, true);
  assert.equal(change.next, null, "an untouched amount must be left exactly as stored");
  assert.equal(parseTaskCompChange(CLR, paidTask(), {}, SET_AT).ok, true, "a CLR editing the title is not a comp change");
  assert.equal(parseTaskCompChange(CLR, paidTask(), undefined, SET_AT).ok, true);
});

test("a manager clears the pay by sending null", () => {
  const change = parseTaskCompChange(MANAGER, paidTask(), { amountCents: null }, SET_AT);
  assert.equal(change.ok, true);
  assert.deepEqual(change.next, {
    compAmountCents: null, compReason: null, compSetByUserId: null, compSetAt: null, compSetForUserId: null,
  });
});

test("a raise is allowed but is called out to the operator", () => {
  const change = parseTaskCompChange(MANAGER, paidTask({ compAmountCents: 2500 }), { amountCents: 5000, reason: "doubled the list" }, SET_AT);
  assert.equal(change.ok, true);
  assert.equal(change.warnings.filter((w) => /raised from \$25\.00 to \$50\.00/.test(w)).length, 1);
});

test("the comment on ALLOW_SELF_ASSIGNED_TASK_COMP claims only what the code does", () => {
  const source = readFileSync(new URL("../server/task-comp.ts", import.meta.url), "utf8");
  const doc = source.slice(0, source.indexOf("export const ALLOW_SELF_ASSIGNED_TASK_COMP"));
  const claim = doc.slice(doc.lastIndexOf("/**"));
  assert.match(claim, /after the patch|will HAVE/i, "it must say WHICH assignee is checked");
  assert.ok(claim.indexOf("removes the only self-dealing path this feature opens") < 0,
    "the old claim was false: two managers can still pay each other, and that is now said out loud");
  assert.match(claim, /DOES NOT GUARANTEE/i);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 2 — WHAT IS ATTACHED. Whole cents, positive, capped, with a reason.
// ────────────────────────────────────────────────────────────────────────────

test("the amount must be a whole, positive number of cents", () => {
  assert.equal(validateTaskCompAmountCents(5000).ok, true);
  assert.equal(validateTaskCompAmountCents(TASK_COMP_MIN_CENTS).ok, true);
  assert.equal(validateTaskCompAmountCents(TASK_COMP_MAX_CENTS).ok, true, "the cap itself is allowed");

  for (const bad of [0, -1, -5000, 10.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const check = validateTaskCompAmountCents(bad);
    assert.equal(check.ok, false, `${String(bad)} must be refused`);
    assert.equal(check.amountCents, 0);
    assert.ok(check.error && check.error.length > 0, "a refusal must say why");
  }
  // A JSON body brings strings and nulls. Number() would turn "" and null into
  // 0 and null into a free task; none of them are numbers, so none of them pass.
  for (const bad of ["5000", "", " ", null, undefined, {}, [], true]) {
    assert.equal(validateTaskCompAmountCents(bad as unknown).ok, false, `${JSON.stringify(bad)} must be refused`);
  }
});

test("the cap refuses an absurd amount and says so in dollars", () => {
  const check = validateTaskCompAmountCents(TASK_COMP_MAX_CENTS + 1);
  assert.equal(check.ok, false);
  assert.match(String(check.error), /\$500\.00/);
  assert.equal(formatMoneyCents(TASK_COMP_MAX_CENTS), "$500.00");
  // The mistyped-dollars case the cap exists for: $50.00 typed as 5000 dollars.
  assert.equal(validateTaskCompAmountCents(500000).ok, false);
});

test("a short reason is required", () => {
  assert.equal(TASK_COMP_REASON_REQUIRED, true);
  assert.equal(validateTaskCompReason("Extra evening calling block").ok, true);
  assert.equal(validateTaskCompReason("  spaced   out  ").reason, "spaced out");
  assert.equal(validateTaskCompReason("").ok, false);
  assert.equal(validateTaskCompReason("   ").ok, false);
  assert.equal(validateTaskCompReason(null).ok, false);
  assert.equal(validateTaskCompReason("a".repeat(TASK_COMP_REASON_MIN_LENGTH - 1)).ok, false);
  assert.equal(validateTaskCompReason("a".repeat(TASK_COMP_REASON_MAX_LENGTH)).ok, true);
  assert.equal(validateTaskCompReason("a".repeat(TASK_COMP_REASON_MAX_LENGTH + 1)).ok, false);
});

test("an amount without a reason, and a reason without an amount, are both refused", () => {
  const noReason = parseTaskCompChange(MANAGER, paidTask({ compAmountCents: null }), { amountCents: 5000 }, SET_AT);
  assert.equal(noReason.ok, false);
  assert.equal(noReason.status, 400);

  const noAmount = parseTaskCompChange(MANAGER, paidTask({ compAmountCents: null }), { reason: "for the extra calling" }, SET_AT);
  assert.equal(noAmount.ok, false);
  assert.equal(noAmount.status, 400);
  assert.equal(noAmount.next, null);
});

test("a bad amount from a manager is refused with the reason in the message", () => {
  const change = parseTaskCompChange(MANAGER, paidTask({ compAmountCents: null }), { amountCents: -500, reason: "oops" }, SET_AT);
  assert.equal(change.ok, false);
  assert.equal(change.status, 400);
  assert.match(String(change.error), /\$0\.00|more than/i);
});

test("the expense date is validated, not passed through onto the money row", () => {
  assert.equal(validateTaskCompExpenseDate("2026-09-08").ok, true);
  assert.equal(validateTaskCompExpenseDate("2024-02-29").ok, true, "a real leap day is a real date");
  for (const bad of ["", " ", "2026-02-30", "2026-13-01", "2026-00-10", "8/9/2026", "2026-9-8", "2026-09-08T17:00:00Z", "yesterday", "1999-01-01", "0000-01-01", null, undefined, 20260908]) {
    assert.equal(validateTaskCompExpenseDate(bad as unknown).ok, false, `${JSON.stringify(bad)} must not reach expense_date`);
  }
});

test("a completion whose date C3 cannot read files NOTHING rather than a row nobody can find", () => {
  const plan = planFor(paidTask(), { expenseDate: "2026-02-30" });
  assert.equal(plan.file, null);
  assert.equal(plan.skipped, "invalid-expense-date");
  assert.equal(plan.warnings.filter((w) => /File by hand if pay is owed/.test(w)).length, 1);

  const noCompletedAt = planFor(paidTask(), { completion: completion({ completedAt: "" }) });
  assert.equal(noCompletedAt.file, null);
  assert.equal(noCompletedAt.skipped, "invalid-expense-date");
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 3 — WHO GETS PAID. The assignee, never the clicker.
// ────────────────────────────────────────────────────────────────────────────

test("the ASSIGNEE is paid, not whoever clicked complete", () => {
  assert.equal(TASK_COMP_PAYEE, "task-assignee");
  const plan = planFor(paidTask(), { completion: completion({ completedByUserId: 9 }), completedByName: "Dana Wu" });
  assert.ok(plan.file);
  assert.equal(plan.file!.userId, 4, "a manager completing on somebody's behalf must not be paid for it");
  assert.equal(plan.file!.warnings.filter((w) => /on behalf of the assignee/i.test(w)).length, 1);
  assert.match(plan.file!.note, /Completed by: Dana Wu \(user #9\)/);
  assert.match(plan.file!.note, /Pay to: Nina Reyes \(user #4\)/);
});

test("REASSIGNMENT after the amount was set: the pay travels with the task, loudly", () => {
  assert.equal(TASK_COMP_REASSIGNMENT, "amount-travels-with-the-task");
  // Set for CLR #4, later reassigned to CLR #7, who completes it.
  const task = paidTask({ assignedUserId: 7, compSetForUserId: 4 });
  const plan = planTaskCompFiling({
    task,
    completion: completion({ completedByUserId: 7 }),
    ...GUARDS,
    payeeName: "Marco Diaz", completedByName: "Marco Diaz", setByName: "Dana Wu",
  });
  assert.ok(plan.file);
  assert.equal(plan.file!.userId, 7, "the person who did the work is paid");
  const warned = plan.file!.warnings.filter((w) => /reassigned after the pay was attached/i.test(w));
  assert.equal(warned.length, 1, "the approver must be told the task changed hands");
  assert.match(String(warned[0]), /set for user #4/);
  assert.match(String(warned[0]), /paid to user #7/);
  assert.match(plan.file!.note, /WARNING: This task was reassigned/);
});

test("a task with no assignee files nothing", () => {
  const plan = planFor(paidTask({ assignedUserId: 0 }));
  assert.equal(plan.file, null);
  assert.equal(plan.skipped, "no-payee");
});

test("an inactive assignee files nothing, and says so out loud", () => {
  const plan = planFor(paidTask(), { payeeActive: false });
  assert.equal(plan.file, null);
  assert.equal(plan.skipped, "payee-inactive");
  assert.equal(plan.warnings.filter((w) => /File by hand if they are still owed/.test(w)).length, 1);
});

// ────────────────────────────────────────────────────────────────────────────
// THE TWO GUARDS A WIRING PASS COULD LOSE. Absent is not "yes".
// ────────────────────────────────────────────────────────────────────────────

test("payeeActive is REQUIRED — an omitted payee check refuses instead of paying", () => {
  const plan = planTaskCompFiling({ task: paidTask(), completion: completion(), existing: [], ...NAMES } as any);
  assert.equal(plan.file, null, "not knowing whether the payee is active must never mean 'pay them'");
  assert.equal(plan.skipped, "payee-status-unknown");
  assert.equal(plan.warnings.filter((w) => /wiring bug — pass payeeActive/.test(w)).length, 1);
  // Only an explicit true files.
  for (const value of [undefined, null, 0, 1, "true", {}]) {
    assert.equal(planFor(paidTask(), { payeeActive: value }).file, null, `payeeActive: ${JSON.stringify(value)} must not file`);
  }
});

test("existing is REQUIRED — without the already-filed list, nothing is filed", () => {
  const plan = planTaskCompFiling({ task: paidTask(), completion: completion(), payeeActive: true, ...NAMES } as any);
  assert.equal(plan.file, null, "an unchecked duplicate guard must not become an unguarded payment");
  assert.equal(plan.skipped, "existing-unknown");
  assert.equal(plan.warnings.filter((w) => /wiring bug — pass existing/.test(w)).length, 1);
  for (const value of [null, undefined, "", 0, {}]) {
    assert.equal(planFor(paidTask(), { existing: value }).file, null, `existing: ${JSON.stringify(value)} must not file`);
  }
  // An honestly empty list is a different thing from a missing one, and files.
  assert.ok(planFor(paidTask(), { existing: [] }).file);
});

test("the wiring recipe documents both guards, the query, and how the token is written", () => {
  const source = readFileSync(new URL("../server/task-comp.ts", import.meta.url), "utf8");
  const wiring = source.slice(0, source.indexOf("import {"));
  assert.match(wiring, /payeeActive/, "a wiring pass that follows the header must not lose the payee check");
  assert.match(wiring, /TASK_COMP_EXISTING_QUERY/, "and must be told which query builds `existing`");
  assert.match(wiring, /NOT user scoped|not user scoped/i, "the per-user query is the trap — say so");
  assert.match(wiring, /task_comp_task_id/);
  // The token is a column of the INSERT, not something bolted on after commit.
  assert.match(wiring, /BEFORE the tx/);
  assert.ok(wiring.indexOf("Only after that transaction commits: the approval token") < 0,
    "processRecurringComp does NOT create the token after the transaction — the old recipe was wrong");

  // The query itself: keyed on the task, scoped to the org, never to a user.
  assert.match(TASK_COMP_EXISTING_QUERY, /FROM comp_requests/);
  assert.match(TASK_COMP_EXISTING_QUERY, /WHERE org_id = \? AND task_comp_task_id = \?/);
  assert.ok(TASK_COMP_EXISTING_QUERY.indexOf("user_id = ?") < 0, "a per-user query would miss the row that already paid");
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 4 — WHICH AMOUNT APPLIES. The one on the task at the moment of
// completion, and a later edit can never reach the filed request.
// ────────────────────────────────────────────────────────────────────────────

test("the amount filed is the one on the task at completion time", () => {
  const plan = planFor(paidTask({ compAmountCents: 2500 }));
  assert.ok(plan.file);
  assert.equal(plan.file!.amountCents, 2500);
  assert.match(plan.file!.description, /\$25\.00/);
});

test("the filed request is a SNAPSHOT — editing the task afterwards cannot move it", () => {
  const task = paidTask({ compAmountCents: 5000 });
  const plan = planFor(task);
  assert.ok(plan.file);
  const filed = taskCompRequestRow(plan.file!, 501);

  // Somebody edits the task after the fact.
  task.compAmountCents = 45000;
  task.compReason = "much more, actually";

  assert.equal(plan.file!.amountCents, 5000, "the planned row holds its own copy of the amount");
  assert.equal(filed.amountCents, 5000);
  assert.match(String(filed.description), /\$50\.00/);
  assert.doesNotMatch(String(filed.description), /\$450\.00/);
});

test("the amount is FROZEN once the task is completed or archived", () => {
  assert.deepEqual(TASK_COMP_LOCKED_TASK_STATUSES, ["completed", "archived"]);
  for (const status of TASK_COMP_LOCKED_TASK_STATUSES) {
    const change = parseTaskCompChange(MANAGER, paidTask({ status }), { amountCents: 45000, reason: "raise it after the fact" }, SET_AT);
    assert.equal(change.ok, false, `${status} tasks must refuse a comp edit`);
    assert.equal(change.status, 409);
    assert.equal(change.next, null);
    assert.match(String(change.error), /locked/i);
  }
  assert.equal(parseTaskCompChange(MANAGER, paidTask({ status: "active", compAmountCents: null }), { amountCents: 5000, reason: "still open" }, SET_AT).ok, true);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 5 — EXACTLY ONCE, keyed to the completion identity the UNIQUE
// constraint on clr_task_completions already guarantees — and decided on
// COLUMNS, never on text a user typed.
// ────────────────────────────────────────────────────────────────────────────

test("the idempotency key IS the UNIQUE constraint's tuple", () => {
  assert.deepEqual(TASK_COMP_IDEMPOTENCY_COLUMNS, ["task_id", "due_at"]);
  assert.equal(taskCompletionKey(12, DUE_AT), `${TASK_COMP_MARKER_PREFIX}12:${DUE_AT}`);
  assert.equal(buildTaskCompMarker(taskCompletionKey(12, DUE_AT)), `[task-comp:12:${DUE_AT}]`);
  assert.equal(readTaskCompKey(`prefix [task-comp:12:${DUE_AT}] suffix`), `task-comp:12:${DUE_AT}`);
  assert.equal(readTaskCompTaskId(`[task-comp:12:${DUE_AT}]`), 12);
  assert.equal(readTaskCompKey("a hand typed request about a task"), null);
  assert.equal(readTaskCompTaskId("a hand typed request about a task"), null);
});

test("the guard lives in COLUMNS, and the wiring pass is told to add them", () => {
  const columns = TASK_COMP_REQUEST_COLUMNS.map((c) => c.column);
  assert.deepEqual(columns, ["task_comp_task_id", "task_comp_key"]);
  assert.match(TASK_COMP_REQUEST_UNIQUE_INDEX, /CREATE UNIQUE INDEX/);
  assert.match(TASK_COMP_REQUEST_UNIQUE_INDEX, /comp_requests\(task_comp_task_id\)/);
  assert.match(TASK_COMP_REQUEST_UNIQUE_INDEX, /WHERE task_comp_task_id IS NOT NULL/, "hand-typed rows must not collide with each other");
});

test("the guard reads a RAW sqlite row too, so a forgotten mapComp line cannot disable it", () => {
  // mapComp() converts every field by hand. A wiring pass that adds the columns
  // and forgets those two lines would otherwise hand every row an undefined
  // guard — which reads exactly like "this task has never been paid".
  const raw = {
    id: 501, user_id: 4, status: "pending", description: "Task pay — …", note: "",
    task_comp_task_id: 12, task_comp_key: taskCompletionKey(12, DUE_AT),
  } as unknown as TaskCompRequestRow;
  assert.equal(taskCompAlreadyFiled([raw], { taskId: 12, dueAt: DUE_AT }).length, 1);
  const plan = planFor(paidTask(), { existing: [raw] });
  assert.equal(plan.file, null);
  assert.equal(plan.skipped, "already-filed");
});

test("A DOUBLE COMPLETION files exactly one request", () => {
  const task = paidTask();
  const first = planFor(task);
  assert.ok(first.file);

  // Feed the first run's own output back in — a retry, a double-click, or the
  // loser of a race re-reading the table.
  const existing: TaskCompRequestRow[] = [taskCompRequestRow(first.file!, 501)];
  const second = planFor(task, { existing });
  assert.equal(second.file, null);
  assert.equal(second.skipped, "already-filed");
  assert.match(second.skipDetail, /#501/);

  // And a third time, for good measure.
  assert.equal(planFor(task, { existing }).file, null);
});

test("RE-OPEN AND RE-COMPLETE with an edited deadline still files nothing", () => {
  const task = paidTask();
  const first = planFor(task);
  assert.ok(first.file);
  const existing: TaskCompRequestRow[] = [taskCompRequestRow(first.file!, 501)];

  // A manager re-opens the task and moves the deadline, manufacturing a brand
  // new (task_id, due_at) cycle the database would happily accept.
  const reopened = planTaskCompFiling({
    task, completion: completion({ dueAt: "2026-09-15T17:00:00.000Z" }), ...GUARDS, existing, ...NAMES,
  });
  assert.equal(reopened.file, null, "one task pays once, whatever its deadline is edited to");
  assert.equal(reopened.skipped, "already-filed");
});

// ── THE ATTACK: a forged marker in text a user controls ─────────────────────
// The task title and the pay reason are copied verbatim onto the request, so
// anything scanned back out of that text is text somebody typed.

test("A FORGED MARKER IN A TASK TITLE CANNOT BLOCK A LEGITIMATE PAYMENT", () => {
  // Nina's task #12 is worth $50. Someone names THEIR task with #12's marker
  // and gets it filed; a text-scanning guard would then refuse to pay Nina.
  const forged = `Weekly tidy [task-comp:12:${DUE_AT}]`;
  const spoofer: TaskCompRequestRow = {
    id: 77, userId: 6, category: "bonus", status: "pending",
    description: `Task pay — ${forged} — nothing ($1.00) — auto-filed by C3 from a completed task`,
    note: `Task: #99 "${forged}"\n[task-comp:12:${DUE_AT}]`,
    amountCents: 100, expenseDate: "2026-09-08",
    taskCompTaskId: 99, taskCompKey: taskCompletionKey(99, DUE_AT),
  };
  assert.equal(readTaskCompKey(String(spoofer.note)), taskCompletionKey(12, DUE_AT),
    "the forged text really does read as task #12 — which is exactly why nothing may read it");

  const plan = planFor(paidTask(), { existing: [spoofer] });
  assert.ok(plan.file, "a marker somebody typed must not stop a real payment");
  assert.equal(plan.file!.amountCents, 5000);
  assert.equal(taskCompAlreadyFiled([spoofer], { taskId: 12, dueAt: DUE_AT }).length, 0);
});

test("A FORGED MARKER CANNOT DISGUISE A DUPLICATE EITHER", () => {
  // The other direction: a real filing for task #12 whose free text has been
  // edited to point somewhere else. The columns still say #12.
  const first = planFor(paidTask());
  const laundered: TaskCompRequestRow = {
    ...taskCompRequestRow(first.file!, 501),
    description: "Task pay — something else entirely ($50.00)",
    note: "Task: #4 \"something else\"\n[task-comp:4:2020-01-01T00:00:00.000Z]",
  };
  assert.equal(readTaskCompTaskId(String(laundered.note)), 4, "the text lies");
  const second = planFor(paidTask(), { existing: [laundered] });
  assert.equal(second.file, null, "the columns are what decides, and they say this task was already filed");
  assert.equal(second.skipped, "already-filed");
});

test("a task whose own title carries a forged marker still files a clean request", () => {
  const evil = paidTask({ title: `Call list [task-comp:999:${DUE_AT}]`, compReason: "Bonus [task-comp:998:x]" });
  const plan = planFor(evil);
  assert.ok(plan.file);
  assert.equal(plan.file!.taskId, 12);
  assert.equal(plan.file!.key, taskCompletionKey(12, DUE_AT));
  // The brackets are stripped out of everything a user typed, so the only
  // marker in the note is the one C3 wrote.
  assert.equal(readTaskCompKey(plan.file!.note), taskCompletionKey(12, DUE_AT));
  assert.equal(String(plan.file!.note.match(/\[task-comp:/g)?.length ?? 0), "1");
  assert.ok(plan.file!.description.indexOf("[task-comp:") < 0);
});

test("a DENIED request still counts as filed — a no is an answer", () => {
  assert.ok(TASK_COMP_COVERING_STATUSES.indexOf("denied") >= 0);
  const first = planFor(paidTask());
  const denied = { ...taskCompRequestRow(first.file!, 501), status: "denied" };
  assert.equal(planFor(paidTask(), { existing: [denied] }).file, null);
});

test("another task's request, and a hand-typed one, do not block this task", () => {
  const other = planTaskCompFiling({ task: paidTask({ id: 99 }), completion: completion({ taskId: 99 }), ...GUARDS, ...NAMES });
  const handTyped: TaskCompRequestRow = { id: 7, userId: 4, category: "bonus", status: "pending", description: "Bonus for the renewals push", note: "" };
  const plan = planFor(paidTask(), { existing: [taskCompRequestRow(other.file!, 400), handTyped] });
  assert.ok(plan.file, "an unrelated request must not swallow this task's pay");
  assert.equal(plan.file!.amountCents, 5000);
});

test("a request in a status that means nothing is pending does not block", () => {
  const first = planFor(paidTask());
  const voided = { ...taskCompRequestRow(first.file!, 501), status: "void" };
  assert.ok(planFor(paidTask(), { existing: [voided] }).file);
});

test("the completion must belong to the task, to the same org, and to a real cycle", () => {
  assert.equal(planFor(paidTask(), { completion: completion({ taskId: 77 }) }).skipped, "wrong-task");
  assert.equal(planFor(paidTask(), { completion: completion({ orgId: 2 }) }).skipped, "wrong-org");
  assert.equal(planFor(paidTask(), { completion: completion({ dueAt: "" }) }).skipped, "no-cycle");
  assert.equal(planFor(paidTask(), { completion: completion({ dueAt: "   " }) }).file, null);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 6 — RECURRING TASKS ARE THE DANGEROUS CASE.
// ────────────────────────────────────────────────────────────────────────────

test("the recurring DEFAULT pays this occurrence only", () => {
  assert.equal(TASK_COMP_RECURRING_MODE, "this-occurrence-only");
  assert.equal(TASK_COMP_SPAWN_COPIES_AMOUNT, false, "the successor row must not inherit the amount");
});

test("a daily paid task files ONE request, and the next occurrence files nothing", () => {
  const monday = paidTask({ id: 12, recurrence: "daily" });
  const plan = planFor(monday);
  assert.ok(plan.file);
  assert.equal(plan.file!.amountCents, 5000);

  // spawnNextTaskOccurrence creates a NEW clr_tasks row and does not copy the
  // comp columns, so Tuesday arrives unpaid.
  const tuesday = paidTask({ id: 13, recurrence: "daily", compAmountCents: null, compReason: null, compSetByUserId: null, compSetAt: null, compSetForUserId: null });
  const next = planTaskCompFiling({
    task: tuesday,
    completion: completion({ taskId: 13, dueAt: "2026-09-09T17:00:00.000Z" }),
    existing: [taskCompRequestRow(plan.file!, 501)],
    payeeActive: true,
    ...NAMES,
  });
  assert.equal(next.file, null, "a daily paid task must not quietly pay every day");
  assert.equal(next.skipped, "no-amount");
});

test("the exposure warning describes the mode that is ACTUALLY in force", () => {
  const exposure = recurringCompExposure("daily", 5000);
  assert.equal(exposure.recurs, true);
  assert.equal(exposure.known, true);
  assert.equal(exposure.perMonth, 30);
  assert.equal(exposure.monthlyCents, 150000, "the monthly figure is still computed for a UI that wants the scale");
  // Under "pay once", the sentence must not assert a monthly commitment.
  assert.match(exposure.warning, /ONLY THIS occurrence pays \$50\.00/);
  assert.match(exposure.warning, /not copied onto the next occurrence/);
  assert.doesNotMatch(exposure.warning, /At \$50\.00 a time that is about \$1,500\.00 a month/,
    "the shipped default does not pay $1,500 a month, and the warning may not say it does");
  assert.match(exposure.warning, /For scale only/, "the monthly number, if shown at all, is marked hypothetical");
});

test("attaching pay to a repeating task shows the exposure BEFORE saving", () => {
  assert.equal(taskRecurs("none"), false);
  assert.equal(taskRecurs(null), false);
  assert.equal(taskRecurs("daily"), true);
  assert.equal(occurrencesPerMonth("daily"), 30);
  assert.equal(occurrencesPerMonth("weekly"), 4);
  assert.equal(occurrencesPerMonth("monthly"), 1);
  assert.equal(occurrencesPerMonth("weekdays"), 22);
  assert.equal(occurrencesPerMonth("none"), 0);

  assert.deepEqual(recurringCompExposure("none", 5000), { recurs: false, known: true, perMonth: 0, monthlyCents: 0, warning: "" });

  const change = parseTaskCompChange(MANAGER, paidTask({ recurrence: "daily", compAmountCents: null }), { amountCents: 5000, reason: "nightly list" }, SET_AT);
  assert.equal(change.ok, true);
  assert.equal(change.warnings.filter((w) => /repeats daily/.test(w)).length, 1);
});

// ── THE ATTACK: one PATCH that sets the repeat AND the pay ──────────────────
// The stored row still says "none" while this request is being judged, so
// reading the recurrence off the row showed no exposure at all on exactly the
// flow a manager would use.

test("A PATCH THAT SETS THE REPEAT AND THE PAY TOGETHER STILL WARNS", () => {
  const oneOffTask = paidTask({ recurrence: "none", compAmountCents: null, compReason: null });
  const change = parseTaskCompChange(MANAGER, oneOffTask, { recurrence: "daily", amountCents: 5000, reason: "nightly calling block" }, SET_AT);
  assert.equal(change.ok, true);
  const warned = change.warnings.filter((w) => /repeats daily/.test(w));
  assert.equal(warned.length, 1, "the manager must see the repeat they are creating in this very request");
  assert.match(String(warned[0]), /ONLY THIS occurrence pays \$50\.00/);

  // And the days come from the same patch too.
  const custom = parseTaskCompChange(MANAGER, oneOffTask, { recurrence: "custom_weekly", scheduleDays: [1, 3, 5], amountCents: 5000, reason: "MWF block" }, SET_AT);
  assert.equal(custom.ok, true);
  assert.equal(custom.warnings.filter((w) => /custom_weekly \(Mon, Wed, Fri\)/.test(w)).length, 1);

  // Turning a repeat OFF in the same patch stops the warning claiming otherwise.
  const stopping = parseTaskCompChange(MANAGER, paidTask({ recurrence: "daily", compAmountCents: null }), { recurrence: "none", amountCents: 5000, reason: "one-off after all" }, SET_AT);
  assert.equal(stopping.ok, true);
  assert.deepEqual(stopping.warnings, [], "a task that is being made one-off does not repeat");
});

test("custom_weekly is counted from the days actually selected, not a flat guess", () => {
  assert.deepEqual(normalizeTaskCompScheduleDays([5, 1, 1, 3]), [1, 3, 5]);
  assert.deepEqual(normalizeTaskCompScheduleDays("[1,3,5]"), [1, 3, 5], "the column stores JSON text");
  assert.deepEqual(normalizeTaskCompScheduleDays("not json"), []);
  assert.deepEqual(normalizeTaskCompScheduleDays([7, -1, 2.5, "x"]), []);

  assert.equal(occurrencesPerMonth("custom_weekly", [5]), 4, "one day a week is about four times a month, not 22");
  assert.equal(occurrencesPerMonth("custom_weekly", [1, 3, 5]), 12);
  assert.equal(occurrencesPerMonth("custom_weekly", "[1,2,3,4,5]"), 20);

  const fridays = recurringCompExposure("custom_weekly", 5000, [5]);
  assert.equal(fridays.perMonth, 4);
  assert.equal(fridays.monthlyCents, 20000, "the old flat 22/month overstated a Friday task by more than five times");
  assert.match(fridays.warning, /custom_weekly \(Fri\)/);

  // A custom_weekly with no days stored is a broken row, not a free one.
  const broken = recurringCompExposure("custom_weekly", 5000, []);
  assert.equal(broken.known, false);
  assert.equal(broken.perMonth, null);
  assert.equal(broken.monthlyCents, null);
});

test("AN UNRECOGNISED RECURRENCE FAILS CLOSED — never '$0.00 a month'", () => {
  assert.equal(taskRecurs("fortnightly"), true, "not knowing the schedule is not the same as having none");
  assert.equal(occurrencesPerMonth("fortnightly"), null, "0 would render as $0.00 a month, which is certainly false");

  const exposure = recurringCompExposure("fortnightly", 5000);
  assert.equal(exposure.recurs, true);
  assert.equal(exposure.known, false);
  assert.equal(exposure.perMonth, null);
  assert.equal(exposure.monthlyCents, null);
  assert.match(exposure.warning, /UNKNOWN/);
  assert.doesNotMatch(exposure.warning, /\$0\.00 a month/);

  const change = parseTaskCompChange(MANAGER, paidTask({ recurrence: "every-other-tuesday", compAmountCents: null }), { amountCents: 5000, reason: "odd schedule" }, SET_AT);
  assert.equal(change.ok, true, "an unknown schedule is a warning, not a refusal to pay for real work");
  assert.equal(change.warnings.filter((w) => /UNKNOWN/.test(w)).length, 1);
});

test("a completed recurring task warns the approver that it repeats", () => {
  const plan = planFor(paidTask({ recurrence: "weekdays" }));
  assert.ok(plan.file);
  assert.equal(plan.file!.warnings.filter((w) => /repeats weekdays/.test(w)).length, 1);
  assert.match(plan.file!.note, /WARNING: This task repeats weekdays/);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 7 — WHAT THE REQUEST SAYS. Pinned, exactly, and bounded.
// ────────────────────────────────────────────────────────────────────────────

test("the description names the task, the reason, the money, and that a machine filed it", () => {
  const plan = planFor(paidTask());
  assert.ok(plan.file);
  assert.equal(
    plan.file!.description,
    "Task pay — Call the Q3 renewals list — Extra evening calling block ($50.00) — auto-filed by C3 from a completed task",
  );
  assert.ok(plan.file!.description.indexOf(TASK_COMP_DESCRIPTION_TAG) >= 0);
});

test("the note is the whole story, and it is pinned", () => {
  const plan = planFor(paidTask());
  assert.ok(plan.file);
  assert.equal(plan.file!.note, [
    "Auto-filed by C3 from a completed task. Nobody typed this request.",
    'Task: #12 "Call the Q3 renewals list"',
    "Pay to: Nina Reyes (user #4) — the CLR the task was assigned to.",
    "Completed by: Nina Reyes (user #4) on 2026-09-08T16:31:00.000Z.",
    "Cycle: deadline 2026-09-08T17:00:00.000Z — the one completion this pay is tied to.",
    "Amount: $50.00 — set by Dana Wu (user #9) on 2026-09-07T15:00:00.000Z.",
    "Reason: Extra evening calling block",
    "Still needs approval — this was filed as pending, exactly like a hand-typed request.",
    "[task-comp:12:2026-09-08T17:00:00.000Z]",
  ].join("\n"));
});

test("a very long title cannot push the auto-filed tag off the description", () => {
  const description = buildTaskCompDescription({ title: "T".repeat(400), reason: "R".repeat(400), amountCents: 5000 });
  assert.ok(description.length <= TASK_COMP_MAX_DESCRIPTION_LENGTH);
  assert.ok(description.indexOf(TASK_COMP_DESCRIPTION_TAG) >= 0, "the approver must always see that nobody typed this");
  assert.ok(description.indexOf("$50.00") >= 0);
});

// ── THE ATTACK: a title long enough to truncate the note ────────────────────
// routes.ts clamps every note at 1,000 characters. The marker used to be the
// LAST line of an unbounded note, so a long title silently deleted the only
// thing standing between a re-opened task and a second payment.

test("A LONG TITLE CANNOT TRUNCATE THE NOTE PAST ITS OWN LIMIT", () => {
  const wordy = paidTask({
    title: "T".repeat(400),
    compReason: "R".repeat(TASK_COMP_REASON_MAX_LENGTH),
    recurrence: "weekdays",
    compSetForUserId: 3,
  });
  const plan = planTaskCompFiling({
    task: wordy,
    completion: completion({ completedByUserId: 9 }),
    ...GUARDS,
    payeeName: "N".repeat(120), completedByName: "C".repeat(120), setByName: "S".repeat(120),
  });
  assert.ok(plan.file);
  const note = plan.file!.note;
  assert.ok(note.length <= TASK_COMP_MAX_NOTE_LENGTH, `the note must fit the column: ${note.length} > ${TASK_COMP_MAX_NOTE_LENGTH}`);
  // The clamp routes.ts applies must be a no-op, not a deletion.
  assert.equal(note.slice(0, 1000), note);
  // Everything structural survives, in the note and — the part that matters —
  // in the columns the guard reads.
  assert.match(note, /^Auto-filed by C3 from a completed task\./);
  assert.match(note, /Still needs approval/);
  assert.equal(readTaskCompKey(note), taskCompletionKey(12, DUE_AT), "the marker is reserved space, not the tail that falls off");
  assert.equal(plan.file!.taskId, 12);
  assert.equal(plan.file!.key, taskCompletionKey(12, DUE_AT));
});

test("when a note has to drop detail it says so, and a truncated note still guards", () => {
  const noisy = planTaskCompFiling({
    task: paidTask({ title: "T".repeat(300), compReason: "R".repeat(TASK_COMP_REASON_MAX_LENGTH), recurrence: "daily", compSetForUserId: 3 }),
    completion: completion({ completedByUserId: 9 }),
    ...GUARDS,
    payeeName: "N".repeat(80), completedByName: "C".repeat(80), setByName: "S".repeat(80),
  });
  assert.ok(noisy.file);
  assert.ok(noisy.file!.note.length <= TASK_COMP_MAX_NOTE_LENGTH);
  assert.ok(noisy.file!.note.indexOf("note truncated") >= 0 || noisy.file!.warnings.every((w) => noisy.file!.note.indexOf(w.slice(0, 20)) >= 0),
    "either every warning is in the note, or the note admits it dropped some");

  // The exactly-once guard does not live in that text at all: a filed row whose
  // note has been emptied entirely still blocks the second filing.
  const gutted = { ...taskCompRequestRow(noisy.file!, 501), note: "", description: "" };
  const again = planFor(paidTask(), { existing: [gutted] });
  assert.equal(again.file, null);
  assert.equal(again.skipped, "already-filed");
});

test("the note always carries the machine-readable cycle marker", () => {
  const note = buildTaskCompNote({
    taskId: 12, title: "Anything", dueAt: DUE_AT, amountCents: 100, reason: "",
    payeeUserId: 4, completedByUserId: 4, completedAt: COMPLETED_AT,
  });
  assert.equal(readTaskCompKey(note), taskCompletionKey(12, DUE_AT));
  assert.doesNotMatch(note, /^Reason:/m, "an empty reason is left out rather than printed blank");
});

test("the expense date is the day the work was finished", () => {
  const plan = planFor(paidTask());
  assert.equal(plan.file!.expenseDate, "2026-09-08");
  assert.equal(planFor(paidTask(), { expenseDate: "2026-09-07" }).file!.expenseDate, "2026-09-07");
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 8 — NOTHING IS AUTO-APPROVED.
// ────────────────────────────────────────────────────────────────────────────

test("the request is filed PENDING and a human still approves it", () => {
  assert.equal(TASK_COMP_FILED_STATUS, "pending");
  const plan = planFor(paidTask());
  assert.ok(plan.file);
  assert.equal(plan.file!.status, "pending");
  assert.equal(plan.file!.category, TASK_COMP_CATEGORY);
  assert.equal(plan.file!.isReimbursement, TASK_COMP_IS_REIMBURSEMENT);
  assert.match(plan.file!.note, /Still needs approval/);
  // No path in the plan may produce an approved, paid, or processing request.
  const serialized = JSON.stringify(plan);
  assert.ok(serialized.indexOf("approved") < 0, "nothing here may file an approved request");
  assert.ok(serialized.indexOf("is_paid") < 0);
});

// ────────────────────────────────────────────────────────────────────────────
// A TASK WITH NO PAY — the overwhelmingly common case. It must cost nothing.
// ────────────────────────────────────────────────────────────────────────────

test("a task with no amount attached files NOTHING AT ALL", () => {
  for (const amount of [null, undefined]) {
    const plan = planFor(paidTask({ compAmountCents: amount, compReason: null }));
    assert.equal(plan.file, null);
    assert.equal(plan.skipped, "no-amount");
    assert.deepEqual(plan.warnings, [], "an ordinary unpaid task is not an incident");
    assert.equal(plan.key, taskCompletionKey(12, DUE_AT));
  }
});

test("a stored amount that is not valid money never becomes money", () => {
  for (const amount of [0, -5000, 10.5, TASK_COMP_MAX_CENTS + 1, Number.NaN]) {
    const plan = planFor(paidTask({ compAmountCents: amount }));
    assert.equal(plan.file, null, `${String(amount)} stored on a task must not file`);
    assert.equal(plan.skipped, "invalid-amount");
    assert.equal(plan.warnings.length, 1, "an unusable stored amount IS an incident");
  }
});

// ────────────────────────────────────────────────────────────────────────────
// WIRED UP — the same rules, against a REAL SQLite database, with the boot
// migrations this repo actually runs and the transaction the completion route
// actually uses. Everything above proves the policy; this proves the plumbing
// the policy is only worth anything through.
// ────────────────────────────────────────────────────────────────────────────

const ROOT = new URL("../", import.meta.url);
const routesSource = readFileSync(new URL("server/routes.ts", ROOT), "utf8");
const storageSource = readFileSync(new URL("server/storage.ts", ROOT), "utf8");

/** Every `ALTER TABLE <table> ADD COLUMN …` this repo runs at boot, in order. */
function bootAlters(source: string, table: string): string[] {
  const found = source.match(new RegExp("ALTER TABLE " + table + " ADD COLUMN [^`]+", "g"));
  return (found ?? []).map((sql) => sql.trim());
}

/**
 * A database as an OLD deployment's would look after this boot: the original
 * CREATE TABLEs, then every ALTER the source runs, then the pay index. The
 * comp columns are deliberately NOT in the CREATEs — an existing clr.db only
 * ever gets them from the ALTERs, so those are what is under test.
 */
function bootedDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE clr_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assigned_user_id INTEGER NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      recurrence TEXT NOT NULL DEFAULT 'none',
      due_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE clr_task_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      org_id INTEGER NOT NULL,
      due_at TEXT NOT NULL,
      completed_by_user_id INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      UNIQUE(task_id, due_at)
    );
    CREATE TABLE comp_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      expense_date TEXT,
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','denied')),
      is_paid INTEGER NOT NULL DEFAULT 0,
      reviewed_by INTEGER,
      reviewer_note TEXT DEFAULT '',
      requested_at TEXT,
      reviewed_at TEXT,
      paid_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      approval_token TEXT
    );
  `);
  // Idempotent-on-boot, exactly as server/storage.ts and registerRoutes do it:
  // a column that is already there is not an error.
  for (const sql of [
    ...bootAlters(storageSource, "clr_tasks"),
    ...bootAlters(routesSource, "comp_requests"),
    ...bootAlters(routesSource, "clr_task_completions"),
  ]) {
    try { db.exec(sql); } catch { /* already there */ }
  }
  db.exec(TASK_COMP_REQUEST_UNIQUE_INDEX);
  return db;
}

const columnsOf = (db: any, table: string): Set<string> =>
  new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c: any) => String(c.name)));

/** A clr_tasks row in the shape the module reads — the route's compTaskRow(). */
const rowToTask = (row: any): TaskCompTaskRow => ({
  id: Number(row.id) || 0,
  orgId: Number(row.org_id) || 0,
  title: String(row.title ?? ""),
  status: String(row.status ?? "active"),
  recurrence: String(row.recurrence ?? "none"),
  scheduleDays: row.schedule_days,
  assignedUserId: Number(row.assigned_user_id) || 0,
  compAmountCents: row.comp_amount_cents ?? null,
  compReason: row.comp_reason ?? null,
  compSetByUserId: row.comp_set_by_user_id ?? null,
  compSetAt: row.comp_set_at ?? null,
  compSetForUserId: row.comp_set_for_user_id ?? null,
});

function seedTask(db: any, over: Record<string, unknown> = {}): number {
  const row = {
    org_id: 1, title: "Call the Q3 renewals list", description: "", assigned_user_id: 4,
    created_by_user_id: 9, priority: "normal", recurrence: "none", due_at: DUE_AT,
    status: "active", created_at: SET_AT, updated_at: SET_AT, ...over,
  } as any;
  const info = db.prepare(`INSERT INTO clr_tasks
    (org_id,title,description,assigned_user_id,created_by_user_id,priority,recurrence,due_at,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.org_id, row.title, row.description, row.assigned_user_id, row.created_by_user_id,
      row.priority, row.recurrence, row.due_at, row.status, row.created_at, row.updated_at);
  return Number(info.lastInsertRowid);
}

/** What POST/PATCH /api/clr-tasks do with the module's answer, and only that. */
function attachPay(db: any, taskId: number, actor: TaskCompActor, body: Record<string, unknown>) {
  const before = db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(taskId) as any;
  const change = parseTaskCompChange(actor, rowToTask(before), body, SET_AT);
  if (!change.ok) return change;
  const assigned = body.assignedUserId === undefined ? before.assigned_user_id : Number(body.assignedUserId);
  const recurrence = body.recurrence === undefined ? before.recurrence : String(body.recurrence);
  const next = change.next;
  db.prepare(`UPDATE clr_tasks SET assigned_user_id=?,recurrence=?${next ? ",comp_amount_cents=?,comp_reason=?,comp_set_by_user_id=?,comp_set_at=?,comp_set_for_user_id=?" : ""} WHERE id=?`)
    .run(assigned, recurrence,
      ...(next ? [next.compAmountCents, next.compReason, next.compSetByUserId, next.compSetAt, next.compSetForUserId] : []),
      taskId);
  return change;
}

/**
 * What POST /api/clr-tasks/:id/complete does: ONE transaction holding the
 * completion row, the status flip and the money — with the token generated
 * before it and written as a column of the same INSERT.
 */
function completeTask(db: any, args: {
  taskId: number; byUserId: number; completedAt?: string; payeeActive?: boolean; orgId?: number;
}) {
  const orgId = args.orgId ?? 1;
  const completedAt = args.completedAt ?? COMPLETED_AT;
  const task = db.prepare(`SELECT * FROM clr_tasks WHERE id=? AND org_id=?`).get(args.taskId, orgId) as any;
  const existing = db.prepare(TASK_COMP_EXISTING_QUERY).all(orgId, args.taskId) as TaskCompRequestRow[];
  const plan = planTaskCompFiling({
    task: rowToTask(task),
    completion: { taskId: args.taskId, orgId, dueAt: String(task.due_at), completedByUserId: args.byUserId, completedAt },
    existing,
    payeeActive: args.payeeActive ?? true,
    ...NAMES,
    // The route hands over the OFFICE business day and never leaves the plan to
    // its UTC fallback — see POST /api/clr-tasks/:id/complete.
    expenseDate: businessTodayInTz(BUSINESS_DAY_DEFAULT_TZ, new Date(completedAt)),
  });
  const token = plan.file ? `token-${args.taskId}-${completedAt}` : null;
  db.transaction(() => {
    db.prepare(`INSERT INTO clr_task_completions (task_id,org_id,due_at,completed_by_user_id,completed_at,note,calls_made) VALUES (?,?,?,?,?,?,?)`)
      .run(args.taskId, orgId, task.due_at, args.byUserId, completedAt, "did the work", null);
    db.prepare(`UPDATE clr_tasks SET status='completed',updated_at=? WHERE id=? AND org_id=?`).run(completedAt, args.taskId, orgId);
    if (plan.file && token) {
      db.prepare(`INSERT INTO comp_requests
        (org_id,user_id,description,category,amount_cents,expense_date,note,is_reimbursement,status,approval_token,requested_at,created_at,updated_at,task_comp_task_id,task_comp_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          plan.file.orgId, plan.file.userId, plan.file.description, plan.file.category,
          plan.file.amountCents, plan.file.expenseDate, plan.file.note, plan.file.isReimbursement,
          plan.file.status, token, completedAt, completedAt, completedAt,
          plan.file.taskId, plan.file.key);
    }
  })();
  return plan;
}

const compRows = (db: any) => db.prepare(`SELECT * FROM comp_requests ORDER BY id`).all() as any[];
const completionCount = (db: any, taskId: number) =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM clr_task_completions WHERE task_id=?`).get(taskId) as any).n);

test("after boot the pay columns and the exactly-once index really exist", () => {
  const db = bootedDb();
  const taskColumns = columnsOf(db, "clr_tasks");
  for (const column of TASK_COMP_TASK_COLUMNS) {
    assert.ok(taskColumns.has(column.column), `clr_tasks.${column.column} must exist — ${column.why}`);
  }
  const requestColumns = columnsOf(db, "comp_requests");
  for (const column of TASK_COMP_REQUEST_COLUMNS) {
    assert.ok(requestColumns.has(column.column), `comp_requests.${column.column} must exist — ${column.why}`);
  }
  const index = db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='comp_requests_task_comp_task_id'`).get() as any;
  assert.ok(index, "without the index, 'paid at most once per task' is a hope");
  assert.match(String(index.sql), /WHERE task_comp_task_id IS NOT NULL/);

  // And it is really UNIQUE: a second row for the same task is refused by the
  // database, whatever any caller believes.
  const file = (taskId: number | null, id: number) => db.prepare(
    `INSERT INTO comp_requests (id,org_id,user_id,description,category,amount_cents,status,task_comp_task_id) VALUES (?,1,4,'x','bonus',5000,'pending',?)`,
  ).run(id, taskId);
  file(12, 1);
  assert.throws(() => file(12, 2), /UNIQUE/);
  // Hand-typed requests carry NULL and never collide with each other.
  file(null, 3);
  file(null, 4);
  assert.equal(compRows(db).length, 3);
  db.close();
});

test("END TO END: a manager attaches pay, the assignee completes, ONE pending request is filed", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  const change = attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  assert.equal(change.ok, true);
  const stored = db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(taskId) as any;
  assert.equal(stored.comp_amount_cents, 5000);
  assert.equal(stored.comp_set_by_user_id, MANAGER.userId);
  assert.equal(stored.comp_set_for_user_id, 4);

  const plan = completeTask(db, { taskId, byUserId: 4 });
  assert.ok(plan.file);
  const rows = compRows(db);
  assert.equal(rows.length, 1, "exactly one request");
  assert.equal(rows[0].user_id, 4, "the payee is the ASSIGNEE, not whoever clicked complete");
  assert.equal(rows[0].amount_cents, 5000);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].category, TASK_COMP_CATEGORY);
  assert.equal(rows[0].is_reimbursement, 0);
  assert.equal(rows[0].task_comp_task_id, taskId);
  assert.equal(rows[0].task_comp_key, taskCompletionKey(taskId, DUE_AT));
  assert.equal(rows[0].expense_date, "2026-09-08");
  assert.ok(rows[0].approval_token, "the token is a column of the SAME insert — no approval email can reach a row without one");
  assert.match(String(rows[0].description), /auto-filed by C3 from a completed task/);
  db.close();
});

test("END TO END: completing twice files once — the completion's own UNIQUE is the anchor", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  completeTask(db, { taskId, byUserId: 4 });

  // The same cycle again — a retry, a double-click, the loser of a race.
  db.prepare(`UPDATE clr_tasks SET status='active' WHERE id=?`).run(taskId);
  assert.throws(() => completeTask(db, { taskId, byUserId: 4, completedAt: "2026-09-08T16:40:00.000Z" }), /UNIQUE/);
  assert.equal(compRows(db).length, 1, "the money rolled back with the completion");
  assert.equal(completionCount(db, taskId), 1);
  db.close();
});

test("END TO END: a re-opened task with a NEW deadline still cannot pay twice", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  completeTask(db, { taskId, byUserId: 4 });

  // A manager re-opens it AND edits the deadline, which manufactures a cycle
  // key the completions index has never seen. The task-id guard is what stops
  // this one, and it only works because `existing` is keyed on the TASK.
  const laterDue = "2026-09-15T17:00:00.000Z";
  db.prepare(`UPDATE clr_tasks SET status='active', due_at=? WHERE id=?`).run(laterDue, taskId);
  const plan = completeTask(db, { taskId, byUserId: 4, completedAt: "2026-09-15T16:20:00.000Z" });
  assert.equal(plan.file, null);
  assert.equal(plan.skipped, "already-filed");
  assert.equal(compRows(db).length, 1, "one request per task, not one per deadline somebody can edit");
  assert.equal(completionCount(db, taskId), 2, "the work was still recorded — only the money was not repeated");
  db.close();
});

test("END TO END: the guard query is keyed on the TASK, so a reassignment cannot pay a second time", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  completeTask(db, { taskId, byUserId: 4 });

  // Reassigned to somebody else, re-opened, completed again. The per-user query
  // a wiring pass reaches for first would find nothing for user #5 and pay
  // again; TASK_COMP_EXISTING_QUERY finds user #4's row and refuses.
  db.prepare(`UPDATE clr_tasks SET status='active', assigned_user_id=5, due_at=? WHERE id=?`).run("2026-09-20T17:00:00.000Z", taskId);
  const plan = completeTask(db, { taskId, byUserId: 5, completedAt: "2026-09-20T16:00:00.000Z" });
  assert.equal(plan.skipped, "already-filed");
  const perUser = db.prepare(`SELECT id FROM comp_requests WHERE org_id=? AND user_id=? AND task_comp_task_id=?`).all(1, 5, taskId) as any[];
  assert.equal(perUser.length, 0, "this is exactly the query that must NOT be used");
  assert.equal(compRows(db).length, 1);
  db.close();
});

test("END TO END: pay travels with the task, and the request says whose it became", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  // Another manager hands it to a different CLR without touching the pay.
  const moved = attachPay(db, taskId, OTHER_MANAGER, { assignedUserId: 5 });
  assert.equal(moved.ok, true);
  const plan = completeTask(db, { taskId, byUserId: 5 });
  assert.ok(plan.file);
  const row = compRows(db)[0];
  assert.equal(row.user_id, 5, "whoever holds the task at completion is paid");
  assert.match(String(row.note), /reassigned after the pay was attached/);
  db.close();
});

test("END TO END: a CLR can neither attach pay nor raise it, and the row does not move", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  const refused = attachPay(db, taskId, CLR, { amountCents: 5000, reason: "I worked late" });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 403);
  assert.equal((db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(taskId) as any).comp_amount_cents, null);

  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  const raise = attachPay(db, taskId, CLR, { amountCents: 40000, reason: "worth more" });
  assert.equal(raise.ok, false);
  assert.equal((db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(taskId) as any).comp_amount_cents, 5000, "a refused raise changes nothing");

  // And no manager may hand themselves a task that already carries pay.
  const selfDeal = attachPay(db, taskId, MANAGER, { assignedUserId: MANAGER.userId });
  assert.equal(selfDeal.ok, false);
  assert.equal(selfDeal.status, 403);
  assert.equal((db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(taskId) as any).assigned_user_id, 4);
  db.close();
});

test("END TO END: an ordinary unpaid task completes and files nothing at all", () => {
  const db = bootedDb();
  const taskId = seedTask(db, { title: "Tidy the lead queue" });
  const plan = completeTask(db, { taskId, byUserId: 4 });
  assert.equal(plan.file, null);
  assert.equal(plan.skipped, "no-amount");
  assert.equal(compRows(db).length, 0);
  assert.equal(completionCount(db, taskId), 1);
  db.close();
});

test("END TO END: an inactive assignee is not paid, and the completion still stands", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  const plan = completeTask(db, { taskId, byUserId: 4, payeeActive: false });
  assert.equal(plan.file, null);
  assert.equal(plan.skipped, "payee-inactive");
  assert.equal(compRows(db).length, 0);
  assert.equal(completionCount(db, taskId), 1);
  db.close();
});

// ────────────────────────────────────────────────────────────────────────────
// THE DECLINE NOBODY WAS TOLD ABOUT, and THE DAY THE PAY IS BOOKED TO.
// Both are ways a task that was supposed to pay quietly does not.
// ────────────────────────────────────────────────────────────────────────────

test("a decline is a sentence somebody can be SHOWN, not only a console line", () => {
  // The ordinary unpaid task is the overwhelming majority of completions and
  // has nothing whatever to say about money.
  assert.equal(taskCompSkipNotice(planFor(paidTask({ compAmountCents: null }))), "");
  assert.equal(taskCompSkipNotice(null), "");
  assert.equal(taskCompSkipNotice(undefined), "");

  // Every other skip means pay WAS attached and none of it filed. A CLR who
  // ticked a $50 task must not simply be paid nothing with no trace, so each
  // one carries its own reason and says what to do about it.
  const declines = [
    planFor(paidTask(), { payeeActive: false }),
    planFor(paidTask(), { payeeActive: undefined }),
    planFor(paidTask(), { existing: undefined }),
    planFor(paidTask({ assignedUserId: 0 })),
    planFor(paidTask({ compAmountCents: 10.5 })),
    planFor(paidTask(), { expenseDate: "2026-02-30" }),
    planFor(paidTask(), { existing: [taskCompRequestRow(planFor(paidTask()).file!, 7)] }),
  ];
  for (const plan of declines) {
    assert.equal(plan.file, null);
    assert.ok(plan.skipped && plan.skipped !== "no-amount", `${String(plan.skipped)} must be a real decline`);
    const notice = taskCompSkipNotice(plan);
    assert.match(notice, /NO comp request was filed/);
    assert.ok(notice.includes(plan.skipDetail), "the reason travels with it — 'it did not file' on its own helps nobody");
    assert.match(notice, /tell a manager/i, "and it says what the person reading it should do");
    assert.match(notice, /completion was saved/i, "the work still counted; only the money did not");
  }
});

test("END TO END: a 6pm-Pacific completion on the last night of a month books to the OFFICE day", () => {
  const db = bootedDb();
  const taskId = seedTask(db, { due_at: "2026-01-30T17:00:00.000Z" });
  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  // 6:00pm Pacific on 31 January 2026 — already 1 February in UTC, and a
  // different MONTH, which is a different pay period.
  const sixPmPacific = "2026-02-01T02:00:00.000Z";
  assert.equal(businessTodayInTz(BUSINESS_DAY_DEFAULT_TZ, new Date(sixPmPacific)), "2026-01-31");
  const plan = completeTask(db, { taskId, byUserId: 4, completedAt: sixPmPacific });
  assert.ok(plan.file);
  assert.equal(plan.file!.expenseDate, "2026-01-31");
  assert.equal(compRows(db)[0].expense_date, "2026-01-31",
    "the UTC date would have booked January's work into February");

  // And this is the answer the route must not take: left to its own fallback
  // the plan books the UTC calendar date, which is exactly the bug.
  const fallback = planTaskCompFiling({
    task: rowToTask(db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(taskId)),
    completion: { taskId, orgId: 1, dueAt: "2026-01-30T17:00:00.000Z", completedByUserId: 4, completedAt: sixPmPacific },
    existing: [], payeeActive: true, ...NAMES,
  });
  assert.equal(fallback.file!.expenseDate, "2026-02-01", "which is why the route has to pass the business date");
  db.close();
});

test("SQLite reports the duplicate-pay violation by COLUMN — which is what the 409 must match", () => {
  const db = bootedDb();
  const taskId = seedTask(db);
  attachPay(db, taskId, MANAGER, { amountCents: 5000, reason: "Extra evening calling block" });
  completeTask(db, { taskId, byUserId: 4 });
  let message = "";
  try {
    db.prepare(`INSERT INTO comp_requests (org_id,user_id,description,category,amount_cents,status,task_comp_task_id)
      VALUES (1,4,'second helping','bonus',5000,'pending',?)`).run(taskId);
  } catch (error: any) { message = String(error?.message ?? ""); }
  assert.match(message, /UNIQUE constraint failed: comp_requests\.task_comp_task_id/);
  assert.ok(!message.includes("comp_requests_task_comp_task_id"),
    "the INDEX name never appears in the message, so a branch matching it can never fire");
  // And that is the string the completion route actually tests for.
  assert.match(routesSource, /message\.includes\("comp_requests\.task_comp_task_id"\)/);
  assert.ok(routesSource.indexOf('message.includes("comp_requests_task_comp_task_id")') < 0,
    "matching the index name left the operator with the wrong message every time");
  db.close();
});
