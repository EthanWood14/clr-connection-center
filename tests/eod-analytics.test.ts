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

test("EOD analytics is routed and only appears in the Team menu for managers", () => {
  assert.match(app, /import EodAnalytics/);
  assert.match(app, /<Route path="\/eod-analytics" component=\{EodAnalytics\}/);
  assert.match(sidebar, /const managerTeamItems/);
  assert.match(sidebar, /isManagerOrAdmin \? \[\.\.\.teamItems, \.\.\.managerTeamItems\] : teamItems/);
});
