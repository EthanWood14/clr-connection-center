/**
 * Chris Redoble Retail (pool seat) → Shotgun immediately.
 *
 * Leads assigned in Bonzo to "Chris Redoble Retail (Team Members Only)"
 * (login ktabrizi2OLD@…) are not a real LO claim-window assignment. CLRs
 * should get them as a Shotgun offer the second LeadVault sees them.
 *
 * Match by that Bonzo assignee only — every pipeline on the seat (Meta,
 * Grad+Ungrad, HOT LEADS, etc.). Ethan, 17 Sep 2026.
 */
export const RETAIL_DESK_BONZO_EMAIL = "ktabrizi2old@westcapitallending.com";

/** Display-name fragment Bonzo uses for the pool seat (case-insensitive). */
export const RETAIL_DESK_BONZO_NAME_NEEDLE = "chris redoble retail";

export function isRetailDeskBonzoEmail(email: string | null | undefined): boolean {
  return String(email ?? "").trim().toLowerCase() === RETAIL_DESK_BONZO_EMAIL;
}

export function isRetailDeskBonzoName(name: string | null | undefined): boolean {
  return String(name ?? "").trim().toLowerCase().includes(RETAIL_DESK_BONZO_NAME_NEEDLE);
}

/**
 * True when LeadVault/Bonzo says this lead sits on the Retail pool seat.
 * Prefer email (stable login); fall back to display-name contains.
 */
export function isRetailDeskShotgunLead(
  email: string | null | undefined,
  assigneeName?: string | null | undefined,
): boolean {
  if (isRetailDeskBonzoEmail(email)) return true;
  return isRetailDeskBonzoName(assigneeName);
}
