import { test } from "node:test";
import assert from "node:assert/strict";
import { transferInformationPatch, transferEditInitialValues, transferInformationChanges } from "../shared/transfer-edit";
import { summarizeCompleteness } from "../shared/transfer-completeness";
import { emptyLeadCapture, composeLeadCaptureNotes, composeEditedLeadCaptureNotes, parseLeadCaptureNotes } from "../shared/lead-capture";
import { readFileSync } from "node:fs";

test("editing saved information raises and lowers the write-up score without another transfer", () => {
  const original = { id: 42, assistantId: 7, date: "2026-09-10", outcomeType: "transfer", loId: 8, transferType: "direct", loHasLoa: false, notes: "", conversationNotes: "" };
  const corrected = { ...original, ...transferInformationPatch({ borrowerName: "Example", phoneNumber: "7025550100", leadSource: "Single Dialing", notes: "Discussed refinancing", conversationNotes: "Owns Home: Yes\nBankruptcy Last 6 Months: No\nInvestment/2nd Home: No" }) };
  assert.ok(summarizeCompleteness([corrected]).pct > summarizeCompleteness([original]).pct);
  const cleared = { ...corrected, ...transferInformationPatch({ conversationNotes: "", phoneNumber: "" }) };
  assert.ok(summarizeCompleteness([cleared]).pct < summarizeCompleteness([corrected]).pct);
  assert.equal(corrected.id, original.id);
  assert.equal(corrected.assistantId, original.assistantId);
  assert.equal(corrected.date, original.date);
});

test("only supplied editable fields are included and explicit clears are preserved", () => {
  assert.deepEqual(transferInformationPatch({ phoneNumber: "123", conversationNotes: null }), { phoneNumber: "123", conversationNotes: "" });
  assert.deepEqual(transferInformationPatch({ id: 99, assistantId: 3, date: "tomorrow", notes: "updated" } as any), { notes: "updated" });
});

test("every original intake field reopens in the same field without losing information", () => {
  const capture = {
    ...emptyLeadCapture(), leadSource: "other", leadSourceOther: "Legacy referral",
    qualOwnHome: "yes" as const, qualBankruptcy: "no" as const, qualInvestment: "yes" as const,
    infoBorrowerEmail: "sample@example.test", infoBorrowerDob: "1980-01-02", infoCreditScore: "620-720", infoCreditScoreExact: "701",
    infoCoborrowerName: "Sample Co-borrower", infoCoborrowerDob: "1981-01-02", infoCoborrowerCreditScore: "700",
    infoAddress: "Example street", infoGoal: "Pay off cards", infoTakeOut: "20k", infoValue: "500k",
    infoBalance: "100k", infoRate: "5%", infoPayment: "1k", infoHelocBalance: "10k", infoHelocRate: "7%", infoHelocPayment: "200",
    infoIncome: "8k", infoEmployment: "W2", infoEmploymentNotes: "Plus side work", infoMilitary: "Yes", infoMilitaryNotes: "Navy",
  };
  const notes = composeLeadCaptureNotes(capture);
  assert.deepEqual(parseLeadCaptureNotes(notes), { capture, retainedNotes: "" });
  assert.equal(composeEditedLeadCaptureNotes(notes, capture, capture, "", ""), notes);
});

test("N/A and free-and-clear answers survive editing and still change score expectations", () => {
  const capture = { ...emptyLeadCapture(), naCoborrower: "yes" as const, mortgageFreeClear: "yes" as const, naHeloc: "yes" as const };
  const parsed = parseLeadCaptureNotes(composeLeadCaptureNotes(capture));
  assert.deepEqual(parsed.capture, capture);
  const cleared = { ...capture, naHeloc: "" as const, infoHelocBalance: "40k" };
  const notes = composeEditedLeadCaptureNotes(composeLeadCaptureNotes(capture), capture, cleared, "", "");
  assert.match(notes, /HELOC Balance: 40k/);
  assert.doesNotMatch(notes, /HELOC: N\/A/);
});

test("untouched historical prose, whitespace and source are not silently rewritten", () => {
  const before = { id: 42, date: "2026-01-01", assistantId: 7, outcomeType: "transfer", transferType: "direct", loId: 4,
    updatedAt: "version-1", leadSource: "", conversationNotes: "  Legacy handoff\r\n\r\nOwns Home: Yes\r\n", notes: "", bulkTexter: null };
  const initial = transferEditInitialValues(before);
  const composed = composeEditedLeadCaptureNotes(before.conversationNotes, initial, initial, initial.retainedConversationNotes, initial.retainedConversationNotes);
  assert.equal(composed, before.conversationNotes);
  assert.deepEqual(transferInformationChanges(before, { ...initial, conversationNotes: composed }), {});
});

test("unrecognized and conflicting legacy details stay visible when other answers change", () => {
  const original = "Handed to LO by phone\nOwns Home: Yes\nFirst Mortgage: 320k at 6.5%\nBorrower DOB: unknown\nMilitary: retired Navy\nCredit Score: 600\nCredit Score: 650";
  const { capture, retainedNotes } = parseLeadCaptureNotes(original);
  assert.equal(capture.qualOwnHome, "yes");
  assert.equal(capture.mortgageFreeClear, "");
  assert.equal(capture.infoBorrowerDob, "");
  assert.equal(capture.infoMilitaryNotes, "retired Navy");
  assert.equal(capture.infoCreditScore, "");
  const changed = composeEditedLeadCaptureNotes(original, capture, { ...capture, qualBankruptcy: "no" }, retainedNotes, retainedNotes);
  for (const detail of ["Handed to LO by phone", "First Mortgage: 320k at 6.5%", "Borrower DOB: unknown", "Military: retired Navy", "Credit Score: 600", "Credit Score: 650"]) assert.ok(changed.includes(detail));
});

test("only changed intake fields are saved, including helper, bulk and LOA stats", () => {
  const before = { id: 42, date: "2026-01-01", assistantId: 7, outcomeType: "transfer", transferType: "direct", loId: 4,
    loaId: null, updatedAt: "version-1", bulkTexter: null, helperAssisted: false, phoneNumber: "old", conversationNotes: "" };
  const initial = transferEditInitialValues(before);
  assert.deepEqual(transferInformationChanges(before, { ...initial, date: "tomorrow", assistantId: 999, outcomeType: "appointment", id: 99,
    phoneNumber: "new", loaId: 5, helperAssisted: true, bulkTexter: true }), {
    phoneNumber: "new", loaId: 5, bulkTexter: true, helperAssisted: true, expectedUpdatedAt: "version-1",
  });
});

test("custom source is resolved and deleting an answer lowers the same transfer's score", () => {
  const before = { id: 42, date: "2026-01-01", assistantId: 7, outcomeType: "transfer", transferType: "direct", loId: 4,
    leadSource: "Custom source", conversationNotes: "Owns Home: Yes\nBankruptcy Last 6 Months: No\nInvestment/2nd Home: No" };
  const initial = transferEditInitialValues(before);
  assert.equal(initial.leadSource, "other");
  assert.equal(initial.leadSourceOther, "Custom source");
  const current = { ...initial, qualOwnHome: "" as const, leadSourceOther: "Corrected source" };
  const conversationNotes = composeEditedLeadCaptureNotes(before.conversationNotes, initial, current, initial.retainedConversationNotes, current.retainedConversationNotes);
  const patch = transferInformationChanges(before, { ...current, conversationNotes });
  assert.equal(patch.leadSource, "Corrected source");
  assert.ok(summarizeCompleteness([{ ...before, ...patch }]).pct < summarizeCompleteness([before]).pct);
  for (const key of ["id", "assistantId", "date", "outcomeType"]) assert.ok(!(key in patch));
});

test("a conflicting source in a historical write-up is retained, not overwritten by the column", () => {
  const original = "Lead Source: Referral from Jane\nOwns Home: Yes";
  for (const storedSource of ["Single Dialing", ""]) {
    const { capture, retainedNotes } = parseLeadCaptureNotes(original, storedSource);
    assert.match(retainedNotes, /Lead Source: Referral from Jane/);
    const edited = composeEditedLeadCaptureNotes(original, capture, { ...capture, qualBankruptcy: "no" }, retainedNotes, retainedNotes);
    assert.match(edited, /Lead Source: Referral from Jane/);
  }
});

test("saved transfers render the original form, with creation shortcuts disabled", () => {
  const page = readFileSync(new URL("../client/src/pages/outcomes.tsx", import.meta.url), "utf8");
  assert.match(page, /editTarget\?\.outcomeType === "transfer" \? \(\s*<OutcomeFormDialog/);
  assert.match(page, /initialValues=\{transferEditInitialValues\(editTarget\)\}/);
  assert.match(page, /!editingTransfer && <Button[\s\S]+?button-log-and-next/);
  assert.match(page, /isTransfer && !editingTransfer &&/);
  assert.match(page, /transferInformationChanges\(before, values\)/);
  assert.match(page, /const refreshAll = \(\) => queryClient.invalidateQueries\(\)/);
});
