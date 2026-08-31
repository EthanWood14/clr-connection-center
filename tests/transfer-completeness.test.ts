import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreTransfer, summarizeCompleteness, TRANSFER_COMPLETENESS_FIELDS,
} from "../shared/transfer-completeness";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-profile.tsx"), "utf8");

const full = {
  borrowerName: "Maria Ortiz", phoneNumber: "7025551234", leadSource: "Single Dialing",
  conversationNotes: "Wants to consolidate.", loaId: 4, loHasLoa: true,
};

test("a fully written-up transfer scores 100%", () => {
  const s = scoreTransfer(full);
  assert.equal(s.expected, 5);
  assert.equal(s.filled, 5);
  assert.deepEqual(s.missing, []);
  assert.equal(summarizeCompleteness([full]).pct, 100);
});

test("an LOA is only expected when the loan officer has one", () => {
  // This is the whole point of the statistic. On prod, scoring LOA against
  // every transfer gives 43.1%; scoring it only where it applies gives 84.1%.
  const noLoa = { ...full, loaId: null, loHasLoa: false };
  const s = scoreTransfer(noLoa);
  assert.equal(s.expected, 4, "the LOA must not be counted against them");
  assert.equal(s.filled, 4);
  assert.equal(summarizeCompleteness([noLoa]).pct, 100, "a blameless transfer is not penalised");

  const shouldHave = { ...full, loaId: null, loHasLoa: true };
  assert.deepEqual(scoreTransfer(shouldHave).missing, ["loaId"]);
  assert.equal(summarizeCompleteness([shouldHave]).pct, 80);
});

test("blank, whitespace and zero all count as missing", () => {
  for (const v of ["", "   ", null, undefined]) {
    assert.ok(scoreTransfer({ ...full, leadSource: v as any }).missing.includes("leadSource"), `${JSON.stringify(v)} should be missing`);
  }
  assert.ok(scoreTransfer({ ...full, loaId: 0 }).missing.includes("loaId"), "LOA 0 is not an LOA");
});

test("the average is over fields, not over transfers", () => {
  // Two transfers, one perfect and one missing two of five, is 8/10 = 80% —
  // not (100 + 60) / 2. Averaging percentages would let a transfer with fewer
  // expected fields count as much as a complete one.
  const weak = { ...full, leadSource: "", conversationNotes: "" };
  const sum = summarizeCompleteness([full, weak]);
  assert.equal(sum.expected, 10);
  assert.equal(sum.filled, 8);
  assert.equal(sum.pct, 80);
  assert.equal(sum.complete, 1, "only one was fully written up");
  assert.equal(sum.transfers, 2);
});

test("nothing to score reports nothing rather than zero", () => {
  const sum = summarizeCompleteness([]);
  assert.equal(sum.pct, null, "0% would read as a failure; there is simply no data");
  assert.equal(sum.transfers, 0);
});

test("the per-field breakdown says which field is dragging it down", () => {
  const rows = [full, { ...full, leadSource: "" }, { ...full, leadSource: "" }];
  const byField = summarizeCompleteness(rows).byField;
  const src = byField.find((f) => f.key === "leadSource");
  assert.equal(src?.expected, 3);
  assert.equal(src?.filled, 1);
  assert.equal(src?.pct, 33);
  const name = byField.find((f) => f.key === "borrowerName");
  assert.equal(name?.pct, 100);
});

test("dead fields are not counted, or the score would have an unreachable ceiling", () => {
  // Measured on prod: lead_timeframe 0.0%, lo_action_plan 0.2%, and the form no
  // longer asks for either. transfer_type is 100% because it is defaulted.
  const keys = TRANSFER_COMPLETENESS_FIELDS.map((f) => f.key);
  for (const dead of ["leadTimeframe", "loActionPlan", "transferType", "loId", "notes"]) {
    assert.ok(!keys.includes(dead), `${dead} must not be scored`);
  }
  assert.deepEqual(keys, ["borrowerName", "phoneNumber", "leadSource", "conversationNotes", "loaId"]);
});

test("the profile computes it from transfers only, with the LOA set resolved", () => {
  const block = routes.slice(routes.indexOf("// How completely this CLR wrote up their transfers"), routes.indexOf("const completeness = summarizeCompleteness"));
  assert.ok(block.length > 0);
  assert.match(block, /ot\(o\) === "transfer"/, "only transfers are scored");
  assert.match(block, /FROM loan_officer_assistants WHERE active=1/);
  assert.match(block, /loHasLoa: losWithLoa\.has/);
  // A missing assistants table must not make every transfer look incomplete.
  assert.match(block, /catch \{/);
});

test("the page shows the number and what is dragging it down", () => {
  assert.match(page, /data-testid="clr-completeness-pct"/);
  assert.match(page, /data-testid="clr-completeness-field"/);
  // Worst field first — that is the one worth acting on.
  assert.match(page, /\.sort\(\(a, b\) => \(a\.pct \?\? 100\) - \(b\.pct \?\? 100\)\)/);
  // No transfers means no card, rather than a 0% that reads as failure.
  assert.match(page, /data\.completeness\.transfers > 0 &&/);
});
