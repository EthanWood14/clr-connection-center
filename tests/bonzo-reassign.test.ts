import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  planReassign, normalizePhone, normalizeEmail, isUsablePhone,
  type ReassignCandidate,
} from "../server/bonzo-reassign";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "server/bonzo-reassign.ts"), "utf8");

const BILL = "bill@westcapitallending.com";
const CHRIS = "chris@westcapitallending.com";
const GARY = "gary@westcapitallending.com";

const held = (id: number, email: string | null, name = "Manuel Cruz"): ReassignCandidate =>
  ({ id, name, assignedUserName: null, assignedUserEmail: email });

const ask = (over: Partial<{ phone: string; fromEmail: string; toEmail: string }> = {}) =>
  ({ phone: "(530) 736-5868", fromEmail: BILL, toEmail: CHRIS, ...over });

// ── the identifying step ────────────────────────────────────────────────────

test("the current assignee is what picks the record out of a shared phone", () => {
  // Three books hold this borrower. The phone alone cannot say which is meant,
  // and picking wrong moves a stranger's client — so the from-address decides.
  const shared = [held(11, GARY), held(22, BILL), held(33, CHRIS)];
  const v = planReassign(ask(), shared);
  assert.equal(v.action, "move");
  assert.equal(v.prospectId, 22, "Bill's is the one that moves, not Gary's or Chris's");
});

test("a phone nobody on it is held by is refused, not guessed", () => {
  // The realistic causes are all reasons to stop: it already moved, the phone
  // was mistyped, or the row came out of a stale export.
  const v = planReassign(ask(), [held(11, GARY), held(33, CHRIS)]);
  assert.equal(v.action, "refuse");
  assert.equal(v.prospectId, null);
  assert.match(v.reason!, /Nobody on that phone is assigned to/);
  // The refusal has to be actionable, so it says who DOES hold it.
  assert.match(v.reason!, /gary@westcapitallending\.com/);
  assert.match(v.reason!, /chris@westcapitallending\.com/);
});

test("a record that already moved reports done rather than failing", () => {
  const v = planReassign(ask(), [held(33, CHRIS)]);
  assert.equal(v.action, "already");
  assert.equal(v.prospectId, 33);
  assert.match(v.reason!, /Already assigned/);
});

test("one person holding the same phone twice stops instead of splitting them", () => {
  // Moving one duplicate and leaving the other is how a borrower ends up half
  // in each of two books.
  const v = planReassign(ask(), [held(41, BILL), held(42, BILL)]);
  assert.equal(v.action, "refuse");
  assert.match(v.reason!, /holds 2 prospects on that phone \(ids 41, 42\)/);
  assert.match(v.reason!, /would split the borrower/);
});

test("no prospect on that phone at all is its own refusal", () => {
  const v = planReassign(ask(), []);
  assert.equal(v.action, "refuse");
  assert.match(v.reason!, /No prospect in Bonzo has that phone/);
});

// ── the inputs ──────────────────────────────────────────────────────────────

test("a phone is compared by digits, however it was typed", () => {
  assert.equal(normalizePhone("+1 (530) 736-5868"), "5307365868");
  assert.equal(normalizePhone("15307365868"), "5307365868");
  assert.equal(normalizePhone("530-736-5868"), "5307365868");
  assert.equal(normalizePhone("530.736.5868"), "5307365868");
  // An 11-digit number that does not start with 1 is not a US number with a
  // country code, so nothing is stripped and it fails the length check.
  assert.equal(normalizePhone("25307365868"), "25307365868");
  assert.equal(isUsablePhone("25307365868"), false);
  assert.equal(isUsablePhone("736-5868"), false);
  assert.equal(isUsablePhone(""), false);
});

test("people are matched on email, case and spacing aside", () => {
  assert.equal(normalizeEmail("  Bill@WestCapitalLending.com "), BILL);
  const v = planReassign(ask({ fromEmail: " BILL@westcapitallending.COM " }), [held(22, BILL)]);
  assert.equal(v.action, "move");
  assert.equal(v.prospectId, 22);
});

test("a missing from-address is refused, because it is half the key", () => {
  const v = planReassign(ask({ fromEmail: "" }), [held(22, BILL)]);
  assert.equal(v.action, "refuse");
  assert.match(v.reason!, /who holds it now/);
});

test("moving something to the person who already has it is not a move", () => {
  const v = planReassign(ask({ toEmail: BILL }), [held(22, BILL)]);
  assert.equal(v.action, "refuse");
  assert.match(v.reason!, /nothing to move/);
});

test("junk inputs produce a verdict rather than an exception", () => {
  for (const bad of [null, undefined, {}, { phone: "x", fromEmail: null, toEmail: 7 }]) {
    const v = planReassign(bad as any, null);
    assert.equal(v.action, "refuse");
    assert.ok(v.reason && v.reason.length > 10, "and it says something usable");
  }
  // A candidate list carrying rubbish ids is filtered, not trusted.
  const v = planReassign(ask(), [held(0, BILL), held(-3, BILL), held(22, BILL)]);
  assert.equal(v.action, "move");
  assert.equal(v.prospectId, 22);
});

// ── what this file may not become ───────────────────────────────────────────

test("nothing here matches a person by display name", () => {
  // Bonzo display names are not the people they look like — "Billy" is Bill
  // Neessen — so a name comparison would move the wrong book. The decision is
  // allowed to READ assignedUserName for a message, never to match on it.
  const decision = source.slice(source.indexOf("export function planReassign"));
  assert.doesNotMatch(decision, /assignedUserName\s*(===|==|\.toLowerCase)/);
  assert.match(source, /IDENTITY IS AN EMAIL, NEVER A NAME/);
});

test("this module decides and performs nothing", () => {
  // The Bonzo calls belong to the route. If this file ever reaches out, the
  // rules stop being testable without touching somebody's live CRM.
  // Comments stripped first: the header legitimately POINTS AT
  // findProspectByPhone to explain why identity is an email, and a raw
  // match would read that sentence as a call.
  const code = source
    .replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\bfetch\s*\(|\baxios\b/);
  assert.doesNotMatch(code, /reassignProspect\s*\(|findProspectByPhone\s*\(/);
  assert.doesNotMatch(code, /^import /m, "it needs nothing to decide");
});
