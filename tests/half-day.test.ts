import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  HALF_DAY_WEIGHT, PACE_EXCLUDED_PERSON_DAYS, SEEDED_HALF_DAYS,
  availableWeekdayPortions, buildPaceExclusions, dayAvailabilityWeight,
  dayPortionWeight, nameMatchesWho, paceDayWeight, prorateWeeklyGoal,
  standingHalfDayUserIds, sumAvailabilityPortions, sumDayPortions,
  sumWorkedAvailabilityPortions, sumWorkedDayPortions, weeksElapsedFromPortions,
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
  assert.equal(paceDayWeight({
    userId: 1, date: "2026-09-16", today: "2026-09-18",
    fullOffUserIds: new Set([1]), todayWeight: 1,
  }), 0, "full day off zeros pace weight");
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

test("full day off → weight 0 even when an activity row is present", () => {
  const ctx = {
    halfDays: new Set<string>(),
    fullOffDays: new Set(["5:2026-09-17"]),
    excludedDays: new Set<string>(),
  };
  assert.equal(dayAvailabilityWeight(5, "2026-09-17", ctx), 0);
  assert.equal(dayAvailabilityWeight(5, "2026-09-18", ctx), 1);
  // Activity union listed the off day — still 0.
  const byUser = sumWorkedAvailabilityPortions([
    { userId: 5, date: "2026-09-17" },
    { userId: 5, date: "2026-09-18" },
  ], ctx);
  assert.equal(byUser.get(5), 1);
  assert.equal(sumAvailabilityPortions(5, ["2026-09-17", "2026-09-18"], ctx), 1);
});

test("half → 0.5; full off wins over half on the same day", () => {
  const ctx = {
    halfDays: new Set(["7:2026-09-17", "7:2026-09-18"]),
    fullOffDays: new Set(["7:2026-09-17"]),
  };
  assert.equal(dayAvailabilityWeight(7, "2026-09-17", ctx), 0, "full off wins");
  assert.equal(dayAvailabilityWeight(7, "2026-09-18", ctx), 0.5);
});

test("goal proration shrinks for 1 full day off + 1 half day in the MTD window", () => {
  // Mon 2026-09-14 .. Fri 2026-09-18 = 5 weekdays.
  // Full off Thu 17 + half Fri 18 → available = 1+1+1+0+0.5 = 3.5
  const ctx = {
    halfDays: new Set(["3:2026-09-18"]),
    fullOffDays: new Set(["3:2026-09-17"]),
  };
  const portions = availableWeekdayPortions(3, "2026-09-14", "2026-09-18", ctx);
  assert.equal(portions, 3.5);
  assert.equal(weeksElapsedFromPortions(portions), 0.7);
  assert.equal(prorateWeeklyGoal(100, portions), 70); // 100 * 3.5/5
  // A CLR with no time off gets the full 5 weekday portions.
  assert.equal(availableWeekdayPortions(1, "2026-09-14", "2026-09-18", ctx), 5);
  assert.equal(prorateWeeklyGoal(100, 5), 100);
});

test("standing Rosas half days weigh 0.5 across weekdays", () => {
  // 2026-09-14..18 is Mon–Fri. Standing half on every weekday → 5 × 0.5 = 2.5.
  const ctx = { halfDays: new Set(["4:2026-09-14", "4:2026-09-15", "4:2026-09-16", "4:2026-09-17", "4:2026-09-18"]) };
  assert.equal(availableWeekdayPortions(4, "2026-09-14", "2026-09-18", ctx), 2.5);
  assert.equal(dayAvailabilityWeight(4, "2026-09-17", ctx), 0.5);
});

test("weeklyPace drops Jeremy's excluded day, zeros full offs, and halves Rosas", () => {
  const days = [
    { userId: 1, date: "2026-06-01" }, { userId: 740, date: "2026-06-01" }, { userId: 9, date: "2026-06-01" },
    { userId: 1, date: "2026-09-17" },
    { userId: 740, date: "2026-09-17" },
    { userId: 9, date: "2026-09-17" },
    { userId: 8, date: "2026-09-17" }, // full day off but activity leaked
  ];
  const credits = [
    { userId: 1, date: "2026-09-17", credit: 4 },
    { userId: 740, date: "2026-09-17", credit: 10 },
    { userId: 9, date: "2026-09-17", credit: 2 },
    { userId: 8, date: "2026-09-17", credit: 3 },
  ];
  const [week] = weeklyPace({
    days, credits, today: "2026-09-18", weeks: 1,
    halfDays: new Set(["9:2026-09-17"]),
    fullOffDays: new Set(["8:2026-09-17"]),
    excludedDays: [{ userId: 740, date: "2026-09-17" }],
  });
  // User1: 1 day, Rosas: 0.5, Jeremy excluded, user8 full off. Transfers 4+2=6 over 1.5 days.
  // user8's transfers are dropped because they are not in `worked`.
  assert.equal(week.clrDays, 1.5);
  assert.equal(week.transfers, 6);
  assert.equal(week.clrs, 2);
});

test("seeded half days, full offs, and standing Rosas wire through sqlite", (t) => {
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
  db.prepare("INSERT INTO users(id,name,org_id,is_active) VALUES (1,'Jeremy Lapiz',1,1),(2,'Jacqueline Ortiz',1,1),(3,'Chris Bermudez',1,1),(4,'Matthew Rosas',1,1),(5,'Chris Redoble',1,1),(6,'Away CLR',1,1),(7,'Jordon Chang',1,1)").run();
  ensureHalfDaySchema(db);
  const seeded = ensureSeededHalfDays(db);
  assert.equal(seeded.inserted, 2);
  assert.ok(seeded.matched.some((m) => m.who === "jackie" && m.date === "2026-09-17"));
  assert.ok(seeded.matched.some((m) => m.who === "chris" && m.date === "2026-09-18"));
  assert.equal(ensureSeededHalfDays(db).inserted, 0, "idempotent");

  // Full day off for Away CLR on 2026-09-17.
  db.prepare(`INSERT INTO time_off_requests
    (org_id, user_id, start_date, end_date, reason, status, day_portion, created_at, updated_at, reviewed_at)
    VALUES (1, 6, '2026-09-17', '2026-09-17', 'Vacation', 'approved', 'full', 'x', 'x', 'x')`).run();

  assert.deepEqual([...approvedFullDayTimeOffUserIds(db, 1, "2026-09-17")], [6]);
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
  assert.ok(ctx.fullOffDays.has("6:2026-09-17"), "full day off in context");
  assert.ok(ctx.availability.fullOffDays?.has("6:2026-09-17"));
  assert.equal(dayAvailabilityWeight(6, "2026-09-17", ctx.availability), 0);
  assert.ok(ctx.excludedDays.some((e) => e.userId === 1 && e.date === "2026-09-17"));
  assert.ok(SEEDED_HALF_DAYS.length >= 2);

  // Goal window Mon–Fri with Away CLR full off Wed → 4 available portions.
  assert.equal(availableWeekdayPortions(6, "2026-09-14", "2026-09-18", ctx.availability), 4);

  // From-date exclusion (Jordon): credit list AND availability.excludedDays.
  assert.ok(ctx.excludedDays.some((e) => e.userId === 7 && e.date === "2026-09-16"));
  assert.ok(ctx.excludedDays.some((e) => e.userId === 7 && e.date === "2026-09-18"));
  assert.ok(!ctx.excludedDays.some((e) => e.userId === 7 && e.date === "2026-09-15"));
  assert.ok(ctx.availability.excludedDays?.has("7:2026-09-16"));
  assert.ok(ctx.availability.excludedDays?.has("1:2026-09-17"), "Jeremy one-off stays in denom exclusions");
  assert.equal(dayAvailabilityWeight(7, "2026-09-15", ctx.availability), 1, "pre-fromDate still counts");
  assert.equal(dayAvailabilityWeight(7, "2026-09-16", ctx.availability), 0, "fromDate day weight 0");
  assert.equal(dayAvailabilityWeight(7, "2026-09-18", ctx.availability), 0);
  // Half days must stay 0.5 — not forced into availability.excludedDays.
  assert.equal(dayAvailabilityWeight(2, "2026-09-17", ctx.availability), 0.5, "Jackie half stays 0.5");
  assert.equal(dayAvailabilityWeight(4, "2026-09-18", ctx.availability), 0.5, "Rosas standing half stays 0.5");
  assert.ok(!ctx.availability.excludedDays?.has("2:2026-09-17"));
  assert.ok(!ctx.availability.excludedDays?.has("4:2026-09-18"));
});

test("from-date exclusion zeros credit days AND workedDays weight (Jordon)", () => {
  // Synthetic: Jordon works Mon–Fri; credit zeroed from Wed; denom must match.
  const jordonId = 42;
  const ctx = {
    halfDays: new Set<string>(),
    fullOffDays: new Set<string>(),
    excludedDays: new Set(["42:2026-09-16", "42:2026-09-17", "42:2026-09-18"]),
  };
  const activity = [
    { userId: jordonId, date: "2026-09-15" },
    { userId: jordonId, date: "2026-09-16" },
    { userId: jordonId, date: "2026-09-17" },
    { userId: jordonId, date: "2026-09-18" },
  ];
  const workedDays = sumWorkedAvailabilityPortions(activity, ctx).get(jordonId) ?? 0;
  assert.equal(workedDays, 1, "only Mon (pre-fromDate) counts in denom");
  // Credit on/after fromDate is 0; only Mon's 2 transfers count.
  const transfers = 2; // Mon only
  const transfersPerWorkedDay = workedDays > 0 ? transfers / workedDays : null;
  assert.equal(transfersPerWorkedDay, 2);
  // Bug pattern: if excludedDays were missing, workedDays would be 4 and rate 0.5.
  const inflated = sumWorkedAvailabilityPortions(activity, {
    halfDays: new Set(),
    fullOffDays: new Set(),
    excludedDays: new Set(), // missing from-date keys
  }).get(jordonId) ?? 0;
  assert.equal(inflated, 4);
  assert.notEqual(transfers / inflated, transfersPerWorkedDay);
});

test("manager dashboard, agent stats, and Ask C3 wire availability weights", () => {
  const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
  const ask = readFileSync(join(root, "server/ask-c3.ts"), "utf8");
  const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");
  assert.match(routes, /sumWorkedAvailabilityPortions\(/, "scorecard days worked");
  assert.match(routes, /availableWeekdayPortions\(/, "per-CLR goal proration");
  assert.match(routes, /prorateWeeklyGoal\(/, "goal = weekly × portions/5");
  assert.match(routes, /callsPerWorkedDay/, "calls per worked day on scorecard payload");
  assert.match(routes, /rollUp\([\s\S]*?availability\)/, "agent stats feed");
  assert.match(routes, /workedDays: sumAvailabilityPortions\(/, "CLR lifetime rates");
  assert.match(routes, /fullOffDays: paceCtx\.fullOffDays/, "TV weekly pace full offs");
  assert.match(ask, /sumAvailabilityPortions\(id, stat\?\.days/, "Ask C3 team metrics");
  assert.match(dash, /callsPerWorkedDay/, "Calls / day worked column");
  assert.match(dash, /half days & days off|available weekdays/i, "goal UI names the rule");
  const halfServer = readFileSync(join(root, "server/half-day.ts"), "utf8");
  assert.match(halfServer, /denomExcludedDays/, "from-date keys feed availability.excludedDays");
  assert.match(halfServer, /buildCreditExcludedPersonDays\(\{[\s\S]*?extra: paceOneOffs/, "denom uses from-date + Jeremy, not half days");
});
