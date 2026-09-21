import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";
import Database from "better-sqlite3";
import { CLR_TREND_WORKDAY_CUTOFF, isClrTrendWorkday } from "../client/src/lib/clr-trend-workday";
import { isWeekday } from "../client/src/lib/weekday-date";
import { performanceDayWeight, PERFORMANCE_WORKDAY_DESCRIPTION } from "../shared/performance-workday";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("a CLR who did not work is excluded from that day's average", () => {
  const block = dash.slice(dash.indexOf("let teamSum = 0"), dash.indexOf("row.__worked"));
  assert.match(block, /if \(weight <= 0\) \{ teamAbsent\+\+; continue; \}/);
  assert.match(block, /s.workdayWeights\?\.\[i\]/);
  assert.match(block, /s\.callToolsActiveSeconds\?\.\[i\] \?\? 0/);
  assert.match(block, /s\.calls\?\.\[i\] \?\? 0/, "historical days retain their per-day call counts");
  // The divisor must be the working count, not the roster size.
  assert.match(dash, /row\.__mean = teamN > 0 \? teamSum \/ teamN : 0;/);
  assert.match(dash, /teamN \+= weight;/);
});

test("the metric averaged is still the selected one", () => {
  const block = dash.slice(dash.indexOf("let teamSum = 0"), dash.indexOf("row.__worked"));
  // Transfers/CallTools time qualify the day independently of the selected metric.
  assert.match(block, /const arr = \(s as any\)\[clrTrendMetric\] as number\[\];/);
  assert.match(block, /teamSum \+= arr\[i\] \?\? 0;/);
});

test("a day nobody worked does not drag the rolling window", () => {
  const roll = dash.slice(dash.indexOf("const clrTrendChartData"), dash.indexOf("// Stable color palette"));
  assert.match(roll, /if \(\(clrTrendRows\[j\]\.__worked \?\? 0\) === 0\) continue;/,
    "a closed day has no mean to contribute and must be skipped, not averaged as 0");
  assert.match(roll, /cnt > 0 \? Math\.round\(\(acc \/ cnt\) \* 100\) \/ 100 : 0/);
});

test("the chart says what the average is over", () => {
  assert.match(dash, /Avg per non-training working CLR/, "the legend must identify the eligible working group");
  assert.match(dash, /labelFormatter=/, "the tooltip must show how many were working");
  assert.match(dash, /\$\{worked\} working-day portions averaged/);
  assert.match(dash, /in training excluded/);
  assert.match(dash, /off \/ below threshold/);
  assert.match(PERFORMANCE_WORKDAY_DESCRIPTION, /at least 1 hour of CallTools active time/);
  assert.match(PERFORMANCE_WORKDAY_DESCRIPTION, /before July 21, 2026, calls or a transfer/);
});

test("a transfer OR a full hour qualifies, including split credit and the exact threshold", () => {
  assert.equal(isClrTrendWorkday("2026-09-21", 0, 0, 500), false);
  assert.equal(isClrTrendWorkday("2026-09-21", 0, 3599, 500), false);
  assert.equal(isClrTrendWorkday("2026-09-21", 0, 3599.99, 500), false);
  assert.equal(isClrTrendWorkday("2026-09-21", 0, 3600, 0), true);
  assert.equal(isClrTrendWorkday("2026-09-21", 0, 14400, 0), true);
  assert.equal(isClrTrendWorkday("2026-09-21", 1, 0, 0), true);
  assert.equal(isClrTrendWorkday("2026-09-21", 0.5, 0, 0), true, "a split transfer is real transfer activity");
  assert.equal(isClrTrendWorkday("2026-09-21", 1, 3600, 0), true);
});

test("missing or invalid time cannot invent a worked day", () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) {
    assert.equal(isClrTrendWorkday("2026-09-21", 0, value, 500), false);
    assert.equal(isClrTrendWorkday("2026-09-21", value, 0, 500), false);
    assert.equal(isClrTrendWorkday("2026-09-21", 1, value, 0), true);
    assert.equal(isClrTrendWorkday("2026-09-21", value, 3600, 0), true);
    assert.equal(isClrTrendWorkday("2026-07-20", 0, 3600, value), false);
  }
});

test("the new rule starts inclusively on the fixed July 21 cutoff, preserving earlier calls-or-transfers history", () => {
  assert.equal(CLR_TREND_WORKDAY_CUTOFF, "2026-07-21");
  for (const date of ["2025-09-21", "2026-07-20"]) {
    assert.equal(isClrTrendWorkday(date, 0, 0, 1), true);
    assert.equal(isClrTrendWorkday(date, 0.5, 0, 0), true);
    assert.equal(isClrTrendWorkday(date, 0, 3600, 0), false, "time alone did not qualify under the previous rule");
    assert.equal(isClrTrendWorkday(date, 0, 0, 0), false);
  }
  for (const date of ["2026-07-21", "2026-07-22", "2027-01-01"]) {
    assert.equal(isClrTrendWorkday(date, 0, 3599, 500), false);
    assert.equal(isClrTrendWorkday(date, 0, 3600, 0), true);
    assert.equal(isClrTrendWorkday(date, 0.5, 0, 0), true);
    assert.equal(isClrTrendWorkday(date, 0, 0, 0), false);
  }
});

// Execute the shipped chart calculation, not a duplicate implementation.
function chart(series: any[], dates: string[], metric = "transfers", window = 5) {
  const code = dash.slice(dash.indexOf("const clrTrendRows ="), dash.indexOf("// Stable color palette"));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const scope: Record<string, any> = {
    clrTrendSeries: series, clrTrendDates: dates, clrTrendMetric: metric, clrTrendAvgWindow: window,
    effectiveSelected: [1], isWeekday, parseISO: (date: string) => date, format: (date: string) => date,
    isClrTrendWorkday,
  };
  return new Function(...Object.keys(scope), js + "\nreturn clrTrendChartData;")(...Object.values(scope));
}

test("the actual chart uses each day's policy across the cutoff, not today's date or the range start", () => {
  const dates = ["2026-07-20", "2026-07-21", "2026-07-22"];
  const series = [
    { userId: 1, transfers: [4, 4, 4], calls: [0, 0, 0], callToolsActiveSeconds: [0, 0, 0] },
    { userId: 2, transfers: [0, 0, 0], calls: [10, 10, 10], callToolsActiveSeconds: [3599, 3599, 3599] },
    { userId: 3, transfers: [0, 0, 0], calls: [0, 0, 0], callToolsActiveSeconds: [0, 0, 3600] },
  ];
  const rows = chart(series, dates);
  assert.deepEqual(rows.map((r: any) => r.__worked), [2, 1, 2]);
  assert.deepEqual(rows.map((r: any) => r.__mean), [2, 4, 2]);
  assert.deepEqual(rows.map((r: any) => r.__avg), [2, 3, 2.67]);
  const oneDay = (i: number) => chart(series.map(s => ({
    ...s, transfers: [s.transfers[i]], calls: [s.calls[i]], callToolsActiveSeconds: [s.callToolsActiveSeconds[i]],
  })), [dates[i]])[0];
  assert.equal(oneDay(0).__mean, rows[0].__mean, "older-only ranges keep their original denominator");
  assert.equal(oneDay(1).__mean, rows[1].__mean, "starting the range on the cutoff does not change the policy");
});

test("the actual chart includes qualified zero-transfer days but excludes calls-only days", () => {
  const series = [
    { userId: 1, transfers: [4], calls: [5], callToolsActiveSeconds: [0] },
    { userId: 2, transfers: [0], calls: [0], callToolsActiveSeconds: [3600] },
    { userId: 3, transfers: [0], calls: [500], callToolsActiveSeconds: [3599] },
    { userId: 4, transfers: [0], calls: [100], appointments: [2], messages: [100] },
    { userId: 5, transfers: [10], calls: [20], callToolsActiveSeconds: [14400], inTraining: true },
    { userId: 6, transfers: [0.5], calls: [2], callToolsActiveSeconds: [0] },
  ];
  const [row] = chart(series, ["2026-09-14"]);
  assert.equal(row.__worked, 3);
  assert.equal(row.__absent, 2);
  assert.equal(row.__trainingExcluded, 1);
  assert.equal(row.__mean, 1.5);
  assert.equal(row.__avg, 1.5);
  assert.equal(row.u1, 4);
  assert.equal(row.u2, undefined, "hiding a line does not remove that CLR from the team average");
  assert.equal(chart(series, ["2026-09-14"], "calls")[0].__avg, 2.33);
});

test("qualification is per date; excluded days do not contribute zeroes to the rolling average", () => {
  const rows = chart([
    { userId: 1, transfers: [2, 0, 0, 100], calls: [0, 99, 99, 0], callToolsActiveSeconds: [0, 3599, 3600, 0] },
  ], ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-19"]);
  assert.equal(rows.length, 3, "weekends remain excluded");
  assert.deepEqual(rows.map((r: any) => r.__worked), [1, 0, 1]);
  assert.deepEqual(rows.map((r: any) => r.__avg), [2, 2, 1]);
});

test("daily active-time SQL uses cumulative agent time, scoped by organization, date and excluded CLRs", () => {
  const match = routes.match(/const clrCallToolsActiveRows = sqlite\.prepare\(`([\s\S]*?)`\)\.all\(currentOrgId\(\) \?\? 1, startDate, endDate\) as any\[\];/);
  assert.ok(match, "daily active-time query is wired to the current organization");
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE callsync_agent_activity_daily (org_id INTEGER, assistant_id INTEGER, activity_date TEXT, active_seconds INTEGER);
      INSERT INTO callsync_agent_activity_daily VALUES
        (1, 1, '2026-09-14', 3600), (1, 1, '2026-09-15', 3599),
        (1, 2, '2026-09-14', 7200), (2, 1, '2026-09-14', 99999),
        (1, 1, '2026-09-13', 88888), (1, 1, '2026-09-16', 77777);`);
    const sql = match[1].replace("${exClause}", " AND assistant_id NOT IN (2)");
    assert.deepEqual(db.prepare(sql).all(1, "2026-09-14", "2026-09-15"), [
      { assistant_id: 1, date: "2026-09-14", active_seconds: 3600 },
      { assistant_id: 1, date: "2026-09-15", active_seconds: 3599 },
    ]);
  } finally { db.close(); }
});

test("the actual server series keeps time-only historical CLRs and aligns daily seconds with the date axis", () => {
  const code = routes.slice(routes.indexOf("const clrTrendDates:"), routes.indexOf("// Outcome activity heatmap (CLR × day)"));
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const scope: Record<string, any> = {
    trend: [{ date: "2026-09-14" }, { date: "2026-09-15" }],
    clrOutcomeRows: [], clrCallRows: [], clrCallToolsRows: [],
    clrCallToolsActiveRows: [{ assistant_id: 1, date: "2026-09-15", active_seconds: 3600 }],
    historicalClrs: [{ id: 1, name: "Former CLR", isActive: false }, { id: 2, name: "Active CLR", isActive: true }],
    trainingByUser: new Map(), trainingForUser: () => ({ activeWorkdays: 30, inTraining: false }),
    performanceDayWeight, workdayAvailability: {},
  };
  const result = new Function(...Object.keys(scope), js + "\nreturn clrTrend;")(...Object.values(scope));
  assert.equal(result.series.length, 2);
  assert.deepEqual(result.series[0].callToolsActiveSeconds, [0, 3600]);
  assert.deepEqual(result.series[1].callToolsActiveSeconds, [0, 0]);
  assert.deepEqual(result.series[0].transfers, [0, 0]);
  assert.deepEqual(chart(result.series, result.dates).map((r: any) => r.__worked), [0, 1]);
});
