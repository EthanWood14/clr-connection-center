import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  emptyLeadCapture, resolveLeadSource, composeLeadCaptureNotes, leadCaptureHasContent,
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
    qualCredit500: "yes" as const,
    qualCreditEst: "640",
    infoGoal: "Debt consolidation",
    infoValue: "$450,000",
  };
  const out = composeLeadCaptureNotes(c);
  assert.equal(out.split("\n\n").length, 3, "source, qualification, info — three blocks");
  assert.match(out, /^Lead Source: CallTools/);
  assert.match(out, /Owns Home: Yes/);
  assert.match(out, /Bankruptcy Last 6 Months: No/);
  assert.match(out, /Credit Over 500 \(est\): Yes \(640\)/);
  assert.match(out, /Goal: Debt consolidation/);
  assert.match(out, /Home Value: \$450,000/);
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
