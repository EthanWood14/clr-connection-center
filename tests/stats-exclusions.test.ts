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

test("credit rollup drops Jordon only in from–to window and half/full-off person-days", () => {
  const users = [
    { id: 1, name: "Ana" },
    { id: 2, name: "Jordon Chang" },
    { id: 3, name: "Rosas Stand-in" },
  ];
  const halfDays = new Set(["1:2026-09-17"]); // Ana half day
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
  // Ana half + person 3 full off
  assert.ok(keys.has("1:2026-09-17"));
  assert.ok(keys.has("3:2026-09-17"));

  const rows = [
    { userId: 2, date: "2026-09-15", credit: 1 },
    { userId: 2, date: "2026-09-16", credit: 1 },
    { userId: 2, date: "2026-09-21", credit: 1 },
    { userId: 1, date: "2026-09-17", credit: 1 },
    { userId: 1, date: "2026-09-18", credit: 1 },
  ];
  const kept = filterCreditRows(rows, {
    nameByUserId: new Map(users.map((u) => [u.id, u.name])),
    excludedKeys: keys,
  });
  assert.deepEqual(
    kept.map((r) => [r.userId, r.date]),
    [[2, "2026-09-15"], [2, "2026-09-21"], [1, "2026-09-18"]],
  );
});

test("SQL fragments mention Jordon from–to window and time_off / Rosas", () => {
  const j = jordonCreditExclusionSql();
  assert.match(j, /2026-09-16/);
  assert.match(j, /2026-09-20/);
  assert.match(j, /jordon/);
  assert.match(j, /jordanchang/);
  const t = timeOffCreditExclusionSql();
  assert.match(t, /time_off_requests/);
  assert.match(t, /rosas/);
  const both = transferCreditExclusionSql();
  assert.match(both, /jordon/);
  assert.match(both, /time_off_requests/);
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
