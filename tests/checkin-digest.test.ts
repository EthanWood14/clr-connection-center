import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  type DigestSubject,
  digestStatus,
  anyoneExpected,
  buildCheckinDigestHtml,
} from "../server/checkin-digest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

const subject = (over: Partial<DigestSubject> = {}): DigestSubject => ({
  name: "Sample Person", sub: null, expectedStart: "08:00", checkin: null,
  lateCount: 0, lateOverLimit: false, scheduledOff: false, noSchedule: false,
  absenceExcused: false, startPassed: true, ...over,
});

test("on time and late are decided by the flag, not by truthiness", () => {
  assert.equal(digestStatus(subject({ checkin: { on_time: 1 } })), "on_time");
  assert.equal(digestStatus(subject({ checkin: { on_time: 0, minutes_late: 12 } })), "late");
  // on_time 0 is falsy — a truthiness check here would call a late arrival "on time".
  assert.notEqual(digestStatus(subject({ checkin: { on_time: 0 } })), "on_time");
});

test("a check-in with no schedule to judge it by is never called late", () => {
  // No expected start means no basis for lateness — reporting it as late would
  // invent a fact about someone who did check in.
  const s = subject({ checkin: { on_time: null }, noSchedule: true, expectedStart: null });
  assert.equal(digestStatus(s), "unjudged");
  assert.notEqual(digestStatus(s), "late");
});

test("missing requires the start time to have passed", () => {
  assert.equal(digestStatus(subject({ checkin: null, startPassed: true })), "missing");
  // Before someone is due, not having checked in yet is not a failure.
  assert.equal(digestStatus(subject({ checkin: null, startPassed: false })), "pending");
});

test("days off and excused absences outrank a missing check-in", () => {
  assert.equal(digestStatus(subject({ scheduledOff: true, startPassed: true })), "off");
  assert.equal(digestStatus(subject({ absenceExcused: true, startPassed: true })), "excused");
  // Someone with no schedule at all is not reported as a no-show.
  assert.equal(digestStatus(subject({ noSchedule: true, startPassed: true })), "unjudged");
});

test("nobody expected means nothing to send — this is what silences weekends", () => {
  const weekend = [subject({ scheduledOff: true }), subject({ scheduledOff: true })];
  assert.equal(anyoneExpected(weekend), false);
  // Someone scheduled on makes it a working day.
  assert.equal(anyoneExpected([...weekend, subject()]), true);
  // So does an actual check-in, even from someone with no schedule on file.
  assert.equal(anyoneExpected([subject({ noSchedule: true, checkin: { on_time: null } })]), true);
});

test("the digest names who was late and who never showed", () => {
  const html = buildCheckinDigestHtml("2026-08-05", [
    subject({ name: "Late Person", checkin: { on_time: 0, minutes_late: 14, checked_in_at: "2026-08-05T15:14:00.000Z" } }),
    subject({ name: "Missing Person", checkin: null, startPassed: true }),
    subject({ name: "Punctual Person", checkin: { on_time: 1, checked_in_at: "2026-08-05T14:55:00.000Z" } }),
    subject({ name: "Off Person", scheduledOff: true }),
  ]);
  assert.match(html, /Late Person/);
  assert.match(html, /14 min late/);
  assert.match(html, /Missing Person/);
  assert.match(html, /No check-in/);
  assert.match(html, /Punctual Person/);
  assert.match(html, /Off Person|Off today/);
});

test("a clean day says so instead of rendering an empty table", () => {
  const html = buildCheckinDigestHtml("2026-08-05", [
    subject({ name: "A", checkin: { on_time: 1, checked_in_at: "2026-08-05T14:55:00.000Z" } }),
  ]);
  assert.match(html, /checked in on time/i);
  assert.ok(!/No check-in<\/td>/.test(html), "no attention rows on a clean day");
});

test("names are escaped — a digest must not be an injection vector", () => {
  const html = buildCheckinDigestHtml("2026-08-05", [
    subject({ name: `<script>alert(1)</script>`, checkin: null, startPassed: true }),
  ]);
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw markup must not survive");
  assert.match(html, /&lt;script&gt;/);
});

test("repeat offenders are flagged against the 90-day allowance", () => {
  const html = buildCheckinDigestHtml("2026-08-05", [
    subject({ name: "Repeat", checkin: { on_time: 0, minutes_late: 5 }, lateCount: 5, lateOverLimit: true }),
  ]);
  assert.match(html, /5 lates \/ 90d/);
});

test("an excused late is still shown, but marked", () => {
  const html = buildCheckinDigestHtml("2026-08-05", [
    subject({ name: "Excused Late", checkin: { on_time: 0, minutes_late: 9, late_excused: true }, excuseReason: "Doctor appointment" }),
  ]);
  assert.match(html, /Excused Late/);
  assert.match(html, /excused — Doctor appointment/);
});

test("an excused absence includes its escaped reason", () => {
  const html = buildCheckinDigestHtml("2026-08-05", [
    subject({ name: "Excused Absence", absenceExcused: true, excuseReason: "Family <emergency>" }),
  ]);
  assert.match(html, /Excused Absence — Family &lt;emergency&gt;/);
  assert.ok(!html.includes("Family <emergency>"));
});

test("the digest runs at 10am Pacific, not UTC", () => {
  const cron = routes.slice(routes.indexOf(`cron.schedule("0 10 * * *"`));
  assert.ok(cron.startsWith(`cron.schedule("0 10 * * *"`), "must be scheduled at 10:00");
  const body = cron.slice(0, cron.indexOf("app.post("));
  assert.match(body, /timezone: "America\/Los_Angeles"/,
    "without the timezone option the container clock (UTC) would fire it at 3am Pacific");
});

test("the digest and the board screen read the same data", () => {
  // Two copies of the joins would eventually disagree about who was late.
  assert.match(routes, /function buildCheckinBoard\(orgId: number, date: string\)/);
  const send = routes.slice(routes.indexOf("async function sendCheckinDigest"));
  assert.match(send.slice(0, 400), /buildCheckinBoard\(orgId, date\)/,
    "the digest must not re-implement the board query");
});

test("recipients include active managers and configured manager email recipients", () => {
  const send = routes.slice(
    routes.indexOf("async function sendCheckinDigest"),
    routes.indexOf(`cron.schedule("0 10 * * *"`),
  );
  assert.match(send, /attendanceManagerEmails\(orgId\)/,
    "configured recipients such as Scott must not depend on their C3 permission role");
  assert.match(send, /if \(!managers\.length\) return "skipped"/, "no managers means no send");
  assert.match(send, /if \(!cfg\.enabled\) return "skipped"/, "must respect the check-in feature switch");
  const fn = routes.slice(routes.indexOf("function attendanceManagerEmails"));
  assert.match(fn.slice(0, 1000), /manager_emails/,
    "the shared helper must merge explicit manager recipients");
});

test("the manual trigger is manager-gated", () => {
  const route = routes.slice(routes.indexOf(`app.post("/api/checkin/digest/send-now"`));
  assert.match(route.slice(0, 600), /requireManagerOrAdmin\(req, res\)/,
    "anyone could otherwise mail the whole management team on demand");
});
