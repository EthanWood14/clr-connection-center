import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CORNER_CAMERA_SECONDS, CORNER_FOCUS_SHOTS, CORNER_SHOTS, CORNER_SHOT_SECONDS,
  cornerCameraPose, cornerFocusIndex, cornerShotAt,
} from "../shared/tv-corner-camera";
import { raceTrackPoint } from "../shared/tv-race-grid";

/**
 * "Have all the camera have a trailing view, and have enough views to run for
 * 3 minutes without refreshing or going back to the beginning." — Ethan, 16
 * Sep 2026. The bolted-down corner cameras that used to be in this list are
 * gone: every shot follows the car now, and there are enough of them that a
 * three-minute stretch never reaches the end of the reel.
 */

const car = { angle: 0.4, lane: 0 };
const dist = (a: { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("the reel is longer than anyone watches: three minutes never reaches the end of it", () => {
  assert.equal(CORNER_SHOTS.length, 45);
  assert.equal(CORNER_SHOT_SECONDS, 6);
  assert.equal(CORNER_CAMERA_SECONDS, 270, "four and a half minutes");
  assert.ok(CORNER_CAMERA_SECONDS > 180, "three minutes of wall time cannot loop it");
  assert.equal(new Set(CORNER_SHOTS.map(s => s.id)).size, 45, "every shot is its own angle, not a repeat");
  // Three minutes in, the camera is still on shots it has not used yet, which
  // is the whole of the ask.
  const firstThreeMinutes = new Set<string>();
  for (let t = 0; t < 180; t += 1) firstThreeMinutes.add(cornerShotAt(t).shot.id);
  assert.equal(firstThreeMinutes.size, 30);
  assert.ok(!firstThreeMinutes.has(cornerShotAt(180).shot.id), "and the next one is new as well");
});

test("the shot list is walked in order and then starts again", () => {
  assert.equal(cornerShotAt(0).shot.id, CORNER_SHOTS[0].id);
  assert.equal(cornerShotAt(5.9).shot.id, CORNER_SHOTS[0].id);
  assert.equal(cornerShotAt(6).shot.id, CORNER_SHOTS[1].id);
  assert.equal(cornerShotAt(179).shot.id, CORNER_SHOTS[29].id);
  assert.equal(cornerShotAt(269).shot.id, CORNER_SHOTS[44].id);
  assert.equal(cornerShotAt(270).shot.id, CORNER_SHOTS[0].id, "the whole reel, then round again");
  assert.equal(cornerShotAt(-4).shot.id, CORNER_SHOTS[0].id);
  assert.ok(cornerShotAt(9).progress > .49 && cornerShotAt(9).progress < .51);
});

test("a following shot sits behind the car ON the track, and holds there as it laps", () => {
  const chase = CORNER_SHOTS.findIndex(s => s.id === "chase");
  const at = chase * CORNER_SHOT_SECONDS + 1;
  const near = cornerCameraPose(at, car);
  // Behind means behind along the racing line: same distance from the centre
  // of the circuit as the car, not cutting across the infield.
  const radius = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);
  assert.ok(Math.abs(radius(near.position) - 42) < 2, "the chase camera is on the racing line");
  // A quarter-lap later it is in a different place but the SAME place relative
  // to the car: a chase camera that stayed put would be a fixed camera.
  const later = cornerCameraPose(at + .5, { angle: car.angle + .6, lane: 0 });
  assert.ok(dist(near.position, later.position) > 8, "it travels with the car");
  assert.ok(Math.abs(radius(later.position) - 42) < 2);
});

test("an overhead shot is genuinely above the car, looking down at it", () => {
  const overhead = CORNER_SHOTS.find(s => s.id === "overhead")!;
  const index = CORNER_SHOTS.indexOf(overhead);
  const pose = cornerCameraPose(index * CORNER_SHOT_SECONDS + 2, car);
  const point = raceTrackPoint(car.angle, car.lane);
  assert.ok(pose.position.y > 12, "well above the roof");
  assert.ok(Math.hypot(pose.position.x - point.x, pose.position.z - point.z) < 6, "and almost directly over it");
  assert.ok(pose.target.y < pose.position.y, "pointing down at the car");
});

test("every shot trails: not one of them is bolted to the circuit any more", () => {
  const radius = (point: { x: number; z: number }) => Math.hypot(point.x, point.z);
  for (let i = 0; i < CORNER_SHOTS.length; i++) {
    const shot = CORNER_SHOTS[i];
    assert.ok(shot.behind > 0, `${shot.id} is not behind the car`);
    // Move the car most of a lap and the camera must have gone with it.
    const start = i * CORNER_SHOT_SECONDS + 1;
    const near = cornerCameraPose(start, { angle: 0, lane: 0 });
    const later = cornerCameraPose(start + .6, { angle: 1.4, lane: 0 });
    assert.ok(dist(near.position, later.position) > 8, `${shot.id} stayed put while the car drove away`);
    // And it stays on the road rather than cutting across the infield.
    assert.ok(Math.abs(radius(later.position) - (42 + (shot.beside ?? 0))) < 2.5, `${shot.id} left the racing line`);
  }
});

test("every shot in the list produces a usable, finite pose all the way round a lap", () => {
  for (let i = 0; i < CORNER_SHOTS.length; i++) {
    for (const angle of [-3, -1.2, 0, .8, 2.5, 3.1]) {
      const pose = cornerCameraPose(i * CORNER_SHOT_SECONDS + 3, { angle, lane: angle > 0 ? 4 : -4 });
      for (const v of [pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, pose.fov]) {
        assert.ok(Number.isFinite(v), `${CORNER_SHOTS[i].id} produced a broken pose`);
      }
      assert.ok(pose.position.y > 0, `${CORNER_SHOTS[i].id} put the camera under the track`);
      assert.ok(pose.fov >= 35 && pose.fov <= 70, `${CORNER_SHOTS[i].id} has an unusable lens`);
      assert.ok(dist(pose.position, pose.target) > 1, `${CORNER_SHOTS[i].id} is inside its own subject`);
    }
  }
});

// "Why do the grandstands like go away and it look so weird" — Ethan, 16 Sep
// 2026. Two separate things were eating the world.
test("the corner keeps the circuit standing: no lens prop, no scenery clipping", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  // 1. The seat backs and rail are a prop on the LENS for the transfer race's
  // opening grandstand POV; they fade out two seconds in, which on a
  // three-minute broadcast looked like the stand dissolving.
  assert.match(scene, /const fanOpacity=options\.reduced\|\|options\.spotlight\?0:/);
  // 2. Scenery clipping cuts everything nearer than the farthest car, so a
  // fixed camera kept slicing the stands away and popping them back.
  assert.match(scene, /const sceneryClip=options\.spotlight/);
  assert.match(scene, /\? \{normal:\{x:0,y:1,z:0\},constant:1e6\}/);
  assert.match(scene, /: raceSceneryClipPlane\(shot\.position,shot\.target,racers\.map/);
});

test("no shot wanders into the scenery", () => {
  // The grandstand ring is out at lane ~27 and the infield grass ends near
  // -14; a lens outside either is looking at the back of the geometry.
  for (const shot of CORNER_SHOTS) {
    assert.ok(Math.abs(shot.beside ?? 0) <= 13, `${shot.id} is parked in the scenery at ${shot.beside}`);
  }
});

// "When someone is in first, have the trail camera look backwards." — Ethan,
// 16 Sep 2026. There is nothing up the road ahead of the leader, so the shot
// turns round and shows the people chasing them instead.
test("the leader gets the same shot, reversed", () => {
  const bearing = (point: { x: number; z: number }) => Math.atan2(point.z, point.x);
  const car = { angle: 1, lane: 0 };
  const carBearing = bearing({ x: Math.cos(1) * 42, z: Math.sin(1) * 42 });
  const at = CORNER_SHOTS.findIndex(shot => shot.id === "chase") * CORNER_SHOT_SECONDS + 2;
  const normal = cornerCameraPose(at, car, false);
  const reversed = cornerCameraPose(at, car, true);
  assert.ok(bearing(normal.position) < carBearing, "the ordinary shot sits behind the car");
  assert.ok(bearing(reversed.position) > carBearing, "the leader is followed from up the road");
  // Same distance from the car either way: it is one shot, turned round.
  const point = { x: Math.cos(1) * 42, z: Math.sin(1) * 42 };
  const gap = (pose: { x: number; z: number }) => Math.hypot(pose.x - point.x, pose.z - point.z);
  assert.ok(Math.abs(gap(normal.position) - gap(reversed.position)) < .5);
  // And it is AIMED backwards, down the road the chasing cars are on.
  assert.ok(bearing(reversed.target) < bearing(reversed.position), "the lens looks back past the leader");
  assert.ok(bearing(normal.target) > bearing(normal.position), "where the ordinary shot looks forwards");
  assert.match(reversed.shot.label, /REVERSE/, "and the caption says so");
  for (let i = 0; i < CORNER_SHOTS.length; i++) {
    const pose = cornerCameraPose(i * CORNER_SHOT_SECONDS + 3, { angle: -2, lane: 3 }, true);
    for (const value of [pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z]) {
      assert.ok(Number.isFinite(value), `${CORNER_SHOTS[i].id} broke when reversed`);
    }
    assert.ok(pose.position.y > 0, `${CORNER_SHOTS[i].id} went under the track when reversed`);
    assert.ok(dist(pose.position, pose.target) > 1, `${CORNER_SHOTS[i].id} is inside its own subject when reversed`);
  }
});

// "For the behind shots close up of the cars, don't have it for first place
// always, mix it up." — Ethan, 16 Sep 2026.
test("the corner works down the running order instead of sitting on the leader", () => {
  assert.equal(CORNER_FOCUS_SHOTS, 5);
  // Half a minute each, six different cars across a three-minute broadcast.
  const seen = new Set<number>();
  for (let t = 0; t < 180; t += 3) seen.add(cornerFocusIndex(t, 8));
  assert.equal(seen.size, 6, `three minutes should follow six cars, not ${seen.size}`);
  assert.equal(cornerFocusIndex(0, 8), 0);
  assert.equal(cornerFocusIndex(29, 8), 0, "it holds one car for five shots");
  assert.equal(cornerFocusIndex(30, 8), 1, "then moves to the next");
  // A short field wraps rather than running off the end of the order.
  assert.equal(cornerFocusIndex(90, 2), 1);
  assert.equal(cornerFocusIndex(0, 0), 0, "and an empty board cannot crash the wall");
  // Each run can start somewhere different, so the wall does not open on P1
  // every three minutes.
  assert.equal(cornerFocusIndex(0, 8, 3), 3);
  assert.equal(cornerFocusIndex(30, 8, 3), 4);
});
