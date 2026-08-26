/**
 * Executes the real Shotgun rotation and claim SQL against an in-memory database.
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

/** Read a duration constant out of routes.ts, e.g. `20_000` or `5 * 60_000`. */
function durationConst(name: string): number {
  const raw = new RegExp(`const ${name} = ([^;]+);`).exec(routes);
  assert.ok(raw, `${name} must still be defined in server/routes.ts`);
  const value = raw[1].replace(/_/g, "").split("*").reduce((total, part) => {
    const n = Number(part.trim());
    assert.ok(Number.isFinite(n), `${name} must be a plain numeric expression, got ${raw[1]}`);
    return total * n;
  }, 1);
  assert.ok(value > 0, `${name} must be positive`);
  return value;
}

const OFFER_MS = durationConst("SHOTGUN_OFFER_MS");
const COOLDOWN_MS = durationConst("SHOTGUN_RELAP_COOLDOWN_MS");

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

function storageSqlContaining(fragment: string): string {
  const middle = storage.indexOf(fragment);
  assert.notEqual(middle, -1, `${fragment} must still exist in storage.ts`);
  const start = storage.lastIndexOf("`", middle);
  const end = storage.indexOf("`", middle);
  assert.ok(start !== -1 && end !== -1 && end > start);
  return storage.slice(start + 1, end);
}

/** Slice a statement out of routes.ts, from `head` to the end of its template literal. */
function sqlFrom(head: string, searchFrom = 0): string {
  const start = routes.indexOf(head, searchFrom);
  assert.notEqual(start, -1, `the statement starting "${head.slice(0, 48)}" must still exist`);
  const end = routes.indexOf("`", start);
  assert.notEqual(end, -1);
  return routes.slice(start, end);
}

const candidateSql = () => {
  const start = routes.indexOf("SELECT u.id, u.name FROM users u");
  assert.notEqual(start, -1, "the rotation's candidate query must still exist");
  const end = routes.indexOf("LIMIT 1", start);
  return routes.slice(start, end + "LIMIT 1".length);
};
const offerSql = () => sqlFrom("INSERT INTO shotgun_offers (lead_id,org_id,user_id,offered_at,expires_at,response)");
const claimSql = () => sqlFrom("UPDATE shotgun_leads SET status='claimed'");
const expireSql = () => sqlFrom(
  "UPDATE shotgun_leads SET status='queued',current_assignee_id=NULL,offer_expires_at=NULL,updated_at=?",
  routes.indexOf("function advanceShotgun"),
);

const CLRS = [101, 102, 103];
const T0 = Date.parse("2026-08-21T20:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

function seed(readyIds: number[] = CLRS) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, name TEXT, org_id INTEGER, is_active INTEGER,
    is_clr INTEGER, role TEXT, portal TEXT)`);
  db.exec(tableDdl("shotgun_readiness"));
  db.exec(tableDdl("shotgun_leads"));
  db.exec(tableDdl("shotgun_offers"));
  for (const id of readyIds) {
    db.prepare(`INSERT INTO users (id,name,org_id,is_active,is_clr,role,portal) VALUES (?,?,1,1,1,'assistant',NULL)`)
      .run(id, `CLR ${id}`);
    db.prepare(`INSERT INTO shotgun_readiness (org_id,user_id,is_ready,heartbeat_at,last_assigned_at,updated_at)
      VALUES (1,?,1,?,NULL,?)`).run(id, at(0), at(0));
  }
  db.prepare(`INSERT INTO shotgun_leads (id,org_id,lead_name,status,created_by_user_id,created_at,updated_at)
    VALUES (1,1,'Test Lead','queued',1,?,?)`).run(at(0), at(0));
  return db;
}

/** The client heartbeat, which real browsers send every 10s while C3 is open. */
function beat(db: DatabaseSync, online: number[], nowSeconds: number) {
  for (const id of online) {
    db.prepare(`UPDATE shotgun_readiness SET heartbeat_at=? WHERE org_id=1 AND user_id=?`).run(at(nowSeconds), id);
  }
}

/** The candidate half of assignShotgunLead, with its real heartbeat and cooldown windows. */
function nextCandidate(db: DatabaseSync, nowSeconds: number, online: number[] = CLRS, leadId = 1): number | null {
  beat(db, online, nowSeconds);
  const heartbeatCutoff = new Date(T0 + nowSeconds * 1000 - 35_000).toISOString();
  const relapCutoff = new Date(T0 + nowSeconds * 1000 - COOLDOWN_MS).toISOString();
  const row = db.prepare(candidateSql()).get(leadId, 1, heartbeatCutoff, relapCutoff, leadId) as any;
  return row ? Number(row.id) : null;
}

/** Offer the lead to the next candidate and let the offer lapse, as advanceShotgun does. */
function offerThenExpire(db: DatabaseSync, nowSeconds: number, online: number[] = CLRS): number | null {
  const userId = nextCandidate(db, nowSeconds, online);
  if (userId === null) return null;
  const now = at(nowSeconds);
  const expires = new Date(T0 + nowSeconds * 1000 + OFFER_MS).toISOString();
  db.prepare(offerSql()).run(1, 1, userId, now, expires);
  db.prepare(`UPDATE shotgun_leads SET status='offered',current_assignee_id=?,offer_expires_at=? WHERE id=1 AND status='queued'`).run(userId, expires);
  db.prepare(`UPDATE shotgun_readiness SET last_assigned_at=? WHERE org_id=1 AND user_id=?`).run(now, userId);
  // ...then it lapses.
  const lapsed = at(nowSeconds + OFFER_MS / 1000);
  db.prepare(expireSql()).run(lapsed, 1, userId, lapsed);
  db.prepare(`UPDATE shotgun_offers SET response='expired',responded_at=? WHERE lead_id=1 AND user_id=? AND response='pending'`).run(lapsed, userId);
  return userId;
}

test("the rotation keeps cycling after a full pass with no takers", () => {
  const db = seed();
  const lap1 = [0, 20, 40].map((t) => offerThenExpire(db, t));
  assert.deepEqual(lap1, [101, 102, 103], "first lap goes round every Ready CLR");

  // The bug: the old query excluded anyone ever offered the lead, so the
  // rotation had no candidate from here on and the lead sat queued forever.
  const lap2 = [0, 20, 40].map((t) => offerThenExpire(db, 600 + t));
  assert.deepEqual(lap2, [101, 102, 103], "and it comes back round rather than stalling");
});

test("a CLR is not re-offered the same lead inside the cooldown", () => {
  const db = seed();
  [0, 20, 40].forEach((t) => offerThenExpire(db, t));
  // One lap done. Straight afterwards everyone is still cooling down.
  assert.equal(nextCandidate(db, 60), null, "an unclaimed lead must pace itself, not re-offer immediately");
  assert.equal(nextCandidate(db, COOLDOWN_MS / 1000 - 1), null, "still inside the cooldown");
  assert.equal(nextCandidate(db, COOLDOWN_MS / 1000 + 1), 101, "and resumes once it has elapsed");
});

test("a single Ready CLR is not pinned under a permanently open offer", () => {
  // With one Ready CLR and no cooldown the lead expired and re-offered to the
  // same person within the same tick, so the undismissable full-screen modal
  // never closed and the rest of C3 was unreachable.
  const db = seed([101]);
  assert.equal(offerThenExpire(db, 0, [101]), 101);
  assert.equal(nextCandidate(db, OFFER_MS / 1000, [101]), null, "they get the gap back");
  assert.equal(nextCandidate(db, COOLDOWN_MS / 1000 + 1, [101]), 101);
});

test("a repeat offer refreshes the existing row instead of breaking UNIQUE(lead_id,user_id)", () => {
  const db = seed();
  [0, 20, 40].forEach((t) => offerThenExpire(db, t));
  offerThenExpire(db, 600);
  const rows = db.prepare(`SELECT user_id, offered_at FROM shotgun_offers WHERE lead_id=1 ORDER BY user_id`).all() as any[];
  assert.equal(rows.length, CLRS.length, "one row per CLR — the second lap updates rather than inserts");
  assert.equal(String(rows.find((r) => Number(r.user_id) === 101).offered_at), at(600),
    "the repeat offer must carry the newer timestamp");
});

test("a CLR whose heartbeat has gone stale drops out of the rotation", () => {
  const db = seed();
  db.prepare(`UPDATE shotgun_readiness SET heartbeat_at=? WHERE user_id=101`).run(at(-3600));
  const seen = new Set([0, 20, 40].map((t) => offerThenExpire(db, t, [102, 103])));
  assert.ok(!seen.has(101), "an offline CLR must not be offered a lead");
  assert.ok(seen.has(102) && seen.has(103));
});

test("a CLR holding a live offer is not offered the same lead again", () => {
  const db = seed();
  const first = nextCandidate(db, 0)!;
  db.prepare(offerSql()).run(1, 1, first, at(0), at(20));
  assert.notEqual(nextCandidate(db, 1), first, "the pending offer holder must be skipped");
});

test("a CLR holding one live offer cannot receive a second lead", () => {
  const db = seed();
  db.prepare(`INSERT INTO shotgun_leads (id,org_id,lead_name,status,created_by_user_id,created_at,updated_at)
    VALUES (2,1,'Second Lead','queued',1,?,?)`).run(at(0), at(0));
  offerTo(db, 101, 0);
  assert.equal(nextCandidate(db, 1, CLRS, 2), 102,
    "the next queued lead must skip the CLR whose first offer is still live");
});

test("the database rejects a second live offer even if assignment code regresses", () => {
  const db = seed();
  db.exec(storageSqlContaining("idx_shotgun_one_live_offer_per_clr"));
  offerTo(db, 101, 0);
  db.prepare(`INSERT INTO shotgun_leads (id,org_id,lead_name,status,created_by_user_id,created_at,updated_at)
    VALUES (2,1,'Second Lead','queued',1,?,?)`).run(at(0), at(0));
  assert.throws(() => db.prepare(`UPDATE shotgun_leads SET status='offered',current_assignee_id=101 WHERE id=2`).run(),
    /unique/i, "the partial unique index is the final concurrency guard");
});

test("active duplicate contact keys are rejected but a completed lead does not block a future one", () => {
  const db = seed();
  db.exec(storageSqlContaining("idx_shotgun_active_phone"));
  db.exec(storageSqlContaining("idx_shotgun_active_email"));
  db.prepare(`UPDATE shotgun_leads SET phone_key='15555550100',email_key='lead@example.com' WHERE id=1`).run();
  assert.throws(() => db.prepare(`INSERT INTO shotgun_leads
    (id,org_id,lead_name,phone_key,status,created_by_user_id,created_at,updated_at)
    VALUES (2,1,'Duplicate','15555550100','queued',1,?,?)`).run(at(0), at(0)), /unique/i);
  db.prepare(`UPDATE shotgun_leads SET status='done' WHERE id=1`).run();
  db.prepare(`INSERT INTO shotgun_leads
    (id,org_id,lead_name,phone_key,email_key,status,created_by_user_id,created_at,updated_at)
    VALUES (2,1,'Future Lead','15555550100','lead@example.com','queued',1,?,?)`).run(at(0), at(0));
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM shotgun_leads`).get() as any).count), 2);
});

// ── Once a lead is confirmed it belongs to exactly one CLR ──────────────────

/** The claim half of POST /api/shotgun/:id/confirm. Returns whether it took. */
function confirm(db: DatabaseSync, userId: number, nowSeconds: number): boolean {
  const now = at(nowSeconds);
  const lead = db.prepare(`SELECT * FROM shotgun_leads WHERE id=1 AND org_id=1`).get() as any;
  // The handler's own preconditions, before the guarded UPDATE.
  if (!lead || lead.status !== "offered" || Number(lead.current_assignee_id) !== userId
      || String(lead.offer_expires_at) <= now) return false;
  const changed = db.prepare(claimSql()).run(now, now, 1, 1, userId, now);
  return Number(changed.changes) > 0;
}

function offerTo(db: DatabaseSync, userId: number, nowSeconds: number) {
  const expires = new Date(T0 + nowSeconds * 1000 + OFFER_MS).toISOString();
  db.prepare(offerSql()).run(1, 1, userId, at(nowSeconds), expires);
  db.prepare(`UPDATE shotgun_leads SET status='offered',current_assignee_id=?,offer_expires_at=? WHERE id=1`).run(userId, expires);
}

test("once a lead is confirmed nobody else can claim it", () => {
  const db = seed();
  offerTo(db, 101, 0);
  assert.equal(confirm(db, 101, 5), true, "the CLR the lead was offered to claims it");

  for (const other of [102, 103]) {
    assert.equal(confirm(db, other, 6), false, `CLR ${other} must not be able to take a claimed lead`);
  }
  assert.equal(confirm(db, 101, 7), false, "and it cannot be double-claimed by the owner either");

  const lead = db.prepare(`SELECT status, current_assignee_id FROM shotgun_leads WHERE id=1`).get() as any;
  assert.equal(String(lead.status), "claimed");
  assert.equal(Number(lead.current_assignee_id), 101, "ownership must not move once claimed");
});

test("a CLR cannot claim an offer that was never theirs, even while it is live", () => {
  const db = seed();
  offerTo(db, 101, 0);
  assert.equal(confirm(db, 102, 5), false, "claiming somebody else's live offer must fail");
  assert.equal(confirm(db, 101, 5), true, "the rightful owner is unaffected");
});

test("an expired offer cannot be claimed, and the claim cannot resurrect it", () => {
  const db = seed();
  offerTo(db, 101, 0);
  const afterExpiry = OFFER_MS / 1000 + 1;
  assert.equal(confirm(db, 101, afterExpiry), false, "the window closed");
  const lead = db.prepare(`SELECT status FROM shotgun_leads WHERE id=1`).get() as any;
  assert.equal(String(lead.status), "offered", "and the claim left the row untouched");
});

test("the rotation will not re-offer a lead that has been claimed", () => {
  const db = seed();
  offerTo(db, 101, 0);
  assert.equal(confirm(db, 101, 5), true);
  // assignShotgunLead only ever touches a queued lead, and the expiry sweep
  // only ever touches an offered one — so a claimed lead is out of reach.
  const assign = routes.slice(routes.indexOf("function assignShotgunLead"), routes.indexOf("function advanceShotgun"));
  assert.match(assign, /lead\.status !== "queued"/);
  assert.match(assign, /WHERE id=\? AND status='queued'/);

  const lapsed = at(600);
  db.prepare(expireSql()).run(lapsed, 1, 101, lapsed);
  const lead = db.prepare(`SELECT status, current_assignee_id FROM shotgun_leads WHERE id=1`).get() as any;
  assert.equal(String(lead.status), "claimed", "the expiry sweep must not queue a claimed lead");
  assert.equal(Number(lead.current_assignee_id), 101);
});
