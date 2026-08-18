import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRAINING_DAYS, TRAINING_AUTHOR } from "../shared/clr-training";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/clr-training.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const lapShell = readFileSync(join(root, "client/src/components/lap/lap-shell.tsx"), "utf8");

test("all ten days are present, each with a full shape", () => {
  assert.equal(TRAINING_DAYS.length, 10);
  assert.deepEqual(TRAINING_DAYS.map(d => d.day), [1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(TRAINING_DAYS.filter(d => d.week === 1).map(d => d.day), [1,2,3,4,5]);
  for (const d of TRAINING_DAYS) {
    assert.ok(d.morning.length > 0, `day ${d.day} has no morning steps`);
    assert.ok(d.afternoon.length > 0, `day ${d.day} has no afternoon steps`);
    assert.ok(d.eod && d.eod.length > 10, `day ${d.day} is missing its end-of-day outcome`);
    assert.ok(d.lunchNote, `day ${d.day} lost its lunch marker`);
  }
});

test("the author's words are carried verbatim, not paraphrased", () => {
  // Spot-check distinctive sentences from the source document. If these drift,
  // someone has rewritten his plan rather than restyled it.
  const all = TRAINING_DAYS.flatMap(d => [...d.morning, ...d.afternoon, d.eod]).join("\n");
  for (const phrase of [
    "No question is a dumb question",
    "Closed-ended questions give the borrower a free out",
    "NOT ASKING",
    "we as CLRs are NOT allowed to quote anyone",
    "14-day rule",
    "Refinance, HELOC, and Reverse",
    "down to logging the transfer in C3",
  ]) {
    assert.ok(all.includes(phrase), `missing from the plan: "${phrase}"`);
  }
  // Curly quotes and em dashes survived the extraction rather than becoming
  // mojibake.
  assert.ok(!/[�]/.test(all), "replacement characters in the text");
});

test("Matt Lane is credited, and not only in the footer", () => {
  assert.equal(TRAINING_AUTHOR, "Matt Lane");
  assert.match(page, /data-testid="training-author"/);
  assert.match(page, /Written by \{TRAINING_AUTHOR\}/);
  // Appears in the byline near the top AND at the end.
  assert.ok((page.match(/TRAINING_AUTHOR/g) ?? []).length >= 3, "credit should be hard to miss");
});

test("the page renders the plan rather than restating it", () => {
  // Every list item comes from the data module; no day content is hardcoded in
  // the component, or the two would drift apart.
  assert.match(page, /TRAINING_DAYS\.filter/);
  assert.match(page, /d\.morning\.map/);
  assert.match(page, /d\.afternoon\.map/);
  assert.match(page, /\{d\.eod\}/);
  assert.ok(!page.includes("No question is a dumb question"), "plan text must live in the data module only");
});

test("it is reachable from both portals and printable", () => {
  assert.match(app, /<Route path="\/clr-training" component=\{ClrTraining\} \/>/);
  assert.match(lapShell, /<Route path="\/clr-training" component=\{ClrTraining\} \/>/);
  assert.match(page, /window\.print\(\)/);
  assert.match(page, /print:hidden/, "controls should not appear on paper");
});
