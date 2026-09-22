import { COUNTED_CALLS_SQL, COUNTED_MESSAGES_SQL } from "../shared/self-reported";
/**
 * Garage-shop persistence and earned-balance readers.
 *
 * Earned totals come from tables C3 already fills (Dialpad daily stats,
 * CallTools/CallSync activity, transfer credit). Spent totals come from
 * tv_car_shop_purchases (permanent cosmetics) plus
 * tv_car_shop_consumable_purchases (rebuyable garage boosts).
 * Nothing here writes to lead_outcomes or scoreboards.
 */

import {
  availableShopBalances,
  emptyShopBalances,
  evaluateShopPurchase,
  GARAGE_PLUS_5_ITEM_ID,
  GARAGE_PLUS_5_SECONDS,
  isConsumableShopItem,
  normalizeShopUpgrades,
  resolveShopEquipment,
  shopItemSlot,
  shopItemById,
  TV_CAR_SHOP_CATALOG,
  type ShopBalances,
  type ShopItem,
  type ShopCurrency,
} from "../shared/tv-car-shop";
import { TV_CAR_DAILY_SECONDS, tvCarBudgetDay } from "../shared/tv-car-budget";

export type ShopOwner = { id: number; org_id: number };

export type ShopSnapshot = {
  catalog: Array<ShopItem & {
    owned: boolean;
    equipped: boolean;
    affordable: boolean;
    priceLabel: string;
    timesPurchased: number;
    resale: { amount: number; currency: ShopCurrency; receipt: string } | null;
  }>;
  balances: ShopBalances;
  earned: ShopBalances;
  spent: ShopBalances;
  owned: string[];
  equipped: string[];
  /** Base daily garage seconds (15 min). Boosts are per-day, not permanent. */
  garageDailySeconds: number;
};

function floorNonNeg(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** All recorded history, using the same historical cutoff as C3 reports. */
export function readEarnedDialpadCalls(db: any, owner: ShopOwner): number {
  const row = db.prepare(`SELECT COALESCE(SUM(calls),0) AS n FROM ${COUNTED_CALLS_SQL}
    WHERE org_id=? AND assistant_id=?`).get(owner.org_id, owner.id);
  const calltools = db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(call_id,''),external_event_id)) AS n
    FROM callsync_activity_events WHERE org_id=? AND assistant_id=?`).get(owner.org_id, owner.id);
  return floorNonNeg(row?.n) + floorNonNeg(calltools?.n);
}

export function readEarnedTexts(db: any, owner: ShopOwner): number {
  const row = db.prepare(`SELECT COALESCE(SUM(messages),0) AS n FROM ${COUNTED_MESSAGES_SQL}
    WHERE org_id=? AND assistant_id=?`).get(owner.org_id, owner.id);
  return floorNonNeg(row?.n);
}

/** CallTools active / talk seconds from the daily CallSync rollup. */
export function readEarnedCalltoolsSeconds(db: any, owner: ShopOwner): number {
  try {
    const row = db.prepare(
      `SELECT COALESCE(SUM(active_seconds), 0) AS n FROM callsync_agent_activity_daily
        WHERE org_id = ? AND assistant_id = ?`,
    ).get(owner.org_id, owner.id);
    return floorNonNeg(row?.n);
  } catch {
    return 0;
  }
}

/** Permanent cosmetics only. Legacy garage-plus-5 rows are ignored for ownership. */
export function readOwnedShopItems(db: any, owner: ShopOwner): string[] {
  try {
    const rows = db.prepare(
      `SELECT item_id FROM tv_car_shop_purchases WHERE org_id = ? AND user_id = ? ORDER BY purchased_at ASC`,
    ).all(owner.org_id, owner.id) as Array<{ item_id: string }>;
    return normalizeShopUpgrades(rows.map((r) => r.item_id));
  } catch {
    return [];
  }
}

function addSpentRow(spent: ShopBalances, currency: string, n: unknown) {
  const key = currency as ShopCurrency;
  if (key in spent) spent[key] += floorNonNeg(n);
}

export function readSpentShopBalances(db: any, owner: ShopOwner): ShopBalances {
  const spent = emptyShopBalances();
  try {
    const rows = db.prepare(
      `SELECT currency, COALESCE(SUM(price), 0) AS n FROM tv_car_shop_purchases
        WHERE org_id = ? AND user_id = ? GROUP BY currency`,
    ).all(owner.org_id, owner.id) as Array<{ currency: string; n: number }>;
    for (const row of rows) addSpentRow(spent, row.currency, row.n);
  } catch { /* table may be mid-migrate in a test */ }
  try {
    const rows = db.prepare(
      `SELECT currency, COALESCE(SUM(price), 0) AS n FROM tv_car_shop_consumable_purchases
        WHERE org_id = ? AND user_id = ? GROUP BY currency`,
    ).all(owner.org_id, owner.id) as Array<{ currency: string; n: number }>;
    for (const row of rows) addSpentRow(spent, row.currency, row.n);
  } catch { /* optional table */ }
  const sales = db.prepare(`SELECT currency, SUM(price-refund) AS n FROM tv_car_shop_sales
    WHERE org_id=? AND user_id=? GROUP BY currency`).all(owner.org_id, owner.id);
  for (const row of sales) addSpentRow(spent, row.currency, row.n);
  return spent;
}

export function readConsumablePurchaseCounts(db: any, owner: ShopOwner): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const rows = db.prepare(
      `SELECT item_id, COUNT(*) AS n FROM tv_car_shop_consumable_purchases
        WHERE org_id = ? AND user_id = ? GROUP BY item_id`,
    ).all(owner.org_id, owner.id) as Array<{ item_id: string; n: number }>;
    for (const row of rows) out.set(String(row.item_id), floorNonNeg(row.n));
  } catch { /* optional */ }
  return out;
}

export function readEarnedShopBalances(
  db: any,
  owner: ShopOwner,
  transferCredit: number,
): ShopBalances {
  return {
    transfers: Number.isFinite(transferCredit) ? Math.max(0, transferCredit) : 0,
    texts: readEarnedTexts(db, owner),
    dialpad_calls: readEarnedDialpadCalls(db, owner),
    calltools_seconds: readEarnedCalltoolsSeconds(db, owner),
  };
}

/**
 * Add a one-time garage-time boost to today's Pacific day row.
 * Does not change the permanent daily base of 15 minutes.
 */
export function grantGarageTimeBoost(
  db: any,
  owner: ShopOwner,
  extraSeconds: number,
  nowMs = Date.now(),
): number {
  const day = tvCarBudgetDay(nowMs);
  const stamp = new Date(nowMs).toISOString();
  const add = Math.max(0, Math.floor(Number(extraSeconds) || 0));
  if (add <= 0) return 0;
  const row = db.prepare(
    `SELECT bonus_seconds FROM tv_car_garage_time WHERE org_id=? AND user_id=? AND day=?`,
  ).get(owner.org_id, owner.id, day) as { bonus_seconds?: number } | undefined;
  if (!row) {
    db.prepare(
      `INSERT INTO tv_car_garage_time (org_id,user_id,day,seconds,last_tick_at,bonus_seconds)
       VALUES (?,?,?,0,?,?)`,
    ).run(owner.org_id, owner.id, day, stamp, add);
    return add;
  }
  const next = floorNonNeg(row.bonus_seconds) + add;
  db.prepare(
    `UPDATE tv_car_garage_time SET bonus_seconds=? WHERE org_id=? AND user_id=? AND day=?`,
  ).run(next, owner.org_id, owner.id, day);
  return next;
}

export function readGarageDayBonusSeconds(db: any, owner: ShopOwner, nowMs = Date.now()): number {
  const day = tvCarBudgetDay(nowMs);
  try {
    const row = db.prepare(
      `SELECT bonus_seconds FROM tv_car_garage_time WHERE org_id=? AND user_id=? AND day=?`,
    ).get(owner.org_id, owner.id, day) as { bonus_seconds?: number } | undefined;
    return floorNonNeg(row?.bonus_seconds);
  } catch {
    return 0;
  }
}

export function buildShopSnapshot(
  db: any,
  owner: ShopOwner,
  transferCredit: number,
  formatPrice: (item: ShopItem) => string,
): ShopSnapshot {
  const owned = readOwnedShopItems(db, owner);
  const ownedSet = new Set(owned);
  const equipped = shopUpgradesForOwner(db, owner);
  const earned = readEarnedShopBalances(db, owner, transferCredit);
  const spent = readSpentShopBalances(db, owner);
  const balances = availableShopBalances(earned, spent);
  const consumableCounts = readConsumablePurchaseCounts(db, owner);
  const dayBonus = readGarageDayBonusSeconds(db, owner);
  const receipts = new Map<string, any>(db.prepare(`SELECT item_id,currency,price,purchased_at FROM tv_car_shop_purchases WHERE org_id=? AND user_id=?`).all(owner.org_id, owner.id).map((row: any) => [row.item_id, row]));
  return {
    catalog: TV_CAR_SHOP_CATALOG.map((item) => {
      const consumable = isConsumableShopItem(item);
      const permanentlyOwned = !consumable && ownedSet.has(item.id);
      return {
        ...item,
        owned: permanentlyOwned,
        resale: permanentlyOwned && receipts.has(item.id) ? { amount: Math.floor(receipts.get(item.id).price / 2), currency: receipts.get(item.id).currency, receipt: receipts.get(item.id).purchased_at } : null,
        equipped: equipped.includes(item.id),
        affordable: !permanentlyOwned && balances[item.currency] >= item.price,
        priceLabel: formatPrice(item),
        timesPurchased: consumable ? (consumableCounts.get(item.id) ?? 0) : (permanentlyOwned ? 1 : 0),
      };
    }),
    balances,
    earned,
    spent,
    owned,
    equipped,
    garageDailySeconds: TV_CAR_DAILY_SECONDS + dayBonus,
  };
}

/**
 * Buy one catalog item. Permanent cosmetics are idempotent. Consumable garage
 * boosts charge every time and grant today's bonus_seconds once per purchase.
 */
export function purchaseShopItem(
  db: any,
  owner: ShopOwner,
  itemId: unknown,
  transferCredit: number,
  formatPrice: (item: ShopItem) => string,
  nowIso = new Date().toISOString(),
  nowMs = Date.now(),
): { evaluation: ReturnType<typeof evaluateShopPurchase>; snapshot: ShopSnapshot; inserted: boolean } {
  const owned = readOwnedShopItems(db, owner);
  const earned = readEarnedShopBalances(db, owner, transferCredit);
  const spent = readSpentShopBalances(db, owner);
  const available = availableShopBalances(earned, spent);
  let evaluation = evaluateShopPurchase({ itemId, owned, available });
  let inserted = false;
  if (evaluation.status === "ok") {
    if (isConsumableShopItem(evaluation.item)) {
      const effectSeconds = evaluation.item.id === GARAGE_PLUS_5_ITEM_ID
        ? GARAGE_PLUS_5_SECONDS
        : GARAGE_PLUS_5_SECONDS;
      const day = tvCarBudgetDay(nowMs);
      const result = db.prepare(
        `INSERT INTO tv_car_shop_consumable_purchases
          (org_id, user_id, item_id, currency, price, effect_seconds, day, purchased_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        owner.org_id, owner.id, evaluation.item.id, evaluation.item.currency,
        evaluation.item.price, effectSeconds, day, nowIso,
      );
      inserted = Number(result.changes ?? 0) > 0;
      if (inserted) grantGarageTimeBoost(db, owner, effectSeconds, nowMs);
    } else {
      const prior = db.prepare(`SELECT MAX(purchased_at) AS stamp FROM tv_car_shop_sales WHERE org_id=? AND user_id=? AND item_id=?`).get(owner.org_id, owner.id, evaluation.item.id);
      if (prior?.stamp && Date.parse(prior.stamp) >= Date.parse(nowIso)) nowIso = new Date(Date.parse(prior.stamp) + 1).toISOString();
      const result = db.prepare(
        `INSERT OR IGNORE INTO tv_car_shop_purchases
          (org_id, user_id, item_id, currency, price, purchased_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(owner.org_id, owner.id, evaluation.item.id, evaluation.item.currency, evaluation.item.price, nowIso);
      inserted = Number(result.changes ?? 0) > 0;
      // Concurrent first-buy won the race: same as already owned, no double charge.
      if (!inserted) {
        evaluation = { status: "already_owned", item: evaluation.item, balance: available[evaluation.item.currency] };
      }
      if (inserted) setShopItemEquipped(db, owner, evaluation.item.id, true);
    }
  }
  return {
    evaluation,
    snapshot: buildShopSnapshot(db, owner, transferCredit, formatPrice),
    inserted,
  };
}

/** Owned cosmetic ids for TV / garage appearance payloads. */
export function shopUpgradesForOwner(db: any, owner: ShopOwner): string[] {
  const owned = readOwnedShopItems(db, owner);
  let selected: unknown;
  try {
    const row = db.prepare("SELECT upgrades_json FROM tv_car_shop_loadouts WHERE org_id=? AND user_id=?").get(owner.org_id, owner.id);
    if (row) selected = JSON.parse(row.upgrades_json);
  } catch { /* Older installations use the existing automatic selection. */ }
  return resolveShopEquipment(owned, selected);
}

export function setShopItemEquipped(db: any, owner: ShopOwner, itemId: unknown, equipped: unknown): boolean {
  const item = shopItemById(itemId);
  if (!item || item.kind !== "cosmetic" || typeof equipped !== "boolean") return false;
  if (!readOwnedShopItems(db, owner).includes(item.id)) return false;
  const current = shopUpgradesForOwner(db, owner);
  const selected = current.filter(id => equipped ? shopItemSlot(id) !== shopItemSlot(item.id) : id !== item.id);
  if (equipped) selected.push(item.id);
  db.prepare(`INSERT INTO tv_car_shop_loadouts (org_id,user_id,upgrades_json) VALUES (?,?,?)
    ON CONFLICT(org_id,user_id) DO UPDATE SET upgrades_json=excluded.upgrades_json`)
    .run(owner.org_id, owner.id, JSON.stringify(selected));
  return true;
}

/** Map of userId → owned upgrade ids for a whole org (TV feed). */
export function readShopUpgradesForOrg(db: any, orgId: number): Map<number, string[]> {
  const out = new Map<number, string[]>();
  try {
    const rows = db.prepare(
      `SELECT user_id, item_id FROM tv_car_shop_purchases WHERE org_id = ? ORDER BY purchased_at ASC`,
    ).all(orgId) as Array<{ user_id: number; item_id: string }>;
    for (const row of rows) {
      const uid = Number(row.user_id);
      const list = out.get(uid) ?? [];
      list.push(String(row.item_id));
      out.set(uid, list);
    }
    const selections = new Map<number, unknown>();
    try {
      for (const row of db.prepare("SELECT user_id,upgrades_json FROM tv_car_shop_loadouts WHERE org_id=?").all(orgId)) {
        try { selections.set(Number(row.user_id), JSON.parse(row.upgrades_json)); } catch { /* default */ }
      }
    } catch { /* older installations */ }
    for (const [uid, list] of out) out.set(uid, resolveShopEquipment(normalizeShopUpgrades(list), selections.get(uid)));
  } catch { /* optional table */ }
  return out;
}

/** Preserve historical spend, refund half the receipt, and remove ownership atomically. */
export function sellShopItem(db: any, owner: ShopOwner, itemId: unknown, receipt: unknown) {
  const item = shopItemById(itemId);
  if (!item || isConsumableShopItem(item)) return null;
  return db.transaction(() => {
    const row = db.prepare(`SELECT currency,price,purchased_at FROM tv_car_shop_purchases WHERE org_id=? AND user_id=? AND item_id=?`).get(owner.org_id, owner.id, item.id);
    // A stale/retried sale must never sell a subsequently repurchased copy.
    if (!row || typeof receipt !== "string" || receipt !== row.purchased_at) return null;
    const refund = Math.floor(floorNonNeg(row.price) / 2);
    setShopItemEquipped(db, owner, item.id, false);
    db.prepare(`INSERT INTO tv_car_shop_sales (org_id,user_id,item_id,currency,price,refund,purchased_at,sold_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(owner.org_id, owner.id, item.id, row.currency, row.price, refund, row.purchased_at, new Date().toISOString());
    db.prepare(`DELETE FROM tv_car_shop_purchases WHERE org_id=? AND user_id=? AND item_id=?`).run(owner.org_id, owner.id, item.id);
    return { item, refund, currency: row.currency as ShopCurrency };
  }).immediate();
}
