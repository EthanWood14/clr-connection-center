/** Editable information only: never change attribution, transfer date or identity. */
export const TRANSFER_TEXT_FIELDS = [
  "borrowerName", "phoneNumber", "notes", "leadSource", "conversationNotes",
  "prequalificationNotes", "loActionPlan", "nextSteps", "leadGoal", "leadTimeframe",
] as const;

export function transferInformationPatch(values: Partial<Record<typeof TRANSFER_TEXT_FIELDS[number], string | null>>) {
  return Object.fromEntries(TRANSFER_TEXT_FIELDS
    .filter(key => values[key] !== undefined)
    .map(key => [key, values[key] ?? ""]));
}
