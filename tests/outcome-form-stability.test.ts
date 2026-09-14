import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const outcomes = read("client/src/pages/outcomes.tsx");
const appointments = read("client/src/pages/appointments.tsx");

/**
 * "When you add information from an appointment to a transfer, it magically
 * gets rid of everything and refreshes in the middle of the attempt."
 *
 * The Appointments page passes the transfer form its prefill as an inline
 * object, so the prefill was a NEW object on every parent render — and the
 * parent re-renders on every refetch. The form's reset effect keyed on that
 * object's identity, so each refetch wiped the CLR's typing. Now the reset is
 * keyed on the prefill's content, and the edit dialogs on the row's id.
 */

test("the outcome form resets on the prefill's content, not its identity", () => {
  const dialog = outcomes.slice(outcomes.indexOf("export function OutcomeFormDialog("), outcomes.indexOf("const [restoredDraft, setRestoredDraft]"));
  assert.match(dialog, /const initialKey = initialValues \? JSON\.stringify\(initialValues\) : "";/);
  assert.match(dialog, /\}, \[open, initialKey, meId\]\);/);
  // The old dependency list — the object itself — must be gone from that effect.
  assert.doesNotMatch(dialog, /\}, \[open, initialValues, meId, form\]\);/);
});

test("the Appointments page still hands the form an inline prefill — which is exactly what the form must tolerate", () => {
  assert.match(appointments, /initialValues=\{\{\s*\n\s*date: businessTodayClient\(\),/);
  assert.match(appointments, /transferType: "appointment",/);
});

test("both edit dialogs re-seed on the row's id, never on a refetched row object", () => {
  assert.match(outcomes, /setBonzoLogged\(false\);\s*\n\s*\}\s*\n(?:\s*\/\/[^\n]*\n)*\s*\}, \[open, outcome\?\.id\]\);/);
  assert.match(appointments, /setBonzoLogged\(false\);\s*\n\s*\}\s*\n(?:\s*\/\/[^\n]*\n)*\s*\}, \[open, outcome\?\.id\]\);/);
  assert.doesNotMatch(outcomes, /\}, \[open, outcome, form\]\);/);
  assert.doesNotMatch(appointments, /\}, \[open, outcome, form\]\);/);
});
