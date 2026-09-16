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
  // The scene is NOT torn down when a moment cuts in: that restarted the
  // shot from zero every few minutes and made the corner read as a short
  // loop. The full-screen race covers it anyway.
  assert.match(corner, /if \(failed \|\| !people\.length\) return;/);
  assert.match(corner, /paused \? " opacity-0" : ""/, "it dims under the full-screen race rather than unmounting");
  assert.match(corner, /onFailure: \(\) => \{ if \(!cancelled\) setFailed\(true\); \}/);
  assert.match(corner, /data-corner-race-state=\{failed \? "fallback" : "live"\}/, "a dead scene falls back to text, not a black box");
});

// "Have the race refresh without refreshing everything on the screen" +
// "enough views to run for 3 minutes without refreshing or going back to the
// beginning." — Ethan, 16 Sep 2026.
test("a transfer moves the cars in place; only a new NAME rebuilds the corner", () => {
  const corner = read("client/src/components/tv/corner-race.tsx");
  // It runs until the page does. No run counter, no restart timer, no length.
  assert.match(corner, /runSeconds: Infinity,/);
  assert.doesNotMatch(corner, /setRun|window\.setTimeout/, "nothing schedules a restart any more");
  // The rebuild dependency is the roster, not the scores.
  assert.match(corner, /const roster = useMemo\(\(\) => drivers\.map\(\(d\) => d\.id\)\.join\("\|"\), \[drivers\]\);/);
  assert.match(corner, /\}, \[roster, reduced, mount, failed\]\);/);
  // A changed score goes through the live handle instead, and only a handle
  // that says it cannot absorb the change falls back to a rebuild.
  assert.match(corner, /if \(!scene\.current\.update\(latest\.current\)\) setMount\(\(n\) => n \+ 1\);/);
  assert.match(corner, /\}, \[grid\]\);/);
  const scene = read("client/src/components/tv/race-scene.ts");
  assert.match(scene, /return Object\.assign\(cleanup,\{update\}\);/);
  // Same ids in, same cars: a rebuild is refused rather than done quietly.
  assert.match(scene, /if\(nextIds\.size!==ids\.size\|\|Array\.from\(nextIds\)\.some\(id=>!ids\.has\(id\)\)\)return false;/);
  // The cars drive to the new order from where they are, timed from the
  // change rather than from the start of a scene that began hours ago.
  assert.match(scene, /currentDrivers=next;transitionStart=lastElapsed;/);
  assert.match(scene, /const transitionTime=options\.reduced\?12:Math\.max\(0,elapsed-transitionStart\);/);
  assert.match(scene, /const position=interpolateRaceTransition\(transition,transitionTime\);/);
});

// "When someone is in first, have the trail camera look backwards."
test("the corner knows who is actually leading right now, not who led at mount", () => {
  const scene = read("client/src/components/tv/race-scene.ts");
  assert.match(scene, /let leaderId:number\|undefined,leaderDistance=Infinity;/);
  assert.match(scene, /if\(position\.distance<leaderDistance\)\{leaderDistance=position\.distance;leaderId=driver\.id;\}/);
  assert.match(scene, /cornerCameraPose\(elapsed,focusPose,spotlightId===leaderId\)/);
});

// "The name tags are too confusing, it should be a close up on one car and
// show a name sometimes." — Ethan, 16 Sep 2026.
test("the corner holds one car close up and names it only now and then", () => {
  const corner = read("client/src/components/tv/corner-race.tsx");
  assert.match(corner, /spotlight: true,/);
  // No focusId: a pinned focus put a permanent halo on one car, and the
  // camera works down the running order on its own clock anyway.
  assert.doesNotMatch(corner, /focusId:/);
  // No cameraSeconds either: the corner is not a stretched version of the
  // transfer race single flight, it has its own shot list.
  assert.doesNotMatch(corner, /cameraSeconds/);
  assert.match(corner, /export const CORNER_RACE_SECONDS = CORNER_CAMERA_SECONDS;/);
  const scene = read("client/src/components/tv/race-scene.ts");
  // Spotlight frames ONE car: the rival-widening that makes a transfer's race
  // readable would pull the lens off everybody on a panel this size.
  assert.match(scene, /const spotlit=options\.spotlight\?allPlans\.filter\(p=>p\.id===options\.focusId\):\[\];/);
  assert.match(scene, /const subjects=spotlit\.length\?spotlit:raceCameraSubjects\(allPlans,options\.focusId\);/);
});
