import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { sampleRaceDynamics, RACE_DYNAMICS_LIMITS } from "../shared/tv-race-dynamics";
import { interpolateRaceTransition, planRaceTransition, type RaceTransition } from "../shared/tv-race-transition";
import { createTvCarModel } from "../client/src/components/tv/car-model";
import { defaultTvCarAppearance } from "../shared/tv-car";
import { createBlankCarSkin } from "../shared/tv-car-skin";

const driver = (id: number, transfersToday: number) => ({ id, name: `Driver ${id}`, transfersToday });
const plans = () => planRaceTransition([driver(1, 5), driver(2, 4), driver(3, 2)], [driver(1, 5), driver(2, 6), driver(3, 2)], 2);
const stationary = (): RaceTransition => ({ id: 1, startDistance: 4, endDistance: 4, startLane: 0, endLane: 0, scored: false, passing: false, passedIds: [], tieIds: [], maneuverLane: 0 });
const sample = (transition: RaceTransition, elapsed: number, speed = .575, reduced = false) => sampleRaceDynamics({ transition, elapsed, driverId: transition.id, speed, reduced });

test("car dynamics are deterministic, finite and physically restrained across the full maneuver", () => {
  for (const plan of plans()) for (let tick = -20; tick <= 250; tick++) {
    const time = tick / 20, value = sample(plan, time);
    assert.deepEqual(value, sample(plan, time));
    for (const key of ["steering", "yawOffset", "roll", "pitch", "heave"] as const) {
      assert.ok(Number.isFinite(value[key]));
      assert.ok(Math.abs(value[key]) <= RACE_DYNAMICS_LIMITS[key]);
    }
    assert.ok(Number.isFinite(value.wheelAngle) && Math.abs(value.wheelAngle) <= Math.PI * 2);
  }
});

test("reduced motion is an entirely stable zero-articulation pose", () => {
  const zero = { steering: 0, yawOffset: 0, roll: 0, pitch: 0, heave: 0, wheelAngle: 0 };
  for (const plan of plans()) for (const time of [0, 1, 2.5, 4.5, 6.5, 12, 100]) assert.deepEqual(sample(plan, time, 2, true), zero);
});

test("steering follows the actual lane change and settles back into the left-hand bend", () => {
  const plan = plans().find(row => row.id === 2)!;
  const pullOut = sample(plan, 2.5), settled = sample(plan, 8);
  assert.equal(Math.sign(pullOut.yawOffset), Math.sign(plan.maneuverLane - plan.startLane));
  assert.notEqual(pullOut.steering, settled.steering);
  assert.equal(settled.yawOffset, 0);
  assert.ok(settled.steering < 0, "front wheels remain turned gently into the curve");
});

test("real forward acceleration loads the chassis, then unloading reverses pitch", () => {
  const plan = plans().find(row => row.id === 2)!;
  assert.ok(sample(plan, 3.5).pitch < 0, "acceleration lifts the nose a little");
  assert.ok(sample(plan, 5.5).pitch > 0, "settling back to pace loads the front");
  assert.equal(sample(plan, 8).pitch, 0);
});

test("wheel spin follows speed and score-derived forward travel, never frame rate", () => {
  const plan = stationary();
  const angularDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const slow = sample(plan, .01, .2), fast = sample(plan, .01, .4);
  assert.ok(Math.abs(fast.wheelAngle - 2 * slow.wheelAngle) < 1e-9);
  const car = plans().find(row => row.id === 2)!;
  const pose = interpolateRaceTransition(car, 4.5);
  const expected = -(.575 * 42 * 4.5 + car.startDistance - pose.distance) / .43;
  assert.ok(Math.abs(angularDifference(sample(car, 4.5).wheelAngle, expected)) < 1e-9);
  assert.deepEqual(sample(plan, 7.234), sample(plan, 7.234), "sample order has no effect on the pose");
});

test("parked cars have no shake, steering, wheel spin or body load", () => {
  const value = sample(stationary(), 3.5, 0);
  for (const amount of Object.values(value)) assert.equal(amount, 0);
});

test("articulation cannot change exact lanes, score credit or who passes whom", () => {
  const transitions = plans(), frozen = JSON.stringify(transitions);
  for (let tick = 0; tick <= 120; tick++) for (const transition of transitions) {
    const time = tick / 10, before = interpolateRaceTransition(transition, time);
    const value = sample(transition, time);
    assert.deepEqual(interpolateRaceTransition(transition, time), before);
    assert.deepEqual(Object.keys(value).sort(), ["heave", "pitch", "roll", "steering", "wheelAngle", "yawOffset"]);
  }
  assert.equal(JSON.stringify(transitions), frozen);
});

test("invalid external timing and speed values cannot put NaN into a transform", () => {
  const plan = { ...stationary(), startDistance: NaN, endDistance: Infinity, startLane: NaN, endLane: Infinity, maneuverLane: -Infinity };
  for (const elapsed of [NaN, Infinity, -Infinity, -1000, 1e300]) for (const speed of [NaN, Infinity, -10, 1e300]) {
    const value = sampleRaceDynamics({ transition: plan, elapsed, driverId: NaN, speed });
    assert.ok(Object.values(value).every(Number.isFinite));
  }
});

test("body suspension and front steering articulate independently of the exact track anchor", () => {
  const model = createTvCarModel({ appearance: { ...defaultTvCarAppearance(1), skin: createBlankCarSkin() }, focus: true });
  try {
    assert.equal(model.frontSteering.length, 2); assert.equal(model.wheels.length, 4);
    assert.deepEqual(model.chassis.position.toArray(), [0, 0, 0]);
    assert.deepEqual(model.chassis.rotation.toArray().slice(0, 3), [0, 0, 0]);
    const anchor = model.root.position.clone();
    const wheels = model.wheels.map(wheel => wheel.getWorldPosition(new THREE.Vector3()));
    const body = model.root.getObjectByName("body-center")!;
    assert.equal(body.parent, model.chassis);
    const pixelMaterial = (body as THREE.Mesh).material;
    model.chassis.position.y = -.02; model.chassis.rotation.set(.025, 0, .04);
    for (const steering of model.frontSteering) steering.rotation.y = .2;
    for (const wheel of model.wheels) wheel.rotation.x = 1.5;
    model.root.updateMatrixWorld(true);
    assert.deepEqual(model.root.position, anchor);
    model.wheels.forEach((wheel, index) => assert.deepEqual(wheel.getWorldPosition(new THREE.Vector3()), wheels[index]));
    assert.equal((body as THREE.Mesh).material, pixelMaterial, "articulation preserves skin resources");
    assert.equal(model.root.getObjectByName("focus-halo")?.parent, model.root);
    assert.equal(model.boost.parent, model.root);
  } finally { model.dispose(); }
});
