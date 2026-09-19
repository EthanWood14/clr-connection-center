import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import Database from "better-sqlite3";
import { registerTvCarRoutes } from "../server/tv-car-routes";
import { GARAGE_PLUS_5_ITEM_ID, GARAGE_PLUS_5_SECONDS, shopItemById } from "../shared/tv-car-shop";
import { TV_CAR_DAILY_SECONDS } from "../shared/tv-car-budget";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function harness(t: TestContext, transferCredit = 500) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec("ATTACH DATABASE ':memory:' AS lapfiles");
  const source = read("server/storage.ts");
  for (const table of [
    "tv_car_preferences", "tv_car_wraps", "tv_car_skins", "tv_car_garage_time",
    "tv_car_shop_purchases", "tv_car_shop_consumable_purchases", "lapfiles.tv_car_wrap_blobs",
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
  // Seed enough Dialpad + CallTools for expensive catalog purchases.
  db.prepare(`INSERT INTO dialpad_daily_stats (org_id,stat_date,agent_key,agent_name,user_id,calls,synced_at)
    VALUES (1,'2026-09-01','taylor','Taylor',7,5000,'now')`).run();
  db.prepare(`INSERT INTO callsync_agent_activity_daily (org_id,assistant_id,activity_date,active_seconds)
    VALUES (1,7,'2026-09-01',200000)`).run();

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

test("shop schema is additive and keyed so a person cannot own the same cosmetic twice", async t => {
  const { db } = await harness(t);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='tv_car_shop_purchases'").get() as any;
  assert.match(schema.sql, /PRIMARY KEY \(org_id, user_id, item_id\)/);
  assert.match(schema.sql, /transfers/);
  const consumable = db.prepare("SELECT sql FROM sqlite_master WHERE name='tv_car_shop_consumable_purchases'").get() as any;
  assert.match(consumable.sql, /AUTOINCREMENT/);
  assert.match(consumable.sql, /effect_seconds/);
  const garage = db.prepare("SELECT sql FROM sqlite_master WHERE name='tv_car_garage_time'").get() as any;
  assert.match(garage.sql, /bonus_seconds/);
});

test("GET shop reports balances, previews, and marks affordability", async t => {
  const { request } = await harness(t, 200);
  const res = await request("/api/me/tv-car/shop");
  assert.equal(res.status, 200);
  assert.equal(res.body.balances.transfers, 200);
  assert.equal(res.body.balances.dialpad_calls, 5000);
  assert.equal(res.body.balances.calltools_seconds, 200000);
  assert.ok(res.body.catalog.length >= 10);
  const gold = res.body.catalog.find((i: any) => i.id === "gold-rain-light");
  assert.equal(gold.owned, false);
  assert.equal(gold.affordable, true);
  assert.ok(gold.priceLabel.includes("transfer"));
  assert.ok(gold.preview?.motif);
  const boost = res.body.catalog.find((i: any) => i.id === GARAGE_PLUS_5_ITEM_ID);
  assert.equal(boost.consumable, true);
  assert.equal(boost.owned, false);
});

test("buying cosmetics charges once, is idempotent, and attaches upgrades to the car", async t => {
  const { db, request } = await harness(t, 200);
  const item = shopItemById("gold-rain-light")!;
  const first = await request("/api/me/tv-car/shop/buy", "POST", { itemId: item.id });
  assert.equal(first.status, 200);
  assert.equal(first.body.inserted, true);
  assert.equal(first.body.alreadyOwned, false);
  assert.deepEqual(first.body.appearance.upgrades, [item.id]);
  assert.equal(first.body.shop.balances.transfers, 200 - item.price);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM tv_car_shop_purchases").get().n), 1);

  const second = await request("/api/me/tv-car/shop/buy", "POST", { itemId: item.id });
  assert.equal(second.status, 200);
  assert.equal(second.body.inserted, false);
  assert.equal(second.body.alreadyOwned, true);
  assert.equal(second.body.shop.balances.transfers, 200 - item.price, "no second charge");
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

test("garage boost is a one-time today-only grant and can be rebought", async t => {
  const { db, request } = await harness(t, 200);
  const buy = await request("/api/me/tv-car/shop/buy", "POST", { itemId: GARAGE_PLUS_5_ITEM_ID });
  assert.equal(buy.status, 200);
  assert.equal(buy.body.inserted, true);
  assert.equal(buy.body.budget.remaining, TV_CAR_DAILY_SECONDS + GARAGE_PLUS_5_SECONDS);
  assert.equal(buy.body.shop.garageDailySeconds, TV_CAR_DAILY_SECONDS + GARAGE_PLUS_5_SECONDS);
  assert.equal(buy.body.appearance.upgrades?.includes?.(GARAGE_PLUS_5_ITEM_ID) ?? false, false);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM tv_car_shop_consumable_purchases").get().n), 1);
  assert.equal(Number(db.prepare("SELECT bonus_seconds FROM tv_car_garage_time LIMIT 1").get().bonus_seconds), GARAGE_PLUS_5_SECONDS);

  // Permanent purchases table must not treat the boost as owned cosmetics.
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM tv_car_shop_purchases").get().n), 0);

  const again = await request("/api/me/tv-car/shop/buy", "POST", { itemId: GARAGE_PLUS_5_ITEM_ID });
  assert.equal(again.status, 200);
  assert.equal(again.body.inserted, true);
  assert.equal(again.body.budget.remaining, TV_CAR_DAILY_SECONDS + 2 * GARAGE_PLUS_5_SECONDS);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM tv_car_shop_consumable_purchases").get().n), 2);

  const shop = await request("/api/me/tv-car/shop");
  const boost = shop.body.catalog.find((i: any) => i.id === GARAGE_PLUS_5_ITEM_ID);
  assert.equal(boost.owned, false);
  assert.equal(boost.timesPurchased, 2);
});
