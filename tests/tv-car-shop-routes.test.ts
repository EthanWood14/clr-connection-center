import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import Database from "better-sqlite3";
import { registerTvCarRoutes } from "../server/tv-car-routes";
import { GARAGE_PLUS_5_ITEM_ID, shopItemById } from "../shared/tv-car-shop";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function harness(t: TestContext, transferCredit = 100) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec("ATTACH DATABASE ':memory:' AS lapfiles");
  const source = read("server/storage.ts");
  for (const table of [
    "tv_car_preferences", "tv_car_wraps", "tv_car_skins", "tv_car_garage_time",
    "tv_car_shop_purchases", "lapfiles.tv_car_wrap_blobs",
  ]) {
    const ddl = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace(".", "\\.")} \\([\\s\\S]*?\\)\\\``));
    assert.ok(ddl, `production DDL exists for ${table}`);
    db.exec(ddl[0].slice(0, -1));
  }
  db.exec(`CREATE TABLE dialpad_daily_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER, stat_date TEXT, agent_key TEXT,
    agent_name TEXT, user_id INTEGER, calls INTEGER, synced_at TEXT
  );
  CREATE TABLE callsync_agent_activity_daily (
    org_id INTEGER, assistant_id INTEGER, activity_date TEXT, active_seconds INTEGER
  );
  CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, name TEXT, role TEXT,
    is_clr INTEGER, is_active INTEGER, portal TEXT, archived_at TEXT);
  INSERT INTO users (id,org_id,name,role,is_clr,is_active,portal) VALUES
    (7,1,'Taylor','assistant',1,1,NULL);`);
  // Seed enough Dialpad + CallTools for catalog purchases.
  db.prepare(`INSERT INTO dialpad_daily_stats (org_id,stat_date,agent_key,agent_name,user_id,calls,synced_at)
    VALUES (1,'2026-09-01','taylor','Taylor',7,400,'now')`).run();
  db.prepare(`INSERT INTO callsync_agent_activity_daily (org_id,assistant_id,activity_date,active_seconds)
    VALUES (1,7,'2026-09-01',20000)`).run();

  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use((req: any, _res, next) => {
    const userId = Number(req.headers["x-test-user"]);
    if (userId) req.session_user = { userId, orgId: Number(req.headers["x-test-org"] ?? 1), portal: req.headers["x-test-portal"] ?? null };
    next();
  });
  registerTvCarRoutes(app, {
    requireAuth: (req: any, res, next) => req.session_user ? next() : res.status(401).json({ error: "Unauthorized" }),
    db: () => db,
    sessionFor: (req: any) => req.session_user,
    transferCreditFor: () => transferCredit,
    audit: () => {},
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-test-user": "7", "x-test-org": "1", Connection: "close" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  return { db, request };
}

test("shop schema is additive and keyed so a person cannot own the same item twice", async t => {
  const { db } = await harness(t);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='tv_car_shop_purchases'").get() as any;
  assert.match(schema.sql, /PRIMARY KEY \(org_id, user_id, item_id\)/);
  assert.match(schema.sql, /transfers/);
  assert.match(schema.sql, /dialpad_calls/);
  assert.match(schema.sql, /calltools_seconds/);
});

test("GET shop reports balances from existing stats and marks affordability", async t => {
  const { request } = await harness(t, 50);
  const res = await request("/api/me/tv-car/shop");
  assert.equal(res.status, 200);
  assert.equal(res.body.balances.transfers, 50);
  assert.equal(res.body.balances.dialpad_calls, 400);
  assert.equal(res.body.balances.calltools_seconds, 20000);
  const gold = res.body.catalog.find((i: any) => i.id === "gold-rain-light");
  assert.equal(gold.owned, false);
  assert.equal(gold.affordable, true);
  assert.ok(gold.priceLabel.includes("transfer"));
});

test("buying charges once, is idempotent, and attaches upgrades to the car", async t => {
  const { db, request } = await harness(t, 50);
  const item = shopItemById("gold-rain-light")!;
  const first = await request("/api/me/tv-car/shop/buy", "POST", { itemId: item.id });
  assert.equal(first.status, 200);
  assert.equal(first.body.inserted, true);
  assert.equal(first.body.alreadyOwned, false);
  assert.deepEqual(first.body.appearance.upgrades, [item.id]);
  assert.equal(first.body.shop.balances.transfers, 50 - item.price);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM tv_car_shop_purchases").get().n), 1);

  const second = await request("/api/me/tv-car/shop/buy", "POST", { itemId: item.id });
  assert.equal(second.status, 200);
  assert.equal(second.body.inserted, false);
  assert.equal(second.body.alreadyOwned, true);
  assert.equal(second.body.shop.balances.transfers, 50 - item.price, "no second charge");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM tv_car_shop_purchases").get().n), 1);

  const car = await request("/api/me/tv-car");
  assert.deepEqual(car.body.appearance.upgrades, [item.id]);
});

test("insufficient funds refuse without writing a purchase row", async t => {
  const { db, request } = await harness(t, 0);
  const item = shopItemById("trophy-fin")!;
  const res = await request("/api/me/tv-car/shop/buy", "POST", { itemId: item.id });
  assert.equal(res.status, 402);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM tv_car_shop_purchases").get().n), 0);
});

test("garage +5 purchase raises the daily budget without unlocking edit time retroactively beyond the new cap", async t => {
  const { request } = await harness(t, 50);
  const buy = await request("/api/me/tv-car/shop/buy", "POST", { itemId: GARAGE_PLUS_5_ITEM_ID });
  assert.equal(buy.status, 200);
  assert.equal(buy.body.inserted, true);
  assert.equal(buy.body.budget.remaining, 20 * 60);
  assert.equal(buy.body.shop.garageDailySeconds, 20 * 60);
});
