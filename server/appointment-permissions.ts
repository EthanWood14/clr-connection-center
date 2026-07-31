const ACTIVE_APPOINTMENT_TYPES = new Set([
  "appointment",
  "callback_requested",
  "deferral",
  "future_contact",
]);

const SHARED_OVERDUE_EDIT_FIELDS = new Set([
  "outcomeType",
  "transferType",
  "loId",
  "borrowerName",
  "notes",
  "followUpDate",
  "appointmentDatetime",
  "bulkTexter",
  "helperAssisted",
  "conversationNotes",
  "nextSteps",
]);

export function isSharedOverdueAppointment(
  outcome: { outcome_type?: unknown; follow_up_date?: unknown },
  businessDate: string,
): boolean {
  const type = String(outcome?.outcome_type ?? "");
  const scheduledDate = String(outcome?.follow_up_date ?? "").slice(0, 10);
  return ACTIVE_APPOINTMENT_TYPES.has(type)
    && /^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)
    && scheduledDate < businessDate;
}

export function sharedOverdueAppointmentPatch(
  body: unknown,
  allowCompletionDate = false,
): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>)
      .filter(([key]) => SHARED_OVERDUE_EDIT_FIELDS.has(key) || (allowCompletionDate && key === "date")),
  );
}
