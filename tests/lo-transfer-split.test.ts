import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  LO_SPLIT_WINDOWS, foldLoSplitRows, helperNoticeFor, resolveHelperUserId, totalsFor,
} from "../server/lo-transfer-split";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const routes = read("server/routes.ts");
const page = read("client/src/pages/manager-dashboard.tsx");

// ── who the helper is ──────────────────────────────────────────────────────

test("the helper is resolved from the org setting, not a hard-coded id", () => {
  // The person in that seat can change; a hard-coded 15 would keep pointing
  // at her after she moved.
  const fn = routes.slice(routes.indexOf('app.get("/api/lo-transfer-split"'), routes.indexOf('app.get("/api/meta-conversion"'));
  assert.match(fn, /helper_name \|\| "Elleine"/);
  assert.match(fn, /resolveHelperUserId\(storage\.getUsers\(\) as any\[\], helperName\)/);
  assert.ok(!/=== 15|assistant_id = 15/.test(fn), "no hard-coded user id");
});

test("a first name resolves, a full name resolves, and neither guesses", () => {
  const users = [
    { id: 15, name: "Elleine Asuncion", isActive: 1 },
    { id: 20, name: "Matt Lane", isActive: 1 },
  ];
  assert.equal(resolveHelperUserId(users, "Elleine"), 15);
  assert.equal(resolveHelperUserId(users, "elleine asuncion"), 15);
  assert.equal(resolveHelperUserId(users, "  ELLEINE  "), 15);
  // A prefix is not a match: "Elle" must not claim "Elleine".
  assert.equal(resolveHelperUserId(users, "Elle"), null);
  assert.equal(resolveHelperUserId(users, "Nobody"), null);
  assert.equal(resolveHelperUserId(users, ""), null);
  assert.equal(resolveHelperUserId(users, null), null);
});

test("two people with the name is nobody, not a coin toss", () => {
  // Attributing half the floor's work to the wrong person is worse than
  // saying the split is unavailable.
  const users = [
    { id: 15, name: "Elleine Asuncion", isActive: 1 },
    { id: 44, name: "Elleine Barros", isActive: 1 },
  ];
  assert.equal(resolveHelperUserId(users, "Elleine"), null);
  assert.match(helperNoticeFor("Elleine", null) ?? "", /cannot be split/);
  assert.equal(helperNoticeFor("Elleine", 15), null);
});

test("an inactive namesake does not shadow the active one", () => {
  const users = [
    { id: 9, name: "Elleine Asuncion", isActive: 0 },
    { id: 15, name: "Elleine Asuncion", isActive: 1 },
  ];
  assert.equal(resolveHelperUserId(users, "Elleine"), 15);
});

// ── the fold ───────────────────────────────────────────────────────────────

const raw = (lo: number, name: string, window: string, assistant: number) =>
  ({ lo_id: lo, name, window, assistant_id: assistant });

test("each window is counted separately and split by who logged it", () => {
  const windows = foldLoSplitRows([
    raw(1, "Nick Barq", "today", 15), raw(1, "Nick Barq", "week", 15),
    raw(1, "Nick Barq", "month", 15), raw(1, "Nick Barq", "all", 15),
    raw(1, "Nick Barq", "week", 20), raw(1, "Nick Barq", "month", 20), raw(1, "Nick Barq", "all", 20),
    raw(2, "Ian Militello", "all", 20), raw(2, "Ian Militello", "month", 20),
  ], 15);

  assert.deepEqual(windows.today, [{ loId: 1, name: "Nick Barq", helper: 1, others: 0, total: 1 }]);
  assert.deepEqual(windows.week, [{ loId: 1, name: "Nick Barq", helper: 1, others: 1, total: 2 }]);
  assert.equal(windows.month.length, 2);
  assert.deepEqual(windows.all.map((r) => r.total), [2, 1], "busiest first");
});

test("with no helper resolved, everything is 'everyone else' rather than hers", () => {
  // The alternative — defaulting the split to the first column — would invent
  // an attribution out of a failed lookup.
  const windows = foldLoSplitRows([raw(1, "A", "all", 15), raw(1, "A", "all", 20)], null);
  assert.deepEqual(windows.all, [{ loId: 1, name: "A", helper: 0, others: 2, total: 2 }]);
});

test("equal totals keep a stable order", () => {
  // A table that reorders itself under the cursor between two refreshes is
  // unusable, and refresh order out of SQLite is not guaranteed.
  const rows = [raw(2, "Zoe", "all", 1), raw(1, "Adam", "all", 1)];
  assert.deepEqual(foldLoSplitRows(rows, null).all.map((r) => r.name), ["Adam", "Zoe"]);
  assert.deepEqual(foldLoSplitRows([...rows].reverse(), null).all.map((r) => r.name), ["Adam", "Zoe"]);
});

test("junk rows are dropped rather than counted as an LO", () => {
  const windows = foldLoSplitRows([
    raw(0, "", "all", 1), raw(-1, "", "all", 1),
    { lo_id: null, name: null, window: "all", assistant_id: 1 },
    { lo_id: 3, name: "Real", window: "nonsense", assistant_id: 1 },
    raw(3, "Real", "all", 1),
  ], null);
  assert.deepEqual(windows.all, [{ loId: 3, name: "Real", helper: 0, others: 1, total: 1 }]);
});

test("the footer adds up the column it is under", () => {
  assert.deepEqual(
    totalsFor([
      { loId: 1, name: "A", helper: 3, others: 1, total: 4 },
      { loId: 2, name: "B", helper: 0, others: 5, total: 5 },
    ]),
    { helper: 3, others: 6, total: 9 },
  );
  assert.deepEqual(totalsFor([]), { helper: 0, others: 0, total: 0 });
});

// ── the query ──────────────────────────────────────────────────────────────

test("one statement covers all four windows", () => {
  const fn = routes.slice(routes.indexOf('app.get("/api/lo-transfer-split"'), routes.indexOf('app.get("/api/meta-conversion"'));
  // Two now: one keyed on the loan officer, one on the assistant. Still one
  // statement each for all four windows, which is the property that matters —
  // eight would read the transfer table eight times for the same answers.
  assert.equal((fn.match(/FROM lead_outcomes/g) ?? []).length, 2);
  for (const w of LO_SPLIT_WINDOWS) assert.ok(fn.includes(`'${w}'`), `${w} must be in the window list`);
  assert.match(fn, /o\.outcome_type = 'transfer'/);
  assert.match(fn, /o\.org_id = @orgId/);
  // NO exclude_from_stats filter, and this is load-bearing: Elleine carries
  // that flag, and 1,336 of production's 3,296 transfers to an LO are hers.
  // The exclusion the rest of the dashboard applies would zero the one column
  // this card exists to show.
  assert.ok(!/assistant_id NOT IN/.test(fn),
    "excluding stats-excluded CLRs would delete Elleine's entire column");
});

test("the SQL runs and buckets a transfer into every window it belongs to", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE lead_outcomes (id INTEGER PRIMARY KEY, date TEXT, assistant_id INTEGER,
      lo_id INTEGER, outcome_type TEXT, org_id INTEGER);
    CREATE TABLE loan_officers (id INTEGER PRIMARY KEY, full_name TEXT);
    INSERT INTO loan_officers (id, full_name) VALUES (7, 'Nick Barq'), (8, 'Ian Militello');
    INSERT INTO lead_outcomes (date, assistant_id, lo_id, outcome_type, org_id) VALUES
      ('2026-09-10', 15, 7, 'transfer', 1),   -- today, week, month, all
      ('2026-09-08', 20, 7, 'transfer', 1),   -- week, month, all
      ('2026-08-02', 20, 8, 'transfer', 1),   -- all only
      ('2026-09-10', 15, 7, 'appointment', 1) -- never: not a transfer
    ;`);
  const rows = db.prepare(`
      SELECT o.lo_id, lo.full_name AS name, o.assistant_id, w.window
      FROM lead_outcomes o
      JOIN loan_officers lo ON lo.id = o.lo_id
      JOIN (SELECT 'today' AS window UNION ALL SELECT 'week' UNION ALL SELECT 'month' UNION ALL SELECT 'all') w
      WHERE o.outcome_type = 'transfer'
        AND o.org_id = @orgId
        AND o.lo_id IS NOT NULL
        AND (
          (w.window = 'all')
          OR (w.window = 'today' AND o.date = @today)
          OR (w.window = 'week'  AND o.date >= @weekStart  AND o.date <= @weekEnd)
          OR (w.window = 'month' AND o.date >= @monthStart AND o.date <= @monthEnd)
        )
    `).all({
      orgId: 1, today: "2026-09-10",
      weekStart: "2026-09-06", weekEnd: "2026-09-12",
      monthStart: "2026-09-01", monthEnd: "2026-09-30",
    }) as any[];

  const windows = foldLoSplitRows(rows, 15);
  assert.deepEqual(windows.today, [{ loId: 7, name: "Nick Barq", helper: 1, others: 0, total: 1 }]);
  assert.deepEqual(windows.week, [{ loId: 7, name: "Nick Barq", helper: 1, others: 1, total: 2 }]);
  assert.deepEqual(windows.month, [{ loId: 7, name: "Nick Barq", helper: 1, others: 1, total: 2 }]);
  assert.equal(windows.all.length, 2);
  assert.equal(totalsFor(windows.all).total, 3, "the appointment must never be counted");
  db.close();
});

// ── the table ──────────────────────────────────────────────────────────────

test("the card shows both halves, a total, and says what it counted", () => {
  assert.match(page, /testId="lo-split-table"/);
  assert.match(page, /data-testid=\{`\$\{testId\}-totals`\}/);
  assert.match(page, /\{helperName\}<\/th>/, "the helper column is named after the setting");
  assert.match(page, /Everyone else/);
  // "No helper resolved" must not look like "the helper sent none".
  assert.match(page, /data-testid="lo-split-helper-notice"/);
  // The caveat that stops somebody adding these to a CLR scorecard.
  assert.match(page, /still one borrower/);
});

test("assistants are counted separately, in their own table", () => {
  // Owner, 10 Sep 2026. A subtotal inside the LO table would be wrong twice
  // over: a transfer to an LOA is ALSO a transfer to their loan officer, so
  // adding them double-counts, and nesting it would stop the LO rows matching
  // the headline. Two populations, two tables.
  const fn = routes.slice(routes.indexOf('app.get("/api/lo-transfer-split"'), routes.indexOf('app.get("/api/meta-conversion"'));
  assert.match(fn, /JOIN loan_officer_assistants a ON a\.id = o\.loa_id/);
  assert.match(fn, /o\.loa_id IS NOT NULL/);
  // The assistant table has no org column of its own; the parent LO is the scope.
  assert.match(fn, /JOIN loan_officers parent ON parent\.id = a\.lo_id/);
  assert.match(fn, /parent\.org_id = @orgId/);
  // Same fold, so the two tables cannot disagree about what a split is.
  assert.match(fn, /loaWindows: foldLoSplitRows\(loaRows, helperUserId\)/);
  assert.match(page, /testId="loa-split-table"/);
  // And the page says not to add them together.
  assert.match(page, /do\s*\n?\s*not add them together/);
});

// ── the wall ───────────────────────────────────────────────────────────────

test("the TV builds the same split from the same fold", () => {
  // Two implementations of "who fed this LO" would drift, and the wall
  // disagreeing with the dashboard in front of the whole floor is the worst
  // place for that to happen.
  const sec = routes.slice(routes.indexOf('section("loSplit"'), routes.indexOf('section("writeUps"'));
  assert.match(sec, /foldLoSplitRows\(rows, helperUserId\)/);
  assert.match(sec, /resolveHelperUserId\(/);
  assert.match(sec, /helper_name \|\| "Elleine"/);
  // Same exclusion decision, for the same reason.
  assert.ok(!/assistant_id NOT IN/.test(sec),
    "the wall must not filter out the person it is pointing at");
  // All four windows reach the wall, even though the rows show the month.
  assert.match(sec, /totals: \{/);
  for (const w of LO_SPLIT_WINDOWS) assert.ok(sec.includes(`${w}: totalsFor(windows.${w})`), w);
});

test("the wall page is in the deck, right after the one it answers", () => {
  const tv = read("client/src/pages/tv.tsx");
  const pages = read("client/src/components/tv/pages.tsx");
  assert.match(pages, /export function LoSplitPage/);
  assert.match(pages, /data-testid="tv-page-lo-split"/);
  // "Who needs transfers" says who is short; this says who is doing the
  // feeding. They belong next to each other.
  const deck = tv.slice(tv.indexOf("const DECK: Slot[]"), tv.indexOf("// ── sound"));
  assert.ok(deck.indexOf('id: "loSplit"') > deck.indexOf('id: "starved"'), "loSplit follows starved");
  // Every page's dwell has a twin in PAN_SECONDS, or the pan outruns the page.
  assert.match(deck, /id: "loSplit",\s+dwellMs: 13_000/);
  assert.match(pages, /loSplit: 13,/);
  // A page with no data must not take a slot on the wall.
  assert.match(tv, /case "loSplit":\s+return !!board\?\.loSplit;/);
});

test("the wall says which colour is whose, and copes with no helper", () => {
  const pages = read("client/src/components/tv/pages.tsx");
  const fn = pages.slice(pages.indexOf("export function LoSplitPage"));
  assert.match(fn, /Gold is \$\{helperName\}/);
  // With nobody resolved the page must not silently paint everything as
  // "everyone else" and leave the room to guess why the gold vanished.
  assert.match(fn, /Nobody is set as the helper/);
  // Divided bar, not two bars: the share is the thing being said.
  assert.match(fn, /GOLD_BAR/);
  assert.match(fn, /COOL_BAR/);
});

test("the wall reads its own org's people, not the viewer's", () => {
  // storage.getUsers() scopes itself to the CALLER's session. A TV route has
  // no session, so it returned every org's people to a kiosk and the signed-in
  // org's people to a browser that happened to be logged in — and the split
  // silently switched off whenever those differed. Caught in the preview: curl
  // said the helper was known, the browser on the same server said nobody was.
  const sec = routes.slice(routes.indexOf('section("loSplit"'), routes.indexOf('section("writeUps"'));
  assert.match(sec, /SELECT id, name, is_active FROM users WHERE org_id = \?/);
  // Comments stripped: the one above names the call it replaced, and that
  // explanation must not trip its own guard.
  const code = sec.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.ok(!/storage\.getUsers\(\)/.test(code),
    "a display-token route must not resolve people through the caller's session");
  assert.match(sec, /resolveHelperUserId\(orgUsers, helperName\)/);
});
