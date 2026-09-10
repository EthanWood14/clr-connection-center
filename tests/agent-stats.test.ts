import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { definitionsFor, monthStartOf, rollUp, weekStartOf } from "../server/agent-stats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const mod = readFileSync(join(root, "server/agent-stats.ts"), "utf8");
const fn = routes.slice(routes.indexOf('app.get("/api/agent/stats"'), routes.indexOf('app.get("/api/lo-transfer-split"'));

const row = (date: string, assistantId: number, outcomeType = "transfer") => ({ date, assistantId, outcomeType });

// ── the security shape ─────────────────────────────────────────────────────

test("no token configured means shut, not open", () => {
  // The failure mode to design against is a fresh environment that quietly
  // serves the whole company's numbers because nobody set a variable.
  assert.match(fn, /const expected = String\(process\.env\.AGENT_API_TOKEN \|\| ""\)\.trim\(\);/);
  assert.match(fn, /if \(!expected\) return res\.status\(503\)/);
});

test("the token is compared in constant time and never read from the URL", () => {
  assert.match(fn, /crypto\.timingSafeEqual\(/);
  assert.match(fn, /req\.headers\["x-api-token"\]/);
  assert.ok(!/req\.query\.token|req\.query\["token"\]/.test(fn),
    "a token in the query string ends up in access logs and in every proxy between here and there");
});

test("failures are rate limited harder than successes", () => {
  // A wrong token is a bug or somebody guessing; neither needs ten a minute.
  assert.match(fn, /agentOverLimit\("agent-fail", 10\)/);
  assert.match(fn, /agentOverLimit\("agent-ok", 60\)/);
});

test("it can only read, and only aggregates", () => {
  // The security design is not "keep the token safe" — a token given to an
  // automated session will leak eventually. It is "make a leak worth little".
  assert.ok(!/INSERT |UPDATE |DELETE /i.test(fn.replace(/--.*/g, "")), "no writes");
  // The SELECT must name its columns. `SELECT *` would drag borrower names
  // and phone numbers into a payload that must never carry them.
  assert.match(fn, /SELECT date, assistant_id AS assistantId, outcome_type AS outcomeType, lo_id AS loId/);
  assert.ok(!/SELECT \*/.test(fn));
  for (const f of ["borrower_name", "phone_number", "conversation_notes"]) {
    assert.ok(!fn.includes(f), `${f} must never be in this payload`);
  }
});

test("it is exempt from the session guard on purpose, and says why", () => {
  // Its caller holds a token, not a cookie — requireAuth would 401 before the
  // handler could check anything.
  assert.match(routes, /if \(req\.path === "\/agent\/stats"\) return next\(\);/);
  assert.match(routes, /fail-closed on AGENT_API_TOKEN and returns no borrower/);
});

test("every read is recorded", () => {
  assert.match(fn, /audit\(\{/);
  assert.match(fn, /entityType: "agent_stats"/);
  // After the response: the trail matters, but losing it must not cost the
  // caller their answer.
  assert.ok(fn.indexOf("res.json({") < fn.indexOf("audit({"));
});

// ── the numbers ────────────────────────────────────────────────────────────

test("weeks start on Monday, the same as every other window in C3", () => {
  assert.equal(weekStartOf("2026-09-11"), "2026-09-07"); // Friday -> Monday
  assert.equal(weekStartOf("2026-09-07"), "2026-09-07"); // Monday -> itself
  assert.equal(weekStartOf("2026-09-13"), "2026-09-07"); // Sunday -> that Monday
  assert.equal(weekStartOf("nonsense"), "");
  assert.equal(monthStartOf("2026-09-11"), "2026-09");
});

test("the helper is counted separately and left out of every team figure", () => {
  // She runs at five to six times an average CLR. Folding her into the mean
  // would produce a number describing nobody.
  const rows = [
    row("2026-09-08", 15), row("2026-09-08", 15), row("2026-09-08", 15),
    row("2026-09-08", 20), row("2026-09-09", 20),
    row("2026-09-09", 21),
  ];
  const [wk] = rollUp(rows, weekStartOf, 15, () => true);
  assert.equal(wk.transfers, 3, "the helper's three are not in the team total");
  assert.equal(wk.helperTransfers, 3);
  assert.equal(wk.clrsWorking, 2, "nor is she a working CLR for the denominator");
  assert.equal(wk.clrDays, 3);
  assert.equal(wk.avgPerClr, 1.5);
  assert.equal(wk.avgPerClrDay, 1);
});

test("with no helper resolved nobody is singled out", () => {
  const [wk] = rollUp([row("2026-09-08", 15), row("2026-09-08", 20)], weekStartOf, null, () => true);
  assert.equal(wk.transfers, 2);
  assert.equal(wk.helperTransfers, 0);
  assert.equal(wk.clrsWorking, 2);
});

test("the denominator is days worked, not headcount", () => {
  // Headcount flatters a month somebody joined halfway through and punishes a
  // week with a holiday in it.
  const rows = [
    row("2026-09-07", 20), row("2026-09-08", 20), row("2026-09-09", 20), row("2026-09-10", 20),
    row("2026-09-10", 21),
  ];
  const [wk] = rollUp(rows, weekStartOf, null, () => true);
  assert.equal(wk.clrsWorking, 2);
  assert.equal(wk.clrDays, 5, "four days for one CLR, one for the other");
  assert.equal(wk.avgPerClrDay, 1);
  assert.equal(wk.avgPerClr, 2.5);
});

test("a day spent logging anything counts, even with no transfer on it", () => {
  // Otherwise a bad day disappears from the denominator and flatters the rate.
  const rows = [row("2026-09-08", 20, "no_answer"), row("2026-09-09", 20, "transfer")];
  const [wk] = rollUp(rows, weekStartOf, null, () => true);
  assert.equal(wk.transfers, 1);
  assert.equal(wk.clrDays, 2);
  assert.equal(wk.avgPerClrDay, 0.5);
});

test("an unfinished period is flagged, because a partial week is not a dip", () => {
  const rows = [row("2026-09-08", 20), row("2026-09-01", 20)];
  const out = rollUp(rows, weekStartOf, null, (p) => p !== "2026-09-07");
  assert.deepEqual(out.map((r) => [r.period, r.complete]), [["2026-08-31", true], ["2026-09-07", false]]);
});

test("periods come back oldest first and never divide by zero", () => {
  const out = rollUp([row("2026-07-06", 20), row("2026-09-08", 20)], weekStartOf, null, () => true);
  assert.deepEqual(out.map((r) => r.period), ["2026-07-06", "2026-09-07"]);
  assert.deepEqual(rollUp([], weekStartOf, null, () => true), []);
});

// ── the caveats travel with the numbers ────────────────────────────────────

test("the payload explains the traps a reader would otherwise fall into", () => {
  // Every one of these is here because it has already been got wrong reading
  // this data — including by me.
  const d = definitionsFor("Elleine", true);
  assert.match(d.avgPerClrDay, /THIS IS THE FIGURE TO COMPARE ACROSS PERIODS/);
  assert.match(d.complete, /never a trend/);
  assert.match(d.nestedWindows, /collapsing when it is not/);
  assert.match(d.helperTransfers, /Elleine is flagged exclude_from_stats/);
  assert.match(d.privacy, /no borrower data of any kind/);
  // And when the helper could not be resolved, it says so rather than
  // implying she sent none.
  assert.match(definitionsFor("Elleine", false).helperTransfers, /could not be resolved/);
});

test("the module carries its own no-borrower-data rule", () => {
  assert.match(mod, /NO BORROWER DATA/);
  assert.match(mod, /Any future addition to this file has to keep that true/);
});
