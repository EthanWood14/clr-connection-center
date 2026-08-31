import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const alarm = readFileSync(join(root, "client/src/components/manager-summons-alarm.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");

test("only a manager can raise or clear a summons", () => {
  for (const path of ['app.post("/api/summons"', 'app.post("/api/summons/:id/clear"', 'app.get("/api/summons"']) {
    const i = routes.indexOf(path);
    assert.ok(i > 0, `missing route ${path}`);
    assert.match(routes.slice(i, i + 400), /requireManagerOrAdmin\(req, res\)/, `${path} must be manager-gated`);
  }
});

test("the person it is aimed at cannot switch it off", () => {
  // No clear path is exposed to the summoned user, and the alarm itself offers
  // no dismiss — only a way to silence the sound.
  const mine = routes.slice(routes.indexOf('app.get("/api/summons/mine"'), routes.indexOf('app.get("/api/summons"'));
  assert.ok(!/cleared_at\s*=/.test(mine), "the /mine route must never clear anything");
  assert.ok(!/onClose|dismiss|setDismissed/i.test(alarm.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")),
    "the alarm must not be dismissable from the client");
  assert.match(alarm, /data-testid="summons-silence"/);
  assert.match(alarm, /You cannot close it yourself/);
});

test("a summons cannot be aimed at yourself or across orgs", () => {
  const post = routes.slice(routes.indexOf('app.post("/api/summons"'), routes.indexOf('app.post("/api/summons/:id/clear"'));
  assert.match(post, /userId === actorId/, "self-summon must be refused");
  // getUserById is not org-scoped.
  assert.match(post, /tOrg !== orgId\)\) return res\.status\(404\)/);
});

test("only one live summons per person", () => {
  assert.match(storage, /CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_summons_live/);
  assert.match(storage, /ON manager_summons\(org_id, user_id\) WHERE cleared_at IS NULL/);
});

test("the flash stays under the seizure threshold and respects reduced motion", () => {
  // Above three flashes per second, flashing content is a photosensitive
  // epilepsy risk. This fires unannounced on a whole floor's screens.
  const m = alarm.match(/setInterval\(\(\) => setFlashOn\(\(v\) => !v\), (\d+)\)/);
  assert.ok(m, "the flash interval must be explicit");
  const ms = Number(m[1]);
  assert.ok(ms >= 334, `a ${ms}ms toggle flashes faster than 3/sec`);
  assert.match(alarm, /prefers-reduced-motion: reduce/);
  assert.match(alarm, /if \(!active \|\| reducedMotion\)/, "reduced motion must skip the flashing");
});

test("the siren stops when the alarm clears or is silenced", () => {
  assert.match(alarm, /const shouldSound = active && !silenced/);
  assert.match(alarm, /stopSirenRef\.current\(\)/);
});

test("the alarm outranks the other gates", () => {
  assert.match(app, /<ManagerSummonsAlarm \/>/);
  // Mounted above EodLockGate in the shell so being called in wins.
  assert.ok(app.indexOf("<ManagerSummonsAlarm />") < app.indexOf("<EodLockGate"),
    "the summons must render above the EOD lock");
});

test("the video leads and the siren gets out of its way", () => {
  assert.match(alarm, /data-testid="summons-video"/);
  assert.match(alarm, /src="\/summons\.mp4"/);
  assert.match(alarm, /loop/, "it has to keep going, not stop after one play");
  // The siren drops right back once the video is carrying the sound.
  assert.match(alarm, /const level = videoAudible \? 0\.03 : 0\.13/);
  assert.ok(0.03 < 0.13, "the backing level must be quieter than the solo level");
  // Autoplay with sound is refused until a page has been interacted with, so
  // there must be a muted fallback — and the siren stays loud in that case.
  assert.match(alarm, /v\.muted = true;/);
  assert.match(alarm, /setVideoAudible\(false\)/);
});

test("silencing silences the video too", () => {
  // Otherwise the button would be a lie: the siren stops and the clip keeps
  // shouting.
  assert.match(alarm, /if \(silenced\) \{ v\.muted = true; setVideoAudible\(false\); \}/);
});

test("an all-hands summons reaches everyone, and one stop clears everyone", () => {
  // The /mine query must match an all-hands row regardless of who is asking.
  const mine = routes.slice(routes.indexOf('app.get("/api/summons/mine"'), routes.indexOf('app.get("/api/summons"'));
  assert.match(mine, /user_id=\? AND all_hands=0 OR all_hands=1/);
  // A personal summons names a reason meant for that person, so it wins.
  assert.match(mine, /ORDER BY all_hands ASC, id DESC/);
  const post = routes.slice(routes.indexOf('app.post("/api/summons"'), routes.indexOf('app.post("/api/summons/:id/clear"'));
  assert.match(post, /const allHands = req\.body\?\.allHands === true/);
  // Raising a second all-hands returns the live one instead of duplicating.
  assert.match(post, /alreadyActive: true, allHands: true/);
  // It is still one row, so the existing clear route stops it for everybody.
  assert.match(post, /INSERT INTO manager_summons \(org_id, user_id, reason, raised_by, raised_by_name, raised_at, all_hands\)[\s\S]{0,80}VALUES \(\?, \?, \?, \?, \?, \?, 1\)/);
});

test("the two kinds of summons cannot collide in the database", () => {
  // A personal summons for a manager who also raised an all-hands would share
  // user_id, so the personal uniqueness index has to exclude all-hands rows.
  assert.match(storage, /ON manager_summons\(org_id, user_id\) WHERE cleared_at IS NULL AND all_hands = 0/);
  assert.match(storage, /ON manager_summons\(org_id\) WHERE cleared_at IS NULL AND all_hands = 1/);
  // The personal path must mark itself as not-all-hands, or it would alarm
  // the whole company.
  const post = routes.slice(routes.indexOf('app.post("/api/summons"'), routes.indexOf('app.post("/api/summons/:id/clear"'));
  assert.match(post, /raised_at, all_hands\)[\s\S]{0,80}VALUES \(\?, \?, \?, \?, \?, \?, 0\)/);
  assert.match(post, /AND all_hands=0 AND cleared_at IS NULL/, "the duplicate check is per-person only");
});

test("only a manager can call everyone in", () => {
  const post = routes.slice(routes.indexOf('app.post("/api/summons"'), routes.indexOf('app.post("/api/summons/:id/clear"'));
  // The gate is the first thing in the handler, before the all-hands branch.
  assert.ok(post.indexOf("requireManagerOrAdmin") < post.indexOf("allHands"),
    "the manager check must run before the all-hands branch");
});
