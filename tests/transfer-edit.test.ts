import { test } from "node:test";
import assert from "node:assert/strict";
import { transferInformationPatch } from "../shared/transfer-edit";
import { summarizeCompleteness } from "../shared/transfer-completeness";

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
