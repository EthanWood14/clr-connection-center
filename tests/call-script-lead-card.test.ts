import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  emptyLeadCapture, resolveLeadSource, composeLeadCaptureNotes, leadCaptureHasContent,
  INFO_FIELDS, QUAL_QUESTIONS,
} from "../client/src/lib/lead-capture";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/call-script.tsx"), "utf8");
const panel = readFileSync(join(root, "client/src/components/lead-capture-panel.tsx"), "utf8");

test("the composed block reads the way LOs already expect", () => {
  const c = {
    ...emptyLeadCapture(),
    leadSource: "CallTools",
    qualOwnHome: "yes" as const,
    qualBankruptcy: "no" as const,
    infoCreditScore: "620-720",
    infoGoal: "Debt consolidation",
    infoValue: "$450,000",
  };
  const out = composeLeadCaptureNotes(c);
  assert.equal(out.split("\n\n").length, 3, "source, qualification, info — three blocks");
  assert.match(out, /^Lead Source: CallTools/);
  assert.match(out, /Owns Home: Yes/);
  assert.match(out, /Bankruptcy Last 6 Months: No/);
  assert.match(out, /Credit Score: 620-720/);
  assert.match(out, /Goal \/ Debts to Pay Off: Debt consolidation/);
  assert.match(out, /Estimated Home Value: \$450,000/);
  // Untouched fields are omitted, not rendered as blank labels.
  assert.ok(!out.includes("Address:"));
  assert.ok(!out.includes("Military:"));
});

test("an investment-property yes carries the routing instruction into the notes", () => {
  const out = composeLeadCaptureNotes({ ...emptyLeadCapture(), qualInvestment: "yes" });
  assert.match(out, /give to LOA Justin, Mateo, or John/);
});

test("the stored lead source is what the CLR typed, never the word other", () => {
  assert.equal(resolveLeadSource({ leadSource: "other", leadSourceOther: " Facebook DM " }), "Facebook DM");
  assert.equal(resolveLeadSource({ leadSource: "other", leadSourceOther: "  " }), null);
  assert.equal(resolveLeadSource({ leadSource: "Mojo", leadSourceOther: "" }), "Mojo");
  assert.equal(resolveLeadSource({ leadSource: "", leadSourceOther: "" }), null);
});

test("an untouched card composes to nothing and reads as empty", () => {
  assert.equal(composeLeadCaptureNotes(emptyLeadCapture()), "");
  assert.equal(leadCaptureHasContent(emptyLeadCapture()), false);
  assert.equal(leadCaptureHasContent({ ...emptyLeadCapture(), infoGoal: "HELOC" }), true);
});

test("the script page mounts the Lead Card beside the runner", () => {
  assert.match(page, /<LeadCapturePanel capture=\{capture\} onChange=\{setCapture\} \/>/);
  assert.match(page, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/, "two panes on desktop");
  assert.match(page, /lg:sticky/, "the card stays reachable while the script scrolls");
  assert.match(panel, /QUAL_QUESTIONS\.map/, "the panel renders the same shared questions");
  assert.match(panel, /INFO_FIELDS\.map/);
});

test("the logged outcome carries the captured card, and the card resets after", () => {
  const submit = page.slice(page.indexOf("const submitMut = useMutation"), page.indexOf("if (step === \"idle\")"));
  assert.match(submit, /resolveLeadSource\(capture\)/);
  assert.match(submit, /composeLeadCaptureNotes\(capture\)/);
  assert.match(submit, /onCaptureConsumed\(\)/, "a logged call must not leak its card into the next one");
  assert.match(page, /onCaptureConsumed=\{\(\) => setCapture\(emptyLeadCapture\(\)\)\}/);
});

test("setup folds away once a call is underway", () => {
  assert.match(page, /if \(isRecording\) setSetupOpen\(false\)/);
  assert.match(page, /data-testid="button-toggle-setup"/, "…but stays one tap away");
  // The borrower input must never be inside the collapsible section — it feeds
  // the script placeholders live during the call.
  const bar = page.slice(page.indexOf("Always-visible call bar"), page.indexOf("Placeholder controls: timezone"));
  assert.match(bar, /data-testid="script-borrower-name"/);
});

test("employment, credit and military are fixed choices, with notes beside them", () => {
  // These were free text, so the same answer arrived spelled a dozen ways and
  // could not be counted. Credit was asked twice — a yes/no "over 500?" plus a
  // separate "Credit score" box — and the two disagreed in practice.
  const withChoices = INFO_FIELDS.filter(f => f.options);
  assert.deepEqual(withChoices.map(f => f.name), ["infoCreditScore", "infoEmployment", "infoMilitary"]);
  assert.deepEqual(
    INFO_FIELDS.find(f => f.name === "infoCreditScore")!.options,
    ["500-580", "580-620", "620-720", "720+"],
  );
  assert.deepEqual(INFO_FIELDS.find(f => f.name === "infoEmployment")!.options, ["W2", "SE", "Retired"]);
  assert.deepEqual(INFO_FIELDS.find(f => f.name === "infoMilitary")!.options, ["Yes", "No"]);
  // Employment and military carry a notes box. Credit has its own exact-score
  // field beside the band, so the band itself still needs no prose box.
  assert.equal(INFO_FIELDS.find(f => f.name === "infoEmployment")!.notes, "infoEmploymentNotes");
  assert.equal(INFO_FIELDS.find(f => f.name === "infoMilitary")!.notes, "infoMilitaryNotes");
  assert.equal(INFO_FIELDS.find(f => f.name === "infoCreditScore")!.notes, undefined);

  // Credit is asked once now — the qualification list no longer duplicates it.
  assert.ok(!QUAL_QUESTIONS.some(q => /credit/i.test(q.label)), "no second credit question");
});

test("the lead card covers a complete two-borrower and lien profile", () => {
  const names = INFO_FIELDS.map(f => f.name);
  for (const field of [
    "infoBorrowerEmail", "infoBorrowerDob", "infoBorrowerSsnLast4", "infoCreditScoreExact",
    "infoCoborrowerName", "infoCoborrowerDob", "infoCoborrowerSsnLast4", "infoCoborrowerCreditScore",
    "infoHelocBalance", "infoHelocRate", "infoHelocPayment",
  ]) {
    assert.ok(names.includes(field as any), `${field} must be collected`);
  }
  assert.equal(INFO_FIELDS.find(f => f.name === "infoBorrowerSsnLast4")!.maxLength, 4);
  assert.equal(INFO_FIELDS.find(f => f.name === "infoCoborrowerSsnLast4")!.maxLength, 4);
  assert.match(panel, /never enter a full SSN/i);

  const out = composeLeadCaptureNotes({
    ...emptyLeadCapture(),
    infoBorrowerEmail: "borrower@example.test",
    infoCoborrowerName: "Co Borrower",
    infoBalance: "$200,000",
    infoHelocBalance: "$40,000",
  });
  assert.match(out, /Borrower Email: borrower@example\.test/);
  assert.match(out, /Co-Borrower Name: Co Borrower/);
  assert.match(out, /First Mortgage Balance: \$200,000/);
  assert.match(out, /HELOC Balance: \$40,000/);
});

test("a choice and its notes compose onto one line", () => {
  const out = composeLeadCaptureNotes({
    ...emptyLeadCapture(),
    infoMilitary: "Yes", infoMilitaryNotes: "Navy, 6 years",
    infoEmployment: "W2", infoEmploymentNotes: "plus 1099 side work",
  });
  assert.match(out, /Military: Yes — Navy, 6 years/);
  assert.match(out, /W2\/SE\/Retired: W2 — plus 1099 side work/);
});

test("notes with no choice still make it into the block", () => {
  // Somebody may type detail before tapping a button; losing it would be worse
  // than an odd-looking line.
  const out = composeLeadCaptureNotes({ ...emptyLeadCapture(), infoMilitaryNotes: "Spouse is active duty" });
  assert.match(out, /Military: Spouse is active duty/);
});
