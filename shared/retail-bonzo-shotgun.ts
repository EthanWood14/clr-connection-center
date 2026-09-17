/**
 * Retail Bonzo Meta desk leads → Shotgun immediately.
 *
 * New Meta intake leads land on the pool Bonzo seat
 * "Chris Redoble Retail (Team Members Only)" (ktabrizi2OLD@…). That seat is
 * not a real LO claim-window assignment — CLRs should get the lead as a
 * Shotgun offer the second LeadVault sees it, not after three minutes.
 *
 * Scope is Retail Intake | Meta only (Ethan, Sep 2026). Grad+Ungrad stays
 * out — volume is too high for automatic Shotgun.
 */
export const RETAIL_DESK_BONZO_EMAIL = "ktabrizi2old@westcapitallending.com";

/** The one Retail Intake board that auto-publishes to Shotgun. */
export const RETAIL_META_PIPELINE_NAME = "Retail Intake | Meta";

export function isRetailDeskBonzoEmail(email: string | null | undefined): boolean {
  return String(email ?? "").trim().toLowerCase() === RETAIL_DESK_BONZO_EMAIL;
}

/** True for the Retail Intake | Meta board (exact, case-insensitive). */
export function isRetailMetaPipeline(pipeline: string | null | undefined): boolean {
  return String(pipeline ?? "").trim().toLowerCase() === RETAIL_META_PIPELINE_NAME.toLowerCase();
}

/** Pool-seat Meta lead that should skip the claim window and go to Shotgun. */
export function isRetailDeskShotgunLead(
  email: string | null | undefined,
  pipeline: string | null | undefined,
): boolean {
  return isRetailDeskBonzoEmail(email) && isRetailMetaPipeline(pipeline);
}
