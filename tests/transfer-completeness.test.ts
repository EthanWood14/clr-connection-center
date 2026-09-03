import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreTransfer, summarizeCompleteness, capturedLabels,
  CAPTURE_LABELS, TRANSFER_COMPLETENESS_FIELDS,
  UNSCORED_LABELS, QUAL_LABELS, QUAL_WEIGHT,
  qualAnswer, isInvestmentProperty, INVESTMENT_PROPERTY_LABEL,
} from "../shared/transfer-completeness";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const capture = readFileSync(join(root, "client/src/lib/lead-capture.ts"), "utf8");
const mgr = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");

const blank = {
  borrowerName: "", phoneNumber: "", leadSource: "", conversationNotes: "",
  notes: "", loId: null, transferType: "", loaId: null, loHasLoa: false,
};

const SCORED = CAPTURE_LABELS.filter((l) => !UNSCORED_LABELS.has(l));
/** 6 stored fields, 18 plain capture answers, 3 qualification answers at 4x. */
const BLANK_WEIGHT = 6 + (SCORED.length - QUAL_LABELS.length) + QUAL_LABELS.length * QUAL_WEIGHT;

test("the score is every fillable field, not a chosen few", () => {
  assert.equal(SCORED.length, 21);
  assert.equal(scoreTransfer(blank).expected, BLANK_WEIGHT);
  // With an LOA expected it is one more.
  assert.equal(scoreTransfer({ ...blank, loHasLoa: true }).expected, BLANK_WEIGHT + 1);
});

test("nothing filled is 0%, everything filled is 100%", () => {
  assert.equal(summarizeCompleteness([blank]).pct, 0);
  const every = {
    ...blank,
    borrowerName: "Maria", phoneNumber: "7025551234", leadSource: "Single Dialing",
    loId: 8, transferType: "direct", notes: "n",
    conversationNotes: CAPTURE_LABELS.map((l) => `${l}: yes`).join("\n"),
  };
  assert.equal(summarizeCompleteness([every]).pct, 100);
});

test("capture answers are read out of the composed note", () => {
  const blob = [
    "Lead Source: Single Dialing",
    "",
    "Owns Home: Yes",
    "Bankruptcy Last 6 Months: No",
    "",
    "Property Address: 12 Main St",
    "Monthly Income: 6500",
  ].join("\n");
  const found = capturedLabels(blob);
  assert.ok(found.has("Owns Home"));
  assert.ok(found.has("Property Address"));
  assert.ok(found.has("Monthly Income"));
  assert.ok(!found.has("Military"));
});

test("a label is matched at the start of a line, never as a substring", () => {
  // "Credit Score" is inside both of these. A plain includes() would count the
  // borrower's credit score as answered when only the co-borrower's was.
  const blob = "Co-Borrower Credit Score: 700\nExact Borrower Credit Score: 712";
  const found = capturedLabels(blob);
  assert.ok(found.has("Co-Borrower Credit Score"));
  assert.ok(found.has("Exact Borrower Credit Score"));
  assert.ok(!found.has("Credit Score"), "the plain credit band was not answered");
});

test("a label with no value after it does not count", () => {
  assert.ok(!capturedLabels("Property Address:").has("Property Address"));
  assert.ok(!capturedLabels("Property Address:    ").has("Property Address"));
  assert.ok(capturedLabels("Property Address: 12 Main St").has("Property Address"));
});

test("an LOA is only expected where the loan officer has one", () => {
  // On prod, scoring LOA against every transfer gives 43.1%; scoring it only
  // where it applies gives 84.1%.
  const withLoa = { ...blank, loHasLoa: true };
  assert.ok(scoreTransfer(withLoa).missing.includes("loaId"));
  assert.ok(!scoreTransfer(blank).missing.includes("loaId"));
});

test("the average is over fields, not over transfers", () => {
  const a = { ...blank, borrowerName: "A" };
  const b = { ...blank };
  const sum = summarizeCompleteness([a, b]);
  assert.equal(sum.expected, 2 * BLANK_WEIGHT);
  assert.equal(sum.filled, 1);
  assert.equal(sum.transfers, 2);
  assert.equal(sum.complete, 0);
});

test("nothing to score reports nothing rather than zero", () => {
  assert.equal(summarizeCompleteness([]).pct, null);
});

test("the labels track the composer that writes them", () => {
  // These strings are matched against stored text. If composeLeadCaptureNotes
  // renames one, the field silently reads as never filled — so every label
  // must still appear in that function.
  const composer = capture.slice(capture.indexOf("export function composeLeadCaptureNotes"));
  for (const label of CAPTURE_LABELS) {
    assert.ok(composer.includes(`"${label}`) || composer.includes(`${label}: `),
      `composeLeadCaptureNotes no longer writes "${label}"`);
  }
});

test("the scorecard carries the column, and the server the value", () => {
  assert.match(mgr, /key: "writeUp",\s+label: "Write-up"/);
  assert.match(mgr, /r\.writeUpPct == null \? "—"/, "no transfers shows a dash, not 0%");
  assert.match(routes, /writeUpPct: writeUpByUser\.has\(u\.id\)/);
  // Scored per CLR from one scan, org-scoped.
  const block = routes.slice(routes.indexOf("// Write-up completeness per CLR"), routes.indexOf("const leaderboard = countedClrs"));
  assert.match(block, /WHERE org_id = \? AND outcome_type='transfer'/);
  assert.match(block, /catch \{/, "the column must never break the dashboard");
});

test("every field the score counts is one a person can actually fill", () => {
  const keys = TRANSFER_COMPLETENESS_FIELDS.map((f) => f.key);
  // System and derived columns must never be counted — nobody can raise them.
  for (const derived of ["id", "createdAt", "updatedAt", "verificationStatus", "bonzoProspectId", "orgId", "assistantId", "date", "outcomeType", "tags"]) {
    assert.ok(!keys.includes(derived), `${derived} is not something a person fills in`);
  }
});

const panel = readFileSync(join(root, "client/src/components/lead-capture-panel.tsx"), "utf8");
const wizard = readFileSync(join(root, "client/src/pages/outcomes.tsx"), "utf8");

const answered = (labels: string[]) => labels.map((l) => `${l}: yes`).join("\n");

test("a qualification answer is worth four of anything else", () => {
  // They decide whether the lead is workable at all. Missing the home-ownership
  // answer is not one-twenty-first of a problem.
  assert.equal(QUAL_WEIGHT, 4);
  const onlyQual = { ...blank, conversationNotes: answered([...QUAL_LABELS]) };
  const onlyPlain = { ...blank, conversationNotes: answered(SCORED.filter((l) => !QUAL_LABELS.includes(l as any)).slice(0, 3)) };
  // Same three answers either way; the qualification ones move the score 4x.
  assert.equal(scoreTransfer(onlyQual).filled, 3 * QUAL_WEIGHT);
  assert.equal(scoreTransfer(onlyPlain).filled, 3);
});

test("borrower email and the exact score are asked, and not counted", () => {
  for (const label of ["Borrower Email", "Exact Borrower Credit Score"]) {
    assert.ok(UNSCORED_LABELS.has(label), `${label} should not be scored`);
    // Still on the form: dropping the field is a different decision from
    // dropping it out of the score.
    assert.ok(capture.includes(`"${label}"`), `${label} should still be captured`);
    assert.ok(!TRANSFER_COMPLETENESS_FIELDS.some((f) => f.label === label));
  }
  // The band it replaces IS still scored.
  assert.ok(TRANSFER_COMPLETENESS_FIELDS.some((f) => f.label === "Credit Score"));
});

test("a section marked N/A stops being expected", () => {
  const base = BLANK_WEIGHT;
  for (const [marker, value, fields] of [
    ["Co-Borrower", "N/A", ["Co-Borrower Name", "Co-Borrower DOB", "Co-Borrower Credit Score"]],
    ["First Mortgage", "Free and clear", ["First Mortgage Balance", "First Mortgage Rate", "Monthly PITI / Payment"]],
    ["HELOC", "N/A", ["HELOC Balance", "HELOC Rate", "HELOC Monthly Payment"]],
  ] as Array<[string, string, string[]]>) {
    const row = { ...blank, conversationNotes: `${marker}: ${value}` };
    const score = scoreTransfer(row);
    assert.equal(score.expected, base - fields.length, `${marker} should drop ${fields.length} fields`);
    for (const f of fields) {
      assert.ok(!score.missing.includes(`capture:${f}`), `${f} is still being asked for`);
    }
  }
});

test("saying a section is N/A earns no credit on its own", () => {
  // Otherwise the cheapest route to a good score is to declare everything
  // absent. It removes the ask; it does not answer anything.
  const naEverything = {
    ...blank,
    conversationNotes: ["Co-Borrower: N/A", "First Mortgage: Free and clear", "HELOC: N/A"].join("\n"),
  };
  assert.equal(scoreTransfer(naEverything).filled, 0);
  assert.equal(summarizeCompleteness([naEverything]).pct, 0);
  // And the markers themselves are never scored fields.
  for (const m of ["Co-Borrower", "First Mortgage", "HELOC"]) {
    assert.ok(!TRANSFER_COMPLETENESS_FIELDS.some((f) => f.label === m), `${m} must not be a field`);
  }
});

test("a real co-borrower is not marked down for having one", () => {
  // The marker exists so "there isn't one" and "nobody asked" stop looking
  // identical -- it must not become a field that everyone else is missing.
  const hasOne = { ...blank, conversationNotes: answered(["Co-Borrower Name", "Co-Borrower DOB", "Co-Borrower Credit Score"]) };
  assert.equal(scoreTransfer(hasOne).expected, BLANK_WEIGHT);
  assert.equal(scoreTransfer(hasOne).filled, 3);
});

test("the composer writes the marker in place of the section", () => {
  const composer = capture.slice(capture.indexOf("export function composeLeadCaptureNotes"));
  assert.match(composer, /c\.naCoborrower === "yes"/);
  assert.match(composer, /\["Co-Borrower", "N\/A"\]/);
  assert.match(composer, /c\.mortgageFreeClear === "yes"/);
  assert.match(composer, /\["First Mortgage", "Free and clear"\]/);
  assert.match(composer, /c\.naHeloc === "yes"/);
  assert.match(composer, /\["HELOC", "N\/A"\]/);
  // A marker line must not collide with the fields it covers: "HELOC:" and
  // "HELOC Balance:" are told apart by the colon, so both must keep it.
  for (const m of ["Co-Borrower", "First Mortgage", "HELOC"]) {
    assert.ok(!capturedLabels(`${m} Balance: 100`).has(m), `${m} matched a field line`);
  }
  assert.ok(capturedLabels("HELOC: N/A").has("HELOC"));
});

test("both capture surfaces offer the same three N/A toggles", () => {
  // One definition, or the Script page and the wizard drift apart and the same
  // call gets written up two different ways.
  assert.match(capture, /export const SECTION_TOGGLES/);
  for (const name of ["naCoborrower", "mortgageFreeClear", "naHeloc"]) {
    assert.ok(capture.includes(name), `${name} missing from the shared definition`);
    assert.ok(wizard.includes(name), `${name} missing from Input Results`);
  }
  for (const src of [wizard, panel]) {
    assert.match(src, /toggleForSection\(f\.section\)/);
    assert.match(src, /naSections\.has\(f\.section\) \? null : \(/);
  }
  // Free and clear is a first-mortgage answer, not a co-borrower one.
  assert.match(capture, /name: "mortgageFreeClear", section: "First mortgage", label: "Free and clear"/);
});

test("the routing note sits on the investment question itself", () => {
  const qual = capture.slice(capture.indexOf("export const QUAL_QUESTIONS"), capture.indexOf("CREDIT_SCORE_BANDS"));
  assert.match(qual, /name: "qualInvestment"[^}]*hint: INVESTMENT_ROUTING_HINT/);
  for (const src of [wizard, panel]) assert.match(src, /\{q\.hint\}/);
  for (const name of [/justin/i, /mateo/i, /john/i]) assert.match(capture, name);
});

test("describing a section is not the same as saying it is absent", () => {
  // The Shotgun result path stores a CLR's raw note straight into
  // conversation_notes, so free prose really does reach this parser. A note
  // saying there IS a mortgage must not delete the mortgage questions.
  const prose = [
    "Co-Borrower: wife is on the loan",
    "First Mortgage: 320k at 6.5%",
    "HELOC: has one, about 40k",
  ].join("\n");
  const described = { ...blank, conversationNotes: prose };
  assert.equal(scoreTransfer(described).expected, BLANK_WEIGHT,
    "affirming a section must not remove it from the score");
  for (const m of ["Co-Borrower", "First Mortgage", "HELOC"]) {
    assert.ok(!capturedLabels(prose).has(m), `${m} fired on prose`);
  }
  // Only the exact wording the composer writes counts, and it is case-blind.
  assert.ok(capturedLabels("Co-Borrower: n/a").has("Co-Borrower"));
  assert.ok(capturedLabels("First Mortgage: FREE AND CLEAR").has("First Mortgage"));
  // Anything else fails closed: the section stays expected.
  assert.ok(!capturedLabels("First Mortgage: N/A").has("First Mortgage"));
  assert.ok(!capturedLabels("HELOC: none").has("HELOC"));
});

test("turning a section off empties the boxes it hides", () => {
  // Left behind, those values vanish from the LO handoff without anyone
  // seeing it, still count toward "N filled", and — if one is half-typed and
  // fails its own rule — block submit from a box that is no longer on screen.
  const wiz = readFileSync(join(root, "client/src/pages/outcomes.tsx"), "utf8");
  assert.match(wiz, /for \(const k of tg\.covers\) form\.setValue\(k as any, ""/);
  assert.match(wiz, /form\.clearErrors\(tg\.covers as any\)/);
  // The panel must do it in ONE update: two set() calls would each spread a
  // stale capture and the second would undo the first.
  assert.match(panel, /const setSection = \(tg: SectionToggle\)/);
  assert.match(panel, /if \(turningOn\) for \(const k of tg\.covers\)/);
  assert.match(panel, /onClick=\{\(\) => setSection\(tg\)\}/);
  // covers must name every field its section renders.
  for (const [tg, fields] of [
    ["naCoborrower", ["infoCoborrowerName", "infoCoborrowerDob", "infoCoborrowerCreditScore"]],
    ["mortgageFreeClear", ["infoBalance", "infoRate", "infoPayment"]],
    ["naHeloc", ["infoHelocBalance", "infoHelocRate", "infoHelocPayment"]],
  ] as Array<[string, string[]]>) {
    const block = capture.slice(capture.indexOf(`name: "${tg}"`));
    const covers = block.slice(block.indexOf("covers:"), block.indexOf("]", block.indexOf("covers:")));
    for (const f of fields) assert.ok(covers.includes(f), `${tg} does not clear ${f}`);
  }
});

test("a field that counts four times says so on the profile", () => {
  // Otherwise the one worth fixing first looks exactly like the one worth
  // fixing last.
  const profile = readFileSync(join(root, "client/src/pages/clr-profile.tsx"), "utf8");
  assert.match(profile, /data-testid="clr-completeness-weight"/);
  assert.match(profile, /\(f\.weight \?\? 1\) > 1 &&/);
  assert.match(profile, /weight\?: number/, "the response type must carry it");
});

// ── reading a qualification answer, not just noticing one ───────────────────
//
// capturedLabels asks "was this answered". The transfer-placement stat needs
// the ANSWER, because it hangs a compliance rule off it, so it reads through
// the same parse with the same discipline: label at the start of a line, value
// compared whole, everything else failing closed.

test("the investment label is one the composer writes and the score counts", () => {
  assert.ok((CAPTURE_LABELS as readonly string[]).includes(INVESTMENT_PROPERTY_LABEL));
  assert.ok((QUAL_LABELS as readonly string[]).includes(INVESTMENT_PROPERTY_LABEL));
  const composer = capture.slice(capture.indexOf("export function composeLeadCaptureNotes"));
  assert.ok(composer.includes(`${INVESTMENT_PROPERTY_LABEL}: `),
    "the label this reader keys off is the one the composer writes");
});

test("a Yes and a No are read; anything else is no answer at all", () => {
  assert.equal(qualAnswer("Investment/2nd Home: No", INVESTMENT_PROPERTY_LABEL), "no");
  // The composer rides its routing hint on a Yes; the answer is the head.
  assert.equal(
    qualAnswer("Investment/2nd Home: Yes — give to LOA Justin, Mateo, or John", INVESTMENT_PROPERTY_LABEL),
    "yes",
  );
  for (const line of [
    "Investment/2nd Home: probably",
    "Investment/2nd Home: Yes it is a rental",
    "Investment/2nd Home:",
    "Owns Home: Yes",
    "not an investment property",
    "",
  ]) {
    assert.equal(qualAnswer(line, INVESTMENT_PROPERTY_LABEL), null, line);
  }
});

test("only an app-composed Yes is an investment property", () => {
  assert.equal(isInvestmentProperty("Investment/2nd Home: Yes — give to LOA Justin, Mateo, or John"), true);
  assert.equal(isInvestmentProperty("Investment/2nd Home: No"), false);
  // The one that matters most: the note that says the opposite. A keyword
  // search would read this as a Yes.
  assert.equal(isInvestmentProperty("Not an investment property — they live there"), false);
  assert.equal(isInvestmentProperty(null), false);
});

test("the reader shares capturedLabels' line discipline", () => {
  const blob = "Owns Home: Yes\nInvestment/2nd Home: Yes — give to LOA Justin, Mateo, or John\nMilitary: No";
  // Both readers agree the answer is there...
  assert.ok(capturedLabels(blob).has(INVESTMENT_PROPERTY_LABEL));
  assert.equal(isInvestmentProperty(blob), true);
  // ...and both refuse it mid-sentence, for the same reason: a label is only a
  // label at the start of a line.
  const mid = "CLR asked about Investment/2nd Home: Yes was the answer";
  assert.ok(!capturedLabels(mid).has(INVESTMENT_PROPERTY_LABEL));
  assert.equal(isInvestmentProperty(mid), false);
});
