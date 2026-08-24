import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("the schedule warning states the attendance commitment plainly", () => {
  const notice = read("client/src/components/schedule-accountability-notice.tsx");

  assert.match(notice, /Your schedule is your commitment/);
  assert.match(notice, /accountable for\s*keeping this schedule/);
  assert.match(notice, /least restrictive schedule permitted for your role/);
  assert.match(notice, /role="alert"/);
});

test("the warning appears everywhere a check-in schedule is used or entered", () => {
  for (const path of [
    "client/src/pages/check-ins.tsx",
    "client/src/pages/weekly-schedule.tsx",
    "client/src/pages/portal.tsx",
  ]) {
    assert.match(read(path), /<ScheduleAccountabilityNotice\s*\/>/, `${path} must show the schedule warning`);
  }
});
