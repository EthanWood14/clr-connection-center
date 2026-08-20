import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CLR_TRAINING_WORKDAY_THRESHOLD,
  clrTrainingStatus,
} from "../server/clr-training-status";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const manager = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");
const stats = readFileSync(join(root, "client/src/pages/team-stats.tsx"), "utf8");
const profiles = readFileSync(join(root, "client/src/pages/clr-profiles.tsx"), "utf8");
const profile = readFileSync(join(root, "client/src/pages/clr-profile.tsx"), "utf8");
const classic = readFileSync(join(root, "client/src/pages/leaderboard.tsx"), "utf8");
const dashboard = readFileSync(join(root, "client/src/pages/dashboard.tsx"), "utf8");

test("training ends exactly after 20 completed business workdays", () => {
  assert.equal(CLR_TRAINING_WORKDAY_THRESHOLD, 20);
  assert.deepEqual(clrTrainingStatus(19), { activeWorkdays: 19, inTraining: true });
  assert.deepEqual(clrTrainingStatus(20), { activeWorkdays: 20, inTraining: false });
  assert.deepEqual(clrTrainingStatus(21), { activeWorkdays: 21, inTraining: false });
  assert.deepEqual(clrTrainingStatus(-4), { activeWorkdays: 0, inTraining: true });
});

test("workday count uses real CLR activity and excludes weekends", () => {
  const block = routes.slice(routes.indexOf("const activeRows"), routes.indexOf("const byId"));
  assert.match(block, /lead_outcomes/);
  assert.match(block, /daily_call_logs/);
  assert.match(block, /callsync_activity_events/);
  assert.match(block, /eod_reports/);
  assert.match(block, /messages_sent > 0/);
  assert.match(block, /appointments > 0/);
  assert.match(block, /dialpad_daily_stats/);
  assert.match(block, /calls > 0/);
  assert.match(block, /morning_checkins/);
  assert.match(block, /time_clock_entries/);
  assert.match(block, /strftime\('%w', d\) NOT IN \('0', '6'\)/);
  assert.match(block, /UNION/, "multiple activity sources must collapse to one workday");
});

test("every CLR stats surface renders the shared In training marker", () => {
  for (const [label, source] of [
    ["team stats", stats],
    ["manager stats", manager],
    ["CLR profile list", profiles],
    ["CLR profile", profile],
    ["classic team stats", classic],
  ] as const) {
    assert.match(source, /ClrTrainingBadge/, `${label} is missing the marker`);
  }
  assert.match(dashboard, /statsName: row\.inTraining \? `\$\{row\.name\} · In training`/);
});

test("trainees remain visible but do not enter the rolling team average", () => {
  const average = manager.slice(manager.indexOf("let teamSum = 0"), manager.indexOf("row.__mean"));
  assert.match(average, /if \(s\.inTraining\) \{ teamTrainingExcluded\+\+; continue; \}/);
  assert.match(manager, /In-training CLRs stay visible but are excluded from that average/);
});
