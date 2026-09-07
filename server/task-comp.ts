/**
 * Pay attached to a task, and the ONE comp request a completion may file.
 *
 * Ethan: "for tasks, make it possible to add compensation as a admin when
 * assigning a task that when completed can add to the comp requests".
 *
 * So: a manager attaches an amount and a short reason to a task; when that
 * task is completed, C3 files a normal PENDING comp request for the person the
 * task was assigned to, and a human still approves it like any other.
 *
 * This is a button click that creates money, so every rule below is written to
 * fail CLOSED — refuse, skip, or file nothing — rather than to guess.
 *
 * Everything here is arithmetic and string-building over plain values: no
 * database, no imports from routes.ts, the same shape as server/tv-pages.ts
 * and server/comp-auto-file.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WIRING — this is where every piece now lives, and why it has to stay there.
 * (Columns: server/storage.ts + the comp_requests migration in routes.ts.
 *  Callers: POST/PATCH /api/clr-tasks and POST /api/clr-tasks/:id/complete.)
 *
 * 1. New columns on clr_tasks, added the repo's idempotent-on-boot way (see
 *    TASK_COMP_TASK_COLUMNS below for the list and why each one exists):
 *      comp_amount_cents INTEGER, comp_reason TEXT,
 *      comp_set_by_user_id INTEGER, comp_set_at TEXT, comp_set_for_user_id INTEGER
 *
 * 2. New columns on comp_requests, and the index that makes rule 5 a database
 *    guarantee rather than a hope (see TASK_COMP_REQUEST_COLUMNS):
 *      task_comp_task_id INTEGER, task_comp_key TEXT
 *      + TASK_COMP_REQUEST_UNIQUE_INDEX
 *    These two columns are the ONLY place the "has this task already been paid"
 *    question is answered. Nothing reads it back out of description/note —
 *    those carry the task title and the manager's reason verbatim, so anything
 *    scanned out of them is text a user typed. See RULE 5.
 *
 * 3. POST /api/clr-tasks and PATCH /api/clr-tasks/:id call
 *    parseTaskCompChange(actor, task, body, nowIso). `actor` carries the
 *    EXISTING authority — `{ isTaskManager: taskManager(me), userId }`. Do not
 *    invent a second manager check here; taskManager() in routes.ts stays the
 *    authority. A refusal is a 403/400 with its own message, never a silently
 *    dropped field.
 *
 *    Call it on EVERY create and patch, not only the ones carrying a comp
 *    field: a request that merely reassigns a task somebody has already put pay
 *    on can move that money, and this is where that is refused.
 *
 *    Hand it the WHOLE patch body, not just the comp fields. It needs
 *    `assignedUserId`, `recurrence` and `scheduleDays` out of that same body,
 *    because one PATCH can reassign the task, set it repeating AND attach the
 *    pay at once — and both the self-dealing refusal (rule 1) and the exposure
 *    warning (rule 6) have to judge the task as it will be AFTER the patch, not
 *    as it was before it.
 *
 * 4. POST /api/clr-tasks/:id/complete calls planTaskCompFiling(...) and, when
 *    plan.file is non-null, INSERTs that comp_requests row INSIDE THE EXISTING
 *    TRANSACTION — the same one that inserts clr_task_completions and flips the
 *    task to completed:
 *
 *      const token = crypto.randomBytes(24).toString("hex");   // BEFORE the tx
 *      taskSqlite().transaction(() => {
 *        INSERT INTO clr_task_completions (...)   // UNIQUE(task_id, due_at)
 *        UPDATE clr_tasks SET status='completed' ...
 *        if (plan.file) INSERT INTO comp_requests (
 *          ..., approval_token, task_comp_task_id, task_comp_key
 *        ) VALUES (..., token, plan.file.taskId, plan.file.key)     // same tx
 *      })()
 *
 *    That placement is the whole of rule 5. The UNIQUE(task_id, due_at) index on
 *    clr_task_completions is ALREADY the exactly-once anchor for a completion;
 *    putting the money INSIDE the same transaction makes it the exactly-once
 *    anchor for the pay too. A retry, a double-click, or two requests racing all
 *    lose the same way they already do: the UNIQUE violation rolls the whole
 *    transaction back and the route answers "This task cycle was already
 *    completed." A comp row filed in a SECOND transaction after the first one
 *    committed would have no such protection — do not do that.
 *
 *    planTaskCompFiling REQUIRES two inputs a wiring pass must not skip, because
 *    each is a guard and each REFUSES when it is missing:
 *
 *      existing:    every comp request that already carries this TASK id, org
 *                   scoped and NOT user scoped. Run TASK_COMP_EXISTING_QUERY
 *                   verbatim. The natural `WHERE user_id = ?` version is WRONG
 *                   and silently defeats the guard: a task can be reassigned
 *                   between two completions, so the request that already paid
 *                   for it may belong to somebody else entirely.
 *      payeeActive: whether the assignee is an active user — the same
 *                   `owner.isActive ?? owner.is_active` read processRecurringComp
 *                   does. Absent is NOT "probably active": it skips.
 *
 *    Add task_comp_task_id and task_comp_key to mapComp() (routes.ts ~9446)
 *    while you are there. It converts every field by hand, so a column it does
 *    not list reaches the comp pages — and this module — as `undefined`, which
 *    reads exactly like "this task has never been paid".
 *
 * 5. Only after that transaction commits: the audit log, the approver email and
 *    the notification, exactly as processRecurringComp() in routes.ts does them.
 *    Those are best-effort; the row is already durable. The approval TOKEN is
 *    not one of them — processRecurringComp generates it before the transaction
 *    and writes it as a column of the same INSERT (routes.ts ~2327), and so must
 *    this. A token attached by a later UPDATE can be lost between the commit and
 *    that update, leaving a pending request no approval email can ever reach.
 *
 * 6. server/clr-task-scheduler.ts spawnNextTaskOccurrence() must NOT copy the
 *    comp columns onto the successor row (see TASK_COMP_SPAWN_COPIES_AMOUNT).
 *    Today it copies an explicit column list and would not pick them up, which
 *    is the behaviour we want — but it is now load-bearing, so it is stated.
 */
import { formatMoneyCents, roundCents } from "./comp-auto-file";

export { formatMoneyCents, roundCents };

// ── the columns this needs, and why ─────────────────────────────────────────

/**
 * The clr_tasks columns the wiring pass must add. Listed here so the shape is
 * decided in one reviewable place before anyone runs an ALTER TABLE.
 */
export const TASK_COMP_TASK_COLUMNS: Array<{ column: string; type: string; why: string }> = [
  { column: "comp_amount_cents", type: "INTEGER", why: "the pay, in whole cents; NULL means this task pays nothing" },
  { column: "comp_reason", type: "TEXT", why: "the short reason an approver reads on the request" },
  { column: "comp_set_by_user_id", type: "INTEGER", why: "which manager attached it — the request says so out loud" },
  { column: "comp_set_at", type: "TEXT", why: "when they attached it" },
  { column: "comp_set_for_user_id", type: "INTEGER", why: "who was assigned AT THE TIME, so a later reassignment is visible rather than silent" },
];

/**
 * The comp_requests columns the wiring pass must add.
 *
 * They exist because the alternative — writing the task id into the note and
 * reading it back out with a regex — cannot be trusted. The note is built from
 * the task TITLE and the manager's REASON, both free text a user typed, so a
 * task called "Call list [task-comp:12:2026-01-01T00:00:00.000Z]" could block a
 * colleague's real payment, or dress a genuine second filing up as one that was
 * already covered. A column cannot be typed into.
 */
export const TASK_COMP_REQUEST_COLUMNS: Array<{ column: string; type: string; why: string }> = [
  { column: "task_comp_task_id", type: "INTEGER", why: "the clr_tasks.id this request pays for; NULL on every hand-typed request. THE guard for rule 5" },
  { column: "task_comp_key", type: "TEXT", why: "the completion cycle it was filed for — `task-comp:<taskId>:<dueAt>` — so an operator can see which completion the money belongs to" },
];

/**
 * At most one comp request per task, enforced by the database and not only by
 * this module. Partial, so the hand-typed rows (task_comp_task_id NULL) are
 * untouched.
 *
 * It agrees with TASK_COMP_COVERING_STATUSES exactly: comp_requests.status is
 * CHECK-constrained to draft/pending/approved/denied and all four cover, so a
 * row this module would ignore cannot exist and trip the index behind its back.
 * If a status is ever added to that CHECK, add it to the covering list too —
 * never to only one of them.
 *
 * KNOWN GAP, stated rather than left to be discovered: DELETE /api/comp/:id
 * lets the OWNER remove their own draft or pending request. The owner of a
 * task-pay request is the payee, and deleting the row deletes the guard with it
 * — so what this index and taskCompAlreadyFiled promise on their own is "at
 * most one LIVE request per task", not "at most one ever". That delete is
 * therefore refused when task_comp_task_id is set (the request was not theirs
 * to file, so it is not theirs to withdraw); only a comp admin may remove one,
 * and doing so knowingly re-arms the task.
 */
export const TASK_COMP_REQUEST_UNIQUE_INDEX =
  "CREATE UNIQUE INDEX IF NOT EXISTS comp_requests_task_comp_task_id ON comp_requests(task_comp_task_id) WHERE task_comp_task_id IS NOT NULL";

/**
 * The EXACT query the completion route must run to build `existing`.
 *
 * Keyed on the TASK, scoped to the org, and deliberately NOT scoped to a user:
 * the payee is whoever holds the task at completion time (rule 3), so the
 * request that already paid for this task can belong to somebody else. Status
 * is not filtered in SQL either — taskCompAlreadyFiled decides which statuses
 * cover, and filtering here as well would let a status slip past both.
 */
export const TASK_COMP_EXISTING_QUERY = [
  "SELECT id, user_id, category, status, description, note, amount_cents, expense_date,",
  "       task_comp_task_id, task_comp_key",
  "  FROM comp_requests",
  " WHERE org_id = ? AND task_comp_task_id = ?",
].join("\n");

// ── RULE 8 — nothing is auto-approved ───────────────────────────────────────

/**
 * The status a task-pay request is filed at. It is `pending`, the same as every
 * other request: a human opens the Comp Requests queue (or the approval email)
 * and decides. There is no path in this file that produces "approved", and
 * planTaskCompFiling never sets one — completing a task ASKS for money, it does
 * not grant it.
 */
export const TASK_COMP_FILED_STATUS: "pending" = "pending";

/**
 * Task pay is money EARNED, not money the CLR laid out and needs back, so it is
 * never a reimbursement. The payout sheet totals the two groups separately.
 */
export const TASK_COMP_IS_REIMBURSEMENT = 0;

/**
 * The comp category these file under. "bonus" is an existing key in
 * COMP_CATEGORIES (routes.ts ~9430) and is the closest honest description of
 * extra pay for a specific piece of work. It is deliberately NOT "transfers":
 * server/comp-auto-file.ts treats every transfers-category row as a claim on a
 * whole month and would read a task request as "September is already filed".
 */
export const TASK_COMP_CATEGORY = "bonus";

// ── RULE 1 — who may set it ─────────────────────────────────────────────────

/**
 * Whether a manager may attach pay to a task they themselves are assigned.
 *
 * False, and it refuses. The payee is the assignee (rule 3), so a manager
 * attaching pay to their own task writes themselves a cheque with one click and
 * the only human in the loop afterwards is the approver, who sees a request that
 * looks exactly like everybody else's.
 *
 * WHAT THIS ACTUALLY GUARANTEES, precisely — every check below is made against
 * the assignee the task will HAVE once the request is applied, never the one it
 * had before it:
 *
 *   - attaching pay to a task already assigned to you is refused;
 *   - ONE request that reassigns the task to you AND attaches the pay is
 *     refused as well. That is the same cheque in two ordinary clicks, and the
 *     pre-patch reading of this rule waved it straight through;
 *   - and a request that hands you a task somebody has ALREADY attached pay to
 *     is refused too, even when it touches no comp field at all.
 *
 * WHAT IT DOES NOT GUARANTEE, so nobody reads more into it than is here: two
 * managers can still attach pay to each other's tasks, a manager may still
 * complete somebody else's paid task (the money goes to the assignee, rule 3,
 * and the request says so out loud), and none of this is an approval — every
 * request still lands PENDING in front of a human (rule 8). What it removes is
 * the path where one person is both the manager attaching the money and the
 * person receiving it.
 */
export const ALLOW_SELF_ASSIGNED_TASK_COMP = false;

/**
 * Task statuses on which the amount is frozen.
 *
 * Once a task is completed or archived the amount cannot be touched at all.
 * This is half of rule 4 — the half that means a "later edit" is not merely
 * ineffective, it is refused — and it is why nobody can quietly raise the pay on
 * a task that has already filed its request and hope the approver does not look.
 */
export const TASK_COMP_LOCKED_TASK_STATUSES: string[] = ["completed", "archived"];

/** The authority the route already has, handed in rather than recomputed. */
export interface TaskCompActor {
  userId: number;
  /** taskManager(me) from routes.ts. This module never decides who is a manager. */
  isTaskManager: boolean;
}

/**
 * THE predicate. A CLR is never allowed to set, raise, lower, or clear task pay
 * — not on anyone's task and not on their own.
 */
export function mayAttachTaskComp(actor: TaskCompActor | null | undefined): boolean {
  return !!actor && actor.isTaskManager === true;
}

// ── RULE 2 — what is attached ───────────────────────────────────────────────

/** The smallest amount that may be attached. Whole cents, and it must be pay. */
export const TASK_COMP_MIN_CENTS = 1;

/**
 * The largest amount that may be attached to one task: $500.00.
 *
 * A cap exists because the realistic failure here is not fraud, it is a
 * keyboard. "50" meaning $50.00 typed into a cents field is $0.50 — annoying.
 * "5000" meaning $50.00 typed into a dollars field is $5,000.00 — a payroll
 * event. A cap turns the second one into a red box at the moment of typing
 * instead of a pending request nobody reads carefully.
 *
 * $500 is well above any per-task bonus this shop pays (transfer comp runs
 * $5–$15 PER TRANSFER, and a whole heavy month tops out around $3,000), so the
 * cap should never be reached by a real amount. If a genuine task is worth more
 * than $500, that is a conversation and a hand-filed request, not a checkbox.
 */
export const TASK_COMP_MAX_CENTS = 50000;

/** A reason is required — see validateTaskCompReason for why. */
export const TASK_COMP_REASON_REQUIRED = true;
export const TASK_COMP_REASON_MIN_LENGTH = 3;
export const TASK_COMP_REASON_MAX_LENGTH = 120;

export interface AmountCheck { ok: boolean; amountCents: number; error: string | null; }

/**
 * Whole cents, positive, inside the cap. Everything else is refused by name.
 *
 * Note what is NOT accepted: a string, a float, zero, a negative, NaN,
 * Infinity. Money arrives from a JSON body, so "1000" and 10.5 both turn up,
 * and Number() would happily turn "" into 0 and null into 0. A zero-cent
 * request is not a free task, it is a request nobody meant to make.
 */
export function validateTaskCompAmountCents(value: unknown): AmountCheck {
  if (typeof value !== "number") {
    return { ok: false, amountCents: 0, error: "Enter the task pay as a whole number of cents." };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, amountCents: 0, error: "Enter the task pay as a whole number of cents." };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, amountCents: 0, error: "Task pay must be a whole number of cents — no fractions of a cent." };
  }
  if (value <= 0) {
    return { ok: false, amountCents: 0, error: "Task pay must be more than $0.00. Leave it blank for an unpaid task." };
  }
  if (value < TASK_COMP_MIN_CENTS) {
    return { ok: false, amountCents: 0, error: `Task pay must be at least ${formatMoneyCents(TASK_COMP_MIN_CENTS)}.` };
  }
  if (value > TASK_COMP_MAX_CENTS) {
    return {
      ok: false,
      amountCents: 0,
      error: `Task pay cannot be more than ${formatMoneyCents(TASK_COMP_MAX_CENTS)}. Check the amount — if it is really that much, file it as a comp request by hand.`,
    };
  }
  return { ok: true, amountCents: value, error: null };
}

export interface ReasonCheck { ok: boolean; reason: string; error: string | null; }

/**
 * The short reason, required.
 *
 * The approver sees a request they did not type, for a task they may not have
 * assigned. "Task pay — Call the Q3 renewals list" says what happened; a blank
 * reason makes them go and ask. It is one line of typing at the moment the
 * manager already knows the answer.
 */
export function validateTaskCompReason(value: unknown): ReasonCheck {
  const reason = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!reason) {
    return { ok: false, reason: "", error: "Say what the pay is for — a short reason is required." };
  }
  if (reason.length < TASK_COMP_REASON_MIN_LENGTH) {
    return { ok: false, reason: "", error: `The reason for the pay must be at least ${TASK_COMP_REASON_MIN_LENGTH} characters.` };
  }
  if (reason.length > TASK_COMP_REASON_MAX_LENGTH) {
    return { ok: false, reason: "", error: `The reason for the pay must be ${TASK_COMP_REASON_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, reason, error: null };
}

export interface ExpenseDateCheck { ok: boolean; date: string; error: string | null; }

/**
 * The business date the money is booked to. It goes onto the money row, so it
 * is checked rather than passed through.
 *
 * Exactly "YYYY-MM-DD", and a real day in the calendar: "2026-02-30" and
 * "2026-13-01" are refused, not stored. An unusable expense_date is not
 * cosmetic — every payout sheet, month filter and export in the comp pages
 * sorts and groups on this column, so one bad value hides a real request from
 * the month it belongs to.
 */
export function validateTaskCompExpenseDate(value: unknown): ExpenseDateCheck {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, date: "", error: "The expense date is missing." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, date: "", error: `The expense date must look like YYYY-MM-DD, not "${raw.slice(0, 40)}".` };
  }
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const at = new Date(Date.UTC(year, month - 1, day));
  const real = at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  if (!real) return { ok: false, date: "", error: `${raw} is not a real date.` };
  if (year < 2000 || year > 2100) return { ok: false, date: "", error: `${raw} is not a plausible expense date.` };
  return { ok: true, date: raw, error: null };
}

// ── RULE 3 — who gets paid ──────────────────────────────────────────────────

/**
 * The payee is the task's ASSIGNEE, never whoever clicked complete.
 *
 * A manager may complete a task on somebody's behalf — the existing route
 * allows exactly that (`if (!taskManager(me) && assigned_user_id !== userId)`).
 * Paying the clicker would hand a manager the CLR's money every time they tidied
 * up a task list.
 */
export const TASK_COMP_PAYEE: "task-assignee" = "task-assignee";

/**
 * What a reassignment does: the amount STAYS ON THE TASK, and whoever holds the
 * task when it is completed is paid.
 *
 * The alternative — clear the pay whenever the assignee changes — fails quietly
 * in the direction that matters: someone does paid work and is not paid, and
 * nothing anywhere says so. Keeping the amount fails loudly instead: the request
 * is filed for the new assignee and carries a WARNING line naming both people,
 * so the approver sees the swap before the money moves.
 *
 * The one reassignment this does not allow is a manager handing THEMSELVES a
 * task that already carries pay — see ALLOW_SELF_ASSIGNED_TASK_COMP.
 */
export const TASK_COMP_REASSIGNMENT: "amount-travels-with-the-task" = "amount-travels-with-the-task";

// ── RULE 5 — exactly once ───────────────────────────────────────────────────

/**
 * The completion identity, and it is not a new invention: it is the exact tuple
 * clr_task_completions already declares UNIQUE.
 *
 *   UNIQUE(task_id, due_at)
 *
 * One completion row can exist per (task, deadline). File the comp request in
 * the same transaction as that row and the pay inherits the guarantee for free.
 */
export const TASK_COMP_IDEMPOTENCY_COLUMNS: string[] = ["task_id", "due_at"];

/** The prefix of the cycle key, and of the human-readable marker built from it. */
export const TASK_COMP_MARKER_PREFIX = "task-comp:";

/**
 * `task-comp:<taskId>:<dueAt>` — one completion cycle, as a string. This is the
 * value stored in comp_requests.task_comp_key.
 *
 * Both sides of every comparison are built here, so the sanitising below
 * (brackets and newlines out, length bounded) can never make two equal cycles
 * look different from each other.
 */
export function taskCompletionKey(taskId: unknown, dueAt: unknown): string {
  const id = Math.trunc(Number(taskId) || 0);
  const at = String(dueAt ?? "").replace(/[\[\]\r\n]/g, "").trim().slice(0, 40);
  return `${TASK_COMP_MARKER_PREFIX}${id}:${at}`;
}

/** The bracketed form that goes in the note: `[task-comp:12:2026-09-07T17:00:00.000Z]`. */
export function buildTaskCompMarker(key: string): string {
  return `[${key}]`;
}

const MARKER_RE = /\[task-comp:(\d+):([^\]]*)\]/;

/**
 * The key a request's text carries, or null.
 *
 * A READING AID, never a guard. The text this runs over is built from the task
 * title and the manager's reason, so anybody who can name a task can put
 * whatever they like in it — which is precisely why taskCompAlreadyFiled reads
 * columns instead. Use this to explain a row to a human, not to decide whether
 * to pay one.
 */
export function readTaskCompKey(text: unknown): string | null {
  const m = MARKER_RE.exec(String(text ?? ""));
  return m ? `${TASK_COMP_MARKER_PREFIX}${m[1]}:${m[2]}` : null;
}

/** The task id a request's text carries, or null. A READING AID — see above. */
export function readTaskCompTaskId(text: unknown): number | null {
  const m = MARKER_RE.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

/** A comp_requests row, in the shape mapComp() hands out. */
export interface TaskCompRequestRow {
  id?: number | null;
  userId?: number | null;
  category?: string | null;
  status?: string | null;
  description?: string | null;
  note?: string | null;
  amountCents?: number | null;
  expenseDate?: string | null;
  /** comp_requests.task_comp_task_id — THE guard. See taskCompAlreadyFiled. */
  taskCompTaskId?: number | null;
  /** comp_requests.task_comp_key. */
  taskCompKey?: string | null;
  /**
   * The same two, under their raw column names.
   *
   * mapComp() in routes.ts (~9446) lists every field it converts by hand, so a
   * wiring pass that adds the columns and forgets the two lines there would hand
   * this module rows whose taskCompTaskId is `undefined` on every single one —
   * a guard that reads as "nothing has ever been filed" and never says why.
   * Accepting both spellings means a raw sqlite row works too. Add them to
   * mapComp anyway; this is the belt, not the trousers.
   */
  task_comp_task_id?: number | null;
  task_comp_key?: string | null;
}

/**
 * Statuses that mean "this completion has already asked for its money".
 *
 * `denied` counts. A human looked at that ask and said no; re-filing it because
 * the task got re-opened would re-ask a question that was answered. Same reading
 * as COVERING_STATUSES in server/comp-auto-file.ts, deliberately.
 */
export const TASK_COMP_COVERING_STATUSES: string[] = ["draft", "pending", "approved", "denied"];

/**
 * Has this completion — or this task at all — already filed?
 *
 * TWO tests, and either one blocks:
 *
 *   a) the exact cycle key already appears on a request; and
 *   b) ANY request already carries this task id.
 *
 * (b) is what closes the re-open-and-recomplete hole. The UNIQUE constraint is
 * keyed on (task_id, due_at), so a manager who re-opens a completed task AND
 * edits its deadline manufactures a brand-new cycle key, and the database would
 * let it complete and pay a second time. Because a recurring series gives every
 * occurrence its OWN clr_tasks row (spawnNextTaskOccurrence INSERTs a new id),
 * "at most one request per task id" is also exactly "at most one per
 * occurrence" — so (b) costs a legitimate recurring series nothing.
 *
 * BOTH tests read COLUMNS — task_comp_task_id and task_comp_key — and nothing
 * here looks at description or note. That is the whole point. The note is built
 * from the task title and the manager's reason, so a task named
 * "Call list [task-comp:12:2026-01-01T00:00:00.000Z]" could otherwise block a
 * colleague's real payment, or make a genuine second filing look like it had
 * already been covered. Free text a user typed cannot be a money guard.
 */
export function taskCompAlreadyFiled(
  rows: TaskCompRequestRow[] | null | undefined,
  args: { taskId: number; dueAt: string },
): TaskCompRequestRow[] {
  const key = taskCompletionKey(args.taskId, args.dueAt);
  const taskId = Math.trunc(Number(args.taskId) || 0);
  const list = rows ?? [];
  const out: TaskCompRequestRow[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    const status = String(row?.status ?? "").trim().toLowerCase();
    if (status && TASK_COMP_COVERING_STATUSES.indexOf(status) < 0) continue;
    const rawTaskId = row?.taskCompTaskId ?? row?.task_comp_task_id;
    const rowTaskId = rawTaskId === null || rawTaskId === undefined ? 0 : Math.trunc(Number(rawTaskId) || 0);
    const rowKey = String(row?.taskCompKey ?? row?.task_comp_key ?? "").trim();
    if ((taskId > 0 && rowTaskId === taskId) || (rowKey !== "" && rowKey === key)) out.push(row);
  }
  return out;
}

// ── RULE 6 — recurring tasks ────────────────────────────────────────────────

/**
 * THE DANGEROUS ONE, and the default is the quiet one.
 *
 * "this-occurrence-only": the amount belongs to the single task ROW it was
 * attached to. When that occurrence is completed it files once, and the
 * successor occurrence the scheduler spawns carries NO pay until a manager
 * attaches it again.
 *
 * Why this way round: a paid task set to repeat daily under the other reading
 * files a request EVERY DAY, for as long as the series lives, with no ceiling
 * and no second human decision. $50 a day is $18,250 a year off one checkbox.
 * The failure mode of this default is that somebody is under-paid and says so
 * within a day; the failure mode of the other is that nobody notices until
 * payroll. Under-paying is recoverable. Over-paying, at that scale, is not.
 *
 * THIS IS A GUESS AT WHAT ETHAN WANTS AND IT IS THE FIRST OPEN QUESTION. If he
 * wants a daily paid task to pay daily, flip this constant to
 * "every-occurrence", make spawnNextTaskOccurrence copy the comp columns, and
 * put a ceiling on the series before it ships. recurringCompExposure already
 * carries the other wording for that day.
 */
export const TASK_COMP_RECURRING_MODE: "this-occurrence-only" = "this-occurrence-only";

/**
 * Whether the recurrence engine copies the amount onto the next occurrence.
 * False, and it is the mechanism behind TASK_COMP_RECURRING_MODE: an unpaid
 * successor is unpaid because the column was never copied, not because some
 * later check remembered to skip it.
 */
export const TASK_COMP_SPAWN_COPIES_AMOUNT = false;

/**
 * Recurrences that repeat at all — anything but "none".
 *
 * A value C3 does not recognise counts as repeating: not knowing the schedule
 * is not the same as there being no schedule, and the expensive mistake is
 * treating a repeat as a one-off.
 */
export function taskRecurs(recurrence: unknown): boolean {
  const r = String(recurrence ?? "none").trim().toLowerCase();
  return r !== "" && r !== "none";
}

/** Weeks in a month. Deliberately rough, and used for every weekly-ish schedule. */
const WEEKS_PER_MONTH = 4;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The weekdays a custom_weekly task fires on: 0–6, unique, sorted.
 *
 * Accepts what the row and the body actually hold — clr_tasks.schedule_days is
 * a JSON TEXT column and the PATCH body sends an array — and normalises both
 * the way normalizeTaskScheduleDays does in shared/clr-tasks.ts.
 */
export function normalizeTaskCompScheduleDays(value: unknown): number[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const day = Number(raw[i]);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (out.indexOf(day) < 0) out.push(day);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Roughly how many times a recurrence fires in a month, or NULL when C3 cannot
 * tell. Deliberately rough — but never wrong by a factor of five, and never
 * confidently zero.
 *
 * custom_weekly needs the selected days to mean anything: one day a week is
 * about 4 a month and five days a week is about 20, and the old flat 22 told a
 * manager who had picked Fridays that they were exposed to five times what they
 * were. A custom_weekly with no days stored is a broken row, not a schedule
 * that never fires, so it answers "unknown".
 *
 * An unrecognised recurrence answers null, NOT 0. Zero renders as "$0.00 a
 * month", which is the one answer that is certainly false about a task that
 * repeats.
 */
export function occurrencesPerMonth(recurrence: unknown, scheduleDays?: unknown): number | null {
  const r = String(recurrence ?? "none").trim().toLowerCase();
  if (r === "" || r === "none") return 0;
  if (r === "daily") return 30;
  if (r === "weekdays") return 22;
  if (r === "weekly") return WEEKS_PER_MONTH;
  if (r === "monthly") return 1;
  if (r === "custom_weekly") {
    const days = normalizeTaskCompScheduleDays(scheduleDays);
    return days.length ? days.length * WEEKS_PER_MONTH : null;
  }
  return null;
}

export interface RecurringExposure {
  recurs: boolean;
  /** False when C3 does not recognise the schedule — then both numbers are null. */
  known: boolean;
  /** Null — never 0 — when the schedule is not recognised. */
  perMonth: number | null;
  /** Null — never 0 — when the schedule is not recognised. */
  monthlyCents: number | null;
  /** The sentence to show the manager BEFORE they save. Empty when not recurring. */
  warning: string;
}

/**
 * What a repeating paid task commits the CLR to, said in the terms of the mode
 * that is ACTUALLY in force.
 *
 * Under "this-occurrence-only" — today's default — attaching $50 to a daily task
 * commits $50, once. The old wording announced "about $1,500.00 a month" on
 * every one of those requests, which was false, and false in the direction that
 * teaches an approver to skim the next warning too. The monthly figure is still
 * computed and returned for a UI that wants to show the scale, but the sentence
 * a human reads leads with what is actually being committed.
 */
export function recurringCompExposure(recurrence: unknown, amountCents: number, scheduleDays?: unknown): RecurringExposure {
  const recurs = taskRecurs(recurrence);
  const amount = Math.max(0, roundCents(amountCents));
  if (!recurs) return { recurs: false, known: true, perMonth: 0, monthlyCents: 0, warning: "" };

  const perMonth = occurrencesPerMonth(recurrence, scheduleDays);
  const known = perMonth !== null;
  const monthlyCents = perMonth === null ? null : roundCents(perMonth * amount);
  const raw = String(recurrence ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const days = normalizeTaskCompScheduleDays(scheduleDays);
  const label = raw.toLowerCase() === "custom_weekly" && days.length
    ? `${raw} (${days.map((d) => WEEKDAY_LABELS[d]).join(", ")})`
    : raw;
  const money = formatMoneyCents(amount);
  const unknownTail = ` C3 does not recognise the schedule "${label}", so it CANNOT say how often this repeats — treat the monthly exposure as UNKNOWN and work it out by hand before saving.`;

  // Typed as boolean deliberately: TASK_COMP_RECURRING_MODE is a literal type,
  // and comparing it against the other value directly is a compile error, which
  // would leave the "every-occurrence" wording unwritten until the day somebody
  // flips the constant and ships the wrong sentence with it.
  const thisOccurrenceOnly: boolean = TASK_COMP_RECURRING_MODE === "this-occurrence-only";

  let warning: string;
  if (thisOccurrenceOnly) {
    warning = `This task repeats ${label}, but ONLY THIS occurrence pays ${money}. The amount is not copied onto the next occurrence, so what you are attaching is ${money} once — not ${money} every time. Any later occurrence a manager wants paid needs pay attached to it again.`;
    if (perMonth !== null && monthlyCents !== null && perMonth > 0) {
      warning += ` (For scale only, if that default were ever changed: about ${String(perMonth)} occurrences a month would be ${formatMoneyCents(monthlyCents)}.)`;
    } else if (perMonth === null) {
      warning += unknownTail;
    }
  } else if (perMonth !== null && monthlyCents !== null) {
    warning = `This task repeats ${label} and EVERY occurrence pays ${money} — about ${String(perMonth)} times a month, roughly ${formatMoneyCents(monthlyCents)} a month, with no ceiling.`;
  } else {
    warning = `This task repeats ${label} and EVERY occurrence pays ${money}.${unknownTail}`;
  }

  return { recurs: true, known, perMonth, monthlyCents, warning };
}

// ── attaching / changing the amount ─────────────────────────────────────────

/** The task fields this module reads. Plain values, as the route has them. */
export interface TaskCompTaskRow {
  id: number;
  orgId: number;
  title: string;
  status?: string | null;
  recurrence?: string | null;
  /** clr_tasks.schedule_days — the JSON array, or the TEXT column holding one. */
  scheduleDays?: unknown;
  assignedUserId: number;
  compAmountCents?: number | null;
  compReason?: string | null;
  compSetByUserId?: number | null;
  compSetAt?: string | null;
  /** Who was the assignee when the amount was attached. */
  compSetForUserId?: number | null;
}

/**
 * What the route is being asked to write — THE WHOLE PATCH BODY, not just the
 * comp fields. `null` amount clears the pay.
 *
 * assignedUserId, recurrence and scheduleDays are read so that both the
 * self-dealing refusal and the exposure warning see the task as it will be once
 * this request is applied. One PATCH can carry all of them at once, and judging
 * the pay against the pre-patch row is exactly how a same-request reassignment
 * (or a same-request "make it repeat daily") got past both of them.
 */
export interface TaskCompInput {
  amountCents?: unknown;
  reason?: unknown;
  /** The assignee this request is setting, when it sets one. */
  assignedUserId?: unknown;
  /** The recurrence this request is setting, when it sets one. */
  recurrence?: unknown;
  /** The custom_weekly days this request is setting, when it sets them. */
  scheduleDays?: unknown;
}

export interface TaskCompChange {
  ok: boolean;
  /** HTTP status the route should answer with when ok is false. */
  status: number;
  error: string | null;
  /** Null when the field was absent — leave the stored value alone. */
  next: {
    compAmountCents: number | null;
    compReason: string | null;
    compSetByUserId: number | null;
    compSetAt: string | null;
    compSetForUserId: number | null;
  } | null;
  /** Operator-facing notes; never a reason to refuse. */
  warnings: string[];
}

const REFUSE = (status: number, error: string, warnings: string[] = []): TaskCompChange =>
  ({ ok: false, status, error, next: null, warnings });

const has = (body: object, field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);

/** A user id out of a body or a row: a positive whole number, or nothing. */
function readUserId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * WHO WILL HOLD THIS TASK once the request is applied — the only assignee any
 * pay decision may be made against.
 *
 * When the body sets assignedUserId, that is the answer, and the stored value is
 * simply the assignee this request is about to replace. When the body does not,
 * the stored one stands. Either way an unreadable answer is a refusal, never a
 * quiet fall back to the other one: falling back is how "who gets this money"
 * ends up being answered by the row the patch is in the middle of overwriting.
 */
function effectiveAssignee(
  task: TaskCompTaskRow | null | undefined,
  body: TaskCompInput,
): { ok: boolean; userId: number; error: string | null } {
  if (has(body, "assignedUserId")) {
    const patched = readUserId((body as { assignedUserId?: unknown }).assignedUserId);
    if (patched === null) {
      return { ok: false, userId: 0, error: "C3 could not read who this task is being assigned to, so it will not attach pay to it." };
    }
    return { ok: true, userId: patched, error: null };
  }
  const stored = readUserId(task?.assignedUserId);
  if (stored === null) {
    return { ok: false, userId: 0, error: "This task has nobody assigned to it, so there is nobody the pay could go to. Assign it first." };
  }
  return { ok: true, userId: stored, error: null };
}

/** Is there pay on this row at all? Anything but NULL counts — fail closed. */
function taskCarriesPay(task: TaskCompTaskRow | null | undefined): boolean {
  return task?.compAmountCents !== null && task?.compAmountCents !== undefined;
}

/**
 * Decide what a comp change should write, or refuse it by name.
 *
 * Refuses — never ignores. Silently dropping the field would leave a manager
 * looking at a task they believe pays $50 and a CLR who is never paid, which is
 * the worst outcome available here.
 *
 * `amountCents` absent entirely  → nothing changes (next is null).
 * `amountCents` null            → the pay is cleared.
 * `amountCents` a number        → validated, and a reason is required with it.
 *
 * A request that touches no comp field is still inspected for ONE thing:
 * whether it hands an already-paid task to the person making it. That is the
 * same self-dealing move as attaching pay to your own task, one patch later,
 * and rule 1 would be a formality if it only looked on the requests that
 * happened to carry a comp field.
 */
export function parseTaskCompChange(
  actor: TaskCompActor | null | undefined,
  task: TaskCompTaskRow,
  input: TaskCompInput | null | undefined,
  now: string,
): TaskCompChange {
  const body = input ?? {};
  const touching = has(body, "amountCents") || has(body, "reason");
  const actorId = readUserId(actor?.userId);

  if (!touching) {
    // Not a comp edit. The only thing that can still move money is a
    // reassignment of a task that ALREADY carries pay.
    if (!ALLOW_SELF_ASSIGNED_TASK_COMP && has(body, "assignedUserId") && taskCarriesPay(task)) {
      if (actorId === null) {
        return REFUSE(403, "C3 could not tell who is making this change, so it will not move a task that carries pay.");
      }
      const target = effectiveAssignee(task, body);
      if (!target.ok) return REFUSE(400, target.error ?? "C3 could not read who this task is being assigned to.");
      if (target.userId === actorId) {
        return REFUSE(403, "You cannot assign yourself a task that already carries pay — that pays you for it. Clear the pay first, or ask another manager to reassign it.");
      }
    }
    return { ok: true, status: 200, error: null, next: null, warnings: [] };
  }

  // RULE 1. Authority is an INPUT — taskManager(me) in routes.ts decides it.
  if (!mayAttachTaskComp(actor)) {
    return REFUSE(403, "Only a manager can put pay on a task.");
  }
  if (actorId === null) {
    return REFUSE(403, "C3 could not tell who is attaching this pay, and it will not attach money on behalf of an unidentified user.");
  }

  // RULE 4 (the frozen half). Not after it has been completed or archived.
  const status = String(task?.status ?? "active").trim().toLowerCase();
  if (TASK_COMP_LOCKED_TASK_STATUSES.indexOf(status) >= 0) {
    return REFUSE(409, `This task is ${status} — its pay is locked. If the amount was wrong, deny the comp request and file the right one by hand.`);
  }

  const raw = (body as { amountCents?: unknown }).amountCents;
  const clearing = raw === null;

  if (clearing) {
    return {
      ok: true, status: 200, error: null,
      next: { compAmountCents: null, compReason: null, compSetByUserId: null, compSetAt: null, compSetForUserId: null },
      warnings: [],
    };
  }

  // A reason on its own changes nothing anybody is paid, and a reason without an
  // amount is a note. Refuse rather than half-writing it.
  if (raw === undefined) {
    return REFUSE(400, "Enter the task pay amount as well as the reason, or leave both blank.");
  }

  const amount = validateTaskCompAmountCents(raw);
  if (!amount.ok) return REFUSE(400, amount.error ?? "That task pay amount is not valid.");

  const reason = validateTaskCompReason((body as { reason?: unknown }).reason);
  if (!reason.ok) return REFUSE(400, reason.error ?? "A reason for the pay is required.");

  // RULE 1, the self-dealing half — judged on the assignee this request RESULTS
  // in. One body that reassigns the task to the actor and attaches the pay is
  // exactly the case this refuses.
  const target = effectiveAssignee(task, body);
  if (!target.ok) return REFUSE(400, target.error ?? "C3 could not read who this task is assigned to.");
  const assignee = target.userId;
  if (!ALLOW_SELF_ASSIGNED_TASK_COMP && assignee === actorId) {
    return REFUSE(403, "You cannot put pay on a task assigned to yourself. Ask another manager to attach it, or file the comp request by hand.");
  }

  const warnings: string[] = [];

  // RULE 6, judged on the schedule this request RESULTS in. One request can set
  // the repeat and the pay together, and that is the request the manager most
  // needs the exposure sentence on — reading the recurrence off the stored row
  // showed no exposure at all on exactly that flow.
  const recurrence = has(body, "recurrence") ? (body as { recurrence?: unknown }).recurrence : task?.recurrence;
  const scheduleDays = has(body, "scheduleDays") ? (body as { scheduleDays?: unknown }).scheduleDays : task?.scheduleDays;
  const exposure = recurringCompExposure(recurrence, amount.amountCents, scheduleDays);
  if (exposure.recurs) warnings.push(exposure.warning);

  const storedAssignee = readUserId(task?.assignedUserId);
  if (has(body, "assignedUserId") && storedAssignee !== null && storedAssignee !== assignee) {
    warnings.push(`This request reassigns the task from user #${String(storedAssignee)} to user #${assignee} and attaches the pay in one go — the pay follows the new assignee.`);
  }

  const previous = Number(task?.compAmountCents ?? 0) || 0;
  if (previous > 0 && amount.amountCents > previous) {
    warnings.push(`Pay raised from ${formatMoneyCents(previous)} to ${formatMoneyCents(amount.amountCents)}.`);
  }

  return {
    ok: true, status: 200, error: null,
    next: {
      compAmountCents: amount.amountCents,
      compReason: reason.reason,
      compSetByUserId: actorId,
      compSetAt: String(now ?? ""),
      compSetForUserId: assignee,
    },
    warnings,
  };
}

// ── RULE 7 — what the request says ──────────────────────────────────────────

/** The phrase that tells an approver a person did not type this request. */
export const TASK_COMP_DESCRIPTION_TAG = "auto-filed by C3 from a completed task";

export const TASK_COMP_MAX_DESCRIPTION_LENGTH = 300;

/**
 * The note ceiling, and it is not this module's choice: every note-taking route
 * in routes.ts stores `String(body.note).slice(0, 1000)`. A note built longer
 * than that does not stay longer — it reaches the column and loses its tail,
 * silently.
 *
 * So the note is built to fit. And nothing this module needs later lives
 * anywhere a clamp could reach: the exactly-once guard is a COLUMN
 * (task_comp_task_id), not a marker parsed back out of the text, and the marker
 * line that remains is reserved space at the end of the note so it survives even
 * when the middle is dropped. The old note put the only guard on the last line
 * of an unbounded string — a long title deleted it and re-opened the very hole
 * it was written to close.
 */
export const TASK_COMP_MAX_NOTE_LENGTH = 1000;

const TITLE_IN_DESCRIPTION = 90;
const REASON_IN_DESCRIPTION = 90;
const TITLE_IN_NOTE = 70;
const NAME_IN_NOTE = 40;
const STAMP_IN_NOTE = 32;
const WARNING_IN_NOTE = 180;
const NOTE_TRUNCATED_LINE = "… (note truncated — the rest is on the task and in the audit log)";

/**
 * User text, made safe to sit in a line C3 built: whitespace collapsed, square
 * brackets removed, length bounded.
 *
 * The brackets go because the note ends with `[task-comp:…]`. Nothing decides
 * anything by reading that marker back any more, but a title of
 * "Call list [task-comp:99:x]" sitting in the middle of a note is a lie told to
 * the next person who greps for one, and there is no reason to allow it.
 */
function clamp(text: unknown, max: number): string {
  const s = String(text ?? "").replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * The one line on the request.
 *
 * "Task pay — <task title> — <reason> (<amount>) — auto-filed by C3 from a
 * completed task". The title and reason are clamped, never the tag: an approver
 * must always be able to see that nobody typed this.
 */
export function buildTaskCompDescription(args: {
  title: unknown;
  reason: unknown;
  amountCents: number;
}): string {
  const title = clamp(args.title, TITLE_IN_DESCRIPTION) || "Untitled task";
  const reason = clamp(args.reason, REASON_IN_DESCRIPTION);
  const money = formatMoneyCents(args.amountCents);
  const head = reason ? `Task pay — ${title} — ${reason}` : `Task pay — ${title}`;
  return `${head} (${money}) — ${TASK_COMP_DESCRIPTION_TAG}`.slice(0, TASK_COMP_MAX_DESCRIPTION_LENGTH);
}

/**
 * Join head + optional detail + footer so the whole note fits inside
 * TASK_COMP_MAX_NOTE_LENGTH, with the footer's space reserved FIRST.
 *
 * The head is bounded by construction (every value in it is clamped), the
 * footer is the approval line and the marker, and the middle — the reason and
 * the warnings — is what gives way when a long title, long names and several
 * warnings cannot all fit. When something is dropped the note says so, instead
 * of just stopping mid-sentence.
 */
function fitLines(head: string[], detail: string[], budget: number): { out: string; dropped: boolean } {
  let out = head.join("\n");
  if (out.length > budget) out = out.slice(0, Math.max(0, budget - 1));
  let dropped = false;
  for (let i = 0; i < detail.length; i += 1) {
    if (out.length + 1 + detail[i].length <= budget) out = `${out}\n${detail[i]}`;
    else { dropped = true; break; }
  }
  return { out, dropped };
}

function noteWithinLimit(head: string[], detail: string[], footer: string[]): string {
  const foot = footer.join("\n");
  const budget = Math.max(0, TASK_COMP_MAX_NOTE_LENGTH - foot.length - 1);
  const whole = fitLines(head, detail, budget);
  if (!whole.dropped) return `${whole.out}\n${foot}`;
  // Something has to go. Say so — which means reserving the room to say it and
  // fitting the detail again, rather than dropping a line and a notice both.
  const reserved = Math.max(0, budget - NOTE_TRUNCATED_LINE.length - 1);
  const trimmed = fitLines(head, detail, reserved);
  return `${trimmed.out}\n${NOTE_TRUNCATED_LINE}\n${foot}`;
}

/**
 * The note: everything an approver needs, in words, on the request itself.
 *
 * Which task, who is being paid, who completed it and when, which cycle it is
 * tied to, who set the amount and when, and the marker that lets a human tie
 * the row back to that completion. Bounded to TASK_COMP_MAX_NOTE_LENGTH,
 * because the column clamps there whether this function respects it or not.
 */
export function buildTaskCompNote(args: {
  taskId: number;
  title: unknown;
  dueAt: string;
  amountCents: number;
  reason: unknown;
  payeeUserId: number;
  payeeName?: unknown;
  completedByUserId: number;
  completedByName?: unknown;
  completedAt: string;
  setByUserId?: number | null;
  setByName?: unknown;
  setAt?: string | null;
  warnings?: string[];
}): string {
  const who = (name: unknown, id: number) => {
    const n = clamp(name, NAME_IN_NOTE);
    return n ? `${n} (user #${id})` : `user #${id}`;
  };
  const taskId = Math.trunc(Number(args.taskId) || 0);

  const head: string[] = [];
  head.push(`${TASK_COMP_DESCRIPTION_TAG.charAt(0).toUpperCase()}${TASK_COMP_DESCRIPTION_TAG.slice(1)}. Nobody typed this request.`);
  head.push(`Task: #${taskId} "${clamp(args.title, TITLE_IN_NOTE)}"`);
  head.push(`Pay to: ${who(args.payeeName, args.payeeUserId)} — the CLR the task was assigned to.`);
  head.push(`Completed by: ${who(args.completedByName, args.completedByUserId)} on ${clamp(args.completedAt, STAMP_IN_NOTE)}.`);
  head.push(`Cycle: deadline ${clamp(args.dueAt, STAMP_IN_NOTE)} — the one completion this pay is tied to.`);
  head.push(`Amount: ${formatMoneyCents(args.amountCents)}${args.setByUserId ? ` — set by ${who(args.setByName, Number(args.setByUserId))}` : ""}${args.setAt ? ` on ${clamp(args.setAt, STAMP_IN_NOTE)}` : ""}.`);

  const detail: string[] = [];
  const reason = clamp(args.reason, TASK_COMP_REASON_MAX_LENGTH);
  if (reason) detail.push(`Reason: ${reason}`);
  const list = args.warnings ?? [];
  for (let i = 0; i < list.length; i += 1) detail.push(`WARNING: ${clamp(list[i], WARNING_IN_NOTE)}`);

  const footer = [
    `Still needs approval — this was filed as ${TASK_COMP_FILED_STATUS}, exactly like a hand-typed request.`,
    buildTaskCompMarker(taskCompletionKey(taskId, args.dueAt)),
  ];
  return noteWithinLimit(head, detail, footer);
}

// ── the plan ────────────────────────────────────────────────────────────────

/** The completion row, as the route is about to insert it. */
export interface TaskCompletionRow {
  taskId: number;
  orgId: number;
  dueAt: string;
  completedByUserId: number;
  completedAt: string;
}

export type TaskCompSkipReason =
  | "no-amount"
  | "invalid-amount"
  | "wrong-task"
  | "wrong-org"
  | "no-cycle"
  | "no-payee"
  | "payee-inactive"
  | "payee-status-unknown"
  | "existing-unknown"
  | "invalid-expense-date"
  | "already-filed";

/** One comp_requests row, already priced and already explained. */
export interface TaskCompRequestPlan {
  orgId: number;
  /** comp_requests.user_id — the ASSIGNEE. */
  userId: number;
  /** comp_requests.task_comp_task_id. */
  taskId: number;
  dueAt: string;
  /** comp_requests.task_comp_key. */
  key: string;
  category: string;
  amountCents: number;
  description: string;
  note: string;
  /** The day the work was finished — validated, see validateTaskCompExpenseDate. */
  expenseDate: string;
  status: "pending";
  isReimbursement: number;
  warnings: string[];
}

export interface TaskCompFilingPlan {
  key: string;
  /** Null means file nothing — and `skipped` says why in one word. */
  file: TaskCompRequestPlan | null;
  skipped: TaskCompSkipReason | null;
  /** The sentence to log or show. Empty when a request was planned. */
  skipDetail: string;
  warnings: string[];
}

const NOTHING = (key: string, reason: TaskCompSkipReason, detail: string, warnings: string[] = []): TaskCompFilingPlan =>
  ({ key, file: null, skipped: reason, skipDetail: detail, warnings });

/**
 * Everything one completion should file, and nothing else.
 *
 * Pure: hand it the task, the completion the route is about to insert, and the
 * comp requests that already exist, and it hands back at most one row. It reads
 * nothing and writes nothing.
 *
 * A task with no amount attached returns file: null — the overwhelmingly common
 * case, and it must cost nothing and touch nothing.
 *
 * `existing` and `payeeActive` are REQUIRED, and not only in the type: a caller
 * who omits them — or hands `existing` something that is not an array — gets
 * file: null and a skip reason that names the wiring bug. Each of them is a
 * guard, and a guard that is missing must refuse rather than wave the money
 * through. TASK_COMP_EXISTING_QUERY is the exact query `existing` comes from.
 */
export function planTaskCompFiling(input: {
  task: TaskCompTaskRow;
  completion: TaskCompletionRow;
  /** REQUIRED. Every comp request carrying this TASK id — TASK_COMP_EXISTING_QUERY. */
  existing: TaskCompRequestRow[];
  /** REQUIRED. Whether the payee is an active user. Absent refuses; it is not "yes". */
  payeeActive: boolean;
  payeeName?: unknown;
  completedByName?: unknown;
  setByName?: unknown;
  /** The business date the work is booked to. Defaults to the completion's date. */
  expenseDate?: string | null;
}): TaskCompFilingPlan {
  const task = input?.task;
  const completion = input?.completion;
  const taskId = Math.trunc(Number(task?.id) || 0);
  const dueAt = String(completion?.dueAt ?? "");
  const key = taskCompletionKey(taskId, dueAt);

  // RULE 4, the other half: the amount that applies is the one ON THE TASK at
  // the moment of completion. Read once, here, and copied into the row below —
  // the filed request is a snapshot, so no later edit to clr_tasks can reach it.
  const rawAmount = task?.compAmountCents;
  if (rawAmount === null || rawAmount === undefined) {
    return NOTHING(key, "no-amount", "no pay is attached to this task");
  }
  const amount = validateTaskCompAmountCents(typeof rawAmount === "number" ? rawAmount : Number.NaN);
  if (!amount.ok) {
    // Stored nonsense (a hand-edited row, an older column) never becomes money.
    return NOTHING(key, "invalid-amount", `the pay stored on this task is not a valid amount: ${amount.error ?? ""}`.trim(), [
      `Task #${taskId} carries an unusable pay amount and filed nothing. Fix the task and file by hand if pay is owed.`,
    ]);
  }

  if (Math.trunc(Number(completion?.taskId) || 0) !== taskId) {
    return NOTHING(key, "wrong-task", "the completion is for a different task");
  }
  if (Math.trunc(Number(completion?.orgId) || 0) !== Math.trunc(Number(task?.orgId) || 0)) {
    return NOTHING(key, "wrong-org", "the completion and the task are in different organizations");
  }
  // The cycle IS the identity (rule 5). A blank deadline is not a cycle, and a
  // money row keyed to nothing cannot be checked against a duplicate later.
  if (!dueAt.trim()) {
    return NOTHING(key, "no-cycle", "the completion has no deadline, so there is no cycle to tie the pay to", [
      `Task #${taskId} was worth ${formatMoneyCents(amount.amountCents)} but its completion carries no deadline — nothing was filed. File by hand if pay is owed.`,
    ]);
  }

  // RULE 3. The payee is the assignee, read at completion time.
  const payeeUserId = Math.trunc(Number(task?.assignedUserId) || 0);
  if (!payeeUserId) {
    return NOTHING(key, "no-payee", "the task has no assignee to pay");
  }
  if (input?.payeeActive === false) {
    return NOTHING(key, "payee-inactive", "the assignee is inactive", [
      `Task #${taskId} was worth ${formatMoneyCents(amount.amountCents)} but its assignee is inactive — nothing was filed. File by hand if they are still owed.`,
    ]);
  }
  if (input?.payeeActive !== true) {
    return NOTHING(key, "payee-status-unknown", "the caller did not say whether the assignee is active", [
      `Task #${taskId} filed nothing: C3 was not told whether user #${payeeUserId} is still active, and it will not pay an account it cannot check. This is a wiring bug — pass payeeActive.`,
    ]);
  }

  // RULE 5. The guard is only as good as the list it is handed, so an absent
  // list is a refusal and not an empty one.
  if (!Array.isArray(input?.existing)) {
    return NOTHING(key, "existing-unknown", "the caller did not say which comp requests already exist for this task", [
      `Task #${taskId} filed nothing: C3 was not given the requests already filed for it, so it cannot rule out paying twice. This is a wiring bug — pass existing (see TASK_COMP_EXISTING_QUERY).`,
    ]);
  }
  const already = taskCompAlreadyFiled(input.existing, { taskId, dueAt });
  if (already.length > 0) {
    const how = already.map((r) => `#${r.id ?? "?"} (${String(r.status ?? "unknown")})`).join(", ");
    return NOTHING(key, "already-filed", `this task already filed ${how}`);
  }

  const completedByUserId = Math.trunc(Number(completion?.completedByUserId) || 0);
  const completedAt = String(completion?.completedAt ?? "");

  // The date lands on the money row, so it is checked rather than trusted.
  const rawExpense = String(input?.expenseDate ?? "").trim();
  const expense = validateTaskCompExpenseDate((rawExpense || completedAt).slice(0, 10));
  if (!expense.ok) {
    return NOTHING(key, "invalid-expense-date", `the date this pay would be booked to is not usable: ${expense.error ?? ""}`.trim(), [
      `Task #${taskId} was worth ${formatMoneyCents(amount.amountCents)} but the date it would be booked to ("${(rawExpense || completedAt).slice(0, 40)}") is not a real YYYY-MM-DD date — nothing was filed. File by hand if pay is owed.`,
    ]);
  }

  const warnings: string[] = [];

  // A manager completing on somebody's behalf is allowed, and the money still
  // goes to the assignee — but the approver is told, every time.
  if (completedByUserId && completedByUserId !== payeeUserId) {
    warnings.push(`Completed by user #${completedByUserId} on behalf of the assignee (user #${payeeUserId}). The assignee is being paid.`);
  }
  // RULE 3, reassignment: the amount travelled, and that is said out loud.
  const setFor = Math.trunc(Number(task?.compSetForUserId ?? 0) || 0);
  if (setFor && setFor !== payeeUserId) {
    warnings.push(`This task was reassigned after the pay was attached — it was set for user #${setFor} and is being paid to user #${payeeUserId}.`);
  }
  if (taskRecurs(task?.recurrence)) {
    warnings.push(recurringCompExposure(task?.recurrence, amount.amountCents, task?.scheduleDays).warning);
  }

  return {
    key,
    skipped: null,
    skipDetail: "",
    warnings,
    file: {
      orgId: Math.trunc(Number(task?.orgId) || 0),
      userId: payeeUserId,
      taskId,
      dueAt,
      key,
      category: TASK_COMP_CATEGORY,
      amountCents: amount.amountCents,
      description: buildTaskCompDescription({ title: task?.title, reason: task?.compReason, amountCents: amount.amountCents }),
      note: buildTaskCompNote({
        taskId,
        title: task?.title,
        dueAt,
        amountCents: amount.amountCents,
        reason: task?.compReason,
        payeeUserId,
        payeeName: input?.payeeName,
        completedByUserId,
        completedByName: input?.completedByName,
        completedAt,
        setByUserId: task?.compSetByUserId ?? null,
        setByName: input?.setByName,
        setAt: task?.compSetAt ?? null,
        warnings,
      }),
      expenseDate: expense.date,
      status: TASK_COMP_FILED_STATUS,
      isReimbursement: TASK_COMP_IS_REIMBURSEMENT,
      warnings,
    },
  };
}

/**
 * What the person who just completed the task has to be TOLD when the pay did
 * not file, in the module's own words.
 *
 * planTaskCompFiling already builds the operator-facing half of this — every
 * refusal above sets skipDetail, and the serious ones push a warning as well —
 * but a sentence that only ever reaches console.error is a sentence nobody in
 * the app has read. A CLR who ticked a task believing it paid $50 must not
 * simply be paid nothing in silence, so this is the line the route puts in
 * front of them and into the audit trail.
 *
 * Empty for the one skip that says nothing: "no-amount", the ordinary unpaid
 * task, which is the overwhelming majority of completions. Callers can use the
 * emptiness directly as "there is nothing to tell anyone".
 */
export function taskCompSkipNotice(plan: TaskCompFilingPlan | null | undefined): string {
  const reason = String(plan?.skipped ?? "").trim();
  if (!reason || reason === "no-amount") return "";
  const detail = String(plan?.skipDetail ?? "").trim();
  return `This task carried pay, but NO comp request was filed for it${detail ? ` — ${detail}` : ""}.`
    + " The completion was saved. Nothing is waiting for approval, so tell a manager: the pay has to be filed by hand if it is owed.";
}

/**
 * The comp_requests row a plan becomes once it is inserted — INCLUDING the two
 * columns rule 5 is decided on.
 *
 * Exists so a second run can be fed the first run's output and prove it files
 * nothing the second time: the same check the UNIQUE index and the shared
 * transaction do, but without a database.
 */
export function taskCompRequestRow(plan: TaskCompRequestPlan, id?: number): TaskCompRequestRow {
  return {
    id: id ?? null,
    userId: plan.userId,
    category: plan.category,
    status: plan.status,
    description: plan.description,
    note: plan.note,
    amountCents: plan.amountCents,
    expenseDate: plan.expenseDate,
    taskCompTaskId: plan.taskId,
    taskCompKey: plan.key,
  };
}
