import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  MARKUS_WOOD_NAME_RE,
  MARKUS_WOOD_PIN,
  matchesMarkusWood,
  matchesTimedNeedsTransfersName,
  pacificCalendarDate,
  timedNeedsTransfersDesired,
  isTimedNeedsTransfersWindowActive,
} from "../shared/timed-needs-transfers";
import { ensureTimedNeedsTransfersPins } from "../server/timed-needs-transfers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Markus Wood name match: Markus Wood yes; other Woods / Mark / Woodward no", () => {
  assert.equal(matchesMarkusWood("Markus Wood"), true);
  assert.equal(matchesMarkusWood("  markus wood  "), true);
  assert.equal(matchesMarkusWood("Markus Wood Jr"), true);
  assert.equal(matchesMarkusWood("Ethan Wood"), false);
  assert.equal(matchesMarkusWood("Mark Wood"), false);
  assert.equal(matchesMarkusWood("Markus Woodward"), false);
  assert.equal(matchesMarkusWood("Wood Markus"), false);
  assert.equal(matchesMarkusWood("Christopher Redoble"), false);
  assert.equal(MARKUS_WOOD_NAME_RE.test("Markus Wood"), true);
  assert.equal(matchesTimedNeedsTransfersName("Markus Wood", MARKUS_WOOD_PIN), true);
});

test("date window: before null, during pin, after clear", () => {
  assert.equal(timedNeedsTransfersDesired("2026-09-17"), null, "before window: leave alone");
  assert.equal(timedNeedsTransfersDesired("2026-09-18"), 1, "start inclusive");
  assert.equal(timedNeedsTransfersDesired("2026-09-22"), 1, "mid window");
  assert.equal(timedNeedsTransfersDesired("2026-09-25"), 1, "end inclusive");
  assert.equal(timedNeedsTransfersDesired("2026-09-26"), 0, "after: clear pin");
  assert.equal(timedNeedsTransfersDesired("2026-10-01"), 0);
  assert.equal(timedNeedsTransfersDesired("not-a-date"), null);
  assert.equal(isTimedNeedsTransfersWindowActive("2026-09-18"), true);
  assert.equal(isTimedNeedsTransfersWindowActive("2026-09-26"), false);
  assert.equal(MARKUS_WOOD_PIN.startDate, "2026-09-18");
  assert.equal(MARKUS_WOOD_PIN.endDate, "2026-09-25");
});

test("pacificCalendarDate returns YYYY-MM-DD in America/Los_Angeles", () => {
  // 2026-09-18 15:00 UTC = 2026-09-18 08:00 PT
  const during = pacificCalendarDate(new Date("2026-09-18T15:00:00Z"));
  assert.equal(during, "2026-09-18");
  // 2026-09-26 06:00 UTC = 2026-09-25 23:00 PT (still end day)
  assert.equal(pacificCalendarDate(new Date("2026-09-26T06:00:00Z")), "2026-09-25");
  // 2026-09-26 08:00 UTC = 2026-09-26 01:00 PT (after window)
  assert.equal(pacificCalendarDate(new Date("2026-09-26T08:00:00Z")), "2026-09-26");
});

function seedLos(db: Database.Database) {
  db.exec(`CREATE TABLE loan_officers (
    id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    needs_transfers INTEGER NOT NULL DEFAULT 0,
    org_id INTEGER,
    internal_status TEXT DEFAULT 'active',
    updated_at TEXT
  )`);
  db.prepare(
    `INSERT INTO loan_officers(id, full_name, needs_transfers, org_id, internal_status) VALUES
      (1, 'Markus Wood', 0, 1, 'active'),
      (2, 'Ethan Wood', 1, 1, 'active'),
      (3, 'Mark Wood', 0, 1, 'active'),
      (4, 'Other LO', 1, 1, 'active')`,
  ).run();
}

test("boot helper pins Markus during window; leaves other LOs alone; idempotent", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  seedLos(db);

  const during = ensureTimedNeedsTransfersPins(db, new Date("2026-09-18T15:00:00Z"));
  assert.equal(during.ptDate, "2026-09-18");
  assert.equal(during.updated, 1);
  assert.equal(during.matched.length, 1);
  assert.equal(during.matched[0]!.name, "Markus Wood");
  assert.equal(during.matched[0]!.to, 1);

  const markus = db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=1`).get() as any;
  assert.equal(markus.needs_transfers, 1);
  // Other Woods / pinned LOs untouched
  assert.equal((db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=2`).get() as any).needs_transfers, 1);
  assert.equal((db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=3`).get() as any).needs_transfers, 0);
  assert.equal((db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=4`).get() as any).needs_transfers, 1);

  const again = ensureTimedNeedsTransfersPins(db, new Date("2026-09-18T15:00:00Z"));
  assert.equal(again.updated, 0, "idempotent while already pinned");
});

test("boot helper is no-op before window", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  seedLos(db);
  const before = ensureTimedNeedsTransfersPins(db, new Date("2026-09-17T15:00:00Z"));
  assert.equal(before.ptDate, "2026-09-17");
  assert.equal(before.updated, 0);
  assert.equal(before.matched.length, 0);
  assert.ok(before.skipped.length >= 1);
  assert.equal((db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=1`).get() as any).needs_transfers, 0);
});

test("boot helper clears Markus after window; does not clear other pins", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  seedLos(db);
  // Pretend he was pinned during the week
  db.prepare(`UPDATE loan_officers SET needs_transfers=1 WHERE id=1`).run();

  const after = ensureTimedNeedsTransfersPins(db, new Date("2026-09-26T15:00:00Z"));
  assert.equal(after.ptDate, "2026-09-26");
  assert.equal(after.updated, 1);
  assert.equal(after.matched[0]!.to, 0);
  assert.equal((db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=1`).get() as any).needs_transfers, 0);
  // Ethan Wood and Other LO stay pinned
  assert.equal((db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=2`).get() as any).needs_transfers, 1);
  assert.equal((db.prepare(`SELECT needs_transfers FROM loan_officers WHERE id=4`).get() as any).needs_transfers, 1);

  const again = ensureTimedNeedsTransfersPins(db, new Date("2026-09-26T15:00:00Z"));
  assert.equal(again.updated, 0, "idempotent after clear");
});

test("routes boot path calls ensureTimedNeedsTransfersPins beside half-day seeds", () => {
  const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
  assert.match(routes, /ensureTimedNeedsTransfersPins/);
  assert.match(routes, /from "\.\/timed-needs-transfers"/);
  assert.match(routes, /\[timed-needs-transfers\]/);
  // Same neighborhood as half-day seeds
  const half = routes.indexOf("ensureSeededHalfDays");
  const timed = routes.indexOf("ensureTimedNeedsTransfersPins(storageExtra");
  assert.ok(half > 0 && timed > half, "timed pin runs after half-day seed in boot path");
});

test("SQL only updates needs_transfers (never exclude_from_stats)", () => {
  const server = readFileSync(join(root, "server/timed-needs-transfers.ts"), "utf8");
  assert.match(server, /UPDATE loan_officers SET needs_transfers=\?, updated_at=\? WHERE id=\?/);
  assert.doesNotMatch(server, /SET[^;]*exclude_from_stats/s);
  assert.doesNotMatch(server, /UPDATE\s+users\b/i);
});
