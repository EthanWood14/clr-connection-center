import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHOTGUN_ACTIVE_IDLE_MS, SHOTGUN_NO_TAKERS_MS, SHOTGUN_NO_TAKERS_STATUS,
  shotgunGiveUpAt, shotgunOutOfTime, shotgunPersonPresent,
} from "../shared/shotgun-attention";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * "How do we have the shotgun feature calm down in the morning, it goes
 * crazy?" — Ethan, 22 Sep 2026. Ten days of production: 40,816 offers, 40,026
 * expired, 255 confirmed, and ~2,600 offers an hour through the night with not
 * one confirmation among them.
 */

test("a lead asks for half an hour and then stops", () => {
  assert.equal(SHOTGUN_NO_TAKERS_MS, 30 * 60_000);
  const published = Date.parse("2026-09-22T16:00:00Z");
  assert.equal(shotgunGiveUpAt("2026-09-22T16:00:00Z"), published + SHOTGUN_NO_TAKERS_MS);
  assert.equal(shotgunOutOfTime("2026-09-22T16:00:00Z", published + 29 * 60_000), false);
  assert.equal(shotgunOutOfTime("2026-09-22T16:00:00Z", published + 30 * 60_000), true);
  assert.equal(shotgunOutOfTime("2026-09-22T16:00:00Z", published + 111 * 3600_000), true,
    "the oldest lead still cycling on 22 Sep had been going 111 hours");
  // Dates and numbers both work, because callers have both.
  assert.equal(shotgunOutOfTime(published, published + 31 * 60_000), true);
  assert.equal(shotgunOutOfTime(new Date(published), published + 31 * 60_000), true);
  // A publication time we cannot read must never silently retire a real lead.
  for (const bad of ["", "not a date", null as any, undefined as any, NaN]) {
    assert.equal(shotgunOutOfTime(bad, Date.now()), false, String(bad));
  }
});

test("a heartbeat means a person, not a loaded page", () => {
  assert.equal(SHOTGUN_ACTIVE_IDLE_MS, 15 * 60_000);
  const now = Date.parse("2026-09-22T16:00:00Z");
  assert.equal(shotgunPersonPresent(now - 1_000, now), true);
  assert.equal(shotgunPersonPresent(now - 14 * 60_000, now), true, "reading a lead card is still being there");
  assert.equal(shotgunPersonPresent(now - 15 * 60_000, now), false);
  assert.equal(shotgunPersonPresent(now - 8 * 3600_000, now), false, "the machine left on overnight");
  // A hidden tab is not a person however recently it was touched.
  assert.equal(shotgunPersonPresent(now - 1_000, now, false), false);
  // Never interacted with at all — freshly restored into a background tab.
  for (const none of [null, undefined, 0, NaN, -1]) {
    assert.equal(shotgunPersonPresent(none as any, now), false, String(none));
  }
  // A clock that jumped backwards must not grant an endless session.
  assert.equal(shotgunPersonPresent(now + 60_000, now), false);
});

test("the rotation retires a lead instead of cycling it forever", () => {
  const routes = read("server/routes.ts");
  // Parked by the same loop that hands leads out, so it cannot be skipped.
  assert.match(routes, /const giveUpCutoff = new Date\(Date\.now\(\) - SHOTGUN_NO_TAKERS_MS\)\.toISOString\(\);/);
  assert.match(routes, /WHERE status='queued' AND created_at<=\? ORDER BY created_at LIMIT 100/);
  assert.match(routes, /UPDATE shotgun_leads SET status=\?,current_assignee_id=NULL,offer_expires_at=NULL,updated_at=\?\n        WHERE id=\? AND status='queued'/);
  // Parked, not cancelled: it keeps what it collected and stays on the board.
  assert.equal(SHOTGUN_NO_TAKERS_STATUS, "no_takers");
  assert.match(routes, /type: "shotgun_no_takers"/, "the publisher is told rather than left guessing");
  // And a manager can send it round again with the button that already exists.
  assert.match(routes, /status IN \('offered','claimed',\?\)`\)\.run\(now, leadId, orgId, SHOTGUN_NO_TAKERS_STATUS\)/);
  assert.match(routes, /Only an offered, claimed or parked lead can be requeued\./);
  // The sweep has to run BEFORE the hand-out, or a lead gets one more lap
  // after its time is up.
  const sweep = routes.indexOf("const giveUpCutoff");
  const handout = routes.indexOf("SELECT id FROM shotgun_leads WHERE status='queued' ORDER BY created_at,id LIMIT 100");
  assert.ok(sweep > 0 && handout > sweep, "leads are retired before the next round of offers");
});

test("the browser stops beating when nobody is at it", () => {
  const alert = read("client/src/components/shotgun-offer-alert.tsx");
  assert.match(alert, /import \{ shotgunPersonPresent \} from "@shared\/shotgun-attention";/);
  assert.match(alert, /if \(!shotgunPersonPresent\(lastInteraction, Date\.now\(\), document\.visibilityState === "visible"\)\) return;/);
  // Real input, not a timer: a page that is merely open must not qualify.
  assert.match(alert, /const events = \["pointerdown", "keydown", "wheel", "touchstart", "focus"\] as const;/);
  assert.match(alert, /document\.addEventListener\("visibilitychange", noticed\);/);
  // Every listener it adds, it removes: this component mounts on every page.
  assert.match(alert, /for \(const name of events\) window\.removeEventListener\(name, noticed\);/);
  assert.match(alert, /document\.removeEventListener\("visibilitychange", noticed\);/);
  // The blocked branch is untouched — it must keep reporting, because that is
  // how the server knows the CLR is present but cannot take a lead.
  assert.match(alert, /\{ heartbeat: true, blocked: true \}/);
});

test("the board says parked rather than showing a lead that simply stopped", () => {
  const page = read("client/src/pages/shotgun.tsx");
  assert.match(page, /status: "queued" \| "offered" \| "claimed" \| "done" \| "cancelled" \| "no_takers";/);
  assert.match(page, /if \(status === "no_takers"\) return "bg-stone-600";/);
  assert.match(page, /return status === "no_takers" \? "NO TAKERS" : status\.toUpperCase\(\);/);
  assert.match(page, /const canRequeue = lead\.status === "offered" \|\| lead\.status === "claimed" \|\| lead\.status === "no_takers";/);
  assert.match(page, /Went round the floor for \{Math\.round\(SHOTGUN_NO_TAKERS_MS \/ 60_000\)\} minutes with nobody free/);
});
