import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  tvPageWindows, previousBusinessDay, leadSourceCoverage, activeAgoSeconds, activeCount,
  starvedWindowStart, compareStarved, orderStarved,
  ACTIVE_WINDOW_SECONDS, ACTIVE_WINDOW_LABEL, LEAD_SOURCE_TRUSTED_FROM, STARVED_WINDOW_DAYS,
} from "../server/tv-pages";
import { businessTodayInTz } from "../server/business-day";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

// ── windows ─────────────────────────────────────────────────────────────────

test("the week starts on Monday, exactly as the fast feed computes it", () => {
  // The feed's own arithmetic, copied verbatim, so the two endpoints cannot
  // drift apart without this failing.
  const feedMonday = (today: string) => {
    const t = new Date(`${today}T12:00:00Z`);
    const dow = t.getUTCDay();
    const monday = new Date(t);
    monday.setUTCDate(t.getUTCDate() - ((dow + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };
  for (const day of [
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-05", "2026-09-06",
    "2026-01-01", "2026-03-08", "2026-11-01", "2024-02-29",
  ]) {
    assert.equal(tvPageWindows(day).weekStart, feedMonday(day), day);
  }
});

test("Sunday belongs to the week that is ending, not the one starting", () => {
  assert.equal(tvPageWindows("2026-09-06").weekStart, "2026-08-31");
  assert.equal(tvPageWindows("2026-09-07").weekStart, "2026-09-07");
});

test("the month window starts on the 1st", () => {
  assert.equal(tvPageWindows("2026-09-02").monthStart, "2026-09-01");
  assert.equal(tvPageWindows("2026-09-01").monthStart, "2026-09-01");
  assert.equal(tvPageWindows("2026-12-31").monthStart, "2026-12-01");
});

test("one scan covers all three windows: `from` is the earliest of them", () => {
  // Early in the month the week reaches back into the previous month...
  const early = tvPageWindows("2026-09-02");
  assert.equal(early.weekStart, "2026-08-31");
  assert.equal(early.from, "2026-08-31");
  // ...and later in the month the 1st reaches back further than the week.
  const late = tvPageWindows("2026-09-28");
  assert.equal(late.weekStart, "2026-09-28");
  assert.equal(late.from, "2026-09-01");
  // A Monday the 1st: both agree.
  const both = tvPageWindows("2026-06-01");
  assert.equal(both.weekStart, "2026-06-01");
  assert.equal(both.from, "2026-06-01");
});

// ── previous business day ───────────────────────────────────────────────────

test("previous business day steps back one weekday", () => {
  assert.equal(previousBusinessDay("2026-09-02"), "2026-09-01"); // Wed -> Tue
  assert.equal(previousBusinessDay("2026-09-03"), "2026-09-02"); // Thu -> Wed
});

test("Monday reaches back over the weekend to Friday", () => {
  assert.equal(previousBusinessDay("2026-08-31"), "2026-08-28"); // Mon -> Fri
  assert.equal(previousBusinessDay("2026-09-07"), "2026-09-04");
});

test("a weekend anchor still lands on Friday", () => {
  assert.equal(previousBusinessDay("2026-09-05"), "2026-09-04"); // Sat -> Fri
  assert.equal(previousBusinessDay("2026-09-06"), "2026-09-04"); // Sun -> Fri
});

test("month and year boundaries", () => {
  assert.equal(previousBusinessDay("2026-09-01"), "2026-08-31");
  assert.equal(previousBusinessDay("2026-01-01"), "2025-12-31");
  assert.equal(previousBusinessDay("2026-03-02"), "2026-02-27"); // Mon -> Fri
});

test("the 7pm rollover moves the EOD anchor forward a day", () => {
  const tz = "America/Los_Angeles";
  // Friday 6:59pm PT is still Friday, so the previous business day is Thursday.
  const before = businessTodayInTz(tz, new Date("2026-09-04T18:59:00-07:00"));
  assert.equal(before, "2026-09-04");
  assert.equal(previousBusinessDay(before), "2026-09-03");
  // At 7:00pm the business day becomes Saturday, so Friday — the day that just
  // ended — is now the day whose reports are being chased.
  const after = businessTodayInTz(tz, new Date("2026-09-04T19:00:00-07:00"));
  assert.equal(after, "2026-09-05");
  assert.equal(previousBusinessDay(after), "2026-09-04");
});

test("Sunday evening rolls into Monday, whose previous business day is Friday", () => {
  const tz = "America/Los_Angeles";
  const anchor = businessTodayInTz(tz, new Date("2026-09-06T20:30:00-07:00"));
  assert.equal(anchor, "2026-09-07");
  assert.equal(previousBusinessDay(anchor), "2026-09-04");
});

// ── lead source coverage ────────────────────────────────────────────────────

test("coverage is a share of the transfers in the window", () => {
  assert.deepEqual(leadSourceCoverage(957, 792), { total: 957, withSource: 792, pct: 83 });
  assert.deepEqual(leadSourceCoverage(1951, 1), { total: 1951, withSource: 1, pct: 0 });
});

test("an empty window has no coverage, not 0%", () => {
  // A dash on the wall. 0% would claim nobody filled the field in, when in
  // fact nobody transferred anybody.
  assert.equal(leadSourceCoverage(0, 0).pct, null);
});

test("coverage can never exceed 100%", () => {
  // Two queries that disagree must not print "112% sourced" on a wall.
  assert.deepEqual(leadSourceCoverage(10, 14), { total: 10, withSource: 10, pct: 100 });
});

test("junk counts are clamped rather than propagated", () => {
  assert.deepEqual(leadSourceCoverage(-5, -2), { total: 0, withSource: 0, pct: null });
  assert.deepEqual(leadSourceCoverage(Number.NaN, 3), { total: 0, withSource: 0, pct: null });
});

test("the trustworthy-from date is the rollout date, not the epoch", () => {
  assert.equal(LEAD_SOURCE_TRUSTED_FROM, "2026-08-13");
});

// ── the 15-minute active rule ───────────────────────────────────────────────

const NOW = Date.parse("2026-09-02T22:15:00.000Z");
const agoIso = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

test("either signal counts as active", () => {
  assert.equal(activeAgoSeconds({ nowMs: NOW, secondsChangedAt: agoIso(120), lastEventAt: null }), 120);
  assert.equal(activeAgoSeconds({ nowMs: NOW, secondsChangedAt: null, lastEventAt: agoIso(300) }), 300);
});

test("the freshest of the two signals wins", () => {
  assert.equal(
    activeAgoSeconds({ nowMs: NOW, secondsChangedAt: agoIso(600), lastEventAt: agoIso(45) }),
    45,
  );
});

test("nothing older than fifteen minutes is active", () => {
  assert.equal(activeAgoSeconds({ nowMs: NOW, secondsChangedAt: agoIso(901), lastEventAt: null }), null);
  // Exactly on the boundary still counts.
  assert.equal(
    activeAgoSeconds({ nowMs: NOW, secondsChangedAt: agoIso(ACTIVE_WINDOW_SECONDS), lastEventAt: null }),
    ACTIVE_WINDOW_SECONDS,
  );
});

test("a stale signal alongside a fresh one does not hide the fresh one", () => {
  assert.equal(activeAgoSeconds({ nowMs: NOW, secondsChangedAt: agoIso(4000), lastEventAt: agoIso(200) }), 200);
});

test("no signal at all is not active", () => {
  assert.equal(activeAgoSeconds({ nowMs: NOW }), null);
  assert.equal(activeAgoSeconds({ nowMs: NOW, secondsChangedAt: null, lastEventAt: null }), null);
  assert.equal(activeAgoSeconds({ nowMs: NOW, secondsChangedAt: "not a date", lastEventAt: "" }), null);
});

test("a stamp slightly in the future is clock skew, not the future", () => {
  assert.equal(activeAgoSeconds({ nowMs: NOW, secondsChangedAt: agoIso(-30), lastEventAt: null }), 0);
});

test("microsecond stamps from the CallTools feed parse", () => {
  // Real shape from callsync_activity_events.occurred_at on prod.
  const at = "2026-09-02T22:12:44.241572Z";
  const ago = activeAgoSeconds({ nowMs: Date.parse("2026-09-02T22:15:05.737Z"), lastEventAt: at });
  assert.equal(ago, 141);
});

test("the count treats null as absent, never as zero seconds ago", () => {
  assert.equal(activeCount([{ activeAgo: 0 }, { activeAgo: 300 }, { activeAgo: null }]), 2);
  assert.equal(activeCount([]), 0);
});

// ── the rules the route has to keep ─────────────────────────────────────────

/** Just the /pages handler, cut at the route registered after it. */
function pagesRoute(): string {
  const start = routes.indexOf(`app.get("/api/tv/:token/pages"`);
  assert.ok(start > 0, "the /pages route is registered");
  const end = routes.indexOf("// ── LO priority share link", start);
  assert.ok(end > start, "the handler is bounded by the next section");
  return routes.slice(start, end);
}

test("the pages route exists, is token-checked, and cannot 500", () => {
  const start = routes.indexOf(`app.get("/api/tv/:token/pages"`);
  const feed = routes.indexOf(`app.get("/api/tv/:token/feed"`);
  assert.ok(feed > 0 && feed < start, "it sits after the feed route");
  const body = pagesRoute();
  assert.match(body, /tvLink\(req\.params\.token\)/, "same token check as the feed");
  assert.ok(!/res\.status\(5\d\d\)/.test(body), "no 5xx path in the pages handler");
  // Every section is wrapped on its own AND the whole body is wrapped again.
  assert.ok(body.split("section(").length - 1 >= 8, "all eight sections are built through the wrapper");
  // Read-only, like the feed: the single write is bookkeeping on the link row.
  const writes = body.match(/\b(INSERT|UPDATE|DELETE)\b/g) ?? [];
  assert.deepEqual(writes, ["UPDATE"], "a wallboard endpoint writes nothing but its own liveness stamp");
  assert.match(body, /UPDATE tv_display_links SET last_used_at/);
  // The feed already counts this TV's polls; counting them twice would inflate
  // every link's use_count.
  assert.ok(!/use_count=use_count\+1/.test(body), "the pages route does not double-count polls");
});

test("the pages route does not read observed_at as a presence signal", () => {
  const body = pagesRoute();
  // observed_at is a feed heartbeat: every row for the day shares one stamp,
  // including agents with zero activity. Only seconds_changed_at may answer
  // "when did this person last do something".
  assert.ok(!/SELECT[^`]*observed_at/i.test(body), "observed_at is not selected");
  assert.match(body, /seconds_changed_at/);
});

test("presence is labelled by what was measured, not as being logged in", () => {
  assert.equal(ACTIVE_WINDOW_LABEL, "active in the last 15 minutes");
  assert.match(pagesRoute(), /label: ACTIVE_WINDOW_LABEL/, "the wall gets the honest label");
});

test("the delta columns exist with the repo's idempotent ALTER pattern", () => {
  assert.match(storage, /ALTER TABLE callsync_agent_activity_daily ADD COLUMN prev_seconds INTEGER/);
  assert.match(storage, /ALTER TABLE callsync_agent_activity_daily ADD COLUMN seconds_changed_at TEXT/);
  for (const col of ["prev_seconds INTEGER", "seconds_changed_at TEXT"]) {
    const i = storage.indexOf(`ADD COLUMN ${col}`);
    assert.match(storage.slice(Math.max(0, i - 120), i), /try \{ sqlite\.exec\(`ALTER TABLE/);
  }
});

test("the CallSync update path writes the delta columns", () => {
  const i = routes.indexOf("INSERT INTO callsync_agent_activity_daily");
  assert.ok(i > 0);
  const body = routes.slice(i, i + 3000);
  assert.match(body, /prev_seconds, seconds_changed_at/);
  assert.match(body, /seconds_changed_at=CASE/);
  // The change test has to compare the NEW total against the stored one, not
  // against the raw observation.
  assert.match(body, /<> callsync_agent_activity_daily\.active_seconds/);
});

test("EOD is anchored to the previous business day and carries no note text", () => {
  const body = pagesRoute();
  assert.match(body, /previousBusinessDay\(w\.today\)/);
  const eod = body.slice(body.indexOf('section("eod"'), body.indexOf('section("phoneTime"'));
  assert.ok(!/\be\.notes\b/.test(eod), "report notes name borrowers and never reach the wall");
});

test("phone time reads the daily table, never a sum of the event rows", () => {
  const body = pagesRoute();
  const phone = body.slice(body.indexOf('section("phoneTime"'), body.indexOf('section("leadSources"'));
  assert.match(phone, /FROM callsync_agent_activity_daily/);
  assert.ok(!/FROM callsync_activity_events/.test(phone), "summing the events double-counts");
});

// ── the starved window ──────────────────────────────────────────────────────

test("the window is fourteen whole days with today on top of them", () => {
  // Not thirteen-plus-today. Today is a part-day — at 9am it holds almost
  // nothing — so spending one of the fourteen on it would make every morning
  // read as a drought. Measured on prod on 2026-09-02 this boundary is the one
  // the page's numbers were read off.
  assert.equal(STARVED_WINDOW_DAYS, 14);
  assert.equal(starvedWindowStart("2026-09-02"), "2026-08-19");
});

test("the window crosses month and year boundaries", () => {
  assert.equal(starvedWindowStart("2026-09-10"), "2026-08-27");
  assert.equal(starvedWindowStart("2026-01-05"), "2025-12-22");
  assert.equal(starvedWindowStart("2024-03-01"), "2024-02-16"); // leap year
});

test("a caller can ask for a different span, and junk falls back to fourteen", () => {
  assert.equal(starvedWindowStart("2026-09-02", 7), "2026-08-26");
  assert.equal(starvedWindowStart("2026-09-02", 0), "2026-08-19");
  assert.equal(starvedWindowStart("2026-09-02", -30), "2026-08-19");
  assert.equal(starvedWindowStart("2026-09-02", Number.NaN), "2026-08-19");
});

// ── the starved ordering ────────────────────────────────────────────────────

const prodLos = [
  { name: "Christopher Redoble", transfers: 294, needsTransfers: true },
  { name: "Michael Kim", transfers: 17, needsTransfers: true },
  { name: "Shervin Mohseni", transfers: 34, needsTransfers: true },
  { name: "Derek Bullen", transfers: 6 },
  { name: "Sean Murphy", transfers: 8 },
  { name: "Cole Thomas Fairon", transfers: 14 },
  { name: "Mateo Tedeschi", transfers: 17 },
];

test("fewest received comes first", () => {
  assert.deepEqual(
    orderStarved(prodLos).map((p) => p.name),
    [
      "Derek Bullen", "Sean Murphy", "Cole Thomas Fairon",
      "Mateo Tedeschi", "Michael Kim", "Shervin Mohseni", "Christopher Redoble",
    ],
  );
});

test("a flagged loan officer is NOT pinned to the top", () => {
  // The whole point. Christopher Redoble carries needs_transfers AND took 294
  // transfers in the same fortnight the bottom of the list took six; sorting by
  // the flag would put the best-fed LO at the head of a starvation list. The
  // badge does the emphasis, the rank means one thing.
  const ordered = orderStarved(prodLos);
  assert.equal(ordered[0].name, "Derek Bullen");
  assert.equal(ordered[ordered.length - 1].name, "Christopher Redoble");
  assert.equal(ordered[ordered.length - 1].needsTransfers, true);
  // Two people on 17, one flagged: the flag does not break the tie either.
  const tied = ordered.filter((p) => p.transfers === 17).map((p) => p.name);
  assert.deepEqual(tied, ["Mateo Tedeschi", "Michael Kim"]);
});

test("a loan officer who received nothing sits at the very top", () => {
  // The LEFT JOIN's whole reason for being: a fortnight with zero transfers is
  // the most important row on the page, not an absent one.
  const ordered = orderStarved([
    { name: "Someone Busy", transfers: 40 },
    { name: "Nobody Sent To", transfers: 0, lastAt: null },
  ]);
  assert.equal(ordered[0].name, "Nobody Sent To");
});

test("ties break by name, and junk counts sort as zero", () => {
  assert.deepEqual(
    orderStarved([
      { name: "Zoe", transfers: 5 }, { name: "Adam", transfers: 5 },
      { name: "Broken", transfers: Number.NaN }, { name: "Negative", transfers: -3 },
    ]).map((p) => p.name),
    ["Broken", "Negative", "Adam", "Zoe"],
  );
  assert.ok(compareStarved({ name: "A", transfers: 1 }, { name: "B", transfers: 2 }) < 0);
  assert.ok(compareStarved({ name: "B", transfers: 2 }, { name: "A", transfers: 1 }) > 0);
});

test("ordering leaves the caller's array alone", () => {
  const rows = [{ name: "B", transfers: 9 }, { name: "A", transfers: 1 }];
  const out = orderStarved(rows);
  assert.deepEqual(rows.map((r) => r.name), ["B", "A"]);
  assert.deepEqual(out.map((r) => r.name), ["A", "B"]);
  assert.notEqual(out, rows);
});

// ── the rules the starved section has to keep ───────────────────────────────

/** Just the starved section of the /pages handler. */
function starvedSection(): string {
  const body = pagesRoute();
  const start = body.indexOf('section("starved"');
  assert.ok(start > 0, "the starved section is built through the wrapper");
  const end = body.indexOf('section("writeUps"', start);
  assert.ok(end > start, "it is bounded by the next section");
  return body.slice(start, end);
}

test("both lists LEFT JOIN, so people with nothing survive the query", () => {
  const s = starvedSection();
  assert.equal(s.match(/LEFT JOIN lead_outcomes/g)?.length, 2, "LOs and LOAs both");
  // An inner join, or a date test in the WHERE clause, deletes exactly the
  // people this page exists to name.
  assert.ok(!/\n\s*JOIN lead_outcomes/.test(s), "no inner join onto the transfers");
  assert.match(s, /SUM\(CASE WHEN o\.date >= \?/, "the window is a conditional sum, not a filter");
});

test("the LO list is every active loan officer, and the LOA list only active LOAs", () => {
  const s = starvedSection();
  assert.match(s, /lo\.internal_status = 'active'/);
  assert.match(s, /a\.active = 1/);
  // Five of the twelve LOA rows on prod are switched off with zero transfers
  // ever; without the filter they would permanently head the list.
  assert.match(s, /loan_officer_assistants/);
});

test("nothing in the starved section ranks by priority_tier", () => {
  // Every one of the 17 active LOs on prod is tier 2, so it separates nobody.
  assert.ok(!/priority_tier/.test(starvedSection()));
});

test("the flag is carried to the page but never sorts it", () => {
  const s = starvedSection();
  assert.match(s, /needs_transfers/, "the flag is selected");
  assert.match(s, /orderStarved\(los\)/, "and the shared rule does the ordering");
  assert.match(s, /orderStarved\(loas\)/);
  // No local sort could reintroduce a flag-first rank behind orderStarved's back.
  assert.ok(!/\.sort\(/.test(s), "the ordering lives in one tested place");
});

test("the starved section is org-scoped like every other one", () => {
  const s = starvedSection();
  assert.match(s, /lo\.org_id = \?/, "loan officers carry org_id");
  // loan_officer_assistants has no org_id column; the parent LO is the scope.
  assert.match(s, /JOIN loan_officers lo ON lo\.id = a\.lo_id/);
});

test("the window comes from the shared helper, not a second copy of the maths", () => {
  assert.match(starvedSection(), /starvedWindowStart\(w\.today\)/);
  assert.match(starvedSection(), /days: STARVED_WINDOW_DAYS/);
});

test("last-transfer is the real last one, not the last one inside the window", () => {
  // MAX over a join that carries no date test. Clipping it to the window would
  // hand every starved row a null and lose the one thing they can say.
  assert.match(starvedSection(), /MAX\(o\.date\) AS lastAt/);
});
