import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import Database from "better-sqlite3";
import { registerTvCarRoutes, parseStoredTvCarSkin, readTvCarSkinsForOrg } from "../server/tv-car-routes";
import { validateTvCarSkin } from "../shared/tv-car-skin";
import { defaultTvCarAppearance } from "../shared/tv-car";

const panels = ["top", "left", "right", "nose", "rear", "wings"] as const;
const skin = (pixel = "a") => ({
  version: 1,
  palette: Array.from({ length: 16 }, (_, i) => i === 0 ? "#ABCDEF" : `#${i.toString(16).repeat(6)}`),
  panels: Object.fromEntries(panels.map(panel => [panel, `${pixel}${".".repeat(511)}`])),
});
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function harness(t: TestContext) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec("ATTACH DATABASE ':memory:' AS lapfiles");
  const source = read("server/storage.ts");
  for (const table of ["tv_car_preferences", "tv_car_wraps", "tv_car_skins", "lapfiles.tv_car_wrap_blobs"]) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace(".", "\\.")} \\([\\s\\S]*?\\)\\\``));
    assert.ok(ddl, `production DDL exists for ${table}`);
    db.exec(ddl[0].slice(0, -1));
    db.exec(ddl[0].slice(0, -1));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, name TEXT, role TEXT,
    is_clr INTEGER, is_active INTEGER, portal TEXT, archived_at TEXT);
    INSERT INTO users (id,org_id,name,role,is_clr,is_active,portal) VALUES (1,1,'Ethan Wood','admin',0,1,NULL),
      (7,1,'Taylor','assistant',1,1,NULL), (8,1,'Sam','assistant',1,1,'c3'),
      (9,2,'Morgan','assistant',1,1,NULL), (10,1,'Other Admin','admin',0,1,NULL),
      (11,1,'External','assistant',1,1,'lap'), (12,1,'Inactive','assistant',1,0,NULL),
      (13,1,'Working Admin','admin',1,1,NULL), (14,1,'LO','assistant',1,1,'lop');`);
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use((req: any, _res, next) => {
    const userId = Number(req.headers["x-test-user"]);
    if (userId) req.session_user = { userId, orgId: Number(req.headers["x-test-org"] ?? 1), portal: req.headers["x-test-portal"] ?? null };
    next();
  });
  const audits: any[] = [];
  registerTvCarRoutes(app, {
    requireAuth: (req: any, res, next) => req.session_user ? next() : res.status(401).json({ error: "Unauthorized" }),
    db: () => db, sessionFor: (req: any) => req.session_user, audit: entry => audits.push(entry),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  async function request(path: string, method = "GET", body?: unknown, userId = 7, orgId = 1, portal?: string) {
    const response = await fetch(`${origin}${path}`, { method, headers: {
      "Content-Type": "application/json", "x-test-user": String(userId), "x-test-org": String(orgId),
      ...(portal ? { "x-test-portal": portal } : {}), Connection: "close",
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  }
  const count = () => Number((db.prepare("SELECT COUNT(*) AS n FROM tv_car_skins").get() as any).n);
  return { db, request, audits, count };
}

test("skin metadata schema is additive, idempotent, small and separate from photo bytes", async t => {
  const h = await harness(t);
  const schema = h.db.prepare("SELECT sql FROM sqlite_master WHERE name='tv_car_skins'").get() as any;
  assert.match(schema.sql, /PRIMARY KEY \(org_id, user_id\)/);
  assert.match(schema.sql, /length\(skin_json\) <= 8192/);
  assert.doesNotMatch(schema.sql, /BLOB/i);
  assert.throws(() => h.db.prepare("INSERT INTO tv_car_skins VALUES (1,7,?,'now')").run("x".repeat(8193)));
  assert.equal(h.count(), 0);
});

test("GET is read-only; PUT normalizes and persists one self-owned design, then updates it", async t => {
  const h = await harness(t);
  assert.deepEqual(await h.request("/api/me/tv-car"), { status: 200, body: { appearance: defaultTvCarAppearance(7) } });
  assert.equal(h.count(), 0); assert.deepEqual(h.audits, []);
  const first = await h.request("/api/me/tv-car/skin", "PUT", { skin: skin() });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.appearance.skin, validateTvCarSkin(skin()));
  assert.deepEqual((await h.request("/api/me/tv-car")).body.appearance, first.body.appearance);
  assert.equal(h.count(), 1);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].owner.id, 7);
  assert.equal(h.audits[0].before.skin, undefined);
  assert.deepEqual(h.audits[0].after.skin, first.body.appearance.skin);
  const row = h.db.prepare("SELECT * FROM tv_car_skins").get() as any;
  assert.equal(row.org_id, 1); assert.equal(row.user_id, 7);
  assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(JSON.parse(row.skin_json), first.body.appearance.skin);
  const next = await h.request("/api/me/tv-car/skin", "PUT", { skin: skin("f") });
  assert.equal(next.status, 200); assert.equal(h.count(), 1);
  assert.equal(next.body.appearance.skin.panels.top[0], "f");
  assert.equal((await h.request("/api/me/tv-car", "GET", undefined, 8)).body.appearance.skin, undefined);
});

test("skin writes reject unknown envelope fields, ownership, malformed panels and unbounded data", async t => {
  const h = await harness(t);
  const valid = skin();
  const invalids: unknown[] = [
    {}, [], null, { skin: null }, valid, { skin: valid, userId: 8 }, { skin: valid, orgId: 2 },
    { skin: valid, imageUrl: "https://example.invalid/x.png" },
    { skin: { ...valid, ownerId: 7 } }, { skin: { ...valid, version: 2 } },
    { skin: { ...valid, palette: valid.palette.slice(1) } },
    { skin: { ...valid, palette: [...valid.palette, "#ffffff"] } },
    { skin: { ...valid, palette: ["url(javascript:bad)", ...valid.palette.slice(1)] } },
    { skin: { ...valid, panels: { ...valid.panels, top: ".".repeat(511) } } },
    { skin: { ...valid, panels: { ...valid.panels, top: ".".repeat(513) } } },
    { skin: { ...valid, panels: { ...valid.panels, top: "z".repeat(512) } } },
    { skin: { ...valid, panels: { ...valid.panels, wheels: ".".repeat(512) } } },
    { skin: { ...valid, panels: { top: ".".repeat(512) } } },
  ];
  for (const body of invalids) {
    // Express's strict JSON parser rejects bare null before the route.
    if (body === null) continue;
    assert.equal((await h.request("/api/me/tv-car/skin", "PUT", body)).status, 400, JSON.stringify(body).slice(0, 150));
  }
  assert.equal(h.count(), 0); assert.deepEqual(h.audits, []);
});

test("all skin mutations remain session-owned, org-scoped and barred to inactive/outside accounts", async t => {
  const h = await harness(t);
  for (const method of ["PUT", "DELETE"]) {
    const body = method === "PUT" ? { skin: skin() } : undefined;
    for (const id of [0, 9, 10, 11, 12, 14]) {
      assert.equal((await h.request("/api/me/tv-car/skin", method, body, id)).status, id === 0 ? 401 : 403);
    }
    assert.equal((await h.request("/api/me/tv-car/skin", method, body, 7, 2)).status, 403);
    for (const portal of ["lap", "lop", "unknown"]) {
      assert.equal((await h.request("/api/me/tv-car/skin", method, body, 7, 1, portal)).status, 403);
    }
  }
  assert.equal(h.count(), 0);
  assert.equal((await h.request("/api/me/tv-car/skin?userId=8&orgId=2", "PUT", { skin: skin() })).status, 200);
  assert.deepEqual(h.db.prepare("SELECT org_id,user_id FROM tv_car_skins").all(), [{ org_id: 1, user_id: 7 }]);
});

test("Ethan and CLR admins can save only their own skins without changing account roles", async t => {
  const h = await harness(t);
  for (const id of [1,13]) {
    assert.equal((await h.request("/api/me/tv-car/skin", "PUT", { skin: skin() }, id)).status, 200);
    assert.equal((await h.request("/api/me/tv-car", "GET", undefined, id)).body.appearance.skin.version, 1);
  }
  assert.deepEqual(h.db.prepare("SELECT role,is_clr FROM users WHERE id=1").get(), { role: "admin", is_clr: 0 });
  assert.equal((await h.request("/api/me/tv-car/skin", "PUT", { skin: skin() }, 10)).status, 403);
});

test("fresh database eligibility revokes skin reads and writes despite an older signed session", async t => {
  const h = await harness(t);
  await h.request("/api/me/tv-car/skin", "PUT", { skin: skin() });
  for (const update of ["is_active=0", "role='viewer'", "role='admin',is_clr=0", "portal='lap'", "org_id=2"]) {
    h.db.exec(`UPDATE users SET ${update} WHERE id=7`);
    assert.equal((await h.request("/api/me/tv-car")).status, 403);
    assert.equal((await h.request("/api/me/tv-car/skin", "PUT", { skin: skin("f") })).status, 403);
    assert.equal((await h.request("/api/me/tv-car/skin", "DELETE")).status, 403);
    h.db.exec("UPDATE users SET is_active=1,role='assistant',is_clr=1,portal=NULL,org_id=1 WHERE id=7");
  }
  assert.equal(h.count(), 1);
  assert.equal(h.audits.length, 1);
});

test("skin removal restores existing paint/photo; changing paint never erases a skin", async t => {
  const h = await harness(t);
  const photoVersion = "a".repeat(64);
  h.db.prepare("INSERT INTO tv_car_wraps VALUES (1,7,?,4,1,1,'now')").run(photoVersion);
  h.db.prepare("INSERT INTO lapfiles.tv_car_wrap_blobs VALUES (1,7,?,?)").run(photoVersion, Buffer.from("kept"));
  const color = { bodyColor: "#123456", accentColor: "#abcdef", livery: "solid" };
  await h.request("/api/me/tv-car", "PATCH", color);
  const saved = await h.request("/api/me/tv-car/skin", "PUT", { skin: skin() });
  assert.equal(saved.body.appearance.wrapUrl, `/api/me/tv-car/wrap?v=${photoVersion}`);
  const repaint = await h.request("/api/me/tv-car", "PATCH", { ...color, bodyColor: "#abcdef" });
  assert.deepEqual(repaint.body.appearance.skin, validateTvCarSkin(skin()));
  const removed = await h.request("/api/me/tv-car/skin", "DELETE");
  assert.equal(removed.status, 200);
  assert.equal(removed.body.appearance.skin, undefined);
  assert.equal(removed.body.appearance.bodyColor, "#abcdef");
  assert.equal(removed.body.appearance.wrapUrl, saved.body.appearance.wrapUrl);
  assert.equal(h.count(), 0);
  assert.deepEqual((h.db.prepare("SELECT data FROM lapfiles.tv_car_wrap_blobs").get() as any).data, Buffer.from("kept"));
  assert.equal((await h.request("/api/me/tv-car/skin", "DELETE")).status, 200, "removal is idempotent");
});

test("corrupt stored skin is safely omitted; TV feed skin map is organization-scoped and normalized", async t => {
  const h = await harness(t);
  h.db.prepare("INSERT INTO tv_car_skins VALUES (1,7,?,'now')").run("{bad json");
  h.db.prepare("INSERT INTO tv_car_skins VALUES (1,8,?,'now')").run(JSON.stringify(skin()));
  h.db.prepare("INSERT INTO tv_car_skins VALUES (2,9,?,'now')").run(JSON.stringify(skin("f")));
  assert.equal((await h.request("/api/me/tv-car")).body.appearance.skin, undefined);
  assert.equal(h.count(), 3, "read fallback never silently rewrites data");
  assert.deepEqual([...readTvCarSkinsForOrg(h.db, 1)], [[8, validateTvCarSkin(skin())]]);
  assert.deepEqual([...readTvCarSkinsForOrg(h.db, 2)], [[9, validateTvCarSkin(skin("f"))]]);
  assert.equal(parseStoredTvCarSkin("x".repeat(8193)), null);
  assert.equal(parseStoredTvCarSkin(JSON.stringify({ ...skin(), panels: {} })), null);
  const routes = read("server/routes.ts");
  const feed = routes.slice(routes.indexOf('app.get("/api/tv/:token/feed"'), routes.indexOf('app.get("/api/tv/:token/pages"'));
  assert.match(feed, /const carSkins = readTvCarSkinsForOrg\(sqlite, orgId\)/);
  assert.match(feed, /skin: carSkins\.get\(Number\(c\.id\)\)/);
  assert.match(feed, /const racePeople = raceParticipants\.map\(personStats\)/);
  assert.match(feed, /scorecard: \{\s*people: people\.map/);
});

test("TV skin serialization follows current C3 race eligibility without altering retained skins or roles", async t => {
  const h = await harness(t);
  for (const id of [1,7,10,11,12,13,14,999]) {
    h.db.prepare("INSERT INTO tv_car_skins VALUES (1,?,?,'now')").run(id, JSON.stringify(skin()));
  }
  assert.deepEqual([...readTvCarSkinsForOrg(h.db, 1).keys()].sort((a,b) => a-b), [1,7,13]);
  for (const update of ["is_active=0", "archived_at='2026-09-15'", "portal='lap'", "portal='lop'", "portal='unknown'", "role='viewer'", "role='admin',is_clr=0", "org_id=2"]) {
    h.db.exec(`UPDATE users SET ${update} WHERE id=7`);
    assert.equal(readTvCarSkinsForOrg(h.db, 1).has(7), false, update);
    h.db.exec("UPDATE users SET is_active=1,archived_at=NULL,portal=NULL,role='assistant',is_clr=1,org_id=1 WHERE id=7");
  }
  assert.equal(h.count(), 8, "display filtering must not delete saved skins");
  assert.deepEqual(h.db.prepare("SELECT role,is_clr FROM users WHERE id=1").get(), { role: "admin", is_clr: 0 });
  assert.equal(h.audits.length, 0, "read-only display checks never mutate accounts");
});
