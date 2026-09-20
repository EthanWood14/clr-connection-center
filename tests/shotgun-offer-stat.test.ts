import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");
const page = read("client/src/pages/manager-dashboard.tsx");

/**
 * 4.122.25 — Transfer Scorecard drops SG Accept / SG Respond / Lead grab /
 * Lead grab % and shows Shotgun SLA instead: claimed vs unclaimed (separate)
 * and claim time (median AND average) among claimed. No dial %.
 */

test("manager-dashboard payload uses per-CLR Shotgun SLA, not old offer/LO-grab fields", () => {
  assert.match(routes, /computeShotgunSlaByClr/);
  assert.match(routes, /slaClaimed: shotgunSlaByUser\.get\(u\.id\)\?\.claimed \?\? 0,/);
  assert.match(routes, /slaUnclaimed: shotgunSlaByUser\.get\(u\.id\)\?\.unclaimed \?\? 0,/);
  assert.match(routes, /slaMedianClaimSeconds: shotgunSlaByUser\.get\(u\.id\)\?\.medianClaimSeconds \?\? null,/);
  assert.match(routes, /slaAverageClaimSeconds: shotgunSlaByUser\.get\(u\.id\)\?\.averageClaimSeconds \?\? null,/);
  assert.doesNotMatch(routes, /shotgunAcceptPct: \(shotgunByUser/);
  assert.doesNotMatch(routes, /loLeadClaimSeconds: \(loClaimByUser/);
  assert.doesNotMatch(routes, /slaDialedUnder60s/);
});

test("Transfer Scorecard removes old shotgun columns and adds SLA columns", () => {
  assert.doesNotMatch(page, /key: "shotgunAccept", label: "SG Accept"/);
  assert.doesNotMatch(page, /key: "shotgunRespond", label: "SG Respond"/);
  assert.doesNotMatch(page, /key: "loLeadClaim", label: "Lead grab"/);
  assert.doesNotMatch(page, /key: "loLeadClaimPct", label: "Lead grab %"/);
  assert.match(page, /key: "slaClaimedUnclaimed", label: "Claimed \/ Unclaimed"/);
  assert.match(page, /key: "slaClaimTime", label: "Claim time"/);
  assert.match(page, /formatSlaSeconds\(r\.slaMedianClaimSeconds\).*formatSlaSeconds\(r\.slaAverageClaimSeconds\)/s);
  assert.doesNotMatch(page, /dialed <60s/);
  assert.match(page, /better: false/); // claim time: lower is better
});

test("Manager Home no longer mounts the orange SLA card next to the scorecard", () => {
  assert.doesNotMatch(page, /ShotgunSlaScoreboard/);
  assert.match(read("client/src/pages/shotgun.tsx"), /ShotgunSlaScoreboard/);
});
