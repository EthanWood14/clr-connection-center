import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const status = read("server/status.ts");
const routes = read("server/routes.ts");
const dash = read("client/src/pages/manager-dashboard.tsx");

test("a dead call feed is not masked by heartbeats", () => {
  // 2026-08-12: the CallTools feed delivered 6,318 agent heartbeats and 6 call
  // events, against ~300 calls on each of the two prior days. The old check
  // counted every webhook row and hardcoded "up", so it reported healthy on
  // heartbeat volume alone while the dashboards flatlined for a full day.
  const fn = status.slice(status.indexOf("function checkWebhooks"), status.indexOf("function checkPush"));
  assert.ok(!/return \{ status: "up", eventsLast24h: c \};\s*\}\s*catch/.test(fn.slice(0, 600)),
    "the check must be able to report something other than up");
  assert.match(fn, /calltools\.agent_activity/, "heartbeats are counted separately");
  assert.match(fn, /'calltools\.call','calltools\.outcome'/, "…from the events that carry actual calls");
  assert.match(fn, /status: "degraded"/, "heartbeats without calls must degrade");
  assert.match(fn, /beats >= 50 && calls === 0/, "only flag when the bridge is demonstrably alive");
});

test("a severe trickle is caught, not just a total stop", () => {
  // A zero-test alone missed the very incident this was written for: three
  // hours after the feed died the window still held 18 stale call events, so
  // `calls === 0` was false and the check read healthy.
  const fn = status.slice(status.indexOf("function checkWebhooks"), status.indexOf("function checkPush"));
  assert.match(fn, /calls \* 200 < beats/, "flag when calls fall an order of magnitude below normal");
  assert.match(fn, /beats >= 500/, "…but only with enough heartbeat volume to be meaningful");

  // Reproduce the rule against the real numbers on both sides of the failure.
  const degraded = (beats: number, calls: number) =>
    (beats >= 50 && calls === 0) || (beats >= 500 && calls * 200 < beats);
  assert.equal(degraded(6422, 18), true, "2026-08-12, the failure, must flag");
  assert.equal(degraded(8500, 300), false, "2026-08-11, a normal day, must not");
  assert.equal(degraded(6318, 0), true, "a hard stop must flag");
  assert.equal(degraded(20, 0), false, "an idle night has too little signal to judge");
});

test("the degraded reason reaches the status page", () => {
  assert.match(status, /detail: whRes\.detail/, "a bare 'degraded' with no reason is not actionable");
});

test("Dialpad is a separate trend series, never summed into calls", () => {
  // Most CLRs appear in both feeds on the same day with large counts, and
  // nothing distinguishes the same call counted twice from two real calls.
  const block = routes.slice(routes.indexOf("const dialpadByDate"), routes.indexOf("const trendMap"));
  assert.match(block, /dialpad_daily_stats/);
  assert.match(block, /user_id IS NOT NULL/, "unmapped agents are not attributed to the team total");
  // Anchored forward — "// Outcome breakdown" appears four times in this file,
  // and the first one is above the trend, which slices backwards to "".
  const from = routes.indexOf("const trend: any[] = []");
  const rows = routes.slice(from, routes.indexOf("// Outcome breakdown", from));
  assert.ok(rows.length > 0, "trend-row slice must not be empty");
  assert.match(rows, /dialpadCalls: dialpadByDate\.get\(d\) \?\? 0/);
  // The existing calls figure must be untouched — no Dialpad added into it.
  assert.ok(!/calls: .*dialpadByDate/.test(rows), "Dialpad must not be folded into `calls`");
});

test("the chart plots both dialers side by side", () => {
  const chart = dash.slice(dash.indexOf('<Bar dataKey="calls"') - 600, dash.indexOf('<Bar dataKey="calls"') + 400);
  assert.match(chart, /<Bar dataKey="calls"/);
  assert.match(chart, /<Bar dataKey="dialpadCalls"/);
  assert.match(chart, /name="Dialpad"/);
  // Labelled honestly: "Calls" alone implies a total it is not.
  assert.match(chart, /name="CallTools \+ logged"/);
});
