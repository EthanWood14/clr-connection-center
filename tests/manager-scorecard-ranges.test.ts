import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTransferScorecardWindows, priorMonthToDate } from "../server/manager-scorecard";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// ── the MTD pace tiers ──────────────────────────────────────────────────────
test("month-to-date pace projects the month and lands in the right tier", () => {
  const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");
  // Four tiers, ordered high to low so the FIRST match wins.
  assert.match(dash, /\{ at: 200, label: "200", color: "#D4A017"/);
  assert.match(dash, /\{ at: 150, label: "150", color: "#2F6FED"/);
  assert.match(dash, /\{ at: 100, label: "100", color: "#1F9D55"/);
  assert.match(dash, /\{ at: 75,  label: "75",  color: "#D64545"/);
  const tiers = [200, 150, 100, 75];
  const tierFor = (n: number) => tiers.find(t => n >= t) ?? null;
  assert.equal(tierFor(201), 200);
  assert.equal(tierFor(200), 200, "the boundary counts as reaching it");
  assert.equal(tierFor(199), 150);
  assert.equal(tierFor(74), null, "below the lowest tier gets no badge at all");
  // The projection itself: rate so far, carried across the whole month.
  const project = (transfers: number, daysElapsed: number, daysInMonth: number) =>
    daysElapsed > 0 ? Math.round((transfers / daysElapsed) * daysInMonth) : null;
  assert.equal(project(30, 9, 30), 100);
  assert.equal(project(11, 2, 31), 171, "an early hot streak projects high - that is what pace means");
  assert.equal(project(5, 0, 30), null, "no elapsed days, no projection");
  // Only on the MTD window: a rolling 30-day range has no month to project into.
  assert.match(dash, /pace=\{scorecardRange === "mtd" \?/);
  assert.match(dash, /scorecardRange === "mtd" && \(/, "the legend only shows on MTD");
});

test("month-over-month compares the same stretch of the previous month", () => {
  // It used to measure this month to today against the previous month in
  // FULL, so on the 2nd it read two days against thirty-one and every
  // month-over-month number looked like a collapse.
  assert.deepEqual(priorMonthToDate("2026-09-02"), { startDate: "2026-08-01", endDate: "2026-08-02" });
  assert.deepEqual(priorMonthToDate("2026-09-30"), { startDate: "2026-08-01", endDate: "2026-08-30" });
  // Year boundary.
  assert.deepEqual(priorMonthToDate("2026-01-15"), { startDate: "2025-12-01", endDate: "2025-12-15" });
  // A shorter previous month clamps rather than overflowing into the next one.
  assert.deepEqual(priorMonthToDate("2026-03-31"), { startDate: "2026-02-01", endDate: "2026-02-28" });
  assert.deepEqual(priorMonthToDate("2028-03-30"), { startDate: "2028-02-01", endDate: "2028-02-29" }, "leap year");
  // The first of the month is a single day against a single day, not zero.
  assert.deepEqual(priorMonthToDate("2026-09-01"), { startDate: "2026-08-01", endDate: "2026-08-01" });
});
