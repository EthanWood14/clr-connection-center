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
  // The routing note is part of the question now, not a banner that waits
  // for a Yes — you need to know where it goes before you answer.
  assert.match(page, /\{q\.hint\}/);
  assert.doesNotMatch(page, /qualInvestment"\) === "yes" &&/);
  assert.match(lib, /Do you own a home\?/);
  assert.match(lib, /must be Yes/);
  assert.match(lib, /Bankruptcy in the last 6 months\?/);
  assert.match(lib, /should be No/);
  assert.match(lib, /Investment property \/ secondary residence\?/);
  assert.match(lib, /justin/i);
  assert.match(lib, /mateo/i);
  assert.match(lib, /john/i);
  // Credit is no longer a qualification question: it was asked there AND in
  // Info Gathering, so it is one banded field now. Scoped to the array —
  // a whole-file scan would match the comment explaining the removal.
  const qualBlock = lib.slice(lib.indexOf("export const QUAL_QUESTIONS"), lib.indexOf("CREDIT_SCORE_BANDS"));
  assert.doesNotMatch(qualBlock, /name: "qualCredit/, "no credit question in the checklist");
  assert.match(lib, /CREDIT_SCORE_BANDS = \["500-580", "580-620", "620-720", "720\+"\]/);
  for (const label of ["Borrower email", "Borrower date of birth",
    "Exact borrower credit score", "Co-borrower name", "Co-borrower date of birth",
    "Co-borrower credit score", "Property address",
    "Goal / debts to pay off", "Cash needed / amount to take out", "Estimated home value",
    "First mortgage balance", "First mortgage rate", "Monthly PITI / payment",
    "HELOC balance", "HELOC rate", "HELOC monthly payment", "Monthly income",
    "Employment", "Borrower credit band", "Military"]) {
    assert.ok(lib.includes(label), `missing field: ${label}`);
  }
  assert.ok(page.includes("Other Notes"), "the Other Notes textarea stays on the page");
  assert.doesNotMatch(lib, /infoBorrowerSsn|infoCoborrowerSsn/);
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

// ── Reform: the page is built around what CLRs actually log ──────────────────
// Measured on prod over 2,759 transfers since 2026-06-01: transfers are 89% of
// all outcomes and phone is filled 92% of the time, while lead_timeframe,
// prequalification_notes, next_steps and lead_goal sit at 0.0% and
// lo_action_plan at 0.2%. The form opens on the common answer and puts the
// long tail behind one control.

test("the form opens on the answer for the case that is 89% of outcomes", () => {
  const entry = page.slice(page.indexOf("function OutcomeFormDialog"), page.indexOf("function EditOutcomeDialog"));
  assert.match(entry, /outcomeType: "transfer",/);
  assert.match(entry, /transferType: "direct",/, "Direct is the common shape - do not make them click it");
  // Editing must reflect what was recorded, never invent a transfer type.
  const edit = page.slice(page.indexOf("function EditOutcomeDialog"));
  assert.match(edit, /transferType: null,/, "editing must not preselect");
});

test("the long tail is collapsed, but never hidden silently", () => {
  assert.match(page, /data-testid="toggle-info-gathering"/);
  assert.match(page, /\{showInfo && \(/, "the section collapses");
  assert.match(page, /INFO_FIELDS\.map\(\(f, index\) =>/, "the shared field list still drives it");
  // A collapsed section that hid filled values would be a trap.
  assert.match(page, /infoFilledCount/, "the header must say how many are filled");
});

test("burst entry keeps the form up but never carries one call into the next", () => {
  assert.match(page, /data-testid="button-log-and-next"/);
  const reset = page.slice(page.indexOf("if (!resetSignal) return;"), page.indexOf("setConfirmBonzo(false);"));
  assert.ok(reset.length > 0, "there must be a reset between calls");
  // Routing repeats between calls; who you spoke to never does.
  for (const keep of ["outcomeType", "transferType", "loId", "loaId"]) {
    assert.ok(reset.includes(keep), keep + " should carry over");
  }
  for (const clear of ["borrowerName", "phoneNumber", "notes", "leadSource", "qualOwnHome", "conversationNotes"]) {
    assert.ok(!reset.includes(clear), clear + " must NOT carry into the next call");
  }
});

test("a normal submit does not accidentally behave as Log & next", () => {
  // form.handleSubmit passes the submit EVENT as its second argument, which
  // would arrive as a truthy keepOpen and leave the dialog open every time.
  // Only the entry dialog's onSubmit takes keepOpen, so only it must wrap.
  const entry = page.slice(page.indexOf("function OutcomeFormDialog"), page.indexOf("function EditOutcomeDialog"));
  assert.match(entry, /form\.handleSubmit\(\(v\) => onSubmit\(v\)\)/);
  assert.ok(!/handleSubmit\(onSubmit\)/.test(entry), "the entry form must not pass onSubmit bare");
});

test("the dialog is wide enough to see the form it contains", () => {
  assert.ok(!/DialogContent className="max-w-lg p-0 gap-0 max-h-\[92vh\]/.test(page),
    "a ~50-field form does not fit in 512px");
  assert.match(page, /DialogContent className="max-w-3xl/);
});

test("the running count is the logger's own work, on the form's own date", () => {
  assert.match(page, /data-testid="text-today-count"/);
  const scope = page.slice(page.indexOf("const todayStr = businessTodayClient()"), page.indexOf("const filtered ="));
  assert.match(scope, /businessTodayClient\(\)/, "must agree with the date the form defaults to");
  assert.match(scope, /Number\(o\.assistantId\) === Number\(authUser\.id\)/,
    "the counter describes YOUR entries, not the current filter");
});

test("short fields share a row instead of each taking the full width", () => {
  const entry = page.slice(page.indexOf("function OutcomeFormDialog"), page.indexOf("function EditOutcomeDialog"));
  // A date picker spanning a 768px dialog is wasted space, and one field per
  // line turns a wide window straight back into a long scroll.
  const rows = entry.match(/grid gap-3 sm:grid-cols-2/g) ?? [];
  assert.ok(rows.length >= 4, "expected several paired rows, found " + rows.length);
  for (const pair of [["input-outcome-date", "select-assistant"], ["input-borrower-name", "input-phone-number"], ["select-lo", "LoaPicker"]]) {
    const i = entry.indexOf(pair[0]), j = entry.indexOf(pair[1]);
    assert.ok(i > 0 && j > 0, pair[0] + " / " + pair[1] + " must both exist");
    const between = entry.slice(Math.min(i, j), Math.max(i, j));
    assert.ok(!/grid gap-3 sm:grid-cols-2/.test(between), pair[0] + " and " + pair[1] + " belong in the same row");
  }
  // Three qualification answers on one line, not three.
  assert.match(entry, /grid gap-2 sm:grid-cols-3/);
  // The 20 info fields are two-up, with section headings breaking the row.
  assert.match(entry, /grid gap-x-4 gap-y-2 sm:grid-cols-2/);
  assert.match(entry, /uppercase tracking-wide text-muted-foreground">\{f\.section\}/);
});
