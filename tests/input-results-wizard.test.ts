import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/outcomes.tsx"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const schema = readFileSync(join(root, "shared/schema.ts"), "utf8");
const appts = readFileSync(join(root, "client/src/pages/appointments.tsx"), "utf8");

const lib = readFileSync(join(root, "client/src/lib/lead-capture.ts"), "utf8");

test("every outcome asks which lead source it came from, with a self-fill option", () => {
  assert.match(page, /Which lead source did this come in from\?/);
  for (const opt of ["Retail", "BulkTexts", "Single Dialing", "Mojo", "CallTools", "Responded"]) {
    assert.ok(lib.includes(`"${opt}"`), `${opt} must be offered`);
  }
  assert.match(page, /LEAD_SOURCE_OPTIONS\.map/, "the page renders the shared option list");
  assert.match(page, /Other — type it in/, "a CLR must be able to answer outside the list");
  assert.match(page, /data-testid="input-lead-source-other"/);
  // "other" is a UI value; what is stored is what the CLR typed.
  assert.match(page, /values\.leadSource === "other"\s*\n?\s*\? \(values\.leadSourceOther \|\| ""\)\.trim\(\) \|\| null/);
  // …and the server persists it.
  assert.match(schema, /leadSource: text\("lead_source"\)/);
  // Anchored forward — rolloverIfEodSubmitted also appears in the import line
  // at the top of the file, which would slice backwards to "".
  const postAt = routes.indexOf(`app.post("/api/outcomes"`);
  const postList = routes.slice(postAt, routes.indexOf("rolloverIfEodSubmitted", postAt));
  assert.ok(postList.length > 0, "POST slice must not be empty");
  assert.match(postList, /"leadSource"/, "POST must accept the field");
});

test("transfers no longer offer Schedule for Upcoming Appointments", () => {
  assert.match(page, /watchedType !== "appointment" && !isTransfer &&/,
    "the follow-up scheduler must be hidden on the transfer path");
});

test("the transfer wizard is two steps — step 3 is gone", () => {
  assert.match(page, /const totalSteps = isTransfer \? 2 : 1;/);
  assert.ok(!page.includes("Step 3: Lead Information"), "the step-3 block must be removed");
  assert.ok(!/setStep\(3\)/.test(page), "nothing may navigate to a third step");
  assert.ok(!page.includes("appointment_transfer"), "step-3-only lead types must be gone from the wizard");
});

test("the summary is replaced by the qualification checklist", () => {
  assert.ok(!/Summary of conversation with lead/.test(page), "the free-text summary is replaced");
  // Questions and info fields live in the shared module both surfaces render.
  assert.match(page, /QUAL_QUESTIONS\.map/);
  assert.match(page, /INFO_FIELDS\.map/);
  assert.match(page, /INVESTMENT_ROUTING_HINT/);
  assert.match(lib, /Do you own a home\?/);
  assert.match(lib, /must be Yes/);
  assert.match(lib, /Bankruptcy in the last 6 months\?/);
  assert.match(lib, /should be No/);
  assert.match(lib, /Investment property \/ secondary residence\?/);
  assert.match(lib, /give this to LOA Justin, Mateo, or John/i);
  assert.match(lib, /Credit score over 500\? \(est\)/);
  for (const label of ["Address", "Goal", "How much are you looking to take out?", "Value of home",
    "Balance on mortgage", "Rate on mortgage", "Monthly payment", "Monthly income",
    "W2 / SE / Retired", "Credit score", "Military"]) {
    assert.ok(lib.includes(label), `missing field: ${label}`);
  }
  assert.ok(page.includes("Other Notes"), "the Other Notes textarea stays on the page");
});

test("the checklist serializes into conversationNotes so downstream is unchanged", () => {
  assert.match(page, /form\.setValue\("conversationNotes", composeConversationNotes\(\)\)/,
    "composed before validation so the Bonzo gate and submit both carry it");
  assert.match(page, /composeLeadCaptureNotes/, "serialization is the shared one, not a private copy");
  assert.match(lib, /Owns Home: /);
  assert.match(lib, /Lead Source: /);
});

test("timeframe and follow-up are gone from the transfer flow", () => {
  assert.ok(!/Select timeframe/.test(page));
  assert.ok(!/Requires follow-up\?/.test(page));
});

test("appointment notes edits are mirrored to Bonzo", () => {
  assert.match(routes, /async function syncAppointmentNotesToBonzo/);
  const fn = routes.slice(routes.indexOf("async function syncAppointmentNotesToBonzo"), routes.indexOf("async function syncAppointmentResultToBonzo"));
  assert.match(fn, /if \(!o\?\.bonzo_prospect_id\) return/, "only outcomes that were mirrored get updates");
  assert.match(fn, /Appointment notes updated in C3 by/);
  const patch = routes.slice(routes.indexOf(`app.patch("/api/outcomes/:id"`), routes.indexOf("// If the appointment time changed"));
  assert.match(patch, /else if \("notes" in body\) \{/, "a plain notes edit must trigger the mirror");
  assert.match(patch, /syncAppointmentNotesToBonzo\(id\)/);
  // Reschedule (which the Upcoming Appointments tab exposes) still moves the task.
  assert.match(appts, /Reschedule/);
  assert.match(patch, /syncAppointmentResultToBonzo\(id, "rescheduled", newDt\)/);
});
