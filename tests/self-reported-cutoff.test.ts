import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  COUNTED_CALLS_SQL, COUNTED_MESSAGES_SQL, SELF_REPORTED_CUTOFF, selfReportedCountsOn,
} from "../shared/self-reported";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");

/**
 * Self-reported calls and messages stopped counting on 2026-09-14. Before
 * that date the numbers a CLR typed in are what history says; from it, calls
 * are Dialpad's and messages are Dialpad's, and nothing typed is read. The
 * two SQL fragments are the single definition of that — this exercises them
 * against a real SQLite database with rows on both sides of the line.
 */

const BEFORE = "2026-09-12";
const AFTER = "2026-09-15";

function seeded(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE daily_call_logs (id INTEGER PRIMARY KEY, log_date TEXT, assistant_id INTEGER, calls_made INTEGER, notes TEXT, updated_at TEXT, org_id INTEGER, contacts_reached INTEGER, dnc_hits INTEGER);
    CREATE TABLE dialpad_daily_stats (id INTEGER PRIMARY KEY, org_id INTEGER, stat_date TEXT, agent_key TEXT, agent_name TEXT, user_id INTEGER, calls INTEGER, synced_at TEXT);
    -- eod_reports has NO org_id in production; the fragment must get it from users.
    CREATE TABLE eod_reports (id INTEGER PRIMARY KEY, report_date TEXT, assistant_id INTEGER, messages_sent INTEGER, calls_made INTEGER, dialpad_calls INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, org_id INTEGER);
    CREATE TABLE dialpad_sms_events (id INTEGER PRIMARY KEY, org_id INTEGER, external_event_id TEXT, agent_key TEXT, user_id INTEGER, message_date TEXT);
    CREATE TABLE dialpad_agent_links (id INTEGER PRIMARY KEY, org_id INTEGER, agent_key TEXT, user_id INTEGER);
    CREATE TABLE bonzo_call_events (id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER, event_id TEXT, prospect_id INTEGER, kind TEXT, path TEXT, method TEXT, counts INTEGER, occurred_at TEXT, business_date TEXT, page_url TEXT, received_at TEXT);
  `);
  // Calls placed inside Bonzo: a click and the request it fired in the same
  // minute are ONE call; a candidate (counts = 0) is never a call; a call
  // before the cutoff is ignored like every other imported figure then.
  const bonzo = db.prepare(`INSERT INTO bonzo_call_events (org_id, user_id, event_id, prospect_id, kind, path, method, counts, occurred_at, business_date) VALUES (1, 7, ?, ?, ?, ?, ?, ?, ?, ?)`);
  bonzo.run("e1", 555, "click", "/prospects/555", "CLICK", 1, `${AFTER}T16:04:10.000Z`, AFTER);
  bonzo.run("e2", 555, "network", "/api/v3/prospects/555/call", "POST", 1, `${AFTER}T16:04:12.000Z`, AFTER);
  bonzo.run("e3", 556, "network", "/api/v3/calls", "POST", 1, `${AFTER}T16:40:00.000Z`, AFTER);
  bonzo.run("e4", 557, "network", "/api/v3/prospects/557/phone_numbers", "PATCH", 0, `${AFTER}T17:00:00.000Z`, AFTER);
  bonzo.run("e5", 558, "network", "/api/v3/calls", "POST", 1, `${BEFORE}T16:00:00.000Z`, BEFORE);
  db.prepare(`INSERT INTO users (id, name, org_id) VALUES (7, 'Seven One', 1)`).run();
  // Typed-in calls on both sides of the cutoff; Dialpad on both sides too.
  db.prepare(`INSERT INTO daily_call_logs (log_date, assistant_id, calls_made, org_id) VALUES (?,?,?,1)`).run(BEFORE, 7, 400);
  db.prepare(`INSERT INTO daily_call_logs (log_date, assistant_id, calls_made, org_id) VALUES (?,?,?,1)`).run(AFTER, 7, 550);
  db.prepare(`INSERT INTO dialpad_daily_stats (org_id, stat_date, agent_key, agent_name, user_id, calls, synced_at) VALUES (1,?,?,?,?,?,'t')`).run(BEFORE, "sevenone", "Seven One", 7, 31);
  db.prepare(`INSERT INTO dialpad_daily_stats (org_id, stat_date, agent_key, agent_name, user_id, calls, synced_at) VALUES (1,?,?,?,?,?,'t')`).run(AFTER, "sevenone", "Seven One", 7, 26);
  // The same person under a second agent name on the same day.
  db.prepare(`INSERT INTO dialpad_daily_stats (org_id, stat_date, agent_key, agent_name, user_id, calls, synced_at) VALUES (1,?,?,?,?,?,'t')`).run(AFTER, "seven", "Seven", 7, 4);
  // An unmapped agent must never count for anyone.
  db.prepare(`INSERT INTO dialpad_daily_stats (org_id, stat_date, agent_key, agent_name, user_id, calls, synced_at) VALUES (1,?,?,?,NULL,?,'t')`).run(AFTER, "stranger", "Stranger", 99);
  // Typed-in texts on both sides; Dialpad texts on both sides.
  db.prepare(`INSERT INTO eod_reports (report_date, assistant_id, messages_sent, calls_made, dialpad_calls) VALUES (?,?,?,?,?)`).run(BEFORE, 7, 900, 400, 31);
  db.prepare(`INSERT INTO eod_reports (report_date, assistant_id, messages_sent, calls_made, dialpad_calls) VALUES (?,?,?,?,?)`).run(AFTER, 7, 1200, 0, 30);
  for (let i = 0; i < 12; i++) db.prepare(`INSERT INTO dialpad_sms_events (org_id, external_event_id, agent_key, user_id, message_date) VALUES (1,?,?,7,?)`).run(`b${i}`, "sevenone", BEFORE);
  for (let i = 0; i < 9; i++) db.prepare(`INSERT INTO dialpad_sms_events (org_id, external_event_id, agent_key, user_id, message_date) VALUES (1,?,?,7,?)`).run(`a${i}`, "sevenone", AFTER);
  // A text with no user on the event but a linked agent still lands on the person.
  db.prepare(`INSERT INTO dialpad_agent_links (org_id, agent_key, user_id) VALUES (1,'seven',7)`).run();
  db.prepare(`INSERT INTO dialpad_sms_events (org_id, external_event_id, agent_key, user_id, message_date) VALUES (1,'linked','seven',NULL,?)`).run(AFTER);
  return db;
}

test("the cutoff is the 14th of September 2026, compared as a business day", () => {
  assert.equal(SELF_REPORTED_CUTOFF, "2026-09-14");
  assert.equal(selfReportedCountsOn("2026-09-13"), true);
  assert.equal(selfReportedCountsOn("2026-09-14"), false);
  assert.equal(selfReportedCountsOn("2026-09-15"), false);
});

test("calls: typed-in before the cutoff, Dialpad from it, summed per person", () => {
  const db = seeded();
  const byDay = db.prepare(`SELECT d, SUM(calls) AS calls FROM ${COUNTED_CALLS_SQL} WHERE assistant_id = 7 GROUP BY d ORDER BY d`).all() as any[];
  assert.deepEqual(byDay, [
    { d: BEFORE, calls: 400 }, // what was typed — Dialpad's 31 and the Bonzo call that day are NOT added
    { d: AFTER, calls: 32 },   // 26 + 4 Dialpad across two agent names, + 2 Bonzo calls (click+request = 1, plus 1); the typed 550 is gone
  ]);
  // The unmapped stranger's 99 land on nobody.
  const total = db.prepare(`SELECT SUM(calls) AS n FROM ${COUNTED_CALLS_SQL}`).get() as any;
  assert.equal(total.n, 432);
});

test("messages: the EOD's typed number before the cutoff, Dialpad texts from it", () => {
  const db = seeded();
  const byDay = db.prepare(`SELECT d, SUM(messages) AS messages FROM ${COUNTED_MESSAGES_SQL} WHERE assistant_id = 7 GROUP BY d ORDER BY d`).all() as any[];
  assert.deepEqual(byDay, [
    { d: BEFORE, messages: 900 }, // typed; the 12 Dialpad texts that day are not added
    { d: AFTER, messages: 10 },   // 9 on the event's user + 1 through the agent link; the typed 1,200 is gone
  ]);
});

test("the fragments carry the columns every consumer filters on", () => {
  const db = seeded();
  for (const [sql, valueCol] of [[COUNTED_CALLS_SQL, "calls"], [COUNTED_MESSAGES_SQL, "messages"]] as const) {
    const cols = db.prepare(`SELECT * FROM ${sql} LIMIT 1`).columns().map((c) => c.name).sort();
    assert.deepEqual(cols, ["assistant_id", "d", "org_id", valueCol].sort());
  }
});

test("the raw SQL sites in routes read through the fragments, not the typed tables", () => {
  // Reads that sum calls or messages for a stat, a chart or a digest.
  const callSites = (routes.match(/FROM \$\{COUNTED_CALLS_SQL\}/g) ?? []).length;
  const messageSites = (routes.match(/FROM \$\{COUNTED_MESSAGES_SQL\}/g) ?? []).length;
  assert.ok(callSites >= 7, `expected the call fragment at 7+ sites, found ${callSites}`);
  assert.ok(messageSites >= 2, `expected the message fragment at 2+ sites, found ${messageSites}`);
  // No stat may still sum the typed columns straight off the tables.
  assert.doesNotMatch(routes, /SUM\(calls_made\)[^\n]*FROM daily_call_logs/);
  assert.doesNotMatch(routes, /SUM\(messages_sent\)[^\n]*FROM eod_reports/);
});

test("the storage helpers most consumers read through are counted rows", () => {
  assert.match(storage, /export const COUNTED_CALL_LOG_SQL = `\(/);
  assert.match(storage, /getDailyCallLogs\(date: string\) \{\s*\n\s*return countedCallLogRows\(date, date, currentOrgId\(\)\);/);
  assert.match(storage, /getCallLogsByRange\(from: string, to: string\) \{\s*\n\s*return countedCallLogRows\(from, to, currentOrgId\(\)\);/);
  assert.match(storage, /export function countedEodRow/);
  assert.match(storage, /return row \? countedEodRow\(row\) : null;/);
  assert.match(storage, /countedEodRow\(r, orgByUser\)/);
});

test("the three ways to type a number in are closed from the cutoff", () => {
  // The call-log endpoint refuses.
  assert.match(routes, /if \(!selfReportedCountsOn\(String\(logDate\)\)\) \{\s*\n\s*return res\.status\(410\)/);
  // The morning gate stays closed.
  assert.match(routes, /if \(!selfReportedCountsOn\(reportDate\)\) \{\s*\n\s*return res\.json\(\{ hasLog: true, date: reportDate, exempt: true/);
  // The EOD stores zeros for anything typed, and stops writing the call log.
  assert.match(routes, /const callsNum = typedCountsCount \? typedCallsNum : 0;/);
  assert.match(routes, /const messagesNum = typedCountsCount \? typedMessagesNum : 0;/);
  assert.match(routes, /if \(typedCountsCount\) \{\s*\n\s*storage\.upsertDailyCallLog\(/);
});

test("the inputs are gone from the screens", () => {
  const eod = read("client/src/pages/eod-report.tsx");
  assert.doesNotMatch(eod, /data-testid="input-additional-calls"/);
  assert.doesNotMatch(eod, /data-testid="input-additional-texts"/);
  const dashboard = read("client/src/pages/dashboard.tsx");
  assert.doesNotMatch(dashboard, /Log Calls/);
  const assignments = read("client/src/pages/assignments.tsx");
  assert.doesNotMatch(assignments, /EOD Call Count/);
  assert.doesNotMatch(assignments, /data-testid=\{`input-calls-\$\{user\.id\}`\}/);
});
