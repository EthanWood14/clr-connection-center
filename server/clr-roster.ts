// Who counts as a CLR.
//
// CLRs are internal staff. Portal accounts — 'lap' (LO assistants) and 'lop'
// (loan officers) — are people outside the company, and one of them is not a
// person at all: "LAP Shared Access" is the synthetic user the shared-password
// gate signs every LAP device in as. None of them can owe, file, or be measured
// on a CLR's work, so they must never land in a CLR roster.
//
// They were: on 2026-08-28 the shared gate account was mailed an EOD reminder,
// a still-missing follow-up, and three escalating "Overdue EOD Report" notices
// for reports it could never file — at an address that is not a mailbox.
//
// This lives in its own module so tests can import it: importing routes.ts
// starts the whole server (crons, DB, listeners).

export function isPortalAccount(user: any): boolean {
  const portal = String(user?.portal ?? "").toLowerCase();
  return portal === "lap" || portal === "lop";
}

/** Role test only — callers keep their own active / exclude-from-stats filters. */
export function clrRoleMatches(user: any): boolean {
  if (isPortalAccount(user)) return false;
  const role = String(user?.role ?? "");
  return role === "assistant" || (role === "admin" && !!(user?.isClr ?? user?.is_clr));
}

/** SQL twin, for raw roster queries. Matches the convention Shotgun already uses. */
export const CLR_PORTAL_SQL = "(portal IS NULL OR portal = 'c3')";
