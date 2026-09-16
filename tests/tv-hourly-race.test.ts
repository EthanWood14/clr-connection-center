import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HOURLY_RACE_FROM_HOUR, HOURLY_RACE_GRACE_MS, HOURLY_RACE_TO_HOUR,
  dueHourlyRaceKey, hourlyRaceKey, officeClock,
} from "../shared/tv-hourly-race";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const TZ = "America/Los_Angeles";
const at = (iso: string) => Date.parse(iso);

/**
 * "Can you have the race on the tv constantly be playing in live a corner of
 * the screen or something. Also, at the top of every hour, show the entire
 * race for the day." — Ethan, 16 Sep 2026.
 */

test("the office clock is the floor's, not the viewer's", () => {
  // 20:30 UTC is 1:30 PM in Los Angeles, and the date is still the 16th.
  assert.deepEqual(officeClock(at("2026-09-16T20:30:00Z"), TZ), { hour: 13, minute: 30, date: "2026-09-16" });
  // Half past midnight UTC is still the evening of the day before out west.
  assert.deepEqual(officeClock(at("2026-09-17T00:30:00Z"), TZ), { hour: 17, minute: 30, date: "2026-09-16" });
  assert.equal(hourlyRaceKey(at("2026-09-16T20:30:00Z"), TZ), "hourly-race:2026-09-16T13");
});

test("it is due on the hour, and for a few minutes after in case the wall was busy", () => {
  const none = new Set<string>();
  assert.equal(dueHourlyRaceKey(at("2026-09-16T20:00:00Z"), TZ, none), "hourly-race:2026-09-16T13");
  assert.equal(dueHourlyRaceKey(at("2026-09-16T20:03:59Z"), TZ, none), "hourly-race:2026-09-16T13", "inside the grace window");
  assert.equal(HOURLY_RACE_GRACE_MS, 4 * 60_000);
  assert.equal(dueHourlyRaceKey(at("2026-09-16T20:30:00Z"), TZ, none), null, "the middle of the hour is not the top of it");
});

test("one race an hour: the board's own played set is what stops a repeat", () => {
  const played = new Set(["hourly-race:2026-09-16T13"]);
  assert.equal(dueHourlyRaceKey(at("2026-09-16T20:00:30Z"), TZ, played), null);
  // The next hour is a different key, so it comes round again.
  assert.equal(dueHourlyRaceKey(at("2026-09-16T21:00:30Z"), TZ, played), "hourly-race:2026-09-16T14");
});

test("it does not run to an empty room at three in the morning", () => {
  const none = new Set<string>();
  assert.equal(HOURLY_RACE_FROM_HOUR, 8);
  assert.equal(HOURLY_RACE_TO_HOUR, 18);
  assert.equal(dueHourlyRaceKey(at("2026-09-16T10:00:00Z"), TZ, none), null, "3 AM Pacific");
  assert.equal(dueHourlyRaceKey(at("2026-09-16T15:00:00Z"), TZ, none), "hourly-race:2026-09-16T08", "the first hour of the day");
  assert.equal(dueHourlyRaceKey(at("2026-09-17T01:00:00Z"), TZ, none), "hourly-race:2026-09-16T18", "the last one");
  assert.equal(dueHourlyRaceKey(at("2026-09-17T02:00:00Z"), TZ, none), null, "7 PM is past it");
});

test("the board deals it like any other moment, with the whole field in it", () => {
  const tv = read("client/src/pages/tv.tsx");
  assert.match(tv, /const hourly = dueHourlyRaceKey\(Date\.now\(\), BOARD_TZ, played\.current\);/);
  assert.match(tv, /if \(hourly && standings\.length\) next\.push\(createTvRacePreview\(standings, hourly, data\.now\)\);/);
  assert.match(tv, /const BOARD_TZ = "America\/Los_Angeles";/, "the floor's hour, not the viewer's");
});

test("the live corner race sits IN the strip, never over a page, and yields the context", () => {
  const tv = read("client/src/pages/tv.tsx");
  // The deck's box is measured against the strip, so a taller strip is the
  // one change that keeps every page clear of the race.
  assert.match(tv, /h-\[calc\(100vh-6rem-20vh\)\]/);
  assert.match(tv, /className="relative z-10 flex h-\[20vh\]/);
  assert.match(tv, /<CornerRace people=\{raceStandings\} reduced=\{reduced\} paused=\{!!current\} \/>/);
  const corner = read("client/src/components/tv/corner-race.tsx");
  assert.match(corner, /if \(paused \|\| failed \|\| !people\.length\) return;/, "one WebGL context on this screen at a time");
  assert.match(corner, /setRun\(\(n\) => n \+ 1\)/, "it runs again rather than freezing at the line");
  assert.match(corner, /onFailure: \(\) => \{ if \(!cancelled\) setFailed\(true\); \}/);
  assert.match(corner, /data-corner-race-state=\{failed \? "fallback" : "live"\}/, "a dead scene falls back to text, not a black box");
});
