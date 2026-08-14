import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  mondayOf, scorecardWindow, rankScorecardRows, buildScorecardDigestHtml,
  type ScorecardRow,
} from "../server/scorecard-digest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

const row = (name: string, calls: number, transfers: number, appointments: number, fellThrough = 0): ScorecardRow =>
  ({ name, calls, transfers, appointments, fellThrough });

test("day windows cover the day, week windows run Monday to date", () => {
  // 2026-08-14 is a Friday.
  assert.deepEqual(scorecardWindow("midday", "2026-08-14"), { from: "2026-08-14", to: "2026-08-14", label: "Mid-Day" });
  assert.deepEqual(scorecardWindow("eod", "2026-08-14"), { from: "2026-08-14", to: "2026-08-14", label: "End of Day" });
  assert.equal(scorecardWindow("midweek", "2026-08-12").from, "2026-08-10", "Wednesday reaches back to Monday");
  assert.equal(scorecardWindow("eow", "2026-08-14").from, "2026-08-10", "Friday covers the whole week");
});

test("Monday resolution survives Sundays and month boundaries", () => {
  assert.equal(mondayOf("2026-08-10"), "2026-08-10", "a Monday is its own Monday");
  assert.equal(mondayOf("2026-08-16"), "2026-08-10", "Sunday belongs to the week that started six days back");
  assert.equal(mondayOf("2026-09-02"), "2026-08-31", "the week can start in the previous month");
});

test("the email ranks exactly like the dashboard scorecard", () => {
  // Transfers first, appointments break ties, calls only after that.
  const ranked = rankScorecardRows([
    row("Fewer appts, more calls", 500, 5, 1),
    row("More appts", 100, 5, 4),
    row("Most transfers", 10, 9, 0),
  ]);
  assert.deepEqual(ranked.map(r => r.name), ["Most transfers", "More appts", "Fewer appts, more calls"]);
});

test("the rendered table carries every column and a team total", () => {
  const html = buildScorecardDigestHtml("Mid-Day", "2026-08-14", [
    row("Alpha", 120, 4, 2, 1),
    row("Beta", 80, 6, 0, 0),
  ]);
  assert.match(html, /Transfer Scorecard — Mid-Day/);
  for (const col of ["CLR", "Calls", "Transfers", "Appts", "Fell Through", "C&gt;T%"]) {
    assert.ok(html.includes(col), `missing column ${col}`);
  }
  assert.match(html, />Team</);
  assert.match(html, />200</, "team calls total");
  assert.match(html, />10</, "team transfers total");
  // Beta leads on transfers despite fewer calls.
  assert.ok(html.indexOf("Beta") < html.indexOf("Alpha"));
  // C>T%: Beta 6/80 = 7.5%
  assert.match(html, /7\.5%/);
});

test("names are escaped on the way into the email", () => {
  const html = buildScorecardDigestHtml("Mid-Day", "2026-08-14", [row("<img src=x>", 1, 1, 0)]);
  assert.ok(!html.includes("<img src=x>"));
  assert.match(html, /&lt;img src=x&gt;/);
});

test("all four sends are scheduled in Pacific time on the right days", () => {
  assert.match(routes, /scheduleScorecardDigest\("0 12 \* \* 1-5", "midday"\)/);
  assert.match(routes, /scheduleScorecardDigest\("0 19 \* \* 1-5", "eod"\)/);
  assert.match(routes, /scheduleScorecardDigest\("30 12 \* \* 3", "midweek"\)/);
  assert.match(routes, /scheduleScorecardDigest\("10 19 \* \* 5", "eow"\)/);
  const fn = routes.slice(routes.indexOf("function scheduleScorecardDigest"), routes.indexOf(`scheduleScorecardDigest("0 12`));
  assert.match(fn, /timezone: "America\/Los_Angeles"/, "container time is UTC; unpinned crons fire seven hours early");
});

test("the end-of-day send uses the calendar date, not the rolled business day", () => {
  // The 19:00 send fires the exact minute businessToday rolls to tomorrow —
  // using it would mail an empty scorecard for a day that hasn't happened.
  const fn = routes.slice(routes.indexOf("async function sendScorecardDigest"), routes.indexOf("function scheduleScorecardDigest"));
  assert.match(fn, /toLocaleDateString\("en-CA", \{ timeZone: BUSINESS_DAY_DEFAULT_TZ \}\)/);
  assert.ok(!/businessTodayInTz/.test(fn), "businessToday would report tomorrow at 19:00");
  assert.match(fn, /return "skipped"/, "an all-zero window sends nothing");
  assert.match(fn, /attendanceManagerUsers\(orgId\)/, "recipients are role-derived managers");
});

test("the manual trigger is manager-gated and validates the kind", () => {
  const route = routes.slice(routes.indexOf(`app.post("/api/scorecard-digest/send-now"`), routes.indexOf(`app.post("/api/checkin/digest/send-now"`));
  assert.match(route, /requireManagerOrAdmin\(req, res\)/);
  assert.match(route, /kind must be midday, eod, midweek, or eow/);
});
