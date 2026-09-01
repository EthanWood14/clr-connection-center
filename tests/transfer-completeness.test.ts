import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreTransfer, summarizeCompleteness, capturedLabels,
  CAPTURE_LABELS, TRANSFER_COMPLETENESS_FIELDS,
} from "../shared/transfer-completeness";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const capture = readFileSync(join(root, "client/src/lib/lead-capture.ts"), "utf8");
const mgr = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");

const blank = {
  borrowerName: "", phoneNumber: "", leadSource: "", conversationNotes: "",
  notes: "", loId: null, transferType: "", loaId: null, loHasLoa: false,
};

test("the score is every fillable field, not a chosen few", () => {
  // 6 stored fields + 23 capture answers when no LOA applies.
  assert.equal(scoreTransfer(blank).expected, 6 + CAPTURE_LABELS.length);
  assert.equal(CAPTURE_LABELS.length, 23);
  // With an LOA expected it is one more.
  assert.equal(scoreTransfer({ ...blank, loHasLoa: true }).expected, 7 + CAPTURE_LABELS.length);
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
  assert.equal(sum.expected, 2 * (6 + CAPTURE_LABELS.length));
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
