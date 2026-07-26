import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const routes = readFileSync(join(process.cwd(), "server/routes.ts"), "utf8");
const saConsole = readFileSync(join(process.cwd(), "server/saConsole.ts"), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = routes.indexOf(start);
  const endIndex = routes.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return routes.slice(startIndex, endIndex);
}

test("bootstrap/admin helper refreshes signed-cookie users from storage", () => {
  const helpers = sourceBetween(
    "function hasValidBootstrapToken",
    'app.get("/api/admin/lo-diagnostic"',
  );
  const adminGuard = sourceBetween(
    "function isBootstrapOrAdmin",
    'app.get("/api/admin/lo-diagnostic"',
  );

  assert.match(helpers, /process\.env\.BOOTSTRAP_TOKEN/);
  assert.match(adminGuard, /hasValidBootstrapToken\(req\)/);
  assert.match(adminGuard, /hasFreshAdminSession\(req\)/);
  assert.doesNotMatch(adminGuard, /signedCookies|JSON\.parse/);
});

test("raw SQL imports and diagnostics do not trust stale cookie payloads", () => {
  const ethanImport = sourceBetween(
    'app.post("/api/admin/import-ethan-outcomes"',
    'app.get("/api/admin/ethan-outcomes-count"',
  );
  const outcomeCount = sourceBetween(
    'app.get("/api/admin/ethan-outcomes-count"',
    "function isBootstrapOrAdmin",
  );
  const importV2 = sourceBetween(
    'app.post("/api/admin/run-import-v2"',
    'app.post("/api/admin/eod-reminders/test"',
  );

  assert.match(ethanImport, /freshSessionFromSignedCookie\(req\)/);
  assert.match(outcomeCount, /freshSessionFromSignedCookie\(req\)/);
  assert.doesNotMatch(ethanImport, /signedCookies|JSON\.parse/);
  assert.doesNotMatch(outcomeCount, /signedCookies|JSON\.parse/);
  assert.match(importV2, /isBootstrapOrAdmin\(req\)/);
});

test("loan-officer bulk import uses the same fresh-user validation", () => {
  const loanOfficerImport = sourceBetween(
    'app.post("/api/loan-officers/import"',
    'app.get("/api/loan-officers"',
  );

  assert.match(loanOfficerImport, /hasValidBootstrapToken\(req\)/);
  assert.match(loanOfficerImport, /freshSessionFromSignedCookie\(req\)/);
  assert.doesNotMatch(loanOfficerImport, /signedCookies|JSON\.parse/);
});

test("administrative credentials are not embedded in the server bundle", () => {
  assert.doesNotMatch(routes, /bonzo_password_autorestore_v1/);
  assert.match(saConsole, /process\.env\.SA_CONSOLE_ACCESS_CODE/);
  assert.doesNotMatch(saConsole, /SA_CONSOLE_ACCESS_CODE\s*\?\?\s*["'][^"']+["']/);
  assert.match(saConsole, /timingSafeEqual/);
});
