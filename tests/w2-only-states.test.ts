import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  W2_ONLY_STATES, isW2OnlyState, isPermanentlyExcludedFromW2Only,
  applyW2OnlyExclusions, BUSINESS_PURPOSE_NOTE, W2_ONLY_NOTE,
  NO_LICENSE_STATES, isNoLicenseState, NO_LICENSE_NOTE,
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
  assert.match(map, /function fillFor\(count: number, selected: boolean, w2Only = false, noLicense = false\)/);
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

test("every state shape is asked about ITSELF, not a hardcoded one", () => {
  // This is the bug that shipped in 4.31.0: the shapes loop called
  // isW2OnlyState("DC"), a constant false, so no state was ever painted and
  // only the right-hand label chips picked up the colour. Greping for the
  // constant could not see it, so pin the argument at each call site instead.
  const calls = [...map.matchAll(/isW2OnlyState\(([^)]*)\)/g)].map((m) => m[1].trim());
  const literals = calls.filter((c) => /^["']/.test(c));
  // The DC marker is genuinely DC and is the ONLY place a literal is right.
  assert.equal(literals.length, 1, `hardcoded state in a per-state branch: ${literals.join(", ")}`);
  assert.equal(literals[0].replace(/["']/g, ""), "DC");

  // And the shape itself -- the thing a person actually looks at -- must use
  // the state being drawn.
  const shape = map.slice(map.indexOf("d={US_STATE_PATHS[abbr]}"));
  const fill = shape.slice(0, shape.indexOf("stroke="));
  assert.match(fill, /isW2OnlyState\(abbr\)/);
});

test("the W2 colour is its own hue, not a shade of the coverage ramp", () => {
  // --primary is navy in the light theme and gold in the dark one. Deriving the
  // W2 colour from it would collide with the coverage ramp in one of them.
  const hue = map.match(/const W2_HUE = "([^"]+)"/);
  assert.ok(hue, "W2_HUE must be a literal hue");
  assert.doesNotMatch(hue[1], /var\(/);
  const [h] = hue[1].split(" ");
  assert.ok(Number(h) >= 300 && Number(h) <= 350, `expected a pink hue, got ${h}`);
});

test("the label on a pink state uses the ink that tracks the theme", () => {
  // --primary-foreground is calibrated to sit on --primary, which goes
  // near-black in the light theme. Pink is a mid-tone at every count, so that
  // ink measured 1.3-2.9:1 on it in both themes. --foreground is dark in the
  // light theme and cream in the dark one, which is what the pink fill needs.
  assert.match(map, /function labelLight\(count: number, selected: boolean, w2Only = false, noLicense = false\)/);
  assert.match(map, /return selected \|\| \(!w2Only && !noLicense && count >= 4\)/);
  // Both label sites must actually pass the flag, or the guard is decorative.
  const calls = [...map.matchAll(/labelLight\(([^)]*)\)/g)].map((m) => m[1].trim());
  const uses = calls.filter((c) => !c.startsWith("count: number"));
  assert.ok(uses.length >= 2, `expected both label sites, saw ${uses.length}`);
  for (const c of uses) assert.match(c, /isW2OnlyState\(/, `label site ignores W2: ${c}`);
});

test("the pink never gets so solid that no ink is readable on it", () => {
  // Alpha works in opposite directions per theme -- paler over the light page,
  // darker over the dark one -- and that is what keeps ONE ink legible on the
  // whole ramp. Past ~0.68 the fill converges on raw mid-tone pink in BOTH
  // themes at once, where neither ink clears 4.5:1. Measured in the browser at
  // 0.68: 6.8:1 light, 5.02:1 dark.
  const ramp = map.slice(map.indexOf("if (w2Only)"), map.indexOf("if (!count) return \"hsl(var(--muted))\""));
  const alphas = [...ramp.matchAll(/W2_HUE\} \/ ([\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(alphas.length >= 3, "the pink ramp should still have steps");
  assert.ok(Math.max(...alphas) <= 0.68, `pink ramp peaks at ${Math.max(...alphas)}, above the legible cap`);
});

test("the W2 flag is in the accessible name, not only the colour", () => {
  // Somebody using a screen reader gets nothing at all from a fill.
  assert.match(map, /function stateLabel\(abbr: string, count: number, name\?: string\)/);
  assert.match(map, /isW2OnlyState\(abbr\) \? ", W2 borrowers only" : ""/);
  assert.match(map, /loan officer\$\{count === 1 \? "" : "s"\} licensed/);
  // Every control routes through it -- a hand-built aria-label would silently
  // drop the flag again.
  assert.doesNotMatch(map, /aria-label=\{`[^`]*loan officer/);
});

test("nobody may be licensed in Hawaii, Illinois, Massachusetts or New York", () => {
  // IL, MA and NY were already the only three states with no licensed loan
  // officer on the roster; Hawaii joined them 1 Sep 2026.
  assert.deepEqual([...NO_LICENSE_STATES].sort(), ["HI", "IL", "MA", "NY"]);
  for (const s of NO_LICENSE_STATES) assert.ok(isNoLicenseState(s));
  assert.ok(isNoLicenseState("hi"), "matching is case-insensitive");
  assert.ok(!isNoLicenseState("CA"));
});

test("the block applies to everyone, not just the named exclusion", () => {
  // The W2 rule is one person's; this one is the company's.
  const anyone = applyW2OnlyExclusions("Nathan Coutino", ["CA", "HI", "TX"]);
  assert.deepEqual(anyone.states, ["CA", "TX"]);
  assert.deepEqual(anyone.removed, ["HI"]);
  const alsoAnyone = applyW2OnlyExclusions("", ["NY", "MA", "AZ"]);
  assert.deepEqual(alsoAnyone.states, ["AZ"]);
  assert.deepEqual(alsoAnyone.removed.sort(), ["MA", "NY"]);
});

test("Illinois is on both lists and is not removed twice", () => {
  // IL is W2-only AND no-licence. The stricter rule takes it; the looser one
  // must not then report it a second time.
  assert.ok(isW2OnlyState("IL") && isNoLicenseState("IL"));
  const chris = applyW2OnlyExclusions("Christopher Redoble", ["IL", "GA", "CA"]);
  assert.deepEqual(chris.states, ["CA"]);
  assert.equal(chris.removed.filter((x) => x === "IL").length, 1, "IL reported once");
  assert.deepEqual(chris.removed.sort(), ["GA", "IL"]);
});

test("someone with nothing to strip is returned untouched", () => {
  const clean = applyW2OnlyExclusions("Nathan Coutino", ["CA", "TX"]);
  assert.deepEqual(clean.states, ["CA", "TX"]);
  assert.deepEqual(clean.removed, []);
});

test("a no-licence state is painted red, and red beats pink", () => {
  assert.match(map, /const NO_LICENSE_HUE = "0 78% 52%"/);
  // Flat, not a ramp: there is no quantity to encode when the answer is nobody.
  assert.match(map, /if \(noLicense\) return selected \?/);
  assert.doesNotMatch(map.slice(map.indexOf("if (noLicense)"), map.indexOf("if (selected)")), /count/);
  // It is checked before the W2 branch, so Illinois reads as no-licence.
  assert.ok(map.indexOf("if (noLicense)") < map.indexOf("if (w2Only)"));
  assert.match(map, /data-testid="no-license-legend"/);
});

test("a no-licence state stops claiming coverage it cannot have", () => {
  // A count or a name on one of these is a record to go and fix, not a fact to
  // display next to the rule that forbids it.
  assert.match(map, /isNoLicenseState\(hover\.abbr\) \? \(/);
  assert.match(map, /data-testid="no-license-note"/);
  assert.match(map, /!isNoLicenseState\(hover\.abbr\) && isW2OnlyState\(hover\.abbr\)/);
  assert.match(NO_LICENSE_NOTE, /no one can be licensed/i);
  // Business purpose still applies -- it needs no licence, which is the whole
  // reason these states are not simply blank.
  assert.match(BUSINESS_PURPOSE_NOTE, /business purpose loans are okay in all states/i);
});

test("every fill and label call knows about the no-licence flag", () => {
  // Threading it into fillFor but not labelLight would put a light label on a
  // mid-tone red, the same defect the pink ramp had.
  // Line-wise: the nested isW2OnlyState(...) parens defeat a [^)]* match.
  const lines = map.split(/\r?\n/);
  const fills = lines.filter((l) => l.includes("fillFor(count, selected,"));
  assert.equal(fills.length, 3, "three fill sites");
  for (const f of fills) assert.match(f, /isNoLicenseState/);
  const labels = lines.filter((l) => l.includes("labelLight(count, selected,"));
  assert.equal(labels.length, 2, "two label sites");
  for (const l of labels) assert.match(l, /isNoLicenseState/);
  // Colour alone reaches nobody using a screen reader.
  assert.match(map, /isNoLicenseState\(abbr\)\) return/);
});
