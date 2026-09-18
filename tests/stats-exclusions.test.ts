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

test("Jordon name match: Jordon/Jordan Chang yes, Jordan Rivera no", () => {
  assert.equal(matchesStatsExcludedName("Jordon Chang"), true);
  assert.equal(matchesStatsExcludedName("Jordan Chang"), true);
  assert.equal(matchesStatsExcludedName("jordon"), true);
  assert.equal(matchesStatsExcludedName("Jordan Rivera"), false);
  assert.equal(JORDON_STATS_NAME_RE.test("Jordan Rivera"), false);
});

test("date boundary: 2026-09-15 counts, 2026-09-16 does not", () => {
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-15"), false);
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-16"), true);
  assert.equal(isStatsExcluded("Jordon Chang", "2026-09-18"), true);
  assert.equal(isStatsExcluded("Jordan Rivera", "2026-09-16"), false);
});

test("tournament reuses the shared from-date rule", () => {
  assert.equal(TOURNAMENT_EXCLUDED_FROM, STATS_EXCLUDED_FROM);
  assert.equal(isTournamentExcluded("Jordon Chang", "2026-09-16"), true);
  assert.equal(isTournamentExcluded("Jordon Chang", "2026-09-15"), false);
  assert.equal(isTournamentExcluded("Elleine Asuncion", "2026-09-14"), true);
});

test("day-race excludes Jordon on/after from-date; Elleine always", () => {
  assert.equal(isDayRaceExcluded("Elleine Asuncion"), true);
  assert.equal(isDayRaceExcluded("Jordon Chang", "2026-09-16"), true);
  assert.equal(isDayRaceExcluded("Jordon Chang", "2026-09-15"), false);
  assert.equal(isDayRaceExcluded("Ana", "2026-09-16"), false);
});

test("credit rollup drops Jordon on/after date and half/full-off person-days", () => {
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
    to: "2026-09-18",
    halfDays,
    fullOffDays,
  });
  const keys = creditExcludedDayKeys(days);
  // Jordon from Wed forward
  assert.ok(keys.has("2:2026-09-16"));
  assert.ok(keys.has("2:2026-09-18"));
  assert.equal(keys.has("2:2026-09-15"), false);
  // Ana half + person 3 full off
  assert.ok(keys.has("1:2026-09-17"));
  assert.ok(keys.has("3:2026-09-17"));

  const rows = [
    { userId: 2, date: "2026-09-15", credit: 1 },
    { userId: 2, date: "2026-09-16", credit: 1 },
    { userId: 1, date: "2026-09-17", credit: 1 },
    { userId: 1, date: "2026-09-18", credit: 1 },
  ];
  const kept = filterCreditRows(rows, {
    nameByUserId: new Map(users.map((u) => [u.id, u.name])),
    excludedKeys: keys,
  });
  assert.deepEqual(
    kept.map((r) => [r.userId, r.date]),
    [[2, "2026-09-15"], [1, "2026-09-18"]],
  );
});

test("SQL fragments mention Jordon from-date and time_off / Rosas", () => {
  const j = jordonCreditExclusionSql();
  assert.match(j, /2026-09-16/);
  assert.match(j, /jordon/);
  assert.match(j, /jordanchang/);
  const t = timeOffCreditExclusionSql();
  assert.match(t, /time_off_requests/);
  assert.match(t, /rosas/);
  const both = transferCreditExclusionSql();
  assert.match(both, /jordon/);
  assert.match(both, /time_off_requests/);
});
