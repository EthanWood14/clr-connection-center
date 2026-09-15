import { parseLeadCaptureNotes, resolveLeadSource } from "./lead-capture";

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

/** Seed the original intake form from an existing transfer, not a blank new call. */
export function transferEditInitialValues(outcome: Record<string, any>) {
  const { capture, retainedNotes } = parseLeadCaptureNotes(outcome.conversationNotes, outcome.leadSource);
  return {
    ...Object.fromEntries(TRANSFER_TEXT_FIELDS.map(key => [key, outcome[key] ?? ""])),
    ...capture,
    retainedConversationNotes: retainedNotes,
    date: outcome.date,
    assistantId: outcome.assistantId,
    outcomeType: "transfer" as const,
    transferType: outcome.transferType === "direct" || outcome.transferType === "appointment" ? outcome.transferType : null,
    loId: outcome.loId,
    loaId: outcome.loaId ?? null,
    bulkTexter: outcome.bulkTexter ?? false,
    helperAssisted: outcome.helperAssisted ?? false,
  };
}

/** Only changed information goes back: no new transfer, calendar move or attribution reset. */
export function transferInformationChanges(before: Record<string, any>, values: Record<string, any>) {
  const initial = transferEditInitialValues(before);
  const payload: Record<string, unknown> = {};
  for (const key of TRANSFER_TEXT_FIELDS) {
    if (values[key] === undefined) continue;
    const next = key === "leadSource" ? resolveLeadSource(values as any) ?? "" : values[key] ?? "";
    const previous = key === "leadSource" ? resolveLeadSource(initial) ?? "" : before[key] ?? "";
    if (next !== previous) payload[key] = next;
  }
  for (const key of ["loId", "loaId"] as const) {
    if (values[key] !== undefined && (Number(values[key]) || null) !== (Number(before[key]) || null)) payload[key] = Number(values[key]) || null;
  }
  for (const key of ["bulkTexter", "helperAssisted"] as const) {
    if (values[key] !== undefined && Boolean(values[key]) !== Boolean(before[key])) payload[key] = Boolean(values[key]);
  }
  if (values.transferType !== undefined && values.transferType !== before.transferType) payload.transferType = values.transferType;
  if (Object.keys(payload).length && before.updatedAt != null) payload.expectedUpdatedAt = before.updatedAt;
  return payload;
}
