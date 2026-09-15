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
 * "Add a new stat for the percentage of shotguns accepted/responded to." —
 * Ethan, 15 Sep 2026. Two columns on the Transfer Scorecard, from the
 * append-only offer history: accepted = confirmed; responded = confirmed or
 * declined; the rest timed out. Requeued-while-pending is nobody's miss.
 */

test("the scorecard counts each CLR's offers from the offer history, by Pacific day", () => {
  const block = routes.slice(routes.indexOf("const shotgunByUser = new Map"), routes.indexOf("// Texting-sourced transfers (Bulk Texter)"));
  assert.match(block, /FROM shotgun_offer_events/);
  assert.match(block, /response IN \('confirmed','declined','expired'\)/, "pending and requeued offers are not scored");
  assert.match(block, /todayInTz\(ms, BUSINESS_DAY_DEFAULT_TZ\)/);
  assert.match(block, /if \(day < startDate \|\| day > endDate\) continue;/);
  assert.match(block, /if \(r\.response === "confirmed"\) \{ s\.accepted \+= 1; s\.responded \+= 1; \}/);
  assert.match(block, /else if \(r\.response === "declined"\) s\.responded \+= 1;/);
  assert.match(block, /excludedIds\.has\(uid\)/, "non-counted CLRs stay off the scorecard here too");
});

test("each leaderboard row carries the counts and null percentages when nothing was offered", () => {
  assert.match(routes, /shotgunOffers: shotgunByUser\.get\(u\.id\)\?\.offers \?\? 0,/);
  assert.match(routes, /shotgunAcceptPct: \(shotgunByUser\.get\(u\.id\)\?\.offers \?\? 0\) > 0\s*\n\s*\? Math\.round/);
  assert.match(routes, /shotgunRespondPct: \(shotgunByUser\.get\(u\.id\)\?\.offers \?\? 0\) > 0\s*\n\s*\? Math\.round/);
  assert.match(routes, /: null,\s*\n\s*shotgunRespondPct/);
});

// "Include average LO lead assignee time too (not including reassigned/
// shotgun leads)." — Ethan, 15 Sep 2026.
test("Lead grab averages the direct claim only, never a lead that timed out into Shotgun", () => {
  const block = routes.slice(routes.indexOf("const loClaimByUser = new Map"), routes.indexOf("const leaderboard = countedClrs"));
  assert.match(block, /FROM lo_new_leads/);
  assert.match(block, /status = 'claimed'/);
  assert.match(block, /shotgun_lead_id IS NULL/, "a lead that went to Shotgun is somebody else's stopwatch");
  assert.match(block, /if \(!Number\.isFinite\(landed\) \|\| !Number\.isFinite\(claimed\) \|\| claimed < landed\) continue;/);
  assert.match(block, /todayInTz\(claimed, BUSINESS_DAY_DEFAULT_TZ\)/);
  assert.match(routes, /loLeadClaimSeconds: \(loClaimByUser\.get\(u\.id\)\?\.n \?\? 0\) > 0/);
  // Lower is better — the one column on this table where that is true.
  assert.match(page, /key: "loLeadClaim", label: "Lead grab", get: r => r\.loLeadClaimSeconds \?\? null, better: false/);
  assert.match(page, /r\.loLeadClaimSeconds < 60 \? `\$\{r\.loLeadClaimSeconds\}s`/);
  assert.match(page, /lead\$\{r\.loLeadClaims === 1 \? "" : "s"\} claimed directly/);
});

test("the scorecard shows both as percentage columns with a dash for no offers", () => {
  assert.match(page, /key: "shotgunAccept", label: "SG Accept", get: r => r\.shotgunAcceptPct \?\? null, better: true/);
  assert.match(page, /key: "shotgunRespond", label: "SG Respond", get: r => r\.shotgunRespondPct \?\? null, better: true/);
  assert.match(page, /r\.shotgunAcceptPct == null \? "—" : `\$\{r\.shotgunAcceptPct\}%`/);
  assert.match(page, /accepted of \$\{r\.shotgunOffers\} offers/);
  assert.match(page, /timed out\)/);
  assert.match(page, /shotgunAcceptPct\?: number \| null; shotgunRespondPct\?: number \| null;/);
});
