import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  defaultTvCarAppearance, normalizeTvCarAppearance, validateTvCarAppearance,
  TV_CAR_COLORS,
} from "../shared/tv-car";
import { canCustomizeTvCar, registerTvCarRoutes } from "../server/tv-car-routes";

const custom = { bodyColor: "#123ABC", accentColor: "#EE9900", livery: "double-stripe" };
const normalized = { bodyColor: "#123abc", accentColor: "#ee9900", livery: "double-stripe" };
const session = { userId: 7, orgId: 1, portal: null };
const owner = { id: 7, org_id: 1, name: "Taylor", role: "assistant", is_clr: 1, is_active: 1, portal: null };

test("car defaults preserve the current deterministic 12-color assignment", () => {
  for (let id = 0; id < 100; id++) {
    assert.deepEqual(defaultTvCarAppearance(id), {
      bodyColor: TV_CAR_COLORS[id % 12], accentColor: "#f4f2e8", livery: "stripe",
    });
  }
  for (const id of [NaN, Infinity, 1.2]) assert.equal(defaultTvCarAppearance(id).bodyColor, TV_CAR_COLORS[0]);
  const first = defaultTvCarAppearance(7);
  first.bodyColor = "#000000";
  assert.notEqual(defaultTvCarAppearance(7).bodyColor, first.bodyColor);
});

test("strict car saves normalize safe hex colors and accept only the three paint styles", () => {
  assert.deepEqual(validateTvCarAppearance(custom), normalized);
  for (const livery of ["solid", "stripe", "double-stripe"]) {
    assert.equal(validateTvCarAppearance({ ...custom, livery })?.livery, livery);
  }
});

test("car saves reject missing fields, ownership fields, CSS, and arbitrary livery text", () => {
  for (const raw of [
    null, undefined, [], "red", {}, { ...custom, id: 8 }, { ...custom, userId: 8 },
    { ...custom, orgId: 2 }, { ...custom, name: "Other CLR" }, { appearance: custom },
    { bodyColor: "#123abc", livery: "solid" }, { ...custom, bodyColor: "red" },
    { ...custom, bodyColor: "#fff" }, { ...custom, bodyColor: "#12345678" },
    { ...custom, bodyColor: " #123abc" }, { ...custom, accentColor: "url(https://example.invalid)" },
    { ...custom, livery: "<script>" }, { ...custom, livery: "Stripe" },
  ]) assert.equal(validateTvCarAppearance(raw), null, JSON.stringify(raw));
});

test("stored absent or invalid appearance values fall back safely without losing valid choices", () => {
  assert.deepEqual(normalizeTvCarAppearance(null, 7), defaultTvCarAppearance(7));
  assert.deepEqual(normalizeTvCarAppearance([], 7), defaultTvCarAppearance(7));
  assert.deepEqual(normalizeTvCarAppearance({ bodyColor: "#ABCDEF", accentColor: "no", livery: "unknown", userId: 10 }, 7), {
    ...defaultTvCarAppearance(7), bodyColor: "#abcdef",
  });
});

test("car permissions require the current owner, organization, activity and actual CLR role", () => {
  assert.equal(canCustomizeTvCar(session, owner), true);
  assert.equal(canCustomizeTvCar(session, { ...owner, role: "admin", is_clr: 1 }), true);
  for (const changed of [
    null, { ...owner, id: 8 }, { ...owner, org_id: 2 }, { ...owner, is_active: 0 },
    { ...owner, role: "viewer" }, { ...owner, role: "manager" },
    { ...owner, role: "admin", is_clr: 0 }, { ...owner, portal: "lap" },
    { ...owner, portal: "lop" }, { ...owner, portal: "unknown" },
  ]) assert.equal(canCustomizeTvCar(session, changed), false);
  for (const changed of [null, { ...session, userId: 8 }, { ...session, orgId: 2 },
    { ...session, portal: "lap" }, { ...session, portal: "lop" }, { ...session, portal: "unknown" },
    { ...session, orgId: 0 }, { ...session, userId: 0 },
  ]) assert.equal(canCustomizeTvCar(changed, owner), false);
});

function harness(t: TestContext) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  const source = readFileSync(new URL("../server/storage.ts", import.meta.url), "utf8");
  for (const table of ["tv_car_preferences", "tv_car_wraps"]) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\)\\\``));
    assert.ok(ddl, "production startup initializes the preference tables");
    db.exec(ddl[0].slice(0, -1));
    // Production schema is idempotent on startup.
    db.exec(ddl[0].slice(0, -1));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, name TEXT, role TEXT,
    is_clr INTEGER, is_active INTEGER, portal TEXT);
    INSERT INTO users VALUES (7,1,'Taylor','assistant',1,1,NULL),
      (8,1,'Sam','assistant',1,1,'c3'), (9,2,'Morgan','assistant',1,1,NULL);`);
  const routes = new Map<string, any[]>();
  const audits: any[] = [];
  const requireAuth = (req: any, res: any, next: () => void) =>
    req.session_user ? next() : res.status(401).json({ error: "Unauthorized" });
  registerTvCarRoutes({
    get(path: string, ...handlers: any[]) { routes.set(`GET ${path}`, handlers); },
    patch(path: string, ...handlers: any[]) { routes.set(`PATCH ${path}`, handlers); },
    post(path: string, ...handlers: any[]) { routes.set(`POST ${path}`, handlers); },
    delete(path: string, ...handlers: any[]) { routes.set(`DELETE ${path}`, handlers); },
  } as any, {
    requireAuth, db: () => db, sessionFor: req => req.session_user ?? null,
    audit: entry => audits.push(entry),
  });
  function call(method: string, body: any = undefined, actor: any = session) {
    const result: any = { status: 200, body: null };
    const res: any = { status(n: number) { result.status = n; return res; }, json(value: any) { result.body = value; return res; } };
    const handlers = routes.get(`${method} /api/me/tv-car`)!;
    let i = 0;
    const next = () => handlers[i++]?.({ body, session_user: actor }, res, next);
    next();
    return result;
  }
  const count = () => Number((db.prepare("SELECT count(*) AS c FROM tv_car_preferences").get() as any).c);
  return { db, routes, call, audits, count };
}

test("GET returns defaults and does not create a preference or audit row", (t) => {
  const h = harness(t);
  assert.deepEqual(h.call("GET"), { status: 200, body: { appearance: defaultTvCarAppearance(7) } });
  assert.equal(h.count(), 0);
  assert.deepEqual(h.audits, []);
  assert.deepEqual([...h.routes.keys()], ["GET /api/me/tv-car", "PATCH /api/me/tv-car",
    "POST /api/me/tv-car/wrap", "DELETE /api/me/tv-car/wrap", "GET /api/me/tv-car/wrap", "GET /api/tv/:token/cars/:userId/wrap"]);
});

test("PATCH persists only this CLR's appearance, rereads it, and audits safe before/after fields", (t) => {
  const h = harness(t);
  assert.deepEqual(h.call("PATCH", custom), { status: 200, body: { appearance: normalized } });
  assert.deepEqual(h.call("GET").body.appearance, normalized);
  assert.equal(h.count(), 1);
  assert.deepEqual(h.audits[0], { owner, before: defaultTvCarAppearance(7), after: normalized });
  assert.deepEqual(h.call("GET", undefined, { ...session, userId: 8 }).body.appearance, defaultTvCarAppearance(8));
  assert.deepEqual(h.call("GET", undefined, { ...session, userId: 9, orgId: 2 }).body.appearance, defaultTvCarAppearance(9));
  const updated = { bodyColor: "#000001", accentColor: "#ffffff", livery: "solid" };
  assert.deepEqual(h.call("PATCH", updated).body.appearance, updated);
  assert.equal(h.count(), 1, "saving again updates, rather than duplicates, the same preference");
  assert.equal(h.audits.length, 2);
  const row = h.db.prepare("SELECT * FROM tv_car_preferences").get() as any;
  assert.equal(row.org_id, 1);
  assert.equal(row.user_id, 7);
  assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("PATCH cannot choose another user or organization through request fields", (t) => {
  const h = harness(t);
  for (const body of [{ ...custom, userId: 8 }, { ...custom, orgId: 2 }, { ...custom, id: 9 }]) {
    assert.equal(h.call("PATCH", body).status, 400);
  }
  assert.equal(h.count(), 0);
  assert.equal(h.audits.length, 0);
});

test("both routes reject missing sessions, cross-org impersonation and portal sessions", (t) => {
  const h = harness(t);
  for (const method of ["GET", "PATCH"]) {
    assert.equal(h.call(method, custom, null).status, 401);
    for (const actor of [{ ...session, orgId: 2 }, { ...session, userId: 9 },
      { ...session, portal: "lap" }, { ...session, portal: "lop" }]) {
      assert.equal(h.call(method, custom, actor).status, 403);
    }
  }
  assert.equal(h.count(), 0);
});

test("both routes recheck current DB eligibility even when the signed session is older", (t) => {
  const h = harness(t);
  for (const update of ["is_active=0", "role='viewer'", "role='admin',is_clr=0", "portal='lap'", "org_id=2"]) {
    h.db.prepare("UPDATE users SET is_active=1,role='assistant',is_clr=1,portal=NULL,org_id=1 WHERE id=7").run();
    h.db.exec(`UPDATE users SET ${update} WHERE id=7`);
    assert.equal(h.call("GET").status, 403, update);
    assert.equal(h.call("PATCH", custom).status, 403, update);
  }
  assert.equal(h.count(), 0);
  assert.equal(h.audits.length, 0);
});

test("stored bad colors are never returned as unsafe CSS", (t) => {
  const h = harness(t);
  h.db.prepare("INSERT INTO tv_car_preferences VALUES (1,7,?,?,?,?)")
    .run("url(javascript:bad)", "#ABCDEF", "solid", "2026-09-15T00:00:00.000Z");
  assert.deepEqual(h.call("GET").body.appearance, {
    ...defaultTvCarAppearance(7), accentColor: "#abcdef", livery: "solid",
  });
});
