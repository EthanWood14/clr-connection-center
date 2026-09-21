import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JORDON_STATS_NAME_RE,
  STATS_EXCLUDED_FROM,
  buildCreditExcludedPersonDays,
  creditExcludedDayKeys,
  filterCreditRows,
  isStatsExcluded,
  jordonCreditExclusionSql,
  matchesStatsExcludedName,
  timeOffCreditExclusionSql,
  transferCreditExclusionSql,
} from "../shared/stats-exclusions";
import { TOURNAMENT_EXCLUDED_FROM, isTournamentExcluded } from "../shared/tournament";
import { isDayRaceExcluded } from "../shared/tv-day-race";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Jordon name match: Jordon/Jordan Chang yes, Jordan Rivera no", () => {
  assert.equal(matchesStatsExcludedName("Jordon Chang"), true);
  assert.equal(matchesStatsExcludedName("Jordan Chang"), true);
  assert.equal(matchesStatsExcludedName("jordon"), true);
  assert.equal(matchesStatsExcludedName("Jordan Rivera"), false);
  assert.equal(JORDON_STATS_NAME_RE.test("Jordan Rivera"), false);
});

test("date boundary: pre-9/16 and 9/21+ count; 9/16–9/20 excluded", () => {
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-15"), false);
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-16"), true);
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-18"), true);
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-20"), true);
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-21"), false);
  assert.equal(isStatsExcluded("Jordan Rivera", "2026-09-16"), false);
  assert.equal(STATS_EXCLUDED_FROM[0]?.toDate, "2026-09-20");
});

test("tournament reuses the shared from–to rule", () => {
  assert.equal(TOURNAMENT_EXCLUDED_FROM, STATS_EXCLUDED_FROM);
  assert.equal(isTournamentExcluded("Jordon Chang", "2026-09-16"), true);
  assert.equal(isTournamentExcluded("Jordon Chang", "2026-09-15"), false);
  assert.equal(isTournamentExcluded("Jordon Chang", "2026-09-21"), false);
  assert.equal(isTournamentExcluded("Elleine Asuncion", "2026-09-14"), true);
});

test("day-race excludes Jordon in from–to window; Elleine always", () => {
  assert.equal(isDayRaceExcluded("Elleine Asuncion"), true);
  assert.equal(isDayRaceExcluded("Jordon Chang", "2026-09-16"), true);
  assert.equal(isDayRaceExcluded("Jordon Chang", "2026-09-15"), false);
  assert.equal(isDayRaceExcluded("Jordon Chang", "2026-09-21"), false);
  assert.equal(isDayRaceExcluded("Ana", "2026-09-16"), false);
});

test("credit rollup drops Jordon from–to and full-off; half days keep credit", () => {
  const users = [
    { id: 1, name: "Ana" },
    { id: 2, name: "Jordon Chang" },
    { id: 3, name: "Away CLR" },
    { id: 4, name: "Matthew Rosas" },
  ];
  const halfDays = new Set(["1:2026-09-17", "4:2026-09-17"]); // Ana + Rosas half
  const fullOffDays = new Set(["3:2026-09-17"]);
  const days = buildCreditExcludedPersonDays({
    users,
    from: "2026-09-15",
    to: "2026-09-22",
    halfDays,
    fullOffDays,
  });
  const keys = creditExcludedDayKeys(days);
  // Jordon 9/16–9/20 only
  assert.ok(keys.has("2:2026-09-16"));
  assert.ok(keys.has("2:2026-09-18"));
  assert.ok(keys.has("2:2026-09-20"));
  assert.equal(keys.has("2:2026-09-15"), false);
  assert.equal(keys.has("2:2026-09-21"), false);
  // Full off excluded; half days (Ana + Rosas) NOT credit-excluded
  assert.ok(keys.has("3:2026-09-17"));
  assert.equal(keys.has("1:2026-09-17"), false, "approved half keeps credit");
  assert.equal(keys.has("4:2026-09-17"), false, "standing half (Rosas) keeps credit");

  const rows = [
    { userId: 2, date: "2026-09-15", credit: 1 },
    { userId: 2, date: "2026-09-16", credit: 1 },
    { userId: 2, date: "2026-09-21", credit: 1 },
    { userId: 1, date: "2026-09-17", credit: 1 },
    { userId: 1, date: "2026-09-18", credit: 1 },
    { userId: 4, date: "2026-09-17", credit: 3 },
  ];
  const kept = filterCreditRows(rows, {
    nameByUserId: new Map(users.map((u) => [u.id, u.name])),
    excludedKeys: keys,
  });
  assert.deepEqual(
    kept.map((r) => [r.userId, r.date]),
    [[2, "2026-09-15"], [2, "2026-09-21"], [1, "2026-09-17"], [1, "2026-09-18"], [4, "2026-09-17"]],
  );
});

test("SQL fragments: Jordon window + full time_off only; no Rosas standing wipe", () => {
  const j = jordonCreditExclusionSql();
  assert.match(j, /2026-09-16/);
  assert.match(j, /2026-09-20/);
  assert.match(j, /jordon/);
  assert.match(j, /jordanchang/);
  const t = timeOffCreditExclusionSql();
  assert.match(t, /time_off_requests/);
  assert.match(t, /day_portion/);
  assert.match(t, /!= 'half'/);
  assert.doesNotMatch(t, /rosas/);
  const both = transferCreditExclusionSql();
  assert.match(both, /jordon/);
  assert.match(both, /time_off_requests/);
  assert.doesNotMatch(both, /rosas/);
});

test("storage credit helpers default to exclusion and allow personal opt-out", () => {
  // Source contract: team boards keep transferCreditExclusionSql; personal
  // surfaces pass applyStatsExclusions: false (proven in transfer-credit.test.ts).
  const storage = readFileSync(join(ROOT, "server/storage.ts"), "utf8");
  assert.match(storage, /applyStatsExclusions\?: boolean/);
  assert.match(storage, /if \(f\.applyStatsExclusions !== false\)[\s\S]*?transferCreditExclusionSql/);
  // Default path still pushes the exclusion (team aggregates unchanged).
  assert.match(storage, /wheres\.push\(transferCreditExclusionSql\("tc\.date", "tc\.user_id", "tc\.org_id"\)\)/);
});


test("Rosas weekday credit survives timeOffCreditExclusionSql; full PTO still drops", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE time_off_requests (
      id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER,
      start_date TEXT, end_date TEXT, status TEXT, day_portion TEXT
    );
    CREATE TABLE tc (org_id INTEGER, user_id INTEGER, date TEXT, credit REAL);
  `);
  db.exec(`
    INSERT INTO users(id,name) VALUES (434,'Matthew Rosas'),(6,'Away CLR'),(1,'Ana Half');
    INSERT INTO time_off_requests(org_id,user_id,start_date,end_date,status,day_portion)
      VALUES (1,1,'2026-09-17','2026-09-17','approved','half'),
             (1,6,'2026-09-17','2026-09-17','approved','full');
    INSERT INTO tc(org_id,user_id,date,credit) VALUES
      (1,434,'2026-09-17',3),
      (1,1,'2026-09-17',2),
      (1,6,'2026-09-17',5);
  `);
  const where = timeOffCreditExclusionSql("tc.date", "tc.user_id", "tc.org_id");
  const rows = db.prepare(`SELECT user_id, credit FROM tc WHERE (${where}) ORDER BY user_id`).all() as Array<{user_id:number; credit:number}>;
  assert.deepEqual(
    rows.map((r) => [r.user_id, r.credit]),
    [[1, 2], [434, 3]],
    "approved half + Rosas standing keep credit; full PTO still excluded",
  );
});
