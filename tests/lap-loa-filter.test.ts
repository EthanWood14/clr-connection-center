import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const resultsPage = readFileSync(join(root, "client/src/pages/lap-results.tsx"), "utf8");
const auditPage = readFileSync(join(root, "client/src/pages/lap-transfer-audit.tsx"), "utf8");

test("LOA names join the assistants table, never users", () => {
  // lead_outcomes.loa_id references loan_officer_assistants.id — a users join
  // on that id produced coincidental garbage names (verified against prod:
  // loa_id 1 matched the user \"Ethan Wood\").
  assert.doesNotMatch(routes, /JOIN users l ON l\.id = o\.loa_id/);
  const sites = routes.match(/JOIN loan_officer_assistants l ON l\.id = o\.loa_id/g) ?? [];
  assert.ok(sites.length >= 2, "both the transfer audit and the auto-flow must use the assistants join");
  assert.match(routes, /l\.full_name AS loa_name/);
});

test("the portal can enumerate LOAs and filter results by connected LOA", () => {
  // /api/lap/loas rides the /lap/ prefix, so portal-confined accounts reach it.
  const loas = routes.slice(routes.indexOf('app.get("/api/lap/loas"'), routes.indexOf('app.get("/api/lap/results"'));
  assert.match(loas, /lapSessionContext\(req, res\)/);
  assert.match(loas, /FROM loan_officer_assistants a/);
  assert.match(loas, /lo\.org_id = \?/);
  // Results endpoint validates and forwards loaId.
  const results = routes.slice(routes.indexOf('app.get("/api/lap/results"'), routes.indexOf('app.get("/api/lap/results/:id"'));
  assert.match(results, /lapPositiveRouteId\(req\.query\.loaId\)/);
  assert.match(results, /Invalid LOA id\./);
  assert.match(results, /loaId: loaId \?\? undefined/);
  // Storage filters through the transfer link, not created_by (auto-created
  // packages all belong to the shared portal account).
  const list = storage.slice(storage.indexOf("export function listLapResultPackages"), storage.indexOf("const completeSql"));
  assert.match(list, /JOIN lead_outcomes o ON o\.id = t\.outcome_id/);
  assert.match(list, /o\.loa_id = @loaId/);
});

test("both portal pages offer the LOA dropdown", () => {
  // Results workspace: server-side filter.
  assert.match(resultsPage, /\/api\/lap\/loas/);
  assert.match(resultsPage, /query\.set\("loaId", loaId\)/);
  assert.match(resultsPage, /data-testid="lap-results-loa"/);
  // Transfer Documents: client-side filter over rows that carry loaName,
  // with an LOA column and an explicit no-LOA bucket.
  assert.match(auditPage, /data-testid="audit-loa-filter"/);
  assert.match(auditPage, /visibleRows\.map/);
  assert.match(auditPage, /r\.loaName \?\? "—"/);
  assert.match(auditPage, /No LOA on the transfer/);
});
