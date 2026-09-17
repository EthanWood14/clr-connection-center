import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_RACE_SECONDS_PER_HOUR,
  buildDayRaceTimeline,
  dayRaceMomentMs,
  dayRaceRunSeconds,
  dayRaceStartingGrid,
  filterDayRaceField,
  isDayRaceExcluded,
  officeHourFromIso,
} from "../shared/tv-day-race";
import { createTvDayRacePreview } from "../shared/tv-field-race";
import type { RankRow } from "../shared/tv-overtake";

const driver = (id: number, name: string, transfersToday = 0): RankRow => ({ id, name, transfersToday });

test("Elleine is excluded by whole-word name match, spelling variants included", () => {
  assert.equal(isDayRaceExcluded("Elleine Asuncion"), true);
  assert.equal(isDayRaceExcluded("elleine"), true);
  assert.equal(isDayRaceExcluded("Ellaine"), true);
  assert.equal(isDayRaceExcluded("ELLEINE HAYNES"), true);
  assert.equal(isDayRaceExcluded("Ellen Marsh"), false);
  assert.equal(isDayRaceExcluded("Skyler Griffin"), false);
  assert.deepEqual(
    filterDayRaceField([driver(1, "Elleine Asuncion"), driver(2, "Matthew Rosas")]).map((p) => p.name),
    ["Matthew Rosas"],
  );
});

test("timeline is 8 seconds per non-empty hour and skips hours with no transfers", () => {
  assert.equal(DAY_RACE_SECONDS_PER_HOUR, 8);
  const roster = [
    driver(1, "Elleine Asuncion"),
    driver(2, "Matthew Rosas"),
    driver(3, "Skyler Griffin"),
  ];
  const frames = buildDayRaceTimeline(roster, [
    { hour: 9, userId: 2, credit: 1 },
    { hour: 9, userId: 1, credit: 5 }, // Elleine credit ignored
    { hour: 10, userId: 2, credit: 0.5 }, // still counts as activity for hour 10
    { hour: 11, userId: 99, credit: 1 }, // unknown driver — hour stays empty for field
    { hour: 12, userId: 3, credit: 1 },
    { hour: 14, userId: 2, credit: 1 },
  ]);
  // Hours 9, 10, 12, 14 — hour 11 had only an outsider so it is skipped
  assert.deepEqual(frames.map((f) => f.hour), [9, 10, 12, 14]);
  assert.equal(frames.every((f) => f.people.every((p) => p.name !== "Elleine Asuncion")), true);
  assert.equal(frames[0].people.find((p) => p.id === 2)?.transfersToday, 1);
  assert.equal(frames[1].people.find((p) => p.id === 2)?.transfersToday, 1.5);
  assert.equal(frames[2].people.find((p) => p.id === 3)?.transfersToday, 1);
  assert.equal(frames[3].people.find((p) => p.id === 2)?.transfersToday, 2.5);
  assert.equal(dayRaceRunSeconds(frames.length), 32);
  assert.equal(dayRaceMomentMs(frames.length), 32.6 * 1000);
});

test("starting grid is zeroed and excludes Elleine", () => {
  const grid = dayRaceStartingGrid([driver(1, "Elleine Asuncion", 9), driver(2, "Matthew Rosas", 4)]);
  assert.deepEqual(grid, [{ id: 2, name: "Matthew Rosas", transfersToday: 0 }]);
});

test("office hour bucketing uses the office timezone", () => {
  // 2026-09-17 16:30 UTC = 09:30 America/Los_Angeles (PDT, UTC-7)
  assert.equal(officeHourFromIso("2026-09-17T16:30:00.000Z", "America/Los_Angeles"), 9);
  assert.equal(officeHourFromIso("not-a-date", "America/Los_Angeles"), null);
});

test("play preview builds dayFrames from hourly credits and falls back without them", () => {
  const people = [driver(1, "Elleine Asuncion", 8), driver(2, "Matthew Rosas", 3), driver(3, "Skyler Griffin", 1)];
  const withHours = createTvDayRacePreview(people, [
    { hour: 8, userId: 2, credit: 1 },
    { hour: 9, userId: 3, credit: 1 },
    { hour: 10, userId: 1, credit: 4 },
  ], "local-race-preview:1", "now");
  assert.equal(withHours.preview, true);
  assert.ok(withHours.dayFrames);
  assert.equal(withHours.dayFrames!.length, 2);
  assert.deepEqual(withHours.dayFrames!.map((f) => f.hour), [8, 9]);
  assert.equal(withHours.fieldRace!.every((p) => !/elleine/i.test(p.name)), true);
  assert.equal(withHours.raceBefore!.every((p) => p.transfersToday === 0), true);

  const empty = createTvDayRacePreview(people, [], "local-race-preview:2", "now");
  assert.equal(empty.preview, true);
  assert.equal("dayFrames" in empty && (empty as any).dayFrames != null, false);
  assert.equal(empty.fieldRace!.some((p) => /elleine/i.test(p.name)), false);
});
