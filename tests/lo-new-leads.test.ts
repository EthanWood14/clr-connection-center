import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LO_NEW_LEAD_CLAIM_WINDOW_MS, LO_NEW_LEAD_FRESH_MS, loNewLeadEscalateAt, loNewLeadIsFresh, loNewLeadSecondsLeft } from "../shared/lo-new-leads";
import { activeLeadAlerts, claimSettled, collectLeadAlerts, type LoLeadFeed } from "../client/src/lib/lead-alerts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");

/**
 * A new lead for an assigned LO behaves like a Shotgun lead: tap-to-call, a
 * three-minute claim window, and — if nobody claims it — the Shotgun rotation
 * with its twenty-second offer that moves on.
 */

test("the window is three minutes from first sight, and only a recent landing is announced", () => {
  assert.equal(LO_NEW_LEAD_CLAIM_WINDOW_MS, 3 * 60_000);
  assert.equal(LO_NEW_LEAD_FRESH_MS, 10 * 60_000);
  assert.equal(loNewLeadEscalateAt("2026-09-14T15:00:00.000Z"), "2026-09-14T15:03:00.000Z");
  const now = Date.parse("2026-09-14T15:00:00.000Z");
  assert.equal(loNewLeadIsFresh("2026-09-14T14:51:00.000Z", now), true);
  assert.equal(loNewLeadIsFresh("2026-09-14T14:49:00.000Z", now), false);
  assert.equal(loNewLeadIsFresh(null, now), false);
  assert.equal(Math.round(loNewLeadSecondsLeft("2026-09-14T15:03:00.000Z", now)), 180);
  assert.equal(loNewLeadSecondsLeft("2026-09-14T15:03:00.000Z", now + 10 * 60_000), 0);
});

const feed = (claim: any): LoLeadFeed => ({
  configured: true, stale: false, fetchedAt: "2026-09-14T15:00:10.000Z",
  los: [{ lo: { id: 1002, name: "Ian Militello" }, leads: [{ externalId: "999", borrowerName: "Test Lead", phone: "+15555550100", state: "CA", source: "test", landedAt: "2026-09-14T15:00:00.000Z", claim }] }],
});

test("the card carries the number and the claim state; a settled claim never pops and drops a live card", () => {
  const now = Date.parse("2026-09-14T15:00:10.000Z");
  const open = collectLeadAlerts(feed({ status: "new", escalateAt: "2026-09-14T15:03:05.000Z", claimedBy: null, shotgunLeadId: null }), [], now);
  assert.equal(open.alerts.length, 1);
  assert.equal(open.alerts[0].phone, "+15555550100");
  assert.equal(open.alerts[0].externalId, "999");
  assert.equal(open.alerts[0].claim?.escalateAt, "2026-09-14T15:03:05.000Z");
  // Somebody else took it before this tab ever saw it: remembered, not shown.
  const taken = collectLeadAlerts(feed({ status: "claimed", escalateAt: null, claimedBy: "Skyler Griffin", shotgunLeadId: null }), [], now);
  assert.equal(taken.alerts.length, 0);
  assert.ok(taken.seen.includes("1002:999"));
  // A card that is up drops the moment the feed says it went to Shotgun.
  const gone = activeLeadAlerts(open.alerts, feed({ status: "escalated", escalateAt: null, claimedBy: null, shotgunLeadId: 77 }), now + 5_000);
  assert.equal(gone.length, 0);
  assert.equal(claimSettled({ status: "escalate_failed", escalateAt: null, claimedBy: null, shotgunLeadId: null }), true);
  assert.equal(claimSettled(null), false);
});

test("the server records each lead once, announces it to the assigned CLRs, and escalates the unclaimed into Shotgun", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS lo_new_leads/);
  assert.match(storage, /UNIQUE\(org_id, external_id\)/);
  assert.match(storage, /INSERT OR IGNORE INTO lo_new_leads/);
  assert.match(storage, /WHERE org_id=\? AND external_id=\? AND status='new'/, "a claim only lands on an open lead");
  const announce = routes.slice(routes.indexOf("function announceFreshLoLeads("), routes.indexOf("function newestLeadsDeps("));
  assert.match(announce, /if \(!assigned\.length\) continue;/, "an LO nobody is calling for today is not a CLR's lead");
  assert.match(announce, /loNewLeadIsFresh\(lead\.landedAt, now\)/);
  assert.match(announce, /sendPushToUser\(userId, \{ title: `New lead — \$\{loName\}`/);
  assert.match(announce, /type: "lo_new_lead"/);
  const escalate = routes.slice(routes.indexOf("function escalateUnclaimedLoLeads("), routes.indexOf("const loLeadWatcher"));
  assert.match(escalate, /new Date\(Date\.now\(\) - LO_NEW_LEAD_CLAIM_WINDOW_MS\)/);
  assert.match(escalate, /createShotgunLeadFromFields\(orgId, Number\(publisher\.id\), publisher, \{/);
  assert.match(escalate, /source: `New lead — \$\{lead\.lo_name \|\| lead\.lo_email\}`/);
  assert.match(escalate, /\}, "lo-feed"\)/);
  // A failed publish is recorded, not retried every five seconds forever.
  assert.match(escalate, /markLoNewLeadEscalated\(Number\(lead\.id\), ok \? Number\(result\.body\?\.leadId\) \|\| null : null, ok \? null : String/);
});

test("the watcher runs on its own five-second clock and shares the popup's cache entry", () => {
  const watcher = routes.slice(routes.indexOf("const loLeadWatcher = setInterval("), routes.indexOf("loLeadWatcher.unref"));
  assert.match(watcher, /newestLeadsFanInEmails\(\)/);
  assert.match(watcher, /hours: LO_NEW_LEAD_POLL_HOURS, per: LO_NEW_LEAD_POLL_PER/);
  assert.match(routes, /const LO_NEW_LEAD_POLL_HOURS = 72;/);
  assert.match(routes, /const LO_NEW_LEAD_POLL_PER = 5;/);
  assert.match(watcher, /escalateUnclaimedLoLeads\(orgId\)/);
  assert.match(routes, /\}, 5_000\);\s*\n\s*loLeadWatcher\.unref/);
  // Every feed read — a poll's or the watcher's — announces through the same hook.
  assert.match(routes, /onFresh: \(los: NewestLeadsByLo\[\]\) => \{ try \{ announceFreshLoLeads\(orgId, los\); \}/);
  assert.match(routes, /await newestLeadsForLos\(emails, \{ hours, per \}, newestLeadsDeps\(orgId\)\)/);
});

test("the feed says where each lead's claim stands, and the claim route refuses a settled one", () => {
  assert.match(routes, /leads: row\.leads\.map\(\(l\) => \(\{ \.\.\.l, claim: claimFor\(String\(l\.externalId\)\) \}\)\)/);
  assert.match(routes, /escalateAt: s\.status === "new" \? loNewLeadEscalateAt\(String\(s\.first_seen_at\)\) : null/);
  const route = routes.slice(routes.indexOf('app.post("/api/lo-new-leads/claim"'), routes.indexOf('app.get("/api/lo-newest-leads"'));
  assert.match(route, /storageExtra\.claimLoNewLead\(orgId, externalId, userId\)/);
  assert.match(route, /already claimed it/);
  assert.match(route, /It already went to Shotgun/);
  assert.match(route, /res\.status\(409\)/);
});

test("both cards are tap-to-call, and the new-lead card claims and counts down", () => {
  const card = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.match(card, /claim\.mutate\(lead\.externalId, \{ onSuccess: \(\) => \{ window\.location\.href = tel; dismiss\(\);/);
  assert.doesNotMatch(card, /href=\{tel\}/);
  assert.match(card, /data-testid="assigned-lo-lead-call"/);
  assert.match(card, /data-testid="assigned-lo-lead-claim"/);
  assert.match(card, /Goes to Shotgun in/);
  assert.match(card, /loNewLeadSecondsLeft\(escalateAt, clockNow\)/);
  assert.match(card, /refetchIntervalInBackground: true/);
  const offer = read("client/src/components/shotgun-offer-alert.tsx");
  assert.match(offer, /data-testid="shotgun-offer-call"/);
  assert.match(offer, /confirm\.mutate\(offered\.id, \{ onSuccess: \(\) => \{ window\.location\.href = tel;/);
  assert.doesNotMatch(offer, /<a href=\{`tel:/);
  assert.match(offer, /refetchIntervalInBackground: true/);
});
