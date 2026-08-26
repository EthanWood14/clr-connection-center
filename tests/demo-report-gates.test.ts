import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("the read-only demo is exempt from the EOD lock", () => {
  const endpoint = routes.slice(
    routes.indexOf('app.get("/api/auth/eod-lock-status"'),
    routes.indexOf('// Admin-only: Complete System Manual PDF'),
  );
  assert.match(endpoint, /if \(isDemoOrg\(orgId\)\) return res\.json\(\{ locked: false, missingDates: \[\], exempt: true \}\)/);
  assert.ok(endpoint.indexOf("isDemoOrg(orgId)") < endpoint.indexOf("const isClr"),
    "demo exemption must happen before CLR accountability is evaluated");
});

test("the read-only demo is exempt from the previous-day call report", () => {
  const endpoint = routes.slice(
    routes.indexOf('app.get("/api/call-logs/check-previous-day"'),
    routes.indexOf('app.get("/api/call-logs"'),
  );
  assert.match(endpoint, /if \(isDemoOrg\(orgId\)\)/);
  assert.match(endpoint, /hasLog: true, date: reportDate, exempt: true/);
  assert.ok(endpoint.indexOf("isDemoOrg(orgId)") < endpoint.indexOf("const isClr"),
    "demo exemption must happen before CLR accountability is evaluated");
});

test("the demo remains read-only while real organizations keep both gates", () => {
  assert.match(routes, /if \(orgId && isDemoOrg\(orgId\)\)[\s\S]{0,120}Demo mode is read-only/);

  const eodEndpoint = routes.slice(
    routes.indexOf('app.get("/api/auth/eod-lock-status"'),
    routes.indexOf('// Admin-only: Complete System Manual PDF'),
  );
  assert.match(eodEndpoint, /locked: missingDates\.length > 0, missingDates/);

  const dailyEndpoint = routes.slice(
    routes.indexOf('app.get("/api/call-logs/check-previous-day"'),
    routes.indexOf('app.get("/api/call-logs"'),
  );
  assert.match(dailyEndpoint, /const hasLog = !!logForUser/);
});

test("the client knows demo mode and does not ask it to save preferences", () => {
  const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
  const auth = readFileSync(join(root, "client/src/lib/auth.tsx"), "utf8");
  const authEndpoint = routes.slice(
    routes.indexOf('app.get("/api/auth/me"'),
    routes.indexOf('// EOD lock status'),
  );

  assert.match(authEndpoint, /isDemo: isDemoOrg\(orgId\)/);
  assert.match(auth, /isDemo\?: boolean/);
  assert.match(app, /user\.isDemo \|\| !user\.isClr/,
    "the read-only demo must not receive a pipeline acknowledgement it cannot save");
  assert.match(app, /\{!isDemo && <PushNudge \/>\}/);
  assert.match(app, /\{!isDemo && <GoalNudge \/>\}/);
});
