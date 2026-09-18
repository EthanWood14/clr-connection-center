import { test } from "node:test";
import assert from "node:assert/strict";
import { showsFieldRace, fieldStandings, cornerPosition, planTransferRaces, appendTvMoments, createTvRacePreview, racePreviewStatus, type TransferRaceEvent } from "../shared/tv-field-race";
import { planRaceTransition } from "../shared/tv-race-transition";
import type { RankRow } from "../shared/tv-overtake";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

test("every transfer gets a field race instead of 15% sampling", () => {
  for (let n = 0; n < 10000; n++) {
    assert.equal(showsFieldRace(`${n}:transfer`), true);
  }
  assert.equal(showsFieldRace(""), false);
});

const driver = (id: number, transfersToday: number): RankRow => ({ id, name: `Driver ${id}`, transfersToday });
const transfer = (id: number, userId: number, credit = 1): TransferRaceEvent => ({
  id: `${id}:transfer`, kind: "transfer", who: `Driver ${userId}`, assistantId: userId,
  raceCredits: [{ userId, credit }],
});
const count = (rows: RankRow[] | null, id: number) => rows?.find(row => row.id === id)?.transfersToday;

test("multiple transfers in one poll each replay their own true scoring step", () => {
  const before = [driver(1, 5), driver(2, 4), driver(3, 2)];
  const after = [driver(1, 5), driver(2, 6), driver(3, 3)];
  const events = [transfer(1, 2), transfer(2, 3), transfer(3, 2)];
  const races = planTransferRaces(before, after, events);
  assert.equal(races.length, 3);
  assert.deepEqual(races.map(race => race.focusId), [2, 3, 2]);
  assert.equal(count(races[0].before, 2), 4);
  assert.equal(count(races[0].people, 2), 5);
  assert.equal(count(races[1].before, 3), 2);
  assert.equal(count(races[1].people, 3), 3);
  assert.equal(count(races[2].before, 2), 5);
  assert.equal(count(races[2].people, 2), 6);
  assert.deepEqual(races[2].people, after);
  const catches = planRaceTransition(races[0].before, races[0].people, 2).find(row => row.id === 2)!;
  const passes = planRaceTransition(races[2].before, races[2].people, 2).find(row => row.id === 2)!;
  assert.deepEqual(catches.tieIds, [1]);
  assert.deepEqual(catches.passedIds, []);
  assert.deepEqual(passes.passedIds, [1]);
});

test("split credit remains in halves and does not make up a whole transfer for either car", () => {
  const event = { ...transfer(1, 2, .5), raceCredits: [{ userId: 2, credit: .5 }, { userId: 3, credit: .5 }] };
  const [race] = planTransferRaces([driver(1, 5), driver(2, 4.5), driver(3, 1)], [driver(1, 5), driver(2, 5), driver(3, 1.5)], [event]);
  assert.equal(race.focusId, 2);
  assert.equal(count(race.before, 2), 4.5);
  assert.equal(count(race.people, 2), 5);
  assert.equal(count(race.before, 3), 1);
  assert.equal(count(race.people, 3), 1.5);
});

test("polling, transfer edits, and duplicate event rows cannot queue a second race", () => {
  const before = [driver(1, 1)], after = [driver(1, 2)], first = transfer(1, 1), second = transfer(2, 1);
  assert.equal(planTransferRaces(before, after, [first, first]).length, 1);
  assert.equal(planTransferRaces(before, after, [first], new Set([first.id])).length, 0);
  const queued = [{ key: first.id, payload: "original snapshot" }];
  const incoming = [{ key: first.id, payload: "poll repeat" }, { key: second.id, payload: "new" }, { key: second.id, payload: "duplicate" }, { key: "on-screen", payload: "already started" }];
  assert.deepEqual(appendTvMoments(queued, incoming, new Set(["on-screen"])), [queued[0], incoming[1]]);
  assert.equal(queued.length, 1, "queue inputs stay immutable");
});

test("first load, day rollover and changed rosters never manufacture movement", () => {
  const after = [driver(1, 6), driver(2, 1)];
  assert.deepEqual(planTransferRaces(null, after, []), [], "the startup feed has no new events");
  for (const before of [null, [], [driver(1, 5)]]) {
    const [race] = planTransferRaces(before, after, [transfer(1, 1)]);
    assert.equal(race.before, null);
    assert.deepEqual(race.people, after);
  }
});

test("old-date edits and missing credit do not play a transfer race at all", () => {
  const before = [driver(1, 5), driver(2, 4)], after = [driver(1, 5), driver(2, 6)];
  // Empty / missing raceCredits = no transfer for today → no celebration.
  for (const event of [{ ...transfer(1, 2), raceCredits: [] }, { ...transfer(1, 2), raceCredits: undefined }]) {
    assert.deepEqual(planTransferRaces(before, after, [event]), []);
  }
  // Credit present but unexplained score change: still celebrate, without inventing a pass.
  const [race] = planTransferRaces(before, after, [transfer(1, 2)]);
  assert.deepEqual(race.before, after);
  assert.deepEqual(race.people, after);
  const [unchanged] = planTransferRaces(after, after, [transfer(1, 2)]);
  assert.deepEqual(unchanged.before, unchanged.people);
});

test("concurrent downward corrections apply before a genuine scored move", () => {
  const [race] = planTransferRaces([driver(1, 8), driver(2, 3)], [driver(1, 2), driver(2, 4)], [transfer(1, 2)]);
  assert.equal(count(race.before, 1), 2);
  assert.equal(count(race.before, 2), 3);
  assert.equal(count(race.people, 2), 4);
  assert.deepEqual(planRaceTransition(race.before, race.people, 2).find(row => row.id === 2)?.passedIds, []);
});

test("stable user identity selects the right car when names repeat", () => {
  const after = [{ ...driver(1, 5), name: "Alex" }, { ...driver(2, 4), name: "Alex" }];
  const [identified] = planTransferRaces(null, after, [{ ...transfer(1, 2), who: "Alex" }]);
  assert.equal(identified.focusId, 2);
  const [unknown] = planTransferRaces(null, after, [{ ...transfer(1, 2), who: "Alex", assistantId: undefined }]);
  assert.equal(unknown.focusId, undefined);
});

test("malformed or duplicate credits cannot move a car", () => {
  const before = [driver(1, 4)], after = [driver(1, 5)];
  // Non-positive credit never qualifies as a transfer moment.
  for (const raceCredits of [[{ userId: 1, credit: NaN }], [{ userId: 1, credit: -1 }]]) {
    assert.deepEqual(planTransferRaces(before, after, [{ ...transfer(1, 1), raceCredits }]), []);
  }
  // Credit rows that fail validation still enqueue a still celebration (no invented pass).
  for (const raceCredits of [[{ userId: 1, credit: 2 }], [{ userId: 1, credit: .5 }, { userId: 1, credit: .5 }]]) {
    const [race] = planTransferRaces(before, after, [{ ...transfer(1, 1), raceCredits }]);
    assert.deepEqual(race.before, race.people);
  }
});

test("local preview keeps the exact current roster and credit without inventing movement", () => {
  const people = [{ ...driver(1, 0), name: "Ethan Wood" }, driver(2, 4.5), driver(3, 7)];
  const before = JSON.stringify(people);
  const moment = createTvRacePreview(people, "local-race-preview:123:1", "2026-09-15T18:00:00.000Z");
  assert.equal(moment.preview, true);
  assert.equal(moment.raceBefore, null);
  assert.deepEqual(moment.fieldRace, people);
  assert.notEqual(moment.fieldRace, people, "the preview snapshots rather than owns the live roster");
  assert.equal(moment.event.borrower, "");
  assert.equal(moment.event.who, "");
  assert.equal(moment.event.id, moment.key);
  assert.equal(JSON.stringify(people), before);
  assert.equal(moment.fieldRace.some(row => row.name === "Ethan Wood"), true);
});

test("a local preview queues behind real transfers and cannot stack on rapid clicks", () => {
  const live = { type: "event", key: "1:transfer", preview: false };
  const preview = createTvRacePreview([driver(1, 0)], "local-race-preview:123:1", "now");
  const queued = [live];
  const enqueue = (current: typeof live | null, queue: (typeof live | typeof preview)[]) =>
    racePreviewStatus(current, queue) ? queue : [...queue, preview];
  const first = enqueue(live, queued);
  assert.equal(first[0], live, "a queued transfer keeps its place");
  assert.equal(first[1], preview);
  assert.equal(racePreviewStatus(live, first), "queued");
  assert.equal(enqueue(live, first), first, "the functional state update catches a second rapid click");
  assert.equal(racePreviewStatus(preview, []), "playing");
  assert.equal(racePreviewStatus(null, []), null, "control re-enables after preview completes");
});

test("manual TV cues expire and never cross organizations", () => {
  const source = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const sql = source.match(/racePlayback: sqlite\.prepare\(`([^`]+)`\)/)?.[1];
  assert.ok(sql);
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE audit_logs(id INTEGER PRIMARY KEY, org_id INTEGER, action TEXT, created_at TEXT)");
    db.exec("INSERT INTO audit_logs VALUES(1,1,'tv_race_play_now',datetime('now','-3 minutes')),(2,2,'tv_race_play_now',datetime('now'))");
    assert.equal(db.prepare(sql).get(1), undefined);
    db.exec("INSERT INTO audit_logs VALUES(3,1,'tv_race_play_now',datetime('now'))");
    assert.deepEqual(db.prepare(sql).get(1), { id: 3 });
  } finally { db.close(); }
});

test("track depth follows real gaps and ties run side by side", () => {
  const rows=fieldStandings([{id:1,name:'A',transfersToday:8},{id:2,name:'B',transfersToday:8},{id:3,name:'C',transfersToday:7.5},{id:4,name:'D',transfersToday:3}]);
  assert.equal(rows[0].depth,rows[1].depth);
  assert.equal(rows[1].rank,1);
  assert.equal(rows[2].gap,.5);
  assert.ok(rows[2].depth>rows[0].depth && rows[2].depth<rows[3].depth);
});

test("corner positions advance toward the spectator and lane offsets preserve progress", () => {
  const a=cornerPosition(.2), b=cornerPosition(.8);
  assert.ok(b.x>a.x && b.y>a.y && b.scale>a.scale && b.angle>a.angle);
  assert.equal(cornerPosition(.5,-25).angle,cornerPosition(.5,25).angle);
  assert.deepEqual(cornerPosition(-1),cornerPosition(0));
  assert.deepEqual(cornerPosition(2),cornerPosition(1));
});

test("broadcast graphics follow the actual camera and crossing instead of announcing a completed pass immediately", () => {
  const wrapper=readFileSync(new URL("../client/src/components/tv/field-race.tsx", import.meta.url),"utf8");
  assert.match(wrapper,/onShot:next=>\{if\(!cancelled\)setShot\(next\);\}/);
  assert.match(wrapper,/data-broadcast-shot=\{shot\.id\}/);
  assert.match(wrapper,/data-testid="tv-race-shot-label">\{isDayRace && clockLabel \? clockLabel : \(reduced \? shot\.label : 'TRACKSIDE VIEW'\)\}/);
  assert.match(wrapper,/stableCamera:true/, "transfer and day-race cameras stay trackside");
  assert.match(wrapper,/blendSeconds/, "day race lerps between minute credits instead of snapping");
  assert.doesNotMatch(wrapper,/snapUpdates/);
  assert.match(wrapper,/dayRaceFrameBlendSeconds/);
  assert.match(wrapper,/data-testid="tv-race-action-caption">\{caption\}/);
  assert.match(wrapper,/raceTransitionStartRank\(maneuver,maneuvers\)/);
  assert.doesNotMatch(wrapper,/MAKES THE PASS|Onboard focus|Turn 03/);
  assert.match(wrapper,/After this transfer/);
  assert.match(wrapper,/Current standings · No stats changed/);
  assert.match(wrapper,/rivalNames\.slice\(0,2\)\.join\(' · '\)/,
    "first-transfer packs cannot fill the lower third with twenty rival names");
  assert.match(wrapper,/rivalNames\.length-2/);
  assert.match(wrapper,/line-clamp-2[^\n]*\{rivalSummary\}/);
  assert.match(wrapper,/drivers\.map\(\(p,i\)=>/,
    "the compact battle caption does not remove anyone from running order");
});
