import test from "node:test";
import assert from "node:assert/strict";

import { buildTransferScorecardWindows } from "../server/manager-scorecard";

test("transfer scorecard exposes the requested inclusive date ranges", () => {
  const windows = buildTransferScorecardWindows("2026-08-02");

  assert.deepEqual(Object.keys(windows), ["today", "3d", "7d", "14d", "30d", "90d", "mtd"]);
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

test("month to date starts on the 1st and grows through the month", () => {
  // The one window that is not "the last N days". On the 2nd it covers two
  // days; comparing it against the fixed 30-day window early in a month would
  // quietly mislead, so it is labelled for what it is.
  const w = buildTransferScorecardWindows("2026-08-02").mtd;
  assert.deepEqual(w, { startDate: "2026-08-01", endDate: "2026-08-02", days: 2, label: "Month to date" });
  // On the 1st it is a single day, not an empty or negative window.
  const first = buildTransferScorecardWindows("2026-08-01").mtd;
  assert.deepEqual(first, { startDate: "2026-08-01", endDate: "2026-08-01", days: 1, label: "Month to date" });
  // And it reaches the full month at the end of a 31-day one.
  const last = buildTransferScorecardWindows("2026-08-31").mtd;
  assert.equal(last.startDate, "2026-08-01");
  assert.equal(last.days, 31);
});
