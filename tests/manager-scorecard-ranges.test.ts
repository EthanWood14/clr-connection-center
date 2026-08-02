import test from "node:test";
import assert from "node:assert/strict";

import { buildTransferScorecardWindows } from "../server/manager-scorecard";

test("transfer scorecard exposes the requested inclusive date ranges", () => {
  const windows = buildTransferScorecardWindows("2026-08-02");

  assert.deepEqual(Object.keys(windows), ["3d", "7d", "14d", "30d", "90d"]);
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
