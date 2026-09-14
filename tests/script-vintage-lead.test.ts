import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  VINTAGE_LEAD_LABEL, VINTAGE_LEAD_MIGRATION, VINTAGE_LEAD_RESPONSES, VINTAGE_LEAD_TEXT,
  ensureVintageLeadBranch,
} from "../server/script-vintage-lead";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The default calling script gets a "Vintage lead" option: an opener for an
 * inquiry that is months old, whose answers route into the branches the
 * script already has. It is added to the LIVE default script rather than by
 * re-seeding, so admin edits survive; it runs once; and a branch it cannot
 * find is skipped, never mis-wired.
 */

/** A miniature of the seeded v5 default: a root opener and the branches vintage answers point at. */
function seededDb(opts: { withRatesNode?: boolean } = {}): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE call_scripts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, owner_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE script_nodes (id INTEGER PRIMARY KEY AUTOINCREMENT, script_id INTEGER NOT NULL, parent_node_id INTEGER, parent_response_id INTEGER, text TEXT NOT NULL, hint TEXT, node_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE script_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, node_id INTEGER NOT NULL, label TEXT NOT NULL, color TEXT, next_node_id INTEGER, response_order INTEGER NOT NULL DEFAULT 0);
  `);
  const sid = Number(db.prepare(`INSERT INTO call_scripts (name, owner_id) VALUES ('WCL Cold Call Script v5', NULL)`).run().lastInsertRowid);
  // A personal copy, which must never be touched.
  const personal = Number(db.prepare(`INSERT INTO call_scripts (name, owner_id) VALUES ('Skyler''s script', 789)`).run().lastInsertRowid);
  db.prepare(`INSERT INTO script_nodes (script_id, parent_node_id, text, node_order) VALUES (?, NULL, 'Hi, is this [Borrower Name]? …', 1)`).run(personal);

  const node = (text: string, order: number, parent: number | null = null) =>
    Number(db.prepare(`INSERT INTO script_nodes (script_id, parent_node_id, text, node_order) VALUES (?, ?, ?, ?)`).run(sid, parent, text, order).lastInsertRowid);
  const rootId = node("Hi, is this [Borrower Name]? Great — [Borrower Name], good [morning/afternoon/evening]! …", 1);
  const targets: Record<string, number> = {
    cash: node("Awesome! Can you confirm a few quick things for me:\n\n1) Your address", 1, rootId),
    notSure: node("Okay. What made you make the inquiry in the first place?", 2, rootId),
    changed: node("Okay, I mean I totally understand that things change. What made you change your mind?", 4, rootId),
    future: node("Alright, well, I understand. What made you make the change?", 6, rootId),
    sell: node("Okay. Are you looking to buy another house?", 7, rootId),
    lender: node("Have you closed or completed the deal yet?", 8, rootId),
    wrong: node("Okay. Could [Borrower Name] be someone in the family?", 9, rootId),
    hostile: node("Hey, what did I do? This [Address] is your address, right?", 10, rootId),
    busy: node("Totally get it — I'll be two minutes, max.", 11, rootId),
    voicemail: node("[VOICEMAIL — keep it under 25 seconds]: …", 13, rootId),
  };
  if (opts.withRatesNode !== false) {
    targets.rates = node("Okay, I mean I understand that stuff like that happens. I will say, rates aren't expected to drop", 5, rootId);
  }
  // The root's existing answers, starting at order 1 like the seed's.
  let order = 1;
  for (const [label, id] of Object.entries(targets)) {
    db.prepare(`INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?, ?, 'yellow', ?, ?)`).run(rootId, label, id, order++);
  }
  return db;
}

test("adds one first-on-screen option to the root, with Ethan's opener behind it", () => {
  const db = seededDb();
  const r = ensureVintageLeadBranch(db);
  assert.equal(r.applied, true);
  if (!r.applied) return;
  const rootResponses = db.prepare(`SELECT label, color, next_node_id, response_order FROM script_responses WHERE node_id = (SELECT id FROM script_nodes WHERE parent_node_id IS NULL AND script_id = 1) ORDER BY response_order`).all() as any[];
  assert.equal(rootResponses[0].label, VINTAGE_LEAD_LABEL);
  assert.equal(rootResponses[0].color, "blue");
  assert.equal(rootResponses[0].next_node_id, r.nodeId);
  const node = db.prepare(`SELECT * FROM script_nodes WHERE id = ?`).get(r.nodeId) as any;
  assert.equal(node.text, VINTAGE_LEAD_TEXT);
  assert.match(node.text, /A couple of months ago you were looking at taking out some cash via a HELOC or refinancing\? What made you decide not to move in that direction\?/);
  assert.equal(node.parent_response_id, r.responseId);
  assert.equal(node.script_id, 1);
});

test("every answer routes into the branch the script already has, and 'Not interested' ends the call", () => {
  const db = seededDb();
  const r = ensureVintageLeadBranch(db);
  assert.equal(r.applied, true);
  if (!r.applied) return;
  assert.equal(r.wired, VINTAGE_LEAD_RESPONSES.length);
  assert.deepEqual(r.skipped, []);
  const answers = db.prepare(`SELECT label, next_node_id FROM script_responses WHERE node_id = ? ORDER BY response_order`).all(r.nodeId) as any[];
  const textOf = (id: number | null) => id == null ? null : String((db.prepare(`SELECT text FROM script_nodes WHERE id = ?`).get(id) as any).text);
  const byLabel = new Map(answers.map((a) => [a.label, textOf(a.next_node_id)]));
  assert.match(byLabel.get("Still want the cash out")!, /^Awesome! Can you confirm/);
  assert.match(byLabel.get("Rates too high")!, /^Okay, I mean I understand that stuff/);
  assert.match(byLabel.get("Looking in the future")!, /^Alright, well, I understand/);
  assert.match(byLabel.get("Planning to sell \/ move")!, /^Okay\. Are you looking to buy/);
  assert.match(byLabel.get("Went with another lender")!, /^Have you closed/);
  assert.match(byLabel.get("Not sure / no real reason")!, /^Okay\. What made you make the inquiry/);
  assert.match(byLabel.get("Changed their mind")!, /^Okay, I mean I totally understand/);
  assert.match(byLabel.get("Wrong person")!, /^Okay\. Could \[Borrower Name\]/);
  assert.match(byLabel.get("Wrong number / hostile")!, /^Hey, what did I do/);
  assert.match(byLabel.get("Busy right now")!, /^Totally get it/);
  assert.match(byLabel.get("No answer — voicemail")!, /^\[VOICEMAIL/);
  assert.equal(byLabel.get("Not interested"), null);
  // Nothing was added under the personal copy.
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM script_nodes WHERE script_id = 2`).get() as any).n, 1);
});

test("runs once: a second call is a no-op, recorded in migrations_applied", () => {
  const db = seededDb();
  assert.equal(ensureVintageLeadBranch(db).applied, true);
  const again = ensureVintageLeadBranch(db);
  assert.deepEqual(again, { applied: false, reason: "already_applied" });
  assert.ok(db.prepare(`SELECT 1 FROM migrations_applied WHERE name = ?`).get(VINTAGE_LEAD_MIGRATION));
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM script_responses WHERE label = ?`).get(VINTAGE_LEAD_LABEL) as any).n, 1);
});

test("a branch it cannot find is skipped, never mis-wired", () => {
  const db = seededDb({ withRatesNode: false });
  const r = ensureVintageLeadBranch(db);
  assert.equal(r.applied, true);
  if (!r.applied) return;
  assert.deepEqual(r.skipped, ["Rates too high"]);
  assert.equal(r.wired, VINTAGE_LEAD_RESPONSES.length - 1);
  const labels = (db.prepare(`SELECT label FROM script_responses WHERE node_id = ?`).all(r.nodeId) as any[]).map((a) => a.label);
  assert.ok(!labels.includes("Rates too high"));
});

test("does nothing on a database with no default script", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE call_scripts (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1, owner_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
           CREATE TABLE script_nodes (id INTEGER PRIMARY KEY, script_id INTEGER, parent_node_id INTEGER, parent_response_id INTEGER, text TEXT, hint TEXT, node_order INTEGER);
           CREATE TABLE script_responses (id INTEGER PRIMARY KEY, node_id INTEGER, label TEXT, color TEXT, next_node_id INTEGER, response_order INTEGER);`);
  assert.deepEqual(ensureVintageLeadBranch(db), { applied: false, reason: "no_default_script" });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM migrations_applied`).get() && (db.prepare(`SELECT COUNT(*) AS n FROM migrations_applied WHERE name = ?`).get(VINTAGE_LEAD_MIGRATION) as any).n, 0);
});

test("storage runs it right after the v5 seed", () => {
  const storage = readFileSync(join(root, "server/storage.ts"), "utf8").replace(/\r\n/g, "\n");
  const seed = storage.indexOf("try { seedEthanScript(); }");
  const vintage = storage.indexOf("ensureVintageLeadBranch(sqlite)");
  assert.ok(seed > 0 && vintage > seed && vintage - seed < 400, "vintage branch must run immediately after the seed");
  assert.match(storage, /import \{ ensureVintageLeadBranch \} from "\.\/script-vintage-lead";/);
});
