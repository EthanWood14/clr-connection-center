import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHOTGUN_BOUNCEBACK_AFTER_MS,
  SHOTGUN_BOUNCEBACK_END_DATE,
  SHOTGUN_BOUNCEBACK_START_DATE,
  canAcceptShotgunBounceback,
  decideShotgunBouncebackFire,
  isShotgunBouncebackWeekActive,
  pacificCalendarDate,
  shotgunBouncebackDueAt,
  shotgunBouncebackHasTransferOrAppointment,
  shotgunBouncebackPhoneKey,
} from "../shared/shotgun-bounceback";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

test("week window: 2026-09-18..2026-09-25 PT inclusive, then auto-off", () => {
  assert.equal(SHOTGUN_BOUNCEBACK_START_DATE, "2026-09-18");
  assert.equal(SHOTGUN_BOUNCEBACK_END_DATE, "2026-09-25");
  assert.equal(SHOTGUN_BOUNCEBACK_AFTER_MS, 35 * 60_000);
  assert.equal(isShotgunBouncebackWeekActive("2026-09-17"), false);
  assert.equal(isShotgunBouncebackWeekActive("2026-09-18"), true);
  assert.equal(isShotgunBouncebackWeekActive("2026-09-22"), true);
  assert.equal(isShotgunBouncebackWeekActive("2026-09-25"), true);
  assert.equal(isShotgunBouncebackWeekActive("2026-09-26"), false);
});

test("pacificCalendarDate and due-at are 35 minutes after created_at", () => {
  assert.equal(pacificCalendarDate(new Date("2026-09-18T15:00:00Z")), "2026-09-18");
  assert.equal(
    shotgunBouncebackDueAt("2026-09-18T17:00:00.000Z"),
    "2026-09-18T17:35:00.000Z",
  );
  assert.equal(shotgunBouncebackDueAt("nope"), null);
});

test("phone key matches Shotgun US-normalized keys", () => {
  assert.equal(shotgunBouncebackPhoneKey("+1 (555) 123-4567"), "5551234567");
  assert.equal(shotgunBouncebackPhoneKey("5551234567"), "5551234567");
});

test("transfer or appointment outcomes skip bounceback", () => {
  assert.equal(shotgunBouncebackHasTransferOrAppointment([{ outcomeType: "transfer" }]), true);
  assert.equal(shotgunBouncebackHasTransferOrAppointment([{ outcomeType: "appointment" }]), true);
  assert.equal(shotgunBouncebackHasTransferOrAppointment([{ outcomeType: "no_answer" }]), false);
  assert.equal(shotgunBouncebackHasTransferOrAppointment([]), false);
});

test("decideShotgunBouncebackFire: due + no outcome → fire; gates otherwise", () => {
  const created = "2026-09-18T17:00:00.000Z";
  const due = Date.parse(created) + SHOTGUN_BOUNCEBACK_AFTER_MS;
  const base = {
    nowMs: due + 1_000,
    createdAt: created,
    firedAt: null as string | null,
    status: "queued",
    hasTransferOrAppointment: false,
  };
  assert.deepEqual(decideShotgunBouncebackFire(base), { action: "fire", requeue: false });
  assert.deepEqual(decideShotgunBouncebackFire({ ...base, status: "done" }), { action: "fire", requeue: true });
  assert.deepEqual(decideShotgunBouncebackFire({ ...base, status: "offered" }), { action: "fire", requeue: true });
  assert.equal(decideShotgunBouncebackFire({ ...base, status: "claimed" }).action, "defer_claimed");
  assert.equal(decideShotgunBouncebackFire({ ...base, hasTransferOrAppointment: true }).action, "skip_has_outcome");
  assert.equal(decideShotgunBouncebackFire({ ...base, status: "cancelled" }).action, "skip_cancelled");
  assert.equal(decideShotgunBouncebackFire({ ...base, firedAt: created }).action, "skip_already_fired");
  assert.equal(decideShotgunBouncebackFire({ ...base, nowMs: due - 1 }).action, "skip_not_due");
  // After week ends: inactive
  assert.equal(
    decideShotgunBouncebackFire({ ...base, nowMs: Date.parse("2026-09-26T17:00:00.000Z") }).action,
    "skip_inactive",
  );
  // Created before week: inactive
  assert.equal(
    decideShotgunBouncebackFire({
      ...base,
      createdAt: "2026-09-17T17:00:00.000Z",
      nowMs: Date.parse("2026-09-17T17:40:00.000Z"),
    }).action,
    "skip_inactive",
  );
});

test("canAcceptShotgunBounceback: Ready CLR, fired, live, no outcome", () => {
  const base = {
    status: "queued",
    currentAssigneeId: null as number | null,
    requesterId: 7,
    bouncebackFiredAt: "2026-09-18T17:35:00.000Z",
    hasTransferOrAppointment: false,
    holdingOtherClaimed: false,
    optedOut: false,
    weekActive: true,
  };
  assert.deepEqual(canAcceptShotgunBounceback(base), { ok: true });
  assert.deepEqual(canAcceptShotgunBounceback({ ...base, status: "offered", currentAssigneeId: 9 }), { ok: true });
  assert.equal(canAcceptShotgunBounceback({ ...base, optedOut: true }).ok, false);
  assert.equal(canAcceptShotgunBounceback({ ...base, weekActive: false }).ok, false);
  assert.equal(canAcceptShotgunBounceback({ ...base, bouncebackFiredAt: null }).ok, false);
  assert.equal(canAcceptShotgunBounceback({ ...base, hasTransferOrAppointment: true }).ok, false);
  assert.equal(canAcceptShotgunBounceback({ ...base, holdingOtherClaimed: true }).ok, false);
  assert.equal(canAcceptShotgunBounceback({ ...base, status: "offered", currentAssigneeId: 7 }).ok, false);
  assert.equal(canAcceptShotgunBounceback({ ...base, status: "claimed", currentAssigneeId: 9 }).ok, false);
});

test("routes fire bouncebacks from advanceShotgun; GET surfaces bouncebacks; POST accept", () => {
  const routes = read("server/routes.ts");
  assert.match(routes, /fireShotgunBouncebacks\(shotgunDb\(\)/);
  assert.match(routes, /from "\.\/shotgun-bounceback"/);
  assert.match(routes, /bouncebacks,/);
  assert.match(routes, /bouncebackWeekActive:/);
  assert.match(routes, /bounceback_fired_at IS NOT NULL/);
  const post = routes.slice(
    routes.indexOf('app.post("/api/shotgun/:id/bounceback"'),
    routes.indexOf('app.post("/api/shotgun/:id/deny"'),
  );
  assert.match(post, /canAcceptShotgunBounceback/);
  assert.match(post, /response='bounceback_accepted'/);
  assert.match(post, /SET status='claimed',current_assignee_id=\?/);
  assert.match(post, /bounceback_fired_at IS NOT NULL/);
});

test("server helper joins outcomes by transfer_outcome_id and phone_key", () => {
  const server = read("server/shotgun-bounceback.ts");
  assert.match(server, /transfer_outcome_id/);
  assert.match(server, /outcome_type IN \('transfer','appointment'\)/);
  assert.match(server, /shotgunBouncebackPhoneKey/);
  assert.match(server, /bounceback_fired_at/);
});

test("storage migrates bounceback_fired_at; UI dock prompt wired", () => {
  assert.match(read("server/storage.ts"), /bounceback_fired_at/);
  assert.match(read("client/src/App.tsx"), /<ShotgunBouncebackPrompt \/>/);
  assert.match(read("client/src/App.tsx"), /ShotgunReclaimPrompt \/>\s*\n\s*<ShotgunBouncebackPrompt \/>/);
  const prompt = read("client/src/components/shotgun-bounceback-prompt.tsx");
  assert.match(prompt, /data-testid="shotgun-bounceback-prompt"/);
  assert.match(prompt, /data-testid="shotgun-bounceback-take"/);
  assert.match(prompt, /data-testid="shotgun-bounceback-call"/);
  assert.match(prompt, /Call in Dialpad/);
  assert.match(prompt, /const prepareDialpadCall = useDialpadCall\(\)/);
  assert.match(prompt, /prepareDialpadCall\(target\.phone\)[\s\S]*?accept\.mutateAsync\(target\.id\)\.then\(\(\) => dialpad\.complete\(\)\)\.catch\(\(\) => dialpad\.cancel\(\)\)/);
  assert.match(prompt, /`\/api\/shotgun\/\$\{id\}\/bounceback`/);
  assert.match(prompt, /TAKE BOUNCEBACK/);
});

test("release notes cover 4.122.10 bounceback week", () => {
  const notes = read("shared/release-notes.ts");
  assert.match(notes, /version: "4\.122\.10"/);
  assert.match(notes, /35 minutes/);
  assert.match(notes, /2026-09-18/);
  assert.match(notes, /2026-09-25/);
});
