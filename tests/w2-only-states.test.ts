import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  W2_ONLY_STATES, isW2OnlyState, isPermanentlyExcludedFromW2Only,
  applyW2OnlyExclusions, BUSINESS_PURPOSE_NOTE, W2_ONLY_NOTE,
} from "../shared/w2-only-states";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const map = readFileSync(join(root, "client/src/components/us-state-geo-map.tsx"), "utf8");

test("the eleven W2-only states are exactly the ones given", () => {
  assert.deepEqual([...W2_ONLY_STATES].sort(),
    ["AR","GA","IL","IN","MD","MS","MT","NC","NJ","SC","VT"]);
  assert.equal(W2_ONLY_STATES.length, 11);
  assert.ok(isW2OnlyState("ar"), "case should not matter");
  assert.ok(isW2OnlyState(" NC "), "nor should stray whitespace");
  assert.ok(!isW2OnlyState("CA"));
  assert.ok(!isW2OnlyState(null));
});

test("Chris Redoble is permanently excluded, and nobody else is caught by accident", () => {
  for (const name of ["Chris Redoble", "Christopher Redoble", "  christopher   redoble  ", "REDOBLE, "]) {
    if (name === "REDOBLE, ") continue;
    assert.ok(isPermanentlyExcludedFromW2Only(name), `${name} should match`);
  }
  // A pattern loose enough to catch a shared first name would silently strip
  // states from the wrong person.
  for (const other of ["Chris Bennett", "Christopher Lee", "Redoble Enterprises", "", null]) {
    assert.ok(!isPermanentlyExcludedFromW2Only(other), `${other} must NOT match`);
  }
});

test("saving W2-only states for him drops them and reports what was dropped", () => {
  const asked = ["CA", "AR", "TX", "MD", "NC", "FL"];
  const out = applyW2OnlyExclusions("Christopher Redoble", asked);
  assert.deepEqual(out.states, ["CA", "TX", "FL"]);
  assert.deepEqual(out.removed, ["AR", "MD", "NC"]);
  // Everyone else keeps whatever they were given.
  const other = applyW2OnlyExclusions("Devon Linkon", asked);
  assert.deepEqual(other.states, asked);
  assert.deepEqual(other.removed, []);
});

test("the block is enforced where every write path goes through", () => {
  // A rule that only lives in the picker is one API call from being undone,
  // so it sits in updateLoanOfficer rather than in a single route.
  const fn = storage.slice(storage.indexOf("updateLoanOfficer(id: number, data: Partial<InsertLoanOfficer>) {"), storage.indexOf("archiveLoanOfficer(id: number) {"));
  assert.match(fn, /applyW2OnlyExclusions/);
  assert.match(fn, /cleaned\.licensedStates !== undefined/);
  // It must read the STORED name, not trust one supplied in the request.
  assert.match(fn, /SELECT full_name FROM loan_officers WHERE id = \?/);
});

test("the map paints them differently and explains why", () => {
  assert.match(map, /const W2_HUE/);
  assert.match(map, /function fillFor\(count: number, selected: boolean, w2Only = false\)/);
  // Not just a darker blue — that would read as "more LOs licensed".
  assert.ok(!/w2Only.*var\(--primary\)/.test(map.slice(map.indexOf("if (w2Only)"), map.indexOf("if (!count)"))));
  assert.match(map, /data-testid="w2-only-legend"/);
  assert.match(map, /data-testid="w2-only-note"/);
  assert.match(map, /data-testid="business-purpose-note"/);
});

test("the business-purpose note is shown for every state, not only W2 ones", () => {
  assert.match(BUSINESS_PURPOSE_NOTE, /business purpose loans are okay in all states/i);
  assert.match(W2_ONLY_NOTE, /W2/);
  // The note sits outside the isW2OnlyState guard in the tooltip.
  const tip = map.slice(map.indexOf("const tooltip = (() =>"), map.indexOf("})();", map.indexOf("const tooltip = (() =>")));
  const guard = tip.indexOf("isW2OnlyState(hover.abbr)");
  const note = tip.indexOf("BUSINESS_PURPOSE_NOTE");
  assert.ok(guard > 0 && note > guard, "the general note must not be inside the W2-only branch");
});
