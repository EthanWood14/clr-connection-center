import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("../server/storage.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../client/src/pages/check-ins.tsx", import.meta.url), "utf8");

test("managers can record a late without pretending a check-in occurred", () => {
  assert.match(routes, /app\.post\("\/api\/checkin\/manual-lates"/);
  assert.match(routes, /if \(!requireManagerOrAdmin\(req, res\)\) return/);
  assert.match(routes, /if \(!row\.absenceEligible \|\| !row\.expectedStart\)/);
  assert.match(storage, /export function markMissingCheckinLate/);
  assert.match(storage, /manually_marked_late, marked_late_by, marked_late_at, marked_late_reason/);
});

test("a real later check-in replaces a synthetic marked-late record", () => {
  assert.match(storage, /WHERE morning_checkins\.manually_marked_late=1/);
  assert.match(storage, /WHERE external_checkins\.manually_marked_late=1/);
});

test("the attendance UI distinguishes missing lates from real check-ins", () => {
  assert.match(page, /function MarkMissingLateAction/);
  assert.match(page, /Marked late · no check-in/);
  assert.match(page, /!row\.checkin\.manually_marked_late/);
});
