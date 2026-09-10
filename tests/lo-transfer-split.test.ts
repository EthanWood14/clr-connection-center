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
  // Four queries would read the transfer table four times for three answers
  // that are subsets of the fourth.
  assert.equal((fn.match(/FROM lead_outcomes/g) ?? []).length, 1);
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
  assert.match(page, /data-testid="lo-split-table"/);
  assert.match(page, /data-testid="lo-split-totals"/);
  assert.match(page, /\{helperName\}<\/th>/, "the helper column is named after the setting");
  assert.match(page, /Everyone else/);
  // "No helper resolved" must not look like "the helper sent none".
  assert.match(page, /data-testid="lo-split-helper-notice"/);
  // The caveat that stops somebody adding these to a CLR scorecard.
  assert.match(page, /still one\s*\n?\s*borrower who reached this LO/);
});
