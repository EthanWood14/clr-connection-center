/** Ethan requested his own car without changing his excluded-from-stats role. */
export const TV_RACE_GUEST_USER_ID = 1;

type RaceAccount = {
  id?: unknown;
  role?: unknown;
  portal?: unknown;
  isClr?: unknown;
  is_clr?: unknown;
};

/** A display-only exception for the existing owner account, not every admin. */
export function isTvRaceGuest(account: RaceAccount | null | undefined): boolean {
  return !!account && Number(account.id) === TV_RACE_GUEST_USER_ID
    && account.role === "admin"
    && (account.portal == null || account.portal === "c3");
}

/** Role/portal eligibility only; API routes must still verify owner/org/activity. */
export function isTvCarParticipant(account: RaceAccount | null | undefined): boolean {
  if (!account || (account.portal != null && account.portal !== "c3")) return false;
  return account.role === "assistant"
    || (account.role === "admin" && Number(account.isClr ?? account.is_clr) === 1)
    || isTvRaceGuest(account);
}
