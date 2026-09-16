import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readFileSync } from "node:fs";
import { ensureTvTransferEvents, TV_OUTCOME_EVENT_STAMP_SQL } from "../server/tv-transfer-events";
import { classifyOutcome } from "../server/tv-board";

const outcome = sqliteTable("lead_outcomes", {
  id: integer("id").primaryKey(), orgId: integer("org_id"), outcomeType: text("outcome_type"),
  createdAt: text("created_at"), updatedAt: text("updated_at"), notes: text("notes"),
});
const old = "2020-01-01T08:00:00.000Z";
const later = "2020-01-01T09:00:00.000Z";

function harness(t: TestContext, install = true) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE lead_outcomes (
    id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, outcome_type TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), notes TEXT
  )`);
  if (install) ensureTvTransferEvents(db);
  const read = (id: number) => db.prepare("SELECT * FROM lead_outcomes WHERE id=?").get(id) as any;
  const feed = (since: string, orgId = 1) => db.prepare(`SELECT o.*, ${TV_OUTCOME_EVENT_STAMP_SQL} AS stamp
    FROM lead_outcomes o WHERE o.org_id=? AND o.outcome_type IN ('transfer','appointment','fell_through')
      AND ${TV_OUTCOME_EVENT_STAMP_SQL} > ? ORDER BY stamp ASC LIMIT 40`).all(orgId, since) as any[];
  const cursor = (orgId = 1) => (db.prepare(`SELECT MAX(${TV_OUTCOME_EVENT_STAMP_SQL}) AS m
    FROM lead_outcomes o WHERE o.org_id=?`).get(orgId) as any).m as string | null;
  const insert = (id: number, type: string, at = old, orgId = 1) => db.prepare(
    "INSERT INTO lead_outcomes(id,org_id,outcome_type,created_at,updated_at) VALUES(?,?,?,?,?)",
  ).run(id, orgId, type, at, at);
  return { db, orm: drizzle(db), read, feed, cursor, insert };
}

test("installation is additive and idempotent with no historical transfer backfill", t => {
  const h = harness(t, false);
  h.insert(1, "transfer");
  h.insert(2, "appointment");
  h.db.prepare("UPDATE lead_outcomes SET updated_at=?, notes=? WHERE id=1").run(later, "Historical edit");
  const before = h.db.prepare("SELECT * FROM lead_outcomes ORDER BY id").all();
  ensureTvTransferEvents(h.db);
  ensureTvTransferEvents(h.db);
  const after = h.db.prepare("SELECT * FROM lead_outcomes ORDER BY id").all() as any[];
  assert.deepEqual(after.map(({ tv_transfer_event_at, ...row }) => row), before);
  assert.deepEqual(after.map(row => row.tv_transfer_event_at), [null, null]);
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get() as any).n, 2);
  assert.equal(h.cursor(), old, "old transfer metadata does not advance the event cursor");
  assert.deepEqual(h.feed(h.cursor()!), [], "first-load cursor skips history without a played-ID cache");
});

test("new transfer insertion records creation once and repeated type/notes saves never mint events", t => {
  const h = harness(t);
  h.insert(1, "transfer", later);
  assert.equal(h.read(1).tv_transfer_event_at, later);
  assert.equal(h.feed(old).length, 1);
  h.db.prepare("UPDATE lead_outcomes SET notes=?,outcome_type='transfer',updated_at=? WHERE id=1")
    .run("More complete write-up", "2099-01-01T00:00:00.000Z");
  assert.equal(h.read(1).tv_transfer_event_at, later);
  assert.deepEqual(h.feed(later), [], "an old ID cannot replay even when no browser remembers it");
  const row = h.db.prepare(`SELECT o.*, ${TV_OUTCOME_EVENT_STAMP_SQL} AS stamp FROM lead_outcomes o WHERE id=1`).get() as any;
  assert.equal(classifyOutcome(row)?.at, later, "recent moments retain the actual transfer time");
});

test("normal storage-style Drizzle conversion creates an event without changing original creation time", t => {
  const h = harness(t);
  h.orm.insert(outcome).values({ id: 1, orgId: 1, outcomeType: "appointment", createdAt: old, updatedAt: old }).run();
  assert.equal(h.read(1).tv_transfer_event_at, null);
  h.orm.update(outcome).set({ outcomeType: "transfer", updatedAt: new Date().toISOString() }).where(eq(outcome.id, 1)).returning().get();
  const converted = h.read(1);
  assert.match(converted.tv_transfer_event_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(converted.created_at, old);
  assert.equal(h.feed(old)[0].id, 1, "an appointment logged long ago can become a fresh transfer now");
  h.orm.update(outcome).set({ notes: "Corrected notes", updatedAt: "2099-01-01T00:00:00.000Z" }).where(eq(outcome.id, 1)).run();
  assert.equal(h.read(1).tv_transfer_event_at, converted.tv_transfer_event_at);
  assert.deepEqual(h.feed(converted.tv_transfer_event_at), []);
});

test("direct call-sync SQL conversion is captured even when the writer does not update updated_at", t => {
  const h = harness(t);
  h.insert(1, "appointment");
  h.db.exec("UPDATE lead_outcomes SET outcome_type='transfer' WHERE id=1");
  const converted = h.read(1);
  assert.equal(converted.updated_at, old);
  assert.ok(converted.tv_transfer_event_at > old);
  assert.equal(h.feed(old)[0].id, 1);
  h.db.prepare("UPDATE lead_outcomes SET outcome_type='transfer',notes=?,updated_at=? WHERE id=1")
    .run("Webhook retry", "2099-01-01T00:00:00.000Z");
  assert.deepEqual(h.feed(converted.tv_transfer_event_at), []);
});

test("direct SQL inserts using SQLite's default timestamp produce a valid ISO cursor", t => {
  const h = harness(t);
  h.db.exec("INSERT INTO lead_outcomes(id,org_id,outcome_type) VALUES(1,1,'transfer')");
  assert.match(h.read(1).created_at, /^\d{4}-\d{2}-\d{2} /);
  const startupCursor = h.cursor()!;
  assert.match(startupCursor, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(h.read(1).tv_transfer_event_at, startupCursor);
  assert.deepEqual(h.feed(startupCursor), []);
  const nextSecond = new Date(Date.parse(startupCursor) + 1000).toISOString();
  h.insert(2, "transfer", nextSecond.replace("T", " ").replace(".000Z", ""));
  assert.deepEqual(h.feed(startupCursor).map(row => row.id), [2], "the next same-day transfer is not lost to space/T ordering");
});

test("legacy and non-transfer timestamps are normalized on read without a backfill", t => {
  const h = harness(t, false);
  h.insert(1, "transfer", "2020-01-01 08:00:00");
  h.insert(2, "appointment", "2020-01-01 08:30:00");
  ensureTvTransferEvents(h.db);
  assert.equal(h.read(1).tv_transfer_event_at, null);
  assert.equal(h.cursor(), "2020-01-01T08:30:00.000Z");
  const rows = h.feed("2020-01-01T07:59:59.000Z");
  assert.deepEqual(rows.map(row => row.stamp), [old, "2020-01-01T08:30:00.000Z"]);
  h.db.exec("UPDATE lead_outcomes SET updated_at='2020-01-01 09:00:00' WHERE id=2");
  assert.deepEqual(h.feed("2020-01-01T08:30:00.000Z").map(row => row.id), [2]);
});

test("an edited pre-deployment transfer cannot race after its played-ID cache has expired", t => {
  const h = harness(t, false);
  h.insert(1, "transfer");
  ensureTvTransferEvents(h.db);
  const startupCursor = h.cursor()!;
  h.db.prepare("UPDATE lead_outcomes SET notes=?,updated_at=? WHERE id=1").run("Updated loan details", later);
  assert.equal(h.read(1).tv_transfer_event_at, null, "ordinary editing does not backfill historical rows");
  assert.deepEqual(h.feed(startupCursor).map(classifyOutcome), []);
});

test("non-transfer changes still advance the same organization-scoped cursor", t => {
  const h = harness(t);
  h.insert(1, "appointment");
  h.insert(2, "transfer", later, 2);
  h.db.prepare("UPDATE lead_outcomes SET outcome_type='fell_through',updated_at=? WHERE id=1").run(later);
  assert.equal(h.read(1).tv_transfer_event_at, null);
  const rows = h.feed(old);
  assert.deepEqual(rows.map(row => row.id), [1]);
  assert.equal(rows[0].stamp, later);
  assert.equal(classifyOutcome(rows[0])?.kind, "fell_through");
  assert.deepEqual(h.feed(later), []);
});

test("startup installs event capture after rebuild/seeds and both feed reads use the shared expression", () => {
  const storage = readFileSync(new URL("../server/storage.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  assert.ok(storage.indexOf("ensureTvTransferEvents(sqlite);") > storage.indexOf("ALTER TABLE lead_outcomes__new RENAME TO lead_outcomes"));
  assert.ok(storage.indexOf("ensureTvTransferEvents(sqlite);") > storage.lastIndexOf("INSERT INTO lead_outcomes", storage.indexOf("export class Storage")));
  assert.match(storage, /updateLeadOutcome\(id: number, data:[\s\S]*?updatedAt: new Date\(\)\.toISOString\(\)/);
  const patch = routes.slice(routes.indexOf('app.patch("/api/outcomes/:id"'), routes.indexOf('app.delete("/api/outcomes/:id"'));
  assert.match(patch, /storage\.updateLeadOutcome\(id, body\)/);
  const feed = routes.slice(routes.indexOf('app.get("/api/tv/:token/feed"'), routes.indexOf('app.get("/api/tv/:token/pages"'));
  assert.match(feed, /\$\{TV_OUTCOME_EVENT_STAMP_SQL\} AS stamp/);
  assert.match(feed, /\$\{TV_OUTCOME_EVENT_STAMP_SQL\} > \?/);
  assert.match(feed, /MAX\(\$\{TV_OUTCOME_EVENT_STAMP_SQL\}\)/);
});
