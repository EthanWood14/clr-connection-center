import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCheckinDigestHtml, digestStatus, type DigestSubject } from "../server/checkin-digest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");

/**
 * "Don't show Skyler being late in the email this morning" — said at 7:27am,
 * before he had checked in, with the digest due at 10. Two things had to be
 * true for that to be possible: an excused late must not be listed as a late,
 * and a manager must be able to excuse a late before the check-in row exists.
 */

const subject = (over: Partial<DigestSubject>): DigestSubject => ({
  name: "Someone", sub: null, expectedStart: "07:00", checkin: null,
  lateCount: 0, lateOverLimit: false, scheduledOff: false, noSchedule: false,
  absenceExcused: false, excuseReason: null, startPassed: true, ...over,
});

test("an excused late is excused, not late — in the count, the list and the subject line", () => {
  const s = subject({ name: "Skyler", checkin: { on_time: 0, minutes_late: 26, late_excused: true, checked_in_at: "2026-09-14T14:26:00.000Z" }, excuseReason: "Excused by Ethan" });
  assert.equal(digestStatus(s), "excused");
  // An unexcused late is still a late.
  assert.equal(digestStatus(subject({ checkin: { on_time: 0, minutes_late: 26, late_excused: false } })), "late");
  const html = buildCheckinDigestHtml("2026-09-14", [s, subject({ name: "On Time", checkin: { on_time: 1, minutes_late: 0 } })]);
  assert.match(html, /Excused:<\/strong> Skyler — Excused by Ethan/);
  assert.doesNotMatch(html, /26 min late/);
});

test("before the check-in exists, an advance excuse makes the person excused rather than missing", () => {
  const board = routes.slice(routes.indexOf("function buildCheckinBoard("), routes.indexOf("function buildCheckinBoard(") + 6000);
  assert.match(board, /getApprovedAdvanceLateExcusesForDate\(orgId, date\)/);
  assert.match(board, /const absenceExcused = !ci && \(absence != null \|\| timeOff \|\| advanceLate != null\);/);
  assert.match(board, /"advance_late"/);
  // The digest carries the reason for it.
  const digest = routes.slice(routes.indexOf("async function sendCheckinDigest("), routes.indexOf("async function sendCheckinDigest(") + 3000);
  assert.match(digest, /getApprovedAdvanceLateExcusesForDate\(orgId, date\)/);
});

test("the excuse lands on the check-in row the moment it is saved, inside the same transaction", () => {
  const save = storage.slice(storage.indexOf("export function saveCheckin("), storage.indexOf("export function getApprovedAdvanceLateExcusesForDate("));
  assert.match(save, /kind='late' AND status='approved'/);
  assert.match(save, /if \(Number\(row\.on_time\) === 0 && !row\.late_excused\)/);
  assert.match(save, /SET late_excused=1, excused_by=\?, excused_at=\?, excuse_reason=\?/);
  assert.match(save, /SET checkin_id=COALESCE\(checkin_id, \?\)/);
  // Inside the transaction, before tx.immediate().
  assert.ok(save.indexOf("kind='late' AND status='approved'") < save.indexOf("tx.immediate();"));
});

test("excuseLateInAdvance records an approved request, and excuses an existing late right away", () => {
  const fn = storage.slice(storage.indexOf("export function excuseLateInAdvance("), storage.indexOf("export function excuseLateInAdvance(") + 4000);
  assert.match(fn, /VALUES \(\?, 'user', \?, \?, 'late', \?, \?, \?, 'approved', 'admin'/);
  assert.match(fn, /ON CONFLICT\(org_id, subject_type, subject_id, attendance_date, kind\) DO UPDATE SET/);
  assert.match(fn, /if \(checkin && Number\(checkin\.on_time\) === 0 && !checkin\.late_excused\)/);
  assert.match(fn, /assertAttendanceSubjectInOrg\(orgId, "user", userId\)/);
});

test("an excuse can keep the person out of the digest entirely — not late, not excused, not there", () => {
  assert.match(storage, /ALTER TABLE attendance_excuse_requests ADD COLUMN hide_from_digest INTEGER NOT NULL DEFAULT 0/);
  assert.match(storage, /export function digestHiddenUserIds\(/);
  assert.match(storage, /hide_from_digest=excluded\.hide_from_digest/);
  const digest = routes.slice(routes.indexOf("async function sendCheckinDigest("), routes.indexOf("async function sendCheckinDigest(") + 4000);
  assert.match(digest, /const hidden = storageExtra\.digestHiddenUserIds\(orgId, date\);/);
  // Dropped BEFORE counting and rendering, so the subject line can't count them either.
  assert.ok(digest.indexOf("digestHiddenUserIds") < digest.indexOf("anyoneExpected(all)"));
  assert.match(digest, /clrs\.filter\(\(s: any\) => !hidden\.has\(Number\(s\.userId\)\)\)/);
  const route = routes.slice(routes.indexOf('app.post("/api/checkin/advance-excuse"'), routes.indexOf('app.post("/api/checkin/manual-lates"'));
  assert.match(route, /hideFromDigest: req\.body\?\.omitFromDigest === true/);
});

test("managers reach it at POST /api/checkin/advance-excuse, and nobody excuses themselves", () => {
  const route = routes.slice(routes.indexOf('app.post("/api/checkin/advance-excuse"'), routes.indexOf('app.post("/api/checkin/manual-lates"'));
  assert.match(route, /requireManagerOrAdmin\(req, res\)/);
  assert.match(route, /userId === actorId && actor\?\.role !== "admin"/);
  assert.match(route, /storageExtra\.excuseLateInAdvance\(\{\s*\n\s*orgId, userId, date, reason, adminUserId: actorId,/);
});
