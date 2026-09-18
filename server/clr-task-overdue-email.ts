/**
 * Who gets the "Overdue CLR task" email.
 *
 * The minute sweep in routes.ts already decides *when* to mail (retry clock,
 * Resend acceptance). This module is only the recipient policy: the assignee
 * always stays on the list, and certain manager addresses are intentionally
 * left off.
 *
 * Chris Redoble (credoble@) asked to stop receiving these — they fire every
 * day a task stays past its deadline ("done late"). Assignment emails, in-app
 * overdue notices, push, check-in digests, and other manager mail are unchanged.
 * Flip the list below (or empty it) to put him back on; that is the whole switch.
 */
export const OVERDUE_TASK_MANAGER_EMAIL_OPT_OUT: readonly string[] = [
  "credoble@westcapitallending.com",
  // Historical alias; storage rewrote accounts to credoble@ but keep both so a
  // stray settings entry cannot re-subscribe him.
  "chris.redoble@westcapitallending.com",
];

function normalizeEmail(address: unknown): string {
  return String(address ?? "").trim().toLowerCase();
}

/** True when this manager address should receive overdue-task email. */
export function shouldEmailOverdueTaskToManager(address: unknown): boolean {
  const email = normalizeEmail(address);
  if (!email.includes("@")) return false;
  return !OVERDUE_TASK_MANAGER_EMAIL_OPT_OUT.includes(email);
}

/**
 * Build the overdue-task recipient list: assignee (if any) plus managers who
 * have not opted out. Order is assignee first, then managers; duplicates drop.
 */
export function overdueTaskEmailRecipients(input: {
  assigneeEmail?: unknown;
  managerEmails?: unknown;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const email = normalizeEmail(raw);
    if (!email.includes("@") || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  };

  push(input?.assigneeEmail);
  const managers = Array.isArray(input?.managerEmails) ? input.managerEmails : [];
  for (const address of managers) {
    if (shouldEmailOverdueTaskToManager(address)) push(address);
  }
  return out;
}
