import { test } from "node:test";
import assert from "node:assert/strict";
import { raceGrid } from "../shared/tv-race-grid";
import { planRaceTransition, interpolateRaceTransition, raceTransitionStartRank, type RaceTransition } from "../shared/tv-race-transition";
import type { RankRow } from "../shared/tv-overtake";

const driver = (id: number, transfersToday: number, name = `Driver ${id}`): RankRow => ({ id, name, transfersToday });
const find = (plans: RaceTransition[], id: number) => plans.find(row => row.id === id)!;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);

test("broadcast starting rank uses corrected baselines rather than claiming an unearned extra pass", () => {
  const plans=planRaceTransition([driver(1,10),driver(2,5),driver(3,4)],[driver(1,0),driver(2,5),driver(3,6)],3);
  assert.equal(raceTransitionStartRank(find(plans,3),plans),2);
  assert.deepEqual(find(plans,3).passedIds,[2]);
  assert.equal(raceTransitionStartRank(find(plans,1),plans),undefined);
  assert.equal(raceTransitionStartRank(undefined,plans),undefined);
  const ties=planRaceTransition([driver(1,5),driver(2,5),driver(3,4)],[driver(1,6),driver(2,5),driver(3,4)],1);
  assert.equal(raceTransitionStartRank(find(ties,1),ties),1);
});

function assertStatic(plans: RaceTransition[]) {
  for (const row of plans) {
    assert.equal(row.scored, false);
    assert.equal(row.passing, false);
    assert.deepEqual(row.passedIds, []);
    assert.deepEqual(row.tieIds, []);
    assert.equal(row.startDistance, row.endDistance);
    assert.equal(row.startLane, row.endLane);
  }
}

test("first load, empty history and an empty field never invent a pass", () => {
  const next = [driver(1, 8), driver(2, 4.5), driver(3, 0)];
  assertStatic(planRaceTransition(null, next, 2));
  assertStatic(planRaceTransition([], next, 2));
  assert.deepEqual(planRaceTransition(next, []), []);
});

test("unchanged polls, alphabetic tie reordering and downward corrections stay still", () => {
  const before = [driver(1, 5, "Zoe"), driver(2, 5, "Ana"), driver(3, 3)];
  assertStatic(planRaceTransition(before, [...before].reverse()));
  assertStatic(planRaceTransition(before, [driver(1, 5, "Abi"), driver(2, 5, "Zoe"), driver(3, 3)]));
  assertStatic(planRaceTransition(before, [driver(1, 2), driver(2, 5), driver(3, 3)], 3));
});

test("a changed roster suppresses the entire transition, including concurrent real scoring", () => {
  const before = [driver(1, 5), driver(2, 3), driver(4, 8)];
  const plans = planRaceTransition(before, [driver(1, 5), driver(2, 6), driver(3, 7)], 3);
  assertStatic(plans);
  assert.equal(plans.some(row => row.id === 4), false);
  assertStatic(planRaceTransition(before, [driver(1, 5), driver(2, 3), driver(3, 9)]));
  assertStatic(planRaceTransition(before, [driver(1, 5), driver(2, 6)], 2));
  assertStatic(planRaceTransition(before, [...before, driver(3, 9)], 3));
});

test("a concurrent newcomer is never physically passed using an invented before position", () => {
  const before = [driver(1, 5), driver(2, 3)];
  const after = [driver(1, 5), driver(2, 6), driver(3, 5.5)];
  const plans = planRaceTransition(before, after, 2);
  assertStatic(plans);
  for (const gridRow of raceGrid(after)) {
    const plan = find(plans, gridRow.id);
    for (const elapsed of [0, 2, 2.5, 3, 4.5, 6, 6.5, 7, 12]) {
      const pose = interpolateRaceTransition(plan, elapsed);
      assert.equal(pose.distance, gridRow.distance);
      assert.equal(pose.lane, gridRow.lane);
      assert.equal(pose.passing, false);
    }
  }
  // The following stable-roster poll has usable history and can race normally.
  const resumed = planRaceTransition(after, [driver(1, 5), driver(2, 6), driver(3, 6.5)], 3);
  assert.equal(find(resumed, 3).passing, true);
  assert.deepEqual(find(resumed, 3).passedIds, [2]);
});

test("a genuine scorer begins behind, pulls out, overtakes, and rejoins at the exact final grid", () => {
  const before = [driver(1, 5), driver(2, 4), driver(3, 1)];
  const after = [driver(1, 5), driver(2, 6), driver(3, 1)];
  const plans = planRaceTransition(before, after, 2), scorer = find(plans, 2), rival = find(plans, 1);
  assert.equal(scorer.scored, true);
  assert.equal(scorer.passing, true);
  assert.deepEqual(scorer.passedIds, [1]);
  assert.deepEqual(scorer.tieIds, []);
  assert.ok(scorer.startDistance > rival.startDistance);
  assert.ok(scorer.endDistance < rival.endDistance);
  assert.ok(scorer.startDistance > scorer.endDistance, "the scorer actually advances in the race frame");
  assert.equal(interpolateRaceTransition(scorer, 2.5).distance, scorer.startDistance, "pull out before accelerating");
  assert.notEqual(interpolateRaceTransition(scorer, 2.5).lane, scorer.startLane);
  assert.equal(interpolateRaceTransition(scorer, 4.5).lane, scorer.maneuverLane);
  assert.ok(Math.abs(scorer.maneuverLane - interpolateRaceTransition(rival, 4.5).lane) >= 2.5);
  for (const row of raceGrid(after)) {
    const plan = find(plans, row.id);
    assert.equal(plan.endDistance, row.distance);
    assert.equal(plan.endLane, row.lane);
    for (const t of [7, 8, 12, 100]) {
      const pose = interpolateRaceTransition(plan, t);
      assert.equal(pose.distance, row.distance);
      assert.equal(pose.lane, row.lane);
      assert.equal(pose.progress, 1);
      assert.equal(pose.passing, false);
    }
  }
});

test("half-credit catches pull alongside and never become a strict pass", () => {
  const plans = planRaceTransition([driver(1, 5), driver(2, 4.5)], [driver(1, 5), driver(2, 5)], 2);
  const scorer = find(plans, 2), rival = find(plans, 1);
  assert.deepEqual(scorer.passedIds, []);
  assert.deepEqual(scorer.tieIds, [1]);
  assert.equal(scorer.passing, true);
  assert.equal(scorer.endDistance, rival.endDistance);
  assert.notEqual(scorer.endLane, rival.endLane);
  for (let t = 0; t <= 8; t += .05) {
    assert.ok(interpolateRaceTransition(scorer, t).distance >= interpolateRaceTransition(rival, t).distance - 1e-9);
  }
});

test("breaking a previous tie moves the scorer ahead rather than only moving the rival backward", () => {
  const plans = planRaceTransition([driver(1, 5), driver(2, 5)], [driver(1, 5.5), driver(2, 5)]);
  const scorer = find(plans, 1), rival = find(plans, 2);
  assert.deepEqual(scorer.passedIds, [2]);
  assert.equal(scorer.startDistance, rival.startDistance);
  assert.ok(scorer.endDistance < scorer.startDistance);
  assert.equal(rival.startDistance, rival.endDistance);
});

test("catching a tie rejoins from the correct side without cutting through tied rivals", () => {
  for (const name of ["A First", "M Middle", "Z Last"]) {
    const plans = planRaceTransition(
      [driver(1, 5, "B Rival"), driver(2, 5, "Y Rival"), driver(3, 4.5, name)],
      [driver(1, 5, "B Rival"), driver(2, 5, "Y Rival"), driver(3, 5, name)],
    );
    const scorer = find(plans, 3);
    for (const rival of plans.filter(row => row.id !== 3)) {
      for (let t = 6; t <= 7; t += .02) {
        const pose = interpolateRaceTransition(scorer, t);
        assert.ok((pose.lane - rival.endLane) * (scorer.endLane - rival.endLane) > 0);
      }
    }
  }
});

test("multiple genuine scorers retain their own independent passed and caught rivals", () => {
  const before = [driver(1, 8), driver(2, 6), driver(3, 4), driver(4, 2)];
  const next = [driver(1, 8), driver(2, 9), driver(3, 8), driver(4, 2)];
  const plans = planRaceTransition(before, next, 3);
  assert.deepEqual(find(plans, 2).passedIds, [1]);
  assert.deepEqual(find(plans, 3).passedIds, []);
  assert.deepEqual(find(plans, 3).tieIds, [1]);
  assert.equal(find(plans, 2).passing, true);
  assert.equal(find(plans, 3).passing, true);
  assert.notEqual(find(plans, 2).maneuverLane, find(plans, 3).maneuverLane);
  assert.equal(find(plans, 1).passing, false);
  assert.equal(find(plans, 4).passing, false);
});

test("a simultaneous scorer can pass several actual rivals in one continuous move", () => {
  const plans = planRaceTransition(
    [driver(1, 8), driver(2, 6), driver(3, 4), driver(4, 2)],
    [driver(1, 8), driver(2, 6.5), driver(3, 9), driver(4, 2)],
  );
  assert.deepEqual(find(plans, 3).passedIds, [1, 2]);
  assert.equal(find(plans, 2).scored, true);
  assert.equal(find(plans, 2).passing, false, "improved credit alone does not fabricate an overtake");
});

test("a correction is applied before a concurrent scoring move, not replayed as an earned pass", () => {
  const plans = planRaceTransition([driver(1, 8), driver(2, 3), driver(3, 1)], [driver(1, 2), driver(2, 4), driver(3, 1)]);
  assert.equal(find(plans, 2).scored, true);
  assert.equal(find(plans, 2).passing, false);
  assert.ok(find(plans, 2).startDistance < find(plans, 1).startDistance);
  assert.equal(find(plans, 1).scored, false);
  assert.equal(find(plans, 1).passing, false);
});

test("a day reset does not become a historical race, including a first scorer after zeros reset", () => {
  const before = [driver(1, 8), driver(2, 4.5), driver(3, 0)];
  assertStatic(planRaceTransition(before, [driver(1, 0), driver(2, 0), driver(3, 0)]));
  assertStatic(planRaceTransition(before, [driver(1, 0), driver(2, 0), driver(3, 1)], 3));
  assertStatic(planRaceTransition(null, [driver(1, 1), driver(2, .5), driver(3, 2)], 3));
});

test("identity deduplication, deterministic input order and focus never invent credit", () => {
  const before = [driver(1, 8), driver(2, 7.5), driver(3, 7)];
  const after = [driver(1, 8), driver(2, 8), driver(3, 8.5)];
  const expected = planRaceTransition(before, after, 2);
  assert.deepEqual(planRaceTransition([...before].reverse(), [...after].reverse(), 2), expected);
  assert.deepEqual(planRaceTransition([...before, driver(2, 200)], [...after, driver(2, 200)], 2), expected);
  assert.equal(find(planRaceTransition(before, after, 1), 1).passing, false);
  assert.equal(find(planRaceTransition(before, after, 1), 1).scored, false);
});

test("inputs are immutable and poses stay finite, bounded, continuous and monotone", () => {
  const before = Array.from({ length: 36 }, (_, index) => driver(index + 1, (index % 12) * .5));
  const after = before.map(row => ({ ...row, transfersToday: row.transfersToday + (row.id % 4 === 0 ? 1 : 0) }));
  const copy = JSON.stringify([before, after]);
  before.forEach(Object.freeze); after.forEach(Object.freeze); Object.freeze(before); Object.freeze(after);
  const plans = planRaceTransition(before, after, 8);
  assert.equal(JSON.stringify([before, after]), copy);
  for (const plan of plans) {
    let last = interpolateRaceTransition(plan, -1);
    assert.equal(last.distance, plan.startDistance);
    assert.equal(last.lane, plan.startLane);
    for (let step = 0; step <= 800; step++) {
      const pose = interpolateRaceTransition(plan, step / 100);
      assert.ok(Number.isFinite(pose.distance) && Number.isFinite(pose.lane));
      assert.ok(Math.abs(pose.lane) <= 9.2 + 1e-9);
      assert.ok(pose.distance <= last.distance + 1e-9, "forward motion must not reverse");
      assert.ok(Math.abs(pose.lane - last.lane) < .5, "lane movement must be continuous");
      assert.ok(pose.progress >= 0 && pose.progress <= 1);
      last = pose;
    }
    close(last.distance, plan.endDistance);
    close(last.lane, plan.endLane);
  }
});
