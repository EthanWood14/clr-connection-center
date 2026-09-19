/**
 * Who can be selected as the person on a Comp Requests draw (advance).
 *
 * A draw is an advance recorded against someone and later deducted from their
 * net on the payout sheet. Anyone who can earn / file C3 comp — active
 * assistants and admins — can receive one. That includes admins who are NOT
 * flagged isClr (Ethan Wood is seeded admin + is_clr=0): they still file
 * expenses and appear on payouts, so excluding them from the Draws person
 * list was a UI-only bug that blocked taking a draw as yourself.
 *
 * Portal accounts (LAP/LOP) are excluded; they are confined outside C3 pay.
 * Viewers are excluded; they do not receive payouts.
 *
 * Kept as a pure helper so the Comp Requests page, the POST /api/comp/draws
 * guard, and the tests all apply the same line.
 */

export type CompDrawPersonLike = {
  isActive?: unknown;
  is_active?: unknown;
  role?: unknown;
  portal?: unknown;
};

export function isCompDrawPerson(user: CompDrawPersonLike | null | undefined): boolean {
  if (!user) return false;
  const active = user.isActive ?? user.is_active;
  if (!(active === true || active === 1 || active === "1")) return false;
  const portal = String(user.portal ?? "").toLowerCase();
  if (portal === "lap" || portal === "lop") return false;
  const role = String(user.role ?? "");
  return role === "assistant" || role === "admin";
}

/** Sortable list for the Draws person dropdown. */
export function compDrawPeople<T extends CompDrawPersonLike & { name?: unknown; id?: unknown }>(
  users: T[] | null | undefined,
): T[] {
  return (users ?? [])
    .filter((u) => isCompDrawPerson(u))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}
