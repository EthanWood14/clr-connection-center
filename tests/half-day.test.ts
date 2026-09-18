import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  HALF_DAY_WEIGHT, PACE_EXCLUDED_PERSON_DAYS, SEEDED_HALF_DAYS,
  buildPaceExclusions, dayPortionWeight, nameMatchesWho, paceDayWeight,
  standingHalfDayUserIds, sumDayPortions, sumWorkedDayPortions,
} from "../shared/half-day";
import { weeklyPace } from "../shared/weekly-pace";
import {
  approvedFullDayTimeOffUserIds, ensureHalfDaySchema, ensureSeededHalfDays,
  halfDayUserIdsForDate, isHalfDayExcusedFromLate, paceHalfDayContext,
} from "../server/half-day";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("roster names resolve carefully", () => {
  assert.equal(nameMatchesWho("Jeremy Lapiz", "jeremy"), true);
  assert.equal(nameMatchesWho("Jacqueline Smith", "jackie"), true);
  assert.equal(nameMatchesWho("Jackie Nguyen", "jackie"), true);
  assert.equal(nameMatchesWho("Chris Bermudez", "chris"), true);
  assert.equal(nameMatchesWho("Cristopher Bermudez", "chris"), true);
  assert.equal(nameMatchesWho("Chris Redoble", "chris"), false, "LO Redoble is not the CLR Chris");
  assert.equal(nameMatchesWho("Matthew Rosas", "rosas"), true);
  assert.deepEqual(
    standingHalfDayUserIds([{ id: 9, name: "Matthew Rosas" }, { id: 1, name: "Ethan Wood" }]),
    new Set([9]),
  );
});

test("Jeremy 2026-09-17 is a named pace exclusion", () => {
  assert.ok(PACE_EXCLUDED_PERSON_DAYS.some((r) => r.who === "jeremy" && r.date === "2026-09-17"));
  const ex = buildPaceExclusions([{ id: 740, name: "Jeremy Lapiz" }]);
  assert.deepEqual(ex.map((e) => ({ userId: e.userId, date: e.date })), [{ userId: 740, date: "2026-09-17" }]);
});

test("half day halves the pace weight, exclusions zero it", () => {
  assert.equal(HALF_DAY_WEIGHT, 0.5);
  assert.equal(paceDayWeight({ userId: 1, date: "2026-09-16", today: "2026-09-18", todayWeight: 1 }), 1);
  assert.equal(paceDayWeight({
    userId: 1, date: "2026-09-16", today: "2026-09-18",
    halfDayUserIds: new Set([1]), todayWeight: 1,
  }), 0.5);
  assert.equal(paceDayWeight({
    userId: 1, date: "2026-09-18", today: "2026-09-18",
    halfDayUserIds: new Set([1]), todayWeight: 0.5,
  }), 0.25);
  assert.equal(paceDayWeight({
    userId: 740, date: "2026-09-17", today: "2026-09-18",
    excluded: [{ userId: 740, date: "2026-09-17" }],
  }), 0);
});


test("days worked is the sum of day portions (full=1, half=0.5)", () => {
  const half = new Set(["9:2026-09-17", "9:2026-09-18"]);
  assert.equal(dayPortionWeight(1, "2026-09-17", half), 1);
  assert.equal(dayPortionWeight(9, "2026-09-17", half), 0.5);
  assert.equal(sumDayPortions(9, ["2026-09-16", "2026-09-17", "2026-09-18"], half), 2);
  assert.equal(sumDayPortions(1, ["2026-09-16", "2026-09-17"], half), 2);
  const byUser = sumWorkedDayPortions([
    { userId: 9, date: "2026-09-17" },
    { userId: 9, date: "2026-09-17" }, // duplicate ignored
    { userId: 9, date: "2026-09-18" },
    { userId: 1, date: "2026-09-17" },
  ], half);
  assert.equal(byUser.get(9), 1);
  assert.equal(byUser.get(1), 1);
});

test("weeklyPace drops Jeremy's excluded day and halves Rosas", () => {
  const days = [
    { userId: 1, date: "2026-06-01" }, { userId: 740, date: "2026-06-01" }, { userId: 9, date: "2026-06-01" },
    { userId: 1, date: "2026-09-17" },
    { userId: 740, date: "2026-09-17" },
    { userId: 9, date: "2026-09-17" },
  ];
  const credits = [
    { userId: 1, date: "2026-09-17", credit: 4 },
    { userId: 740, date: "2026-09-17", credit: 10 },
    { userId: 9, date: "2026-09-17", credit: 2 },
  ];
  const [week] = weeklyPace({
    days, credits, today: "2026-09-18", weeks: 1,
    halfDays: new Set(["9:2026-09-17"]),
    excludedDays: [{ userId: 740, date: "2026-09-17" }],
  });
  // User1: 1 day, Rosas: 0.5, Jeremy excluded. Transfers 4+2=6 over 1.5 days.
  assert.equal(week.clrDays, 1.5);
  assert.equal(week.transfers, 6);
  assert.equal(week.clrs, 2);
});

test("seeded half days and standing Rosas wire through sqlite", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, name TEXT, org_id INTEGER, is_active INTEGER, archived_at TEXT
  )`);
  db.exec(`CREATE TABLE time_off_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, user_id INTEGER, start_date TEXT, end_date TEXT,
    reason TEXT, status TEXT, day_portion TEXT DEFAULT 'full',
    created_at TEXT, updated_at TEXT, reviewed_at TEXT
  )`);
  db.prepare("INSERT INTO users(id,name,org_id,is_active) VALUES (1,'Jeremy Lapiz',1,1),(2,'Jacqueline Ortiz',1,1),(3,'Chris Bermudez',1,1),(4,'Matthew Rosas',1,1),(5,'Chris Redoble',1,1)").run();
  ensureHalfDaySchema(db);
  const seeded = ensureSeededHalfDays(db);
  assert.equal(seeded.inserted, 2);
  assert.ok(seeded.matched.some((m) => m.who === "jackie" && m.date === "2026-09-17"));
  assert.ok(seeded.matched.some((m) => m.who === "chris" && m.date === "2026-09-18"));
  assert.equal(ensureSeededHalfDays(db).inserted, 0, "idempotent");

  assert.deepEqual([...approvedFullDayTimeOffUserIds(db, 1, "2026-09-17")], []);
  assert.ok(halfDayUserIdsForDate(db, 1, "2026-09-17").has(2));
  assert.ok(halfDayUserIdsForDate(db, 1, "2026-09-18").has(3));
  assert.ok(halfDayUserIdsForDate(db, 1, "2026-09-18").has(4), "Rosas standing");
  assert.equal(isHalfDayExcusedFromLate(db, 1, 3, "2026-09-18", "Chris Bermudez"), true);
  assert.equal(isHalfDayExcusedFromLate(db, 1, 4, "2026-09-19", "Matthew Rosas"), true);
  assert.equal(isHalfDayExcusedFromLate(db, 1, 5, "2026-09-18", "Chris Redoble"), false);

  const ctx = paceHalfDayContext(db, 1, "2026-09-14", "2026-09-18");
  assert.equal(ctx.resolved.jeremy?.id, 1);
  assert.equal(ctx.resolved.jackie?.id, 2);
  assert.equal(ctx.resolved.chris?.id, 3);
  assert.ok(ctx.halfDays.has("4:2026-09-18"));
  assert.ok(ctx.excludedDays.some((e) => e.userId === 1 && e.date === "2026-09-17"));
  assert.ok(SEEDED_HALF_DAYS.length >= 2);
});

test("manager dashboard, agent stats, and Ask C3 wire day-portion days worked", () => {
  const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
  const ask = readFileSync(join(root, "server/ask-c3.ts"), "utf8");
  const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");
  assert.match(routes, /sumWorkedDayPortions\(/, "scorecard Transfers / day worked");
  assert.match(routes, /rollUp\([\s\S]*?halfDays\)/, "agent stats feed");
  assert.match(routes, /workedDays: sumDayPortions\(/, "CLR lifetime rates");
  assert.match(ask, /sumDayPortions\(id, stat\?\.days/, "Ask C3 team metrics");
  assert.match(dash, /half day=0\.5/, "scorecard tooltip names the rule");
});
