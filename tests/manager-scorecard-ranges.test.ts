import test from "node:test";
import assert from "node:assert/strict";

import { buildTransferScorecardWindows } from "../server/manager-scorecard";

test("transfer scorecard exposes the requested inclusive date ranges", () => {
  const windows = buildTransferScorecardWindows("2026-08-02");

  assert.deepEqual(Object.keys(windows), ["today", "3d", "7d", "14d", "30d", "90d"]);
  assert.deepEqual(windows["7d"], {
    startDate: "2026-07-26",
    endDate: "2026-08-02",
    days: 8,
    label: "7 days",
  });
  assert.equal(windows["3d"].startDate, "2026-07-30");
  assert.equal(windows["14d"].startDate, "2026-07-19");
  assert.equal(windows["30d"].startDate, "2026-07-03");
  assert.equal(windows["90d"].startDate, "2026-05-04");
});

test("the today window is a single day, labelled as one", () => {
  const windows = buildTransferScorecardWindows("2026-08-02");
  // Both endpoints are the same date: today only, not "today and yesterday".
  assert.deepEqual(windows.today, {
    startDate: "2026-08-02",
    endDate: "2026-08-02",
    days: 1,
    label: "Today",
  });
  // "0 days" would be the naive label and reads as an empty range.
  assert.notEqual(windows.today.label, "0 days");
});

test("today stays a single day across a month boundary", () => {
  const w = buildTransferScorecardWindows("2026-09-01").today;
  assert.equal(w.startDate, "2026-09-01");
  assert.equal(w.endDate, "2026-09-01");
});
