import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DRAFT_MAX_AGE_MS, clearDraft, draftKey, draftWorthKeeping, loadDraft, saveDraft,
} from "../client/src/lib/outcome-draft";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/outcomes.tsx"), "utf8");

/** A localStorage that behaves, installed per test. */
function withStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    ...impl,
  };
  return store;
}

const TYPED = { borrowerName: "Ann Diaz", phoneNumber: "5551234567" };

test("a draft is per person, so a shared machine cannot leak one", () => {
  assert.equal(draftKey(15), "clr.outcomeDraft.15");
  assert.notEqual(draftKey(15), draftKey(20));
  // A signed-out or malformed id still gets a key rather than throwing.
  assert.equal(draftKey(null), "clr.outcomeDraft.anon");
  assert.equal(draftKey(0), "clr.outcomeDraft.anon");
});

test("the form's own defaults are not a draft", () => {
  // It opens with a date, the signed-in CLR, transfer and direct already
  // chosen. Saving that would leave a draft on every visit and "restore" a
  // form identical to the one it would have shown anyway.
  assert.equal(draftWorthKeeping({ date: "2026-09-10", assistantId: 15, outcomeType: "transfer", transferType: "direct", loId: 0 }), false);
  assert.equal(draftWorthKeeping({}), false);
  assert.equal(draftWorthKeeping({ borrowerName: "   " }), false);
});

test("anything a person actually put in is worth keeping", () => {
  assert.equal(draftWorthKeeping({ borrowerName: "Ann" }), true);
  assert.equal(draftWorthKeeping({ notes: "called twice" }), true);
  assert.equal(draftWorthKeeping({ conversationNotes: "Owns Home: Yes" }), true);
  // Choosing the loan officer is a real decision, often the first one made.
  assert.equal(draftWorthKeeping({ loId: 7 }), true);
  // And any qualification or info-gathering answer, without listing all twenty.
  assert.equal(draftWorthKeeping({ qualOwnHome: "yes" }), true);
  assert.equal(draftWorthKeeping({ infoCreditScore: "620-720" }), true);
});

test("what was typed comes back", () => {
  withStorage();
  saveDraft(15, "2026-09-10", TYPED);
  assert.deepEqual(loadDraft(15, "2026-09-10"), TYPED);
});

test("yesterday's draft is dropped, not offered", () => {
  // A borrower's name surfacing on tomorrow's form is a wrong record, which
  // is worse than the lost work this exists to prevent.
  const store = withStorage();
  saveDraft(15, "2026-09-09", TYPED);
  assert.equal(loadDraft(15, "2026-09-10"), null);
  assert.equal(store.size, 0, "and it is deleted, not left to surprise someone later");
});

test("a draft older than the window is dropped even on the same day", () => {
  const store = withStorage();
  saveDraft(15, "2026-09-10", TYPED);
  const later = Date.now() + DRAFT_MAX_AGE_MS + 1;
  assert.equal(loadDraft(15, "2026-09-10", later), null);
  assert.equal(store.size, 0);
});

test("one CLR's draft never reaches another", () => {
  withStorage();
  saveDraft(15, "2026-09-10", TYPED);
  assert.equal(loadDraft(20, "2026-09-10"), null);
});

test("saving nothing worth keeping clears whatever was there", () => {
  // Otherwise clearing the borrower name by hand would leave the old one
  // sitting in storage, ready to come back on the next reload.
  const store = withStorage();
  saveDraft(15, "2026-09-10", TYPED);
  saveDraft(15, "2026-09-10", { borrowerName: "" });
  assert.equal(store.size, 0);
});

test("a browser that refuses storage does not break the form", () => {
  // Private windows and blocked site data throw on both read and write, and
  // a form that cannot save a draft still has to work perfectly.
  (globalThis as any).localStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.doesNotThrow(() => saveDraft(15, "2026-09-10", TYPED));
  assert.doesNotThrow(() => clearDraft(15));
  assert.equal(loadDraft(15, "2026-09-10"), null);
});

test("corrupt storage reads as no draft rather than throwing", () => {
  const store = withStorage();
  store.set(draftKey(15), "{not json");
  assert.equal(loadDraft(15, "2026-09-10"), null);
  store.set(draftKey(15), JSON.stringify({ date: "2026-09-10" }));
  assert.equal(loadDraft(15, "2026-09-10"), null, "a draft with no values is not a draft");
});

// ── how the form uses it ───────────────────────────────────────────────────

test("only a NEW outcome restores a draft", () => {
  // Opening the form from an assignment, a shotgun lead or an edit passes
  // initialValues, and those describe a specific call. A draft landing on
  // top of one would be a wrong record, not a recovered one.
  assert.match(page, /if \(!open \|\| initialValues \|\| !meId\) return;\s*\n\s*const saved = loadDraft/);
  assert.match(page, /const saved = loadDraft\(meId, businessTodayClient\(\)\)/);
});

test("the draft dies with the form it belonged to", () => {
  // "Log & next" clears the form so one call cannot be attributed to the
  // next; the draft has to go with it, and so must a submitted one.
  const reset = page.slice(page.indexOf("if (!resetSignal) return;"), page.indexOf("}, [resetSignal]);"));
  assert.match(reset, /clearDraft\(meId\)/);
  assert.match(page, /onSubmit=\{form\.handleSubmit\(\(v\) => \{ clearDraft\(meId\);/);
  assert.match(page, /clearDraft\(meId\); setRestoredDraft\(false\); onSubmit\(v, true\);/);
});

test("saving is debounced, because it fires on every keystroke", () => {
  assert.match(page, /setTimeout\(\(\) => saveDraft\(meId, businessTodayClient\(\), values as any\), 400\)/);
  assert.match(page, /sub\.unsubscribe\(\)/, "and the watcher is torn down with the dialog");
});

test("a restored form says so, and can be thrown away", () => {
  // A form that silently fills itself in is worse than one that loses your
  // work: you cannot tell whose call you are looking at.
  assert.match(page, /data-testid="outcome-draft-restored"/);
  assert.match(page, /Picked up where you left off/);
  assert.match(page, /data-testid="button-discard-draft"/);
});

test("'empty again' means empty, even after a draft was restored", () => {
  // react-hook-form REPLACES defaultValues when you reset() with new ones, so
  // once a draft is put back, form.formState.defaultValues IS the draft.
  // Reading them to clear the form made Start fresh do nothing — and would
  // have carried the restored borrower onto the next call through Log & next,
  // which is the exact mistake that reset is written to prevent. Caught in
  // the preview before it shipped, which is why every reset now builds a
  // fresh blank instead of reading state that moved under it.
  assert.match(page, /function blankOutcomeForm\(meId: number\): OutcomeFormValues/);
  const dialog = page.slice(page.indexOf("export function OutcomeFormDialog"), page.indexOf("function EditOutcomeDialog"));
  const code = dialog.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.ok(!/formState\.defaultValues/.test(code),
    "nothing may reset to defaultValues — a restore rewrites them");
  // All four reset paths build a blank.
  assert.ok((dialog.match(/blankOutcomeForm\(meId\)/g) ?? []).length >= 4);
});
