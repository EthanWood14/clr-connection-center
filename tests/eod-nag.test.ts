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
  assert.equal(at(16, 0), "due");
  assert.equal(at(16, 29), "due");
  assert.equal(at(16, 30), "urgent");
  assert.equal(at(17, 0), "alarm");
  assert.equal(at(17, 29), "alarm");
  assert.equal(at(17, 30), "locked");
  assert.equal(at(23, 59), "locked");
});

test("filing the report stops the nagging immediately, at any hour", () => {
  for (const h of [16, 17, 18, 22]) {
    assert.equal(at(h, 45, { submitted: true }), "none", `still nagging at ${h}:45 after submitting`);
  }
});

test("a day no report is expected never nags", () => {
  assert.equal(at(18, 0, { expectedToday: false }), "none");
});

test("only the last rung takes the app away, and only the loud ones make noise", () => {
  assert.equal(eodNagLocks("alarm"), false, "5pm must not lock — the banner escalates first");
  assert.equal(eodNagLocks("locked"), true);
  assert.equal(eodNagChimes("due"), false);
  assert.equal(eodNagChimes("urgent"), false, "the pulse is visual; sound starts at the alarm rung");
  assert.equal(eodNagChimes("alarm"), true);
  assert.equal(eodNagChimes("locked"), true);
});

test("the rungs are ordered and none share a time", () => {
  const mins = EOD_NAG_STEPS.map((s) => s.atMinutes);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b));
  assert.equal(new Set(mins).size, mins.length);
  assert.equal(EOD_NAG_STEPS[0].atMinutes, 16 * 60, "the first rung is 4pm");
});

test("the countdown to the next rung is honest", () => {
  assert.equal(minutesToNextStage({ submitted: false, hour: 15, minute: 30, expectedToday: true }), 30);
  assert.equal(minutesToNextStage({ submitted: false, hour: 17, minute: 0, expectedToday: true }), 30);
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
