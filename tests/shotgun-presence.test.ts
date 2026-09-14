import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHOTGUN_PRESENCE_AFTER_MS, SHOTGUN_PRESENCE_RELEASE_AFTER_MS, SHOTGUN_PRESENCE_RESPOND_MS, presenceReleaseCutoff, presenceState,
} from "../shared/shotgun-presence";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");

/**
 * A CLR who claims a Shotgun lead and walks away holds it forever while the
 * rotation skips them. Three minutes after the claim C3 asks "still there?";
 * no answer inside the window and the lead goes back to the queue.
 */

const CLAIMED = "2026-09-14T15:00:00.000Z";
const t = (offsetMs: number) => Date.parse(CLAIMED) + offsetMs;

// "A shotgun/new lead that is accepted should not be dismissed without a 30
// second warning that it's going to be dismissed after 3 minutes." — Ethan,
// 14 Sep 2026. Release at 3:00; the warning is on screen from 2:30.
test("nothing is asked for the first two and a half minutes", () => {
  assert.equal(SHOTGUN_PRESENCE_RELEASE_AFTER_MS, 3 * 60_000);
  assert.equal(SHOTGUN_PRESENCE_RESPOND_MS, 30_000);
  assert.equal(SHOTGUN_PRESENCE_AFTER_MS, 2.5 * 60_000);
  assert.deepEqual(presenceState(CLAIMED, null, t(0)), { kind: "none" });
  assert.deepEqual(presenceState(CLAIMED, null, t(SHOTGUN_PRESENCE_AFTER_MS - 1)), { kind: "none" });
});

test("thirty seconds before the three-minute mark the warning opens and counts down to it", () => {
  const s = presenceState(CLAIMED, null, t(SHOTGUN_PRESENCE_AFTER_MS));
  assert.equal(s.kind, "prompt");
  if (s.kind !== "prompt") return;
  assert.equal(s.deadlineAt, "2026-09-14T15:03:00.000Z", "the release is exactly three minutes after the claim");
  assert.equal(Math.round(s.secondsLeft), 30);
  const later = presenceState(CLAIMED, null, t(SHOTGUN_PRESENCE_AFTER_MS + 20_000));
  assert.equal(later.kind === "prompt" && Math.round(later.secondsLeft), 10);
});

test("no answer by three minutes means release; an answer means never asked again", () => {
  assert.deepEqual(presenceState(CLAIMED, null, t(3 * 60_000)), { kind: "expired" });
  assert.deepEqual(presenceState(CLAIMED, "2026-09-14T15:02:50.000Z", t(60 * 60_000)), { kind: "none" });
  // Nothing to judge without a claim time.
  assert.deepEqual(presenceState(null, null, t(60 * 60_000)), { kind: "none" });
});

test("the release cutoff is exactly three minutes before now", () => {
  const now = t(10 * 60_000);
  assert.equal(presenceReleaseCutoff(now), new Date(now - 3 * 60_000).toISOString());
});

test("the warning says how many seconds are left and the new-lead card shouts in its last thirty", () => {
  const prompt = read("client/src/components/shotgun-presence-prompt.tsx");
  assert.match(prompt, /goes back to the rotation in <strong>\{Math\.ceil\(state\.secondsLeft\)\} seconds<\/strong>/);
  const card = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.match(card, /left > 0 && left <= 30 \? <>Going to Shotgun in/);
  assert.match(card, /role=\{left > 0 && left <= 30 \? "alert" : undefined\}/);
});

test("the rotation engine releases an unanswered claim back to the queue, atomically", () => {
  const advance = routes.slice(routes.indexOf("function advanceShotgun"), routes.indexOf("const shotgunTimer"));
  assert.match(advance, /status='claimed' AND presence_confirmed_at IS NULL AND claimed_at IS NOT NULL AND claimed_at<=\?/);
  assert.match(advance, /presenceReleaseCutoff\(Date\.parse\(nowIso\)\)/);
  // The status guard: a write-up landing at the same instant wins.
  assert.match(advance, /WHERE id=\? AND status='claimed' AND current_assignee_id=\? AND presence_confirmed_at IS NULL/);
  // Back to the queue with the claim's progress cleared, like a manager requeue.
  assert.match(advance, /SET status='queued',current_assignee_id=NULL,offer_expires_at=NULL,claimed_at=NULL,\s*\n\s*presence_confirmed_at=NULL/);
  // The CLR is told; they are NOT taken out of the rotation for it.
  assert.match(advance, /shotgun_requeued/);
  const release = advance.slice(advance.indexOf("const walked ="), advance.indexOf("const queued ="));
  assert.doesNotMatch(release, /is_ready=0/);
  // And it runs before the queue is handed out, so the returned lead goes out on the same tick.
  assert.ok(advance.indexOf("const walked =") < advance.indexOf("const queued ="));
});

test("only the holder can answer, only while it is still claimed, and the answer sticks", () => {
  const route = routes.slice(routes.indexOf('app.post("/api/shotgun/:id/still-here"'), routes.indexOf('app.post("/api/shotgun/:id/deny"'));
  assert.match(route, /SET presence_confirmed_at=COALESCE\(presence_confirmed_at, \?\)/);
  assert.match(route, /WHERE id=\? AND org_id=\? AND status='claimed' AND current_assignee_id=\?/);
  assert.match(route, /res\.status\(409\)/);
  assert.match(routes, /presenceConfirmedAt: row\.presence_confirmed_at \? String\(row\.presence_confirmed_at\) : null,/);
  assert.match(read("server/storage.ts"), /ALTER TABLE shotgun_leads ADD COLUMN presence_confirmed_at TEXT/);
});

test("the prompt is on every page, next to the offer card, and asks the server clock", () => {
  const app = read("client/src/App.tsx");
  assert.match(app, /<ShotgunOfferAlert \/>\s*\n\s*<ShotgunPresencePrompt \/>/);
  const prompt = read("client/src/components/shotgun-presence-prompt.tsx");
  assert.match(prompt, /presenceState\(held\.claimedAt, held\.presenceConfirmedAt, clockNow\)/);
  assert.match(prompt, /serverTime - dataUpdatedAt/);
  assert.match(prompt, /`\/api\/shotgun\/\$\{id\}\/still-here`/);
  assert.match(prompt, /data-testid="shotgun-still-here"/);
  // Holding a claimed lead makes the poll fast enough for the prompt to be on time.
  assert.match(prompt, /\?\.holding \? 3_000 : 15_000/);
});
