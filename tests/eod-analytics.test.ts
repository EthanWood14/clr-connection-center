import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/eod-analytics.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const sidebar = readFileSync(join(root, "client/src/components/app-sidebar.tsx"), "utf8");

test("EOD analytics is organization-scoped and manager-only", () => {
  const endpoint = routes.slice(routes.indexOf("app.get('/api/eod-reports/analytics'"), routes.indexOf("// History: all past EOD reports"));
  assert.match(endpoint, /requireManagerOrAdmin\(req, res\)/);
  assert.match(endpoint, /const orgId = Number\(req\.session_user\?\.orgId/);
  assert.match(endpoint, /WHERE u\.org_id=\?/);
  assert.match(endpoint, /CLR not found/);
});

test("expected EOD reports respect schedules, start dates, time off, and the deadline", () => {
  const endpoint = routes.slice(routes.indexOf("app.get('/api/eod-reports/analytics'"), routes.indexOf("// History: all past EOD reports"));
  assert.match(endpoint, /week_start='standing'/);
  assert.match(endpoint, /status='approved'/);
  assert.match(endpoint, /start_date \?\? user\.created_at/);
  assert.match(endpoint, /eodIsOverdue\(date, tz\)/);
  assert.match(endpoint, /return !away/);
});

test("the manager page exposes trends, CLR patterns, compliance, and report drill-down", () => {
  for (const label of ["Team trend", "What needs attention", "CLR patterns", "Daily checklist compliance", "Activity by day", "Report explorer"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /CallTools convos/);
  assert.match(page, /Dialpad calls/);
  assert.match(page, /Additional activity log/);
  assert.match(page, /Last 7 days/);
  assert.match(page, /Last 30 days/);
  assert.match(page, /Last 90 days/);
});

test("the manager page turns accountability counts into exact, actionable dates", () => {
  const endpoint = routes.slice(routes.indexOf("app.get('/api/eod-reports/analytics'"), routes.indexOf("// History: all past EOD reports"));
  assert.match(endpoint, /missingDates: expectedDates\.filter/);
  assert.match(endpoint, /lateDates: reports\.filter/);
  assert.match(page, /Accountability queue/);
  assert.match(page, /Exact missing and late report dates/);
  assert.match(page, /focusClr\(clr\.userId\)/);
});

test("filters stay useful while focused on one CLR and support historical end dates", () => {
  const endpoint = routes.slice(routes.indexOf("app.get('/api/eod-reports/analytics'"), routes.indexOf("// History: all past EOD reports"));
  assert.match(endpoint, /roster: roster\.map/);
  assert.match(page, /data\?\.roster/);
  assert.match(page, /data-testid="eod-as-of-date"/);
  assert.match(page, /&to=\$\{asOf\}/);
  assert.match(page, /Return to whole team/);
});

test("report review is searchable, filterable, sortable, exportable, and mobile friendly", () => {
  for (const label of ["Late only", "On time only", "Checklist gaps", "Most transfers", "Most conversations", "Export CSV", "View exact day-by-day numbers"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /data-testid="eod-clr-mobile-cards"/);
  assert.match(page, /text\/csv;charset=utf-8/);
  assert.match(page, /eod-analytics-\$\{data\.window\.from\}-to-\$\{data\.window\.to\}\.csv/);
  assert.match(page, /\^\[=\+\\-@\]/, "user-entered notes must not become spreadsheet formulas");
});

test("EOD analytics is routed and only appears in the Team menu for managers", () => {
  // Wired into App.tsx — statically or lazily. Pages became lazy on 2026-08-28
  // to cut the entry bundle, so pinning the import STYLE here would fail for a
  // change that does not affect whether the page is routed.
  assert.match(app, /EodAnalytics = lazy\(\(\) => import\("@\/pages\/eod-analytics"\)\)|import EodAnalytics from "@\/pages\/eod-analytics"/);
  assert.match(app, /<Route path="\/eod-analytics" component=\{EodAnalytics\}/);
  assert.match(sidebar, /const managerTeamItems/);
  assert.match(sidebar, /isManagerOrAdmin \? \[\.\.\.teamItems, \.\.\.managerTeamItems\] : teamItems/);
});
