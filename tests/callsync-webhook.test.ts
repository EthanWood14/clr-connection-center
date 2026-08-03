import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { normalizeCallSyncPayload, verifyCallSyncSignature } from "../server/callsync";

test("verifies CallSync HMAC signatures against the untouched request body", () => {
  const raw = Buffer.from(JSON.stringify({ event: "call_logged", payload_id: "evt_1" }));
  const secret = "test-secret";
  const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");

  assert.equal(verifyCallSyncSignature(raw, secret, signature), true);
  assert.equal(verifyCallSyncSignature(raw, secret, `sha256=${signature}`), true);
  assert.equal(verifyCallSyncSignature(Buffer.from("changed"), secret, signature), false);
  assert.equal(verifyCallSyncSignature(raw, secret, undefined), false);
});

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

