import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTrainingDays, readStoredManual, canEditTraining, TRAINING_LIMITS,
} from "../shared/training-manual";
import { TRAINING_DAYS } from "../shared/clr-training";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-training.tsx"), "utf8");
const settings = readFileSync(join(root, "client/src/pages/settings.tsx"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const schema = readFileSync(join(root, "shared/schema.ts"), "utf8");

const day = (over: Record<string, unknown> = {}) => ({
  day: 1, week: 1, morning: ["Tour the office."], afternoon: ["Roleplay."],
  lunchNote: "Lunch.", eod: "Opener down pat.", ...over,
});

test("the plan that ships is itself a valid plan", () => {
  // The seed is the fallback for a fresh install and a failed request, so it
  // has to survive the same validation a save does.
  const out = parseTrainingDays(TRAINING_DAYS);
  assert.equal(out.ok, true, out.error);
  assert.equal(out.days.length, TRAINING_DAYS.length);
});

test("a save is rejected rather than repaired when the shape is wrong", () => {
  // Quietly saving a half-understood document loses the author's work without
  // telling them, which is worse than refusing it.
  assert.equal(parseTrainingDays(null).ok, false);
  assert.equal(parseTrainingDays([]).ok, false);
  assert.equal(parseTrainingDays(["not an object"]).ok, false);
  assert.equal(parseTrainingDays([day({ day: 0 })]).ok, false);
  assert.equal(parseTrainingDays([day({ day: 1 }), day({ day: 1 })]).ok, false, "a duplicate day number");
  assert.equal(parseTrainingDays([day({ morning: [], afternoon: [] })]).ok, false, "a day with nothing in it");
  // And the refusal says which day, or it is unactionable.
  assert.match(String(parseTrainingDays([day({ morning: [], afternoon: [] })]).error), /Day 1/);
});

test("blank lines are dropped quietly — that is someone clearing a line", () => {
  const out = parseTrainingDays([day({ morning: ["Real step.", "   ", ""] })]);
  assert.equal(out.ok, true);
  assert.deepEqual(out.days[0].morning, ["Real step."]);
});

test("reading order cannot be shuffled by a save", () => {
  const out = parseTrainingDays([day({ day: 3 }), day({ day: 1 }), day({ day: 2 })]);
  assert.equal(out.ok, true);
  assert.deepEqual(out.days.map((d) => d.day), [1, 2, 3]);
});

test("a paste accident cannot wreck the page for everyone else", () => {
  const huge = "x".repeat(TRAINING_LIMITS.maxStepChars + 500);
  const many = new Array(TRAINING_LIMITS.maxStepsPerHalf + 20).fill("step");
  const out = parseTrainingDays([day({ morning: [huge], afternoon: many })]);
  assert.equal(out.ok, true);
  assert.equal(out.days[0].morning[0].length, TRAINING_LIMITS.maxStepChars);
  assert.equal(out.days[0].afternoon.length, TRAINING_LIMITS.maxStepsPerHalf);
  assert.equal(parseTrainingDays(new Array(TRAINING_LIMITS.maxDays + 1).fill(day()).map((d, i) => ({ ...d, day: i + 1 }))).ok, false);
});

test("a corrupt stored row falls back to the plan, never to an empty page", () => {
  assert.deepEqual(readStoredManual("not json"), TRAINING_DAYS);
  assert.deepEqual(readStoredManual(null), TRAINING_DAYS);
  assert.deepEqual(readStoredManual("[]"), TRAINING_DAYS);
  // A good row is used as-is.
  const stored = JSON.stringify([day({ eod: "Saved." })]);
  assert.equal(readStoredManual(stored)[0].eod, "Saved.");
});

test("the grant is per-user, because its author is an assistant", () => {
  // Matt Lane is role "assistant". Tying this to manager rights would mean
  // handing him the whole manager surface to fix a typo in his own document.
  assert.equal(canEditTraining({ role: "assistant" }), false);
  assert.equal(canEditTraining({ role: "assistant", isManager: true }), false, "manager alone is not enough");
  assert.equal(canEditTraining({ role: "assistant", canEditTraining: true }), true);
  assert.equal(canEditTraining({ role: "assistant", can_edit_training: 1 }), true, "snake_case from a raw row");
  assert.equal(canEditTraining({ role: "admin" }), true);
  assert.equal(canEditTraining({ super_admin: 1 }), true);
  assert.equal(canEditTraining(null), false);
});

test("reading is open, writing is gated, and both are org-scoped", () => {
  const get = routes.slice(routes.indexOf('app.get("/api/training-manual"'), routes.indexOf('app.put("/api/training-manual"'));
  const put = routes.slice(routes.indexOf('app.put("/api/training-manual"'), routes.indexOf('app.get("/api/training-manual/history"'));
  // Everyone signed in can read it — it is what new starters are trained from.
  assert.match(get, /requireAuth/);
  assert.doesNotMatch(get, /return res\.status\(403\)/);
  assert.match(get, /org_id = \?/);
  assert.match(put, /if \(!canEditTraining\(me\)\) return res\.status\(403\)/);
  assert.match(put, /if \(!parsed\.ok\) return res\.status\(400\)/);
  assert.match(put, /org_id, content, author_user_id, author_name, created_at/);
  assert.match(put, /audit\(\{/, "an edit to shared training material must be traceable");
});

test("history is append-only, so a bad edit is recoverable", () => {
  // Every save inserts; the current document is simply the newest row. Restore
  // writes a NEW version rather than deleting, so the trail cannot be rewritten.
  assert.match(storage, /CREATE TABLE IF NOT EXISTS training_manual_versions/);
  assert.match(storage, /idx_tmv_current ON training_manual_versions\(org_id, id DESC\)/);
  const restore = routes.slice(routes.indexOf('app.post("/api/training-manual/restore/:id"'), routes.indexOf('app.patch("/api/users/:id/training-edit"'));
  assert.match(restore, /INSERT INTO training_manual_versions/);
  assert.doesNotMatch(restore, /DELETE FROM training_manual_versions/);
  assert.match(restore, /AND org_id = \?/, "a version id from another org must not resolve");
});

test("the grant is stored, exposed, and toggleable by an admin", () => {
  assert.match(schema, /canEditTraining: integer\("can_edit_training"/);
  assert.match(storage, /ALTER TABLE users ADD COLUMN can_edit_training INTEGER NOT NULL DEFAULT 0/);
  // Exposed on the user payload, or the toggle can never show its own state.
  assert.match(routes, /"canEditTraining", "can_edit_training",/);
  const patch = routes.slice(routes.indexOf('app.patch("/api/users/:id/training-edit"'));
  assert.match(patch.slice(0, 600), /req\.session_user\?\.role !== "admin"/);
  assert.match(settings, /data-testid=\{`button-training-edit-\$\{user\.id\}`\}/);
});

test("the page reads the live document but never renders empty", () => {
  assert.match(page, /queryKey: \["\/api\/training-manual"\]/);
  // The seed is a fallback, not a placeholder: a failed request must still show
  // the plan to someone trying to train a new hire this morning.
  assert.match(page, /const days = data\?\.days\?\.length \? data\.days : TRAINING_DAYS/);
  // Edit controls appear only for the grant.
  assert.match(page, /const canEdit = !!data\?\.canEdit/);
  assert.match(page, /\{canEdit && !editing &&/);
  assert.match(page, /data-testid="training-save"/);
  // Steps are edited as lines, which is the shape the writing already has.
  assert.match(page, /one step per line/i);
});
