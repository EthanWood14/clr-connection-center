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

test("everything is on one page — no steps at all", () => {
  // The wizard used to be a full-screen result picker, then details, then
  // qualification. It is now a single scrolling form.
  assert.ok(!/const totalSteps/.test(page), "the step counter must be gone");
  assert.ok(!/setStep\(/.test(page), "nothing may navigate between steps");
  assert.ok(!/function StepIndicator/.test(page), "the step indicator must be gone");
  assert.ok(!/handleNext|handleBack/.test(page), "Next/Back must be gone");
  assert.ok(!page.includes("Step 3: Lead Information"));
  assert.ok(!page.includes("appointment_transfer"));
});

test("the outcome picker sits at the top and is always changeable", () => {
  // It was a separate screen that had to be cleared before any field appeared.
  assert.match(page, /Outcome type — the first thing on the page/);
  assert.match(page, /role="radiogroup" aria-label="What was the result\?"/);
  assert.match(page, /aria-checked=\{active\}/);
  assert.ok(!/Selected outcome chip with Change link/.test(page),
    "the chip and its Change link are redundant once the picker never leaves");
  // The picker only sets the value now; it no longer advances anything.
  const pick = page.slice(page.indexOf("const pickOutcome"), page.indexOf("const handleSkip"));
  assert.ok(!/setStep/.test(pick));
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
  // Credit is no longer a qualification question: it was asked there AND in
  // Info Gathering, so it is one banded field now. Scoped to the array —
  // a whole-file scan would match the comment explaining the removal.
  const qualBlock = lib.slice(lib.indexOf("QUAL_QUESTIONS"), lib.indexOf("INVESTMENT_ROUTING_HINT"));
  assert.doesNotMatch(qualBlock, /name: "qualCredit/, "no credit question in the checklist");
  assert.match(lib, /CREDIT_SCORE_BANDS = \["500-580", "580-620", "620-720", "720\+"\]/);
  for (const label of ["Borrower email", "Borrower date of birth", "Borrower SSN — last 4 only",
    "Exact borrower credit score", "Co-borrower name", "Co-borrower date of birth",
    "Co-borrower SSN — last 4 only", "Co-borrower credit score", "Property address",
    "Goal / debts to pay off", "Cash needed / amount to take out", "Estimated home value",
    "First mortgage balance", "First mortgage rate", "Monthly PITI / payment",
    "HELOC balance", "HELOC rate", "HELOC monthly payment", "Monthly income",
    "Employment", "Borrower credit band", "Military"]) {
    assert.ok(lib.includes(label), `missing field: ${label}`);
  }
  assert.ok(page.includes("Other Notes"), "the Other Notes textarea stays on the page");
  assert.match(page, /Never enter a full Social Security number/);
  assert.match(page, /keep full SSNs out of Other Notes/);
  assert.match(page, /replace\(\/\\D\/g, ""\)\.slice\(0, f\.maxLength\)/,
    "digit-only protected inputs must be constrained before form state sees them");
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
