import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LAST_TOURNAMENT_DATE, TOURNAMENT_ENABLED, TOURNAMENT_END, TOURNAMENT_EXCLUDED_FROM, TOURNAMENT_START, TOURNAMENT_TZ, isTournamentExcluded, outcomeCreatedMs, todayInTz, tournamentPhase, tournamentStandings, tournamentWindow, wallClockToMs,
} from "../shared/tournament";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * "Add a screen in the dashboard C3 that is a tournament screen, keeping
 * track of who has the most transfers from 12:30-5:30 today." — Ethan,
 * 14 Sep 2026.
 */

test("the window is 12:30–5:30 PM Pacific on the calendar day", () => {
  assert.equal(TOURNAMENT_TZ, "America/Los_Angeles");
  assert.equal(TOURNAMENT_START, "12:30");
  assert.equal(TOURNAMENT_END, "17:30");
  // 14 Sep 2026 is PDT (UTC−7): 12:30 PT = 19:30Z, 17:30 PT = 00:30Z next day.
  const w = tournamentWindow("2026-09-14");
  assert.equal(w.startIso, "2026-09-14T19:30:00.000Z");
  assert.equal(w.endIso, "2026-09-15T00:30:00.000Z");
  // And in standard time (UTC−8) the same wall clock is an hour later in UTC.
  const winter = tournamentWindow("2026-12-14");
  assert.equal(winter.startIso, "2026-12-14T20:30:00.000Z");
  assert.equal(wallClockToMs("2026-09-14", "12:30"), w.startMs);
  assert.equal(todayInTz(Date.parse("2026-09-15T02:00:00Z")), "2026-09-14", "7 PM Pacific is still the 14th");
});

test("phase follows the window", () => {
  const w = tournamentWindow("2026-09-14");
  assert.equal(tournamentPhase(w.startMs - 1, w), "before");
  assert.equal(tournamentPhase(w.startMs, w), "live");
  assert.equal(tournamentPhase(w.endMs - 1, w), "live");
  assert.equal(tournamentPhase(w.endMs, w), "over");
});

test("both created_at spellings are read as UTC", () => {
  assert.equal(outcomeCreatedMs("2026-09-14T19:45:00.000Z"), Date.parse("2026-09-14T19:45:00Z"));
  assert.equal(outcomeCreatedMs("2026-09-14 19:45:00"), Date.parse("2026-09-14T19:45:00Z"));
  assert.ok(Number.isNaN(outcomeCreatedMs(null)));
});

const people = [{ id: 1, name: "Ana" }, { id: 2, name: "Ben" }, { id: 3, name: "Cy" }];
const w = tournamentWindow("2026-09-14");
const at = (hhmm: string) => new Date(wallClockToMs("2026-09-14", hhmm)).toISOString();

test("only transfers LOGGED inside the window count, and every CLR is on the board", () => {
  const rows = [
    { id: 1, assistant_id: 1, outcome_type: "transfer", created_at: at("12:29"), borrower_name: "Too early" },
    { id: 2, assistant_id: 1, outcome_type: "transfer", created_at: at("12:30"), borrower_name: "On the bell" },
    { id: 3, assistant_id: 2, outcome_type: "transfer", created_at: at("15:00"), borrower_name: "Mid" },
    { id: 4, assistant_id: 2, outcome_type: "appointment", created_at: at("15:10"), borrower_name: "Not a transfer" },
    { id: 5, assistant_id: 2, outcome_type: "transfer", created_at: at("17:30"), borrower_name: "Too late" },
    { id: 6, assistant_id: 2, outcome_type: "transfer", created_at: "2026-09-14 23:00:00", borrower_name: "SQLite spelling, 4 PM PT" },
  ];
  const s = tournamentStandings(rows, people, w);
  assert.deepEqual(s.map((r) => [r.rank, r.name, r.credit]), [[1, "Ben", 2], [2, "Ana", 1], [3, "Cy", 0]]);
  assert.deepEqual(s[0].transfers.map((t) => t.borrowerName), ["Mid", "SQLite spelling, 4 PM PT"]);
  assert.equal(s[1].transfers[0].borrowerName, "On the bell");
  assert.equal(s[2].latestAt, null);
});

test("a Shotgun transfer is half to the publisher and half to the claimer, and first-to-score wins a tie", () => {
  const rows = [
    { id: 1, assistant_id: 2, shotgun_sender_id: 1, outcome_type: "transfer", created_at: at("13:00"), borrower_name: "Shared" },
    { id: 2, assistant_id: 3, outcome_type: "transfer", created_at: at("13:30"), borrower_name: "Solo" },
    { id: 3, assistant_id: 1, outcome_type: "transfer", created_at: at("14:00"), borrower_name: "Ana again" },
  ];
  const s = tournamentStandings(rows, people, w);
  // Ana 1.5 (half + one), Cy 1, Ben 0.5.
  assert.deepEqual(s.map((r) => [r.rank, r.name, r.credit]), [[1, "Ana", 1.5], [2, "Cy", 1], [3, "Ben", 0.5]]);
  assert.equal(s[0].transfers[0].credit, 0.5);
  // The board never invents credit: the halves sum back to the rows.
  assert.equal(s.reduce((sum, r) => sum + r.credit, 0), 3);
  // Tie: same credit, different first time — the earlier CLR ranks ahead, no shared rank.
  const tie = tournamentStandings([
    { id: 1, assistant_id: 2, outcome_type: "transfer", created_at: at("13:00") },
    { id: 2, assistant_id: 1, outcome_type: "transfer", created_at: at("13:05") },
  ], people, w);
  assert.deepEqual(tie.map((r) => [r.rank, r.name]), [[1, "Ben"], [2, "Ana"], [3, "Cy"]]);
  // Someone not on the roster who earned credit still appears, by id.
  const ghost = tournamentStandings([{ id: 9, assistant_id: 77, outcome_type: "transfer", created_at: at("13:00") }], people, w);
  assert.equal(ghost[0].name, "CLR #77");
});

test("the server pulls the day either side and the board is a Dashboard tab and its own page", () => {
  const routes = read("server/routes.ts");
  const route = routes.slice(routes.indexOf('app.get("/api/tournament"'), routes.indexOf('app.get("/api/leaderboard"'));
  assert.match(route, /todayInTz\(now\.getTime\(\), TOURNAMENT_TZ\)/);
  assert.match(route, /substr\(o\.created_at, 1, 10\) IN \(\?, \?, \?\)/);
  assert.match(route, /is_active = 1 AND is_clr = 1/);
  assert.match(route, /tournamentStandings\(rows, people, window\)/);
  const dashboard = read("client/src/pages/dashboard.tsx");
  assert.match(dashboard, /<TabsTrigger value="tournament"/);
  assert.match(dashboard, /<TournamentBoard \/>/);
  const app = read("client/src/App.tsx");
  assert.match(app, /<Route path="\/tournament" component=\{Tournament\} \/>/);
  const page = read("client/src/pages/tournament.tsx");
  assert.match(page, /refetchInterval: date \? false : 10_000,\s*\n\s*refetchIntervalInBackground: false/);
  assert.match(page, /serverTime - dataUpdatedAt/, "the countdown runs on the server clock");
});

// 17 Sep 2026: tournament back on — home tab (CLRs + managers), Elleine excluded.
test("tournament is on for home pages, with Elleine excluded from the board and UI", () => {
  assert.equal(TOURNAMENT_ENABLED, true);
  assert.equal(LAST_TOURNAMENT_DATE, "2026-09-14");
  assert.equal(isTournamentExcluded("Elleine Asuncion"), true);
  assert.equal(isTournamentExcluded("Ana"), false);
  const people = [
    { id: 1, name: "Ana" },
    { id: 2, name: "Elleine Asuncion" },
    { id: 3, name: "Cy" },
  ];
  const w = tournamentWindow("2026-09-14");
  const at = (hhmm: string) => new Date(wallClockToMs("2026-09-14", hhmm)).toISOString();
  const s = tournamentStandings([
    { id: 1, assistant_id: 2, outcome_type: "transfer", created_at: at("13:00"), borrower_name: "Helper" },
    { id: 2, assistant_id: 1, outcome_type: "transfer", created_at: at("13:05"), borrower_name: "Ana" },
  ], people, w);
  assert.ok(!s.some((r) => /elleine/i.test(r.name)), "Elleine must not appear on the board");
  assert.deepEqual(s.map((r) => [r.name, r.credit]), [["Ana", 1], ["Cy", 0]]);

  const dashboard = read("client/src/pages/dashboard.tsx");
  assert.match(dashboard, /TOURNAMENT_ENABLED && \(\s*\n\s*<TabsTrigger value="tournament"/);
  assert.match(dashboard, /TOURNAMENT_ENABLED && \(\s*\n\s*<TabsContent value="tournament"/);
  const sidebar = read("client/src/components/app-sidebar.tsx");
  assert.match(sidebar, /\.\.\.\(TOURNAMENT_ENABLED \? \[\{ title: "Transfer Tournament"/);
  const page = read("client/src/pages/tournament.tsx");
  assert.match(page, /if \(!TOURNAMENT_ENABLED\) \{/);
  assert.match(page, /isTournamentExcluded\(user\?\.name\)/);
  assert.match(page, /<TournamentBoard fullscreen date=\{LAST_TOURNAMENT_DATE\} \/>/);
});

// Ethan 18 Sep 2026: "jordon shouldn't count since wednesday" — from 2026-09-16 PT.
test("Jordon Chang is excluded from tournament scoring on/after 2026-09-16 PT", () => {
  assert.ok(TOURNAMENT_EXCLUDED_FROM.some((r) => r.fromDate === "2026-09-16"));
  assert.equal(isTournamentExcluded("Jordon Chang", "2026-09-16"), true);
  assert.equal(isTournamentExcluded("Jordan Chang", "2026-09-16"), true, "Jordan spelling variant");
  assert.equal(isTournamentExcluded("Jordon Chang", "2026-09-15"), false, "before Wednesday still counts");
  assert.equal(isTournamentExcluded("Jordan Rivera", "2026-09-16"), false, "demo LO must not match");
  assert.equal(isTournamentExcluded("Elleine Asuncion", "2026-09-14"), true, "Elleine stays always excluded");

  const people = [
    { id: 1, name: "Ana" },
    { id: 2, name: "Jordon Chang" },
    { id: 3, name: "Cy" },
  ];
  const before = tournamentWindow("2026-09-15");
  const after = tournamentWindow("2026-09-16");
  const atBefore = (hhmm: string) => new Date(wallClockToMs("2026-09-15", hhmm)).toISOString();
  const atAfter = (hhmm: string) => new Date(wallClockToMs("2026-09-16", hhmm)).toISOString();
  const rowsBefore = [
    { id: 1, assistant_id: 2, outcome_type: "transfer", created_at: atBefore("13:00"), borrower_name: "Jordon day" },
    { id: 2, assistant_id: 1, outcome_type: "transfer", created_at: atBefore("13:05"), borrower_name: "Ana" },
  ];
  const rowsAfter = [
    { id: 1, assistant_id: 2, outcome_type: "transfer", created_at: atAfter("13:00"), borrower_name: "Jordon day" },
    { id: 2, assistant_id: 1, outcome_type: "transfer", created_at: atAfter("13:05"), borrower_name: "Ana" },
  ];
  const sBefore = tournamentStandings(rowsBefore, people, before);
  assert.ok(sBefore.some((r) => r.name === "Jordon Chang" && r.credit === 1), "pre-Wednesday board still credits Jordon");
  const sAfter = tournamentStandings(rowsAfter, people, after);
  assert.ok(!sAfter.some((r) => /jordon|jordan/i.test(r.name)), "from Wednesday Jordon is off the board");
  assert.deepEqual(sAfter.map((r) => [r.name, r.credit]), [["Ana", 1], ["Cy", 0]]);
});
