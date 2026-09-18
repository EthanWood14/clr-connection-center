import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_RACE_MS_PER_MINUTE,
  DAY_RACE_SECONDS_PER_HOUR,
  buildDayRaceTimeline,
  dayRaceActiveHours,
  dayRaceFrameOffsetMs,
  dayRaceMomentMs,
  dayRaceRunSeconds,
  dayRaceStartingGrid,
  filterDayRaceField,
  isDayRaceExcluded,
  officeHourFromIso,
  officeStampFromIso,
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

test("timeline is 2 seconds per non-empty hour, by the minute, and skips empty stretches", () => {
  assert.equal(DAY_RACE_SECONDS_PER_HOUR, 2);
  assert.equal(DAY_RACE_MS_PER_MINUTE, 2000 / 60);
  const roster = [
    driver(1, "Elleine Asuncion"),
    driver(2, "Matthew Rosas"),
    driver(3, "Skyler Griffin"),
  ];
  const frames = buildDayRaceTimeline(roster, [
    { hour: 9, minute: 5, userId: 2, credit: 1 },
    { hour: 9, minute: 5, userId: 1, credit: 5 }, // Elleine credit ignored
    { hour: 9, minute: 40, userId: 2, credit: 0.5 },
    { hour: 10, minute: 0, userId: 2, credit: 0.5 },
    { hour: 11, minute: 15, userId: 99, credit: 1 }, // unknown driver — minute stays empty for field
    { hour: 12, minute: 1, userId: 3, credit: 1 },
    { hour: 14, minute: 59, userId: 2, credit: 1 },
  ]);
  // Minutes 9:05, 9:40, 10:00, 12:01, 14:59 — hour 11 had only an outsider
  assert.deepEqual(frames.map((f) => `${f.hour}:${f.minute}`), ["9:5", "9:40", "10:0", "12:1", "14:59"]);
  assert.equal(frames.every((f) => f.people.every((p) => p.name !== "Elleine Asuncion")), true);
  assert.equal(frames[0].people.find((p) => p.id === 2)?.transfersToday, 1);
  assert.equal(frames[1].people.find((p) => p.id === 2)?.transfersToday, 1.5);
  assert.equal(frames[2].people.find((p) => p.id === 2)?.transfersToday, 2);
  assert.equal(frames[3].people.find((p) => p.id === 3)?.transfersToday, 1);
  assert.equal(frames[4].people.find((p) => p.id === 2)?.transfersToday, 3);
  const hours = dayRaceActiveHours(frames);
  assert.deepEqual(hours, [9, 10, 12, 14]);
  assert.equal(dayRaceRunSeconds(hours.length), 8);
  assert.equal(dayRaceMomentMs(hours.length), 8.6 * 1000);
  // First hour's minutes are spread across the 2s slot (not one shared jump).
  assert.equal(dayRaceFrameOffsetMs(frames[0], hours), (5 / 60) * 2000);
  assert.equal(dayRaceFrameOffsetMs(frames[1], hours), (40 / 60) * 2000);
  assert.equal(dayRaceFrameOffsetMs(frames[2], hours), 2_000 + (0 / 60) * 2000);
});

test("credits without minute default to :00 so older feeds still build", () => {
  const frames = buildDayRaceTimeline([driver(2, "Matthew Rosas")], [
    { hour: 9, minute: undefined as unknown as number, userId: 2, credit: 1 },
  ]);
  assert.deepEqual(frames.map((f) => `${f.hour}:${f.minute}`), ["9:0"]);
});

test("starting grid is zeroed and excludes Elleine", () => {
  const grid = dayRaceStartingGrid([driver(1, "Elleine Asuncion", 9), driver(2, "Matthew Rosas", 4)]);
  assert.deepEqual(grid, [{ id: 2, name: "Matthew Rosas", transfersToday: 0 }]);
});

test("office stamp bucketing uses the office timezone", () => {
  // 2026-09-17 16:30 UTC = 09:30 America/Los_Angeles (PDT, UTC-7)
  assert.deepEqual(officeStampFromIso("2026-09-17T16:30:00.000Z", "America/Los_Angeles"), { hour: 9, minute: 30 });
  assert.equal(officeHourFromIso("2026-09-17T16:30:00.000Z", "America/Los_Angeles"), 9);
  assert.equal(officeHourFromIso("not-a-date", "America/Los_Angeles"), null);
  assert.equal(officeStampFromIso("not-a-date", "America/Los_Angeles"), null);
});

test("play preview builds dayFrames from minute credits and starts on a zeroed grid", () => {
  const people = [driver(1, "Elleine Asuncion", 8), driver(2, "Matthew Rosas", 3), driver(3, "Skyler Griffin", 1)];
  const withHours = createTvDayRacePreview(people, [
    { hour: 8, minute: 10, userId: 2, credit: 1 },
    { hour: 9, minute: 0, userId: 3, credit: 1 },
    { hour: 10, minute: 45, userId: 1, credit: 4 },
  ], "local-race-preview:1", "now");
  assert.equal(withHours.preview, true);
  assert.ok(withHours.dayFrames);
  assert.equal(withHours.dayFrames!.length, 2);
  assert.deepEqual(withHours.dayFrames!.map((f) => `${f.hour}:${f.minute}`), ["8:10", "9:0"]);
  assert.equal(withHours.fieldRace!.every((p) => !/elleine/i.test(p.name) && p.transfersToday === 0), true);
  assert.equal(withHours.raceBefore!.every((p) => p.transfersToday === 0), true);

  const empty = createTvDayRacePreview(people, [], "local-race-preview:2", "now");
  assert.equal(empty.preview, true);
  assert.equal("dayFrames" in empty && (empty as any).dayFrames != null, false);
  assert.equal(empty.fieldRace!.some((p) => /elleine/i.test(p.name)), false);
});
