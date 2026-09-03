// A lead_outcomes row carries TWO time columns — `follow_up_date` and
// `appointment_datetime` — and every surface that shows a meeting reads them as
// `appointment_datetime || follow_up_date`: the Upcoming Appointments list, the
// 30-minute reminder cron in routes.ts, reminders.ts's COALESCE, the EOD digest,
// the Bonzo appointment note, and the TV wall. So a page that edits one column
// and not the other leaves the meeting advertised at a time it no longer has.
//
// These are the two rules every such page shares. They live here so there is
// one of each rather than one per page.

/**
 * May this row's `appointment_datetime` be written at all?
 *
 * Several outcome types carry a follow-up date — callbacks, deferrals, future
 * contacts — but only an appointment owns `appointment_datetime`. Writing a
 * callback's date there would invent an appointment time on the wall, in both
 * reminder crons and in the EOD digest.
 *
 * Ask it about the type the row is being SAVED with, not the one it had: an
 * edit that converts an appointment into something else has stopped owning the
 * column, and one that converts something else into an appointment has started.
 */
export const ownsAppointmentDatetime = (outcomeType: string | null | undefined) =>
  outcomeType === "appointment";

/**
 * What `appointment_datetime` becomes when a follow-up value is mirrored onto
 * it — the Appointments page's own convention (appointments.tsx `editMutation`):
 * a value with a time component is copied across, and a date-only value is not
 * a time at all, so it CLEARS the column rather than letting a stale time
 * shadow the new date.
 *
 * Only ever called with a value the user actually gave. An absent follow-up is
 * not a decision about the appointment column: a row can hold a time in
 * `appointment_datetime` and nothing in `follow_up_date` (CallSync books
 * straight into the appointment column), and clearing on absence would erase a
 * meeting's only recorded time.
 */
export const appointmentDatetimeFor = (followUpDate: string): string | null =>
  followUpDate.includes("T") ? followUpDate : null;

/**
 * The time columns an edit should actually PATCH.
 *
 * The rule is CHANGE, not presence. An edit dialog posts the whole record, so
 * every save carries the follow-up field whether or not anybody touched it —
 * and a mirror gated on "the field has a value" therefore had an opinion about
 * the meeting's time on saves that were about the notes or the borrower's name:
 *
 *  - it re-asserted the follow-up value over `appointment_datetime`, which
 *    silently reverted a time CallSync had corrected in that column (CallSync
 *    books straight into `appointment_datetime` and leaves `follow_up_date`
 *    NULL). Nothing revealed it: writing back a time either column already
 *    holds is not a move, so the wall stayed quiet and no Bonzo sync fired.
 *  - and CLEARING the follow-up wrote nothing at all, stranding the old time in
 *    `appointment_datetime` — the same drift, in the other direction.
 *
 * So: when the value changed, say both columns (including null when the field
 * was emptied, which is a decision the CLR made). When it did not, say neither,
 * and let the row keep the times it has. `stored` is the value the form was
 * loaded with — the same one the dialog resets its default to, so this asks
 * exactly the question react-hook-form's `dirtyFields` would.
 *
 * The TYPE changing into an appointment is the second thing that has to fire
 * it, and the follow-up value cannot see it. A row that was a callback owned no
 * `appointment_datetime`; the save that makes it an appointment is the moment it
 * starts owning one, and the column it starts owning holds whatever its previous
 * life left there — nothing, or a stale time. Gated on the value alone, that
 * save wrote no `appointmentDatetime` at all and left the two columns out of
 * step from the row's very first moment as an appointment: exactly the drift
 * this mirror exists to stop, arriving from the conversion side. (The presence
 * gate this replaced had the same hole — it too never asked about the type.)
 *
 * Only an appointment owns `appointment_datetime` (ownsAppointmentDatetime), so
 * a callback's follow-up date still moves alone — and a conversion AWAY from an
 * appointment has stopped owning the column, so it is not a reason to fire.
 */
export function timeColumnsPatch(input: {
  outcomeType: string | null | undefined;
  followUpDate: string | null | undefined;
  storedFollowUpDate: string | null | undefined;
  /** The type the row was loaded with — required, because absence is not "no". */
  storedOutcomeType: string | null | undefined;
}): { followUpDate?: string | null; appointmentDatetime?: string | null } {
  const next = input.followUpDate || null;
  const stored = input.storedFollowUpDate || null;
  const owns = ownsAppointmentDatetime(input.outcomeType);
  const startedOwningIt = owns && !ownsAppointmentDatetime(input.storedOutcomeType);
  if (next === stored && !startedOwningIt) return {};
  // Becoming an appointment while the follow-up field sits empty says nothing
  // about the appointment column. CallSync books meetings with
  // appointment_datetime set and follow_up_date NULL, so mirroring an empty
  // follow-up here would delete the only time the row has.
  if (startedOwningIt && next === stored && !next) return {};
  return owns
    ? { followUpDate: next, appointmentDatetime: next ? appointmentDatetimeFor(next) : null }
    : { followUpDate: next };
}
