import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  tvPageWindows, previousBusinessDay, leadSourceCoverage, activeAgoSeconds, activeCount,
  starvedWindowStart, compareStarved, orderStarved,
  orderByRecentlyActive, orderAssignmentPeople,
  ACTIVE_WINDOW_SECONDS, ACTIVE_WINDOW_LABEL, LEAD_SOURCE_TRUSTED_FROM, STARVED_WINDOW_DAYS,
  appointmentStamp, appointmentInstantMs, appointmentDay, isDateOnlyStamp,
  upcomingHorizonMs, compareUpcoming, selectUpcomingAppointments,
  UPCOMING_DAYS, UPCOMING_APPOINTMENT_TYPE, type UpcomingApptRow,
} from "../server/tv-pages";
import { businessTodayInTz, parseWallClockInTz } from "../server/business-day";
import Database from "better-sqlite3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
/** The module under test, read as text where a rule is a comment as much as code. */
const pagesSource = readFileSync(join(root, "server/tv-pages.ts"), "utf8");
/** The wall's pages, for the rules that only exist in what they render. */
const tvPagesSource = readFileSync(join(root, "client/src/components/tv/pages.tsx"), "utf8");

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

// ── "Where they came from" says ONE period ──────────────────────────────────
//
// Ethan: "the time frame for where they came from is confusing". The eyebrow
// carried a window name AND a start date — "This month · since Aug 13" — two
// periods for one set of bars, and no way to tell which one the numbers were.

/** Just the leadSources section of the /pages handler. */
function leadSourceSection(): string {
  const body = pagesRoute();
  const start = body.indexOf('section("leadSources"');
  assert.ok(start > 0, "the lead sources section is built through the wrapper");
  const end = body.indexOf('section("onPhoneNow"', start);
  assert.ok(end > start, "it is bounded by the next section");
  return body.slice(start, end);
}

test("a window that reaches back past the rollout is CLIPPED, not merely labelled", () => {
  // The old section counted the whole window and then printed the rollout date
  // beside its name, so the numbers and the label disagreed: a month window
  // starting the 1st really did include untracked days, which inflated the
  // blanks the coverage line reports.
  const s = leadSourceSection();
  assert.match(s, /const effectiveStart = \(start: string\) =>\s*\n?\s*start < LEAD_SOURCE_TRUSTED_FROM \? LEAD_SOURCE_TRUSTED_FROM : start;/);
  // Every bucket boundary goes through it, and so does the scan itself.
  assert.match(s, /\.all\(w\.today, effectiveStart\(w\.weekStart\), effectiveStart\(w\.monthStart\), orgId, scanFrom\)/);
  assert.match(s, /const scanFrom = effectiveStart\(w\.from\);/);
});

test("each window reports the dates it actually covers, and whether the rollout moved them", () => {
  const s = leadSourceSection();
  assert.match(s, /const startDate = effectiveStart\(nominalStart\);/);
  assert.match(s, /endDate: w\.today/);
  assert.match(s, /clipped: startDate !== nominalStart/);
  // The bare rollout date no longer travels on its own, because a second date
  // beside a window name is exactly the confusion being removed.
  assert.ok(!/fromDate: LEAD_SOURCE_TRUSTED_FROM/.test(s), "no second period ships with the payload");
});

test("the eyebrow prints one period: the window's name, or the real dates", () => {
  const page = tvPagesSource.slice(
    tvPagesSource.indexOf("export function LeadSourcePage"),
    tvPagesSource.indexOf("// ── on the phone now"),
  );
  assert.ok(page.length > 0, "the lead source page is in tv/pages.tsx");
  // One expression, one period.
  assert.match(page, /<Eyebrow>Lead source · \{period\}<\/Eyebrow>/);
  assert.ok(!/since \$\{/.test(page), "the 'since ...' suffix is gone");
  // Unclipped, the window's own name says everything and the date is noise.
  assert.match(page, /: WINDOW_TITLE\[win\];/);
  // Clipped, the name would overstate the days counted, so the dates replace
  // it — and a window clipped down to a single day says that day once.
  assert.match(page, /`\$\{from\} – \$\{to\}`/);
  assert.match(page, /to && to !== from/);
  // The thin-data caveat is a different thing and stays.
  assert.match(page, /data-testid="tv-lead-source-coverage"/);
  assert.match(page, /const thin = cov < 0\.95 && blank > 0;/);
});

test("the board hands the page the dates, not the rollout constant", () => {
  const board = readFileSync(join(root, "client/src/pages/tv.tsx"), "utf8");
  const call = board.slice(board.indexOf("<LeadSourcePage"), board.indexOf("{page === \"starved\""));
  assert.match(call, /startDate=\{wnd\?\.startDate \?\? ""\}/);
  assert.match(call, /endDate=\{wnd\?\.endDate \?\? board\?\.today \?\? ""\}/);
  assert.match(call, /clipped=\{!!wnd\?\.clipped\}/);
  assert.ok(!/fromDate=/.test(call), "the page is no longer handed a second period to print");
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

test("EOD is anchored to today, and carries no note text", () => {
  const body = pagesRoute();
  const eod = body.slice(body.indexOf('section("eod"'), body.indexOf('section("phoneTime"'));
  // Today, deliberately. The deadline is 4pm the NEXT business day, so this
  // board is empty for most of the day — which is why the deck only gives it
  // the wall between 3.30 and 6pm, while people are filing. In that window
  // "who still owes one" is the useful question and yesterday's answer is not.
  assert.match(eod, /const forDate = w\.today;/);
  assert.doesNotMatch(eod, /previousBusinessDay/);
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

// ── what is coming up ───────────────────────────────────────────────────────

const TZ = "America/Los_Angeles";
/** Thursday. The whole upcoming block is read off this day. */
const THU = "2026-09-03";
const at = (wall: string) => parseWallClockInTz(wall, TZ);
/** How the office clock reads an instant — the check that matters here. */
const officeClock = (ms: number) => new Date(ms).toLocaleString("en-US", {
  timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit",
});

test("an appointment's time comes from follow_up_date, then appointment_datetime", () => {
  // THE DRIFTED ROW. The Outcomes dialog used to save followUpDate alone and
  // leave appointment_datetime sitting on the meeting's ORIGINAL time, and
  // every meeting it moved before it started mirroring is still that shape in
  // the table (server/tv-board.ts says so at length). follow_up_date is the
  // live slot on those rows; appointment_datetime is the abandoned one.
  assert.equal(
    appointmentStamp({ appointmentDatetime: "2026-09-04T10:00", followUpDate: "2026-09-05T10:00" }),
    "2026-09-05T10:00",
    "the follow-up is the slot the meeting actually moved to",
  );
  // Mirrored rows — the shape every edit dialog writes now — agree either way.
  assert.equal(
    appointmentStamp({ appointmentDatetime: "2026-09-05T10:00", followUpDate: "2026-09-05T10:00" }),
    "2026-09-05T10:00",
  );
  // Most rows in production have only this one: the Appointments page binds
  // its datetime-local input to follow_up_date.
  assert.equal(appointmentStamp({ followUpDate: "2026-09-04T10:00" }), "2026-09-04T10:00");
  assert.equal(appointmentStamp({ appointmentDatetime: null, followUpDate: "2026-09-04" }), "2026-09-04");
  // And CallSync books straight into appointment_datetime with no follow-up at
  // all, so that column is still the fallback and always will be.
  assert.equal(appointmentStamp({ appointmentDatetime: "2026-09-04T10:00" }), "2026-09-04T10:00");
  assert.equal(appointmentStamp({ appointmentDatetime: "2026-09-04T10:00", followUpDate: "  " }), "2026-09-04T10:00");
  // Blank is absent, exactly as SQL's NULLIF treats it.
  assert.equal(appointmentStamp({ appointmentDatetime: "   ", followUpDate: "2026-09-04T10:00" }), "2026-09-04T10:00");
  assert.equal(appointmentStamp({ appointmentDatetime: "", followUpDate: "" }), "");
  assert.equal(appointmentStamp(null), "");
});

test("a day with no clock reading still takes the hour off the mirrored column", () => {
  // The quick reschedule mirrors a value onto appointment_datetime only when it
  // carries a "T" (appointments.tsx), so a date-only save leaves a timed stamp
  // behind. When that stamp is on the SAME day the follow-up names, the two
  // columns agree about the day and only one of them knows the hour — so the
  // wall prints 10:00 instead of "time not set". It is a tie-break inside one
  // day, never a preference: it cannot move a meeting to another day.
  assert.equal(
    appointmentStamp({ appointmentDatetime: "2026-09-04T10:00", followUpDate: "2026-09-04" }, TZ),
    "2026-09-04T10:00",
  );
  // A different day is the drift again, and the follow-up wins outright.
  assert.equal(
    appointmentStamp({ appointmentDatetime: "2026-09-01T10:00", followUpDate: "2026-09-04" }, TZ),
    "2026-09-04",
  );
  // Two date-only columns have no hour to borrow.
  assert.equal(
    appointmentStamp({ appointmentDatetime: "2026-09-04", followUpDate: "2026-09-04" }, TZ),
    "2026-09-04",
  );
  // The day is compared on the OFFICE's clock, not on the stamp's leading ten
  // characters: 04:30Z on the 4th is the evening of the 3rd in Los Angeles.
  assert.equal(
    appointmentStamp({ appointmentDatetime: "2026-09-04T04:30:00Z", followUpDate: "2026-09-03" }, TZ),
    "2026-09-04T04:30:00Z",
  );
  assert.equal(
    appointmentStamp({ appointmentDatetime: "2026-09-04T04:30:00Z", followUpDate: "2026-09-04" }, TZ),
    "2026-09-04",
  );
});

test("the reminders keep their own COALESCE, and this page does not copy it", () => {
  // reminders.ts prefers appointment_datetime, and that is right for a cron
  // asking "is there a time to remind about". It is the wrong preference for a
  // wall asking "which day is this meeting on", because on a drifted row the
  // two columns answer differently — so the orders are opposite ON PURPOSE and
  // this test pins both of them rather than letting them quietly converge.
  const reminders = readFileSync(join(root, "server/reminders.ts"), "utf8");
  const coalesce = reminders.slice(reminders.indexOf("COALESCE("), reminders.indexOf(") AS scheduled_date"));
  assert.ok(
    coalesce.indexOf("appointment_datetime") < coalesce.indexOf("follow_up_date"),
    "the reminder cron still prefers appointment_datetime",
  );
  assert.match(routes, /Prefer appointment_datetime, fall back to follow_up_date/);
  // The board's rule is the other way round, and says why.
  const stamp = pagesSource.slice(
    pagesSource.indexOf("Which of the two columns holds this appointment's LIVE time"),
    pagesSource.indexOf("export function isDateOnlyStamp"),
  );
  assert.ok(stamp.indexOf("const follow =") < stamp.indexOf("const appt ="));
  assert.match(stamp, /if \(!follow\) return appt;/);
  assert.match(stamp, /appointments\.tsx/, "the surface the office already believes is named");
});

test("the board agrees with the Appointments page about which column is live", () => {
  // The page the floor actually reads sorts, groups and prints from
  // followUpDate alone — so a meeting it lists on Friday must not be on the
  // wall as Tuesday's.
  const appointments = readFileSync(join(root, "client/src/pages/appointments.tsx"), "utf8");
  assert.match(appointments, /const dayOf = \(o: Outcome\) => String\(o\.followUpDate\)\.slice\(0, 10\);/);
  assert.match(appointments, /\.sort\(\(a, b\) => \(a\.followUpDate \?\? "9999-99-99"\)/);
  // And its edit dialog clears appointment_datetime rather than letting a stale
  // value shadow the new follow-up: that column is a mirror, not a source.
  const mirror = readFileSync(join(root, "client/src/lib/appointment-datetime.ts"), "utf8");
  assert.match(mirror, /followUpDate\.includes\("T"\) \? followUpDate : null/);
});

test("a naive stamp is the office's wall clock, whatever zone this box is in", () => {
  // The bug this exists to stop: "14:30" carries no zone, so handing it to
  // Date.parse reads it in the SERVER's zone — UTC on Railway — and a 2:30 PM
  // appointment went up on the wall as 7:30 AM.
  const original = process.env.TZ;
  try {
    for (const tz of ["UTC", "America/New_York", "Asia/Manila", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      assert.match(officeClock(appointmentInstantMs("2026-09-03T14:30", TZ)), /Thu 2:30 PM/, tz);
      assert.match(officeClock(appointmentInstantMs("2026-09-03T09:05", TZ)), /Thu 9:05 AM/, tz);
    }
  } finally { process.env.TZ = original; }
  // A stamp that DOES carry a zone is a real instant and is converted.
  assert.match(officeClock(appointmentInstantMs("2026-09-03T21:30:00.000Z", TZ)), /Thu 2:30 PM/);
});

test("a day with no clock reading lasts until the end of that day", () => {
  assert.equal(isDateOnlyStamp("2026-09-04"), true);
  assert.equal(isDateOnlyStamp("2026-09-04T09:00"), false);
  // 23:59, not midnight: resolving a date-only row at midnight would drop it
  // off the board a minute into the morning it is actually due.
  assert.equal(appointmentInstantMs("2026-09-04", TZ), at("2026-09-04T23:59"));
  assert.ok(Number.isNaN(appointmentInstantMs("", TZ)));
  assert.ok(Number.isNaN(appointmentInstantMs(null, TZ)));
});

test("the day label always agrees with the time printed beside it", () => {
  // A naive stamp's leading ten characters ARE the office's day; converting
  // them would be the 7:30 AM bug again. A zoned one is converted, which is
  // the same split whenLabel makes when it renders the time.
  assert.equal(appointmentDay("2026-09-03T23:30", TZ), "2026-09-03");
  assert.equal(appointmentDay("2026-09-03", TZ), "2026-09-03");
  // 04:30Z on the 4th is 9:30 PM on the 3rd in the office.
  assert.equal(appointmentDay("2026-09-04T04:30:00Z", TZ), "2026-09-03");
  assert.equal(appointmentDay("", TZ), "");
});

test("the horizon is today and the six days after it", () => {
  assert.equal(UPCOMING_DAYS, 7);
  // The last instant the page looks as far as: the end of today + 6.
  assert.equal(upcomingHorizonMs(THU, 7, TZ), at("2026-09-09T23:59"));
  assert.equal(upcomingHorizonMs(THU, 1, TZ), at("2026-09-03T23:59"), "one day means today only");
  // Junk falls back to the constant rather than emptying the board.
  assert.equal(upcomingHorizonMs(THU, 0 as any, TZ), upcomingHorizonMs(THU, UPCOMING_DAYS, TZ));
  assert.equal(upcomingHorizonMs(THU, Number.NaN, TZ), upcomingHorizonMs(THU, UPCOMING_DAYS, TZ));
});

/** One board's worth of rows, all of them read against Thursday 10am. */
const upcomingRows: UpcomingApptRow[] = [
  { id: 1, outcomeType: "appointment", borrower: "Dana Whitfield", clr: "Jordon Chang", lo: "Alex Thompson", appointmentDatetime: "2026-09-03T14:30" },
  { id: 2, outcomeType: "appointment", borrower: "Kevin Ostrowski", clr: "Marco Diaz", lo: "Shervin Mohseni", appointmentDatetime: "2026-09-03T09:00" },
  { id: 3, outcomeType: "appointment", borrower: "Tomas Reyes", clr: "Elleine Asuncion", lo: "Derek Bullen", followUpDate: "2026-09-04T11:15" },
  { id: 4, outcomeType: "appointment", borrower: "Priya Natarajan", clr: "Marco Diaz", lo: "Sean Murphy", appointmentDatetime: "", followUpDate: "2026-09-03" },
  { id: 5, outcomeType: "appointment", borrower: "Ana Petrova", clr: "Jordon Chang", lo: "Michael Kim", appointmentDatetime: "2026-09-09T08:00" },
  { id: 6, outcomeType: "appointment", borrower: "Too Far Out", clr: "Jordon Chang", lo: "Michael Kim", appointmentDatetime: "2026-09-10T08:00" },
  { id: 7, outcomeType: "transfer", borrower: "Already Transferred", clr: "Marco Diaz", lo: "Alex Thompson", appointmentDatetime: "2026-09-04T10:00" },
  { id: 8, outcomeType: "fell_through", borrower: "Fell Through", clr: "Marco Diaz", lo: "Alex Thompson", followUpDate: "2026-09-04T10:00" },
  { id: 9, outcomeType: "appointment", borrower: "No Time Yet", clr: "Marco Diaz", lo: "Alex Thompson" },
  { id: 10, outcomeType: "appointment", borrower: "Yesterday", clr: "Marco Diaz", lo: "Alex Thompson", appointmentDatetime: "2026-09-02T10:00" },
];
const upcomingAt10 = () =>
  selectUpcomingAppointments(upcomingRows, { nowMs: at("2026-09-03T10:00"), today: THU, days: UPCOMING_DAYS, tz: TZ });

test("only appointments that have not happened, inside the week, are on the board", () => {
  assert.deepEqual(upcomingAt10().map((a) => a.id), [1, 4, 3, 5]);
});

test("an appointment that already started is off the board", () => {
  // 9am is not "coming up" at two in the afternoon, and a board still listing
  // it is worse than a board listing nothing.
  const nine = upcomingAt10().find((a) => a.id === 2);
  assert.equal(nine, undefined);
  // At 8:30am it has not happened yet, so it IS on the board.
  const earlier = selectUpcomingAppointments(upcomingRows, { nowMs: at("2026-09-03T08:30"), today: THU, tz: TZ });
  assert.ok(earlier.some((a) => a.id === 2));
  // Yesterday's is gone at any hour of today.
  assert.ok(!earlier.some((a) => a.id === 10));
});

test("today's date-only appointment survives the whole day", () => {
  const dateOnly = upcomingAt10().find((a) => a.id === 4);
  assert.ok(dateOnly, "a day with no clock reading is still today's meeting");
  assert.equal(dateOnly!.timed, false, "and the page is told there is no time to print");
  assert.equal(dateOnly!.isToday, true);
  // Still there at half four in the afternoon; gone once the day has ended.
  const late = selectUpcomingAppointments(upcomingRows, { nowMs: at("2026-09-03T16:30"), today: THU, tz: TZ });
  assert.ok(late.some((a) => a.id === 4));
  const tomorrow = selectUpcomingAppointments(upcomingRows, { nowMs: at("2026-09-04T09:00"), today: "2026-09-04", tz: TZ });
  assert.ok(!tomorrow.some((a) => a.id === 4));
});

test("transferred, fell-through and unfinished rows are all excluded", () => {
  const ids = upcomingAt10().map((a) => a.id);
  // Completing an appointment overwrites outcome_type on the same row, and the
  // old appointment_datetime stays behind forever — so the type is the only
  // honest test, and these two rows both carry a future time.
  assert.ok(!ids.includes(7), "a transferred appointment is not upcoming");
  assert.ok(!ids.includes(8), "one that fell through is not upcoming");
  assert.ok(!ids.includes(9), "and one with no time at all is not on the board");
  assert.equal(UPCOMING_APPOINTMENT_TYPE, "appointment");
  // Every other type the Appointments page can save is out for the same reason.
  for (const type of ["transfer", "fell_through", "callback_requested", "deferral", "future_contact", "no_answer", "not_interested", "wrong_number"]) {
    const out = selectUpcomingAppointments(
      [{ id: 99, outcomeType: type, borrower: "X", appointmentDatetime: "2026-09-04T10:00" }],
      { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ },
    );
    assert.equal(out.length, 0, `${type} is not an appointment`);
  }
});

test("the horizon cuts at the end of the seventh day, not the eighth", () => {
  const ids = upcomingAt10().map((a) => a.id);
  assert.ok(ids.includes(5), "the last day of the window is on the board");
  assert.ok(!ids.includes(6), "the day after it is not");
  // The very last minute of the window is in; the first minute after is out.
  const edge = (stamp: string) => selectUpcomingAppointments(
    [{ id: 1, outcomeType: "appointment", borrower: "Edge", appointmentDatetime: stamp }],
    { nowMs: at("2026-09-03T10:00"), today: THU, days: 7, tz: TZ },
  ).length;
  assert.equal(edge("2026-09-09T23:59"), 1);
  assert.equal(edge("2026-09-10T00:00"), 0);
});

test("soonest first, and ties never reshuffle between polls", () => {
  // A date-only row sorts at the END of its day: the board does not know when
  // it is, and guessing 9am would put it above meetings that have a real time.
  assert.deepEqual(upcomingAt10().map((a) => a.borrower), [
    "Dana Whitfield", "Priya Natarajan", "Tomas Reyes", "Ana Petrova",
  ]);
  const same = { atMs: 1, borrower: "", clr: "", lo: null, at: "", timed: true, day: "", isToday: false };
  assert.ok(compareUpcoming({ ...same, id: 1, atMs: 1 }, { ...same, id: 2, atMs: 2 }) < 0);
  assert.ok(compareUpcoming({ ...same, id: 1, borrower: "Zoe" }, { ...same, id: 2, borrower: "Adam" }) > 0);
  assert.ok(compareUpcoming({ ...same, id: 7 }, { ...same, id: 3 }) > 0, "id is the last resort");
});

test("a rebooked appointment shows on its new slot, with nothing special done", () => {
  // A move overwrites the time in place and keeps outcome_type 'appointment',
  // so it simply arrives here as an appointment at the new time.
  const moved = selectUpcomingAppointments(
    [{ id: 1, outcomeType: "appointment", borrower: "Tomas Reyes", clr: "Marco Diaz", lo: "Derek Bullen", appointmentDatetime: "2026-09-08T16:15", followUpDate: "2026-09-08T16:15" }],
    { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ },
  );
  assert.equal(moved.length, 1);
  assert.match(officeClock(moved[0].atMs), /Tue 4:15 PM/);
});

/**
 * A meeting the Outcomes dialog moved before it started mirroring.
 *
 * appointment_datetime is the ABANDONED original; follow_up_date is the slot
 * the meeting actually has. This shape exists in production by the row-load —
 * see server/tv-board.ts — and the app's own Appointments page lists these on
 * the follow-up's day, because that is the only column it reads.
 */
const drifted: UpcomingApptRow[] = [
  // Moved out of last Tuesday into next Tuesday. Preferring the appointment
  // column would read a time in the PAST and drop the meeting off the wall
  // entirely, while Appointments still shows it under Sep 8.
  { id: 41, outcomeType: "appointment", borrower: "Rosa Iglesias", clr: "Marco Diaz", lo: "Derek Bullen",
    appointmentDatetime: "2026-09-01T14:30", followUpDate: "2026-09-08T14:30" },
  // Moved off this morning onto tomorrow afternoon. Preferring the appointment
  // column would put it on the wall as TODAY at 9 — a meeting nobody has.
  { id: 42, outcomeType: "appointment", borrower: "Owen Brady", clr: "Jordon Chang", lo: "Sean Murphy",
    appointmentDatetime: "2026-09-03T09:00", followUpDate: "2026-09-04T13:00" },
];

test("a meeting moved before the mirror shows on its real day, not the abandoned one", () => {
  const out = selectUpcomingAppointments(drifted, { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ });
  assert.deepEqual(out.map((a) => a.id), [42, 41], "both survive, soonest first");

  const [tomorrow, nextWeek] = out;
  // The one whose abandoned time was 9am today: on the board for FRIDAY, not
  // today, and not dropped as "already happened" at ten in the morning.
  assert.equal(tomorrow.day, "2026-09-04");
  assert.equal(tomorrow.isToday, false);
  assert.match(officeClock(tomorrow.atMs), /Fri 1:00 PM/);
  // The one moved into next week: on Tuesday the 8th, not last Tuesday.
  assert.equal(nextWeek.day, "2026-09-08");
  assert.match(officeClock(nextWeek.atMs), /Tue 2:30 PM/);

  // The old rule is what this pins against: read appointment_datetime first and
  // the first row is in the past and the second is on the wrong day.
  const abandoned = drifted.map((r) => String(r.appointmentDatetime));
  assert.ok(abandoned.every((stampText) => !out.some((a) => a.at === stampText)));
});

test("a drifted row is still gone once its REAL slot has passed", () => {
  // The fix must not turn into "never let an appointment expire". The live slot
  // is the one the past test is measured against, exactly like any other row.
  const gone = selectUpcomingAppointments(
    [{ id: 43, outcomeType: "appointment", borrower: "Past It", clr: "Marco Diaz",
       appointmentDatetime: "2026-09-08T14:30", followUpDate: "2026-09-03T09:00" }],
    { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ },
  );
  assert.equal(gone.length, 0, "the follow-up is 9am and it is now 10");
  // ...and present an hour earlier, on the follow-up's time.
  const [live] = selectUpcomingAppointments(
    [{ id: 43, outcomeType: "appointment", borrower: "Past It", clr: "Marco Diaz",
       appointmentDatetime: "2026-09-08T14:30", followUpDate: "2026-09-03T09:00" }],
    { nowMs: at("2026-09-03T08:00"), today: THU, tz: TZ },
  );
  assert.match(officeClock(live.atMs), /Thu 9:00 AM/);
  assert.equal(live.isToday, true);
});

test("a half-filled row is named, not left blank on a wall", () => {
  const [row] = selectUpcomingAppointments(
    [{ id: 1, outcomeType: "appointment", borrower: "  ", clr: null, lo: "  ", appointmentDatetime: "2026-09-04T10:00" }],
    { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ },
  );
  assert.equal(row.borrower, "A borrower");
  assert.equal(row.clr, "A CLR");
  // The loan officer is the one thing left null: "with A loan officer" would
  // be a claim, and the page says "no loan officer named" instead.
  assert.equal(row.lo, null);
});

test("selecting leaves the caller's rows alone and answers an empty board", () => {
  const before = upcomingRows.map((r) => r.id);
  upcomingAt10();
  assert.deepEqual(upcomingRows.map((r) => r.id), before);
  assert.deepEqual(selectUpcomingAppointments([], { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ }), []);
  assert.deepEqual(selectUpcomingAppointments(null, { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ }), []);
});

// ── the rules the upcoming section has to keep ──────────────────────────────

/** Just the upcoming section of the /pages handler. */
function upcomingSection(): string {
  const body = pagesRoute();
  const start = body.indexOf('section("upcoming"');
  assert.ok(start > 0, "the upcoming section is built through the wrapper");
  const end = body.indexOf("} catch (e: any) {", start);
  assert.ok(end > start, "it is bounded by the handler's own catch");
  return body.slice(start, end);
}

test("the upcoming section reads only appointments, org-scoped", () => {
  const s = upcomingSection();
  assert.match(s, /FROM lead_outcomes o/);
  assert.match(s, /o\.org_id = \? AND o\.outcome_type = \?/);
  assert.match(s, /UPCOMING_APPOINTMENT_TYPE/, "the type comes from the shared constant");
  // The CLR and the LO are LEFT JOINs: an appointment with no LO yet is still
  // a meeting, and dropping it would be a hole in the schedule.
  assert.match(s, /LEFT JOIN users u ON u\.id = o\.assistant_id/);
  assert.match(s, /LEFT JOIN loan_officers lo ON lo\.id = o\.lo_id/);
});

test("the SQL bounds only prune; the shared rule decides", () => {
  const s = upcomingSection();
  // NOT a COALESCE any more, on purpose. A COALESCE carries a preference, and
  // the two columns disagree on rows already in the table — pruning on the
  // abandoned one drops a rescheduled meeting before appointmentStamp ever
  // sees it. The scan asks EITHER column and lets the shared rule choose.
  assert.doesNotMatch(s, /COALESCE\(/, "no preference is baked into the scan");
  assert.match(s, /NULLIF\(o\.follow_up_date, ''\)\s+>= \? AND NULLIF\(o\.follow_up_date, ''\)\s+< \?/);
  assert.match(s, /NULLIF\(o\.appointment_datetime, ''\)\s+>= \? AND NULLIF\(o\.appointment_datetime, ''\)\s+< \?/);
  assert.match(s, /const scanTo = addIsoDays\(from, UPCOMING_DAYS\);/);
  assert.match(s, /\.all\(orgId, UPCOMING_APPOINTMENT_TYPE, from, scanTo, from, scanTo\)/);
  assert.match(s, /selectUpcomingAppointments\(rows, \{ nowMs, today: from, days: UPCOMING_DAYS, tz \}\)/);
  // No second copy of the window arithmetic in the route.
  assert.ok(!/\.sort\(/.test(s), "the ordering lives in one tested place");
});

test("the SQL bound cannot prune a drifted row before the rule runs", () => {
  // The route's own statement, lifted out of routes.ts and run against a
  // throwaway database. Reading the text proves the shape; running it proves
  // the row survives, which is the thing that actually went wrong.
  const sql = /sqlite\.prepare\(\s*`([\s\S]*?)`/.exec(upcomingSection())?.[1];
  assert.ok(sql && /FROM lead_outcomes/.test(sql), "the upcoming statement was found");

  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE lead_outcomes (
      id INTEGER PRIMARY KEY, org_id INTEGER, outcome_type TEXT, borrower_name TEXT,
      appointment_datetime TEXT, follow_up_date TEXT, assistant_id INTEGER, lo_id INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE loan_officers (id INTEGER PRIMARY KEY, full_name TEXT);
    INSERT INTO users VALUES (1, 'Marco Diaz');
    INSERT INTO loan_officers VALUES (1, 'Derek Bullen');
  `);
  const insert = db.prepare(
    "INSERT INTO lead_outcomes (id, org_id, outcome_type, borrower_name, appointment_datetime, follow_up_date, assistant_id, lo_id)"
    + " VALUES (?, 1, 'appointment', ?, ?, ?, 1, 1)",
  );
  // 1: drifted — the abandoned original is a week in the past, the live slot is
  //    inside the window. The COALESCE bound pruned exactly this row.
  insert.run(1, "Rosa Iglesias", "2026-09-01T14:30", "2026-09-08T14:30");
  // 2: drifted the other way — the abandoned original is inside the window and
  //    the live slot is beyond it. Kept by the scan, dropped by the rule.
  insert.run(2, "Late Mover", "2026-09-04T09:00", "2026-09-30T09:00");
  // 3: CallSync's shape — appointment_datetime only, no follow-up at all.
  insert.run(3, "Call Sync", "2026-09-05T11:00", null);
  // 4: mirrored, the shape every edit dialog writes now.
  insert.run(4, "Mirrored", "2026-09-06T12:00", "2026-09-06T12:00");
  // 5: blank strings in both columns — NULLIF territory, and nothing to show.
  insert.run(5, "Unfinished", "", "");
  // 6: nowhere near the window on either column.
  insert.run(6, "Next Month", "2026-10-14T09:00", "2026-10-14T09:00");

  const from = THU, scanTo = "2026-09-10";
  const rows = db.prepare(sql!).all(1, UPCOMING_APPOINTMENT_TYPE, from, scanTo, from, scanTo) as any[];
  const scanned = rows.map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(scanned, [1, 2, 3, 4], "the drifted row reaches the rule; the far-off ones do not");

  // And through the rule, the drifted row lands on its real day.
  const out = selectUpcomingAppointments(rows as UpcomingApptRow[], { nowMs: at("2026-09-03T10:00"), today: THU, tz: TZ });
  assert.deepEqual(out.map((r) => r.id), [3, 4, 1]);
  assert.equal(out.find((r) => r.id === 1)!.day, "2026-09-08");
  assert.ok(!out.some((r) => r.id === 2), "a live slot past the horizon is still dropped");
  // The columns come back under the names the shared rule expects — an alias
  // typo here would silently blank every time on the wall.
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ["appointmentDatetime", "borrower", "clr", "followUpDate", "id", "lo", "outcomeType"],
  );
  db.close();
});

test("the upcoming page is anchored on the calendar day, not the business day", () => {
  const s = upcomingSection();
  // checkinToday is the plain local calendar date. w.today is the 7pm business
  // day, which at 7:15pm is already tomorrow — it would hide an 8pm meeting
  // tonight and label tomorrow's "Today".
  assert.match(s, /const from = checkinToday\(tz\);/);
  assert.ok(!/w\.today/.test(s), "the business-day anchor must not leak in here");
});

// ── most to least, everywhere it means something ────────────────────────────
//
// Ethan: "all the tv stats should be organized from most to least." These are
// the pages that were not, plus the two that are exceptions on purpose.

/** One section of the /pages handler, cut at `endMarker` (or at the end). */
function pageSection(name: string, endMarker: string): string {
  const body = pagesRoute();
  const start = body.indexOf(`section("${name}"`);
  assert.ok(start > 0, `the ${name} section is built through the wrapper`);
  if (!endMarker) return body.slice(start);
  const end = body.indexOf(endMarker, start);
  assert.ok(end > start, `${name} is bounded by ${endMarker}`);
  return body.slice(start, end);
}

// ── assignments: the longest list first ─────────────────────────────────────

test("the people with the most loan officers come first", () => {
  const people = orderAssignmentPeople([
    { name: "Ada", los: ["a", "b"] },
    { name: "Bo", los: ["a", "b", "c", "d"] },
    { name: "Cy", los: [] },
    { name: "Di", los: ["a", "b", "c"] },
  ]);
  assert.deepEqual(people.map((p) => p.name), ["Bo", "Di", "Ada", "Cy"]);
  assert.deepEqual(people.map((p) => p.los.length), [4, 3, 2, 0]);
});

test("an equal load breaks by name, so the wall never reshuffles between polls", () => {
  const people = orderAssignmentPeople([
    { name: "Zoe", los: ["a", "b"] },
    { name: "Ada", los: ["a", "b"] },
    { name: "Mia", los: ["a", "b"] },
  ]);
  assert.deepEqual(people.map((p) => p.name), ["Ada", "Mia", "Zoe"]);
});

test("ordering the people never reorders anybody's own list", () => {
  // assistant_rank is a PRIORITY — who to call first — not a quantity. Sorting
  // it by anything at all would throw away the only thing it says.
  const ada = { name: "Ada", los: [{ rank: 1, loName: "Zeb" }, { rank: 2, loName: "Abe" }] };
  const bo = { name: "Bo", los: [{ rank: 1, loName: "Moe" }, { rank: 2, loName: "Ann" }, { rank: 3, loName: "Cal" }] };
  const out = orderAssignmentPeople([ada, bo]);
  assert.deepEqual(out.map((p) => p.name), ["Bo", "Ada"]);
  assert.deepEqual(out[0].los.map((l) => l.loName), ["Moe", "Ann", "Cal"], "still rank order, not alphabetical");
  assert.deepEqual(out[1].los.map((l) => l.loName), ["Zeb", "Abe"]);
});

test("ordering the assignment people leaves the caller's array alone", () => {
  const rows = [{ name: "Ada", los: [] as string[] }, { name: "Bo", los: ["a"] }];
  const out = orderAssignmentPeople(rows);
  assert.deepEqual(rows.map((r) => r.name), ["Ada", "Bo"]);
  assert.deepEqual(out.map((r) => r.name), ["Bo", "Ada"]);
  assert.notEqual(out, rows);
});

test("junk instead of a list is an empty one, not a crash on the wall", () => {
  const out = orderAssignmentPeople([
    { name: "Ada", los: undefined as any },
    { name: "Bo", los: ["a"] },
  ]);
  assert.deepEqual(out.map((r) => r.name), ["Bo", "Ada"]);
});

test("the assignments section orders its people and not their lists", () => {
  const s = pageSection("assignments", 'section("eod"');
  assert.match(s, /orderAssignmentPeople\(Array\.from\(byPerson\.values\(\)\)\)/);
  // The rank still fills each person's list, in the query.
  assert.match(s, /ORDER BY u\.name COLLATE NOCASE ASC, a\.assistant_rank ASC/);
  // And no second sort could quietly re-rank somebody's LOs behind that back.
  assert.ok(!/\.sort\(/.test(s), "the ordering lives in one tested place");
});

// ── on the phone now: most recently active first ────────────────────────────

test("the most recently active person is first, and seconds-ago sorts ascending", () => {
  // activeAgo counts the wrong way round for "most first": it is seconds AGO,
  // so the smallest number is the person who did something last.
  const people = orderByRecentlyActive([
    { name: "Ada", activeAgo: 600 },
    { name: "Bo", activeAgo: 12 },
    { name: "Cy", activeAgo: 240 },
  ]);
  assert.deepEqual(people.map((p) => p.name), ["Bo", "Cy", "Ada"]);
  assert.deepEqual(people.map((p) => p.activeAgo), [12, 240, 600]);
});

test("nobody inactive drifts into the middle of a list titled 'right now'", () => {
  // A null is "no signal in the last fifteen minutes", not a big number. Left
  // to arithmetic, null - null is 0 and 5 - null is 5, so somebody who has not
  // touched the phone all day floats up among the people who just did.
  const people = orderByRecentlyActive([
    { name: "Ada", activeAgo: null },
    { name: "Bo", activeAgo: 300 },
    { name: "Cy", activeAgo: null },
    { name: "Di", activeAgo: 5 },
  ]);
  assert.deepEqual(people.map((p) => p.name), ["Di", "Bo", "Ada", "Cy"]);
  // The count is unchanged by the ordering — it was never counting positions.
  assert.equal(activeCount(people), 2);
});

test("a tie in recency breaks by name, and junk sorts as no signal", () => {
  assert.deepEqual(
    orderByRecentlyActive([
      { name: "Zoe", activeAgo: 60 }, { name: "Ada", activeAgo: 60 },
    ]).map((p) => p.name),
    ["Ada", "Zoe"],
  );
  assert.deepEqual(
    orderByRecentlyActive([
      { name: "Ada", activeAgo: Number.NaN },
      { name: "Bo", activeAgo: undefined as any },
      { name: "Cy", activeAgo: 30 },
    ]).map((p) => p.name),
    ["Cy", "Ada", "Bo"],
  );
});

test("ordering the active list leaves the caller's array alone", () => {
  const rows = [{ name: "Ada", activeAgo: 900 }, { name: "Bo", activeAgo: 1 }];
  const out = orderByRecentlyActive(rows);
  assert.deepEqual(rows.map((r) => r.name), ["Ada", "Bo"]);
  assert.deepEqual(out.map((r) => r.name), ["Bo", "Ada"]);
  assert.notEqual(out, rows);
});

test("the onPhoneNow section orders through the shared rule, not an inline sort", () => {
  const s = pageSection("onPhoneNow", 'section("checkins"');
  assert.match(s, /orderByRecentlyActive\(roster\.map/);
  assert.ok(!/\.sort\(/.test(s), "no second copy of the null-handling to get wrong");
});

// ── check-ins: a lookup, so there is no order to impose ─────────────────────

test("the check-ins section is a lookup, and is deliberately left in roster order", () => {
  // Its one consumer turns it straight into a name-keyed object to decide who
  // is on the floor, and an object cannot read an order. There is no check-ins
  // page on the deck either — tests/tv-board.test.ts pins the consumer itself.
  // Sorting this would be motion without meaning, so it is not sorted, and the
  // reason is written down where somebody would go looking to "fix" it.
  const s = pageSection("checkins", 'section("upcoming"');
  assert.ok(!/\.sort\(/.test(s), "nothing to sort by that any consumer could read");
  assert.match(s, /const people = roster\.map/);
  assert.match(s, /lookup/i, "and the reason is stated at the code");
  assert.match(s, /Scorecard/, "naming the one consumer that made it moot");
});

// ── the two deliberate exceptions ───────────────────────────────────────────

test("starved leads with the most STARVED, which is the fewest received", () => {
  // It already is most-first; the quantity is NEED. Sorting it by transfers
  // received would put Christopher Redoble — 282 in the same fortnight the
  // bottom of the list took six — at the head of a starvation list.
  const rows = [
    { name: "Redoble", transfers: 282 },
    { name: "Derek", transfers: 6 },
    { name: "Nathan", transfers: 46 },
  ];
  assert.deepEqual(orderStarved(rows).map((r) => r.name), ["Derek", "Nathan", "Redoble"]);
  // And the exception is written down, so nobody "organises" it later.
  const s = starvedSection();
  assert.match(s, /DELIBERATE EXCEPTION/);
  assert.match(s, /Do not/);
  assert.match(s, /"fix" it/);
});

test("upcoming stays chronological, and says why", () => {
  // A diary sorted by size is not a diary: the next meeting is the one somebody
  // has to be ready for.
  //
  // Bounded at the upcoming section, not at the end of the handler. Read to the
  // end it also swallowed the payload assembly and everything else after it, so
  // an unrelated `.sort(` added down there would have failed a test whose name
  // points at appointments and whose message blames selectUpcomingAppointments.
  const s = upcomingSection();
  assert.match(s, /DELIBERATELY not most-to-least/);
  assert.match(s, /compareUpcoming owns that/);
  assert.match(s, /Do not "fix" it either/);
  assert.ok(!/\.sort\(/.test(s), "the order is selectUpcomingAppointments', not the route's");
});
