/**
 * Moving a prospect in Bonzo from one person's book to another's, knowing only
 * a phone number, who holds it now, and who should hold it.
 *
 * The phone alone is NOT enough to identify a prospect and never has been.
 * Several prospects routinely share one — the same borrower sits in more than
 * one loan officer's book — and picking the wrong one moves a stranger's
 * client out of their CRM. So this tool asks for the CURRENT assignee too, and
 * treats it as the identifying half of the key rather than as a nicety:
 *
 *   - it picks the candidate that person actually holds, which resolves an
 *     ambiguous phone that would otherwise be refused outright;
 *   - it REFUSES when nobody on that phone is held by them, because that means
 *     the record already moved, or the phone was mistyped, or the row came from
 *     a stale export — and every one of those is a reason to stop rather than
 *     to guess.
 *
 * IDENTITY IS AN EMAIL, NEVER A NAME. Bonzo display names are not the people
 * they appear to be — "Billy" is Bill Neessen — so a name match would move the
 * wrong book. Everything here compares assigned_user.email, which is what
 * users.bonzo_username holds. See the comment on findProspectByPhone.
 *
 * This file decides; it performs nothing. The Bonzo calls live in the route, so
 * every rule below is testable without touching anybody's CRM.
 */

/** One reassignment: where the prospect is now, and where it should go. */
export interface ReassignRequest {
  phone: string;
  /** The email of whoever should currently hold it. The identifying half. */
  fromEmail: string;
  /** The email of whoever should hold it after. */
  toEmail: string;
}

/** What a phone lookup came back with, reduced to what the decision needs. */
export interface ReassignCandidate {
  id: number;
  name: string;
  assignedUserName: string | null;
  assignedUserEmail: string | null;
}

export type ReassignVerdict =
  | { action: "move"; prospectId: number; prospectName: string; reason: null }
  | { action: "already"; prospectId: number; prospectName: string; reason: string }
  | { action: "refuse"; prospectId: null; prospectName: null; reason: string };

/**
 * Phone numbers are typed by people and stored by several systems, so compare
 * the digits and nothing else. A leading country code is dropped so that
 * +1 (530) 736-5868, 15307365868 and 530-736-5868 are one number.
 */
export function normalizePhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/** Emails are compared case-insensitively and trimmed, never by display name. */
export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** A US phone this tool is willing to act on. Ten digits, nothing clever. */
export function isUsablePhone(value: unknown): boolean {
  return normalizePhone(value).length === 10;
}

/**
 * Decide what to do with one row, given everyone Bonzo returned for its phone.
 *
 * Deliberately total: every path returns a verdict carrying a sentence a person
 * can act on, because the person doing this is moving somebody's client and a
 * refusal they cannot read is a refusal they will work around.
 */
export function planReassign(
  request: ReassignRequest,
  candidates: ReadonlyArray<ReassignCandidate> | null | undefined,
): ReassignVerdict {
  const refuse = (reason: string): ReassignVerdict =>
    ({ action: "refuse", prospectId: null, prospectName: null, reason });

  const from = normalizeEmail(request?.fromEmail);
  const to = normalizeEmail(request?.toEmail);

  if (!isUsablePhone(request?.phone)) return refuse("That is not a ten-digit phone number.");
  if (!from) return refuse("Say who holds it now — without that there is no way to tell which record is meant.");
  if (!to) return refuse("Say who it should go to.");
  if (from === to) return refuse("It is already assigned to that person — there is nothing to move.");

  const rows = (candidates ?? []).filter((c) => c && Number.isFinite(Number(c.id)) && Number(c.id) > 0);
  if (!rows.length) return refuse("No prospect in Bonzo has that phone number.");

  // The identifying step. Among everyone on this phone, the one that person
  // actually holds is the record meant — which is exactly how a phone shared
  // by three books stops being ambiguous.
  const held = rows.filter((c) => normalizeEmail(c.assignedUserEmail) === from);

  if (!held.length) {
    const already = rows.filter((c) => normalizeEmail(c.assignedUserEmail) === to);
    // "It already moved" is only safe to say when the target's record is the
    // ONLY one on this phone. With other books also holding the number, one of
    // THOSE may be the record that was meant, and calling the job done would
    // quietly leave it where it is. See the shared-phone case above.
    if (already.length === 1 && rows.length === 1) {
      return {
        action: "already",
        prospectId: Number(already[0].id),
        prospectName: String(already[0].name ?? ""),
        reason: "Already assigned to that person. Nothing to do.",
      };
    }
    const holders = Array.from(new Set(rows.map((c) => c.assignedUserEmail || "nobody"))).slice(0, 4);
    return refuse(
      `Nobody on that phone is assigned to ${request.fromEmail}. ` +
      `Bonzo has ${rows.length} prospect${rows.length === 1 ? "" : "s"} on it, held by: ${holders.join(", ")}. ` +
      `Either it already moved, or the phone is wrong.`,
    );
  }

  if (held.length > 1) {
    // The same person holding the same phone twice is a duplicate in their own
    // book. Moving one and leaving the other is how a borrower ends up split
    // across two people, so this stops and asks.
    return refuse(
      `${request.fromEmail} holds ${held.length} prospects on that phone (ids ${held.map((c) => c.id).join(", ")}). ` +
      `Merge or delete the duplicate first — moving one of them would split the borrower.`,
    );
  }

  return {
    action: "move",
    prospectId: Number(held[0].id),
    prospectName: String(held[0].name ?? ""),
    reason: null,
  };
}
