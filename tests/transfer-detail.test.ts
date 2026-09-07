import { test } from "node:test";
import assert from "node:assert/strict";

import {
  capturedValues, extraValues, buildTransferDetail, detailSummary,
} from "../shared/transfer-detail";
import {
  TRANSFER_COMPLETENESS_FIELDS, capturedLabels, scoreTransfer,
} from "../shared/transfer-completeness";

const BLOB = [
  "Owns Home: Yes",
  "Bankruptcy Last 6 Months: No",
  "Investment/2nd Home: Yes",
  "Credit Score: 700-739",
  "Property Address: 118 Oak St, Reno NV",
  "Estimated Home Value: $540,000",
  "Co-Borrower: n/a",
  "HELOC: n/a",
].join("\n");

const row = (over: Record<string, unknown> = {}) =>
  ({ conversationNotes: BLOB, ...over }) as any;

// ── the values, which is the entire point ───────────────────────────────────

test("what was written comes back, not just that something was", () => {
  // capturedLabels has always been able to say the address field was filled.
  // Nothing has ever been able to say what the address was.
  const values = capturedValues(BLOB);
  assert.equal(values.get("Property Address"), "118 Oak St, Reno NV");
  assert.equal(values.get("Estimated Home Value"), "$540,000");
  assert.equal(values.get("Owns Home"), "Yes");
});

test("a value is read exactly as the scorer decided the field was filled", () => {
  // If these two ever disagree, the page shows one thing and the percentage is
  // computed from another, which is worse than showing nothing.
  const scored = capturedLabels(BLOB);
  const shown = capturedValues(BLOB);
  for (const label of scored) {
    assert.ok(shown.has(label), `${label} counted toward the score but has no value to show`);
  }
});

test("a longer label wins over the section marker that prefixes it", () => {
  // "HELOC Balance: 42,000" must not be read as the "HELOC" marker, or the
  // balance disappears and the section reads as not applicable.
  const v = capturedValues("HELOC Balance: 42,000\nHELOC Rate: 9.25%");
  assert.equal(v.get("HELOC Balance"), "42,000");
  assert.equal(v.get("HELOC Rate"), "9.25%");
  assert.equal(v.has("HELOC"), false);
});

test("an empty value is not a value", () => {
  const v = capturedValues("Owns Home:\nCredit Score:   \nMilitary: No");
  assert.equal(v.has("Owns Home"), false);
  assert.equal(v.has("Credit Score"), false);
  assert.equal(v.get("Military"), "No");
});

// ── the assembled view ──────────────────────────────────────────────────────

test("the field list is the scorer's own, not a second copy of it", () => {
  // A separate list would drift, and the drift would show as a field that is
  // on screen but not in the percentage, or the other way round.
  const detail = buildTransferDetail(row());
  assert.deepEqual(
    detail.fields.map((f) => f.label),
    TRANSFER_COMPLETENESS_FIELDS.map((f) => f.label),
  );
});

test("the columns a transfer is judged on are shown, not only the captured ones", () => {
  // Borrower name, phone, lead source and which LO it went to are scored
  // fields living in their own columns. A page that showed only the notes
  // would say 76% and display none of the four things that made it 76%.
  const detail = buildTransferDetail(row({
    borrowerName: "Manuel Cruz", phoneNumber: "5307365868",
    leadSource: "MAROON - HELOC 620-699", loId: 3, loName: "Chris Redoble",
  }));
  const at = (label: string) => detail.fields.find((f) => f.label === label)!;
  assert.equal(at("Borrower name").value, "Manuel Cruz");
  assert.equal(at("Phone number").value, "5307365868");
  assert.equal(at("Loan officer").value, "Chris Redoble");
  // A renamed or missing LO record still says where it went.
  const noName = buildTransferDetail(row({ loId: 3 }));
  assert.equal(noName.fields.find((f) => f.label === "Loan officer")!.value, "LO #3");
});

test("a field nobody answered says so rather than vanishing", () => {
  const detail = buildTransferDetail(row());
  const dob = detail.fields.find((f) => f.label === "Borrower DOB")!;
  assert.equal(dob.value, null);
  assert.equal(dob.applicable, true);
  assert.ok(detail.missing.includes("Borrower DOB"));
});

test("the score shown is the score the write-up board computes", () => {
  const r = row();
  const shown = buildTransferDetail(r).score;
  const board = scoreTransfer(r);
  assert.equal(shown.filled, board.filled);
  assert.equal(shown.expected, board.expected);
  assert.deepEqual(shown.missing, board.missing);
  assert.equal(shown.percent, Math.round((board.filled / board.expected) * 100));
});

test("the qualification answers are marked as such", () => {
  const detail = buildTransferDetail(row());
  const quals = detail.fields.filter((f) => f.qualification).map((f) => f.label);
  assert.deepEqual(quals, ["Owns Home", "Bankruptcy Last 6 Months", "Investment/2nd Home"]);
});

test("a section marked n/a takes its fields out of what is missing", () => {
  // "Co-Borrower: n/a" is why the co-borrower fields are empty. Counting them
  // as missing would mark down every transfer for not having a co-borrower,
  // which is exactly what the score refuses to do.
  const detail = buildTransferDetail(row());
  const coName = detail.fields.find((f) => f.label === "Co-Borrower Name")!;
  assert.equal(coName.applicable, false, "the marker switched the section off");
  assert.equal(detail.missing.includes("Co-Borrower Name"), false);
  assert.equal(detail.missing.includes("HELOC Balance"), false);
  // And the marker itself is on the page, so the blanks are explained.
  const labels = detail.extras.map((e) => e.label);
  assert.ok(labels.includes("Co-Borrower"));
  assert.ok(labels.includes("HELOC"));
});

test("the LOA question is only asked of an LO who has one", () => {
  const without = buildTransferDetail(row());
  const with_ = buildTransferDetail(row({ loHasLoa: true }));
  assert.equal(without.fields.find((f) => f.label === "LOA")!.applicable, false);
  assert.equal(with_.fields.find((f) => f.label === "LOA")!.applicable, true);
  assert.equal(without.missing.includes("LOA"), false);
  assert.ok(with_.missing.includes("LOA"));
});

test("a captured line C3 does not know is surfaced, not swallowed", () => {
  const detail = buildTransferDetail(row({ conversationNotes: `${BLOB}\nPrefers Spanish: yes` }));
  const extra = detail.extras.find((e) => e.label === "Prefers Spanish");
  assert.equal(extra!.value, "yes");
  assert.equal(extra!.expected, false);
});

test("a sentence that happens to contain a colon is not mistaken for a field", () => {
  const prose = "Called at 4pm and he said this: he wants cash out before the holidays.";
  assert.equal(extraValues(prose).size, 0, "prose is prose, not a captured field");
});

test("the free-text columns are read as prose, never scavenged for fields", () => {
  // The scorer reads captured answers out of conversation_notes and nowhere
  // else. Parsing the other columns too would show a field as answered that
  // the percentage counts as blank.
  const detail = buildTransferDetail(row({
    conversationNotes: "Owns Home: Yes",
    prequalificationNotes: "Property Address: 40 Elm St",
  }));
  assert.equal(detail.fields.find((f) => f.label === "Property Address")!.value, null);
  assert.ok(detail.narrative.some((n) => n.value.includes("40 Elm St")));
});

test("what a CLR wrote in their own words is kept and labelled", () => {
  const detail = buildTransferDetail(row({
    notes: "Wants to consolidate two cards.",
    loActionPlan: "Running a cash-out scenario.",
    nextSteps: "   ",
  }));
  const labels = detail.narrative.map((n) => n.label);
  assert.ok(labels.includes("Other notes"));
  assert.ok(labels.includes("What the LO plans to do"));
  // Whitespace is not a note.
  assert.equal(labels.includes("Next steps"), false);
});

test("a transfer with nothing on it produces a page rather than an exception", () => {
  for (const bad of [{}, { conversationNotes: null }, { conversationNotes: "" }, { conversationNotes: 7 }]) {
    const detail = buildTransferDetail(bad as any);
    assert.ok(detail.fields.length > 0);
    assert.equal(detail.score.percent, 0);
    assert.ok(detailSummary(detail).startsWith("0 of "));
  }
  // Nothing stored means nothing to read, rather than a row of empty headings.
  assert.deepEqual(buildTransferDetail({} as any).narrative, []);
});

// ── the list line ───────────────────────────────────────────────────────────

test("the one-line summary says out loud when a qualification answer is missing", () => {
  const thin = buildTransferDetail(row({ conversationNotes: "Credit Score: 700-739" }));
  assert.match(detailSummary(thin), /3 qualification answers missing/);

  const full = buildTransferDetail(row());
  assert.doesNotMatch(detailSummary(full), /qualification/);
  assert.match(detailSummary(full), /^\d+ of \d+ fields/);
});
