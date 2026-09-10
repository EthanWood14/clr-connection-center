import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LEAD_SOURCE_OPTIONS, canonicalLeadSource, isCurrentLeadSource } from "../shared/lead-source";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const routes = read("server/routes.ts");
const outcomes = read("client/src/pages/outcomes.tsx");
const panel = read("client/src/components/lead-capture-panel.tsx");
const lib = read("client/src/lib/lead-capture.ts");

test("the seven the owner asked for, and Mojo is gone", () => {
  assert.deepEqual([...LEAD_SOURCE_OPTIONS], [
    "Retail (iLeads)",
    "Retail (Meta)",
    "CallTools",
    "Single Dialing (New)",
    "Single Dialing (Responded)",
    "Single Dialing (Other)",
    "Bulk Texting",
  ]);
  // Mojo was on the list and was picked exactly zero times on production
  // before it came off.
  assert.ok(!(LEAD_SOURCE_OPTIONS as readonly string[]).includes("Mojo"));
});

test("both places that ask the question read the same list", () => {
  // Input Results and the call-script panel. Two copies would drift, and the
  // answers would stop being comparable without anybody noticing.
  assert.match(outcomes, /LEAD_SOURCE_OPTIONS\.map/);
  assert.match(panel, /LEAD_SOURCE_OPTIONS\.map/);
  assert.match(lib, /export \{ LEAD_SOURCE_OPTIONS, canonicalLeadSource \} from "@shared\/lead-source";/);
});

test("a pure rename folds, so one source is not two rows on the wall", () => {
  // The office TV groups by this string. Splitting the picker without this
  // would show "BulkTexts 202" and "Bulk Texting 3" side by side.
  assert.equal(canonicalLeadSource("BulkTexts"), "Bulk Texting");
  assert.equal(canonicalLeadSource("bulk texts"), "Bulk Texting");
  assert.equal(canonicalLeadSource("Responded"), "Single Dialing (Responded)");
  assert.equal(canonicalLeadSource("calltools"), "CallTools");
  // Already current, unchanged.
  for (const opt of LEAD_SOURCE_OPTIONS) assert.equal(canonicalLeadSource(opt), opt);
});

test("an answer that could now be either half is NOT guessed", () => {
  // "Retail" is now iLeads or Meta and nothing in the row says which;
  // "Single Dialing" is now New, Responded or Other. Folding either would
  // invent the split retrospectively, which is the exact thing this change
  // exists to stop us doing.
  assert.equal(canonicalLeadSource("Retail"), "Retail");
  assert.equal(canonicalLeadSource("Single Dialing"), "Single Dialing");
  assert.ok(!isCurrentLeadSource("Retail"));
  assert.ok(!isCurrentLeadSource("Single Dialing"));
});

test("free text a CLR typed is left exactly as they typed it", () => {
  assert.equal(canonicalLeadSource("Meta Lead Chris"), "Meta Lead Chris");
  assert.equal(canonicalLeadSource("  Inbound Ad Lead "), "Inbound Ad Lead");
  assert.equal(canonicalLeadSource(""), "");
  assert.equal(canonicalLeadSource(null), "");
  assert.equal(canonicalLeadSource(undefined), "");
});

test("the wall counts folded names, not raw ones", () => {
  const sec = routes.slice(routes.indexOf('section("leadSources"'), routes.indexOf('section("onPhoneNow"'));
  assert.match(sec, /const name = canonicalLeadSource\(r\.source\);/);
  // Summed per folded name rather than pushed per raw row, or the fold would
  // produce two entries with the same label.
  assert.match(sec, /byName\.set\(name, \(byName\.get\(name\) \?\? 0\) \+ n\)/);
});

test("nothing rewrites what is already stored", () => {
  // The fold is a display-time reading. A fold that turns out to be wrong
  // should cost a label on a board, never a record.
  const mod = read("shared/lead-source.ts");
  assert.match(mod, /Nothing here rewrites the database/);
  assert.ok(!/UPDATE lead_outcomes/i.test(mod));
});
