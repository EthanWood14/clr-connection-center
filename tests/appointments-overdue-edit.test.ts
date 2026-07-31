import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSharedOverdueAppointment,
  sharedOverdueAppointmentPatch,
} from "../server/appointment-permissions";

test("active appointments from an earlier business date are shared overdue edits", () => {
  for (const outcomeType of ["appointment", "callback_requested", "deferral", "future_contact"]) {
    assert.equal(isSharedOverdueAppointment({
      outcome_type: outcomeType,
      follow_up_date: "2026-07-29T09:30",
    }, "2026-07-30"), true);
  }
});

test("today, future, undated, and completed outcomes are not shared overdue edits", () => {
  assert.equal(isSharedOverdueAppointment({ outcome_type: "appointment", follow_up_date: "2026-07-30T08:00" }, "2026-07-30"), false);
  assert.equal(isSharedOverdueAppointment({ outcome_type: "appointment", follow_up_date: "2026-07-31" }, "2026-07-30"), false);
  assert.equal(isSharedOverdueAppointment({ outcome_type: "appointment", follow_up_date: null }, "2026-07-30"), false);
  assert.equal(isSharedOverdueAppointment({ outcome_type: "transfer", follow_up_date: "2026-07-29" }, "2026-07-30"), false);
});

test("shared overdue edits allow appointment details but never reassignment", () => {
  assert.deepEqual(sharedOverdueAppointmentPatch({
    borrowerName: "Updated borrower",
    loId: 42,
    notes: "New notes",
    followUpDate: "2026-08-01T10:00",
    appointmentDatetime: "2026-08-01T10:00",
    outcomeType: "appointment",
    assistantId: 999,
    phoneNumber: "555-0100",
    date: "2026-01-01",
    orgId: 99,
    id: 123,
  }), {
    borrowerName: "Updated borrower",
    loId: 42,
    notes: "New notes",
    followUpDate: "2026-08-01T10:00",
    appointmentDatetime: "2026-08-01T10:00",
    outcomeType: "appointment",
  });
  assert.equal(sharedOverdueAppointmentPatch({ date: "2026-07-30" }, true).date, "2026-07-30");
});
