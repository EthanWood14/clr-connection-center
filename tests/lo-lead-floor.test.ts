import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LO_NEW_LEAD_CLAIM_WINDOW_MS, LO_NEW_LEAD_FLOOR_AFTER_MS, loNewLeadFloorAt, loNewLeadIsOpenToFloor,
} from "../shared/lo-new-leads";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");

/**
 * Measured 15 Sep 2026: every new lead alerted exactly ONE CLR, the person
 * assigned to that LO that day, so a lead landing while they were on a call
 * burned the whole three minutes with nobody else able to see it. The
 * assignee keeps a head start; after it the floor gets the rest of the
 * window. Ethan: "do it."
 */

const LANDED = "2026-09-15T18:00:00.000Z";
const t = (ms: number) => Date.parse(LANDED) + ms;

test("the assignee has the lead to themselves for forty-five seconds", () => {
  assert.equal(LO_NEW_LEAD_FLOOR_AFTER_MS, 45_000);
  assert.equal(loNewLeadFloorAt(LANDED), "2026-09-15T18:00:45.000Z");
  assert.equal(loNewLeadIsOpenToFloor(LANDED, t(0)), false);
  assert.equal(loNewLeadIsOpenToFloor(LANDED, t(44_999)), false);
});

test("then every Ready CLR sees it, until the three minutes are up", () => {
  assert.equal(loNewLeadIsOpenToFloor(LANDED, t(LO_NEW_LEAD_FLOOR_AFTER_MS)), true);
  assert.equal(loNewLeadIsOpenToFloor(LANDED, t(LO_NEW_LEAD_CLAIM_WINDOW_MS - 1)), true);
  // At three minutes it belongs to Shotgun, not the floor card.
  assert.equal(loNewLeadIsOpenToFloor(LANDED, t(LO_NEW_LEAD_CLAIM_WINDOW_MS)), false);
  assert.equal(loNewLeadIsOpenToFloor(null, t(60_000)), false);
});

test("the feed hands each CLR the floor's unclaimed leads, never their own twice", () => {
  const open = storage.slice(storage.indexOf("export function openFloorLoNewLeads"), storage.indexOf("/** How many of the leads shown"));
  assert.match(open, /status='new' AND first_seen_at<=\? AND first_seen_at>\?/);
  assert.match(open, /includes\(Number\(excludeUserId\)\)/, "your own lead already has a card");
  const route = routes.slice(routes.indexOf("const floorLos ="), routes.indexOf("res.json({\n      ...result,"));
  assert.match(route, /shotgunOptedOut \?\? meRow\?\.shotgun_opted_out\) \? \[\]/, "somebody off the rotation is off this too");
  assert.match(route, /new Date\(nowMs - LO_NEW_LEAD_FLOOR_AFTER_MS\)\.toISOString\(\)/);
  assert.match(route, /new Date\(nowMs - LO_NEW_LEAD_CLAIM_WINDOW_MS\)\.toISOString\(\)/);
  assert.match(route, /openToFloor: true/);
  assert.match(routes, /\n      floorLos,\n/);
});

test("the card merges the floor in and says whose lead it is", () => {
  const alerts = read("client/src/lib/lead-alerts.ts");
  assert.match(alerts, /export function feedWithFloor\(feed: LoLeadFeed\): LoLeadFeed \{/);
  assert.match(alerts, /return \{ \.\.\.feed, los: \[\.\.\.feed\.los, \.\.\.feed\.floorLos\] \};/);
  assert.match(alerts, /openToFloor: lead\.openToFloor === true/);
  const card = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.match(card, /collectLeadAlerts\(feed, \[\.\.\.seen\.current, \.\.\.remembered\], now\)/);
  assert.match(card, /activeLeadAlerts\(current, feed, now\)/);
  assert.match(card, /Unclaimed lead — anyone can take it/);
});

// "Have elleine not receive any shotgun leads." — Ethan, 15 Sep 2026.
test("a CLR taken off the rotation is never offered a lead, however Ready they look", () => {
  assert.match(storage, /ALTER TABLE users ADD COLUMN shotgun_opted_out INTEGER NOT NULL DEFAULT 0/);
  assert.match(storage, /shotgun_optout_elleine_v1/);
  assert.match(storage, /UPDATE users SET shotgun_opted_out=1 WHERE name LIKE 'Elleine%' AND is_active=1/);
  const candidate = routes.slice(routes.indexOf("const candidate = db.prepare("), routes.indexOf("if (!candidate) return null;"));
  assert.match(candidate, /AND COALESCE\(u\.shotgun_opted_out,0\)=0/);
  // And the page tells them, rather than showing a Ready badge that will
  // never be offered anything.
  assert.match(routes, /const isClr = shotgunUserIsClr\(me\) && !optedOut;/);
  assert.match(routes, /AND COALESCE\(u\.shotgun_opted_out,0\)=0 ORDER BY u\.name/, "and they are off the publisher's Ready list");
});
