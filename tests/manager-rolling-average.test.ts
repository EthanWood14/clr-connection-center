import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");

test("a CLR who did not work is excluded from that day's average", () => {
  const block = dash.slice(dash.indexOf("let teamSum = 0"), dash.indexOf("row.__worked"));
  // Absence is "no calls AND no transfers" — a real zero (in the office, logged
  // calls, got no transfers) must still count against the average.
  assert.match(block, /if \(calls === 0 && transfers === 0\) \{ teamAbsent\+\+; continue; \}/,
    "only a total no-show is skipped");
  assert.ok(!/if \(calls === 0 \|\| transfers === 0\)/.test(block),
    "an OR would wrongly drop anyone who merely had no transfers that day");
  // The divisor must be the working count, not the roster size.
  assert.match(dash, /row\.__mean = teamN > 0 \? teamSum \/ teamN : 0;/);
  assert.match(dash, /teamN\+\+;/);
});

test("the metric averaged is still the selected one", () => {
  const block = dash.slice(dash.indexOf("let teamSum = 0"), dash.indexOf("row.__worked"));
  // calls/transfers decide attendance; the value summed stays whatever metric
  // the manager picked (transfers, appointments, fell-through, calls).
  assert.match(block, /const arr = \(s as any\)\[clrTrendMetric\] as number\[\];/);
  assert.match(block, /teamSum \+= arr\[i\] \?\? 0;/);
});

test("a day nobody worked does not drag the rolling window", () => {
  const roll = dash.slice(dash.indexOf("const clrTrendChartData"), dash.indexOf("// Stable color palette"));
  assert.match(roll, /if \(\(clrTrendRows\[j\]\.__worked \?\? 0\) === 0\) continue;/,
    "a closed day has no mean to contribute and must be skipped, not averaged as 0");
  assert.match(roll, /cnt > 0 \? Math\.round\(\(acc \/ cnt\) \* 100\) \/ 100 : 0/);
});

test("the chart says what the average is over", () => {
  assert.match(dash, /Avg per working CLR/, "the legend must not still claim it is per CLR");
  assert.match(dash, /labelFormatter=/, "the tooltip must show how many were working");
  assert.match(dash, /\$\{worked\} working/);
});
