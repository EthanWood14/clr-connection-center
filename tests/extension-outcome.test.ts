import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { composeLeadCaptureNotes, leadCaptureFrom, OUTCOME_TYPE_OPTIONS, resolveLeadSource } from "../shared/lead-capture";
import { INFO_FIELDS as CLIENT_INFO_FIELDS } from "../client/src/lib/lead-capture";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");

/**
 * "Enter all transfer information right from the extension." The panel on
 * the Bonzo page asks what Input Results asks and logs through the same
 * server path, so nothing downstream can tell the two apart.
 */

test("the client's lead card IS the shared one, and the composer handles a raw client object", () => {
  assert.ok(CLIENT_INFO_FIELDS.some((f) => f.name === "infoAddress"));
  const capture = leadCaptureFrom({
    leadSource: "Retail (Meta)", qualOwnHome: "yes", qualBankruptcy: "no", qualInvestment: "maybe",
    infoAddress: " 57 Tall Oaks Court ", infoCreditScore: "620-720", infoCreditScoreExact: "660",
    naHeloc: "yes", infoIncome: "10000", infoEmployment: "W2", infoEmploymentNotes: "gotcha OT",
    bogus: "dropped",
  });
  assert.equal(capture.qualInvestment, "", "only yes/no survive on a qualification answer");
  assert.equal(capture.infoAddress, "57 Tall Oaks Court");
  assert.ok(!("bogus" in capture));
  assert.equal(resolveLeadSource(capture), "Retail (Meta)");
  const notes = composeLeadCaptureNotes(capture);
  assert.match(notes, /^Lead Source: Retail \(Meta\)/);
  assert.match(notes, /Owns Home: Yes\nBankruptcy Last 6 Months: No/);
  assert.match(notes, /Property Address: 57 Tall Oaks Court/);
  assert.match(notes, /HELOC: N\/A/);
  assert.match(notes, /W2\/SE\/Retired: W2 — gotcha OT/);
  assert.equal(OUTCOME_TYPE_OPTIONS.map((o) => o.value).join(","), "transfer,appointment,deferral,fell_through,no_answer,not_interested,wrong_number,other");
});

test("POST /api/outcomes and the extension share one implementation", () => {
  assert.match(routes, /function createOutcomeFromBody\(sessionUser: any, rawBody: any\): \{ status: number; body: any \}/);
  const route = routes.slice(routes.indexOf('app.post("/api/outcomes", (req: any, res) => {'), routes.indexOf('app.post("/api/outcomes", (req: any, res) => {') + 300);
  assert.match(route, /const result = createOutcomeFromBody\(req\.session_user, req\.body\);/);
  assert.match(route, /res\.status\(result\.status\)\.json\(result\.body\);/);
  const fn = routes.slice(routes.indexOf("function createOutcomeFromBody("), routes.indexOf('app.post("/api/outcomes"'));
  // No response object inside the shared function — every exit is a return.
  assert.doesNotMatch(fn, /res\.(status|json)\(/);
  assert.match(fn, /return \{ status: 400, body: \{ error: "loId is required for everything except appointments" \} \};/);
  assert.match(fn, /return \{ status: 200, body: outcome\.outcomeType === "transfer"/);
  // The follow-through the extension must inherit: Bonzo push, appointment and transfer syncs.
  assert.match(fn, /syncAppointmentToBonzo\(outcome\.id\)/);
  assert.match(fn, /syncTransferToBonzo\(outcome\.id\)/);
});

test("the extension endpoints use the extension auth, are let through the API guard, and never trust the page for identity", () => {
  assert.match(routes, /req\.path === "\/extension\/outcome" \|\| req\.path === "\/extension\/outcome-options"\) return next\(\);/);
  assert.match(routes, /app\.get\("\/api\/extension\/outcome-options", shotgunExtensionAuth,/);
  assert.match(routes, /app\.post\("\/api\/extension\/outcome", shotgunExtensionAuth, async/);
  const submit = routes.slice(routes.indexOf('app.post("/api/extension/outcome"'), routes.indexOf('app.get("/api/lo-newest-leads"'));
  assert.match(submit, /const fetched = await getProspectDetail\(prospectId\);/);
  assert.match(submit, /if \(fetched\.detail\.fullName\.length >= 2\) borrowerName = fetched\.detail\.fullName;/);
  assert.match(submit, /conversationNotes: outcomeType === "transfer" \|\| outcomeType === "appointment" \? composeLeadCaptureNotes\(capture\) \|\| null : null/);
  assert.match(submit, /leadSource: resolveLeadSource\(capture\)/);
  assert.match(submit, /assistantId: userId,/);
  assert.match(submit, /const result = createOutcomeFromBody\(req\.session_user, body\);/);
  // The options come from the shared definitions, not a second list.
  const options = routes.slice(routes.indexOf('app.get("/api/extension/outcome-options"'), routes.indexOf('app.post("/api/extension/outcome"'));
  assert.match(options, /qualQuestions: QUAL_QUESTIONS,/);
  assert.match(options, /infoFields: INFO_FIELDS,/);
  assert.match(options, /sectionToggles: SECTION_TOGGLES,/);
  assert.match(options, /leadSources: LEAD_SOURCE_OPTIONS,/);
  assert.match(options, /assignedToday: assigned\.has\(Number\(lo\.id\)\)/);
});

test("the extension ships the panel and wires it end to end", () => {
  const manifest = JSON.parse(read("chrome-extension/manifest.json"));
  assert.equal(manifest.version, "1.4.0");
  const iso = manifest.content_scripts.find((c: any) => c.js.includes("content.js"));
  assert.ok(iso.js.includes("outcome-panel.js"), "outcome-panel.js must be a content script");
  assert.match(read("script/build-extension.py"), /"outcome-panel\.js"/);
  const content = read("chrome-extension/content.js");
  assert.match(content, /c3-log-result-button/);
  assert.match(content, /new CustomEvent\("c3:open-outcome"/);
  assert.match(content, /logBtn\.style\.display = current \? "inline-flex" : "none";/);
  const panel = read("chrome-extension/outcome-panel.js");
  assert.match(panel, /type: "c3shotgun\.options"/);
  assert.match(panel, /type: "c3shotgun\.outcome"/);
  assert.match(panel, /addEventListener\("c3:open-outcome"/);
  // The questions are drawn from the server, not hard-coded in the panel.
  assert.match(panel, /o\.qualQuestions\.forEach/);
  assert.match(panel, /o\.infoFields\.filter/);
  assert.doesNotMatch(panel, /Bankruptcy in the last 6 months/);
  const bg = read("chrome-extension/background.js");
  assert.match(bg, /c3\("\/api\/extension\/outcome-options"\)/);
  assert.match(bg, /c3\("\/api\/extension\/outcome", \{ method: "POST"/);
});
