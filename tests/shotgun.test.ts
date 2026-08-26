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
const resultCard = readFileSync(join(root, "client/src/components/shotgun-result-card.tsx"), "utf8");
const resultPrompt = readFileSync(join(root, "client/src/components/shotgun-result-prompt.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");

test("shotgun state is durable and keeps one offer row per CLR per lead", () => {
  for (const table of ["shotgun_readiness", "shotgun_leads", "shotgun_offers", "shotgun_offer_events"]) assert.match(storage, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(storage, /UNIQUE\(lead_id, user_id\)/);
  assert.match(storage, /idx_shotgun_one_live_offer_per_clr/);
  assert.match(storage, /idx_shotgun_active_phone/);
  assert.match(storage, /idx_shotgun_active_email/);
  assert.match(storage, /transfer_outcome_id INTEGER REFERENCES lead_outcomes\(id\)/);
  assert.match(storage, /idx_shotgun_transfer_outcome/);
});

test("only live-ready CLRs enter the fair assignment rotation", () => {
  const assign = routes.slice(routes.indexOf("function assignShotgunLead"), routes.indexOf("function advanceShotgun"));
  assert.match(assign, /r\.is_ready=1 AND r\.heartbeat_at>=\?/);
  assert.match(assign, /r\.last_assigned_at ASC/);
  assert.match(assign, /db\.transaction/);
  // The rotation must never run out of people. Excluding everyone who had ever
  // been offered the lead left it queued forever once the first lap finished;
  // ordering by the oldest offer recycles instead. tests/shotgun-rotation.test.ts
  // proves the behaviour by running this SQL.
  assert.doesNotMatch(assign, /NOT EXISTS \(SELECT 1 FROM shotgun_offers/,
    "a one-shot exclusion strands the lead after a single pass");
  assert.match(assign, /LEFT JOIN shotgun_offers o ON o\.lead_id=\? AND o\.user_id=u\.id/);
  assert.match(assign, /o\.response<>'pending'/, "someone holding a live offer must be skipped");
  assert.match(assign, /NOT EXISTS \(\s*SELECT 1 FROM shotgun_leads live/,
    "someone holding any live offer must be skipped for every other lead");
  assert.match(assign, /CASE WHEN o\.offered_at IS NULL THEN 0 ELSE 1 END, o\.offered_at ASC/);
  assert.match(assign, /ON CONFLICT\(lead_id,user_id\) DO UPDATE SET/,
    "UNIQUE(lead_id,user_id) means a second lap has to refresh the row, not insert");
});

test("offers last exactly 20 seconds and expiry moves rather than duplicates", () => {
  assert.match(routes, /const SHOTGUN_OFFER_MS = 20_000/);
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
  assert.match(resultCard, /Called this lead/);
  assert.match(resultCard, /Sent a text/);
  assert.match(resultCard, /Complete without transfer/);
});

test("a claimed lead prompts its CLR globally until a result is logged", () => {
  assert.match(app, /<ShotgunResultPrompt \/>/);
  assert.match(resultPrompt, /lead\.status === "claimed"/);
  assert.match(resultPrompt, /lead\.currentAssigneeId === user\?\.id/);
  assert.match(resultPrompt, /Log your Shotgun result/);
  assert.match(resultPrompt, /remind me in 10 minutes/i);
  assert.match(resultPrompt, /useContext\(DailyReportGateActive\)/);
  assert.match(resultPrompt, /useContext\(EodLockGateActive\)/);
  assert.match(resultPrompt, /hasLiveOffer/, "an urgent incoming offer must win over a result reminder");
});

test("Shotgun transfer completion creates one real C3 transfer outcome atomically", () => {
  const result = routes.slice(routes.indexOf('app.patch("/api/shotgun/:id/result"'), routes.indexOf('app.post("/api/shotgun/:id/requeue"'));
  assert.match(resultCard, /Log as a transfer/);
  assert.match(resultCard, /shotgun-transfer-lo/);
  assert.match(resultCard, /Direct/);
  assert.match(resultCard, /Appointment/);
  assert.match(resultCard, /\/api\/settings\/bulk-texter/);
  assert.match(resultCard, /\/api\/settings\/helper/);
  assert.match(result, /Mark the lead as called before logging a transfer/);
  assert.match(result, /Select the loan officer who received the transfer/);
  assert.match(result, /storage\.getLoanOfficerById\(loId\)/, "the selected LO must be scoped to the signed-in organization");
  assert.match(result, /db\.transaction/);
  assert.match(result, /storage\.createLeadOutcome/);
  assert.match(result, /outcomeType: "transfer"/);
  assert.match(result, /bulkTexter,/);
  assert.match(result, /helperAssisted,/);
  assert.match(result, /transfer_outcome_id=\?/);
  assert.match(result, /syncTransferToBonzo/);
  assert.match(result, /"outcome\.logged"/);
  assert.match(result, /transferCelebration/);
  assert.match(page, /Transfer logged/);
});

test("the urgent offer alert is global and readiness stays alive while C3 is open", () => {
  assert.match(app, /<ShotgunOfferAlert \/>/);
  assert.match(app, /path="\/shotgun" component=\{Shotgun\}/);
  assert.match(alert, /\? 2_000 : 15_000/);
  assert.match(alert, /refetchOnWindowFocus: true/);
  assert.match(alert, /setInterval\(beat, 10_000\)/);
  // Shotgun is on by default, and the SERVER owns whether a CLR is in the
  // rotation; the beat may only report that C3 is open.
  assert.match(alert, /"\/api\/shotgun\/readiness", \{ heartbeat: true \}/);
  assert.doesNotMatch(alert, /readiness", \{ ready:/, "a heartbeat must never assert readiness");
  assert.match(alert, /I RECEIVED THIS LEAD/);
  assert.match(alert, /managerNotes/);
  assert.match(alert, /stateCode/);
});

test("managers publish while CLRs control readiness", () => {
  // Publishing is managers by role OR the admin-granted per-user flag; the
  // flag itself is admin-set and mass-assignment-guarded.
  assert.match(routes, /taskManager\(me\) \|\| !!\(me\?\.canPublishShotgun/);
  assert.match(routes, /You don't have Shotgun publish access/);
  assert.match(routes, /"\/api\/users\/:id\/shotgun-publish"/);
  assert.match(routes, /"canPublishShotgun", "can_publish_shotgun",/, "self-edit escalation must be blocked");
  assert.match(routes, /Only active CLRs can receive Shotgun leads/);
  assert.match(page, /Publish to Shotgun/);
  assert.match(page, /Press Ready/);
});

test("leads remain private to their current CLR and leaving Ready rotates an open offer", () => {
  const status = routes.slice(routes.indexOf('app.get("/api/shotgun"'), routes.indexOf('app.post("/api/shotgun/readiness"'));
  assert.match(status, /AND l\.current_assignee_id=\?/,
    "a CLR must not keep another CLR's lead just because it was offered earlier");
  // Granted publishers additionally see the whole board for the trailing
  // 10 minutes — they fire leads into the rotation and need to watch them land.
  assert.match(status, /OR l\.created_at>=\?/);
  assert.match(routes, /SHOTGUN_PUBLISHER_VIEW_MS = 10 \* 60_000/);
  const readiness = routes.slice(routes.indexOf('app.post("/api/shotgun/readiness"'), routes.indexOf('app.post("/api/shotgun/publish"'));
  // A heartbeat must refresh liveness only. Letting it write is_ready meant
  // the globally mounted beat re-enrolled a CLR ten seconds after they opted
  // out, from every open tab, and readiness could not be left at all.
  assert.match(readiness, /req\.body\?\.heartbeat === true/);
  assert.match(readiness, /DO UPDATE SET heartbeat_at=excluded\.heartbeat_at,updated_at=excluded\.updated_at/);
  assert.match(readiness, /response='declined'/);
  assert.match(readiness, /advanceShotgun\(now\)/);
});

test("a new lead alerts every CLR by email and push when only zero to two are ready", () => {
  const helper = routes.slice(routes.indexOf("function notifyShotgunLowCoverage"), routes.indexOf("function assignShotgunLead"));
  assert.match(helper, /const clrs = taskClrs\(orgId\)/);
  assert.match(helper, /sendPushToUsers/);
  assert.match(helper, /sendEmail\(\{ to: emails/);
  assert.match(helper, /open C3 to join/);
  const publish = routes.slice(routes.indexOf('app.post("/api/shotgun/publish"'), routes.indexOf('app.post("/api/shotgun/:id/confirm"'));
  assert.match(publish, /if \(readyCount <= 2\) notifyShotgunLowCoverage/);
});

test("a missed offer takes the CLR out of the rotation and tells them", () => {
  const advance = routes.slice(routes.indexOf("function advanceShotgun"), routes.indexOf("const shotgunTimer"));
  // Being Ready means answering in 20 seconds; a lapsed offer proves you are
  // not at your desk, so the sweep flips is_ready off...
  assert.match(advance, /DO UPDATE SET is_ready=0/);
  // ...and says so, in-app and by push, with the way back in.
  assert.match(advance, /shotgun_missed/);
  assert.match(advance, /Press Ready on the Shotgun page to rejoin/);
});

test("denying an offer passes the lead on without punishing the CLR", () => {
  const denyStart = routes.indexOf('app.post("/api/shotgun/:id/deny"');
  assert.notEqual(denyStart, -1, "the deny route must exist");
  const deny = routes.slice(denyStart, routes.indexOf('app.patch("/api/shotgun/:id/result"', denyStart));
  assert.match(deny, /status='queued',current_assignee_id=NULL/);
  assert.match(deny, /offer_expires_at>\?/, "an expired offer cannot be passed during the expiry sweep window");
  assert.match(deny, /response='declined'/);
  assert.match(deny, /advanceShotgun\(now\)/, "the lead moves to the next CLR immediately");
  assert.doesNotMatch(deny, /is_ready=0/, "an explicit pass must NOT opt the CLR out — only a miss does");
  // And the alert offers the button, with the trade-off spelled out.
  assert.match(alert, /shotgun-deny/);
  assert.match(alert, /Passing keeps you in the rotation/);
});

test("publishing validates contact data, state, and active duplicates", () => {
  const publish = routes.slice(routes.indexOf('app.post("/api/shotgun/publish"'), routes.indexOf('app.post("/api/shotgun/:id/confirm"'));
  assert.match(publish, /phoneKey\.length < 10/);
  assert.match(publish, /Select the lead's state/);
  assert.match(publish, /already active in Shotgun/);
  assert.match(publish, /phone_key,email,email_key,state_code/);
  assert.match(page, /shotgun-state/);
});

test("requeue is explicit, preserves history, and clears the prior CLR's progress", () => {
  const start = routes.indexOf('app.post("/api/shotgun/:id/requeue"');
  const requeue = routes.slice(start, routes.indexOf('app.post("/api/shotgun/:id/cancel"', start));
  assert.match(requeue, /called=0,texted=0,result_notes='',transfer_outcome_id=NULL,done_at=NULL/);
  assert.match(requeue, /response='requeued'/);
  assert.doesNotMatch(requeue, /DELETE FROM shotgun_offers/);
  assert.match(page, /Requeue .*\?/);
  assert.match(page, /Could not requeue lead/);
});

test("managers can cancel an active lead without deleting its history", () => {
  const cancel = routes.slice(routes.indexOf('app.post("/api/shotgun/:id/cancel"'), routes.indexOf('app.get("/api/loan-officers/transfer-counts"'));
  assert.match(cancel, /status='cancelled'/);
  assert.match(cancel, /response='cancelled'/);
  assert.match(cancel, /Only managers can cancel leads/);
  assert.match(page, /Cancel lead/);
});

test("call launch requires compliance acknowledgement and state-hours protection", () => {
  assert.match(resultCard, /stateCallStatus/);
  assert.match(resultCard, /Outside calling hours/);
  assert.match(resultCard, /Do Not Call requirements/);
  assert.match(resultCard, /C3 cannot perform those checks automatically/);
  assert.match(resultCard, /Verified — open phone/);
  assert.match(resultCard, /\/open-phone/);
  const launch = routes.slice(routes.indexOf('app.post("/api/shotgun/:id/open-phone"'), routes.indexOf('app.patch("/api/shotgun/:id/result"'));
  assert.match(launch, /lead.status !== "claimed"/);
  assert.match(launch, /action: "phone_opened"/);
  assert.doesNotMatch(launch, /called=1/, "opening the phone is not proof that a call was placed");
});

test("mandatory report gates suspend Shotgun without changing the Ready preference", () => {
  const readiness = routes.slice(routes.indexOf('app.post("/api/shotgun/readiness"'), routes.indexOf('app.post("/api/shotgun/publish"'));
  assert.match(alert, /useContext\(DailyReportGateActive\)/);
  assert.match(alert, /useContext\(EodLockGateActive\)/);
  assert.match(alert, /heartbeat: true, blocked: true/);
  assert.match(readiness, /heartbeat_at=NULL/);
  assert.match(readiness, /response='blocked'/);
  assert.doesNotMatch(readiness.slice(readiness.indexOf('req.body?.blocked === true'), readiness.indexOf('const current =', readiness.indexOf('req.body?.blocked === true'))), /is_ready=0/);
});

test("an offer is heard, not just seen", () => {
  assert.match(alert, /playShotgunChime/);
  assert.match(alert, /659\.25/, "E5");
  assert.match(alert, /880/, "A5 — a pleasant two-note chime, not an alarm");
  assert.match(alert, /setInterval\(\(\) => playShotgunChime\(audioRef\), 2_500\)/, "gentle repeat while the offer is up");
});
