import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canReclaimShotgunLead, isShotgunReclaimableStatus } from "../shared/shotgun-reclaim";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");
const page = read("client/src/pages/shotgun.tsx");
const prompt = read("client/src/components/shotgun-reclaim-prompt.tsx");
const app = read("client/src/App.tsx");

/**
 * Ethan: "if you lose a shotgun lead after you grabbed it, you should have
 * the option to grab them back if you were on the phone with them."
 */

test("queued and offered (to someone else) are reclaimable; claimed/done/cancelled are not", () => {
  assert.equal(isShotgunReclaimableStatus("queued"), true);
  assert.equal(isShotgunReclaimableStatus("offered"), true);
  assert.equal(isShotgunReclaimableStatus("claimed"), false);
  assert.equal(isShotgunReclaimableStatus("done"), false);
  assert.equal(isShotgunReclaimableStatus("cancelled"), false);
});

test("reclaim requires prior confirm, on-the-phone, and a live non-owned lead", () => {
  const base = {
    status: "queued",
    currentAssigneeId: null as number | null,
    requesterId: 7,
    previouslyConfirmed: true,
    holdingOtherClaimed: false,
    onThePhone: true,
  };
  assert.deepEqual(canReclaimShotgunLead(base), { ok: true });
  assert.equal(canReclaimShotgunLead({ ...base, onThePhone: false }).ok, false);
  assert.equal(canReclaimShotgunLead({ ...base, previouslyConfirmed: false }).ok, false);
  assert.equal(canReclaimShotgunLead({ ...base, holdingOtherClaimed: true }).ok, false);
  assert.equal(canReclaimShotgunLead({ ...base, status: "done" }).ok, false);
  assert.equal(canReclaimShotgunLead({ ...base, status: "claimed", currentAssigneeId: 9 }).ok, false);
  // Offered back to the same CLR — use normal confirm, not reclaim.
  assert.equal(canReclaimShotgunLead({ ...base, status: "offered", currentAssigneeId: 7 }).ok, false);
  // Offered to someone else — reclaim may snatch.
  assert.deepEqual(canReclaimShotgunLead({ ...base, status: "offered", currentAssigneeId: 9 }), { ok: true });
});

test("POST /api/shotgun/:id/reclaim reassigns claimed without a floor offer lap", () => {
  const route = routes.slice(
    routes.indexOf('app.post("/api/shotgun/:id/reclaim"'),
    routes.indexOf('app.post("/api/shotgun/:id/deny"'),
  );
  assert.match(route, /onThePhone === true/);
  assert.match(route, /canReclaimShotgunLead/);
  assert.match(route, /response='confirmed'/);
  assert.match(route, /shotgun_offer_events/);
  assert.match(route, /SET status='claimed',current_assignee_id=\?/);
  assert.match(route, /presence_confirmed_at=\?/);
  assert.match(route, /response='reclaimed'/);
  assert.match(route, /response='reclaimed_away'/);
  // Skip inventing a new offer countdown for this lead.
  assert.match(route, /Do not advanceShotgun for this lead/);
  // Still advance so any pending offers released to the queue can move on.
  assert.match(route, /advanceShotgun\(now\)/);
});

test("GET /api/shotgun surfaces reclaimable from append-only confirmed events", () => {
  const get = routes.slice(routes.indexOf('app.get("/api/shotgun"'), routes.indexOf('app.post("/api/shotgun/readiness"'));
  assert.match(get, /reclaimable:/);
  assert.match(get, /FROM shotgun_offer_events/);
  assert.match(get, /response='confirmed'/);
  assert.match(get, /l\.status IN \('queued','offered'\)/);
  assert.match(get, /NOT \(l\.status='offered' AND l\.current_assignee_id=\?\)/);
});

test("Grab back UI is global and on the Shotgun page with an on-the-phone confirm", () => {
  assert.match(app, /<ShotgunReclaimPrompt \/>/);
  assert.match(app, /ShotgunPresencePrompt \/>\s*\n\s*<ShotgunReclaimPrompt \/>/);
  assert.match(prompt, /data-testid="shotgun-reclaim-prompt"/);
  assert.match(prompt, /data-testid="shotgun-grab-back"/);
  assert.match(prompt, /data-testid="shotgun-reclaim-call"/);
  assert.match(prompt, /Call in Dialpad/);
  assert.match(prompt, /const prepareDialpadCall = useDialpadCall\(\)/);
  assert.match(prompt, /prepareDialpadCall\(target\.phone\)[\s\S]*?reclaim\.mutateAsync\(target\.id\)\.then\(\(\) => dialpad\.complete\(\)\)\.catch\(\(\) => dialpad\.cancel\(\)\)/);
  assert.match(prompt, /onThePhone: true/);
  assert.match(prompt, /I AM ON THE PHONE — GRAB BACK/);
  assert.match(page, /shotgun-reclaimable-section/);
  assert.match(page, /I am on the phone — Grab back/);
  assert.match(page, /shotgun-reclaim-call-/);
  assert.match(page, /Call in Dialpad/);
  assert.match(page, /`\/api\/shotgun\/\$\{id\}\/reclaim`/);
  assert.match(page, /onThePhone: true/);
});

test("presence-release notification points at Grab back when on the phone", () => {
  const advance = routes.slice(routes.indexOf("function advanceShotgun"), routes.indexOf("const shotgunTimer"));
  assert.match(advance, /Grab back on Shotgun if you are still on the phone/);
});
