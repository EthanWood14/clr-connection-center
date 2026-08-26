import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const flow = routes.slice(
  routes.indexOf("function autoFlowLapTransfers"),
  routes.indexOf('app.get("/api/lap/results"'),
);

test("new Redoble transfers auto-flow into LAP packages", () => {
  // Epoch guard: transfers logged before the feature stay manual.
  assert.match(routes, /LAP_AUTO_PACKAGE_EPOCH = "2026-08-26T00:00:00"/);
  assert.match(flow, /o\.created_at >= \?/);
  // Idempotency comes from the durable link table, not from state in memory.
  assert.match(flow, /NOT EXISTS \(SELECT 1 FROM lap_result_transfer_links t/);
  // Same eligibility as the manual transfer-audit route.
  assert.match(flow, /\\bredoble\\b/);
  assert.match(flow, /hasAvailableLapAssistant\(orgId, Number\(lo\.id\)\)/);
  // Reuses the manual route's building blocks — never a second insert path.
  assert.match(flow, /storageExtra\.createLapResultPackage\(/);
  assert.match(flow, /storageExtra\.linkLapTransferToPackage\(/);
  assert.match(flow, /buildAuditRows\(transfers, packages\)/);
});

test("auto-link only reuses a RECENT same-borrower package", () => {
  // The audit's closest-in-time suggestion is unbounded (right for a human to
  // confirm); the auto path must not attach a new transfer to a months-old
  // repeat-borrower package and inherit its paperwork.
  assert.match(flow, /gapDays <= 7/);
  assert.match(flow, /row\.matchType === "suggested" && row\.packageId && gapDays <= 7/);
});

test("auto-created packages ring the portal bell and run on a timer", () => {
  assert.match(flow, /type: "lap_result"/);
  assert.match(flow, /portal: "lap"/);
  assert.match(flow, /lapSharedUserId\(orgId\)/);
  assert.match(flow, /getPortalUserIdsForLoanOfficer\(orgId, Number\(lo\.id\)\)/);
  // Minute cadence + boot catch-up, org 1 under the right org context.
  assert.match(flow, /setInterval\(\(\) => \{\s*try \{ runWithOrg\(\{ orgId: 1, superAdmin: false \}, \(\) => autoFlowLapTransfers\(1\)\); \}/);
  assert.match(flow, /setTimeout\(/);
  // The client bell already routes this type into the portal.
  const bell = readFileSync(join(root, "client/src/components/lap/lap-notification-bell.tsx"), "utf8");
  assert.match(bell, /lap_result/);
});
