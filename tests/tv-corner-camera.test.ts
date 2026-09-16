import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CORNER_CAMERA_SECONDS, CORNER_SHOTS, CORNER_SHOT_SECONDS, cornerCameraPose, cornerShotAt,
} from "../shared/tv-corner-camera";
import { raceTrackPoint } from "../shared/tv-race-grid";

/**
 * "I want it to be 3 minutes, with shots behind the cars, right on top of the
 * cars, at corners not moving, etc." — Ethan, 16 Sep 2026.
 */

const car = { angle: 0.4, lane: 0 };
const dist = (a: { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("thirty shots of six seconds is three minutes", () => {
  assert.equal(CORNER_SHOTS.length, 30);
  assert.equal(CORNER_SHOT_SECONDS, 6);
  assert.equal(CORNER_CAMERA_SECONDS, 180);
  assert.equal(new Set(CORNER_SHOTS.map(s => s.id)).size, 30, "every shot is its own angle, not a repeat");
});

test("the shot list is walked in order and then starts again", () => {
  assert.equal(cornerShotAt(0).shot.id, CORNER_SHOTS[0].id);
  assert.equal(cornerShotAt(5.9).shot.id, CORNER_SHOTS[0].id);
  assert.equal(cornerShotAt(6).shot.id, CORNER_SHOTS[1].id);
  assert.equal(cornerShotAt(179).shot.id, CORNER_SHOTS[29].id);
  assert.equal(cornerShotAt(180).shot.id, CORNER_SHOTS[0].id, "three minutes, then round again");
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

test("a fixed shot does not move while the car sweeps through it", () => {
  const still = CORNER_SHOTS.filter(s => s.kind === "fixed");
  assert.ok(still.length >= 8, `the corner needs plenty of static cameras: ${still.length}`);
  const index = CORNER_SHOTS.findIndex(s => s.id === "apex-still");
  const start = index * CORNER_SHOT_SECONDS;
  const a = cornerCameraPose(start + .2, { angle: 0, lane: 0 });
  const b = cornerCameraPose(start + 5.5, { angle: 2.4, lane: 6 });
  assert.equal(a.position.x, b.position.x, "the camera is bolted to the circuit");
  assert.equal(a.position.y, b.position.y);
  assert.equal(a.position.z, b.position.z);
  // It still turns to watch: the car moved, so the look-target must have.
  assert.ok(dist(a.target, b.target) > 10, "it pans to follow rather than staring at nothing");
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
