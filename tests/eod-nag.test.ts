import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  eodNagStage, eodNagLocks, eodNagChimes, minutesToNextStage, EOD_NAG_STEPS,
} from "../server/eod-nag";
import { wallClockInTz, eodIsOverdue, EOD_DUE_LABEL } from "../server/business-day";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gate = readFileSync(join(root, "client/src/components/eod-lock-gate.tsx"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

const at = (hour: number, minute = 0, over: Partial<Parameters<typeof eodNagStage>[0]> = {}) =>
  eodNagStage({ submitted: false, hour, minute, expectedToday: true, ...over });

test("nothing nags before 4pm", () => {
  assert.equal(at(9), "none");
  assert.equal(at(15, 59), "none");
});

test("the ladder escalates through the afternoon", () => {
  // Two rungs. The old five went 4:00 banner, 4:30 pulse, 5:00 chime, 5:30
  // lock; putting the siren at 4:15 made every later rung gentler than the one
  // before it, and a ladder that gets easier as you climb is not a ladder.
  assert.equal(at(15, 59), "none");
  assert.equal(at(16, 0), "due");
  assert.equal(at(16, 14), "due", "the warning gets its full fifteen minutes");
  assert.equal(at(16, 15), "siren");
  assert.equal(at(17, 30), "siren");
  assert.equal(at(23, 59), "siren", "it does not lapse at the end of the day");
});

test("filing the report stops the nagging immediately, at any hour", () => {
  for (const h of [16, 17, 18, 22]) {
    assert.equal(at(h, 45, { submitted: true }), "none", `still nagging at ${h}:45 after submitting`);
  }
});

test("a day no report is expected never nags", () => {
  assert.equal(at(18, 0, { expectedToday: false }), "none");
});

test("the alarm and the lock are the same rung", () => {
  // On purpose. An alarm you can click past is a notification, and a lock with
  // no alarm is something people sit in front of without noticing.
  assert.equal(eodNagLocks("none"), false);
  assert.equal(eodNagLocks("due"), false, "4pm warns; it does not take the app away");
  assert.equal(eodNagLocks("siren"), true);
  assert.equal(eodNagChimes("due"), false, "the first rung is quiet");
  assert.equal(eodNagChimes("siren"), true);
});

test("the rungs are ordered and none share a time", () => {
  const mins = EOD_NAG_STEPS.map((s) => s.atMinutes);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b));
  assert.equal(new Set(mins).size, mins.length);
  assert.equal(EOD_NAG_STEPS[0].atMinutes, 16 * 60, "the first rung is 4pm");
});

test("the countdown to the next rung is honest", () => {
  assert.equal(minutesToNextStage({ submitted: false, hour: 15, minute: 30, expectedToday: true }), 30);
  assert.equal(minutesToNextStage({ submitted: false, hour: 16, minute: 5, expectedToday: true }), 10);
  assert.equal(minutesToNextStage({ submitted: false, hour: 18, minute: 0, expectedToday: true }), null);
  assert.equal(minutesToNextStage({ submitted: true, hour: 9, minute: 0, expectedToday: true }), null);
});

test("nagging does NOT redefine lateness", () => {
  // The owner moved the late deadline to 4pm the NEXT business day earlier;
  // this ladder is a prompt on the day and must not touch that.
  assert.match(EOD_DUE_LABEL, /next business day/);
  // A report for Friday, checked Friday evening, is not yet late.
  assert.equal(eodIsOverdue("2026-08-28", "America/Los_Angeles", new Date("2026-08-29T02:00:00Z")), false);
  // The nag module must not be reachable from the lateness calculation.
  const businessDay = readFileSync(join(root, "server/business-day.ts"), "utf8");
  assert.ok(!businessDay.includes("eod-nag"), "lateness must not depend on the nag ladder");
  const nag = readFileSync(join(root, "server/eod-nag.ts"), "utf8");
  assert.ok(!/late|overdue/i.test(nag.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")),
    "the nag ladder must not compute lateness");
});

test("the wall clock is read in the CLR's own timezone", () => {
  // 2026-08-28T23:30:00Z is 4:30pm in Los Angeles.
  const la = wallClockInTz("America/Los_Angeles", new Date("2026-08-28T23:30:00Z"));
  assert.deepEqual(la, { hour: 16, minute: 30 });
  const ny = wallClockInTz("America/New_York", new Date("2026-08-28T23:30:00Z"));
  assert.deepEqual(ny, { hour: 19, minute: 30 });
});

test("the endpoint reports today's rung and the app acts on it", () => {
  const block = routes.slice(
    routes.indexOf("// Today's report is expected at 4pm"),
    routes.indexOf("// Admin-only: Complete System Manual PDF."),
  );
  assert.ok(block.length > 0, "the lock-status route must compute today's rung");
  assert.match(block, /eodNagStage\(\{/);
  assert.match(block, /expectedToday: dow >= 1 && dow <= 5/, "weekends must not nag");
  assert.match(block, /eodNagLocks\(stage\)/);
  // The banner is pinned and has no dismiss control.
  assert.match(gate, /sticky top-0 z-50/);
  const gateCode = gate.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  assert.ok(!/dismiss|onClose|setHidden/i.test(gateCode), "the banner must not be dismissable");
  assert.match(gate, /data-testid=\{"eod-nag-" \+ stage\}/);
  // Sound is synthesised, so there is no asset to 404.
  assert.match(gate, /createOscillator/);
  assert.ok(!/new Audio\(|\.mp3|\.wav/.test(gate), "no audio file to fail to load");
});

test("a CLR can always reach the form the nag is demanding", () => {
  // Both the banner and the overlay must stand down on the EOD page itself,
  // or the demand would be impossible to satisfy.
  assert.match(gate, /location !== "\/eod-report"/);
  assert.equal((gate.match(/location !== "\/eod-report"/g) ?? []).length, 2,
    "both the overlay and the banner must stand down on the EOD page");
});

test("the siren fires at 4:15 and only for a day a report is expected", () => {
  // A siren on somebody's day off is how an alarm gets ignored for good.
  assert.equal(at(16, 15, { expectedToday: false }), "none");
  assert.equal(at(16, 15, { submitted: true }), "none");
  assert.equal(at(16, 15), "siren");
});

test("the takeover cannot be dismissed, only satisfied", () => {
  const siren = readFileSync(join(root, "client/src/components/eod-siren.tsx"), "utf8");
  // One button, and it goes to the form. No close, no later, no X.
  assert.match(siren, /data-testid="eod-siren-go"/);
  // Prose may say "C3 is closed"; what must not exist is a CONTROL that
  // closes it. Only two buttons: go to the form, and mute the noise.
  const buttons = [...siren.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons.filter((b) => b.startsWith("eod-siren-")).sort(),
    ["eod-siren-go", "eod-siren-rescued", "eod-siren-silence"]);
  assert.doesNotMatch(siren, /onClick=\{[^}]*(dismiss|onClose|setOpen\(false\))/i);
  // Escape is the reflex, so it is swallowed in the capture phase.
  assert.match(siren, /if \(e\.key === "Escape"\)/);
  assert.match(siren, /addEventListener\("keydown", onKey, true\)/);
  // Silencing stops the sound and nothing else -- the gate is unaffected.
  assert.match(siren, /The report is still required/);
});

test("everything on screen is saved before the screen is taken", () => {
  const siren = readFileSync(join(root, "client/src/components/eod-siren.tsx"), "utf8");
  const rescue = readFileSync(join(root, "client/src/lib/draft-rescue.ts"), "utf8");
  // Once, in a useMemo: a sweep after the takeover has rendered would only
  // ever capture the takeover's own controls.
  assert.match(siren, /useMemo<RescuedDraft \| null>\(/);
  assert.match(siren, /rescueDrafts\("EOD report alarm at 4:15pm"\)/);
  // And it says so, or losing the screen reads as losing the work.
  assert.match(siren, /data-testid="eod-siren-rescued"/);
  // A credential in localStorage is worse than retyping one.
  assert.match(rescue, /type === "password"/);
  assert.match(rescue, /current-password/);
});

test("the siren is for TODAY's report, not a backlog", () => {
  const gate = readFileSync(join(root, "client/src/components/eod-lock-gate.tsx"), "utf8");
  assert.match(gate, /const showSiren = showOverlay && nagStage === "siren" && !today\?\.submitted/);
  // Catching up on last Tuesday keeps the calm overlay.
  assert.match(gate, /\{showOverlay && !showSiren &&/);
  // And the EOD form itself stays reachable, or there is no way to comply.
  assert.match(gate, /location !== "\/eod-report"/);
});

test("both alarms share one flash rate, because it is a safety number", () => {
  const alarm = readFileSync(join(root, "client/src/lib/alarm.ts"), "utf8");
  const summons = readFileSync(join(root, "client/src/components/manager-summons-alarm.tsx"), "utf8");
  const siren = readFileSync(join(root, "client/src/components/eod-siren.tsx"), "utf8");
  assert.match(alarm, /export const ALARM_FLASH_MS = 500/);
  // 500ms is 2Hz, under the three-per-second photosensitive-seizure threshold.
  assert.ok(500 >= 1000 / 3, "the flash must stay under 3Hz");
  assert.match(summons, /ALARM_FLASH_MS/);
  assert.match(siren, /useAlarmFlash\(true\)/);
  // Neither may keep its own copy of the siren.
  for (const src of [summons, siren]) assert.doesNotMatch(src, /function startSiren\(/);
  // Reduced motion still gets the takeover, just not the strobe.
  assert.match(alarm, /prefers-reduced-motion: reduce/);
  assert.match(siren, /reduced\s*$/m);
});
