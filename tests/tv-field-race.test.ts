import { test } from "node:test";
import assert from "node:assert/strict";
import { showsFieldRace, fieldStandings, cornerPosition } from "../shared/tv-field-race";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

test("field-race selection stays stable and samples approximately 15%", () => {
  let picked = 0;
  for (let n = 0; n < 10000; n++) {
    const id = `transfer:${n}`;
    assert.equal(showsFieldRace(id), showsFieldRace(id));
    if (showsFieldRace(id)) picked++;
  }
  assert.ok(picked > 1300 && picked < 1700, String(picked));
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
