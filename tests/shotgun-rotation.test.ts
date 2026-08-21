/**
 * Executes the real Shotgun rotation SQL against an in-memory database.
 *
 * The queries and the table definitions are extracted from the shipped source
 * rather than copied here, so this cannot keep passing against a stale copy of
 * a query that production no longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

/** Pull `CREATE TABLE IF NOT EXISTS <name> ( ... )` out of storage.ts. */
function tableDdl(name: string): string {
  const start = storage.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.notEqual(start, -1, `${name} must still be created in storage.ts`);
  const open = storage.indexOf("(", start);
  let depth = 0;
  for (let i = open; i < storage.length; i++) {
    if (storage[i] === "(") depth++;
    else if (storage[i] === ")") {
      depth--;
      if (depth === 0) return storage.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced parentheses in ${name}`);
}

/** The candidate SELECT that decides who gets offered a lead next. */
function candidateSql(): string {
  const start = routes.indexOf("SELECT u.id, u.name FROM users u");
  assert.notEqual(start, -1, "the rotation's candidate query must still exist");
  const end = routes.indexOf("LIMIT 1", start);
  assert.notEqual(end, -1);
  return routes.slice(start, end + "LIMIT 1".length);
}

/** The offer write, which must survive a second lap round the rotation. */
function offerSql(): string {
  const start = routes.indexOf("INSERT INTO shotgun_offers (lead_id,org_id,user_id,offered_at,expires_at,response)");
  assert.notEqual(start, -1, "the offer write must still exist");
  const end = routes.indexOf("`", start);
  return routes.slice(start, end);
}

const CLRS = [101, 102, 103];

function seed() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, name TEXT, org_id INTEGER, is_active INTEGER,
    is_clr INTEGER, role TEXT, portal TEXT)`);
  db.exec(tableDdl("shotgun_readiness"));
  db.exec(tableDdl("shotgun_leads"));
  db.exec(tableDdl("shotgun_offers"));

  const heartbeat = "2026-08-21T20:00:00.000Z";
  for (const id of CLRS) {
    db.prepare(`INSERT INTO users (id,name,org_id,is_active,is_clr,role,portal) VALUES (?,?,1,1,1,'assistant',NULL)`)
      .run(id, `CLR ${id}`);
    db.prepare(`INSERT INTO shotgun_readiness (org_id,user_id,is_ready,heartbeat_at,last_assigned_at,updated_at)
      VALUES (1,?,1,?,NULL,?)`).run(id, heartbeat, heartbeat);
  }
  db.prepare(`INSERT INTO shotgun_leads (id,org_id,lead_name,status,created_by_user_id,created_at,updated_at)
    VALUES (1,1,'Test Lead','queued',1,?,?)`).run(heartbeat, heartbeat);
  return db;
}

/** One turn of the rotation: offer to the next candidate, then let it expire. */
function offerThenExpire(db: DatabaseSync, at: string): number | null {
  const cutoff = "2026-08-21T19:59:30.000Z"; // heartbeat is inside the TTL
  const candidate = db.prepare(candidateSql()).get(1, 1, cutoff) as any;
  if (!candidate) return null;
  const userId = Number(candidate.id);
  db.prepare(offerSql()).run(1, 1, userId, at, at);
  db.prepare(`UPDATE shotgun_readiness SET last_assigned_at=? WHERE org_id=1 AND user_id=?`).run(at, userId);
  db.prepare(`UPDATE shotgun_offers SET response='expired',responded_at=? WHERE lead_id=1 AND user_id=? AND response='pending'`)
    .run(at, userId);
  return userId;
}

test("the rotation keeps cycling after a full pass with no takers", () => {
  const db = seed();
  const order: (number | null)[] = [];
  for (let turn = 0; turn < 7; turn++) {
    order.push(offerThenExpire(db, `2026-08-21T20:0${turn}:00.000Z`));
  }

  // The bug: the rotation excluded anyone who had ever been offered the lead,
  // so turn 3 onwards returned nobody and the lead sat queued forever.
  assert.ok(!order.includes(null), `rotation stalled after a full pass: ${JSON.stringify(order)}`);
  assert.equal(order.length, 7);
  assert.deepEqual(order, [101, 102, 103, 101, 102, 103, 101], "must cycle in stable round-robin order");
});

test("a repeat offer refreshes the existing row instead of breaking UNIQUE(lead_id,user_id)", () => {
  const db = seed();
  for (let turn = 0; turn < 4; turn++) offerThenExpire(db, `2026-08-21T20:0${turn}:00.000Z`);

  // Four turns across three CLRs means CLR 101 was offered twice.
  const rows = db.prepare(`SELECT user_id, offered_at FROM shotgun_offers WHERE lead_id=1 ORDER BY user_id`).all() as any[];
  assert.equal(rows.length, CLRS.length, "one row per CLR — the second lap updates rather than inserts");
  const first = rows.find((r) => Number(r.user_id) === 101);
  assert.equal(String(first.offered_at), "2026-08-21T20:03:00.000Z", "the repeat offer must carry the newer timestamp");
});

test("a CLR whose heartbeat has gone stale drops out of the rotation", () => {
  const db = seed();
  db.prepare(`UPDATE shotgun_readiness SET heartbeat_at='2026-08-21T19:00:00.000Z' WHERE user_id=101`).run();
  const seen = new Set<number | null>();
  for (let turn = 0; turn < 4; turn++) seen.add(offerThenExpire(db, `2026-08-21T20:0${turn}:00.000Z`));
  assert.ok(!seen.has(101), "an offline CLR must not be offered a lead");
  assert.ok(seen.has(102) && seen.has(103));
});

test("a CLR who already holds a live offer is not offered the same lead again", () => {
  const db = seed();
  const cutoff = "2026-08-21T19:59:30.000Z";
  const first = db.prepare(candidateSql()).get(1, 1, cutoff) as any;
  db.prepare(offerSql()).run(1, 1, Number(first.id), "2026-08-21T20:00:00.000Z", "2026-08-21T20:00:20.000Z");
  const next = db.prepare(candidateSql()).get(1, 1, cutoff) as any;
  assert.notEqual(Number(next.id), Number(first.id), "the pending offer holder must be skipped");
});
