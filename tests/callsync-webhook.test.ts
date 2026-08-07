import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCallSyncPayload } from "../server/callsync";

test("normalizes an explicit direct transfer without mistaking call direction for an outcome", () => {
  const result = normalizeCallSyncPayload({
    event: "call_logged",
    payload_id: "evt_transfer",
    data: {
      call_details: {
        call_id: 88231,
        direction: "outgoing",
        status: "completed",
        recording_url: "https://example.test/recording.mp3",
        started_at: "2026-08-03T17:00:00Z",
      },
      disposition: "Warm Transfer",
      caller: { name: "Jane Borrower", phone: "+15551234567" },
      staff: { name: "Ethan Wood", email: "ethan@example.test" },
      loan_officer: { name: "Alex Loan Officer" },
    },
  });

  assert.equal(result.callId, "88231");
  assert.equal(result.outcomeType, "transfer");
  assert.equal(result.transferType, "direct");
  assert.equal(result.borrowerName, "Jane Borrower");
  assert.equal(result.loName, "Alex Loan Officer");
});

test("maps appointment transfers separately from scheduled appointments", () => {
  const appointmentTransfer = normalizeCallSyncPayload({
    event: "ai_analysis",
    data: { call_id: "call-a", ai_analysis: { outcome: "Appointment transfer" } },
  });
  const appointment = normalizeCallSyncPayload({
    event: "caller_updated",
    data: {
      call_id: "call-b",
      labels: ["Appointment booked"],
      appointment: { scheduled_at: "2026-08-04T18:30:00Z" },
    },
  });

  assert.equal(appointmentTransfer.outcomeType, "transfer");
  assert.equal(appointmentTransfer.transferType, "appointment");
  assert.equal(appointment.outcomeType, "appointment");
  assert.equal(appointment.transferType, null);
  assert.equal(appointment.appointmentDatetime, "2026-08-04T18:30:00Z");
});

test("ignores ordinary incoming, outgoing, and completed call events", () => {
  for (const status of ["incoming", "outgoing", "completed", "missed"]) {
    const result = normalizeCallSyncPayload({
      event: "call_logged",
      data: { call_details: { call_id: status, type: status, status } },
    });
    assert.equal(result.outcomeType, null);
  }
});

test("normalizes the internal CallTools outcome contract", () => {
  const result = normalizeCallSyncPayload({
    event: "calltools.outcome",
    event_id: "calltools:hcd:123",
    call_id: "call-123",
    contact_id: 441,
    disposition: "Appointment Transfer",
    conversation: true,
    active_seconds: 317,
    outcome_type: "transfer",
    transfer_type: "appointment",
    agent: { name: "Ethan Wood" },
    borrower: { name: "Jane Borrower", phone: "9495551212" },
    loan_officer: { name: "Alex LO", email: "alex@example.test" },
    occurred_at: "2026-08-03T18:00:00Z",
  });
  assert.equal(result.payloadId, "calltools:hcd:123");
  assert.equal(result.contactKey, "441");
  assert.equal(result.conversation, true);
  assert.equal(result.activeSeconds, 317);
  assert.equal(result.outcomeType, "transfer");
  assert.equal(result.transferType, "appointment");
  assert.equal(result.staffName, "Ethan Wood");
  assert.equal(result.borrowerName, "Jane Borrower");
  assert.equal(result.loEmail, "alex@example.test");
});

test("maps CallTools Follow-Up to an appointment even without a readable date", () => {
  const result = normalizeCallSyncPayload({
    event: "calltools.outcome",
    event_id: "calltools:hcd:follow-up",
    contact_id: 991,
    disposition: "Follow-Up",
    conversation: true,
    notes: "Borrower asked us to reach back out later.",
  });

  assert.equal(result.outcomeType, "appointment");
  assert.equal(result.appointmentDatetime, null);
  assert.equal(result.notes, "Borrower asked us to reach back out later.");
});
