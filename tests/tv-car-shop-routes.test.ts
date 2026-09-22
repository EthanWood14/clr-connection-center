import { migrateShopTextCurrency } from "../server/tv-car-shop-schema";
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
  migrateShopTextCurrency(db);
  db.exec(`CREATE TABLE daily_call_logs (org_id INTEGER, assistant_id INTEGER, log_date TEXT, calls_made INTEGER);
    CREATE TABLE eod_reports (assistant_id INTEGER, report_date TEXT, messages_sent INTEGER);
    CREATE TABLE bonzo_call_events (org_id INTEGER, user_id INTEGER, business_date TEXT, prospect_id INTEGER, occurred_at TEXT, counts INTEGER);
    CREATE TABLE dialpad_sms_events (org_id INTEGER, user_id INTEGER, agent_key TEXT, message_date TEXT);
    CREATE TABLE dialpad_agent_links (org_id INTEGER, agent_key TEXT, user_id INTEGER);
    CREATE TABLE callsync_activity_events (org_id INTEGER, assistant_id INTEGER, call_id TEXT, external_event_id TEXT);`);
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
    VALUES (1,'2026-09-15','taylor','Taylor',7,5000,'now')`).run();
  db.prepare(`INSERT INTO callsync_agent_activity_daily (org_id,assistant_id,activity_date,active_seconds)
    VALUES (1,7,'2026-09-15',200000)`).run();

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

test("all-time balances include historical logs and provider activity without double-counting or crossing owners", async t => {
  const {db,request} = await harness(t, 501.5);
  db.exec(`INSERT INTO daily_call_logs VALUES (1,7,'2024-01-01',240),(1,7,'2026-09-16',99999),(2,7,'2024-01-01',99999),(1,8,'2024-01-01',99999);
    INSERT INTO eod_reports VALUES (7,'2024-01-01',900),(7,'2026-09-16',99999);
    INSERT INTO dialpad_agent_links VALUES (1,'taylor',7),(2,'other',7);
    INSERT INTO dialpad_sms_events VALUES (1,7,'taylor','2026-09-15'),(1,NULL,'taylor','2026-09-16'),(2,7,'other','2026-09-16'),(1,8,'other','2026-09-16'),(1,7,'taylor','2024-01-01');
    INSERT INTO bonzo_call_events VALUES (1,7,'2026-09-16',100,'2026-09-16T10:00:01',1),(1,7,'2026-09-16',100,'2026-09-16T10:00:02',1);
    INSERT INTO callsync_activity_events VALUES (1,7,'call-1','event-1'),(1,7,'call-1','event-2'),(2,7,'call-2','event-3');
    INSERT INTO callsync_agent_activity_daily VALUES (1,7,'2024-01-01',3600),(2,7,'2024-01-01',99999),(1,8,'2024-01-01',99999);`);
  const res = await request('/api/me/tv-car/shop');
  assert.equal(res.status,200);
  assert.deepEqual(res.body.earned,{transfers:501.5,texts:902,dialpad_calls:5242,calltools_seconds:203600});
  const buy = await request('/api/me/tv-car/shop/buy','POST',{itemId:'ion-cabin',userId:8,orgId:2,price:0});
  assert.equal(buy.status,200);
  assert.equal(buy.body.shop.balances.texts,202);
  assert.equal(buy.body.shop.earned.texts,902);
  assert.deepEqual(buy.body.appearance.upgrades,['ion-cabin']);
  const duplicate = await request('/api/me/tv-car/shop/buy','POST',{itemId:'ion-cabin'});
  assert.equal(duplicate.body.shop.balances.texts,202);
  const denied = await request('/api/me/tv-car/shop/buy','POST',{itemId:'laser-headlights'});
  assert.equal(denied.status,402);
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM tv_car_shop_purchases').get().n),1);
  const transfer = await request('/api/me/tv-car/shop/buy','POST',{itemId:'solar-fin'});
  assert.equal(transfer.body.shop.balances.transfers,51.5);
});

test("currency migration retains old receipts, remains idempotent, and permits text purchases", () => {
  const db = new Database(':memory:');
  try {
    const source=read('server/storage.ts');
    for(const table of ['tv_car_shop_purchases','tv_car_shop_consumable_purchases']) {
      const ddl=source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\)\\\``))!;
      db.exec(ddl[0].slice(0,-1));
    }
    db.exec(`INSERT INTO tv_car_shop_purchases VALUES (1,7,'chrome-rims','dialpad_calls',800,'old');
      INSERT INTO tv_car_shop_consumable_purchases VALUES (12,1,7,'garage-plus-5','calltools_seconds',18000,300,'2026-09-20','old');`);
    migrateShopTextCurrency(db); migrateShopTextCurrency(db);
    assert.equal(db.prepare('SELECT price FROM tv_car_shop_purchases').get().price,800);
    assert.equal(db.prepare('SELECT id FROM tv_car_shop_consumable_purchases').get().id,12);
    db.exec(`INSERT INTO tv_car_shop_purchases VALUES (1,7,'ion-cabin','texts',700,'new')`);
    assert.throws(()=>db.exec(`INSERT INTO tv_car_shop_purchases VALUES (1,7,'ion-cabin','texts',700,'new')`));
  } finally {db.close();}
});
