import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { APP_VERSION } from "../shared/version";
import { RELEASE_NOTES, notesFor, notesBetween, itemsForAudience } from "../shared/release-notes";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prompt = readFileSync(join(root, "client/src/components/update-prompt.tsx"), "utf8");

test("the version being shipped has notes — this is the whole mechanism", () => {
  // Without this the feature decays: someone bumps the version, forgets the
  // notes, and the popup silently goes back to "something changed".
  const note = notesFor(APP_VERSION);
  assert.ok(note, `v${APP_VERSION} has no entry in RELEASE_NOTES — add one before shipping`);
  assert.ok(note!.headline.trim().length > 10, "the headline must say something");
  assert.ok(note!.items.length > 0, "at least one note");
});

test("notes describe what a person can do, not what was refactored", () => {
  const jargon = /refactor|regex|endpoint|middleware|schema|column|foreign key|typecheck|bundle|deploy pipeline/i;
  for (const n of RELEASE_NOTES) {
    for (const i of n.items) {
      assert.ok(!jargon.test(i.text), `v${n.version} note reads like a commit message: "${i.text}"`);
      assert.ok(i.text.trim().length > 15, `v${n.version} note is too thin: "${i.text}"`);
    }
  }
});

test("someone who skipped three deploys sees all three", () => {
  const missed = notesBetween("3.79.0", "3.82.0");
  assert.deepEqual(missed.map(n => n.version), ["3.82.0", "3.81.0", "3.80.0"],
    "newest first, excluding the version they already ran");
  // Same version in and out means nothing to show.
  assert.deepEqual(notesBetween("3.82.0", "3.82.0"), []);
  // A downgrade (or a stale poll) must not produce a list.
  assert.deepEqual(notesBetween("3.82.0", "3.80.0"), []);
});

test("versions sort numerically, not as strings", () => {
  // "3.9.0" vs "3.10.0" is where string comparison goes wrong.
  assert.deepEqual(notesBetween("3.74.0", "3.75.0").map(n => n.version), ["3.75.0"]);
  const all = RELEASE_NOTES.map(n => n.version);
  assert.equal(new Set(all).size, all.length, "no duplicate version entries");
});

test("readers only see items they can act on", () => {
  const note = notesFor("3.81.0")!;
  const clr = itemsForAudience(note, "c3", false);
  const mgr = itemsForAudience(note, "c3", true);
  assert.ok(mgr.length > clr.length, "manager-only items are hidden from a CLR");
  assert.ok(clr.every(t => !/Managers see/.test(t)));
  // A LAP-only note does not reach a C3 reader.
  const lapNote = notesFor("3.77.0")!;
  assert.equal(itemsForAudience(lapNote, "c3", false).length, 0);
  assert.ok(itemsForAudience(lapNote, "lap", false).length > 0);
});

test("the popup leads with the change, and falls back safely", () => {
  assert.match(prompt, /data-testid="update-release-notes"/);
  assert.match(prompt, /sections\[0\]\?\.headline/, "headline replaces the generic line");
  assert.match(prompt, /A new version of \$\{productName\}/, "…but a version with no notes still gets a sensible message");
  assert.match(prompt, /you also missed this one/);
  assert.match(prompt, /notesBetween\(APP_VERSION, latest\)/);
});
