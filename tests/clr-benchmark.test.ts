import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  metricsFor, median, compare, comparisonIsThin, MIN_DAYS_FOR_COMPARISON,
  LOWER_IS_BETTER, type ClrTotals,
} from "../server/clr-benchmark";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-profile.tsx"), "utf8");

const clr = (o: Partial<ClrTotals> & { userId: number }): ClrTotals => ({
  name: `CLR${o.userId}`, calls: 0, transfers: 0, appointments: 0, fellThrough: 0,
  activeDays: 0, firstDay: null, lastDay: null, ...o,
});

test("rates are per ACTIVE day, so tenure does not decide the ranking", () => {
  // Real shape from production: a 58-day veteran vs an 18-day newcomer.
  const veteran = clr({ userId: 1, transfers: 269, calls: 27000, activeDays: 56 });
  const newcomer = clr({ userId: 2, transfers: 99, calls: 3600, activeDays: 18 });
  assert.ok(metricsFor(newcomer).transfersPerDay > metricsFor(veteran).transfersPerDay,
    "the newcomer is producing more per day despite a third of the total");
  // …and the ranking agrees.
  const [tpd] = compare(newcomer, [veteran]).filter(c => c.key === "transfersPerDay");
  assert.equal(tpd.rank, 1);
  assert.equal(tpd.outOf, 2);
});

test("the baseline is the median, so one outlier cannot define 'average'", () => {
  // Elleine sits at ~16.6 transfers/day against a floor around 3.2. A mean
  // would push the baseline above nearly everyone.
  const peers = [
    clr({ userId: 2, transfers: 269, activeDays: 56 }),  // 4.80
    clr({ userId: 3, transfers: 166, activeDays: 49 }),  // 3.39
    clr({ userId: 4, transfers: 155, activeDays: 48 }),  // 3.23
    clr({ userId: 5, transfers: 965, activeDays: 58 }),  // 16.64 outlier
  ];
  const subject = clr({ userId: 1, transfers: 150, activeDays: 30 }); // 5.00
  const [tpd] = compare(subject, peers).filter(c => c.key === "transfersPerDay");
  const peerRates = [4.8, 3.39, 3.23, 16.64];
  assert.equal(tpd.teamMedian, median(peerRates));            // 4.095
  const mean = peerRates.reduce((a, b) => a + b, 0) / peerRates.length; // 7.015
  assert.ok(tpd.teamMedian < mean, "the outlier pulls the mean far above the median");
  assert.ok(tpd.better, "5.00 clears the median of 4.10 — against the mean it would read as below average");
  assert.ok(5.0 < mean, "…and that is precisely the comparison a mean would get wrong");
});

test("a low fell-through rate counts as good, not bad", () => {
  assert.equal(LOWER_IS_BETTER.fellThroughRate, true);
  const subject = clr({ userId: 1, transfers: 90, fellThrough: 10, activeDays: 20 });  // 10%
  const peer = clr({ userId: 2, transfers: 70, fellThrough: 30, activeDays: 20 });     // 30%
  const [ft] = compare(subject, [peer]).filter(c => c.key === "fellThroughRate");
  assert.equal(ft.value, 10);
  assert.equal(ft.better, true, "fewer fell-throughs must read as better");
  assert.equal(ft.rank, 1);
});

test("nobody is measured against a baseline they are inside of", () => {
  const subject = clr({ userId: 1, transfers: 100, activeDays: 10 });
  const [tpd] = compare(subject, [subject, clr({ userId: 2, transfers: 20, activeDays: 10 })])
    .filter(c => c.key === "transfersPerDay");
  assert.equal(tpd.teamMedian, 2, "the subject's own 10/day must not enter the median");
});

test("empty and zero cases degrade quietly", () => {
  const empty = clr({ userId: 1 });
  assert.deepEqual(metricsFor(empty), {
    transfersPerDay: 0, appointmentsPerDay: 0, callsPerDay: 0, transferRate: 0, fellThroughRate: 0,
  }, "no division by zero anywhere");
  assert.equal(median([]), 0);
  // No peers at all: a percentage against a zero baseline is meaningless, so it
  // is reported as absent rather than as infinite improvement.
  const [tpd] = compare(clr({ userId: 1, transfers: 5, activeDays: 5 }), []).filter(c => c.key === "transfersPerDay");
  assert.equal(tpd.deltaPct, null);
  assert.equal(tpd.outOf, 1);
});

test("a handful of days is flagged as too thin to rank on", () => {
  assert.equal(comparisonIsThin(clr({ userId: 1, activeDays: 2 })), true);
  assert.equal(comparisonIsThin(clr({ userId: 1, activeDays: MIN_DAYS_FOR_COMPARISON })), false);
  assert.match(page, /data-testid="thin-sample-warning"/);
  assert.match(page, /treat the ranking as provisional/);
});

test("the server counts active days as worked days, not calendar days", () => {
  const fn = routes.slice(routes.indexOf("function clrAllTimeTotals"), routes.indexOf('app.get("/api/clr-profiles"'));
  assert.match(fn, /UNION/, "a day counts if it has calls OR outcomes");
  assert.match(fn, /calls_made > 0/, "a zero-call log is not an active day");
  assert.match(fn, /org_id=\?/, "must not mix organizations");
  // Non-counted people are excluded from the baseline.
  assert.match(routes, /excludeFromStats \?\? x\.exclude_from_stats/);
  // Lifetime is independent of the page's period selector.
  assert.match(routes, /lifetime: \(\(\) => \{/);
});
