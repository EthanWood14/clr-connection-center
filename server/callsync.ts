export type CallSyncOutcomeKind = "transfer" | "appointment";
export type CallSyncTransferType = "direct" | "appointment" | null;

export type NormalizedCallSyncOutcome = {
  eventType: string;
  payloadId: string | null;
  callId: string | null;
  outcomeType: CallSyncOutcomeKind | null;
  transferType: CallSyncTransferType;
  disposition: string | null;
  staffName: string | null;
  staffPhone: string | null;
  staffEmail: string | null;
  borrowerName: string | null;
  borrowerPhone: string | null;
  loName: string | null;
  loPhone: string | null;
  loEmail: string | null;
  appointmentDatetime: string | null;
  startedAt: string | null;
  recordingUrl: string | null;
  notes: string | null;
};

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return null;
}

function outcomeFromDisposition(value: string | null): {
  outcomeType: CallSyncOutcomeKind | null;
  transferType: CallSyncTransferType;
} {
  if (!value) return { outcomeType: null, transferType: null };
  const normalized = value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(appointment|scheduled|booked)\s+transfer\b|\btransfer\s+(appointment|scheduled|booked)\b/.test(normalized)) {
    return { outcomeType: "transfer", transferType: "appointment" };
  }
  if (/\b(direct|live|warm|successful|completed)?\s*transfer(red)?\b/.test(normalized)) {
    return { outcomeType: "transfer", transferType: "direct" };
  }
  if (/\b(appointment|appt)\s*(set|scheduled|booked|confirmed)?\b|\b(scheduled|booked)\s+(an?\s+)?(appointment|appt)\b/.test(normalized)) {
    return { outcomeType: "appointment", transferType: null };
  }
  return { outcomeType: null, transferType: null };
}

export function normalizeCallSyncPayload(bodyValue: unknown): NormalizedCallSyncOutcome {
  const body = object(bodyValue);
  const data = object(body.data ?? body.payload);
  const call = object(data.call_details ?? data.call ?? body.call_details ?? body.call);
  const staff = object(data.staff ?? data.employee ?? data.agent ?? body.staff ?? body.employee ?? body.agent);
  const caller = object(data.caller ?? data.contact ?? data.borrower ?? body.caller ?? body.contact ?? body.borrower);
  const identity = object(data.identity ?? body.identity);
  const analysis = object(data.ai_analysis ?? data.analysis ?? body.ai_analysis ?? body.analysis);
  const appointment = object(data.appointment ?? body.appointment);
  const recipient = object(
    data.loan_officer ?? data.lo ?? data.transferred_to ?? data.transfer_recipient ?? data.recipient
    ?? body.loan_officer ?? body.lo ?? body.transferred_to ?? body.transfer_recipient ?? body.recipient,
  );
  const explicitOutcome = firstText(data.outcome_type, body.outcome_type)?.toLowerCase();
  const explicitTransferType = firstText(data.transfer_type, body.transfer_type)?.toLowerCase();

  const labels = [
    ...(Array.isArray(identity.labels) ? identity.labels : []),
    ...(Array.isArray(data.labels) ? data.labels : []),
    ...(Array.isArray(body.labels) ? body.labels : []),
  ].map(text).filter((v): v is string => !!v);

  // Deliberately omit generic call status/type (incoming, outgoing, completed).
  // Only fields intended to describe the business result may create an outcome.
  const dispositionCandidates = [
    data.disposition, data.call_disposition, data.outcome, data.result, data.lead_status,
    body.disposition, body.call_disposition, body.outcome, body.result, body.lead_status,
    call.disposition, call.outcome, call.result,
    analysis.disposition, analysis.outcome, analysis.result, analysis.call_result,
    ...labels,
  ];
  let disposition: string | null = null;
  let classified = { outcomeType: null, transferType: null } as ReturnType<typeof outcomeFromDisposition>;
  for (const candidate of dispositionCandidates) {
    const candidateText = text(candidate);
    const next = outcomeFromDisposition(candidateText);
    if (next.outcomeType) {
      disposition = candidateText;
      classified = next;
      break;
    }
  }
  if (explicitOutcome === "transfer") {
    classified = {
      outcomeType: "transfer",
      transferType: explicitTransferType === "appointment" ? "appointment" : "direct",
    };
    disposition = firstText(data.disposition, body.disposition) ?? disposition;
  } else if (explicitOutcome === "appointment") {
    classified = { outcomeType: "appointment", transferType: null };
    disposition = firstText(data.disposition, body.disposition) ?? disposition;
  }

  const borrowerName = firstText(
    caller.name,
    identity.name,
    data.borrower_name,
    data.prospect_name,
    body.borrower_name,
    body.prospect_name,
  );
  const borrowerPhone = firstText(caller.phone, identity.phone, data.borrower_phone, body.borrower_phone);
  const recordingUrl = firstText(call.recording_url, data.recording_url, body.recording_url);
  const explicitNotes = firstText(
    data.notes, data.call_notes, body.notes, body.call_notes,
    identity.note, analysis.summary, analysis.notes,
  );

  return {
    eventType: firstText(body.event, body.event_type, body.type) ?? "unknown",
    payloadId: firstText(body.payload_id, body.event_id, data.payload_id, data.event_id),
    callId: firstText(call.call_id, call.id, data.call_id, body.call_id),
    outcomeType: classified.outcomeType,
    transferType: classified.transferType,
    disposition,
    staffName: firstText(staff.name, data.staff_name, data.agent_name, body.staff_name, body.agent_name),
    staffPhone: firstText(staff.phone, data.staff_phone, data.agent_phone, body.staff_phone, body.agent_phone),
    staffEmail: firstText(staff.email, data.staff_email, data.agent_email, body.staff_email, body.agent_email),
    borrowerName,
    borrowerPhone,
    loName: firstText(recipient.name, recipient.full_name, data.lo_name, data.loan_officer_name, body.lo_name, body.loan_officer_name),
    loPhone: firstText(recipient.phone, data.lo_phone, body.lo_phone),
    loEmail: firstText(recipient.email, data.lo_email, body.lo_email),
    appointmentDatetime: firstText(
      appointment.datetime, appointment.scheduled_at, appointment.starts_at,
      data.appointment_datetime, data.appointment_at, data.scheduled_at,
      body.appointment_datetime, body.appointment_at, body.scheduled_at,
    ),
    startedAt: firstText(call.started_at, call.start_time, data.occurred_at, body.occurred_at, data.started_at, body.started_at, body.timestamp),
    recordingUrl,
    notes: explicitNotes,
  };
}

export function callSyncOutcomeNotes(value: NormalizedCallSyncOutcome): string {
  const parts = [
    value.notes,
    value.disposition ? `CallSync disposition: ${value.disposition}` : null,
    value.recordingUrl ? `Recording: ${value.recordingUrl}` : null,
    value.callId ? `CallSync call ID: ${value.callId}` : null,
  ].filter((v): v is string => !!v);
  return parts.join("\n");
}
