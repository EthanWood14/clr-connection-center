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
