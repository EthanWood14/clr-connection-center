import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  layoutRaceLabels,
  RACE_BASE_ANGULAR_SPEED,
  RACE_SPEED_MULTIPLIER,
  type RaceLabelAnchor,
  type RaceLabelPlacement,
} from "../shared/tv-race-labels";

const anchor = (id: number, x = 400, y = 300, width = 140, height = 26): RaceLabelAnchor =>
  ({ id, x, y, width, height });

function withinSafeArea(label: RaceLabelPlacement, width: number, height: number) {
  assert.ok(label.left >= 10, "labels respect the left margin");
  assert.ok(label.left + label.width <= width - 10, "labels stay inside the scene, before the standings tower");
  assert.ok(label.top >= Math.min(130, height * 0.2), "labels leave space for the race header");
  assert.ok(label.top + label.height <= height * 0.8, "labels leave space for the leader footer");
}

function assertSeparated(labels: RaceLabelPlacement[]) {
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    const separated = a.left + a.width + 5 <= b.left || b.left + b.width + 5 <= a.left
      || a.top + a.height + 5 <= b.top || b.top + b.height + 5 <= a.top;
    assert.ok(separated, `labels ${a.id} and ${b.id} must not overlap when space is available`);
  }
}

test("the race uses five times its original angular speed", () => {
  assert.equal(RACE_SPEED_MULTIPLIER, 5);
  assert.equal(RACE_BASE_ANGULAR_SPEED, 0.115);
  assert.ok(Math.abs(RACE_BASE_ANGULAR_SPEED * RACE_SPEED_MULTIPLIER - 0.575) < 1e-12);
});

test("no projected cars produces no labels", () => {
  assert.deepEqual(layoutRaceLabels([], { width: 1280, height: 720 }), []);
});

test("a lone label centers above its car with a connector gap", () => {
  const [label] = layoutRaceLabels([anchor(5)], { width: 1280, height: 720 });
  assert.deepEqual(label, { id: 5, x: 400, y: 300, width: 140, height: 26, left: 330, top: 256 });
  assert.equal(label.top + label.height, label.y - 18);
  withinSafeArea(label, 1280, 720);
});

test("layout never mutates or sorts the caller's anchors", () => {
  const anchors = [anchor(9, 350), anchor(1, 420), anchor(5, 460)];
  const original = anchors.map(value => ({ ...value }));
  anchors.forEach(value => Object.freeze(value));
  Object.freeze(anchors);
  const labels = layoutRaceLabels(anchors, { width: 1280, height: 720 });
  assert.deepEqual(anchors, original);
  assert.notEqual(labels, anchors);
  for (const label of labels) assert.notEqual(label, anchors.find(value => value.id === label.id));
});

test("stable driver IDs determine placement regardless of incoming projection order", () => {
  const anchors = [anchor(12), anchor(3), anchor(8), anchor(1)];
  const first = layoutRaceLabels(anchors, { width: 1280, height: 720 });
  const reversed = layoutRaceLabels([...anchors].reverse(), { width: 1280, height: 720 });
  assert.deepEqual(first, reversed);
  assert.deepEqual(first.map(label => label.id), [1, 3, 8, 12]);
  assert.deepEqual(first, layoutRaceLabels(anchors, { width: 1280, height: 720 }));
});

test("drivers with identical names and projected positions still receive separate labels", () => {
  const anchors = [{ ...anchor(17), name: "Alex Lee" }, { ...anchor(41), name: "Alex Lee" }];
  const labels = layoutRaceLabels(anchors, { width: 1280, height: 720 });
  assert.equal(labels.length, 2);
  assert.deepEqual(labels.map(label => label.id), [17, 41]);
  assertSeparated(labels);
});

test("coincident car anchors fan out into readable labels when screen space permits", () => {
  const anchors = Array.from({ length: 10 }, (_, index) => anchor(index + 1, 640, 380));
  const labels = layoutRaceLabels(anchors, { width: 1280, height: 720 });
  assert.equal(labels.length, anchors.length);
  assertSeparated(labels);
  for (const label of labels) withinSafeArea(label, 1280, 720);
});

test("collision displacement keeps the true car coordinates for connector endpoints", () => {
  const anchors = Array.from({ length: 7 }, (_, index) => anchor(index + 1, 400 + index, 300 + index));
  const labels = layoutRaceLabels(anchors, { width: 1280, height: 720 });
  assert.ok(labels.some(label => label.left !== label.x - label.width / 2
    || label.top !== label.y - label.height - 18), "the test must actually exercise displaced labels");
  for (const label of labels) {
    const original = anchors.find(value => value.id === label.id)!;
    assert.equal(label.x, original.x);
    assert.equal(label.y, original.y);
    assert.equal(label.height, original.height);
  }
});

test("edge and offscreen anchors clamp labels without moving the actual anchors", () => {
  for (const [width, height] of [[1280, 720], [780, 500], [320, 240]]) {
    const anchors = [
      anchor(1, -500, -400), anchor(2, width + 500, height + 400),
      anchor(3, width / 2, 0), anchor(4, width / 2, height),
    ];
    const labels = layoutRaceLabels(anchors, { width, height });
    for (const label of labels) {
      withinSafeArea(label, width, height);
      const original = anchors.find(value => value.id === label.id)!;
      assert.equal(label.x, original.x);
      assert.equal(label.y, original.y);
    }
  }
});

test("long-name label boxes are narrowed to the available scene width", () => {
  const original = anchor(1, 160, 140, 950, 26);
  const [label] = layoutRaceLabels([original], { width: 320, height: 240 });
  assert.equal(label.width, 300);
  assert.equal(label.left, 10);
  assert.equal(original.width, 950);
  withinSafeArea(label, 320, 240);
});

test("dense cramped fields retain every driver and remain bounded even when overlap is unavoidable", () => {
  const anchors = Array.from({ length: 64 }, (_, index) => anchor(index + 1, 160, 120, 180, 28));
  const labels = layoutRaceLabels(anchors, { width: 320, height: 240 });
  assert.equal(labels.length, anchors.length);
  assert.equal(new Set(labels.map(label => label.id)).size, anchors.length);
  for (const label of labels) {
    withinSafeArea(label, 320, 240);
    for (const value of [label.left, label.top, label.width, label.height, label.x, label.y]) {
      assert.ok(Number.isFinite(value));
    }
  }
});

test("variable name widths and label heights remain separated in a typical TV cluster", () => {
  const anchors = [
    anchor(1, 700, 410, 100, 24), anchor(2, 710, 400, 260, 28),
    anchor(3, 680, 415, 180, 26), anchor(4, 715, 420, 220, 30),
    anchor(5, 690, 405, 150, 25), anchor(6, 705, 410, 190, 28),
  ];
  const labels = layoutRaceLabels(anchors, { width: 1600, height: 900 });
  assertSeparated(labels);
  for (const label of labels) withinSafeArea(label, 1600, 900);
});

test("every racer gets their full name, stable identity, and an owned connector element", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  // The full-screen race names everybody; the wall's corner panel names only
  // the car it is following, because a dozen plates on a small panel is
  // unreadable (owner, 16 Sep 2026). Both come off the same list.
  // Spotlight names the car being followed and the two nearest it — one
  // plate is not enough to see who is racing whom, and a plate on every
  // car is what made the panel unreadable (owner, 16 Sep 2026).
  assert.match(scene, /const spotlightNames=3;/);
  assert.match(scene, /const named=racers;/, "plates are built for everyone, because the followed car changes");
  assert.match(scene, /const spotlightPlates=new Set<number>\(\);/);
  assert.match(scene, /const onCamera=!options\.spotlight\|\|spotlightPlates\.has\(racer\.driver\.id\);/,
    "and in the corner only the followed car and its two nearest are shown");
  assert.match(scene, /\.slice\(0,spotlightNames-1\)\.forEach\(r=>spotlightPlates\.add\(r\.driver\.id\)\);/);
  assert.match(scene, /const tags=named\.map\(/);
  assert.match(scene, /const named_now=!options\.spotlight\|\|\(elapsed%18\)<7;/,
    "and in that mode the names are an occasional caption, not permanent labels");
  assert.match(scene, /element\.textContent\s*=\s*r\.driver\.id===options\.focusId\?`▶ \$\{r\.driver\.name\}`:r\.driver\.name\s*;/, "the focus marker retains every driver's full name");
  assert.match(scene, /element\.dataset\.driverId\s*=\s*String\(r\.driver\.id\)/);
  assert.match(scene, /tagElements\.push\(line,\s*element\)/, "both DOM nodes belong to scene cleanup");
  assert.match(scene, /layoutRaceLabels\(anchors,/);
});

test("the scene speeds up travel and wheels while preserving a static reduced-motion pose", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  assert.match(scene, /const speed\s*=\s*options\.reduced\s*\?\s*RACE_BASE_ANGULAR_SPEED\s*:\s*RACE_BASE_ANGULAR_SPEED\s*\*\s*RACE_SPEED_MULTIPLIER/);
  assert.match(scene, /sampleRaceDynamics\(\{transition,elapsed,driverId:driver\.id,speed,reduced:options\.reduced\}\)/,
    "wheel travel uses the same boosted track speed and static reduced-motion mode");
  assert.match(scene, /wheel\.rotation\.x\s*=\s*dynamics\.wheelAngle/);
  assert.match(scene, /const motionTime\s*=\s*options\.reduced\s*\?\s*[\d.]+\s*:\s*elapsed/);
  // The camera walks cameraTime: that IS elapsed for a transfer's moment, and
  // elapsed stretched over two minutes for the wall's corner race. The cars
  // keep lapping at `lead` either way, so the pass is never lost.
  assert.match(scene, /const cameraTime=options\.reduced\?12:Math\.min\(12,elapsed\*12\/flightFor\)/);
  // The corner cuts between its own thirty shots; the transfer race keeps
  // the single flight, and that is the branch this pins.
  assert.match(scene, /const shot=options\.spotlight&&focusPose/);
  assert.match(scene, /: raceCameraPose\(subjects,cameraTime,lead,camera\.aspect,framingRadius,options\.reduced\);/,
    "the camera follows full angular travel and the scorer's actual rivals instead of losing the pass");
  assert.match(scene, /camera\.lookAt\(shot\.target\.x,shot\.target\.y,shot\.target\.z\)/);
});
