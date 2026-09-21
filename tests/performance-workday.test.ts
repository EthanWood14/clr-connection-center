import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { TRANSFER_CREDIT_SQL } from "../shared/transfer-credit";
import { transferCreditExclusionSql } from "../shared/stats-exclusions";
import { isPerformanceWorkday, performanceDaysByUser, performanceDayWeight, remainingPerformancePaceDays, projectPerformanceTransfers } from "../shared/performance-workday";
import { loadPerformanceDays } from "../server/performance-workdays";
import { weeklyPace } from "../shared/weekly-pace";
import { transfersPerWorkingDay } from "../server/clr-workday-rate";
import { rollUp, weekStartOf } from "../server/agent-stats";

test("fixed July 21 boundary, split credit and exact 3600-second threshold", () => {
  assert.equal(isPerformanceWorkday("2026-07-20", 0, 0, 1), true);
  assert.equal(isPerformanceWorkday("2026-07-21", 0, 3599, 1000), false);
  assert.equal(isPerformanceWorkday("2026-07-21", .5, 0, 0), true);
  assert.equal(isPerformanceWorkday("2026-09-21", 0, 3600, 0), true);
  for (const value of [NaN, Infinity, -1, undefined]) assert.equal(isPerformanceWorkday("2026-09-21", value, value, value), false);
});

test("MTD pace uses qualified days and remaining availability, not elapsed calendar days", () => {
  const availability = { fullOffDays: new Set(["1:2026-09-29"]), halfDays: new Set(["1:2026-09-30"]) };
  assert.equal(remainingPerformancePaceDays(1, "2026-09-28", availability), .5);
  assert.equal(remainingPerformancePaceDays(2, "2026-09-28", availability), 2);
  assert.equal(remainingPerformancePaceDays(1, "2026-09-30", availability), 0);
  assert.equal(remainingPerformancePaceDays(1, "invalid", availability), 0);
  assert.equal(remainingPerformancePaceDays(1, "2026-09-26"), 3); // Sunday is not a future scheduled day.
  assert.equal(projectPerformanceTransfers(10, 2, .5), 13);
  assert.equal(projectPerformanceTransfers(10, 2, 0), 10);
  assert.equal(projectPerformanceTransfers(0, 0, 10), null);
});

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users(id INTEGER, org_id INTEGER, name TEXT);
    INSERT INTO users VALUES(1,1,'One'),(2,1,'Two'),(3,2,'Other team'),(4,1,'Departed');
    CREATE TABLE lead_outcomes(id INTEGER, org_id INTEGER, date TEXT, assistant_id INTEGER,
      shotgun_sender_id INTEGER, lo_id INTEGER, loa_id INTEGER, outcome_type TEXT);
    CREATE TABLE time_off_requests(org_id INTEGER, user_id INTEGER, status TEXT, day_portion TEXT, start_date TEXT, end_date TEXT);
    CREATE TABLE daily_call_logs(org_id INTEGER, assistant_id INTEGER, log_date TEXT, calls_made INTEGER);
    CREATE TABLE dialpad_daily_stats(org_id INTEGER, user_id INTEGER, stat_date TEXT, calls INTEGER);
    CREATE TABLE bonzo_call_events(org_id INTEGER, user_id INTEGER, business_date TEXT, prospect_id INTEGER, occurred_at TEXT, counts INTEGER);
    CREATE TABLE callsync_activity_events(org_id INTEGER, assistant_id INTEGER, activity_date TEXT, call_id TEXT, external_event_id TEXT);
    CREATE TABLE callsync_agent_activity_daily(org_id INTEGER, assistant_id INTEGER, activity_date TEXT, active_seconds INTEGER);
    INSERT INTO lead_outcomes VALUES(1,1,'2026-09-14',1,2,1,NULL,'transfer'),
      (2,1,'2026-09-15',1,NULL,1,NULL,'appointment'),(3,2,'2026-09-16',1,NULL,1,NULL,'transfer'),
      (4,1,'2026-09-17',3,NULL,1,NULL,'transfer'),(5,1,'2026-09-18',4,NULL,1,NULL,'transfer');
    INSERT INTO callsync_agent_activity_daily VALUES(1,1,'2026-09-16',3600),(1,1,'2026-09-17',3599),(2,1,'2026-09-18',8000);
    INSERT INTO daily_call_logs VALUES(1,1,'2026-07-20',1),(1,1,'2026-07-21',999);
    INSERT INTO dialpad_daily_stats VALUES(1,1,'2026-09-15',500);
  `);
  return db;
}

test("daily SQL is org-scoped, includes split sender/time-only/departed days, excludes appointment/calls-only days", () => {
  const db = fixture();
  const rows = loadPerformanceDays(db, 1);
  assert.deepEqual(rows.map(r => [r.userId, r.date]), [
    [1,"2026-07-20"], [1,"2026-09-14"], [2,"2026-09-14"], [1,"2026-09-16"], [4,"2026-09-18"],
  ]);
  assert.equal(rows.find(r => r.userId === 2)?.transfers, .5);
  assert.equal(rows.find(r => r.date === "2026-09-16")?.callToolsActiveSeconds, 3600);
  assert.throws(() => loadPerformanceDays(db, 0));
  db.close();
});

test("full off beats real activity; half days retain credit and halve the denominator; duplicate dates never count twice", () => {
  const db = fixture();
  const rows = loadPerformanceDays(db, 1, "2026-09-01", "2026-09-30");
  const availability = { halfDays: new Set(["1:2026-09-14"]), fullOffDays: new Set(["1:2026-09-16"]), excludedDays: new Set(["4:2026-09-18"]) };
  const days = performanceDaysByUser([...rows, ...rows], availability);
  assert.equal(days.get(1), .5);
  assert.equal(days.get(2), 1);
  assert.equal(days.has(4), false);
  assert.equal(.5 / days.get(1)!, 1);
  db.close();
});

test("hourly time is daily cumulative, not the sum of per-call activity or copied EOD snapshots", () => {
  const db = fixture();
  db.exec(`INSERT INTO callsync_activity_events VALUES(1,2,'2026-09-21','a','a'),(1,2,'2026-09-21','a','b');
    INSERT INTO callsync_agent_activity_daily VALUES(1,2,'2026-09-21',1800);`);
  assert.deepEqual(loadPerformanceDays(db, 1, "2026-09-21", "2026-09-21"), []);
  db.exec(`UPDATE callsync_agent_activity_daily SET active_seconds=3600 WHERE assistant_id=2`);
  const rows = loadPerformanceDays(db, 1, "2026-09-21", "2026-09-21");
  assert.equal(rows[0].calls, 1);
  assert.equal(performanceDayWeight(rows[0]), 1);
  db.close();
});

test("manager scorecard never restores a full-off transfer from its raw outcome count", () => {
  const db = fixture();
  db.exec("INSERT INTO time_off_requests VALUES(1,1,'approved','full','2026-09-14','2026-09-14')");
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const start = routes.indexOf("const lbOutcomes = sqlite.prepare");
  const source = routes.slice(start, routes.indexOf("const lbCalls =", start));
  const code = transformSync(source, { loader: "ts", target: "es2022" }).code;
  const calculate = new Function("sqlite", "TRANSFER_CREDIT_SQL", "transferCreditExclusionSql", "startDate", "endDate", "exClause", "exClauseTc",
    code + "\nreturn lbByUser;");
  const totals = calculate(db, TRANSFER_CREDIT_SQL, transferCreditExclusionSql, "2026-09-14", "2026-09-14",
    " AND org_id=1", " AND tc.org_id=1");
  assert.equal(totals[1].transfers, 0, "full-off maker must stay excluded");
  assert.equal(totals[2].transfers, .5, "eligible sender keeps split credit");
  db.close();
});

test("TV pace includes zero-transfer hour days and does not apply an extra today half-day discount", () => {
  const days = [{ userId:1,date:"2026-07-01" }, { userId:2,date:"2026-07-01" }];
  const qualifiedDays = [{ userId:1,date:"2026-09-21" }, { userId:2,date:"2026-09-21" }];
  const [week] = weeklyPace({ days, qualifiedDays: [...qualifiedDays, qualifiedDays[0]],
    credits:[{userId:1,date:"2026-09-21",credit:3}], today:"2026-09-21", weeks:1,
    halfDays:new Set(["1:2026-09-21"]) });
  assert.equal(week.clrDays,1.5);
  assert.equal(week.clrs,2);
  assert.equal(week.perClrPerDay,2);
});

test("normal-workday rates qualify performance without restarting the training clock", () => {
  const result = transfersPerWorkingDay({ activeDates:["2026-09-14","2026-09-15","2026-09-16","2026-09-17"],
    qualifyingDates:new Set(["2026-09-16"]), trainerDates:new Set(),
    transferDates:["2026-09-16"], threshold:2, minDays:1 });
  assert.equal(result.trainingDays,2);
  assert.equal(result.workingDays,1);
  assert.equal(result.ratePerWorkingDay,1);
});

test("reporting feed uses qualified days including a zero-transfer hour day", () => {
  const [row] = rollUp([{date:"2026-09-14",assistantId:1,outcomeType:"transfer"},
    {date:"2026-09-15",assistantId:1,outcomeType:"appointment"}], weekStartOf,null,()=>true,null,null,
    [{userId:1,date:"2026-09-14"},{userId:2,date:"2026-09-16"}]);
  assert.equal(row.clrDays,2);
  assert.equal(row.avgPerClrDay,.5);
});

test("every live performance consumer is wired; attendance and payroll do not import the qualifier", () => {
  const routes = readFileSync(new URL("../server/routes.ts",import.meta.url),"utf8");
  assert.match(routes,/workedDaysByUser = performanceDaysByUser\(loadPerformanceDays/);
  assert.match(routes,/workdayWeights: clrTrendDates.map/);
  assert.match(routes,/workedDays: performanceWorkedDays.get/);
  assert.match(routes,/qualifiedDays: loadPerformanceDays/);
  assert.match(routes,/qualifyingDates: new Set\(qualifyingDays/);
  assert.match(routes,/availability, creditExcludedKeys, qualifiedDays/);
  assert.doesNotMatch(readFileSync(new URL("../server/comp-floor.ts",import.meta.url),"utf8"),/loadPerformanceDays|isPerformanceWorkday/);
  assert.doesNotMatch(readFileSync(new URL("../server/clr-training-status.ts",import.meta.url),"utf8"),/loadPerformanceDays|isPerformanceWorkday/);
});
