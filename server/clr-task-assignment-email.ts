/**
 * "You've been given a task" email for the CLR Task Center.
 *
 * Assignment already raises an in-app notification and a web push. This is the
 * email leg, and it lives here rather than in routes.ts for two reasons: the
 * decision of *when not to send* is a policy people will want to change, and a
 * mail problem must never cost a manager the task they just created. Nothing
 * exported here throws, and nothing returns a promise the caller has to await.
 *
 * The message itself (subject line and branded HTML) stays with its siblings in
 * routes.ts and is supplied as `render`, so this module holds only the rules.
 */
import { isUndeliverable } from "./deliverable-email";
import { BUSINESS_DAY_DEFAULT_TZ } from "./business-day";

/**
 * Why a clr_tasks row has the assignee it has. Every path that puts a task on
 * somebody states its reason, so the rule below is a policy someone can read
 * and flip — not an accident of which function happened to call which.
 */
export type TaskAssignmentReason = "created" | "reassigned" | "recurrence_spawn";

/**
 * The reasons worth an email.
 *
 * `recurrence_spawn` is deliberately absent. When the recurrence engine issues
 * the next occurrence of a series, nobody has decided anything — and a daily
 * series would mail that CLR every single morning until they filtered C3 out of
 * their inbox entirely, taking the assignment notices that DO matter with it.
 * Add "recurrence_spawn" to this list to turn those on; that is the whole
 * switch, and `announceSpawnedTaskOccurrence` in routes.ts already feeds every
 * auto-created occurrence through it.
 */
export const TASK_ASSIGNMENT_EMAIL_REASONS: readonly TaskAssignmentReason[] = ["created", "reassigned"];

/** Whether this kind of assignment is announced by email at all. */
export function shouldEmailTaskAssignment(reason: TaskAssignmentReason): boolean {
  return TASK_ASSIGNMENT_EMAIL_REASONS.includes(reason);
}

/**
 * Did a PATCH actually hand the task to somebody else? The task editor submits
 * the whole row, so a retitle, a re-prioritise and a deadline change all arrive
 * carrying the assignee they already had.
 */
export function taskAssigneeChanged(before: unknown, after: unknown): boolean {
  return (Number(before) || 0) !== (Number(after) || 0);
}

/** Why an assignment produced no email. Recorded in the log, never shown. */
export type TaskAssignmentSkip =
  | "auto_spawned_occurrence"
  | "self_assignment"
  | "no_email_address"
  | "unusable_assignment";

export interface TaskAssignmentAssignee {
  id?: number | null;
  name?: string | null;
  /** users.email — NOT NULL in the schema, but not necessarily a mailbox. */
  email?: string | null;
  /** users.timezone (IANA). Blank or unusable falls back to the office's. */
  timezone?: string | null;
}

export interface TaskAssignmentDetails {
  title: string;
  description?: string | null;
  due: Date;
  /** Display name of whoever made the assignment. */
  assignedBy?: string | null;
  /** Their user id — the one thing that can prove a self-assignment. */
  assignedByUserId?: number | null;
}

export interface TaskAssignmentInput {
  reason: TaskAssignmentReason;
  assignee: TaskAssignmentAssignee;
  task: TaskAssignmentDetails;
}

export interface TaskAssignmentDecision {
  send: boolean;
  skip?: TaskAssignmentSkip;
  /** The address that will be mailed, once trimmed and checked. */
  to?: string;
  /** Set when the send was attempted and something went wrong. */
  error?: string;
}

/**
 * The whole policy, in the order the questions are worth asking.
 */
export function decideTaskAssignmentEmail(input: TaskAssignmentInput): TaskAssignmentDecision {
  // 1. An automatic occurrence is not an assignment decision — see
  //    TASK_ASSIGNMENT_EMAIL_REASONS for why, and for how to change it.
  if (!shouldEmailTaskAssignment(input?.reason)) return { send: false, skip: "auto_spawned_occurrence" };

  // 2. Managers are CLRs too, so they can put work on themselves. Mailing
  //    somebody the thing they just typed is noise, not news.
  const assigneeId = Number(input?.assignee?.id ?? 0) || 0;
  const assignerId = Number(input?.task?.assignedByUserId ?? 0) || 0;
  if (assigneeId > 0 && assigneeId === assignerId) return { send: false, skip: "self_assignment" };

  // 3. A real mailbox, or nothing. Shared portal and system logins carry
  //    addresses on domains with no MX — Resend drops the entire message when
  //    one recipient is undeliverable, so those are refused here (see
  //    server/deliverable-email.ts).
  const email = String(input?.assignee?.email ?? "").trim();
  if (!email || isUndeliverable(email)) return { send: false, skip: "no_email_address" };

  return { send: true, to: email };
}

/**
 * A deadline written in a real place's clock.
 *
 * Production runs on UTC, so an unqualified toLocaleString prints a Friday
 * 5:00 PM Pacific deadline as "Saturday, 12:00 AM" — the exact mistake this
 * codebase has made before. The zone is therefore always explicit: the
 * assignee's own, falling back to the office's, and the abbreviation is printed
 * so the reader can tell which clock they are being held to.
 */
export function formatTaskDueLabel(due: Date, timezone?: string | null): string {
  if (!(due instanceof Date) || !Number.isFinite(due.getTime())) return "No deadline set";
  const format = (zone: string) => due.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: zone, timeZoneName: "short",
  });
  const zone = String(timezone ?? "").trim();
  if (zone) {
    try { return format(zone); } catch { /* stored zone is not an IANA name — use the office's */ }
  }
  return format(BUSINESS_DAY_DEFAULT_TZ);
}

export interface TaskAssignmentEmailDeps {
  /** Hands the finished message to the app mailer. May reject; that is fine. */
  send: (message: { to: string; subject: string; html: string }) => unknown;
  /** Builds subject + HTML. Only called once we know we are sending. */
  render: (input: TaskAssignmentInput, dueLabel: string) => { subject: string; html: string };
  /** Where a deliberate skip is recorded. Deliberately given no address. */
  log?: (message: string) => void;
  /** Where a failed send is recorded. Falls back to `log`. */
  onError?: (message: string) => void;
}

/**
 * Notify the assignee, if policy says so. Fire-and-forget by construction:
 * returns the decision synchronously (so callers and tests can see what it
 * did), never throws, and swallows a rejected send into the log. The task row
 * is already committed by the time this runs and must survive a mail outage,
 * an unconfigured API key, and a bad address alike.
 */
export function notifyTaskAssignment(deps: TaskAssignmentEmailDeps, input: TaskAssignmentInput): TaskAssignmentDecision {
  const log = (message: string) => { try { deps?.log?.(message); } catch { /* logging must not throw either */ } };
  const fail = (message: string) => { try { (deps?.onError ?? deps?.log)?.(message); } catch { /* nor here */ } };
  // Identifies the task without putting anybody's address in the log.
  const who = `task=${JSON.stringify(String(input?.task?.title ?? "").slice(0, 60))} user=${Number(input?.assignee?.id ?? 0) || 0}`;

  let decision: TaskAssignmentDecision;
  try {
    decision = decideTaskAssignmentEmail(input);
  } catch (error: any) {
    fail(`[clr-tasks] assignment email skipped (unusable_assignment) ${who}: ${error?.message ?? error}`);
    return { send: false, skip: "unusable_assignment", error: String(error?.message ?? error) };
  }
  if (!decision.send || !decision.to) {
    log(`[clr-tasks] assignment email skipped (${decision.skip}) ${who}`);
    return decision;
  }

  try {
    const dueLabel = formatTaskDueLabel(input.task?.due, input.assignee?.timezone);
    const message = deps.render(input, dueLabel);
    const sent = deps.send({ to: decision.to, subject: message.subject, html: message.html });
    // The mailer queues and resolves later; a failure belongs in the log, not
    // in the response to whoever assigned the task.
    void Promise.resolve(sent).catch((error: any) =>
      fail(`[clr-tasks] assignment email failed ${who}: ${error?.message ?? error}`));
  } catch (error: any) {
    fail(`[clr-tasks] assignment email failed ${who}: ${error?.message ?? error}`);
    return { ...decision, error: String(error?.message ?? error) };
  }
  return decision;
}
