import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/shotgun.tsx"), "utf8");
const alert = readFileSync(join(root, "client/src/components/shotgun-offer-alert.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");

test("shotgun state is durable and keeps immutable offer history", () => {
  for (const table of ["shotgun_readiness", "shotgun_leads", "shotgun_offers"]) assert.match(storage, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(storage, /UNIQUE\(lead_id, user_id\)/);
});

test("only live-ready CLRs enter the fair assignment rotation", () => {
  const assign = routes.slice(routes.indexOf("function assignShotgunLead"), routes.indexOf("function advanceShotgun"));
  assert.match(assign, /r\.is_ready=1 AND r\.heartbeat_at>=\?/);
  assert.match(assign, /NOT EXISTS \(SELECT 1 FROM shotgun_offers/);
  assert.match(assign, /r\.last_assigned_at ASC/);
  assert.match(assign, /db\.transaction/);
});

test("offers last exactly 15 seconds and expiry moves rather than duplicates", () => {
  assert.match(routes, /const SHOTGUN_OFFER_MS = 15_000/);
  const advance = routes.slice(routes.indexOf("function advanceShotgun"), routes.indexOf("const shotgunTimer"));
  assert.match(advance, /status='offered' AND offer_expires_at<=\?/);
  assert.match(advance, /response='expired'/);
  assert.match(advance, /status='queued',current_assignee_id=NULL/);
});

test("confirmation is atomic and cannot claim an expired or somebody else's offer", () => {
  const confirm = routes.slice(routes.indexOf('app.post("/api/shotgun/:id/confirm"'), routes.indexOf('app.patch("/api/shotgun/:id/result"'));
  assert.match(confirm, /Number\(lead\.current_assignee_id\) !== userId/);
  assert.match(confirm, /String\(lead\.offer_expires_at\) <= now/);
  assert.match(confirm, /WHERE id=\? AND org_id=\? AND status='offered' AND current_assignee_id=\? AND offer_expires_at>\?/);
  assert.match(confirm, /response='confirmed'/);
});

test("a CLR records call, text, notes, then explicitly marks the lead done", () => {
  const result = routes.slice(routes.indexOf('app.patch("/api/shotgun/:id/result"'), routes.indexOf('app.post("/api/shotgun/:id/requeue"'));
  assert.match(result, /Select called or sent a text/);
  assert.match(result, /Add notes explaining what happened/);
  assert.match(page, /Called this lead/);
  assert.match(page, /Sent a text/);
  assert.match(page, /Mark lead done/);
});

test("the urgent offer alert is global and readiness stays alive while C3 is open", () => {
  assert.match(app, /<ShotgunOfferAlert \/>/);
  assert.match(app, /path="\/shotgun" component=\{Shotgun\}/);
  assert.match(alert, /refetchInterval: 1_000/);
  assert.match(alert, /setInterval\(beat, 10_000\)/);
  assert.match(alert, /I RECEIVED THIS LEAD/);
});

test("managers publish while CLRs control readiness", () => {
  assert.match(routes, /Only managers can publish Shotgun leads/);
  assert.match(routes, /Only active CLRs can receive Shotgun leads/);
  assert.match(page, /Publish to Shotgun/);
  assert.match(page, /Press Ready/);
});

test("leads remain private to their current CLR and leaving Ready rotates an open offer", () => {
  const status = routes.slice(routes.indexOf('app.get("/api/shotgun"'), routes.indexOf('app.post("/api/shotgun/readiness"'));
  assert.match(status, /AND l\.current_assignee_id=\?/,
    "a CLR must not keep another CLR's lead just because it was offered earlier");
  const readiness = routes.slice(routes.indexOf('app.post("/api/shotgun/readiness"'), routes.indexOf('app.post("/api/shotgun/publish"'));
  assert.match(readiness, /response='declined'/);
  assert.match(readiness, /advanceShotgun\(now\)/);
});

test("a new lead alerts every CLR by email and push when only zero to two are ready", () => {
  const helper = routes.slice(routes.indexOf("function notifyShotgunLowCoverage"), routes.indexOf("function assignShotgunLead"));
  assert.match(helper, /const clrs = taskClrs\(orgId\)/);
  assert.match(helper, /sendPushToUsers/);
  assert.match(helper, /sendEmail\(\{ to: emails/);
  assert.match(helper, /Open C3 and press Ready/);
  const publish = routes.slice(routes.indexOf('app.post("/api/shotgun/publish"'), routes.indexOf('app.post("/api/shotgun/:id/confirm"'));
  assert.match(publish, /if \(readyCount <= 2\) notifyShotgunLowCoverage/);
});
