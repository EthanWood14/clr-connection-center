import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBuckets, chooseBucketWidth, trendLine, weekStart, isWeekend,
  type ActivityPoint,
} from "../server/chart-buckets";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-profile.tsx"), "utf8");
const listPage = readFileSync(join(root, "client/src/pages/clr-profiles.tsx"), "utf8");

// The daily-trend block is sliced by anchors. If an anchor is ever renamed,
// indexOf returns -1 and slice() quietly yields a bogus block that makes the
// negative assertions pass vacuously — so prove the anchors exist first.
function slice(from: string, to: string): string {
  const a = routes.indexOf(from);
  const b = routes.indexOf(to);
  assert.ok(a >= 0, `anchor missing: ${from}`);
  assert.ok(b > a, `anchor missing or out of order: ${to}`);
  return routes.slice(a, b);
}

const GOALS_ANCHOR = "// Weekly goals (per-CLR override falls back";
const empty: ActivityPoint = {
  date: "", callMinutes: 0, dialpadCalls: 0, callToolsCalls: 0,
  conversations: 0, transfers: 0, appointments: 0,
};
const busy = (date: string, over: Partial<ActivityPoint> = {}): ActivityPoint =>
  ({ ...empty, date, callMinutes: 120, dialpadCalls: 40, ...over });

test("the daily series comes from the dialer, not from self-reported numbers", () => {
  const block = slice("const DAILY_TREND_MAX_DAYS", GOALS_ANCHOR);
  // The old chart's tallest bars were daily_call_logs.calls_made — the
  // "Additional Calls" box a CLR types into their own EOD form.
  assert.ok(!block.includes("getCallLogsByRange"), "the self-reported call log must not drive the chart");
  assert.match(block, /FROM callsync_agent_activity_daily/, "call time");
  assert.match(block, /SUM\(conversation\)/, "conversations");
  assert.match(block, /FROM dialpad_daily_stats/, "dialpad calls");
  // Every read of a shared dialer feed must be scoped to BOTH the org and the
  // person, or one CLR's chart would show another org's numbers. Asserted as
  // the property rather than a count, so adding a query cannot silently pass.
  const feedReads = block.match(/FROM (callsync_agent_activity_daily|callsync_activity_events|dialpad_daily_stats)/g) ?? [];
  const scoped = block.match(/WHERE org_id=\? AND (assistant_id|user_id)=\?/g) ?? [];
  assert.ok(feedReads.length >= 4, `expected the four feeds, found ${feedReads.length}`);
  assert.ok(scoped.length >= feedReads.length,
    `${feedReads.length} feed reads but only ${scoped.length} are org+user scoped`);
});

test("every focus metric is emitted per bucket", () => {
  const block = slice("const dayValue = (day: string)", GOALS_ANCHOR);
  for (const f of ["callMinutes", "dialpadCalls", "callToolsCalls", "conversations", "transfers", "appointments"]) {
    assert.ok(block.includes(f), `buckets must carry ${f}`);
  }
  // Call time is stored in seconds and shown in minutes.
  assert.match(block, /callTimeByDay\.get\(day\) \?\? 0\) \/ 60/);
});

test("a feed that has never run degrades to zero instead of a 500", () => {
  const helper = slice("const numByDay =", "const callTimeByDay");
  assert.match(helper, /catch \{/, "a missing table must not break the profile");
});

// ── bucketing ────────────────────────────────────────────────────────────────

test("bucket width follows the span, so long ranges chart instead of blanking", () => {
  assert.equal(chooseBucketWidth("2026-08-01", "2026-08-31"), "day");
  assert.equal(chooseBucketWidth("2026-06-01", "2026-08-31"), "day");    // ~3 months
  assert.equal(chooseBucketWidth("2026-03-01", "2026-08-31"), "week");   // ~6 months
  assert.equal(chooseBucketWidth("2020-01-01", "2026-08-31"), "month");  // all time
});

test("an all-time range produces a chartable number of buckets, never thousands", () => {
  const { width, buckets } = buildBuckets({
    startDate: "2026-04-09", endDate: "2026-08-28", dayValue: (d) => busy(d),
  });
  assert.equal(width, "week");
  assert.ok(buckets.length > 3 && buckets.length < 30, `got ${buckets.length} buckets`);
  // Ascending — recharts plots in array order and never sorts.
  const dates = buckets.map((b) => b.date);
  assert.deepEqual(dates, [...dates].sort());
});

test("weeks are Sunday-anchored, matching how the app already defines a week", () => {
  // 2026-08-26 is a Wednesday; its week starts Sunday 2026-08-23.
  assert.equal(weekStart("2026-08-26"), "2026-08-23");
  assert.equal(weekStart("2026-08-23"), "2026-08-23");
});

test("a quiet weekend is left off the chart, but a worked weekend is kept", () => {
  // 2026-08-22 is a Saturday, 2026-08-23 a Sunday.
  assert.ok(isWeekend("2026-08-22") && isWeekend("2026-08-23"));
  const quiet = buildBuckets({
    startDate: "2026-08-21", endDate: "2026-08-24",
    dayValue: (d) => ({ ...empty, date: d }),
  });
  assert.deepEqual(quiet.buckets.map((b) => b.date), ["2026-08-21", "2026-08-24"],
    "an empty Saturday and Sunday should not read as two days of doing nothing");

  const worked = buildBuckets({
    startDate: "2026-08-21", endDate: "2026-08-24",
    dayValue: (d) => (d === "2026-08-22" ? busy(d) : { ...empty, date: d }),
  });
  assert.ok(worked.buckets.some((b) => b.date === "2026-08-22"),
    "a Saturday they actually worked belongs on the chart");
  assert.ok(!worked.buckets.some((b) => b.date === "2026-08-23"));
});

test("weekend suppression never drops a day inside a week or month bucket", () => {
  // Folding into weeks must still count Saturday's work.
  const { width, buckets } = buildBuckets({
    startDate: "2026-01-01", endDate: "2026-08-28",
    dayValue: (d) => (isWeekend(d) ? busy(d, { transfers: 1 }) : { ...empty, date: d }),
  });
  assert.equal(width, "week");
  const transfers = buckets.reduce((s, b) => s + b.transfers, 0);
  assert.ok(transfers > 0, "weekend activity must survive into the week bucket");
});

test("time off is carried on the bucket so an empty bar can say 'away'", () => {
  const { buckets } = buildBuckets({
    startDate: "2026-08-17", endDate: "2026-08-18",
    dayValue: (d) => ({ ...empty, date: d }),
    timeOffDays: new Set(["2026-08-17", "2026-08-18"]),
  });
  assert.equal(buckets.length, 2, "a day off is still a bar, just a shaded one");
  assert.ok(buckets.every((b) => b.allTimeOff));
  assert.equal(buckets[0].timeOffDays, 1);
});

test("a bucket never advertises coverage past the range it was asked for", () => {
  const { buckets } = buildBuckets({
    startDate: "2026-01-01", endDate: "2026-08-26", // mid-week end
    dayValue: (d) => busy(d), width: "week",
  });
  const last = buckets[buckets.length - 1];
  assert.ok(last.endDate <= "2026-08-26", `partial last bucket claimed ${last.endDate}`);
});

test("the trend needs a real shape before it draws one", () => {
  assert.equal(trendLine([1, 2]), null, "two points is not a trend");
  assert.equal(trendLine([5, 5, 5, 5])?.slope, 0);
  const up = trendLine([1, 2, 3, 4, 5]);
  assert.ok(up && up.slope > 0 && up.to > up.from);
});

// ── the chart must not chart the future ──────────────────────────────────────

test("the chart is clamped to today and to the first day with real data", () => {
  const block = slice("// Never chart into the future", GOALS_ANCHOR);
  // "This month" runs to the last of the month, so on the 28th the remaining
  // days were empty bars that read as days of doing nothing.
  assert.match(block, /chartEnd = endDate > businessToday \? businessToday : endDate/);
  // "All time" resolves to 2000-01-01 but no feed has a row before 2026.
  assert.match(block, /firstActivity > chartStart\) chartStart = firstActivity/);
});

// ── notes ────────────────────────────────────────────────────────────────────

test("every note is kept, and the switches only choose where it also shows", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS clr_notes/);
  assert.match(storage, /note_date TEXT NOT NULL/);
  assert.match(storage, /ADD COLUMN kind TEXT NOT NULL DEFAULT 'note'/);
  assert.match(storage, /ADD COLUMN show_on_chart INTEGER NOT NULL DEFAULT 0/);
  assert.match(storage, /ADD COLUMN in_daily_report INTEGER NOT NULL DEFAULT 0/);
  // Flipping a switch must never rewrite or drop the note itself.
  const toggle = storage.slice(
    storage.indexOf("export function setClrNoteDisplay"),
    storage.indexOf("/** Only the author, or an admin, may remove a note. */"),
  );
  assert.ok(toggle.length > 0);
  assert.ok(!/DELETE FROM clr_notes/.test(toggle), "a display toggle must not delete");
  assert.ok(!/SET body=/.test(toggle), "a display toggle must not edit the note text");
  assert.match(toggle, /!actorIsAdmin && Number\(row\.author_user_id\) !== actorUserId/);
});

test("a note can never move a number", () => {
  // The bucket builder is the only thing that produces chart values, and it
  // has no notion of a note at all.
  const buckets = readFileSync(join(root, "server/chart-buckets.ts"), "utf8");
  assert.ok(!/note/i.test(buckets.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")),
    "the series builder must not know about notes");
  // And the profile route reads them through the chart-notes accessor only,
  // never folding them into a metric.
  const block = slice("const chartNotes = storageExtra.listClrChartNotes", GOALS_ANCHOR);
  assert.ok(!/\+= *chartNotes|chartNotes\.length *\+|reduce/.test(block));
  assert.match(page, /no note is ever counted in a statistic|never counted in any statistic/i);
});

test("warnings and PIPs are drawn differently from ordinary notes", () => {
  assert.match(page, /const NOTE_STYLES = \{/);
  for (const k of ["note:", "warning:", "pip:"]) assert.ok(page.includes(k), `missing style ${k}`);
  // Three visually distinct markers, not one colour reused.
  const dots = Array.from(page.matchAll(/dot: "(hsl\([^"]+\))"/g)).map((m) => m[1]);
  assert.equal(new Set(dots).size, 3, "each note kind needs its own colour");
});

test("notes are manager-gated, org-scoped and audited", () => {
  const get = routes.slice(routes.indexOf('app.get("/api/clr-profiles/:id/notes"'), routes.indexOf('app.patch("/api/clr-profiles/notes/:noteId"'));
  const post = routes.slice(routes.indexOf('app.post("/api/clr-profiles/:id/notes"'), routes.indexOf('app.delete("/api/clr-profiles/notes/:noteId"'));
  const patch = routes.slice(routes.indexOf('app.patch("/api/clr-profiles/notes/:noteId"'), routes.indexOf('app.post("/api/clr-profiles/:id/notes"'));
  for (const block of [get, post]) {
    assert.match(block, /requireManagerOrAdmin\(req, res\)/);
    // getUserById is not org-scoped — without this a manager could reach
    // another tenant's people.
    assert.match(block, /uOrg !== orgId\)\) return res\.status\(404\)/);
  }
  assert.match(patch, /requireManagerOrAdmin\(req, res\)/);
  assert.match(post, /audit\(\{/);
  assert.match(patch, /audit\(\{/);
  const del = storage.slice(storage.indexOf("export function deleteClrNote"), storage.indexOf("// ── Email send ledger"));
  assert.match(del, /!actorIsAdmin && Number\(row\.author_user_id\) !== actorUserId/);
});

test("notes flagged for the report email reach the report, escaped", () => {
  const block = routes.slice(routes.indexOf("const dayNotesHtml = (() => {"), routes.indexOf("const transferDetailsHtml"));
  assert.ok(block.length > 0, "the report must have a notes section");
  assert.match(block, /listDailyReportNotes/);
  // A note is free text written by a person and lands in an HTML email.
  assert.match(block, /replace\(\/</);
  assert.match(routes, /<!--SEC:dayNotes-->/);
  // Managers can turn the section off like any other.
  const settings = readFileSync(join(root, "client/src/pages/settings.tsx"), "utf8");
  assert.match(settings, /key: "dayNotes"/);
});

// ── page ─────────────────────────────────────────────────────────────────────

test("the page lets a manager pick which metric to plot", () => {
  assert.match(page, /const DAILY_SERIES = \[/);
  for (const label of ["Call time", "Dialpad calls", "CallTools calls", "Conversations", "Transfers", "Appointments"]) {
    assert.ok(page.includes(label), `the picker should offer ${label}`);
  }
  assert.match(page, /data-testid=\{"clr-series-" \+ sdef\.key\}/);
  // A real chart with axes, not hand-computed pixel heights.
  assert.match(page, /<ComposedChart data=\{chartRows\}/);
  assert.ok(!page.includes("peakCalls"), "the hand-drawn pixel bars must be gone");
  assert.match(page, /data-testid="clr-note-save"/);
});

test("the timeframe expands without losing the month default", () => {
  assert.match(page, /useState\("month"\)/, "the default view must stay this month");
  for (const v of ["lastmonth", "90days", "180days", "alltime"]) {
    assert.ok(listPage.includes(`value: "${v}"`), `missing period ${v}`);
  }
  assert.ok(listPage.includes('label: "Last 3 months"') && listPage.includes('label: "Last 6 months"'));
  // Every period-taking endpoint shares one resolver, and its fallthrough is
  // silent — an unknown name would quietly return this month instead.
  assert.match(routes, /if \(name === "180days"\)/);
  assert.match(routes, /if \(name === "lastmonth"\)/);
});

test("the chart card survives a range that yields a single bucket", () => {
  // The old guard was `.length > 1`, which rendered nothing at all — no chart,
  // no message — for a one-bucket range.
  assert.match(page, /data\.daily\.length >= 1 &&/);
  assert.ok(!page.includes("Too many days to chart"), "no range is refused now");
});

test("the trend line is only offered where it means something", () => {
  assert.match(page, /const showTrend = LONG_PERIODS\.has\(period\) && \(data\?\.daily\?\.length \?\? 0\) >= 3/);
  assert.match(listPage, /export const LONG_PERIODS = new Set\(\["90days", "180days", "alltime"\]\)/);
});

test("weekly goals stop being scaled once the window is too long to mean anything", () => {
  // The old gate compared the period string to "alltime", so "Last 6 months"
  // drew bars against a 26x target.
  assert.ok(!page.includes('period === "alltime"'), "the goal gate must not be a string equality");
  assert.match(page, /const goalsTooLong = \(data\?\.periodWeeks \?\? 1\) > 9/);
  assert.match(page, /weeklyGoal > 0 && !goalsTooLong/, "the bars must be gated, not just the footnote");
});
