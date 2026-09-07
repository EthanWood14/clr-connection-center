import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { registerTransferDetailRoutes } from "../server/transfer-detail-routes";
import type { DetailViewer } from "../server/transfer-detail-query";

/**
 * The routes, driven through a stand-in Express so the real behaviour — who
 * gets what, and what a hand-edited request can reach — is exercised without
 * booting the app.
 */

type Handler = (req: any, res: any) => void;

function fakeApp() {
  const routes = new Map<string, Handler>();
  const app: any = {
    get(path: string, _auth: any, handler: Handler) { routes.set(path, handler); },
  };
  return { app, routes };
}

function fakeRes() {
  const out: any = { code: 200, body: null };
  const res: any = {
    status(c: number) { out.code = c; return res; },
    json(b: any) { out.body = b; return res; },
  };
  return { res, out };
}

function seed() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE lead_outcomes (
      id INTEGER PRIMARY KEY, date TEXT, assistant_id INTEGER, lo_id INTEGER, loa_id INTEGER,
      outcome_type TEXT, transfer_type TEXT, borrower_name TEXT, phone_number TEXT,
      lead_source TEXT, conversation_notes TEXT, notes TEXT, prequalification_notes TEXT,
      lo_action_plan TEXT, next_steps TEXT, lead_goal TEXT, lead_timeframe TEXT,
      follow_up_date TEXT, appointment_datetime TEXT, helper_assisted INTEGER,
      bulk_texter INTEGER, lead_type TEXT, shotgun_sender_id INTEGER, created_at TEXT
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE loan_officers (id INTEGER PRIMARY KEY, full_name TEXT);
    CREATE TABLE loan_officer_assistants (id INTEGER PRIMARY KEY, lo_id INTEGER, full_name TEXT, active INTEGER);
  `);
  db.exec(`
    INSERT INTO users (id, name) VALUES (7,'Kaye'),(8,'Elleine'),(9,'Manager');
    INSERT INTO loan_officers (id, full_name) VALUES (3,'Chris Redoble');
    INSERT INTO loan_officer_assistants (id, lo_id, full_name, active) VALUES (5,3,'Justin',1);
    INSERT INTO lead_outcomes (id,date,assistant_id,lo_id,loa_id,outcome_type,transfer_type,borrower_name,conversation_notes,notes)
      VALUES (1,'2026-09-07',7,3,5,'transfer','direct','Manuel Cruz','Owns Home: Yes
Property Address: 118 Oak St','Wants cash out.');
    INSERT INTO lead_outcomes (id,date,assistant_id,lo_id,outcome_type,borrower_name,conversation_notes)
      VALUES (2,'2026-09-07',8,3,'transfer','Dana Lin','Owns Home: No');
    INSERT INTO lead_outcomes (id,date,assistant_id,lo_id,outcome_type,borrower_name)
      VALUES (3,'2026-09-07',7,3,'appointment','Not A Transfer');
  `);
  return db;
}

function wire(db: any, viewer: DetailViewer | null) {
  const { app, routes } = fakeApp();
  registerTransferDetailRoutes(app, {
    requireAuth: ((_q: any, _s: any, n: any) => n()) as any,
    db: () => db,
    userFor: () => viewer,
  });
  const call = (path: string, req: any = {}) => {
    const { res, out } = fakeRes();
    routes.get(path)!({ query: {}, params: {}, ...req }, res);
    return out;
  };
  return call;
}

const CLR = { id: 7, role: "clr" };
const OTHER = { id: 8, role: "clr" };
const MANAGER = { id: 9, role: "clr", isManager: 1 };
const WINDOW = { query: { from: "2026-09-01", to: "2026-09-30" } };

// ── the list ────────────────────────────────────────────────────────────────

test("a manager sees everyone's write-ups, with the text attached", () => {
  const out = wire(seed(), MANAGER)("/api/transfers/written", WINDOW);
  assert.equal(out.code, 200);
  assert.equal(out.body.transfers.length, 2, "both transfers, and not the appointment");
  const cruz = out.body.transfers.find((t: any) => t.borrowerName === "Manuel Cruz");
  // The whole point: the values, in the list, without a second request.
  assert.equal(cruz.detail.fields.find((f: any) => f.label === "Property Address").value, "118 Oak St");
  assert.equal(cruz.loName, "Chris Redoble");
  assert.equal(cruz.loaName, "Justin");
  assert.ok(cruz.detail.narrative.some((n: any) => n.value === "Wants cash out."));
});

test("a CLR sees their own and cannot ask for anyone else's", () => {
  const call = wire(seed(), CLR);
  const mine = call("/api/transfers/written", WINDOW);
  assert.deepEqual(mine.body.transfers.map((t: any) => t.borrowerName), ["Manuel Cruz"]);

  // The filter is a request parameter, so it is the obvious thing to edit.
  const forged = call("/api/transfers/written", { query: { ...WINDOW.query, assistantId: "8" } });
  assert.deepEqual(forged.body.transfers.map((t: any) => t.borrowerName), ["Manuel Cruz"],
    "asking for somebody else's book returns your own, not theirs");
});

test("a manager may narrow to one person", () => {
  const out = wire(seed(), MANAGER)("/api/transfers/written", { query: { ...WINDOW.query, assistantId: "8" } });
  assert.deepEqual(out.body.transfers.map((t: any) => t.borrowerName), ["Dana Lin"]);
});

test("a signed-out request gets nothing, not everything", () => {
  const out = wire(seed(), null)("/api/transfers/written", WINDOW);
  assert.equal(out.code, 401);
});

test("a junk or backwards window returns an empty page rather than the whole table", () => {
  const call = wire(seed(), MANAGER);
  const backwards = call("/api/transfers/written", { query: { from: "2026-09-30", to: "2026-09-01" } });
  assert.deepEqual(backwards.body.transfers, []);
  // Junk dates fall back to today rather than reaching the query.
  const junk = call("/api/transfers/written", { query: { from: "'; DROP TABLE lead_outcomes;--", to: "x" } });
  assert.equal(junk.code, 200);
  assert.ok(Array.isArray(junk.body.transfers));
});

// ── one transfer ────────────────────────────────────────────────────────────

test("a manager can open any single transfer", () => {
  const out = wire(seed(), MANAGER)("/api/transfers/:id/written", { params: { id: "2" } });
  assert.equal(out.code, 200);
  assert.equal(out.body.transfer.borrowerName, "Dana Lin");
});

test("somebody else's transfer is a 404, not a 403", () => {
  // A 403 confirms the row exists, which lets the id space be walked to learn
  // who transferred whom. Both answers must look the same.
  const call = wire(seed(), OTHER);
  const notYours = call("/api/transfers/:id/written", { params: { id: "1" } });
  const notReal = call("/api/transfers/:id/written", { params: { id: "9999" } });
  assert.equal(notYours.code, 404);
  assert.equal(notReal.code, 404);
  assert.deepEqual(notYours.body, notReal.body);
});

test("the shotgun publisher can open the transfer they are paid half of", () => {
  const db = seed();
  db.prepare("UPDATE lead_outcomes SET shotgun_sender_id = 7 WHERE id = 2").run();
  const out = wire(db, CLR)("/api/transfers/:id/written", { params: { id: "2" } });
  assert.equal(out.code, 200);
  assert.equal(out.body.transfer.borrowerName, "Dana Lin");
  // And it shows up in their list too, or the credit is unexplainable.
  const list = wire(db, CLR)("/api/transfers/written", WINDOW);
  assert.equal(list.body.transfers.length, 2);
});

test("a bad id is rejected before it reaches the query", () => {
  const call = wire(seed(), MANAGER);
  for (const id of ["abc", "-1", "0", "1.5", ""]) {
    assert.equal(call("/api/transfers/:id/written", { params: { id } }).code, 400, `id ${JSON.stringify(id)}`);
  }
});

test("the LOA question is scored against whether that LO actually has one", () => {
  const db = seed();
  const withLoa = wire(db, MANAGER)("/api/transfers/:id/written", { params: { id: "1" } });
  assert.equal(withLoa.body.transfer.detail.fields.find((f: any) => f.label === "LOA").applicable, true);

  db.prepare("UPDATE loan_officer_assistants SET active = 0 WHERE lo_id = 3").run();
  const without = wire(db, MANAGER)("/api/transfers/:id/written", { params: { id: "1" } });
  assert.equal(without.body.transfer.detail.fields.find((f: any) => f.label === "LOA").applicable, false);
});

test("a database that falls over is a 500, not a crashed process", () => {
  const broken = { prepare() { throw new Error("no such table"); } };
  const call = wire(broken, MANAGER);
  assert.equal(call("/api/transfers/written", WINDOW).code, 500);
  assert.equal(call("/api/transfers/:id/written", { params: { id: "1" } }).code, 500);
});
