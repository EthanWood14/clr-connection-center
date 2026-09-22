import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import ts from "typescript";
import { loadScorecardSchedules } from "../server/scorecard-schedule";
import { scorecardScheduleDate, scorecardScheduleStatus, scheduleDateLabel, type ScorecardScheduleKind } from "../shared/scorecard-schedule";
import { buildDemoManagerDashboard } from "../server/demo-manager-dashboard";

const DATE = "2026-09-22";
function fixture() {
  const db = new Database(":memory:");
  // Private reason/document columns deliberately do not exist: the loader
  // must work without reading them, and never import/open application storage.
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, org_id INTEGER, name TEXT, portal TEXT, is_active INTEGER);
    INSERT INTO users VALUES (1,1,'Sample CLR',NULL,1),(2,1,'Matthew Rosas','c3',1),
      (3,1,'Former CLR',NULL,0),(4,2,'Other organization',NULL,1),(5,1,'Outside LOA','lap',1),
      (6,1,'Outside LO','lop',1),(7,1,'Other portal','unexpected',1);
    CREATE TABLE time_off_requests(org_id INTEGER,user_id INTEGER,start_date TEXT,end_date TEXT,status TEXT,day_portion TEXT,leave_kind TEXT);
    CREATE TABLE attendance_excuse_requests(org_id INTEGER,subject_id INTEGER,subject_type TEXT,kind TEXT,status TEXT,hide_from_digest INTEGER,attendance_date TEXT);
  `);
  const leave = (id = 1, portion = "full", kind = "pto", status = "approved", start = DATE, end = DATE, org = 1) =>
    db.prepare("INSERT INTO time_off_requests VALUES(?,?,?,?,?,?,?)").run(org, id, start, end, status, portion, kind);
  const excuse = (id = 1, status = "approved", hidden: number | null = 0, kind = "absence", type = "user", org = 1, date = DATE) =>
    db.prepare("INSERT INTO attendance_excuse_requests VALUES(?,?,?,?,?,?,?)").run(org, id, type, kind, status, hidden, date);
  return { db, leave, excuse, read: (date = DATE, org = 1) => loadScorecardSchedules(db, org, date) };
}

test("weekday schedule defaults to full, standing half days persist, and former staff are not scheduled", () => {
  const f = fixture();
  try {
    const result = f.read();
    assert.deepEqual([...result.keys()], [1, 2, 3]);
    assert.equal(result.get(1)?.label, "Full day");
    assert.match(result.get(1)!.detail, /does not confirm attendance/);
    assert.equal(result.get(2)?.label, "Half day");
    assert.equal(result.get(3)?.label, "Inactive");
    f.leave(3);
    assert.equal(f.read().get(3)?.kind, "inactive");
  } finally { f.db.close(); }
});

test("only approved leave overlapping the exact date supplies a schedule tag", () => {
  const f = fixture();
  try {
    for (const status of ["pending", "rejected", "denied", "cancelled"]) f.leave(1, "half", "half", status);
    f.leave(1, "full", "pto", "approved", "2026-09-20", "2026-09-21");
    f.leave(1, "full", "pto", "approved", "2026-09-23", "2026-09-25");
    assert.equal(f.read().get(1)?.kind, "full");
    f.leave(1, "half", "half", "approved", "2026-09-21", "2026-09-22");
    assert.equal(f.read().get(1)?.kind, "half");
    f.db.prepare("UPDATE time_off_requests SET status='denied' WHERE status='approved'").run();
    assert.equal(f.read().get(1)?.kind, "full", "revoked approval must not leave a stale tag");
  } finally { f.db.close(); }
});

test("full PTO wins over both standing and approved halves regardless of row order", () => {
  for (const reverse of [false, true]) {
    const f = fixture();
    try {
      for (const portion of reverse ? ["full", "half"] : ["half", "full"]) f.leave(2, portion, portion === "half" ? "half" : "pto");
      assert.equal(f.read().get(2)?.label, "Time off");
    } finally { f.db.close(); }
  }
});

test("sick labels never disclose documented versus undocumented or medical reasons", () => {
  const outputs: any[] = [];
  for (const kind of ["sick_documented", "sick_undocumented", "sick"]) {
    const f = fixture();
    try {
      f.leave(1, "full", kind);
      const status = f.read().get(1)!;
      outputs.push(status);
      assert.deepEqual(Object.keys(status).sort(), ["date", "detail", "kind", "label"]);
      assert.equal(status.label, "Sick");
      assert.doesNotMatch(JSON.stringify(status), /documented|medical|reason|reviewer/i);
    } finally { f.db.close(); }
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[1], outputs[2]);
});

test("half-day sick leave is explicit, while full leave still overrides it", () => {
  const f = fixture();
  try {
    f.leave(1, "half_day", "sick_documented");
    assert.equal(f.read().get(1)?.label, "Sick · half day");
    f.leave(1, "full", "pto");
    assert.equal(f.read().get(1)?.label, "Time off");
    f.leave(1, "full", "sick_undocumented");
    assert.equal(f.read().get(1)?.label, "Sick");
  } finally { f.db.close(); }
});

test("excused absence is approved, visible, exact-date only; hidden and late excuses do not imply time off", () => {
  const f = fixture();
  try {
    f.excuse(1, "pending"); f.excuse(1, "denied"); f.excuse(1, "approved", 1);
    f.excuse(1, "approved", 0, "late"); f.excuse(1, "approved", 0, "absence", "loan_officer");
    f.excuse(1, "approved", 0, "absence", "user", 1, "2026-09-21");
    assert.equal(f.read().get(1)?.kind, "full");
    f.excuse(1, "approved", null);
    assert.equal(f.read().get(1)?.label, "Excused absence");
    f.leave(1, "full", "sick");
    assert.equal(f.read().get(1)?.label, "Sick");
  } finally { f.db.close(); }
});

test("organization and portal boundaries apply even to broken cross-organization references", () => {
  const f = fixture();
  try {
    f.leave(1, "full", "sick", "approved", DATE, DATE, 2);
    f.excuse(1, "approved", 0, "absence", "user", 2);
    for (const id of [4, 5, 6, 7]) { f.leave(id); f.excuse(id); }
    assert.equal(f.read().get(1)?.kind, "full");
    assert.deepEqual([...f.read().keys()], [1, 2, 3]);
    const other = f.read(DATE, 2);
    assert.deepEqual([...other.keys()], [4]);
    assert.equal(other.get(4)?.kind, "full");
  } finally { f.db.close(); }
});

test("weekends and company holidays do not silently imply a standard full or standing half day", () => {
  const f = fixture();
  try {
    for (const id of [1, 2]) {
      assert.equal(f.read("2026-09-20").get(id)?.kind, "weekend");
      assert.equal(f.read("2026-09-07").get(id)?.kind, "holiday");
    }
    f.leave(1, "full", "pto", "approved", "2026-09-20", "2026-09-20");
    assert.equal(f.read("2026-09-20").get(1)?.kind, "time_off");
  } finally { f.db.close(); }
});

test("loader rejects malformed context and performs only three read-only queries", () => {
  const f = fixture();
  try {
    for (const org of [0, -1, 1.5, NaN]) assert.throws(() => f.read(DATE, org));
    for (const date of ["2026-02-30", "bad", "2026-9-22", "2026-09-22T00:00:00Z"]) assert.throws(() => f.read(date));
    const statements: string[] = [];
    loadScorecardSchedules({ prepare: (sql: string) => {
      statements.push(sql); assert.match(sql.trim(), /^SELECT /); return f.db.prepare(sql);
    } }, 1, DATE);
    assert.equal(statements.length, 3);
    assert.doesNotMatch(statements.join("\n"), /\breason\b|reviewer|document|email|SELECT \*/i);
    f.db.exec("DROP TABLE time_off_requests");
    assert.throws(() => f.read(), "incomplete reads must not report a default Full day");
  } finally { f.db.close(); }
});

test("schedule date follows Pacific calendar midnight, not reporting rollover, in summer and winter", () => {
  for (const [iso, expected] of [
    ["2026-09-23T02:30:00Z", "2026-09-22"], ["2026-09-23T06:59:59Z", "2026-09-22"],
    ["2026-09-23T07:00:00Z", "2026-09-23"], ["2026-12-23T07:59:59Z", "2026-12-22"],
    ["2026-12-23T08:00:00Z", "2026-12-23"],
  ]) assert.equal(scorecardScheduleDate(new Date(iso)), expected);
  assert.equal(scheduleDateLabel(DATE), "Sep 22");
});

test("actual badge shows generic text, dated accessible detail, and nothing for old payloads", () => {
  const source = readFileSync(new URL("../client/src/components/clr-schedule-badge.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: any = {};
  const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }) };
  new Function("require", "exports", "React", js)(() => ({ Badge: "Badge" }), exports, React);
  assert.equal(exports.ClrScheduleBadge({}), null);
  for (const kind of ["full", "half", "sick", "time_off", "excused", "holiday", "weekend", "inactive", "unknown"] as ScorecardScheduleKind[]) {
    const status = scorecardScheduleStatus(DATE, kind);
    const view = exports.ClrScheduleBadge({ status });
    assert.deepEqual(view.children, [status.label]);
    assert.match(view.props.title, /2026-09-22 \(Pacific\)/);
    assert.equal(view.props["aria-label"], view.props.title);
    assert.match(view.props.className, /text-\[10px\]/);
    assert.match(view.props.className, /dark:/);
  }
});

test("all demo ranges show the same explicitly supplied schedule date without changing metrics", () => {
  const demo = buildDemoManagerDashboard("2026-09-23", DATE);
  assert.equal(demo.scheduleDate, DATE);
  const expected = demo.byRange.today.leaderboard.map(r => r.scheduleStatus);
  assert.deepEqual(expected.map(s => s.label), ["Full day", "Half day", "Sick", "Time off", "Full day"]);
  for (const range of Object.values(demo.byRange)) assert.deepEqual(range.leaderboard.map(r => r.scheduleStatus), expected);
  assert.equal(demo.demo, true);
});

test("fast/full dashboard wiring uses the same schedule date, invalidates across midnight, and fails visibly", () => {
  const source = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.get("/api/manager-dashboard"');
  const route = source.slice(start, source.indexOf("    res.json(payload);", start));
  assert.match(route, /const scheduleDate = scorecardScheduleDate\(\)/);
  assert.match(route, /hit.body.scheduleDate === scheduleDate/);
  assert.match(route, /loadScorecardSchedules\(storageExtra.getRawSqlite\(\), reportOrgId, scheduleDate\)/);
  assert.match(route, /scheduleStatus: scheduleByUser.get\(Number\(u.id\)\) \?\? scorecardScheduleStatus\(scheduleDate, "unknown"\)/);
  assert.ok(route.indexOf("scheduleByUser = loadScorecardSchedules") < route.indexOf("const payload ="));
  const page = readFileSync(new URL("../client/src/pages/manager-dashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /Schedule tags: \{scheduleDateLabel\(data.scheduleDate\)\} \(Pacific\)/);
  assert.match(page, /today's schedule, not days worked in the selected range/);
});
