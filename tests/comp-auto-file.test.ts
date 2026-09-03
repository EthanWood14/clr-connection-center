import { test } from "node:test";
import assert from "node:assert/strict";
import {
  // when
  AUTO_FILE_DAY_OF_MONTH, AUTO_FILE_CATCHUP_MONTHS, AUTO_FILE_EARLIEST_PERIOD, AUTO_FILE_MIN_TRANSFERS,
  autoFileDueDate, autoFileTargetPeriod, autoFileDuePeriods, autoFileIsDue,
  monthLabel, lastDayOfPeriod, previousPeriod, nextPeriod, addPeriodMonths,
  // already submitted
  TRANSFER_COMP_CATEGORY, COVERING_STATUSES, isTransferCompCategory, periodsNamedIn,
  compRequestCoversPeriod, findCoveringRequests, untaggedTransferRequests,
  // pool + bumps
  BUMP_EFFECTIVE_FROM_PERIOD, BUMP_MIN_TRANSFERS, BUMP_GROUP_SIZE, BUMP_MIN_POOL,
  BUMP_STEP_BPS, BUMP_COMBINE, PLACEMENT_SCORE_HIGHER_IS_BETTER,
  bumpPool, topTieGroup, bottomTieGroup, competitionRanks, rankMetric, metricValue,
  // money
  roundCents, applyBumps, formatMoneyCents, formatBps,
  // plan
  planTransferCompAutoFile, autoFiledRequestRow,
  type ClrMonthStats, type CompRequestRow, type BumpDetail, type RankEntry,
} from "../server/comp-auto-file";
import { resolveEmailTransferCompRateCents } from "../server/comp-rate";

// ── fixtures ────────────────────────────────────────────────────────────────

/** Nine CLRs, all on 100 transfers ($10.00 tier → $1,000.00 base each). */
function nineClrs(opts: { writeUp: number[]; placement: number[] }): ClrMonthStats[] {
  const out: ClrMonthStats[] = [];
  for (let i = 0; i < 9; i += 1) {
    out.push({
      userId: i + 1,
      name: `CLR ${i + 1}`,
      transfers: 100,
      writeUpPct: opts.writeUp[i],
      placementScore: opts.placement[i],
    });
  }
  return out;
}

const DESC = [99, 95, 90, 80, 70, 60, 50, 40, 30];
const ASC = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const BASE_CENTS = 100 * 1000; // 100 transfers x the $10.00 volume tier

const entries = (values: number[]): RankEntry[] =>
  values.map((value, i) => ({ userId: i + 1, value }));

const itemFor = (plan: ReturnType<typeof planTransferCompAutoFile>, userId: number) => {
  const hit = plan.file.filter((f) => f.userId === userId);
  assert.equal(hit.length, 1, `expected exactly one filed request for CLR ${userId}`);
  return hit[0];
};

// ────────────────────────────────────────────────────────────────────────────
// RULE 1 — WHEN: the 2nd, for the previous month, and never a month that
// silently never files.
// ────────────────────────────────────────────────────────────────────────────

test("the request is for the PREVIOUS calendar month, due on the 2nd", () => {
  assert.equal(AUTO_FILE_DAY_OF_MONTH, 2);
  assert.equal(autoFileTargetPeriod("2026-11-02"), "2026-10");
  assert.equal(autoFileTargetPeriod("2027-01-02"), "2026-12"); // year boundary
  assert.equal(autoFileDueDate("2026-11-17"), "2026-11-02");
});

test("nothing files before the 2nd", () => {
  // The 1st of November: October has not come due yet. September already had
  // its own 2nd, so a never-run ledger still owes September — not October.
  assert.deepEqual(autoFileDuePeriods("2026-11-01", null), ["2026-09"]);
  assert.deepEqual(autoFileDuePeriods("2026-11-01", "2026-09"), []);
  assert.equal(autoFileIsDue("2026-11-01", "2026-09"), false);
});

test("on the 2nd, last month files", () => {
  assert.deepEqual(autoFileDuePeriods("2026-11-02", "2026-09"), ["2026-10"]);
  assert.equal(autoFileIsDue("2026-11-02", "2026-09"), true);
});

test("a missed 2nd still files on the 3rd, the 10th, and the 28th", () => {
  // Server down, deploy, whatever: the guard is the ledger stamp, not the
  // calendar day, so a late tick catches up instead of losing the month.
  for (const day of ["03", "10", "28"]) {
    assert.deepEqual(autoFileDuePeriods(`2026-11-${day}`, "2026-09"), ["2026-10"], `2026-11-${day}`);
  }
});

test("a month missed entirely still files the following month", () => {
  // October never filed at all. December's run owes October AND November.
  assert.deepEqual(autoFileDuePeriods("2026-12-02", "2026-09"), ["2026-10", "2026-11"]);
});

test("the catch-up is capped, oldest first, so a very stale ledger cannot flood", () => {
  assert.equal(AUTO_FILE_CATCHUP_MONTHS, 3);
  const due = autoFileDuePeriods("2027-06-05", "2026-09");
  assert.equal(due.length, AUTO_FILE_CATCHUP_MONTHS);
  assert.deepEqual(due, ["2027-03", "2027-04", "2027-05"]);
  // Ascending, so the caller stamps the ledger forward one month at a time.
  assert.deepEqual(due.slice().sort(), due);
});

test("the first run ever files only the newest due month, never history", () => {
  // A null ledger must not back-file months that were already paid by hand.
  assert.deepEqual(autoFileDuePeriods("2027-06-05", null), ["2027-05"]);
});

test("nothing files for a month before this feature existed", () => {
  assert.equal(AUTO_FILE_EARLIEST_PERIOD, "2026-09");
  assert.deepEqual(autoFileDuePeriods("2026-09-15", null), []);
  assert.deepEqual(autoFileDuePeriods("2026-10-02", "2026-05"), ["2026-09"]);
});

test("a period already stamped on the ledger never files twice", () => {
  assert.deepEqual(autoFileDuePeriods("2026-11-02", "2026-10"), []);
  assert.deepEqual(autoFileDuePeriods("2026-11-30", "2026-10"), []);
  assert.equal(autoFileIsDue("2026-11-02", "2026-10"), false);
});

test("garbage dates are not due for anything", () => {
  assert.deepEqual(autoFileDuePeriods("", null), []);
  assert.deepEqual(autoFileDuePeriods("2026-11", null), []);
  assert.deepEqual(autoFileDuePeriods("not-a-date", null), []);
});

test("period arithmetic crosses years both ways", () => {
  assert.equal(previousPeriod("2027-01"), "2026-12");
  assert.equal(nextPeriod("2026-12"), "2027-01");
  assert.equal(addPeriodMonths("2026-10", -13), "2025-09");
  assert.equal(monthLabel("2026-10"), "October 2026");
  assert.equal(lastDayOfPeriod("2026-02"), "2026-02-28");
  assert.equal(lastDayOfPeriod("2026-10"), "2026-10-31");
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 2 — ALREADY SUBMITTED.
// ────────────────────────────────────────────────────────────────────────────

test("the month is read out of the description the way the helper button writes it", () => {
  assert.deepEqual(periodsNamedIn("Monthly transfer request — October 2026 (150 transfers @ $10.00)"), ["2026-10"]);
  assert.deepEqual(periodsNamedIn("transfers for 2026-10"), ["2026-10"]);
  assert.deepEqual(periodsNamedIn("october 2026"), ["2026-10"]); // case-insensitive
  assert.deepEqual(periodsNamedIn("no month here"), []);
});

test("a transfers request naming the month covers it", () => {
  const row: CompRequestRow = {
    id: 7, userId: 1, category: "transfers", status: "pending",
    description: "Monthly transfer request — October 2026 (150 transfers @ $10.00)",
  };
  assert.equal(compRequestCoversPeriod(row, "2026-10"), true);
  assert.equal(compRequestCoversPeriod(row, "2026-09"), false);
});

test("the description beats the expense date, so filing late cannot block the next month", () => {
  // Filed 3 October FOR September, expense-dated the day it was filed. Trusting
  // the date would let September file twice and wrongly block October.
  const row: CompRequestRow = {
    id: 8, userId: 1, category: "transfers", status: "pending",
    description: "Monthly transfer request — September 2026 (90 transfers @ $5.00)",
    expenseDate: "2026-10-03",
  };
  assert.equal(compRequestCoversPeriod(row, "2026-09"), true);
  assert.equal(compRequestCoversPeriod(row, "2026-10"), false);
});

test("the description beats the note, or an auto-filed note would block the NEXT month", () => {
  // Regression, and the worst bug this file could have shipped. An auto-filed
  // note opens "Auto-filed 2026-11-02 for October 2026". Reading description
  // and note together made October's request look like it covered November
  // too, which would have silently suppressed the whole team's November pay.
  const row: CompRequestRow = {
    id: 11, userId: 1, category: "transfers", status: "pending",
    description: "Monthly transfer request — October 2026 (100 transfers @ $10.00) — auto-filed",
    note: "Auto-filed 2026-11-02 for October 2026 (the previous calendar month).",
  };
  assert.equal(compRequestCoversPeriod(row, "2026-10"), true);
  assert.equal(compRequestCoversPeriod(row, "2026-11"), false);
});

test("the note is still read when the description names no month", () => {
  const row: CompRequestRow = {
    id: 12, userId: 1, category: "transfers", status: "pending",
    description: "transfer comp",
    note: "This is for September 2026.",
  };
  assert.equal(compRequestCoversPeriod(row, "2026-09"), true);
  assert.equal(compRequestCoversPeriod(row, "2026-10"), false);
});

test("with no month in the text, the expense date decides", () => {
  const row: CompRequestRow = { id: 9, userId: 1, category: "transfers", status: "pending", description: "transfers", expenseDate: "2026-10-31" };
  assert.equal(compRequestCoversPeriod(row, "2026-10"), true);
  assert.equal(compRequestCoversPeriod(row, "2026-09"), false);
});

test("naming nothing and dating nothing covers nothing", () => {
  const row: CompRequestRow = { id: 10, userId: 1, category: "transfers", status: "pending", description: "transfers" };
  assert.equal(compRequestCoversPeriod(row, "2026-10"), false);
});

test("every covering status blocks a re-file, denied included", () => {
  assert.deepEqual(COVERING_STATUSES, ["draft", "pending", "approved", "denied"]);
  for (const status of COVERING_STATUSES) {
    const row: CompRequestRow = { id: 1, userId: 1, category: "transfers", status, description: "October 2026 transfers" };
    // A human already answered a denied ask; a draft is a CLR mid-way through
    // filing. Either way, filing on top of it makes a duplicate.
    assert.equal(compRequestCoversPeriod(row, "2026-10"), true, status);
  }
  const cancelled: CompRequestRow = { id: 2, userId: 1, category: "transfers", status: "cancelled", description: "October 2026 transfers" };
  assert.equal(compRequestCoversPeriod(cancelled, "2026-10"), false);
});

test("the legacy category still counts as a transfers request", () => {
  assert.equal(isTransferCompCategory("transfers"), true);
  assert.equal(isTransferCompCategory("leads"), true);
  assert.equal(isTransferCompCategory("Transfers"), true);
  assert.equal(isTransferCompCategory("software"), false);
  const legacy: CompRequestRow = { id: 3, userId: 1, category: "leads", status: "approved", description: "October 2026 leads" };
  assert.equal(compRequestCoversPeriod(legacy, "2026-10"), true);
});

test("a request in another category never blocks the transfer request", () => {
  const other: CompRequestRow = { id: 4, userId: 1, category: "software", status: "approved", description: "Tooling — October 2026" };
  assert.equal(compRequestCoversPeriod(other, "2026-10"), false);
  assert.deepEqual(findCoveringRequests([other], 1, "2026-10"), []);
});

test("covering requests are matched per CLR, never across CLRs", () => {
  const rows: CompRequestRow[] = [
    { id: 5, userId: 2, category: "transfers", status: "pending", description: "October 2026 transfers" },
  ];
  assert.equal(findCoveringRequests(rows, 1, "2026-10").length, 0);
  assert.equal(findCoveringRequests(rows, 2, "2026-10").length, 1);
});

test("a CLR who already filed is skipped, not filed on top of", () => {
  const stats = nineClrs({ writeUp: DESC, placement: ASC });
  const existing: CompRequestRow[] = [
    { id: 42, userId: 4, category: "transfers", status: "pending", description: "Monthly transfer request — October 2026 (100 transfers @ $10.00)" },
  ];
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing });
  assert.equal(plan.file.filter((f) => f.userId === 4).length, 0);
  const skip = plan.skipped.filter((s) => s.userId === 4)[0];
  assert.equal(skip.reason, "already-filed");
  assert.match(skip.detail, /#42 \(pending\)/);
});

test("running the job twice in one day files nothing the second time", () => {
  // Same guard the ledger + INSERT transaction gives, proved without a database:
  // feed run one's own output back in as existing rows.
  const stats = nineClrs({ writeUp: DESC, placement: ASC });
  const first = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(first.file.length, 9);
  const inserted = first.file.map((item, i) => autoFiledRequestRow(item, 1000 + i));
  const second = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: inserted });
  assert.equal(second.file.length, 0);
  assert.equal(second.skipped.length, 9);
  assert.ok(second.skipped.every((s) => s.reason === "already-filed"));
  // And a restart mid-month cannot resurrect it either.
  const third = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-19", stats, existing: inserted });
  assert.equal(third.file.length, 0);
});

test("an untagged transfers request warns loudly but never silently skips the month", () => {
  // A skipped month is invisible; a duplicate ask is not. So it files, and the
  // approver is told to look before approving.
  const stats = nineClrs({ writeUp: DESC, placement: ASC });
  const existing: CompRequestRow[] = [
    { id: 77, userId: 5, category: "transfers", status: "pending", description: "transfers", requestedAt: "2026-11-01T10:00:00.000Z" },
  ];
  assert.equal(untaggedTransferRequests(existing, 5, "2026-10").length, 1);
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing });
  const item = itemFor(plan, 5);
  assert.equal(item.warnings.length, 1);
  assert.match(item.warnings[0], /POSSIBLE DUPLICATE/);
  assert.match(item.note, /WARNING: POSSIBLE DUPLICATE/);
  assert.ok(plan.warnings.some((w) => /POSSIBLE DUPLICATE/.test(w)));
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 3 — THE BUMP GATE: October 2026 onward.
// ────────────────────────────────────────────────────────────────────────────

test("September 2026 files flat — no bump, whatever the write-ups say", () => {
  assert.equal(BUMP_EFFECTIVE_FROM_PERIOD, "2026-10");
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-09", today: "2026-10-02", stats, existing: [] });
  assert.equal(plan.bumpsActive, false);
  assert.equal(plan.rankings.length, 0);
  for (const item of plan.file) {
    assert.equal(item.bumps.length, 0);
    assert.equal(item.totalBps, 0);
    assert.equal(item.amountCents, BASE_CENTS);
    assert.match(item.note, /No adjustment: the write-up and placement bumps start with transfer month October 2026\./);
  }
});

test("October 2026 is the first month that bumps", () => {
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(plan.bumpsActive, true);
  assert.equal(itemFor(plan, 1).totalBps, 2000);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 4 — THE POOL: 37.5 transfers.
// ────────────────────────────────────────────────────────────────────────────

test("the pool line sits at 37.5: 37 is out, 37.5 is in, 38 is in", () => {
  assert.equal(BUMP_MIN_TRANSFERS, 37.5);
  const stats: ClrMonthStats[] = [
    { userId: 1, transfers: 37 },
    { userId: 2, transfers: 37.5 },
    { userId: 3, transfers: 38 },
    { userId: 4, transfers: 0 },
  ];
  assert.deepEqual(bumpPool(stats).map((s) => s.userId), [2, 3]);
});

test("a CLR under the line is neither bumped up nor down", () => {
  // Eight heavy CLRs make a real pool; the light one still files, flat.
  const stats: ClrMonthStats[] = [];
  for (let i = 0; i < 8; i += 1) {
    stats.push({ userId: i + 1, name: `CLR ${i + 1}`, transfers: 100, writeUpPct: DESC[i], placementScore: DESC[i] });
  }
  stats.push({ userId: 9, name: "Light month", transfers: 20, writeUpPct: 100, placementScore: 100 });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(plan.poolSize, 8);
  const light = itemFor(plan, 9);
  assert.equal(light.inPool, false);
  assert.equal(light.bumps.length, 0);
  assert.equal(light.amountCents, light.baseCents);
  assert.match(light.note, /20 transfers is under the 37\.5-transfer pool minimum/);
  // Perfect write-ups on 20 transfers must not displace anyone in the pool.
  assert.equal(itemFor(plan, 1).totalBps, 2000);
});

test("inactive CLRs are out of the pool entirely", () => {
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  stats[0].active = false;
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(plan.poolSize, 8);
  // CLR 2 was second; with the inactive top scorer gone they are now first.
  assert.equal(itemFor(plan, 2).bumps.filter((b) => b.metric === "writeUp")[0].rank, 1);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 5 — THE BUMPS: top 3 up, bottom 3 down, per metric, independently.
// ────────────────────────────────────────────────────────────────────────────

test("top three by write-up get +10%, bottom three get -10%, the middle nothing", () => {
  assert.equal(BUMP_GROUP_SIZE, 3);
  assert.equal(BUMP_STEP_BPS, 1000);
  const stats = nineClrs({ writeUp: DESC, placement: [5, 5, 5, 5, 5, 5, 5, 5, 5] });
  const ranking = rankMetric(bumpPool(stats), "writeUp");
  const up = ranking.byUserId.filter((b) => b.bump.direction === "up").map((b) => b.userId);
  const down = ranking.byUserId.filter((b) => b.bump.direction === "down").map((b) => b.userId);
  assert.deepEqual(up.slice().sort((a, b) => a - b), [1, 2, 3]);
  assert.deepEqual(down.slice().sort((a, b) => a - b), [7, 8, 9]);
  assert.equal(ranking.ranked, 9);
});

test("the placement score is ranked separately, and a metric can fail on its own", () => {
  // Only four CLRs have a placement score; write-up still bumps normally.
  const stats = nineClrs({ writeUp: DESC, placement: ASC });
  for (let i = 4; i < 9; i += 1) stats[i].placementScore = null;
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const placement = plan.rankings.filter((r) => r.metric === "placement")[0];
  assert.equal(placement.bumps.length, 0);
  assert.match(String(placement.reason), /only 4 CLRs had a placement score to rank/);
  const writeUp = plan.rankings.filter((r) => r.metric === "writeUp")[0];
  assert.equal(writeUp.bumps.length, 6);
  assert.equal(itemFor(plan, 1).totalBps, 1000); // write-up only
});

test("higher placement score is better", () => {
  assert.equal(PLACEMENT_SCORE_HIGHER_IS_BETTER, true);
  assert.equal(metricValue({ userId: 1, transfers: 100, placementScore: 40 }, "placement"), 40);
  const stats = nineClrs({ writeUp: [5, 5, 5, 5, 5, 5, 5, 5, 5], placement: DESC });
  const ranking = rankMetric(bumpPool(stats), "placement");
  const up = ranking.byUserId.filter((b) => b.bump.direction === "up").map((b) => b.userId);
  assert.deepEqual(up.slice().sort((a, b) => a - b), [1, 2, 3]);
});

test("a missing metric value takes a CLR out of that ranking, not out of pay", () => {
  assert.equal(metricValue({ userId: 1, transfers: 100, writeUpPct: null }, "writeUp"), null);
  assert.equal(metricValue({ userId: 1, transfers: 100 }, "writeUp"), null);
  assert.equal(metricValue({ userId: 1, transfers: 100, writeUpPct: 0 }, "writeUp"), 0);
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  stats[0].writeUpPct = null;
  stats[0].placementScore = null;
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const unranked = itemFor(plan, 1);
  assert.equal(unranked.bumps.length, 0);
  assert.equal(unranked.amountCents, unranked.baseCents);
  assert.equal(unranked.inPool, true);
  assert.match(unranked.note, /in the pool of 9 but in neither the top 3 nor the bottom 3/);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 6 — NOT COMPOUNDING: additive on the base.
// ────────────────────────────────────────────────────────────────────────────

test("BUMP_COMBINE says, in one word, which reading is implemented", () => {
  assert.equal(BUMP_COMBINE, "additive-on-base");
});

test("top three on BOTH metrics is +20% of base, not +21%", () => {
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const best = itemFor(plan, 1);
  assert.equal(best.bumps.length, 2);
  assert.equal(best.totalBps, 2000);
  assert.equal(best.baseCents, BASE_CENTS);
  assert.equal(best.amountCents, 120000);
  // The compounding reading would be 1.1 x 1.1 = 121000. It is not implemented.
  assert.notEqual(best.amountCents, Math.round(BASE_CENTS * 1.1 * 1.1));
});

test("bottom three on BOTH metrics is -20% of base, the worst case", () => {
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const worst = itemFor(plan, 9);
  assert.equal(worst.totalBps, -2000);
  assert.equal(worst.amountCents, 80000);
});

test("top three on one and bottom three on the other nets exactly zero", () => {
  const stats = nineClrs({ writeUp: DESC, placement: ASC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const split = itemFor(plan, 1);
  assert.equal(split.bumps.length, 2);
  assert.equal(split.totalBps, 0);
  assert.equal(split.deltaCents, 0);
  assert.equal(split.amountCents, split.baseCents);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 7 — SMALL POOLS AND TIES.
// ────────────────────────────────────────────────────────────────────────────

test("a pool under six bumps nobody, so nobody is both best and worst", () => {
  assert.equal(BUMP_MIN_POOL, 6);
  const stats: ClrMonthStats[] = [];
  for (let i = 0; i < 5; i += 1) {
    stats.push({ userId: i + 1, name: `CLR ${i + 1}`, transfers: 100, writeUpPct: DESC[i], placementScore: DESC[i] });
  }
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(plan.poolSize, 5);
  assert.equal(plan.rankings.length, 0);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /under the 6 needed to name a top 3 and a bottom 3/);
  for (const item of plan.file) {
    assert.equal(item.bumps.length, 0);
    assert.equal(item.amountCents, item.baseCents);
    assert.match(item.note, /No adjustment: the bump pool had 5 CLRs, under the 6 needed\./);
  }
});

test("exactly six is enough, and the two groups do not overlap", () => {
  const stats: ClrMonthStats[] = [];
  for (let i = 0; i < 6; i += 1) {
    stats.push({ userId: i + 1, name: `CLR ${i + 1}`, transfers: 100, writeUpPct: DESC[i], placementScore: DESC[i] });
  }
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const up = plan.file.filter((f) => f.totalBps > 0).map((f) => f.userId);
  const down = plan.file.filter((f) => f.totalBps < 0).map((f) => f.userId);
  assert.deepEqual(up, [1, 2, 3]);
  assert.deepEqual(down, [4, 5, 6]);
  assert.equal(up.filter((id) => down.indexOf(id) >= 0).length, 0);
});

test("a tie at the top boundary is never split — both tied CLRs get the bump", () => {
  // 3rd and 4th are level on 80. Splitting them would be a coin flip over money.
  const values = [100, 90, 80, 80, 70, 60, 50, 40];
  const top = topTieGroup(entries(values)).map((e) => e.userId).sort((a, b) => a - b);
  assert.deepEqual(top, [1, 2, 3, 4]);
});

test("a tie at the bottom boundary spares everyone tied", () => {
  // Three CLRs level on 50 straddle the bottom-three line, so none are docked.
  const values = [100, 90, 80, 70, 60, 50, 50, 50, 45];
  const bottom = bottomTieGroup(entries(values)).map((e) => e.userId).sort((a, b) => a - b);
  assert.deepEqual(bottom, [9]);
});

test("the tie rules do not depend on the order rows arrive in", () => {
  const values = [100, 90, 80, 80, 70, 60, 50, 40];
  const forward = entries(values);
  const backward = forward.slice().reverse();
  const ids = (list: RankEntry[]) => list.map((e) => e.userId).sort((a, b) => a - b);
  assert.deepEqual(ids(topTieGroup(backward)), ids(topTieGroup(forward)));
  assert.deepEqual(ids(bottomTieGroup(backward)), ids(bottomTieGroup(forward)));
});

test("when everybody is level, nobody is top three and nobody is bottom three", () => {
  const flat = entries([70, 70, 70, 70, 70, 70]);
  assert.deepEqual(topTieGroup(flat), []);
  assert.deepEqual(bottomTieGroup(flat), []);
  const stats = nineClrs({ writeUp: [70, 70, 70, 70, 70, 70, 70, 70, 70], placement: DESC });
  const ranking = rankMetric(bumpPool(stats), "writeUp");
  assert.equal(ranking.bumps.length, 0);
  assert.match(String(ranking.reason), /every ranked CLR had the same write-up %/);
});

test("nobody is ever bumped up and down on the same metric", () => {
  const values = [90, 90, 90, 90, 50, 50, 50];
  const top = topTieGroup(entries(values)).map((e) => e.userId);
  const bottom = bottomTieGroup(entries(values)).map((e) => e.userId);
  assert.equal(top.filter((id) => bottom.indexOf(id) >= 0).length, 0);
  const stats: ClrMonthStats[] = values.map((v, i) => ({ userId: i + 1, name: `CLR ${i + 1}`, transfers: 100, writeUpPct: v, placementScore: v }));
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  for (const item of plan.file) {
    const up = item.bumps.filter((b) => b.direction === "up").map((b) => b.metric);
    const down = item.bumps.filter((b) => b.direction === "down").map((b) => b.metric);
    assert.equal(up.filter((m) => down.indexOf(m) >= 0).length, 0, `CLR ${item.userId}`);
  }
});

test("competition ranks share a number for a tie and skip the next", () => {
  assert.deepEqual(
    competitionRanks(entries([90, 80, 80, 70])).map((r) => r.rank),
    [1, 2, 2, 4],
  );
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 8 — ROUNDING.
// ────────────────────────────────────────────────────────────────────────────

test("cents round half AWAY from zero, so up and down are mirror images", () => {
  assert.equal(roundCents(1234.5), 1235);
  assert.equal(roundCents(-1234.5), -1235);
  assert.equal(roundCents(1234.4), 1234);
  assert.equal(roundCents(-1234.4), -1234);
  const up = applyBumps(12345, [bump("writeUp", "up")]);
  const down = applyBumps(12345, [bump("writeUp", "down")]);
  assert.equal(up.deltaCents, 1235);
  assert.equal(down.deltaCents, -1235);
  assert.equal(up.amountCents - 12345, 12345 - down.amountCents);
});

test("a +10% and a -10% on the same request cannot drift a cent", () => {
  // The percentages are summed first, so the money is worked out once from the
  // base. Compounding the two in sequence loses $1.23 on this base.
  for (const base of [12345, 33633, 1, 99, 100003, 7]) {
    const both = applyBumps(base, [bump("writeUp", "up"), bump("placement", "down")]);
    assert.equal(both.totalBps, 0);
    assert.equal(both.deltaCents, 0);
    assert.equal(both.amountCents, base, `base ${base}`);
    const compounded = Math.round(Math.round(base * 1.1) * 0.9);
    assert.equal(both.amountCents, base);
    assert.ok(compounded !== base || base < 10, `sanity: compounding drifts at base ${base}`);
  }
});

test("an odd base bumps to whole cents once, never twice", () => {
  // 101 transfers at a saved flat rate of $3.33 = $336.33.
  const stats: ClrMonthStats[] = [];
  for (let i = 0; i < 9; i += 1) {
    stats.push({ userId: i + 1, name: `CLR ${i + 1}`, transfers: 101, transferRateCents: 333, writeUpPct: DESC[i], placementScore: DESC[i] });
  }
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const best = itemFor(plan, 1);
  assert.equal(best.baseCents, 33633);
  assert.equal(best.deltaCents, roundCents(33633 * 0.2));
  assert.equal(best.amountCents, 33633 + 6727); // 6726.6 -> 6727
  const worst = itemFor(plan, 9);
  assert.equal(worst.amountCents, 33633 - 6727);
  assert.equal(Number.isInteger(best.amountCents) && Number.isInteger(worst.amountCents), true);
});

test("a bumped amount can never go negative", () => {
  assert.equal(applyBumps(0, [bump("writeUp", "down"), bump("placement", "down")]).amountCents, 0);
  assert.equal(applyBumps(3, [bump("writeUp", "down"), bump("placement", "down")]).amountCents, 2);
});

// ────────────────────────────────────────────────────────────────────────────
// RULE 9 — AUDITABILITY.
// ────────────────────────────────────────────────────────────────────────────

test("money and percentages are formatted the same way everywhere", () => {
  assert.equal(formatMoneyCents(100000), "$1,000.00");
  assert.equal(formatMoneyCents(1000), "$10.00");
  assert.equal(formatMoneyCents(0), "$0.00");
  assert.equal(formatMoneyCents(-20000), "-$200.00");
  assert.equal(formatMoneyCents(123456789), "$1,234,567.89");
  assert.equal(formatBps(1000), "+10%");
  assert.equal(formatBps(-1000), "-10%");
  assert.equal(formatBps(2000), "+20%");
  assert.equal(formatBps(0), "0%");
});

test("the description says the month, the count, the rate, the bumps and the total", () => {
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(
    itemFor(plan, 1).description,
    "Monthly transfer request — October 2026 (100 transfers @ $10.00) — auto-filed · +10% write-up %, +10% placement score · net +20% · $1,200.00",
  );
  assert.equal(
    itemFor(plan, 5).description,
    "Monthly transfer request — October 2026 (100 transfers @ $10.00) — auto-filed · no adjustment · $1,000.00",
  );
  // Under the 300-char comp_requests limit routes.ts slices to.
  assert.ok(plan.file.every((f) => f.description.length <= 300));
});

test("the note shows the base, every bump with its rank and metric, and the total", () => {
  const stats = nineClrs({ writeUp: DESC, placement: ASC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const lines = itemFor(plan, 1).note.split("\n");
  assert.deepEqual(lines, [
    "Auto-filed 2026-11-02 for October 2026 (the previous calendar month).",
    "Base: 100 transfers x $10.00 = $1,000.00.",
    "Adjustments — each is +10% of the BASE, added together, never compounded:",
    "  +10%  write-up % — top 3, rank 1 of 9 (99)",
    "  -10%  placement score — bottom 3, rank 9 of 9 (10)",
    "Net 0% = $0.00.",
    "Total requested: $1,000.00.",
    "Bump pool: CLRs with at least 37.5 transfers in October 2026 — 9 of 9.",
  ]);
});

test("the description carries the month, so the next run can read it back", () => {
  // The audit string is also the idempotency key: whatever it says must be
  // parseable by compRequestCoversPeriod.
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  for (const item of plan.file) {
    assert.deepEqual(periodsNamedIn(item.description), ["2026-10"]);
    assert.equal(compRequestCoversPeriod(autoFiledRequestRow(item, 1), "2026-10"), true);
    assert.equal(compRequestCoversPeriod(autoFiledRequestRow(item, 1), "2026-11"), false);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// The rest of the plan's edges.
// ────────────────────────────────────────────────────────────────────────────

test("a CLR with zero transfers gets no request at all", () => {
  assert.equal(AUTO_FILE_MIN_TRANSFERS, 1);
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  stats.push({ userId: 10, name: "No transfers", transfers: 0, writeUpPct: null, placementScore: null });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(plan.file.filter((f) => f.userId === 10).length, 0);
  const skip = plan.skipped.filter((s) => s.userId === 10)[0];
  assert.equal(skip.reason, "no-transfers");
  assert.match(skip.detail, /no transfers logged in October 2026/);
});

test("an inactive CLR files nothing, and the plan says so out loud", () => {
  // Following processRecurringComp: never file into the void. But transfers
  // already logged are earned money, so it cannot go by unmentioned.
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  stats.push({ userId: 11, name: "Departed CLR", active: false, transfers: 64, writeUpPct: 88, placementScore: 88 });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.equal(plan.file.filter((f) => f.userId === 11).length, 0);
  const skip = plan.skipped.filter((s) => s.userId === 11)[0];
  assert.equal(skip.reason, "inactive");
  assert.ok(plan.warnings.some((w) => /Departed CLR logged 64 transfers .* is inactive/.test(w)));
  assert.equal(plan.poolSize, 9); // the inactive CLR never entered the pool
});

test("the base amount is the count times the resolved rate, tiers and flat rates included", () => {
  const stats: ClrMonthStats[] = [
    { userId: 1, name: "Tiered low", transfers: 50 },
    { userId: 2, name: "Tiered mid", transfers: 150 },
    { userId: 3, name: "Tiered high", transfers: 250 },
    { userId: 4, name: "Flat rate", transfers: 150, transferRateCents: 750 },
  ];
  const plan = planTransferCompAutoFile({ period: "2026-09", today: "2026-10-02", stats, existing: [] });
  assert.equal(itemFor(plan, 1).rateCents, resolveEmailTransferCompRateCents(50, "Tiered low", null));
  assert.equal(itemFor(plan, 1).baseCents, 50 * 500);
  assert.equal(itemFor(plan, 2).baseCents, 150 * 1000);
  assert.equal(itemFor(plan, 3).baseCents, 250 * 1500);
  assert.equal(itemFor(plan, 4).baseCents, 150 * 750);
});

test("Elleine's permanent $5 agreement survives the auto-filer", () => {
  // comp-rate.ts carves her out by name; the auto-filer must price her the
  // same way the month-end estimate does, or the two numbers disagree.
  const stats: ClrMonthStats[] = [{ userId: 1, name: "Elleine Haynes", transfers: 250, transferRateCents: 1500 }];
  const plan = planTransferCompAutoFile({ period: "2026-09", today: "2026-10-02", stats, existing: [] });
  assert.equal(itemFor(plan, 1).rateCents, 500);
  assert.equal(itemFor(plan, 1).baseCents, 250 * 500);
});

test("the request is dated to the month it pays for, not the day it was filed", () => {
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  assert.ok(plan.file.every((f) => f.expenseDate === "2026-10-31"));
  assert.ok(plan.file.every((f) => f.category === TRANSFER_COMP_CATEGORY));
});

test("the plan totals what it is about to ask for", () => {
  const stats = nineClrs({ writeUp: DESC, placement: DESC });
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats, existing: [] });
  const sum = plan.file.reduce((a, f) => a + f.amountCents, 0);
  assert.equal(plan.totalCents, sum);
  // Three at +20%, three at -20%, three flat — the bumps net out across the team.
  assert.equal(plan.totalCents, 9 * BASE_CENTS);
});

test("an empty month plans nothing and throws nothing", () => {
  const plan = planTransferCompAutoFile({ period: "2026-10", today: "2026-11-02", stats: [], existing: [] });
  assert.deepEqual(plan.file, []);
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.totalCents, 0);
  assert.equal(plan.poolSize, 0);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function bump(metric: "writeUp" | "placement", direction: "up" | "down"): BumpDetail {
  return {
    metric,
    metricLabel: metric === "writeUp" ? "write-up %" : "placement score",
    direction,
    bps: direction === "up" ? BUMP_STEP_BPS : -BUMP_STEP_BPS,
    rank: 1, of: 9, value: 0,
  };
}
