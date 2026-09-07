// The shotgun split, and every surface that has to agree with it.
//
// Ethan's rule: "if someone transfers off the shotgun, it counts as half a
// transfer for the person who sent it and half a transfer for those who
// received it" — half credit for EVERYTHING including pay, and the receiver is
// the single CLR who claimed the lead.
//
// The whole point of a split is that it shares one transfer rather than
// inventing a second one, so the tests below come in pairs: what one PERSON
// earns, and what the COMPANY counts. If a change ever makes a company total
// move, one of these fails and says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  FULL_TRANSFER_CREDIT,
  SHOTGUN_SENDER_CREDIT,
  SHOTGUN_CLAIMER_CREDIT,
  SHOTGUN_SENDER_COLUMN,
  TRANSFER_CREDIT_SQL,
  transferCreditFor,
  transferCreditIn,
  transferCreditByUser,
  formatTransferCount,
  shotgunSenderToStamp,
} from "../shared/transfer-credit";
import { tieredTransferCompRateCents } from "../server/comp-rate";
import { BUMP_MIN_TRANSFERS, AUTO_FILE_MIN_TRANSFERS, bumpPool } from "../server/comp-auto-file";
import { FULL_MONTH_TRANSFER_FLOOR, compFloorForClr, monthWeekdays } from "../server/comp-floor";
import { transfersPerWorkingDay } from "../server/clr-workday-rate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");
const askC3 = read("server/ask-c3.ts");

// ── the rule itself ─────────────────────────────────────────────────────────

const PUBLISHER = 11;
const CLAIMER = 22;
const BYSTANDER = 33;

/** An ordinary transfer, made by one CLR. */
const plain = (assistantId: number, over: Record<string, unknown> = {}) => ({
  outcome_type: "transfer", assistant_id: assistantId, shotgun_sender_id: null, date: "2026-09-01", ...over,
});

/** A transfer taken off a shotgun lead somebody else published. */
const shotgun = (claimerId: number, senderId: number, over: Record<string, unknown> = {}) => ({
  outcome_type: "transfer", assistant_id: claimerId, shotgun_sender_id: senderId, date: "2026-09-01", ...over,
});

test("an ordinary transfer is one whole transfer for its maker, and nothing for anybody else", () => {
  const row = plain(CLAIMER);
  assert.equal(transferCreditFor(row, CLAIMER), 1);
  assert.equal(FULL_TRANSFER_CREDIT, 1);
  assert.equal(transferCreditFor(row, PUBLISHER), 0);
  assert.equal(transferCreditFor(row, BYSTANDER), 0);
});

test("a shotgun transfer is half each for the publisher and the claimer, and one in total", () => {
  const row = shotgun(CLAIMER, PUBLISHER);
  assert.equal(transferCreditFor(row, CLAIMER), 0.5);
  assert.equal(transferCreditFor(row, PUBLISHER), 0.5);
  assert.equal(transferCreditFor(row, BYSTANDER), 0);
  assert.equal(
    transferCreditFor(row, CLAIMER) + transferCreditFor(row, PUBLISHER),
    FULL_TRANSFER_CREDIT,
    "the two halves must add back to exactly one transfer",
  );
  assert.equal(SHOTGUN_SENDER_CREDIT + SHOTGUN_CLAIMER_CREDIT, FULL_TRANSFER_CREDIT);
});

test("a publisher who claims their own lead keeps a whole transfer", () => {
  // The route never stamps a sender in that case, so the row is an ordinary one.
  assert.equal(shotgunSenderToStamp(PUBLISHER, PUBLISHER, true), null);
  assert.equal(transferCreditFor(plain(PUBLISHER), PUBLISHER), 1);
  // And an older row that carries the stamp anyway still totals one, never two:
  // both halves land on the same person rather than paying them twice.
  assert.equal(transferCreditFor(shotgun(PUBLISHER, PUBLISHER), PUBLISHER), 1);
});

test("a sender is stamped only when two different people are involved", () => {
  assert.equal(shotgunSenderToStamp(PUBLISHER, CLAIMER, true), PUBLISHER);
  assert.equal(shotgunSenderToStamp(PUBLISHER, PUBLISHER, true), null);
  assert.equal(shotgunSenderToStamp(null, CLAIMER, true), null);
  assert.equal(shotgunSenderToStamp(PUBLISHER, 0, true), null);
});

test("a lead published by somebody outside the CLR roster stays a whole transfer", () => {
  // Managers and admins can always publish to the Shotgun board — it is what
  // the board is for — and they are not on transfer comp. Handing them half
  // would take $5 off the CLR who made the call and pay it to a line item
  // nobody settles, so the CLR keeps the whole one.
  assert.equal(shotgunSenderToStamp(PUBLISHER, CLAIMER, false), null);
  assert.equal(shotgunSenderToStamp(PUBLISHER, CLAIMER, 0), null);
  assert.equal(shotgunSenderToStamp(PUBLISHER, CLAIMER, undefined), null);
  assert.equal(shotgunSenderToStamp(PUBLISHER, CLAIMER, null), null);
  // Unstamped, the claimer earns the full transfer.
  assert.equal(transferCreditFor(plain(CLAIMER), CLAIMER), 1);
});

test("the route decides that from the CLR roster, not from a role name", () => {
  // An admin flagged as also doing CLR work IS on the roster and does get the
  // half; a plain admin does not. Same predicate the CLR reports use.
  assert.match(routes, /function publisherIsOnClrRoster/);
  assert.match(routes, /u\.role === "assistant"/);
  assert.match(routes, /u\.role === "admin" && !!\(u\.isClr \?\? u\.is_clr\)/);
  assert.match(routes, /publisherIsOnClrRoster\(current\.created_by_user_id\)/);
});

test("a person's total is summed over EVERY outcome, not the ones bearing their name", () => {
  const day = [
    plain(CLAIMER),
    shotgun(CLAIMER, PUBLISHER),
    { outcome_type: "appointment", assistant_id: PUBLISHER, shotgun_sender_id: null },
    { outcome_type: "fell_through", assistant_id: CLAIMER, shotgun_sender_id: null },
  ];
  assert.equal(transferCreditIn(day, CLAIMER), 1.5);
  // The publisher's half sits on a row whose assistant_id is the claimer, which
  // is exactly why a list pre-filtered by assistant_id cannot be used here.
  assert.equal(transferCreditIn(day, PUBLISHER), 0.5);
  assert.equal(transferCreditIn(day.filter((o) => o.assistant_id === PUBLISHER), PUBLISHER), 0);
  assert.equal(transferCreditIn(day, BYSTANDER), 0);
});

test("non-transfer rows never earn credit, so an unfiltered day is safe to pass", () => {
  const rows = [
    { outcome_type: "appointment", assistant_id: CLAIMER },
    { outcome_type: "fell_through", assistant_id: CLAIMER },
    { outcome_type: "no_answer", assistant_id: CLAIMER },
  ];
  assert.equal(transferCreditIn(rows, CLAIMER), 0);
  assert.equal(transferCreditByUser(rows).size, 0);
});

test("the company-wide total is unchanged by any split", () => {
  const rows = [
    plain(CLAIMER),
    plain(PUBLISHER),
    shotgun(CLAIMER, PUBLISHER),
    shotgun(BYSTANDER, CLAIMER),
    plain(BYSTANDER),
  ];
  const transferRows = rows.filter((r) => r.outcome_type === "transfer").length;
  const byUser = transferCreditByUser(rows);
  const summed = Array.from(byUser.values()).reduce((n, c) => n + c, 0);
  assert.equal(transferRows, 5);
  assert.equal(summed, 5, "sharing a transfer must never create a second one");
  // And nobody's own figure is a whole number just because the total is.
  assert.equal(byUser.get(CLAIMER), 1 + 0.5 + 0.5);
  assert.equal(byUser.get(PUBLISHER), 1 + 0.5);
  assert.equal(byUser.get(BYSTANDER), 0.5 + 1);
});

test("a transfer nobody is named on credits nobody, and is still one transfer", () => {
  const rows = [{ outcome_type: "transfer", assistant_id: null, shotgun_sender_id: null }];
  assert.equal(transferCreditByUser(rows).size, 0);
  assert.equal(transferCreditFor(rows[0], CLAIMER), 0);
});

// ── the SQL expansion, against the same rows ────────────────────────────────

test("the SQL expansion and transferCreditFor agree, row for row", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE lead_outcomes (
    id INTEGER PRIMARY KEY, org_id INTEGER, date TEXT, outcome_type TEXT,
    assistant_id INTEGER, lo_id INTEGER, loa_id INTEGER, shotgun_sender_id INTEGER
  )`);
  const rows = [
    { id: 1, ...plain(CLAIMER) },
    { id: 2, ...plain(PUBLISHER) },
    { id: 3, ...shotgun(CLAIMER, PUBLISHER) },
    { id: 4, ...shotgun(BYSTANDER, CLAIMER) },
    { id: 5, outcome_type: "appointment", assistant_id: CLAIMER, shotgun_sender_id: null, date: "2026-09-01" },
    { id: 6, outcome_type: "transfer", assistant_id: null, shotgun_sender_id: null, date: "2026-09-01" },
  ];
  const insert = db.prepare(
    `INSERT INTO lead_outcomes (id, org_id, date, outcome_type, assistant_id, lo_id, loa_id, shotgun_sender_id)
     VALUES (?, 1, ?, ?, ?, NULL, NULL, ?)`,
  );
  for (const r of rows) insert.run(r.id, r.date, r.outcome_type, r.assistant_id, r.shotgun_sender_id);

  const expanded = db.prepare(
    `SELECT user_id AS uid, SUM(credit) AS credit
       FROM (${TRANSFER_CREDIT_SQL}) tc WHERE user_id IS NOT NULL GROUP BY user_id`,
  ).all() as Array<{ uid: number; credit: number }>;

  const fromSql = new Map(expanded.map((r) => [Number(r.uid), Number(r.credit)]));
  const fromJs = transferCreditByUser(rows);
  assert.deepEqual(
    Array.from(fromSql.entries()).sort((a, b) => a[0] - b[0]),
    Array.from(fromJs.entries()).sort((a, b) => a[0] - b[0]),
    "SQL and JavaScript must never drift: they are one rule in two languages",
  );

  // One ordinary transfer yields one row worth 1; one shotgun transfer yields
  // TWO rows worth 0.5.
  const all = db.prepare(`SELECT * FROM (${TRANSFER_CREDIT_SQL}) tc ORDER BY outcome_id, is_shotgun_sender`)
    .all() as Array<{ outcome_id: number; user_id: number | null; credit: number; is_shotgun_sender: number }>;
  assert.deepEqual(all.filter((r) => r.outcome_id === 1).map((r) => r.credit), [1]);
  assert.deepEqual(all.filter((r) => r.outcome_id === 3).map((r) => r.credit), [0.5, 0.5]);
  assert.equal(all.some((r) => r.outcome_id === 5), false, "an appointment is not a transfer");

  // The company total, taken over the expansion, is still the number of rows.
  const total = db.prepare(`SELECT SUM(credit) AS c FROM (${TRANSFER_CREDIT_SQL}) tc`).get() as { c: number };
  const count = db.prepare(`SELECT COUNT(*) AS n FROM lead_outcomes WHERE outcome_type='transfer' AND assistant_id IS NOT NULL`)
    .get() as { n: number };
  assert.equal(total.c, count.n);
  db.close();
});

test("the expansion names the column the shotgun result route stamps", () => {
  assert.equal(SHOTGUN_SENDER_COLUMN, "shotgun_sender_id");
  assert.match(TRANSFER_CREDIT_SQL, /shotgun_sender_id/);
  assert.match(storage, /ADD COLUMN shotgun_sender_id INTEGER/);
  // The route stamps it through the shared helper, never by hand.
  assert.match(routes, /shotgunSenderToStamp\(/);
});

// ── display ─────────────────────────────────────────────────────────────────

test("a half prints as a half, and a whole prints whole", () => {
  assert.equal(formatTransferCount(0), "0");
  assert.equal(formatTransferCount(1), "1");
  assert.equal(formatTransferCount(4), "4");
  assert.equal(formatTransferCount(4.5), "4.5");
  assert.equal(formatTransferCount(0.5), "0.5");
  assert.equal(formatTransferCount(37.5), "37.5");
  assert.equal(formatTransferCount(100), "100");
  assert.equal(formatTransferCount(null), "0");
  assert.equal(formatTransferCount(undefined), "0");
  assert.equal(formatTransferCount(Number.NaN), "0");
});

test("4.5 is never rounded to 4 or to 5 on a surface somebody can count", () => {
  assert.notEqual(formatTransferCount(4.5), "4");
  assert.notEqual(formatTransferCount(4.5), "5");
  assert.equal(String(Math.round(4.5)), "5");
});

// ── the thresholds, at the boundary ─────────────────────────────────────────

test("the volume tiers still behave at 100 and at 200, and a half can now reach them", () => {
  assert.equal(tieredTransferCompRateCents(99.5), 500);
  assert.equal(tieredTransferCompRateCents(100), 1000, "100 exactly is the $10 tier");
  assert.equal(tieredTransferCompRateCents(199.5), 1000);
  assert.equal(tieredTransferCompRateCents(200), 1500, "200 exactly is the $15 tier");
  // A CLR sitting on 99.5 crosses into the next tier on ONE MORE HALF, which
  // is a thing that can now happen — 99.5 + 0.5 = 100.
  assert.equal(tieredTransferCompRateCents(99.5 + SHOTGUN_SENDER_CREDIT), 1000);
});

test("half a transfer is real money and never floors to zero", () => {
  const cents = (count: number, rate: number) => Math.round(count * rate);
  assert.equal(cents(0.5, 500), 250, "half a transfer at $5 is $2.50");
  assert.equal(cents(0.5, 1000), 500, "half a transfer at $10 is $5.00");
  assert.equal(cents(0.5, 1500), 750);
  assert.equal(cents(37.5, 1000), 37500);
  assert.notEqual(cents(0.5, 1000), 0);
  // And the smallest count worth filing IS the smallest count that can exist.
  assert.equal(AUTO_FILE_MIN_TRANSFERS, SHOTGUN_SENDER_CREDIT);
  assert.equal(AUTO_FILE_MIN_TRANSFERS, 0.5);
});

test("a CLR on exactly 37.5 is IN the bump pool", () => {
  assert.equal(BUMP_MIN_TRANSFERS, 37.5);
  const pool = bumpPool([
    { userId: 1, transfers: 37 },
    { userId: 2, transfers: 37.5 },
    { userId: 3, transfers: 38 },
    { userId: 4, transfers: 37.5, active: false },
  ]);
  assert.deepEqual(pool.map((s) => s.userId), [2, 3], "37.5 exactly is in; 37 is out; inactive is out");
});

test("a CLR on exactly 75 meets the floor, and 74.5 misses it", () => {
  assert.equal(FULL_MONTH_TRANSFER_FLOOR, 75);
  // A full month worked, so the floor pro-rates to 75 itself.
  const period = "2026-09";
  const worked = monthWeekdays(period);
  const at = (transfers: number) =>
    compFloorForClr(period, { userId: 1, name: "Test CLR", transfers, activeDates: worked });
  assert.equal(at(75).adjustedFloor, 75);
  assert.equal(at(75).met, true, "75 exactly meets the floor");
  assert.equal(at(74.5).met, false);
  assert.equal(at(74.5).shortBy, 0.5, "and it says it is short by half a transfer, not by one");
  assert.equal(at(75.5).met, true);
  // The count keeps its halves; only the BAR is rounded, and downward.
  assert.equal(at(74.5).transfers, 74.5);
});

test("transfers per working day counts credit, and a lone half is not a whole", () => {
  const days = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => `2026-06-${String(from + i).padStart(2, "0")}`);
  const r = transfersPerWorkingDay({
    activeDates: days(28),
    trainerDates: new Set(),
    // Two whole transfers and two halves after the 20-day training clock.
    transferDates: [
      "2026-06-22",
      { date: "2026-06-23", credit: 0.5 },
      { date: "2026-06-24", credit: 0.5 },
      "2026-06-25",
      { date: "2026-06-05", credit: 0.5 },
    ],
    threshold: 20,
  });
  assert.equal(r.workingDays, 8);
  assert.equal(r.transfers, 3, "2 whole + 2 halves; the training-window half does not count");
  assert.equal(r.ratePerWorkingDay, Number((3 / 8).toFixed(2)));
  // A bare date still means one whole transfer, so old callers are unchanged.
  assert.equal(
    transfersPerWorkingDay({
      activeDates: days(28), trainerDates: new Set(),
      transferDates: ["2026-06-22", "2026-06-25"], threshold: 20,
    }).transfers,
    2,
  );
});

// ── the surfaces read credit, not COUNT(*) ──────────────────────────────────
//
// These pin the shape of the queries, because the failure mode this whole
// change exists to prevent is one surface quietly going back to counting rows
// while the rest of the app counts credit.

const section = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  assert.notEqual(a, -1, `anchor not found: ${from}`);
  const b = src.indexOf(to, a);
  return src.slice(a, b === -1 ? src.length : b);
};

test("the rule lives in one file, and the readers import it rather than restate it", () => {
  for (const [file, src] of [
    ["server/routes.ts", routes],
    ["server/storage.ts", storage],
    ["server/ask-c3.ts", askC3],
  ] as const) {
    assert.match(src, /@shared\/transfer-credit/, `${file} must import the shared rule`);
  }
  // Nobody writes 0.5 into a query of their own.
  const restated = routes.match(/THEN 0\.5 ELSE/g) ?? [];
  assert.equal(restated.length, 0, "a query that hardcodes 0.5 has forked the rule");
});

test("the TV wall's scorecard credits people and counts the team", () => {
  const feed = section(routes, "// Appointments are counted; TRANSFERS ARE CREDITED.", "// ── events since the TV last asked");
  assert.match(feed, /FROM \(\$\{TRANSFER_CREDIT_SQL\}\) tc/);
  assert.match(feed, /SUM\(CASE WHEN tc\.date = \? THEN tc\.credit ELSE 0 END\)/);
  // The team row is still a plain count: one transfer is one transfer.
  assert.match(feed, /SUM\(CASE WHEN outcome_type='transfer'\s+AND date=\? THEN 1 ELSE 0 END\) AS transfersToday/);
});

test("the wall's transfers page credits people, counts the team, and reconciles the gap", () => {
  const page = section(routes, `section("transfers", () => {`, `section("starved"`);
  assert.match(page, /FROM \(\$\{TRANSFER_CREDIT_SQL\}\) tc/);
  assert.match(page, /outcome_type = 'transfer' AND date >= \?/, "the team row stays a COUNT of transfers");
});

test("the starved page and the placement inputs stay on the RECEIVING side", () => {
  // The split is between two CLRs. What a loan officer or an assistant received
  // must not move, so these queries are deliberately NOT credit.
  const starved = section(routes, `section("starved", () => {`, `section("writeUps"`);
  assert.match(starved, /o\.lo_id = lo\.id AND o\.org_id = lo\.org_id AND o\.outcome_type = 'transfer'/);
  assert.match(starved, /o\.loa_id = a\.id AND o\.org_id = \? AND o\.outcome_type = 'transfer'/);
  assert.doesNotMatch(starved, /TRANSFER_CREDIT_SQL/, "an LO's received count is not split between CLRs");
});

test("the manager dashboard's scorecard and leaderboard read credit", () => {
  assert.match(routes, /lbByUser\[uid\]\.transfers = Number\(r\.credit\) \|\| 0;/);
  assert.match(routes, /outcomesByUser\[uid\]\.transfer = Number\(r\.credit\) \|\| 0;/);
  // The per-CLR daily trend too.
  assert.match(routes, /SELECT tc\.user_id AS assistant_id, tc\.date AS date, SUM\(tc\.credit\) AS count/);
});

test("the dashboard scorecard credits one person and counts the team", () => {
  const stats = section(storage, "getDashboardStats(startDate: string, endDate: string, assistantId?: number, tz?: string) {", "  getLeaderboard(");
  assert.match(stats, /getTransferCreditForUser\(Number\(assistantId\)/);
  assert.match(stats, /outcomes\.filter\(\(o: any\) => o\.outcome_type === "transfer"\)\.length/);
  assert.match(storage, /const transfers = transferCreditIn\(outcomes, user\.id\);/);
});

test("EOD reads credit on every one of its surfaces — form, history, print and email", () => {
  const eodReport = read("client/src/pages/eod-report.tsx");
  assert.match(eodReport, /transferCreditIn\(dayAllOutcomes/, "the form seeds from credit");
  assert.match(eodReport, /value=\{formatTransferCount\(autoTransfers\)\}/, "and shows it as 4.5, not 4");
  assert.match(eodReport, /count: formatTransferCount\(transfers\)/, "the print sheet formats it");
  // The history list and the single-report print endpoint.
  const creditedBreakdown = routes.match(
    /outcomeBreakdown\.transfer = storageExtra\.getTransferCreditForUser\(/g,
  ) ?? [];
  assert.equal(creditedBreakdown.length, 2, "both EOD read endpoints must credit");
  // And the email that goes to the CLR, which used to count their own rows.
  assert.match(routes, /outcomeCounts\.transfer = storageExtra\.getTransferCreditForUser\(/);
  assert.match(routes, /\$\{formatTransferCount\(outcomeCounts\.transfer\)\}/);
  assert.match(routes, /const xfersLabel = formatTransferCount\(xfers\);/);
});

test("the comp summary emails price credit, to the cent, in both modes", () => {
  const comp = section(routes, "function buildCompSummaryHtml", "function buildTimeClockSummaryHtml");
  assert.match(comp, /SUM\(tc\.credit\) AS transfers/);
  assert.match(comp, /FROM \(\$\{TRANSFER_CREDIT_SQL\}\) tc/);
  // Projected (Wednesday MTD) and end-of-month both print through the formatter.
  assert.match(comp, /\$\{formatTransferCount\(mtd\)\}/);
  assert.match(comp, /\$\{formatTransferCount\(proj\)\}/);
  assert.match(comp, /\$\{formatTransferCount\(t\)\}/);
  assert.match(comp, /\$\{formatTransferCount\(totalTransfers\)\}/);
  // Money is rounded to the cent, never floored to a dollar.
  assert.match(comp, /Math\.round\(count \* rateDollars \* 100\) \/ 100/);
  // A projection lands on a number a CLR could actually reach.
  assert.match(comp, /\* 2\) \/ 2/);
});

test("the transfers-per-working-day rate is fed credit, not rows", () => {
  const rate = section(routes, "function clrWorkdayRatesByUser", "app.get(\"/api/clr-profiles\"");
  assert.match(rate, /FROM \(\$\{TRANSFER_CREDIT_SQL\}\) tc/);
  assert.match(rate, /credit: Number\(row\.credit\) \|\| 0/);
  assert.doesNotMatch(
    rate,
    /SELECT assistant_id, date FROM lead_outcomes WHERE org_id=\? AND outcome_type='transfer'/,
    "the old row-counting read must be gone",
  );
});

test("Ask C3 quotes credit for a person and a count for the team", () => {
  assert.match(askC3, /transferCreditByUser\(outcomes\)\.forEach/);
  assert.match(askC3, /const credit = transferCreditFor\(row, assistantId\);/);
  assert.match(askC3, /if \(type === "transfer"\) \{ if \(!assistantId\) bucket\.transfers\+\+; \}/);
  // And it is told the rule, so it never explains a 4.5 away as a rounding bug.
  assert.match(askC3, /half a transfer for the CLR who published the lead/);
});

test("the placement stat deliberately does NOT split, and says why", () => {
  const priority = read("server/transfer-priority.ts");
  assert.match(priority, /WHY THE SHOTGUN SPLIT DOES NOT REACH THIS FILE/);
  assert.match(priority, /Never the shotgun publisher/);
  // It is a judgement on a decision, and exactly one person made that decision.
  assert.doesNotMatch(priority, /shotgun_sender_id/);
});

test("the client renders credit through the shared formatter, not Math.round", () => {
  for (const page of [
    "client/src/pages/tv.tsx",
    "client/src/components/tv/pages.tsx",
    "client/src/components/tv/race.tsx",
    "client/src/pages/dashboard.tsx",
    "client/src/pages/manager-dashboard.tsx",
    "client/src/pages/leaderboard.tsx",
    "client/src/pages/my-report.tsx",
    "client/src/pages/team-stats.tsx",
    "client/src/pages/clr-profile.tsx",
    "client/src/pages/clr-profiles.tsx",
    "client/src/pages/comp-requests.tsx",
    "client/src/pages/eod-report.tsx",
  ]) {
    assert.match(read(page), /formatTransferCount/, `${page} must print transfer counts through the formatter`);
  }
});

test("the wall's race caption prints a half rather than rounding it", () => {
  const race = read("client/src/components/tv/race.tsx");
  assert.match(race, /const countLabel = formatTransferCount\(count\);/);
  assert.match(race, /\{countLabel\} \{plural\} today/);
});
