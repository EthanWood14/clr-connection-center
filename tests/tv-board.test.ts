import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyOutcome, detectAppointmentMove, detectMilestones, flattenTips, pickTip,
  rescheduleStampIsStale, whenLabel,
  type OutcomeRow,
} from "../server/tv-board";
import { TRAINING_DAYS } from "../shared/clr-training";
import { appointmentDatetimeFor, ownsAppointmentDatetime, timeColumnsPatch } from "../client/src/lib/appointment-datetime";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/tv.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
// The Outcomes page's edit dialog is the live surface that moves a meeting; the
// Appointments page is where the mirroring convention it follows was set.
const outcomes = readFileSync(join(root, "client/src/pages/outcomes.tsx"), "utf8");
const appointments = readFileSync(join(root, "client/src/pages/appointments.tsx"), "utf8");
// The PATCH is where the wall's flag is written and where it is retracted, so
// most of the wiring below is read out of that one handler rather than the file.
const outcomePatch = routes.slice(
  routes.indexOf(`app.patch("/api/outcomes/:id"`),
  routes.indexOf("// If the appointment time changed"),
);

const row = (over: Partial<OutcomeRow> = {}): OutcomeRow => ({
  id: 7, outcome_type: "transfer", borrower_name: "Maria Alvarez", assistant_name: "Elleine Asuncion",
  lo_name: "Christopher Redoble", created_at: "2026-09-01T20:00:00.000Z", updated_at: null, ...over,
});

test("a transfer is a transfer, and says who it went to", () => {
  const e = classifyOutcome(row())!;
  assert.equal(e.kind, "transfer");
  assert.equal(e.id, "7:transfer");
  assert.equal(e.borrower, "Maria Alvarez");
  assert.equal(e.who, "Elleine Asuncion");
  assert.equal(e.detail, "to Christopher Redoble");
});

test("an appointment is a meeting set; a moved one is REBOOKED", () => {
  const set = classifyOutcome(row({ outcome_type: "appointment", appointment_datetime: "2026-09-03T14:30" }))!;
  assert.equal(set.kind, "appointment");
  assert.match(String(set.detail), /Thu/);
  const moved = classifyOutcome(row({ outcome_type: "appointment", rescheduled: 1, reschedule_datetime: "2026-09-04T09:00" }))!;
  assert.equal(moved.kind, "rescheduled");
  assert.match(String(moved.detail), /^Rebooked to Fri/);
  // Different ids, so the same row can play twice as two different things.
  assert.notEqual(set.id, moved.id);
});

test("each rebooking of the same meeting is its own moment", () => {
  // The client swallows any event id it has already played. Under a bare
  // `${id}:rescheduled` the second move of a meeting lands on the first one's
  // id and never reaches the wall, so the id carries the slot moved TO.
  const first = classifyOutcome(row({ outcome_type: "appointment", rescheduled: 1, reschedule_datetime: "2026-09-04T09:00" }))!;
  const second = classifyOutcome(row({ outcome_type: "appointment", rescheduled: 1, reschedule_datetime: "2026-09-08T16:00" }))!;
  assert.equal(first.id, "7:rescheduled:2026-09-04T09:00");
  assert.notEqual(first.id, second.id);
  // A formatting-only rewrite is the same slot, and must NOT mint a new id —
  // otherwise a later notes edit would replay the rebooking.
  const same = classifyOutcome(row({ outcome_type: "appointment", rescheduled: 1, reschedule_datetime: "2026-09-04 09:00:00" }))!;
  assert.equal(same.id, first.id);
});

test("a transfer given to an LOA says which LOA", () => {
  const withLoa = classifyOutcome(row({ loa_name: "Jasmine Cruz" }))!;
  assert.equal(withLoa.detail, "to Christopher Redoble — LOA Jasmine Cruz");
  // Keyed off HAVING an assistant, never off the LO's name. Only Redoble has
  // LOAs today; the day another LO gets one it must not go quiet.
  const other = classifyOutcome(row({ lo_name: "Alex Thompson", loa_name: "Jasmine Cruz" }))!;
  assert.equal(other.detail, "to Alex Thompson — LOA Jasmine Cruz");
  // Every transfer without one reads exactly as it did before.
  assert.equal(classifyOutcome(row())!.detail, "to Christopher Redoble");
  assert.equal(classifyOutcome(row({ loa_name: "   " }))!.detail, "to Christopher Redoble");
  // The latest-moments row already joins its own fields with "·"; a third dot
  // inside the detail would read as one long chain at TV distance.
  assert.doesNotMatch(String(withLoa.detail), /·/);
});

// ── what counts as a move ───────────────────────────────────────────────────
// The old appointment time is unrecoverable the instant the UPDATE lands, so
// PATCH /api/outcomes/:id decides while it can still see it. This is that
// decision, and it is the only thing standing between "REBOOKED" on the wall
// and a notes edit shouting it.
const appt = (over: Record<string, unknown> = {}) => ({
  outcome_type: "appointment", follow_up_date: "2026-09-03T14:30",
  appointment_datetime: "2026-09-03T14:30", ...over,
});

test("moving a meeting is a move, whichever page moved it", () => {
  // The Appointments page mirrors the new time onto BOTH fields...
  assert.equal(
    detectAppointmentMove(appt(), { followUpDate: "2026-09-05T10:00", appointmentDatetime: "2026-09-05T10:00" }),
    "2026-09-05T10:00",
  );
  // ...and a patch naming followUpDate alone — every move the Outcomes edit
  // dialog made before it started mirroring, and still a legal patch from any
  // caller — has to be a move too. Watching only the appointment field would
  // leave that one silent.
  assert.equal(detectAppointmentMove(appt(), { followUpDate: "2026-09-05T10:00" }), "2026-09-05T10:00");
  // A date-only appointment moving to another day still moved.
  assert.equal(
    detectAppointmentMove(appt({ follow_up_date: "2026-09-03", appointment_datetime: null }), { followUpDate: "2026-09-04" }),
    "2026-09-04",
  );
});

test("a notes-only edit is not a move", () => {
  assert.equal(detectAppointmentMove(appt(), { notes: "left a voicemail" }), null);
  // The Appointments edit dialog posts the whole record, so the unchanged
  // time rides along with the new notes on every save.
  assert.equal(detectAppointmentMove(appt(), {
    notes: "left a voicemail", followUpDate: "2026-09-03T14:30", appointmentDatetime: "2026-09-03T14:30",
  }), null);
});

test("an unchanged time is not a move, however it is spelled", () => {
  // A datetime-local input hands the value back with the seconds trimmed, and
  // a space for the T is the same stamp again. Neither is a rebooking.
  assert.equal(detectAppointmentMove(appt({ follow_up_date: "2026-09-03T14:30:00" }), { followUpDate: "2026-09-03T14:30" }), null);
  assert.equal(detectAppointmentMove(appt(), { followUpDate: "2026-09-03 14:30" }), null);
  // Clearing the time is not a move...
  assert.equal(detectAppointmentMove(appt(), { followUpDate: null, appointmentDatetime: null }), null);
  // ...and neither is putting a first one onto a row that never had one.
  assert.equal(
    detectAppointmentMove(appt({ follow_up_date: null, appointment_datetime: null }), { appointmentDatetime: "2026-09-05T10:00" }),
    null,
  );
});

// The two stored columns DRIFT APART, and the rule has to survive it. The
// Outcomes page's edit dialog used to save a moved meeting with followUpDate
// alone and never touch appointment_datetime, leaving the row holding the new
// time in one column and the original in the other. It mirrors both columns
// now — see "the Outcomes edit dialog no longer drifts the two columns apart"
// below — but every row it moved before that still looks like this, and the
// Appointments edit dialog still rebuilds appointmentDatetime out of the
// follow-up field on every save that carries one (appointments.tsx ~948),
// notes-only saves included.
// This is what such a row actually looks like: booked Thu 2:30, moved by the
// old Outcomes edit dialog to the following Thursday at 11, appointment_datetime
// left on the abandoned slot.
const drifted = (over: Record<string, unknown> = {}) => ({
  outcome_type: "appointment",
  follow_up_date: "2026-09-10T11:00",
  appointment_datetime: "2026-09-03T14:30",
  ...over,
});

test("a notes-only save on a row whose two columns disagree is NOT a move", () => {
  // The exact regression. The Appointments edit dialog posts the whole record,
  // mirroring the follow-up time onto appointmentDatetime; against its OWN
  // stale column that reads as a jump from Thu 2:30 to Thu 11:00, and the wall
  // shouted REBOOKED while Bonzo deleted and recreated the LO's task — for an
  // edit that changed nothing but the notes.
  assert.equal(detectAppointmentMove(drifted(), {
    outcomeType: "appointment",
    notes: "Borrower confirmed by text",
    followUpDate: "2026-09-10T11:00",
    appointmentDatetime: "2026-09-10T11:00",
  }), null);
  // Same row, the quick notes-only mutation, which posts notes alone.
  assert.equal(detectAppointmentMove(drifted(), { notes: "Borrower confirmed by text" }), null);
  // And the mirror written the other way round — a patch that puts the stale
  // appointment time back into view is still a time this meeting already has.
  assert.equal(detectAppointmentMove(drifted(), { appointmentDatetime: "2026-09-03T14:30:00" }), null);
});

test("a genuine move on a drifted row is still a move", () => {
  // Appointments page, quick reschedule: both fields, a time in neither column.
  assert.equal(
    detectAppointmentMove(drifted(), { followUpDate: "2026-09-11T09:00", appointmentDatetime: "2026-09-11T09:00" }),
    "2026-09-11T09:00",
  );
  // Appointments page, full edit dialog: the same mirror plus the rest of the
  // record, so the notes ride along with a time that really did change.
  assert.equal(detectAppointmentMove(drifted(), {
    outcomeType: "appointment", notes: "Moved at the borrower's request",
    followUpDate: "2026-09-11T09:00", appointmentDatetime: "2026-09-11T09:00",
  }), "2026-09-11T09:00");
  // followUpDate on its own — the shape every stored drifted row was moved by,
  // and still a legal patch. The drifted appointment column must not swallow it.
  assert.equal(detectAppointmentMove(drifted(), { followUpDate: "2026-09-11T09:00" }), "2026-09-11T09:00");
  // A drifted row moved to a date-only slot, which the edit dialog sends with
  // appointmentDatetime cleared.
  assert.equal(
    detectAppointmentMove(drifted(), { followUpDate: "2026-09-11", appointmentDatetime: null }),
    "2026-09-11",
  );
});

test("moving a meeting BACK onto the other column's time is the accepted blind spot", () => {
  // Say so plainly, and say the whole of it rather than pretending the only
  // cost is silence: a drifted row moved back to the time still sitting in
  // appointment_datetime looks exactly like the notes-only save above, and
  // nothing can tell them apart from the patch and the row alone.
  assert.equal(
    detectAppointmentMove(drifted(), { followUpDate: "2026-09-03T14:30", appointmentDatetime: "2026-09-03T14:30" }),
    null,
  );
  // What that actually costs, in full. The wall says nothing for the rebooking
  // — and because the PATCH concludes "tell Bonzo" from the same flag, NO SYNC
  // FIRES EITHER: the LO's Bonzo task is left sitting at the abandoned time and
  // the LO is never told the meeting came back. That is the price of never
  // inventing a move, and a false REBOOKED costs more — it deletes and
  // recreates that task at a time nobody chose.
  assert.match(outcomePatch, /\} else if \(body\.rescheduled === 1 \|\| \("rescheduleDatetime" in body && body\.rescheduleDatetime\)\) \{/,
    "Bonzo is told from the wall's own flag, so an undetected move reaches neither");
  // The one half of it that IS repaired lives in the retraction below: the
  // stale stamp does not survive the missed move, so the Latest strip at least
  // stops advertising the time the meeting just left.
  assert.match(outcomePatch, /rescheduleStampIsStale\(existing\.reschedule_datetime, nextAppt, nextFollow\)/);
});

// ── the drift, stopped at its source ───────────────────────────────────────
// The Outcomes edit dialog is the one that moved meetings, so that is the
// mutation these read. (An earlier pass fixed followups.tsx instead, which
// nothing imports and no route reaches — a change with no runtime effect at
// all. Assert against the page that actually runs.)
const outcomesUpdate = outcomes.slice(
  outcomes.indexOf("const updateMutation"),
  outcomes.indexOf("const updateDateMutation"),
);

test("the Outcomes edit dialog no longer drifts the two columns apart", () => {
  // Moving a meeting here wrote followUpDate ALONE, so appointment_datetime
  // kept the ABANDONED time — and every surface that prefers that column went
  // on showing it: the Upcoming Appointments list, the 30-minute reminder cron
  // (routes.ts "Prefer appointment_datetime"), reminders.ts's COALESCE, the EOD
  // digest, and the Bonzo appointment note. All of them read
  // `appointment_datetime || follow_up_date`, so a retyped meeting has to reach
  // both columns.
  //
  // And this dialog IS where an appointment's time is retyped: it has no
  // appointment field of its own, and showFollowUp puts the follow-up input in
  // front of every appointment.
  assert.match(outcomes, /const FOLLOWUP_TYPES = new Set\(\["appointment",/);
  assert.match(outcomes, /const showFollowUp = FOLLOWUP_TYPES\.has\(watchedType\)/);
  // One rule, in one place. The page states no times of its own — it hands the
  // submitted value and the one the row was loaded with to timeColumnsPatch and
  // spreads whatever comes back.
  assert.match(outcomesUpdate, /Object\.assign\(payload, timeColumnsPatch\(\{\s+outcomeType: data\.outcomeType,\s+followUpDate: data\.followUpDate,\s+storedFollowUpDate: before\?\.followUpDate,\s+storedOutcomeType: before\?\.outcomeType,\s+\}\)\);/);
  assert.doesNotMatch(outcomesUpdate, /payload\.appointmentDatetime/,
    "the mirror is the shared rule's business, not a second copy kept in the page");
  assert.doesNotMatch(outcomesUpdate, /followUpDate: fud/,
    "and neither column is asserted unconditionally any more");
  // `before` is the row the dialog was opened on, which is exactly what the
  // form reset its default to — so this asks the same question dirtyFields
  // would, without depending on the form's own bookkeeping.
  assert.match(outcomes, /onSubmit=\{values => editTarget && updateMutation\.mutate\(\{ id: editTarget\.id, data: values, before: editTarget \}\)\}/);
  assert.match(outcomes, /followUpDate: outcome\.followUpDate \?\? "",/,
    "the default the form resets to is the stored value this compares against");

  // A genuine retype still mirrors, on exactly the Appointments page's
  // convention: a stamp with a time component is copied across, and a date-only
  // value CLEARS the appointment column rather than letting a stale time shadow
  // the new date.
  assert.deepEqual(
    timeColumnsPatch({ outcomeType: "appointment", followUpDate: "2026-09-11T09:00", storedFollowUpDate: "2026-09-03T14:30", storedOutcomeType: "appointment" }),
    { followUpDate: "2026-09-11T09:00", appointmentDatetime: "2026-09-11T09:00" },
  );
  assert.deepEqual(
    timeColumnsPatch({ outcomeType: "appointment", followUpDate: "2026-09-11", storedFollowUpDate: "2026-09-03T14:30", storedOutcomeType: "appointment" }),
    { followUpDate: "2026-09-11", appointmentDatetime: null },
  );
  assert.match(appointments, /payload\.appointmentDatetime =\s+fud && typeof fud === "string" && fud\.includes\("T"\) \? fud : null;/);
  assert.equal(appointmentDatetimeFor("2026-09-11T09:00"), "2026-09-11T09:00");
  assert.equal(appointmentDatetimeFor("2026-09-11"), null);
  // A mirrored move is still a move: the server sees a time in neither column.
  assert.equal(
    detectAppointmentMove(drifted(), timeColumnsPatch({
      outcomeType: "appointment", followUpDate: "2026-09-11T09:00", storedFollowUpDate: "2026-09-10T11:00", storedOutcomeType: "appointment",
    })),
    "2026-09-11T09:00",
  );
  // And a mirrored move leaves nothing to drift: both columns name one slot.
  assert.equal(rescheduleStampIsStale("2026-09-11T09:00", "2026-09-11T09:00", "2026-09-11T09:00"), false);
});

test("an Outcomes edit of a NON-appointment never touches appointment_datetime", () => {
  // This dialog edits every outcome type, and several of them carry a follow-up
  // date — callbacks, deferrals, future contacts. Only an appointment owns
  // appointment_datetime; writing a callback's date there would invent an
  // appointment time on the wall, in both reminder crons and in the EOD digest.
  assert.equal(ownsAppointmentDatetime("appointment"), true);
  for (const t of ["callback_requested", "deferral", "future_contact", "transfer", "fell_through", "", null, undefined]) {
    assert.equal(ownsAppointmentDatetime(t), false, `${t} does not own the appointment column`);
    assert.deepEqual(
      timeColumnsPatch({ outcomeType: t, followUpDate: "2026-09-11T09:00", storedFollowUpDate: "2026-09-03T14:30", storedOutcomeType: t }),
      { followUpDate: "2026-09-11T09:00" },
      `${t} moves its own date and nothing else`,
    );
    // CHANGE, not presence, on this half of the mirror too. Every case above
    // hands the rule a follow-up that HAS a value, so the whole non-appointment
    // branch could be re-gated on `next &&` — reinstating exactly the bug the
    // appointment branch was fixed for — and all of them still passed. Clearing
    // a callback's date is a decision the CLR made, and it has to be sent.
    assert.deepEqual(
      timeColumnsPatch({ outcomeType: t, followUpDate: "", storedFollowUpDate: "2026-09-03T14:30", storedOutcomeType: t }),
      { followUpDate: null },
      `${t} must be able to have its follow-up cleared`,
    );
    assert.deepEqual(
      timeColumnsPatch({ outcomeType: t, followUpDate: null, storedFollowUpDate: "2026-09-03T14:30", storedOutcomeType: t }),
      { followUpDate: null },
    );
  }
  // The gate is INSIDE the rule, which is the only thing that writes the column
  // — asserted by what comes back, not by which line number the guard sits on.
  // (An index comparison proves nothing here: a write moved out from under its
  // guard still comes after it.)
  assert.match(outcomesUpdate, /outcomeType: data\.outcomeType,/);
  assert.doesNotMatch(outcomesUpdate, /appointmentDatetime/,
    "the page never names the column; ownsAppointmentDatetime decides");
  // The type is the one being SAVED, not the one the row had: an edit that
  // converts an appointment into a transfer has stopped owning the column, and
  // the wall's own rules stop at "is this still an appointment" too.
  assert.equal(
    detectAppointmentMove(drifted(), { outcomeType: "transfer", followUpDate: "2026-09-11T09:00" }),
    null,
  );
  assert.equal(
    detectAppointmentMove({ outcome_type: "callback_requested", follow_up_date: "2026-09-03T14:30" }, { followUpDate: "2026-09-11T09:00" }),
    null,
  );
});

test("clearing an Outcomes follow-up takes the appointment column with it", () => {
  // The old gate was presence — `&& fud` — so emptying the field wrote nothing
  // at all, and the ABANDONED time stayed in appointment_datetime for every
  // surface that prefers that column to read. Exactly the drift this mirror
  // exists to stop, arriving from the clearing side. A field the CLR emptied is
  // a decision, and it is told to both columns.
  const cleared = timeColumnsPatch({ outcomeType: "appointment", followUpDate: "", storedFollowUpDate: "2026-09-10T11:00", storedOutcomeType: "appointment" });
  assert.deepEqual(cleared, { followUpDate: null, appointmentDatetime: null });
  assert.deepEqual(
    timeColumnsPatch({ outcomeType: "appointment", followUpDate: null, storedFollowUpDate: "2026-09-03T14:30", storedOutcomeType: "appointment" }),
    { followUpDate: null, appointmentDatetime: null },
  );
  // Wiping a time is not moving it, so no REBOOKED is invented...
  assert.equal(detectAppointmentMove(drifted(), cleared), null);
  assert.equal(detectAppointmentMove(appt(), cleared), null);
  // ...and naming both columns is what puts the save into the PATCH's wipe
  // branch, which drops the stale reschedule stamp rather than leaving
  // reminders.ts nagging about a meeting that no longer has a time.
  assert.match(outcomePatch, /&& \("appointmentDatetime" in body \|\| "followUpDate" in body\)/);
  assert.match(outcomePatch, /if \(!normalizeAppointmentTime\(nextAppt\) && !normalizeAppointmentTime\(nextFollow\)\) \{/);
});

test("an unrelated Outcomes save writes neither time column", () => {
  // The dialog posts the whole record, so a notes or borrower-name save carries
  // the follow-up field too. Under a presence gate that save re-asserted the
  // follow-up over appointment_datetime — which is where CallSync writes, and
  // where it writes ALONE — so an edit about the notes silently reverted a
  // CallSync-corrected time. Nothing revealed it: writing back a time the row
  // already holds is not a move, so the wall stayed quiet and no Bonzo sync
  // fired. Unchanged means the payload says nothing about either column.
  const unchanged = timeColumnsPatch({ outcomeType: "appointment", followUpDate: "", storedFollowUpDate: null, storedOutcomeType: "appointment" });
  assert.deepEqual(unchanged, {});
  assert.deepEqual(
    timeColumnsPatch({ outcomeType: "appointment", followUpDate: "2026-09-10T11:00", storedFollowUpDate: "2026-09-10T11:00", storedOutcomeType: "appointment" }),
    {}, "a value that came back unedited is not an instruction about anything",
  );
  const callsyncRow = { outcome_type: "appointment", follow_up_date: null, appointment_datetime: "2026-09-05T10:00" };
  const notesOnly = { ...unchanged, notes: "left a voicemail", borrowerName: "Maria Alvarez" };
  assert.equal(detectAppointmentMove(callsyncRow, notesOnly), null);
  assert.equal(detectAppointmentMove(drifted(), notesOnly), null);
  // Both columns keep what they had: every branch that can rewrite a time is
  // gated on the patch naming one.
  assert.match(outcomePatch, /const nextAppt = "appointmentDatetime" in body \? body\.appointmentDatetime : existing\.appointment_datetime;/);
  assert.match(outcomePatch, /const nextFollow = "followUpDate" in body \? body\.followUpDate : existing\.follow_up_date;/);
  // ...including the reminder clock, which no longer restarts for a save that
  // moved no meeting.
  assert.match(routes, /if \("appointmentDatetime" in body \|\| "followUpDate" in body \|\| "assistantId" in body\) \{/);
  // And the row shape this protects: CallSync books into appointment_datetime
  // and never writes follow_up_date, so that column is the corrected one.
  const callsyncInsert = routes.slice(
    routes.indexOf("const inserted = db.prepare(`INSERT INTO lead_outcomes"),
    routes.indexOf("outcomeId = Number(inserted.lastInsertRowid);"),
  );
  assert.match(callsyncInsert, /appointment_datetime/);
  assert.doesNotMatch(callsyncInsert, /follow_up_date/,
    "the column an unrelated save must not overwrite");
});

// ── healing the rows that already drifted ──────────────────────────────────
test("a move BACK onto a drifted row's stale column retracts the claim instead of showing it", () => {
  // A legacy row, moved by the old Outcomes edit dialog: follow_up_date on the
  // new Thursday at 11, appointment_datetime still on the original Thu 2:30,
  // and the stamp from that move sitting on the row.
  const legacy = drifted({ rescheduled: 1, reschedule_datetime: "2026-09-10T11:00" });
  // While the claim is live it names a slot the row is genuinely holding.
  assert.equal(rescheduleStampIsStale("2026-09-10T11:00", legacy.appointment_datetime, legacy.follow_up_date), false);
  // Now move it BACK onto Thu 2:30 — the time appointment_datetime never let
  // go of. Not detectable as a move, by design.
  const back = { followUpDate: "2026-09-03T14:30", appointmentDatetime: "2026-09-03T14:30" };
  assert.equal(detectAppointmentMove(legacy, back), null);
  // Left alone the stamp SURVIVES, and the wall does not go quiet — it goes
  // wrong. classifyOutcome renders `reschedule_datetime || appointment_datetime`,
  // so the Latest strip advertises the slot the meeting just walked away from.
  const stillClaiming = classifyOutcome(row({
    outcome_type: "appointment", rescheduled: 1,
    reschedule_datetime: "2026-09-10T11:00", appointment_datetime: "2026-09-03T14:30",
  }))!;
  assert.equal(stillClaiming.kind, "rescheduled");
  assert.match(String(stillClaiming.detail), /Rebooked to Thu 11:00 AM/, "the ABANDONED slot, on the wall");
  // So the PATCH retracts it: the stamp matches neither column the patch leaves.
  assert.equal(rescheduleStampIsStale("2026-09-10T11:00", back.appointmentDatetime, back.followUpDate), true);
  // ...and the row then reads as the plain appointment it actually is.
  const retracted = classifyOutcome(row({
    outcome_type: "appointment", rescheduled: null,
    reschedule_datetime: null, appointment_datetime: "2026-09-03T14:30",
  }))!;
  assert.equal(retracted.kind, "appointment");
  assert.match(String(retracted.detail), /Thu 2:30 PM/);
});

test("the retraction can only ever RETRACT a claim, never mint one", () => {
  // A stamp naming a slot either column still holds is a live claim.
  assert.equal(rescheduleStampIsStale("2026-09-10T11:00", "2026-09-10T11:00", "2026-09-10T11:00"), false);
  assert.equal(rescheduleStampIsStale("2026-09-10T11:00", null, "2026-09-10T11:00"), false);
  assert.equal(rescheduleStampIsStale("2026-09-10T11:00", "2026-09-10T11:00", null), false);
  // Same slot typed differently is the same slot — a seconds-trimming rewrite
  // must not read as an abandoned time.
  assert.equal(rescheduleStampIsStale("2026-09-10 11:00:00", "2026-09-10T11:00", null), false);
  // No stamp is not a stale stamp. This is the half that matters: nothing here
  // may ever be the reason a REBOOKED appears.
  assert.equal(rescheduleStampIsStale(null, "2026-09-03T14:30", "2026-09-03T14:30"), false);
  assert.equal(rescheduleStampIsStale("", "2026-09-03T14:30", null), false);
  assert.equal(rescheduleStampIsStale(undefined, null, null), false);
  // Wired into the PATCH, and only where a move was NOT detected.
  assert.match(outcomePatch, /reschedule_datetime, org_id/, "the PATCH has to be able to SEE the stored stamp");
  assert.match(outcomePatch, /!\("rescheduleDatetime" in body\)\s*\r?\n\s*&& rescheduleStampIsStale\(existing\.reschedule_datetime, nextAppt, nextFollow\)/,
    "an explicit stamp in the patch is the caller's, not ours to drop");
  const retract = outcomePatch.slice(
    outcomePatch.indexOf("rescheduleStampIsStale("),
    outcomePatch.indexOf("// ── two different questions"),
  );
  assert.match(retract, /body\.rescheduled = null;/);
  assert.match(retract, /body\.rescheduleDatetime = null;/);
  assert.doesNotMatch(retract, /body\.rescheduled = 1/, "retraction only — every write in this branch is null");
});

test("a first-time set is not a move on the wall, but Bonzo still hears it", () => {
  // An appointment logged with no time at all, later given one. Not a
  // rebooking: the row already played BOOKED! when it was logged, and there is
  // no old slot to have moved from.
  const dateless = { outcome_type: "appointment", follow_up_date: null, appointment_datetime: null };
  assert.equal(detectAppointmentMove(dateless, { appointmentDatetime: "2026-09-05T10:00" }), null);
  assert.equal(detectAppointmentMove(dateless, { followUpDate: "2026-09-05T10:00", appointmentDatetime: "2026-09-05T10:00" }), null);
  assert.equal(detectAppointmentMove(dateless, { followUpDate: "2026-09-05" }), null);
  // Empty strings are dateless too — PATCH nullifies "" before it gets here,
  // but the rule must not depend on that.
  assert.equal(detectAppointmentMove({ outcome_type: "appointment", follow_up_date: "", appointment_datetime: "" }, { followUpDate: "2026-09-05T10:00" }), null);

  // ...and yet the LO must get their task. Bonzo's condition is deliberately
  // NOT the wall's: syncAppointmentToBonzo only creates a task when the
  // appointment has a datetime, so an appointment logged without one has none,
  // and this patch is the first moment it can exist. Dropping the old
  // "appointmentDatetime is present" term from the Bonzo condition was right
  // for notes-only saves and took this path down with it.
  const patch = routes.slice(routes.indexOf(`app.patch("/api/outcomes/:id"`), routes.indexOf("// If the appointment time changed"));
  assert.match(patch, /const gainedFirstTime = stillAnAppointment/);
  assert.match(patch, /&& !movedTo/, "a move is the other rule — these two must never both fire");
  assert.match(patch, /&& !normalizeAppointmentTime\(existing\.appointment_datetime\)\s*\r?\n\s*&& !normalizeAppointmentTime\(existing\.follow_up_date\)/,
    "a first time means NEITHER column had one");
  assert.match(patch, /\} else if \(gainedFirstTime\) \{/);
  assert.match(patch, /syncAppointmentResultToBonzo\(id, "scheduled", setDt\)/);
  // The wall's flag is settled before this and must stay settled: nothing in
  // the first-time path may write rescheduled.
  const firstTime = patch.slice(patch.indexOf("const gainedFirstTime"), patch.indexOf("const outcome = storage.updateLeadOutcome"));
  assert.doesNotMatch(firstTime, /body\.rescheduled\s*=/, "a first-time set must never light the wall");
  // And the note the LO reads must not claim a meeting moved when none did.
  const mirror = routes.slice(routes.indexOf("async function syncAppointmentResultToBonzo"));
  assert.match(mirror, /"transferred" \| "fell_through" \| "rescheduled" \| "scheduled"/);
  assert.match(mirror, /const moved = result === "rescheduled";/);
  assert.match(mirror, /Appointment TIME SET/);
  // Either way the task lands at the new time — a first-time set simply has no
  // old one to delete.
  assert.match(mirror, /if \(o\.bonzo_task_id\) await deleteTask\(o\.bonzo_task_id\);/);
  assert.match(mirror, /details: moved \? `Rescheduled in C3 by \$\{by\}\.` : `Time set in C3 by \$\{by\}\.`/);
});

test("a save that sets the first time AND edits the notes reaches Bonzo with both", () => {
  // The time branches are `else if`s standing ahead of the notes branch, so a
  // save that did both fell into the time branch and lost the notes entirely:
  // the task the LO opens carries no context, and the new text never reached
  // the prospect at all. Both branches have the gap; ONE mechanism closes both
  // rather than the same tail copied twice.
  assert.match(outcomePatch, /const withNotes = \(p: Promise<void>\): Promise<void> =>\s*\r?\n\s*"notes" in body \? p\.then\(\(\) => syncAppointmentNotesToBonzo\(id\)\) : p;/);
  assert.match(outcomePatch, /withNotes\(syncAppointmentResultToBonzo\(id, "rescheduled", newDt\)\)/);
  assert.match(outcomePatch, /withNotes\(syncAppointmentResultToBonzo\(id, "scheduled", setDt\)\)/);
  // Chained, so the result note lands first and the notes follow it — and they
  // follow it as the SAME entry every other notes edit produces, so the LO
  // reads one shape of note rather than a second invented one.
  assert.equal((outcomePatch.match(/syncAppointmentNotesToBonzo\(id\)/g) ?? []).length, 2,
    "once in the shared mechanism, once in the plain notes-only branch");
  assert.match(
    routes.slice(routes.indexOf("async function syncAppointmentNotesToBonzo")),
    /notesToBonzoHtml\(text, \{ title: `📝 Appointment notes updated in C3 by \$\{clr\?\.name \?\? "a CLR"\}` \}\)/,
  );
  // The plain notes-only branch stays exactly where it was, for saves that
  // touch nothing but the notes.
  assert.match(outcomePatch, /\} else if \("notes" in body\) \{/);
});

test("completing an appointment is not a move", () => {
  // Becoming a transfer or a fall-through is its own moment on the wall; a
  // date riding along in the same patch must not turn it into a rebooking.
  assert.equal(detectAppointmentMove(appt(), { outcomeType: "transfer", transferType: "direct", followUpDate: "2026-09-05T10:00" }), null);
  assert.equal(detectAppointmentMove(appt(), { outcomeType: "fell_through", followUpDate: "2026-09-05T10:00" }), null);
  // And a row that was never an appointment cannot be rebooked.
  assert.equal(detectAppointmentMove({ outcome_type: "transfer", follow_up_date: "2026-09-03T14:30" }, { followUpDate: "2026-09-05T10:00" }), null);
});

test("the move is written at edit time, and Bonzo agrees with the wall", () => {
  // Nothing else in the codebase writes lead_outcomes.rescheduled, and the old
  // time is gone one statement after the UPDATE — the PATCH is the only place
  // that can still see what the meeting moved FROM.
  // Read out of the handler itself, not the file: "the PATCH does this" is a
  // claim about where the code is, and a whole-file match would hold just as
  // well with any of it stranded somewhere that never runs.
  assert.match(outcomePatch, /SELECT assistant_id, outcome_type, follow_up_date, appointment_datetime,\s*\r?\n\s*reschedule_datetime, org_id/,
    "reschedule_datetime rides along so a stamp that has gone stale can be retracted");
  assert.match(outcomePatch, /const movedTo = detectAppointmentMove\(existing, body\);/);
  assert.match(outcomePatch, /if \(!body\.rescheduled\) body\.rescheduled = 1;/);
  // The Bonzo mirror concludes "rescheduled" from that same flag. Its old test
  // — "appointmentDatetime is present and non-empty" — fired on unchanged
  // times and never fired for the Outcomes page.
  assert.match(outcomePatch, /\} else if \(body\.rescheduled === 1 \|\| \("rescheduleDatetime" in body && body\.rescheduleDatetime\)\) \{/);
  // This one stays on the whole file on purpose: a negative is strongest with
  // the widest scope — the dropped term must be gone from routes.ts entirely.
  assert.doesNotMatch(routes, /\("appointmentDatetime" in body && body\.appointmentDatetime\)/);
  // A time wiped rather than moved drops the flag: reminders.ts COALESCEs
  // reschedule_datetime into the date it schedules against, so a stamp left
  // on a now-dateless appointment would nag about a meeting with no time.
  assert.match(outcomePatch, /if \(!normalizeAppointmentTime\(nextAppt\) && !normalizeAppointmentTime\(nextFollow\)\) \{/);
  assert.match(outcomePatch, /body\.rescheduleDatetime = null;/);
  assert.match(
    readFileSync(join(root, "server/reminders.ts"), "utf8"),
    /NULLIF\(lo\.reschedule_datetime, ''\)/,
    "if reminders stops reading the column, the wipe rule above can go",
  );
  // And the feed cannot name an LOA it never selected.
  assert.match(routes, /loa\.full_name AS loa_name/);
  assert.match(routes, /LEFT JOIN loan_officer_assistants loa ON loa\.id = o\.loa_id/);
});

test("a fell-through WITH a reason is a missed appointment; without one it is just a fall-through", () => {
  const missed = classifyOutcome(row({ outcome_type: "fell_through", missed_reason: "No-show, phone off" }))!;
  assert.equal(missed.kind, "missed_appointment");
  assert.equal(missed.detail, "No-show, phone off");
  const plain = classifyOutcome(row({ outcome_type: "fell_through", missed_reason: "" }))!;
  assert.equal(plain.kind, "fell_through");
  assert.equal(plain.detail, "with Christopher Redoble");
});

test("the wall only shouts about the moments worth looking up for", () => {
  for (const t of ["no_answer", "wrong_number", "deferral", "not_interested", "other", "future_contact"]) {
    assert.equal(classifyOutcome(row({ outcome_type: t })), null, `${t} must be silent`);
  }
});

test("the event time is the UPDATE time when there is one", () => {
  // An appointment marked missed is an edit; created_at would put it hours or
  // days in the past and the TV would think it had already played.
  const e = classifyOutcome(row({ outcome_type: "fell_through", missed_reason: "late", updated_at: "2026-09-02T01:00:00.000Z" }))!;
  assert.equal(e.at, "2026-09-02T01:00:00.000Z");
});

test("a blank borrower or CLR still reads as a sentence", () => {
  const e = classifyOutcome(row({ borrower_name: "  ", assistant_name: null, lo_name: null }))!;
  assert.equal(e.borrower, "A borrower");
  assert.equal(e.who, "A CLR");
  assert.equal(e.detail, null);
});

test("whenLabel reads a wall-clock stamp in the office's own time", () => {
  // "2026-09-03T14:30" carries no zone, so it is 2:30 PM as typed.
  assert.match(String(whenLabel("2026-09-03T14:30")), /2:30\s?PM/);
  assert.equal(whenLabel(null), null);
  assert.equal(whenLabel("garbage"), "garbage", "unparseable text is shown rather than dropped");
});

// ── milestones ──────────────────────────────────────────────────────────────
const person = (over: Partial<Parameters<typeof detectMilestones>[0]["people"][number]> = {}) => ({
  id: 1, name: "Tommy Le", transfersToday: 0, transfersWeek: 0, appointmentsToday: 0, appointmentsWeek: 0,
  goalTransfersWeekly: 0, goalAppointmentsWeekly: 0, bestDayBefore: 0, ...over,
});
const input = (people: ReturnType<typeof person>[]) => ({ today: "2026-09-01", weekStart: "2026-08-31", people });

test("milestone ids are stable across polls, so each plays exactly once", () => {
  const a = detectMilestones(input([person({ transfersToday: 26 }), person({ id: 2, name: "Linda", transfersToday: 25 })]));
  const b = detectMilestones(input([person({ transfersToday: 27 }), person({ id: 2, name: "Linda", transfersToday: 25 })]));
  const ida = a.find((m) => m.kind === "team_day")!.id;
  const idb = b.find((m) => m.kind === "team_day")!.id;
  assert.equal(ida, "team-day-50-2026-09-01");
  assert.equal(idb, ida, "51 and 52 both sit on the 50 step; same id, no re-celebration");
});

test("a bigger number crosses to a bigger step and a bigger celebration", () => {
  const m = detectMilestones(input([person({ transfersToday: 100 })]));
  const day = m.find((x) => x.kind === "team_day")!;
  assert.equal(day.headline, "100 transfers today");
  assert.equal(day.weight, 3);
  const small = detectMilestones(input([person({ transfersToday: 10 })])).find((x) => x.kind === "team_day")!;
  assert.equal(small.weight, 2);
  assert.equal(detectMilestones(input([person({ transfersToday: 9 })])).some((x) => x.kind === "team_day"), false);
});

test("a personal best needs a real record to beat", () => {
  // Beating a two-transfer record by one is not a moment.
  assert.equal(detectMilestones(input([person({ transfersToday: 3, bestDayBefore: 2 })])).some((m) => m.kind === "personal_best"), false);
  assert.equal(detectMilestones(input([person({ transfersToday: 5, bestDayBefore: 5 })])).some((m) => m.kind === "personal_best"), false, "equal is not a best");
  const pb = detectMilestones(input([person({ transfersToday: 6, bestDayBefore: 5 })])).find((m) => m.kind === "personal_best")!;
  assert.ok(pb);
  assert.match(pb.detail, /Old record was 5/);
  assert.equal(pb.weight, 3);
});

test("hitting a weekly goal is named, and only when there is a goal", () => {
  const hit = detectMilestones(input([person({ transfersWeek: 12, goalTransfersWeekly: 12 })]));
  assert.ok(hit.some((m) => m.kind === "goal_transfers" && m.id === "goal-transfers-1-2026-08-31"));
  const noGoal = detectMilestones(input([person({ transfersWeek: 40, goalTransfersWeekly: 0 })]));
  assert.equal(noGoal.some((m) => m.kind === "goal_transfers"), false);
});

test("heaviest milestone first, so a short queue plays the right one", () => {
  const m = detectMilestones(input([person({ transfersToday: 10, transfersWeek: 12, goalTransfersWeekly: 12, bestDayBefore: 4 })]));
  assert.ok(m.length >= 3);
  for (let i = 1; i < m.length; i += 1) assert.ok(m[i - 1].weight >= m[i].weight);
});

// ── tips ────────────────────────────────────────────────────────────────────
test("every step of the plan is a tip, and the walk visits all of them", () => {
  const tips = flattenTips(TRAINING_DAYS);
  const expected = TRAINING_DAYS.reduce((n, d) => n + d.morning.length + d.afternoon.length + (d.eod ? 1 : 0), 0);
  assert.equal(tips.length, expected);
  const seen = new Set<number>();
  for (let s = 0; s < tips.length; s += 1) seen.add(tips.indexOf(pickTip(s, tips)!));
  assert.equal(seen.size, tips.length, "consecutive seeds must reach every tip before repeating");
  // Deterministic: two TVs with the same seed show the same tip.
  assert.equal(pickTip(41, tips), pickTip(41, tips));
  assert.equal(pickTip(3, []), null);
});

test("consecutive seeds do not linger in day one", () => {
  const tips = flattenTips(TRAINING_DAYS);
  const days = [0, 1, 2, 3].map((s) => pickTip(s, tips)!.day);
  assert.ok(new Set(days).size >= 3, `four seeds should span days, got ${days.join(",")}`);
});

// ── wiring ──────────────────────────────────────────────────────────────────
test("the TV has no session and can only read", () => {
  assert.match(routes, /if \(req\.path\.startsWith\("\/tv\/"\)\) return next\(\);/);
  // Cut at the /pages route, not at the next section: the board pages are a
  // separate endpoint on purpose, and their queries are not the fast feed's.
  const feed = routes.slice(routes.indexOf('app.get("/api/tv/:token/feed"'), routes.indexOf('app.get("/api/tv/:token/pages"'));
  assert.match(feed, /tvLink\(req\.params\.token\)/);
  // The revocation check is in the helper every TV route resolves through.
  const helper = routes.slice(routes.indexOf("function tvLink("), routes.indexOf('app.get("/api/tv-links"'));
  assert.match(helper, /revoked_at IS NULL/);
  assert.match(helper, /^\s*if \(!\/\^\[A-Za-z0-9_-\]\{16,64\}\$\/\.test/m, "the token shape is checked before any lookup");
  // Read-only: the only write is bookkeeping on the link itself.
  const writes = feed.match(/\b(INSERT|UPDATE|DELETE)\b/g) ?? [];
  assert.deepEqual(writes, ["UPDATE"], "the feed must not write to anything but its own use counter");
  assert.match(feed, /UPDATE tv_display_links SET use_count/);
  assert.match(feed, /org_id/, "org-scoped");
});

test("events come from an updated_at cursor, so a miss can animate", () => {
  // Cut at the /pages route, not at the next section: the board pages are a
  // separate endpoint on purpose, and their queries are not the fast feed's.
  const feed = routes.slice(routes.indexOf('app.get("/api/tv/:token/feed"'), routes.indexOf('app.get("/api/tv/:token/pages"'));
  assert.match(feed, /COALESCE\(o\.updated_at, o\.created_at\) > \?/);
  // First poll: no replaying history at the TV on boot.
  assert.match(feed, /First poll: no replaying history/);
});

test("links are manager-made, revocable, and audited; the page mounts outside the login shell", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS tv_display_links/);
  for (const r of ['app.get("/api/tv-links"', 'app.post("/api/tv-links"', 'app.delete("/api/tv-links/:id"']) {
    const i = routes.indexOf(r);
    assert.ok(i > 0, `missing ${r}`);
    assert.match(routes.slice(i, i + 300), /requireManagerOrAdmin\(req, res\)/);
  }
  assert.match(routes, /entityType: "tv_display_link"/);
  assert.match(app, /<Route path="\/tv\/:token" component=\{TvBoard\} \/>/);
});

test("the screen queues moments, plays a milestone once, and reloads on deploy", () => {
  assert.match(page, /const \[queue, setQueue\] = useState<Moment\[\]>/);
  assert.match(page, /if \(current \|\| !queue\.length\) return;/, "one moment at a time");
  assert.match(page, /played\.current\.has\(m\.id\)/);
  assert.match(page, /localStorage\.setItem\(PLAYED_KEY/);
  assert.match(page, /data\.version === APP_VERSION/);
  assert.match(page, /window\.location\.reload\(\)/);
  // Nothing on a wall the whole floor faces may flash fast.
  assert.doesNotMatch(page, /animate-ping|setInterval\([^)]*, ?[0-9]{1,2}\)/);
  assert.match(page, /useReducedMotion/);
});

test("the moment queue cannot deadlock, and cannot lose moments on reload", () => {
  // Seen live, twice. (1) One effect that both dequeued and owned the hold
  // timer cancelled that timer in its own cleanup, so the first moment sat on
  // screen forever. (2) Remembering a moment as played on ENQUEUE meant a
  // reload mid-queue silently lost everything behind the one on screen.
  const dequeue = page.slice(page.indexOf("if (current || !queue.length) return;"), page.indexOf("}, [current, queue, remember]);"));
  assert.doesNotMatch(dequeue, /setTimeout/, "the dequeue effect must not own the hold timer");
  assert.match(dequeue, /remember\(head\.key\)/, "a moment is remembered when it STARTS");
  assert.match(page, /if \(!current\) return;\s*\r?\n\s*const hold = /, "the hold timer lives in its own effect keyed on current");
  const enqueue = page.slice(page.indexOf("cursorRef.current = data.cursor;"), page.indexOf("}, [data]);"));
  assert.doesNotMatch(enqueue, /remember\(/, "enqueueing must not mark anything as played");
  assert.match(enqueue, /!have\.has\(x\.key\)/, "a re-poll cannot double-queue the same moment");
});

test("pages rotate like signage, and pause under a moment", () => {
  assert.match(page, /const DECK: Slot\[\] = \[/);
  for (const id of ["scorecard", "team", "latest", "tip"]) assert.match(page, new RegExp(`data-testid="tv-page-${id}"`));
  // The scorecard is what people look up for: it comes round most often, and
  // that has to survive the deck growing to a dozen slots.
  assert.equal((page.match(/\{ id: "scorecard",/g) ?? []).length, 2);
  // A repeated page must re-enter fresh, so bars grow and numbers count again.
  assert.match(page, /key=\{`\$\{page\}-\$\{dealt\}`\}/);
  // And the deck does not turn under a moment.
  const deck = page.slice(page.indexOf("const [slot, setSlot]"), page.indexOf("const page = (deck[slot]"));
  assert.match(deck, /if \(current\) return;/);
  // Deliberately NOT mode="wait": it holds the incoming page until the
  // outgoing one reports its exit done, and a stalled exit wedges the board.
  assert.doesNotMatch(page, /AnimatePresence mode="wait"/);
  assert.match(page, /<AnimatePresence initial=\{false\}>/);
  // Clicking or tapping anywhere skips on.
  assert.match(page, /onClick=\{advance\}/);
  assert.match(page, /const advance = useCallback/);
});

test("the EOD board and the assignment list take turns by the clock", () => {
  // The EOD deadline is 4pm the NEXT business day, so before the afternoon
  // there are legitimately zero reports for today and that board is empty.
  // It gets the wall from 3:30 to 6pm; the assignment list holds the rest of
  // the day, when it is still something a person can act on.
  assert.match(page, /const EOD_FROM = 15 \* 60 \+ 30, EOD_TO = 18 \* 60;/);
  assert.match(page, /\{ id: "assignments",\s+dwellMs: [\d_]+, when: \(m\) => !inEodWindow\(m\) \}/);
  assert.match(page, /\{ id: "eod",\s+dwellMs: [\d_]+, when: inEodWindow \}/);
  const inWindow = (m: number) => m >= 15 * 60 + 30 && m < 18 * 60;
  assert.equal(inWindow(15 * 60 + 29), false, "3:29pm is too early");
  assert.equal(inWindow(15 * 60 + 30), true);
  assert.equal(inWindow(17 * 60 + 59), true);
  assert.equal(inWindow(18 * 60), false, "6pm is the end of it");
  // A page whose section is missing is dropped rather than shown blank, and
  // the deck can never end up empty.
  assert.match(page, /return allowed\.length \? allowed : DECK\.filter/);
});

test("the board pages come from their own endpoint, on their own clock", () => {
  // A query that throws in the heavy payload must never be able to stop a
  // transfer being celebrated, so it does not ride the moment feed.
  assert.match(page, /const PAGES_POLL_MS = 30_000;/);
  assert.match(page, /queryKey: \[`\/api\/tv\/\$\{token\}\/pages`\]/);
  assert.match(routes, /app\.get\("\/api\/tv\/:token\/pages"/);
});
const hype = readFileSync(join(root, "client/src/components/tv/hype.tsx"), "utf8");

test("every moment is one big word, with no cartoon left in it", () => {
  // It was briefly an ACME cartoon — an anvil landing on the word, a banana
  // peel, a portable hole, an alarm clock knocking a chair over. Asked for,
  // built, then asked to be removed. This keeps it removed: what a moment
  // shows is type, colour and one clean hit.
  assert.match(page, /<HypeScene kind=\{kind\}/);
  for (const k of ["transfer", "appointment", "rescheduled", "fell_through", "missed_appointment", "milestone"]) {
    assert.match(hype, new RegExp(`\\b${k}: "[A-Z !\\-]+"`), `${k} needs its own word`);
    assert.match(hype, new RegExp(`\\b${k}: \\d+`), `${k} needs an impact time`);
  }
  assert.match(hype, /TRANSFER!/); assert.match(hype, /BOOKED!/); assert.match(hype, /REBOOKED/);
  assert.match(hype, /FELL THROUGH/); assert.match(hype, /NO-SHOW/); assert.match(hype, /MILESTONE!/);
  // No props, and none of their choreography. Comments are stripped first:
  // the file's header explains what used to be there and why it went, and
  // that history should not trip its own guard.
  const hypeCode = hype.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const gone of ["Anvil", "Hole", "Ladder", "Tumbleweed", "Chair", "AlarmClock", "Peel", "Hook", "CalendarPage", "StampRig", "Rocket", "Crate", "ACME"]) {
    assert.doesNotMatch(hypeCode, new RegExp(`\\b${gone}\\b`), `${gone} should be gone`);
  }
  assert.doesNotMatch(hype, /@keyframes hype-(anvil|peel|chair|clock|stamp|crate|hook|tumble|ladder|rocket)/);
});

test("the hype screen cannot wedge the overlay open", () => {
  // Seen live. The first cut mounted motion elements on timers. One mounted
  // while the overlay was already exiting, registered with presence after
  // the exit had been dispatched, never reported done -- and the overlay
  // sat in the DOM at opacity 0 with the pages rotating underneath it. So:
  // one mount, delays and keyframes only, no exit props below the wrapper,
  // and no infinite framer loops.
  assert.doesNotMatch(hype, /useEffect|useState|setTimeout|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(hype, /exit=/);
  assert.doesNotMatch(hype, /repeat: Infinity/);
});

test("the hype screen is safe for a wall the whole floor faces", () => {
  // No flashing above two per second: the only loop is a slow CSS ray spin,
  // the no-show shudder is position on the word only, and reduced motion
  // drops every bit to its final frame.
  const spin = hype.match(/hype-spin (\d+)s linear infinite/);
  assert.ok(spin && Number(spin[1]) >= 10, "the ray spin must be slow");
  assert.match(hype, /useReducedMotion/);
  assert.match(hype, /const STILL: Transition = \{ duration: 0\.3 \}/);
  assert.match(hype, /reduced \? STILL/);
  // Nothing is downloaded: it is all inline SVG and text.
  assert.doesNotMatch(hype, /<img|src=|fetch\(/);
});

test("the holds fit the choreography, and the crash lands with the word", () => {
  assert.match(page, /transfer: 9500, appointment: 8000, rescheduled: 8000, fell_through: 8500, missed_appointment: 7500, milestone: 10500/);
  for (const k of ["transfer", "appointment", "rescheduled", "fell_through", "missed_appointment", "milestone"]) {
    assert.match(page, new RegExp(`${k}:\\s+\\(\\) => \\{ crash\\(\\{ delayMs: HYPE_IMPACT_MS\\.${k}`), `${k} sound must key off the impact time`);
  }
});

test("a moment holds and then hard-cuts, with no exit animation anywhere", () => {
  // Two different wedges, both seen live. Under AnimatePresence the overlay
  // stayed in the DOM at opacity 0 after its exit, because some descendant
  // never reported its exit done. Replacing that with a hand-run fade — a
  // `leaving` flag driving opacity, unmounting 300ms later — moved the bug:
  // a moment could mount while the flag was still set and play its whole
  // scene invisibly with the deck paused behind it. A hard cut cannot do
  // either, so there is exactly one timer and no leaving state.
  assert.doesNotMatch(page, /<AnimatePresence>\{current/);
  assert.doesNotMatch(page, /setLeaving|leaving=\{/, "no fade-out state may come back");
  assert.doesNotMatch(page, /FADE_MS/);
  assert.match(page, /\{current && <MomentOverlay moment=\{current\} reduced=\{reduced\} \/>\}/);
  assert.match(page, /const done = setTimeout\(\(\) => setCurrent\(null\), hold\);/);
  const overlay = page.slice(page.indexOf("function MomentOverlay"), page.indexOf("// ── the page"));
  assert.doesNotMatch(overlay, /exit=/, "nothing in the overlay may depend on presence");
  assert.match(overlay, /animate=\{\{ opacity: 1 \}\}/);
});

test("?demo=1 plays one of every moment, and ?demo=<kind> loops just that one", () => {
  // So a screen can be checked from Settings without waiting for the floor,
  // and so a single animation can be built without sitting through the reel.
  const from = page.indexOf('get("demo")');
  assert.ok(from >= 0, "the demo switch must read the kind from the query");
  const demo = page.slice(from, page.indexOf("}, []);", from));
  assert.match(demo, /const one = reel\.filter/);
  assert.match(demo, /setQueue\(loop\)/);
  for (const k of ["transfer", "appointment", "rescheduled", "fell_through", "missed_appointment"]) {
    assert.match(demo, new RegExp(`ev\\("${k}", `), `${k} must be in the demo reel`);
  }
  assert.match(demo, /type: "milestone", key: `demo-\$\{stamp\}-milestone`/);
  assert.doesNotMatch(demo, /cursorRef|remember\(/);
});

// ── the wall quotes ─────────────────────────────────────────────────────────
test("the tip page shows standalone quotes, not raw manual lines", async () => {
  // A manual line like "run the four steps from this morning" means nothing on
  // a wall with no morning session in sight, so the board quotes a set written
  // to stand alone.
  const { TV_QUOTES, pickQuote } = await import("../shared/tv-quotes");
  // Two registers now share the book. The training lines are unattributed and
  // stay deliberately quiet; the ones Ethan picked are quoted people, and the
  // rules that keep the first set plain would throw most of them out — half
  // carry an exclamation mark and the longest runs past 240 characters.
  const plain = TV_QUOTES.filter((q) => !q.author);
  const quoted = TV_QUOTES.filter((q) => q.author);
  assert.equal(TV_QUOTES.length, 78);
  assert.equal(plain.length, 50, "the training lines are untouched");
  assert.equal(quoted.length, 28);
  for (const q of TV_QUOTES) {
    assert.ok(!/^\s|\s$/.test(q.text), `padded: ${q.text}`);
    // Nothing may lean on the manual being open beside it.
    assert.doesNotMatch(q.text, /\b(this morning|yesterday|last week|as we (covered|said)|see day \d|step \d)\b/i, q.text);
  }
  for (const q of plain) {
    assert.ok(q.text.length > 20 && q.text.length < 160, `awkward length: ${q.text}`);
    // No motivational-poster voice — these are read on a bad day too.
    assert.doesNotMatch(q.text, /!|\b(crush|grind it|hustle|beast|warrior|no excuses)\b/i, q.text);
  }
  for (const q of quoted) {
    assert.ok(q.text.length > 10, `too short to be worth the page: ${q.text}`);
    assert.ok(String(q.author).trim().length > 1, `quoted with nobody attached: ${q.text}`);
  }
  assert.equal(new Set(TV_QUOTES.map((q) => q.text)).size, 78, "no duplicates");
  // Deterministic, and it walks the whole list rather than clustering.
  assert.equal(pickQuote(7)?.text, pickQuote(7)?.text);
  const walked = new Set(Array.from({ length: 78 }, (_, i) => pickQuote(i)?.text));
  assert.equal(walked.size, 78, "every quote must be reachable");
  // The name has to survive the trip to the screen, and an unattributed line
  // must not render a dangling dash where a person's name would go.
  assert.match(page, /quoteAuthor\?: string \| null/);
  assert.match(page, /tip\.quoteAuthor[\s\S]{0,80}\$\{tip\.quoteAuthor\}/);
  assert.match(routes, /quoteAuthor: quote\.author \?\? null/);
  // And the route serves them.
  assert.match(routes, /const quote = pickQuote\(Number\(req\.query\.tip\) \|\| 0\)/);
});

// ── one CLR passing another ─────────────────────────────────────────────────
test("an overtake is worked out between polls and plays its own race scene", () => {
  // The feed is stateless, so a CHANGE between two polls cannot come from the
  // server — the board holds the previous standings and compares.
  assert.match(page, /const prevStandings = useRef<RankRow\[\] \| null>\(null\);/);
  assert.match(page, /detectOvertakes\(prevStandings\.current, standings, data\.today\)/);
  assert.match(page, /prevStandings\.current = standings;/);
  // It goes through the same played-set as every other moment, so a pass that
  // is still true on the next poll cannot play twice.
  const enqueue = page.slice(page.indexOf("cursorRef.current = data.cursor;"), page.indexOf("}, [data]);"));
  assert.match(enqueue, /!played\.current\.has\(o\.key\)/);
  // Its own scene, its own hold, its own sound.
  assert.match(page, /<RaceScene passerName=\{o\.passerName\} passedName=\{o\.passedName\} count=\{o\.count\} reduced=\{reduced\} \/>/);
  assert.match(page, /overtake: 8500,/);
  assert.match(page, /overtake:\s+\(\) => \{ crash\(/);
  // The union stays exhaustive: nothing may assume a moment is an event.
  assert.doesNotMatch(page, /m\.type === "milestone" \? "milestone" : m\.event\.kind/);
});

test("the race scene never mocks the person who got passed", () => {
  const race = readFileSync(join(root, "client/src/components/tv/race.tsx"), "utf8");
  // Both drivers are colleagues watching this on the wall. Comments are
  // stripped first: the file explains IN a comment why neither car reads as a
  // loser, and that sentence should not trip its own guard.
  const code = race.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /\b(crash|explode|blow up|loser|beaten|wreck|spin out)\b/i);
  // Same house rules as the hype screens: CSS keyframes, nothing downloaded,
  // and a still frame under reduced motion.
  assert.match(race, /@keyframes race-/);
  assert.match(race, /useReducedMotion/);
  assert.doesNotMatch(race, /<img|src=|fetch\(/);
  assert.doesNotMatch(race, /repeat: Infinity/);
});

// ── how long since ──────────────────────────────────────────────────────────
test("the scorecard says how long since each person's last transfer and call", () => {
  // Calls come from CallTools, which stores a per-call occurred_at. Dialpad
  // only syncs a daily total, so it cannot answer "how long since" and must
  // not be mixed in — a stale daily number would read as a fresh call.
  assert.match(routes, /MAX\(created_at\) AS at FROM lead_outcomes/);
  assert.match(routes, /MAX\(occurred_at\) AS at FROM callsync_activity_events/);
  assert.doesNotMatch(
    routes.slice(routes.indexOf("const lastTransfer = new Map"), routes.indexOf("const best = new Map")),
    /dialpad/i,
    "Dialpad has no per-call time and must not feed the since-line",
  );
  assert.match(routes, /lastTransferAt: lastTransfer\.get\(Number\(c\.id\)\) \?\? null/);
  assert.match(routes, /lastCallAt: lastCall\.get\(Number\(c\.id\)\) \?\? null/);
  // The label ages between polls off the clock the header already runs.
  assert.match(page, /<SinceLabel what="transfer" at=\{p\.lastTransferAt\} now=\{now\} \/>/);
  assert.match(page, /<SinceLabel what="call" at=\{p\.lastCallAt\} now=\{now\} \/>/);
  assert.match(page, /now=\{now\.getTime\(\)\}/);
  // A missing stamp says so rather than rendering a wrong duration.
  assert.match(page, /no \{what\} yet today/);
  // Spelled out, not terse: "last transfer 38m ago", not "transfer 38m".
  assert.match(page, /last \{what\} <span className="font-semibold">\{s\.label\}<\/span>/);
  // Quiet reads amber, never red: this is information, not a telling-off.
  assert.match(page, /s\.quiet \? "text-amber-300\/70"/);
  assert.doesNotMatch(page.slice(page.indexOf("function SinceLabel"), page.indexOf("function ScorecardPage")), /red-/);
});

test("every page in the deck has something to render", () => {
  // Shipped once without this: the starved slot was in the deck and its data
  // existed, so it was kept — but nothing rendered it, and the wall went blank
  // for thirteen seconds every cycle.
  const deckSrc = page.slice(page.indexOf("const DECK: Slot[] = ["), page.indexOf("// ── sound"));
  const ids = [...deckSrc.matchAll(/\{ id: "(\w+)",/g)].map((m) => m[1]);
  assert.ok(ids.length >= 12, "the deck should have grown");
  for (const id of new Set(ids)) {
    assert.match(page, new RegExp(`page === "${id}"`), `${id} is in the deck with no renderer`);
  }
});

test("board data is unpacked into what each page actually takes", () => {
  // React error #31, twice: the board payload is untyped (`useQuery<any>`), so
  // handing a page an object where it wanted a string or a number type-checks
  // fine and then blanks the screen at runtime. These are the two that bit.
  assert.match(page, /submitted=\{\(board\?\.eod\?\.submitted \?\? \[\]\)\.map/);
  assert.match(page, /missing=\{\(board\?\.eod\?\.missing \?\? \[\]\)\.map/);
  assert.match(page, /team=\{board\?\.writeUps\?\.team\?\.pct \?\? null\}/);
  // Nothing may hand a page a bare section object.
  assert.doesNotMatch(page, /team=\{board\?\.writeUps\?\.team\}/);
  assert.doesNotMatch(page, /submitted=\{board\?\.eod\?\.submitted \?\? \[\]\}/);
});

test("an appointment time is the clock the office typed, whatever zone the server is in", () => {
  // Live bug. appointment_datetime has no timezone — "14:30" means half two
  // in the office. Passing it to new Date() reads it in the SERVER's zone,
  // and the server runs in UTC, so 2:30 PM appointments were on the wall as
  // 7:30 AM. Naive stamps are now rendered from their own digits.
  const tzs = ["UTC", "America/New_York", "Asia/Manila", "America/Los_Angeles"];
  const original = process.env.TZ;
  try {
    for (const tz of tzs) {
      process.env.TZ = tz;
      assert.match(String(whenLabel("2026-09-03T14:30")), /Thu 2:30 PM/, tz);
      assert.match(String(whenLabel("2026-09-03T09:05")), /Thu 9:05 AM/, tz);
      assert.match(String(whenLabel("2026-09-03T00:15")), /Thu 12:15 AM/, tz);
      assert.match(String(whenLabel("2026-09-03T12:00")), /Thu 12:00 PM/, tz);
    }
  } finally { process.env.TZ = original; }
  // A stamp that DOES carry a zone is still converted to the office's time.
  assert.match(String(whenLabel("2026-09-03T21:30:00.000Z")), /2:30\s?PM/);
  // Nonsense is still shown as-is rather than invented.
  assert.equal(whenLabel("garbage"), "garbage");
  assert.equal(whenLabel("2026-09-03T99:99"), "2026-09-03T99:99");
});

// ── a new lead lands in LeadVault ───────────────────────────────────────────
// The receiving half of the wall notice: a token-secured webhook, a tiny
// in-memory buffer, and a strip along the bottom of the board. None of it is a
// record, and none of it may touch the moment pipeline.

const CALLSYNC_ROUTE = 'app.post("/api/webhook/callsync"';
const LEAD_ROUTE = 'app.post("/api/webhook/leadvault-lead"';
// From the secret helper through the handler: the two are one lock.
const leadRoute = routes.slice(routes.indexOf("function leadvaultLeadSecret()"), routes.indexOf('app.post("/api/webhook/mojo"'));

test("the new-lead webhook is shut without the shared secret, and locked with it", () => {
  // Locked exactly like the CallSync webhook beside it, because it is the same
  // caller: a shared token in x-api-token, compared in constant time. Every
  // line here is a way this kind of door has been left open before.
  assert.ok(routes.indexOf(LEAD_ROUTE) > 0, "the endpoint must exist");
  // No secret configured is SHUT, not open. A URL that puts words on a screen
  // the whole floor faces must never be anonymous.
  assert.match(leadRoute, /if \(!secret\) \{\s*\r?\n\s*return res\.status\(503\)/);
  assert.match(leadRoute, /req\.headers\["x-api-token"\]/);
  assert.match(leadRoute, /crypto\.timingSafeEqual\(suppliedBytes, expectedBytes\)/);
  assert.match(leadRoute, /return res\.status\(401\)\.json\(\{ ok: false, error: "invalid token" \}\)/);
  assert.match(leadRoute, /eventType: "auth_failed"/, "a rejected delivery is logged");
  // Its own secret, not CallSync's: either can be rotated without the other,
  // and neither doubles as a key to anything else in C3.
  assert.match(leadRoute, /LEADVAULT_LEAD_WEBHOOK_SECRET/);
  assert.doesNotMatch(leadRoute, /leadvaultReportingToken\(\)/);
  // The same four locks as the endpoint it is modelled on.
  const callsync = routes.slice(routes.indexOf(CALLSYNC_ROUTE), routes.indexOf(LEAD_ROUTE));
  for (const lock of [/x-api-token/, /timingSafeEqual/, /status\(401\)/, /status\(503\)/]) {
    assert.match(callsync, lock);
    assert.match(leadRoute, lock);
  }
  // Reachable without a session ONLY because the handler checks the token
  // itself — the same bargain the CallSync line above it strikes.
  const guard = routes.slice(routes.indexOf('app.use("/api", (req: Request'), routes.indexOf("requireAuth(req, res, next);"));
  assert.match(guard, /if \(req\.path === "\/webhook\/leadvault-lead"\) return next\(\);/);
  // And it stores nothing: a notice is not a record, so there is no table.
  assert.doesNotMatch(leadRoute, /\b(INSERT|UPDATE|DELETE|CREATE TABLE)\b/);
  // The secret is settable beside the other integration secrets, not only in
  // the environment, and the URL to hand LeadVault is on the same card.
  assert.match(storage, /ALTER TABLE webhook_settings ADD COLUMN leadvault_lead_secret TEXT/);
  assert.match(routes, /leadvaultLeadSecret: typeof leadvaultLeadSecret === "string" \? leadvaultLeadSecret : undefined/);
  const integrations = readFileSync(join(root, "client/src/pages/integrations.tsx"), "utf8");
  assert.match(integrations, /leadvaultLeadSecret: local\.leadvaultLeadSecret/);
  assert.match(integrations, /api\/webhook\/leadvault-lead/);
});

test("the ring buffer keeps a few minutes of arrivals and nothing else", async () => {
  const { recordNewLead, newLeadsSince, resetNewLeads, NEW_LEAD_KEEP, NEW_LEAD_MAX_AGE_MS } =
    await import("../server/tv-leads");
  resetNewLeads();
  const t0 = Date.parse("2026-09-02T17:00:00.000Z");

  // Only what the wall shows is kept. A state and a campaign are accepted so
  // LeadVault does not need a different body for C3 — and then dropped.
  const one = recordNewLead(
    { name: " Maria  Alvarez ", source: "Facebook", state: "CA", campaign: "Sept Refi", at: new Date(t0).toISOString() },
    t0,
  )!;
  assert.deepEqual(Object.keys(one).sort(), ["at", "id", "name", "source"]);
  assert.equal(one.name, "Maria Alvarez", "whitespace is tidied, not preserved");

  // Older than the window is not news, and is never taken in at all. This is
  // the retry-storm guard: a backfill pointed at the webhook cannot replay the
  // morning onto the wall.
  const stale = recordNewLead({ name: "This morning", at: new Date(t0 - NEW_LEAD_MAX_AGE_MS - 1000).toISOString() }, t0);
  assert.equal(stale, null);
  assert.equal(newLeadsSince(new Date(t0 - 60_000).toISOString(), t0).length, 1);

  // The buffer is short on purpose: past a screenful, the oldest go.
  resetNewLeads();
  for (let i = 0; i < NEW_LEAD_KEEP + 12; i += 1) {
    recordNewLead({ name: `Lead ${i}`, at: new Date(t0).toISOString() }, t0);
  }
  const held = newLeadsSince(new Date(t0 - 60_000).toISOString(), t0);
  assert.equal(held.length, NEW_LEAD_KEEP);
  assert.equal(held[0].name, "Lead 12", "the oldest fell off the back");

  // And they age out on their own, with no further delivery to trigger it —
  // otherwise a quiet afternoon would leave the morning sitting in memory.
  assert.equal(newLeadsSince(new Date(t0 - 60_000).toISOString(), t0 + NEW_LEAD_MAX_AGE_MS + 1).length, 0);

  // A sender an hour fast cannot park a notice at the top of the buffer: an
  // unreadable or future stamp is simply when it arrived.
  resetNewLeads();
  const skewed = recordNewLead({ name: "Clock skew", at: new Date(t0 + 3_600_000).toISOString() }, t0)!;
  assert.equal(skewed.at, new Date(t0).toISOString());
  assert.equal(recordNewLead({ name: "No stamp" }, t0)!.at, new Date(t0).toISOString());
  assert.equal(recordNewLead({ at: "garbage" }, t0)!.name, "A new lead", "a nameless lead still reads as a sentence");
});

test("the feed hands the board only the leads after its cursor", async () => {
  const { recordNewLead, newLeadsSince, resetNewLeads } = await import("../server/tv-leads");
  resetNewLeads();
  const t0 = Date.parse("2026-09-02T17:00:00.000Z");
  const at = (secs: number) => new Date(t0 + secs * 1000).toISOString();
  for (const s of [10, 20, 30]) recordNewLead({ name: `Lead ${s}`, at: at(s) }, t0 + 60_000);

  // Strictly after, exactly like the event query's COALESCE(...) > ?.
  assert.deepEqual(newLeadsSince(at(20), t0 + 60_000).map((l) => l.name), ["Lead 30"]);
  assert.equal(newLeadsSince(at(30), t0 + 60_000).length, 0, "a cursor already at the newest sees nothing");

  // No cursor is a TV that has just booted. Same rule as the events: a board
  // coming up does not replay what it missed while it was dark.
  assert.deepEqual(newLeadsSince(null, t0 + 60_000), []);
  assert.deepEqual(newLeadsSince("not a date", t0 + 60_000), []);

  // Ids are monotonic, so the board can tell two same-named leads apart and
  // show each of them exactly once.
  const ids = newLeadsSince(at(0), t0 + 60_000).map((l) => l.id);
  assert.deepEqual([...ids].sort((a, b) => a - b), ids);
  assert.equal(new Set(ids).size, ids.length);

  // And the route feeds it the cursor the endpoint already takes, rather than
  // inventing a second one for the board to keep.
  const feed = routes.slice(routes.indexOf('app.get("/api/tv/:token/feed"'), routes.indexOf('app.get("/api/tv/:token/pages"'));
  assert.match(feed, /newLeads: newLeadsSince\(since\),/);
  assert.equal((feed.match(/const since = /g) ?? []).length, 1, "one cursor for the whole feed");
});

test("the new-lead strip never touches the deck timer or the moment queue", () => {
  // A lead landing is ambient. Through the moment queue it would pause the
  // deck and wait behind a transfer's ten-second hype screen — by which time
  // it is not news — so it is deliberately its own small thing.
  const from = page.indexOf("// ── new leads ──");
  // fromIndex on purpose: there is an earlier module-level "the deck" heading.
  const strip = page.slice(from, page.indexOf("// ── the deck ──", from));
  assert.ok(strip.length > 0, "the new-lead block must exist");
  for (const forbidden of [/setQueue/, /setCurrent/, /setSlot/, /setDealt/, /remember\(/, /played\.current/]) {
    assert.doesNotMatch(strip, forbidden, `the strip must not reach into the moment pipeline: ${forbidden}`);
  }
  // It is not a Moment, so nothing can enqueue one by accident.
  const union = page.slice(page.indexOf("type Moment ="), page.indexOf("const POLL_MS"));
  assert.doesNotMatch(union, /NewLead/i);
  // The deck's pause is still only about `current`, and gained no second reason.
  const deck = page.slice(page.indexOf("const [slot, setSlot]"), page.indexOf("const page = (deck[slot]"));
  assert.match(deck, /if \(current\) return;/);
  assert.doesNotMatch(deck, /lead/i);
  // Its own hold, and no timer of its own to leak or cancel at the wrong
  // moment: whether the strip is up is read off the clock the header runs.
  assert.match(page, /const NEW_LEAD_HOLD_MS = 8_000;/);
  assert.match(strip, /const leadUp = !!leadNotice && now\.getTime\(\) < leadNotice\.until;/);
  assert.doesNotMatch(strip, /setTimeout|setInterval/);
  // Newest wins and the rest are a count, so five at once is one notice.
  assert.match(strip, /const newest = fresh\.reduce/);
  // One number remembered, not a set that grows for as long as the screen is up.
  assert.match(strip, /lastLeadId\.current = newest\.id;/);
  assert.doesNotMatch(strip, /new Set/);
  assert.match(page, /\+\{notice\.more\} more/);
  // It lands in its own zone of the bottom strip (the tests at the end of this
  // file), reading as a notice and not a celebration: no confetti, no hype, no
  // sound. Reduced motion gets a plain fade with no travel.
  const zone = page.slice(page.indexOf("function NewLeadZone"), page.indexOf("function TvBoard"));
  assert.doesNotMatch(zone, /Confetti|HypeScene|SOUND\[/);
  assert.match(zone, /initial=\{\{ opacity: 0, y: reduced \? 0 : 12 \}\}/);
  assert.match(zone, /transition=\{reduced \? \{ duration: 0\.25 \}/);
});

test("an Outcomes edit that turns a row INTO an appointment mirrors both columns", () => {
  // The change gate asked only about the follow-up VALUE, and a conversion does
  // not have to touch it: a callback booked for Friday 9am becomes an
  // appointment for Friday 9am, and the CLR changes one dropdown. That save is
  // the moment the row starts OWNING appointment_datetime — and it wrote no
  // appointmentDatetime at all, so the row entered its life as an appointment
  // with the two columns already out of step. Every surface that prefers
  // appointment_datetime (Upcoming Appointments, the 30-minute reminder cron,
  // reminders.ts's COALESCE, the EOD digest, the Bonzo note, the TV wall) then
  // read whatever the row's previous life had left in that column: nothing, or
  // a stale time. The presence gate this replaced had the same hole — it never
  // asked about the type either.
  assert.deepEqual(
    timeColumnsPatch({
      outcomeType: "appointment", followUpDate: "2026-09-11T09:00",
      storedFollowUpDate: "2026-09-11T09:00", storedOutcomeType: "callback_requested",
    }),
    { followUpDate: "2026-09-11T09:00", appointmentDatetime: "2026-09-11T09:00" },
    "the column it just started owning is written on the very save that hands it over",
  );
  // A date-only follow-up still clears rather than inventing a meeting time.
  assert.deepEqual(
    timeColumnsPatch({
      outcomeType: "appointment", followUpDate: "2026-09-11",
      storedFollowUpDate: "2026-09-11", storedOutcomeType: "deferral",
    }),
    { followUpDate: "2026-09-11", appointmentDatetime: null },
  );
  // But a conversion with NO follow-up at all says nothing about either column.
  // CallSync books meetings with appointment_datetime set and follow_up_date
  // NULL, so mirroring the empty follow-up here would delete the only time the
  // row has — on the very save that turns it into an appointment.
  assert.deepEqual(
    timeColumnsPatch({
      outcomeType: "appointment", followUpDate: "", storedFollowUpDate: "", storedOutcomeType: "future_contact",
    }),
    {},
    "becoming an appointment with an empty follow-up must not erase a booked time",
  );

  // Only INTO. Converting an appointment away has stopped owning the column, so
  // the type changing is not by itself a reason to write a time — a transfer
  // clears appointment_datetime in the PATCH anyway, and a callback that keeps
  // its date must not have that date copied into a column it does not own.
  for (const t of ["callback_requested", "transfer", "fell_through"]) {
    assert.deepEqual(
      timeColumnsPatch({
        outcomeType: t, followUpDate: "2026-09-11T09:00",
        storedFollowUpDate: "2026-09-11T09:00", storedOutcomeType: "appointment",
      }),
      {},
      `converting an appointment into a ${t} is not an instruction about either column`,
    );
  }
  // And an appointment that stays an appointment is still judged on its value
  // alone — the notes-only save that started all of this.
  assert.deepEqual(
    timeColumnsPatch({
      outcomeType: "appointment", followUpDate: "2026-09-11T09:00",
      storedFollowUpDate: "2026-09-11T09:00", storedOutcomeType: "appointment",
    }),
    {},
  );

  // The page has to hand over the type the row was LOADED with for any of that
  // to be answerable, and `before` is that row.
  assert.match(outcomesUpdate, /storedOutcomeType: before\?\.outcomeType,/);
  assert.match(outcomes, /outcomeType: outcome\.outcomeType,/,
    "the default the form resets to is the stored type this compares against");
});

// ── the upcoming-appointments page ──────────────────────────────────────────
// The wiring only. What counts as upcoming, and in what order, is tested
// against the pure helpers in tests/tv-pages.test.ts.

const tvPages = readFileSync(join(root, "client/src/components/tv/pages.tsx"), "utf8");
/** Just the upcoming section of the /pages handler. */
const upcomingSection = routes.slice(
  routes.indexOf('section("upcoming"'),
  routes.indexOf("} catch (e: any) {", routes.indexOf('section("upcoming"')),
);
/** Just the UpcomingPage component. */
const upcomingPage = tvPages.slice(tvPages.indexOf("export function UpcomingPage"));

test("the upcoming slot is in the deck AND has something to render", () => {
  // The starved page shipped once as a deck slot with no renderer, and the
  // wall went blank for thirteen seconds every cycle. This is that guard,
  // aimed at the new slot specifically.
  assert.match(page, /\{ id: "upcoming",\s+dwellMs: 13_000 \}/);
  assert.match(page, /page === "upcoming"/, "the deck id has a renderer");
  assert.match(page, /<UpcomingPage/);
  assert.match(page, /StarvedPage, UpcomingPage,\n\} from "@\/components\/tv\/pages"/);
  assert.match(tvPages, /export function UpcomingPage/);
  assert.match(tvPages, /data-testid="tv-page-upcoming"/);
  // Its dwell and its pan have to agree, the way every other page's do.
  assert.match(tvPages, /upcoming: 13,/);
  // And a missing section costs the slot rather than showing an empty page.
  assert.match(page, /case "upcoming":\s+return !!board\?\.upcoming;/);
});

test("the upcoming section is on the /pages route, wrapped like every other", () => {
  assert.ok(routes.indexOf('section("upcoming"') > 0, "built through the section() wrapper");
  // Which means one failing query costs this page and nothing else: `failed`
  // names it and the deck drops the slot.
  assert.match(routes, /failed\.push\(name\);/);
  assert.match(upcomingSection, /selectUpcomingAppointments\(/, "the shared rule decides what is upcoming");
  // The payload the page is handed: the rows, the window, and today's count.
  for (const key of [/days: UPCOMING_DAYS,/, /count: upcoming\.length,/, /todayCount: upcoming\.filter/]) {
    assert.match(upcomingSection, key);
  }
});

test("the appointment time is whenLabel's, and nothing else parses a date", () => {
  // The live bug this page could most easily reintroduce: these stamps carry
  // no timezone, so `new Date("2026-09-03T14:30")` reads them in the server's
  // zone — UTC on Railway — and a 2:30 PM appointment goes on the wall as
  // 7:30 AM. whenLabel is the one renderer that gets this right.
  assert.match(upcomingSection, /when: a\.timed \? whenLabel\(a\.at, tz\) : null,/);
  assert.match(routes, /rescheduleStampIsStale, whenLabel,/, "imported from tv-board, not re-implemented");
  // Comments stripped first: both of these explain the bug they are avoiding,
  // and that explanation should not trip its own guard.
  const stripped = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const banned of [/new Date\(/, /toLocale(String|DateString|TimeString)/, /Date\.parse/, /Intl\.DateTimeFormat/]) {
    assert.doesNotMatch(stripped(upcomingSection), banned, "the section must not format or parse a date itself");
  }
  // Date.now() is the only clock it is allowed, and it is handed straight to
  // the shared rule rather than being formatted.
  assert.match(upcomingSection, /const nowMs = Date\.now\(\);/);
  // The page prints what it is given. Not one date parse on the client either.
  for (const banned of [/new Date\(/, /toLocale(String|DateString|TimeString)/, /Date\.parse/]) {
    assert.doesNotMatch(stripped(upcomingPage), banned, "the page must not parse an appointment time");
  }
  assert.match(upcomingPage, /\{a\.when \?\? <span className="text-white\/35">time not set<\/span>\}/);
});

test("the page answers the question from across the room", () => {
  // Borrower, the CLR who booked it, the loan officer it is with, and when.
  assert.match(upcomingPage, /\{a\.borrower\}/);
  assert.match(upcomingPage, /Booked by \{a\.clr\}/);
  assert.match(upcomingPage, /<NameChip name=\{a\.lo\} \/>/);
  assert.match(upcomingPage, /\{a\.isToday \? "Today" : shortDay\(a\.day\) \?\? ""\}/);
  // Today is the amber row and the pill counts it — the one thing the floor
  // looks up for.
  assert.match(upcomingPage, /a\.isToday \? "border-amber-300\/45 bg-amber-400\/\[0\.10\]"/);
  assert.match(upcomingPage, /\{dueToday\} still today/);
  assert.match(upcomingPage, /Nothing left today/);
  // An LO-less appointment says so instead of leaving a gap that reads broken.
  assert.match(upcomingPage, /no loan officer named/);
  // It is a schedule, not a second leaderboard: no bars, no ranks, no counts
  // per CLR.
  assert.doesNotMatch(upcomingPage, /MeterRow|meterPct|CountUp|rank=/);
});

test("a long list pans and an empty one says so, like the other tall pages", () => {
  assert.match(upcomingPage, /const pan = usePan\(PAN_SECONDS\.upcoming, reduced\);/);
  assert.match(upcomingPage, /<div ref=\{pan\.ref\} className=\{PAN_BOX\}>/);
  assert.match(upcomingPage, /style=\{pan\.style\}/);
  assert.match(upcomingPage, /\{pan\.overflowing && <PanCount>/);
  // A wall that says nothing looks broken, so the empty state is a sentence in
  // the shared EMPTY type, not a blank screen.
  assert.match(upcomingPage, /<li className=\{EMPTY\}>/);
  assert.match(upcomingPage, /Nothing booked for the next \{win\} days\. The board is clear\./);
});

test("the board unpacks the upcoming rows into what the page takes", () => {
  // React error #31 twice already on this board: the payload is untyped, so
  // handing a page an object where it wanted a string type-checks fine and
  // then blanks the screen.
  assert.match(page, /appointments=\{\(board\?\.upcoming\?\.appointments \?\? \[\]\)\.map/);
  assert.match(page, /days=\{board\?\.upcoming\?\.days \?\? 7\}/);
  assert.match(page, /todayCount=\{board\?\.upcoming\?\.todayCount \?\? 0\}/);
  assert.doesNotMatch(page, /appointments=\{board\?\.upcoming\?\.appointments \?\? \[\]\}/);
});


// ── the bottom strip ────────────────────────────────────────────────────
/** The strip element itself. There is exactly one <footer> on this board. */
const strip = page.slice(page.indexOf("<footer"), page.indexOf("</footer>") + "</footer>".length);
/** Everything between the deck and the moment overlay. */
const belowDeck = page.slice(page.indexOf("</main>"), page.indexOf("{current && <MomentOverlay"));
const newLead = page.slice(page.indexOf("function NewLeadZone"), page.indexOf("function TvBoard"));
/** The strip's type scale and both of its zones, as source. */
const stripCode = page.slice(page.indexOf("const STRIP_LABEL"), page.indexOf("function TvBoard"));

test("the bottom strip is a band in the flow, not something floating over the deck", () => {
  // Ethan: "in the bottom like 10% of the screen ... not overlaying anything".
  // Both halves of it used to be pinned ON TOP of whatever page was up \u2014 a
  // card at bottom-16 right-10 and a notice at bottom-14 sliding up over it.
  assert.match(strip, /data-testid="tv-strip"/);
  assert.match(strip, /className="relative z-10 flex h-\[10vh\] items-stretch/);
  // The deck is GIVEN a shorter box; it is not padded to clear an overlay.
  assert.match(page, /<main className="relative z-10 h-\[calc\(100vh-6rem-10vh\)\]">/);
  assert.doesNotMatch(page, /pb-\[10vh\]|padding-bottom/);
  // Nothing under the deck is pinned over it any more. The single `absolute`
  // left down here is the fill inside a progress dot, inside its own pill.
  assert.doesNotMatch(belowDeck, /pointer-events-none/);
  assert.doesNotMatch(belowDeck, /\bz-20\b/);
  assert.doesNotMatch(belowDeck, /absolute[^"]*(bottom-|inset-0|right-\[)/);
  assert.equal((belowDeck.match(/\babsolute\b/g) ?? []).length, 1, "only the progress-dot fill");
  assert.match(belowDeck, /className="absolute inset-y-0 left-0 rounded-full bg-amber-300"/);
  // And the two old anchors are gone for good.
  assert.doesNotMatch(page, /bottom-16 right-10|bottom-14 left-10/);
});

test("the strip is one row: the lead notice, a hairline, the deck's dots", () => {
  // The strip used to carry a second zone \u2014 "Not ranked \u00b7 today" \u2014 at the
  // other end, with the dots holding the middle. Ethan asked for it to go, so
  // what is left is NOT that layout with a hole in it: the notice takes the
  // whole width from the left edge and the dots close the row on the right,
  // the way page numbers close a footer. One rule, and no mirrored gap.
  const order = ["<NewLeadZone", "<StripRule />", 'data-testid="tv-progress"'];
  let cursor = 0;
  for (const piece of order) {
    const found = strip.indexOf(piece, cursor);
    assert.ok(found > 0, `the strip reads left to right: ${piece}`);
    cursor = found + piece.length;
  }
  assert.equal((strip.match(/<StripRule \/>/g) ?? []).length, 1, "one rule, between the two things left");
  assert.equal((strip.match(/<NewLeadZone/g) ?? []).length, 1, "and the notice is not rendered twice");
  // The notice is a flex-1 column that fills the row rather than an end of it,
  // and it reads from the left like everything else on the wall.
  assert.match(newLead, /className="flex min-w-0 flex-1 flex-col justify-center"/);
  assert.doesNotMatch(newLead, /text-right|justify-end/, "nothing is still aligned to a zone that has gone");
  assert.match(strip, /className="flex shrink-0 items-center justify-center gap-3" aria-hidden="true" data-testid="tv-progress"/);
  // The two type styles survive the removal, so the row is the same height and
  // sits on the same baselines it always did.
  assert.match(page, /const STRIP_LABEL = "text-\[clamp\(0\.7rem/);
  assert.match(page, /const STRIP_LINE = "mt-1\.5 flex items-baseline/);
  assert.match(newLead, /className=\{STRIP_LABEL\}/);
  assert.match(newLead, /\{STRIP_LINE\}/);
});

test("the not-ranked half is gone \u2014 component, data and all", () => {
  // Ethan: "get rid of elleine's the floor graphic". Left half-removed it would
  // be a component nobody renders and a query nobody reads.
  assert.doesNotMatch(page, /NotRankedZone/);
  assert.doesNotMatch(page, /tv-aside/);
  assert.doesNotMatch(page, /\baside\b/, "no dangling type or prop on the board");
  // The feed stops shipping the field with it.
  assert.doesNotMatch(routes, /COALESCE\(u\.exclude_from_stats,0\)=1/, "the query went with the zone");
  assert.doesNotMatch(routes, /aside: aside\.map/);
  // What it reconciled has not been lost: the wall's transfers PAGE still names
  // the gap between the team total and the list it ranks.
  //
  // This used to be `assert.match(routes, /excluded/)`, which proved nothing at
  // all — "excluded" appears dozens of times in a 24,000-line file, so the
  // check passed with the reconciliation deleted. It is read out of the one
  // section that has to carry it, and followed all the way to the wall.
  const feed = routes.slice(routes.indexOf('section("transfers"'), routes.indexOf('section("starved"'));
  assert.ok(feed.length > 0, "the pages feed still builds a transfers section");
  // Built from the rows the roster does NOT cover — which is the whole point:
  // Elleine Asuncion carries exclude_from_stats=1 and is the top producer, so
  // without this the team total is larger than every name under it adds up to.
  assert.match(feed, /const excluded = rows\r?\n\s*\.filter\(\(r\) => !rosterIds\.has\(Number\(r\.id\)\)\)/);
  assert.match(feed, /\.filter\(\(r\) => r\.today > 0 \|\| r\.week > 0 \|\| r\.month > 0\)/,
    "and only people who actually transferred are named");
  // ...and it is actually shipped, not merely computed.
  assert.match(feed, /people, excluded, team: counts\(team\)/);
  // The page reads it and prints the reconciliation line.
  const pages = readFileSync(join(root, "client/src/components/tv/pages.tsx"), "utf8");
  assert.match(pages, /export function TransfersPage\(\{ window: win, people, team, excluded, reduced \}/);
  assert.match(pages, /data-testid="tv-transfers-excluded"/);
});

test("the strip is a footer, and never out-shouts the page above it", () => {
  // Small type with a hard ceiling, quiet labels, and no headline sizes in it
  // anywhere. The corner card it replaces ran a 2.6rem number.
  assert.match(page, /const STRIP_LABEL = "[^"]*text-white\/30";/);
  assert.match(page, /const STRIP_LINE = "[^"]*text-\[clamp\(0\.95rem,1\.25vw,1\.3rem\)\]/);
  // No clamp anywhere in the strip may reach a page-heading ceiling. The pages
  // above it top out at 4.8rem, and this has to stay a footnote to them.
  const tops = (stripCode.match(/clamp\([^)]*?[\d.]+rem\)/g) ?? [])
    .map((m) => Number(/([\d.]+)rem\)$/.exec(m)?.[1] ?? 0));
  assert.ok(tops.length >= 2, "the strip's type is set in clamp(), like the rest of the wall");
  for (const top of tops) assert.ok(top > 0 && top <= 1.4, `the strip stays small: ${top}rem`);
  assert.match(page, /const STRIP_QUIET = "truncate text-white\/25";/);
});

test("the strip's empty state is designed, not blank", () => {
  // Zero leads all morning still has to look like a footer somebody drew on
  // purpose \u2014 which matters more now that the notice is the whole strip.
  assert.match(newLead, /<span className=\{STRIP_QUIET\}>nothing new yet today<\/span>/);
  // The label stays up either way \u2014 it names the zone, it is not a header that
  // appears only when there is something under it.
  assert.match(newLead, /<div className=\{STRIP_LABEL\}>New in LeadVault<\/div>/);
  // And the strip is rendered unconditionally. The old notice was gated and
  // slid up over the deck, so an empty strip simply vanished.
  assert.match(strip, /^\s*<NewLeadZone notice=\{leadNotice\} up=\{leadUp\} reduced=\{reduced\} \/>$/m, "no gate in front of it");
});

test("a lead arriving never changes the height of the strip", () => {
  // A strip that grew when LeadVault fired would jog the whole board, deck and
  // all, several times an hour. So the lead zone renders its content line in
  // BOTH states \u2014 a ternary, never a bare `&&` that collapses the row \u2014 and
  // nothing about the strip's height is conditional.
  assert.match(newLead, /\{notice \? \(/);
  assert.match(newLead, /\) : \(\s*<span className=\{STRIP_QUIET\}>/);
  assert.doesNotMatch(strip, /h-\[\$\{|h-\[calc/);
  assert.equal((strip.match(/h-\[10vh\]/g) ?? []).length, 1, "one fixed height, not a computed one");
  // It still ARRIVES: the row re-mounts on the lead's id and rises in, lit
  // while the notice holds and fading to the strip's own grey afterwards.
  assert.match(newLead, /key=\{notice\.lead\.id\}/);
  assert.match(newLead, /up \? "text-emerald-200" : "text-white\/45"/);
  assert.match(newLead, /transition-colors duration-700/);
  assert.match(page, /<NewLeadZone notice=\{leadNotice\} up=\{leadUp\} reduced=\{reduced\} \/>/);
  // Still no timer, still nothing from the moment pipeline.
  assert.doesNotMatch(newLead, /setTimeout|setInterval|setQueue|setCurrent|setSlot|setDealt/);
});

test("the progress dots and click-to-advance both still work from inside the strip", () => {
  // The dots moved into the strip; they did not change. Same fill, same key on
  // `dealt` so a repeated page re-runs the bar, same pause under a moment.
  assert.match(strip, /\{deck\.map\(\(d, i\) => \(/);
  assert.match(strip, /\{i === slot && !current && \(/);
  assert.match(strip, /transition=\{\{ duration: d\.dwellMs \/ 1000, ease: "linear" \}\}/);
  assert.match(strip, /key=\{dealt\}/);
  assert.match(strip, /aria-hidden="true" data-testid="tv-progress"/);
  // Click-to-advance is still on the root, so a tap anywhere \u2014 the strip
  // included \u2014 moves the deck on.
  assert.match(page, /onClick=\{advance\}\n\s+role="button"/);
  assert.match(page, /if \(e\.key === "Enter" \|\| e\.key === " " \|\| e\.key === "ArrowRight"\) advance\(\);/);
});

test("every page pans against the height it is actually given", () => {
  // The strip took a tenth of the screen off the deck, so every tall page has
  // further to pan. usePan MEASURES scrollHeight against clientHeight, so the
  // pages in tv/pages.tsx correct themselves \u2014 but the scorecard used to do
  // its own arithmetic off two numbers read from the old, taller deck: rows
  // past a hard-coded six, times a hard-coded 7.6rem. It would have stopped
  // short of its last row. One pan on this wall now, and it is the measured one.
  const scorecard = page.slice(page.indexOf("function ScorecardPage"), page.indexOf("function TeamPage"));
  assert.match(scorecard, /const pan = usePan\(dwellMs \/ 1000, reduced\);/);
  assert.match(scorecard, /<div ref=\{pan\.ref\} className=\{PAN_BOX\}>/);
  assert.match(scorecard, /style=\{pan\.style\}/);
  assert.match(scorecard, /\{pan\.overflowing && \(/);
  // Comments stripped: the one above explains the arithmetic it replaced, and
  // that explanation must not trip its own guard.
  const code = scorecard.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.doesNotMatch(code, /VISIBLE|7\.6|overflow \* /);
  assert.match(page, /^  PAN_BOX, usePan,$/m, "imported from the one place they live");
  assert.match(tvPages, /export function usePan\(seconds: number, reduced: boolean\)/);
  assert.match(tvPages, /export const PAN_BOX = "min-h-0 flex-1 overflow-hidden";/);
  // The measurement itself is unchanged: how much taller the content is than
  // its box, which is the only number that survives the box changing size.
  assert.match(tvPages, /const next = Math\.max\(0, el\.scrollHeight - el\.clientHeight\);/);
  assert.match(tvPages, /"--tv-pan": `-\$\{Math\.round\(over\)\}px`/);
  // Every page that pans still asks for a box and still measures it, so a
  // shorter deck simply means a longer slide, not a truncated list.
  assert.equal((tvPages.match(/usePan\(PAN_SECONDS\./g) ?? []).length, 11);
  assert.equal((tvPages.match(/ref=\{\w+\.ref\}/g) ?? []).length, 11);
  // And the keyframes are still declared exactly once, on the board's root.
  assert.equal((page.match(/@keyframes tv-pan/g) ?? []).length, 1);
  assert.doesNotMatch(tvPages, /@keyframes/);
});

// ── check-ins: read as a lookup, which is why they are not re-ordered ───────

test("the scorecard reads check-ins as a name-keyed lookup, so their order cannot matter", () => {
  // This is the reason the /pages check-ins section keeps roster order while
  // the rest of the wall was reorganised most-to-least (see
  // tests/tv-pages.test.ts). Its only consumer is right here, and it collapses
  // the array into an object before anything looks at it — an order cannot
  // survive Object.fromEntries, so imposing one would be motion without
  // meaning. If a check-ins PAGE is ever added, this test is where the reason
  // stops being true.
  assert.match(page, /checkins=\{board\?\.checkins\?\.people/);
  assert.match(
    page,
    /Object\.fromEntries\(board\.checkins\.people\.map\(\(c: any\) => \[c\.name, !!c\.checkedIn \|\| !!c\.excused\]\)\)/,
    "the rows become an object keyed by name",
  );
  // And it is used as a lookup: a name in, a boolean out. Never an index.
  assert.match(page, /checkins\?: Record<string, boolean>;/);
  assert.match(page, /const checked = checkins \? checkins\[p\.name\] !== false : true;/);
  assert.ok(!/checkins\[0\]|checkins\.people\[/.test(page), "nothing reads it positionally");

  // Exactly one consumer — the guard and the map on the same prop.
  assert.equal((page.match(/board\??\.checkins/g) ?? []).length, 2,
    "the section is read in one place and nowhere else on the wall");
  // There is no check-ins page on the deck, so there is no list to order.
  assert.ok(!/page === "checkins"/.test(page), "no check-ins page in the deck");
  assert.ok(!/CheckinsPage/.test(page), "and no component for one");
});

test("a missing check-in never hides anybody from the scorecard", () => {
  // The lookup answers three ways and only one of them removes a row: an
  // explicit false. Absent data reads as present, because a broken query must
  // never quietly empty the board.
  const here = (checkins: Record<string, boolean> | undefined, name: string, busy: boolean) =>
    busy || (checkins ? checkins[name] !== false : true);
  assert.equal(here(undefined, "Ada", false), true, "no data at all: show everyone");
  assert.equal(here({}, "Ada", false), true, "not in the map: show them");
  assert.equal(here({ Ada: true }, "Ada", false), true);
  assert.equal(here({ Ada: false }, "Ada", false), false, "checked in nowhere and did nothing");
  assert.equal(here({ Ada: false }, "Ada", true), true, "but work today speaks for itself");
});
