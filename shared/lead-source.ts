/**
 * Where a lead came from, as a CLR is asked to answer it.
 *
 * Split finer on 11 Sep 2026 (owner). The old list lumped every retail lead
 * together and every single-dialled one together, which meant the two
 * questions actually being asked of this data — is Meta or iLeads feeding
 * retail, and is single dialling landing on new numbers or on people who
 * already responded — could not be answered from it at all.
 *
 * Measured on production before changing it: Single Dialing 442, Retail 277,
 * BulkTexts 202, Responded 181, CallTools 121, and Mojo NEVER PICKED ONCE, so
 * it comes off. The long tail of free text people typed instead is mostly
 * Meta variants — "meta", "Meta Lead Chris", "Retail Intake | Meta > New" —
 * which is the split being asked for, arriving by hand because the list did
 * not offer it.
 */
export const LEAD_SOURCE_OPTIONS = [
  "Retail (iLeads)",
  "Retail (Meta)",
  "CallTools",
  "Single Dialing (New)",
  "Single Dialing (Responded)",
  "Single Dialing (Other)",
  "Bulk Texting",
] as const;

export type LeadSourceOption = (typeof LEAD_SOURCE_OPTIONS)[number];

/**
 * Fold a stored value onto the current list, for anything that GROUPS by
 * source — the office TV does, so without this the wall would show
 * "BulkTexts 202" and "Bulk Texting 3" as two different things.
 *
 * ONLY PURE RENAMES ARE FOLDED. "BulkTexts" and "Bulk Texting" are the same
 * answer spelled two ways, and so are "Responded" and "Single Dialing
 * (Responded)".
 *
 * "Retail" and "Single Dialing" are deliberately NOT folded. Each could now
 * be either of two answers and nothing in the row says which, so mapping
 * them would be inventing the split retrospectively — exactly the thing this
 * change exists to stop us guessing at. They stay under their own names as
 * what they are: 719 rows recorded before the question got sharper.
 *
 * Nothing here rewrites the database. This is a display-time reading of a
 * stored string, so a fold that turns out to be wrong costs a label on a
 * board rather than a record.
 */
const RENAMES: Record<string, LeadSourceOption> = {
  "bulktexts": "Bulk Texting",
  "bulk texts": "Bulk Texting",
  "bulk text": "Bulk Texting",
  "bulk texting": "Bulk Texting",
  "responded": "Single Dialing (Responded)",
  "calltools": "CallTools",
  "call tools": "CallTools",
};

export function canonicalLeadSource(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  return RENAMES[value.toLowerCase()] ?? value;
}

/** True for a value the picker currently offers. */
export function isCurrentLeadSource(raw: unknown): boolean {
  return (LEAD_SOURCE_OPTIONS as readonly string[]).includes(String(raw ?? "").trim());
}
