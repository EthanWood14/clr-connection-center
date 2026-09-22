import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  formatTvCarRemaining, TV_CAR_DAILY_SECONDS, TV_CAR_DAILY_SECONDS_BEFORE, TV_CAR_MAX_TICK_SECONDS,
  TV_CAR_SHORTER_DAY_FROM, TV_CAR_TICK_MS, tvCarDailySeconds,
  tvCarBudget, tvCarBudgetDay, tvCarTickSeconds,
} from "../shared/tv-car-budget";
import { readTvCarBudget, registerTvCarRoutes, spendTvCarTime } from "../server/tv-car-routes";

/**
 * "Only allow someone to change their car for max of 15 mins a day on that tab
 * and then lock it out." — Ethan, 16 Sep 2026.
 */

const owner = { id: 7, org_id: 1, name: "Taylor", role: "assistant", is_clr: 1, is_active: 1, portal: null };
const session = { userId: 7, orgId: 1, portal: null };
const paint = { bodyColor: "#123abc", accentColor: "#ee9900", livery: "solid" };

test("three minutes, and the arithmetic cannot be talked out of it", () => {
  assert.equal(TV_CAR_DAILY_SECONDS, 3 * 60);
  const today = "2026-09-23";
  assert.deepEqual(tvCarBudget(0, today), { used: 0, remaining: 180, locked: false, day: today });
  assert.deepEqual(tvCarBudget(179, today), { used: 179, remaining: 1, locked: false, day: today });
  assert.deepEqual(tvCarBudget(180, today), { used: 180, remaining: 0, locked: true, day: today });
  // Nonsense in the column can only ever lock somebody out, never let them in
  // for longer than the three minutes everyone else gets.
  assert.equal(tvCarBudget(99999, "d").locked, true);
  for (const bad of [-50, NaN, Infinity, null as any, "lots" as any]) {
    assert.equal(tvCarBudget(bad, "d").used, 0, String(bad));
    assert.equal(tvCarBudget(bad, "d").locked, false);
  }
});

// "Starting tomorrow, limit garage time to 5mins a day" — then "actually make
// it 3". Ethan, 22 Sep 2026. Dated, not a straight edit: cutting the allowance
// under somebody who had already spent eight minutes that morning would lock
// them out retroactively, mid-session, with no warning.
test("the shorter day starts on its date and does not reach backwards", () => {
  assert.equal(TV_CAR_SHORTER_DAY_FROM, "2026-09-23");
  assert.equal(TV_CAR_DAILY_SECONDS_BEFORE, 15 * 60);
  assert.equal(tvCarDailySeconds("2026-09-22"), 15 * 60, "the day the rule changed keeps its fifteen");
  assert.equal(tvCarDailySeconds("2026-09-23"), 3 * 60);
  assert.equal(tvCarDailySeconds("2026-10-01"), 3 * 60);
  assert.equal(tvCarDailySeconds("2026-09-16"), 15 * 60);
  // Somebody eight minutes into the old rule is not locked out by the change.
  assert.equal(tvCarBudget(8 * 60, "2026-09-22").locked, false);
  assert.equal(tvCarBudget(8 * 60, "2026-09-23").locked, true, "but they are the next morning");
  // A missing or unreadable day gets the shorter allowance rather than the
  // longer one: guessing generously is how a cap stops being a cap.
  for (const odd of ["", null as any, undefined as any]) assert.equal(tvCarDailySeconds(odd), 3 * 60, String(odd));
});

test("a tick buys the time that actually passed, and no more", () => {
  assert.equal(TV_CAR_TICK_MS, 15_000);
  assert.equal(TV_CAR_MAX_TICK_SECONDS, 30);
  assert.equal(tvCarTickSeconds(15_000), 15, "the ordinary cadence");
  assert.equal(tvCarTickSeconds(4_000), 4, "a fast tick buys four seconds, not fifteen");
  // A tab that slept through lunch reports once. Without the cap that single
  // call would spend the whole day in one go.
  assert.equal(tvCarTickSeconds(3 * 60 * 60_000), TV_CAR_MAX_TICK_SECONDS);
  // A first tick, a clock that went backwards, and garbage all settle sanely.
  for (const odd of [null, undefined, 0, -900, NaN, Infinity]) assert.equal(tvCarTickSeconds(odd as any), 1, String(odd));
});

test("the day rolls over where the office is, not where the browser is", () => {
  // 11 PM Pacific on the 16th is already the 17th in UTC. Slicing an ISO
  // string would hand that person a second fifteen minutes before midnight.
  assert.equal(tvCarBudgetDay(Date.parse("2026-09-17T06:30:00Z")), "2026-09-16");
  assert.equal(tvCarBudgetDay(Date.parse("2026-09-17T07:30:00Z")), "2026-09-17");
  assert.equal(tvCarBudgetDay(Date.parse("2026-09-16T20:00:00Z")), "2026-09-16");
  assert.notEqual(tvCarBudgetDay(Date.parse("2026-09-17T06:30:00Z")), new Date("2026-09-17T06:30:00Z").toISOString().slice(0, 10));
});

test("the countdown reads like a person wrote it", () => {
  assert.equal(formatTvCarRemaining(180), "3 min left today");
  assert.equal(formatTvCarRemaining(61), "2 min left today");
  assert.equal(formatTvCarRemaining(45), "45 sec left today");
  assert.equal(formatTvCarRemaining(0), "no time left today");
  assert.equal(formatTvCarRemaining(-5), "no time left today");
});

function harness(t: TestContext) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  const source = readFileSync(new URL("../server/storage.ts", import.meta.url), "utf8");
  for (const table of ["tv_car_preferences", "tv_car_wraps", "tv_car_skins", "tv_car_garage_time"]) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\)\\\``));
    assert.ok(ddl, `production startup initializes ${table}`);
    db.exec(ddl[0].slice(0, -1));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, name TEXT, role TEXT,
    is_clr INTEGER, is_active INTEGER, portal TEXT);
    INSERT INTO users VALUES (7,1,'Taylor','assistant',1,1,NULL), (9,2,'Morgan','assistant',1,1,NULL);`);
  const routes = new Map<string, any[]>();
  const requireAuth = (req: any, res: any, next: () => void) =>
    req.session_user ? next() : res.status(401).json({ error: "Unauthorized" });
  const record = (method: string) => (path: string, ...handlers: any[]) => { routes.set(`${method} ${path}`, handlers); };
  registerTvCarRoutes({
    get: record("GET"), patch: record("PATCH"), put: record("PUT"),
    post: record("POST"), delete: record("DELETE"), use: () => {},
  } as any, { requireAuth, db: () => db, sessionFor: (req: any) => req.session_user ?? null, audit: () => {} });
  function call(route: string, body: any = undefined) {
    const result: any = { status: 200, body: null };
    const res: any = {
      status(code: number) { result.status = code; return res; },
      json(value: any) { result.body = value; return res; },
    };
    const handlers = routes.get(route)!;
    assert.ok(handlers, `route ${route} is registered`);
    let i = 0;
    const next = () => handlers[i++]?.({ body, headers: {}, query: {}, session_user: session }, res, next);
    next();
    return result;
  }
  const today = tvCarBudgetDay(Date.now());
  const spend = (seconds: number = tvCarDailySeconds(today)) => db.prepare(
    "INSERT INTO tv_car_garage_time (org_id,user_id,day,seconds,last_tick_at) VALUES (1,7,?,?,?)")
    .run(tvCarBudgetDay(Date.now()), seconds, new Date().toISOString());
  return { db, call, spend };
}

test("the tick is measured on the server clock, one row per person per day", (t) => {
  const h = harness(t);
  const day = tvCarBudgetDay(Date.parse("2026-09-16T20:00:00Z"));
  const openDay = tvCarBudgetDay(Date.now());
  assert.deepEqual(readTvCarBudget(h.db, owner as any), { used: 0, remaining: tvCarDailySeconds(openDay), locked: false, day: openDay });
  const first = spendTvCarTime(h.db, owner as any, Date.parse("2026-09-16T20:00:00Z"));
  assert.deepEqual(first, { used: 1, remaining: TV_CAR_DAILY_SECONDS_BEFORE - 1, locked: false, day });
  // Fifteen seconds later the second tick is worth fifteen seconds, whatever
  // the page thinks: the gap is read from the row it wrote last time.
  const second = spendTvCarTime(h.db, owner as any, Date.parse("2026-09-16T20:00:15Z"));
  assert.equal(second.used, 16);
  // An hour of a backgrounded tab is worth one capped tick, not an hour.
  const third = spendTvCarTime(h.db, owner as any, Date.parse("2026-09-16T21:00:15Z"));
  assert.equal(third.used, 16 + TV_CAR_MAX_TICK_SECONDS);
  assert.equal(Number((h.db.prepare("SELECT count(*) AS c FROM tv_car_garage_time").get() as any).c), 1);
  // Tomorrow is its own row and its own fifteen minutes.
  const tomorrow = spendTvCarTime(h.db, owner as any, Date.parse("2026-09-17T20:00:00Z"));
  assert.equal(tomorrow.used, 1);
  assert.notEqual(tomorrow.day, day);
});

test("looking is free; changing is what the clock is for", (t) => {
  const h = harness(t);
  // Opening the garage costs nothing and creates no row.
  const opened = h.call("GET /api/me/tv-car");
  assert.equal(opened.status, 200);
  assert.equal(opened.body.budget.used, 0);
  assert.equal(Number((h.db.prepare("SELECT count(*) AS c FROM tv_car_garage_time").get() as any).c), 0);
  // The tick is the only thing that spends.
  const ticked = h.call("POST /api/me/tv-car/time");
  assert.equal(ticked.status, 200);
  assert.ok(ticked.body.budget.used >= 1);
  assert.equal(ticked.body.message, formatTvCarRemaining(ticked.body.budget.remaining));
  // And a save tells the page where it now stands, so the lock lands on the
  // change that spends the last second rather than at the next tick.
  const saved = h.call("PATCH /api/me/tv-car", paint);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.appearance.bodyColor, "#123abc");
  assert.equal(saved.body.budget.locked, false);
});

test("out of time locks every way of changing the car, and only for today", (t) => {
  const h = harness(t);
  h.spend();
  for (const [route, body] of [
    ["PATCH /api/me/tv-car", paint],
    ["PUT /api/me/tv-car/skin", { skin: null }],
    ["DELETE /api/me/tv-car/skin", undefined],
    ["DELETE /api/me/tv-car/wrap", undefined],
  ] as const) {
    const result = h.call(route, body);
    assert.equal(result.status, 423, `${route} is locked`);
    // The message quotes THAT day's allowance, so this reads whatever the day
    // the test runs on is actually worth — 15 before 23 Sep, 3 from then on.
    assert.match(result.body.error, new RegExp(`${Math.round(tvCarDailySeconds(tvCarBudgetDay(Date.now())) / 60)} minutes in the garage today`));
    assert.equal(result.body.budget.locked, true);
  }
  // Nothing was written by any of them.
  assert.equal(Number((h.db.prepare("SELECT count(*) AS c FROM tv_car_preferences").get() as any).c), 0);
  assert.equal(Number((h.db.prepare("SELECT count(*) AS c FROM tv_car_skins").get() as any).c), 0);
  // The car is still readable, and still races: locked means read-only, not
  // gone.
  const opened = h.call("GET /api/me/tv-car");
  assert.equal(opened.status, 200);
  assert.equal(opened.body.appearance.bodyColor.length, 7);
  assert.equal(opened.body.budget.locked, true);
  // Tomorrow is a different row, so the lock lifts on its own.
  h.db.prepare("UPDATE tv_car_garage_time SET day='1999-01-01'").run();
  assert.equal(h.call("PATCH /api/me/tv-car", paint).status, 200);
});

test("one person running out does not lock anybody else, or any other org", (t) => {
  const h = harness(t);
  h.spend();
  assert.equal(readTvCarBudget(h.db, owner as any).locked, true);
  assert.equal(readTvCarBudget(h.db, { ...owner, id: 9, org_id: 2 } as any).locked, false);
  assert.equal(readTvCarBudget(h.db, { ...owner, id: 8 } as any).locked, false);
});
