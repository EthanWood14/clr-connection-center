import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import ts from "typescript";

import { LO_NEW_LEAD_CLAIM_WINDOW_MS, LO_NEW_LEAD_FLOOR_AFTER_MS, LO_NEW_LEAD_FRESH_MS, loNewLeadEscalateAt, loNewLeadIsFresh, loNewLeadSecondsLeft } from "../shared/lo-new-leads";
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
  const taken = collectLeadAlerts(feed({ status: "claimed", escalateAt: null, claimedBy: "Skyler Griffin", shotgunLeadId: null }), [], now);
  assert.equal(taken.alerts.length, 0);
  assert.ok(taken.seen.includes("1002:999"));
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
  assert.match(announce, /createShotgunLeadFromFields\(/, "fresh leads enter Shotgun immediately");
  assert.match(announce, /preferredAssigneeIds: assigned/);
  assert.match(announce, /sendPushToUser\(userId, \{ title: `New lead — \$\{loName\}`/);
  assert.match(announce, /type: "lo_new_lead"/);
  assert.match(announce, /url: "\/#\/shotgun"/);
  const escalate = routes.slice(routes.indexOf("function escalateUnclaimedLoLeads("), routes.indexOf("const loLeadWatcher"));
  assert.match(escalate, /new Date\(Date\.now\(\) - LO_NEW_LEAD_CLAIM_WINDOW_MS\)/);
  assert.match(escalate, /createShotgunLeadFromFields\(orgId, Number\(publisher\.id\), publisher, \{/);
  assert.match(escalate, /source: `New lead — \$\{lead\.lo_name \|\| lead\.lo_email\}`/);
  assert.match(escalate, /\}, "lo-feed"\)/);
  assert.match(escalate, /markLoNewLeadEscalated\(/);
  // Claim-vs-Shotgun race is closed in lo-new-lead-escalation: due-list takes
  // each row before the watcher creates a Shotgun lead.
  assert.match(storage, /lo-new-lead-escalation/);
  assert.match(storage, /loNewLeadEscalation\.loNewLeadsDueForShotgun/);
  const esc = read("server/lo-new-lead-escalation.ts");
  assert.match(esc, /takeLoNewLeadForEscalation\(Number\(lead\.id\)\)/);
  assert.match(esc, /skipped — claimed before Shotgun/);
  assert.ok(esc.indexOf("takeLoNewLeadForEscalation") < esc.indexOf("return taken"),
    "must take each due row before returning it to escalateUnclaimedLoLeads");
  assert.match(esc, /export function takeLoNewLeadForEscalation/);
  assert.match(esc, /export function finishLoNewLeadEscalation/);
});

test("the watcher runs on its own five-second clock and shares the popup's cache entry", () => {
  const watcher = routes.slice(routes.indexOf("const loLeadWatcher = setInterval("), routes.indexOf("loLeadWatcher.unref"));
  assert.match(watcher, /newestLeadsFanInEmails\(\)/);
  assert.match(watcher, /hours: LO_NEW_LEAD_POLL_HOURS, per: LO_NEW_LEAD_POLL_PER/);
  assert.match(routes, /const LO_NEW_LEAD_POLL_HOURS = 72;/);
  assert.match(routes, /const LO_NEW_LEAD_POLL_PER = 5;/);
  assert.match(watcher, /escalateUnclaimedLoLeads\(orgId, eligibleExternalIds\)/);
  assert.match(watcher, /if \(!result.stale\)/);
  assert.match(routes, /\}, 5_000\);\s*\n\s*loLeadWatcher\.unref/);
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

test("both cards secure their lead before opening Dialpad, and the new-lead card counts down", () => {
  const card = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.match(card, /const prepareDialpadCall = useDialpadCall\(\)/);
  assert.match(card, /prepareDialpadCall\(lead\.phone \|\| ""\)[\s\S]*?claim\.mutateAsync\(lead\.externalId\)\.then\(\(\) =>/);
  assert.match(card, /if \(identity\.current !== storageKey\) \{ dialpad\.cancel\(\); return; \}/);
  assert.match(card, /dialpad\.complete\(\);\s*dismiss\(\);[\s\S]*?\.catch\(\(\) => dialpad\.cancel\(\)\)/);
  assert.doesNotMatch(card, /tel:|window\.location/);
  assert.match(card, /data-testid="assigned-lo-lead-call"/);
  assert.match(card, /data-testid="assigned-lo-lead-claim"/);
  assert.match(card, /Goes to Shotgun in/);
  assert.match(card, /loNewLeadSecondsLeft\(escalateAt, clockNow\)/);
  assert.match(card, /refetchIntervalInBackground: false/);
  const offer = read("client/src/components/shotgun-offer-alert.tsx");
  assert.match(offer, /data-testid="shotgun-offer-call"/);
  assert.match(offer, /const prepareDialpadCall = useDialpadCall\(\)/);
  assert.match(offer, /prepareDialpadCall\(offered\.phone\)/);
  assert.match(offer, /confirm\.mutateAsync\(offered\.id\)/);
  assert.match(offer, /dialpad\.complete\(\)/);
  assert.match(offer, /open-phone/);
  assert.match(offer, /dialpad\.cancel\(\)/);
  assert.doesNotMatch(offer, /tel:|window\.location/);
  assert.match(offer, /refetchIntervalInBackground: false/);
});

function claimFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, role TEXT,
      is_active INTEGER, is_clr INTEGER, portal TEXT, shotgun_opted_out INTEGER);
    INSERT INTO users VALUES
      (1,1,'assistant',1,1,'c3',0), (2,1,'assistant',1,1,NULL,0),
      (3,1,'assistant',0,1,'c3',0), (4,1,'assistant',1,1,'lap',0),
      (5,1,'admin',1,0,'c3',0), (6,1,'viewer',1,0,'c3',0),
      (7,1,'admin',1,1,'c3',0), (8,2,'assistant',1,1,'c3',0),
      (9,1,'assistant',1,1,'c3',1), (10,1,'assistant',1,1,'lop',0);
    CREATE TABLE lo_new_leads (id INTEGER PRIMARY KEY, org_id INTEGER,
      external_id TEXT, status TEXT, assigned_user_ids TEXT,
      first_seen_at TEXT, claimed_by INTEGER, claimed_at TEXT);
    INSERT INTO lo_new_leads VALUES
      (1,1,'fresh','new','[1]','2026-09-15T15:00:00.000Z',NULL,NULL);
  `);
  const firstSeen = Date.parse("2026-09-15T15:00:00.000Z");
  let clockMs = firstSeen;
  class ClaimClock extends Date { static now() { return clockMs; } }
  const start = storage.indexOf("export function claimLoNewLead(");
  const end = storage.indexOf("/** Unclaimed leads", start);
  assert.ok(start >= 0 && end > start, "extract the exact production claim function");
  const source = storage.slice(start, end).replace("export function", "function");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const claim = new Function("sqlite", "LO_NEW_LEAD_CLAIM_WINDOW_MS", "LO_NEW_LEAD_FLOOR_AFTER_MS", "Date",
    `${compiled}\nreturn claimLoNewLead;`)(db, LO_NEW_LEAD_CLAIM_WINDOW_MS, LO_NEW_LEAD_FLOOR_AFTER_MS, ClaimClock) as
      (orgId: number, externalId: string, userId: number) => any;
  return { db, claim, at: (milliseconds: number) => { clockMs = firstSeen + milliseconds; } };
}

test("an assigned CLR can claim immediately, but another CLR must wait exactly 45 seconds", () => {
  const f = claimFixture();
  try {
    assert.equal(f.claim(1, "fresh", 2), null);
    f.at(LO_NEW_LEAD_FLOOR_AFTER_MS - 1);
    assert.equal(f.claim(1, "fresh", 2), null);
    f.at(0);
    assert.equal(f.claim(1, "fresh", 1)?.claimed_by, 1);
    assert.equal(f.claim(1, "fresh", 1), null, "already settled, including the same caller");
    f.db.prepare("UPDATE lo_new_leads SET status='new',claimed_by=NULL,claimed_at=NULL").run();
    f.at(LO_NEW_LEAD_FLOOR_AFTER_MS);
    assert.equal(f.claim(1, "fresh", 2)?.claimed_by, 2);
  } finally { f.db.close(); }
});

test("the three-minute deadline is enforced even when the escalation watcher has not run", () => {
  const f = claimFixture();
  try {
    f.at(LO_NEW_LEAD_CLAIM_WINDOW_MS);
    assert.equal(f.claim(1, "fresh", 1), null, "assigned CLR cannot claim at the deadline");
    assert.equal(f.claim(1, "fresh", 2), null, "floor cannot claim at the deadline");
    assert.equal((f.db.prepare("SELECT status FROM lo_new_leads").get() as any)?.status, "new");
    f.at(LO_NEW_LEAD_CLAIM_WINDOW_MS - 1);
    assert.equal(f.claim(1, "fresh", 2)?.claimed_by, 2);
  } finally { f.db.close(); }
});

test("inactive, portal, non-CLR and cross-org accounts cannot claim even as assigned users", () => {
  const f = claimFixture();
  try {
    f.db.prepare("UPDATE lo_new_leads SET assigned_user_ids=?").run(JSON.stringify([3, 4, 5, 6, 8, 10]));
    for (const userId of [3, 4, 5, 6, 8, 10]) {
      assert.equal(f.claim(1, "fresh", userId), null, `user ${userId} is ineligible`);
    }
    assert.equal(f.claim(2, "fresh", 8), null, "the lead belongs to another org");
    f.at(LO_NEW_LEAD_FLOOR_AFTER_MS);
    assert.equal(f.claim(1, "fresh", 7)?.claimed_by, 7, "active admin explicitly on the CLR roster may claim");
  } finally { f.db.close(); }
});

test("Shotgun opt-out preserves own assignments but prevents open-floor claims; Ready is not required", () => {
  const f = claimFixture();
  try {
    f.at(LO_NEW_LEAD_FLOOR_AFTER_MS);
    assert.equal(f.claim(1, "fresh", 9), null);
    f.db.prepare("UPDATE lo_new_leads SET assigned_user_ids='[9]'").run();
    f.at(0);
    assert.equal(f.claim(1, "fresh", 9)?.claimed_by, 9);
  } finally { f.db.close(); }
});

test("future-dated and settled leads cannot be claimed", () => {
  const f = claimFixture();
  try {
    f.at(-1);
    assert.equal(f.claim(1, "fresh", 1), null);
    f.at(0);
    for (const status of ["claimed", "escalated", "escalate_failed"]) {
      f.db.prepare("UPDATE lo_new_leads SET status=?").run(status);
      assert.equal(f.claim(1, "fresh", 1), null, status);
    }
  } finally { f.db.close(); }
});

test("competing claims at the same server instant have exactly one winner", async () => {
  const f = claimFixture();
  try {
    f.at(LO_NEW_LEAD_FLOOR_AFTER_MS);
    const results = await Promise.all([1, 2, 7].map(userId => new Promise<any>(resolve => {
      setImmediate(() => resolve(f.claim(1, "fresh", userId)));
    })));
    assert.equal(results.filter(Boolean).length, 1);
    const stored = f.db.prepare("SELECT status,claimed_by FROM lo_new_leads").get() as any;
    assert.equal(stored.status, "claimed");
    assert.equal(stored.claimed_by, results.find(Boolean).claimed_by);
  } finally { f.db.close(); }
});

test("escalation take loses to a claim that landed after the due-list was read", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE lo_new_leads (id INTEGER PRIMARY KEY, status TEXT, escalated_at TEXT,
      escalate_error TEXT, shotgun_lead_id INTEGER);
    INSERT INTO lo_new_leads VALUES (1,'new',NULL,NULL,NULL);
  `);
  const take = (id: number) => {
    const res = db.prepare(`UPDATE lo_new_leads SET status='escalated', escalated_at=?, escalate_error=NULL, shotgun_lead_id=NULL
      WHERE id=? AND status='new'`).run(new Date().toISOString(), id);
    return res.changes > 0;
  };
  const claim = () => db.prepare(`UPDATE lo_new_leads SET status='claimed' WHERE id=1 AND status='new'`).run();
  claim();
  assert.equal(take(1), false, "Shotgun must not take a claimed lead");
  assert.equal((db.prepare("SELECT status FROM lo_new_leads WHERE id=1").get() as any).status, "claimed");
  db.close();
});

test("the claim route checks current active C3 CLR identity before attempting the atomic claim", () => {
  const route = routes.slice(routes.indexOf('app.post("/api/lo-new-leads/claim"'), routes.indexOf('app.get("/api/lo-newest-leads"'));
  assert.match(route, /me\.isActive \?\? me\.is_active/);
  assert.match(route, /clrRoleMatches\(me\)/);
  assert.match(route, /me\.portal !== "c3"/);
  assert.match(route, /Number\(me\.orgId \?\? me\.org_id\) !== orgId/);
  assert.match(route, /Only active C3 CLRs can claim a lead/);
});
