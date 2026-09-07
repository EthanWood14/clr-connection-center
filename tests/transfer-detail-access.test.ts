import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  canReadTransfer, isDetailManager, presentTransfer, listAssistantFilter,
  TRANSFER_DETAIL_SQL, TRANSFER_DETAIL_LOA_SQL, TRANSFER_DETAIL_LIST_SQL,
  TRANSFER_DETAIL_LIST_LIMIT,
} from "../server/transfer-detail-query";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "server/transfer-detail-query.ts"), "utf8");

const clr = { id: 7, role: "clr" };
const manager = { id: 9, role: "clr", isManager: 1 };
const admin = { id: 1, role: "admin" };
const superAdmin = { id: 2, role: "clr", superAdmin: true };

const outcome = (over: Record<string, unknown> = {}) =>
  ({ assistantId: 7, shotgunSenderId: null, ...over }) as any;

// ── who may read whose ──────────────────────────────────────────────────────

test("a manager, an admin and a super admin read everyone's", () => {
  for (const who of [manager, admin, superAdmin]) {
    assert.equal(isDetailManager(who), true);
    assert.equal(canReadTransfer(who, outcome({ assistantId: 44 })), true);
  }
});

test("a CLR reads their own and nobody else's", () => {
  assert.equal(isDetailManager(clr), false);
  assert.equal(canReadTransfer(clr, outcome({ assistantId: 7 })), true);
  assert.equal(canReadTransfer(clr, outcome({ assistantId: 8 })), false);
});

test("the shotgun publisher may read the transfer they are paid half of", () => {
  // They are credited half of this outcome. Being credited for something you
  // are not allowed to look at is the complaint, not the fix.
  const off = outcome({ assistantId: 8, shotgunSenderId: 7 });
  assert.equal(canReadTransfer(clr, off), true);
  // And that does not open up anybody else's.
  assert.equal(canReadTransfer({ id: 12, role: "clr" }, off), false);
});

test("a signed-out or missing viewer reads nothing", () => {
  assert.equal(canReadTransfer(null, outcome()), false);
  assert.equal(canReadTransfer(undefined, outcome()), false);
  assert.equal(canReadTransfer(clr, null), false);
  assert.equal(isDetailManager(null), false);
  // A viewer whose manager flag is absent is not a manager.
  assert.equal(isDetailManager({ id: 3 }), false);
  assert.equal(isDetailManager({ id: 3, role: "clr", isManager: 0 }), false);
});

test("ids are compared as numbers, because sqlite and sessions disagree", () => {
  assert.equal(canReadTransfer({ id: 7 } as any, outcome({ assistantId: "7" })), true);
  assert.equal(canReadTransfer({ id: "7" } as any, outcome({ assistantId: 7 })), true);
});

// ── the query runs against the real table ───────────────────────────────────

test("every column the query names exists on lead_outcomes", () => {
  // A misspelled column here is not a wrong answer, it is a 500 on a page
  // somebody opened to check somebody's work. Prove it against real DDL.
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF"); // this test is about column names, not referential tidiness
  const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

  const create = storage.match(/CREATE TABLE IF NOT EXISTS lead_outcomes[\s\S]*?\);/);
  assert.ok(create, "lead_outcomes DDL not found in storage.ts");
  db.exec(create![0]);
  // The later columns arrive as ALTERs, exactly as they do in production.
  for (const m of storage.matchAll(/ALTER TABLE lead_outcomes ADD COLUMN[^"'`;]*/g)) {
    try { db.exec(m[0].trim().replace(/\s+$/, "") + ";"); } catch {}
  }
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);");
  db.exec("CREATE TABLE loan_officers (id INTEGER PRIMARY KEY, full_name TEXT);");
  db.exec("CREATE TABLE loan_officer_assistants (id INTEGER PRIMARY KEY, lo_id INTEGER, full_name TEXT, active INTEGER);");

  assert.doesNotThrow(() => db.prepare(TRANSFER_DETAIL_SQL));
  assert.doesNotThrow(() => db.prepare(TRANSFER_DETAIL_LOA_SQL));
  assert.doesNotThrow(() => db.prepare(TRANSFER_DETAIL_LIST_SQL));
  // And it actually returns the row it was asked for.
  db.prepare("INSERT INTO lead_outcomes (id, date, assistant_id, lo_id, outcome_type, borrower_name, conversation_notes) VALUES (1,'2026-09-07',7,3,'transfer','Manuel Cruz','Owns Home: Yes')").run();
  const row = db.prepare(TRANSFER_DETAIL_SQL).get(1) as any;
  assert.equal(row.borrowerName, "Manuel Cruz");
  assert.equal(row.assistantId, 7);

  // The list, with the same row, through both shapes of the assistant filter.
  const list = db.prepare(TRANSFER_DETAIL_LIST_SQL);
  const ask = (who: number | null, from = "2026-09-01", to = "2026-09-30") =>
    (list.all({ who, from, to, limit: 50 }) as any[]).length;
  assert.equal(ask(7), 1);
  assert.equal(ask(null), 1, "null means everybody");
  assert.equal(ask(8), 0, "somebody else's book is not returned");
  assert.equal(ask(7, "2026-08-01", "2026-08-31"), 0, "the date window is honoured");

  // A shotgun publisher finds the transfer their lead became.
  db.prepare("UPDATE lead_outcomes SET shotgun_sender_id = 8 WHERE id = 1").run();
  assert.equal(ask(8), 1);
  db.close();
});

// ── the list filter ─────────────────────────────────────────────────────────

test("a CLR is pinned to their own book whatever the request asks for", () => {
  // The person filter is a dropdown for a manager and not a control at all for
  // a CLR — but the request is just text, and a hand-edited one must not read
  // somebody else's write-ups.
  assert.equal(listAssistantFilter(clr, 44), 7);
  assert.equal(listAssistantFilter(clr, ""), 7);
  assert.equal(listAssistantFilter(clr, undefined), 7);
});

test("a manager may ask for one person or for everybody", () => {
  assert.equal(listAssistantFilter(manager, 44), 44);
  assert.equal(listAssistantFilter(manager, "44"), 44);
  assert.equal(listAssistantFilter(manager, undefined), null, "null is everybody");
  assert.equal(listAssistantFilter(manager, "all"), null);
  assert.equal(listAssistantFilter(manager, 0), null);
  assert.equal(listAssistantFilter(manager, -3), null);
});

test("a signed-out request matches nobody rather than everybody", () => {
  // The dangerous default here is null, which the query reads as "no filter".
  assert.equal(listAssistantFilter(null, 44), -1);
  assert.equal(listAssistantFilter(undefined, undefined), -1);
});

test("the list is a page, not an export", () => {
  assert.ok(TRANSFER_DETAIL_LIST_LIMIT > 0 && TRANSFER_DETAIL_LIST_LIMIT <= 1000);
  assert.match(TRANSFER_DETAIL_LIST_SQL, /LIMIT @limit/);
});

// ── what comes back ─────────────────────────────────────────────────────────

test("the presented transfer names everyone involved", () => {
  const p = presentTransfer({
    id: 12, date: "2026-09-07", assistantId: 7,
    borrowerName: "Manuel Cruz", phoneNumber: "5307365868",
    leadSource: "MAROON - HELOC 620-699", transferType: "direct",
    clrName: "Elleine", loName: "Chris Redoble", loaName: "Justin",
    shotgunSenderName: "Kaye",
    conversationNotes: "Owns Home: Yes\nProperty Address: 118 Oak St",
  } as any);
  assert.equal(p.loaName, "Justin", "which LOA it went to is on the page");
  assert.equal(p.shotgunSenderName, "Kaye");
  assert.equal(p.detail.fields.find((f) => f.label === "Property Address")!.value, "118 Oak St");
  assert.match(p.summary, /of \d+ fields/);
});

test("a transfer to an LO with an assistant is scored as one", () => {
  const row = { id: 1, date: "2026-09-07", assistantId: 7, conversationNotes: "Owns Home: Yes" } as any;
  const without = presentTransfer(row, false);
  const with_ = presentTransfer(row, true);
  // The LOA question is only expected when the LO has an assistant, so the two
  // must not score identically — otherwise loHasLoa is being dropped.
  assert.notDeepEqual(without.detail.score, with_.detail.score);
});

// ── what this page may not become ───────────────────────────────────────────

test("this is a read, and cannot become anything else", () => {
  // A page built to answer questions about somebody's work must not be able to
  // change it, or the record stops being evidence of anything.
  const code = source
    .replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), "")
    .split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\b(UPDATE|INSERT|DELETE|DROP|ALTER)\b/i);
});
