import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Line endings normalised: a checkout can be CRLF on this machine, and the
// slices below look for "\n  }\n".
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");
const eodPage = read("client/src/pages/eod-report.tsx");

/**
 * The bug: the Dialpad calls tile on the EOD report read the last HOURLY
 * snapshot (cron at :15), while LeadVault is ~2 minutes behind the phone. A
 * CLR who dialled at 9:20 saw nothing until 10:15, and the report filed at
 * 5pm carried whatever the last pull had seen. Today's count is now pulled
 * live — throttled — on the three places that read it. Past days stay as
 * stored: they are settled.
 */

function handler(routePattern: RegExp, endMarker: string): string {
  const start = routes.search(routePattern);
  assert.ok(start >= 0, `route not found: ${routePattern}`);
  const rest = routes.slice(start);
  const end = rest.indexOf(endMarker);
  assert.ok(end > 0, `end marker not found after ${routePattern}: ${endMarker}`);
  return rest.slice(0, end);
}

test("there is one throttled live refresh, and it reuses the cron's own sync under the org context", () => {
  assert.match(routes, /async function refreshDialpadStatsIfStale\(orgId: number\)/);
  assert.match(routes, /const LIVE_DIALPAD_MIN_INTERVAL_MS = 60_000;/);
  const body = routes.slice(routes.indexOf("async function refreshDialpadStatsIfStale"));
  const close = body.indexOf("\n  }\n");
  assert.ok(close > 0, "function close not found");
  const fn = body.slice(0, close + 5);
  assert.match(fn, /liveDialpadRefreshedAt\.(get|set)\(orgId/);
  assert.match(fn, /runWithOrg\(\{ orgId, superAdmin: false \}, \(\) => syncDialpadStats\(orgId\)\)/);
  // Silent on failure: the stored row is still the best answer there is.
  assert.match(fn, /catch \(e: any\)/);
});

test("the EOD report read pulls today live before reading the Dialpad row, and leaves other days alone", () => {
  const get = handler(/app\.get\('\/api\/eod-reports', requireAuth, async \(req: any, res\) => \{/, "res.json({ report, activities, callToolsActivity, dialpadActivity, bonzoActivity });");
  const refresh = get.indexOf("await refreshDialpadStatsIfStale(");
  const read = get.indexOf("const dialpadHit = storageExtra.getDialpadCallsFor(");
  assert.ok(refresh > 0 && read > refresh, "refresh must run before the read");
  assert.match(get, /if \(date === businessTodayForRequest\(req, storageExtra\.getRawSqlite\(\)\)\) \{\s*\n\s*await refreshDialpadStatsIfStale\(/);
});

test("filing today's report refreshes first, so the snapshot on the report is the real count", () => {
  const post = handler(/app\.post\('\/api\/eod-reports', requireAuth, async \(req: any, res\) => \{/, "const report = storageExtra.upsertEodReport({");
  assert.match(post, /if \(reportDate === businessTodayForRequest\(req, storageExtra\.getRawSqlite\(\)\)\) \{\s*\n\s*await refreshDialpadStatsIfStale\(/);
});

test("the direct my-calls read does the same", () => {
  const route = handler(/app\.get\("\/api\/dialpad\/my-calls", requireAuth, async \(req: any, res\) => \{/, "const hit = storageExtra.getDialpadCallsFor(orgId, userId, date);");
  assert.match(route, /await refreshDialpadStatsIfStale\(orgId\)/);
});

test("the EOD page polls every two minutes, not ten — the poll is now what bounds the delay", () => {
  const query = eodPage.slice(eodPage.indexOf('queryKey: ["/api/eod-reports", selectedDate]'));
  const interval = query.slice(0, query.indexOf("});"));
  assert.match(interval, /refetchInterval: 2 \* 60_000/);
  assert.doesNotMatch(interval, /refetchInterval: 10 \* 60_000/);
});
