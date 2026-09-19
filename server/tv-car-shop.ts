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
    affordable: boolean;
    priceLabel: string;
    timesPurchased: number;
  }>;
  balances: ShopBalances;
  earned: ShopBalances;
  spent: ShopBalances;
  owned: string[];
  /** Base daily garage seconds (15 min). Boosts are per-day, not permanent. */
  garageDailySeconds: number;
};

function floorNonNeg(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Dialpad outbound calls already attributed to this person. */
export function readEarnedDialpadCalls(db: any, owner: ShopOwner): number {
  try {
    const row = db.prepare(
      `SELECT COALESCE(SUM(calls), 0) AS n FROM dialpad_daily_stats
        WHERE org_id = ? AND user_id = ?`,
    ).get(owner.org_id, owner.id);
    return floorNonNeg(row?.n);
  } catch {
    return 0;
  }
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
    transfers: floorNonNeg(transferCredit),
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
  const earned = readEarnedShopBalances(db, owner, transferCredit);
  const spent = readSpentShopBalances(db, owner);
  const balances = availableShopBalances(earned, spent);
  const consumableCounts = readConsumablePurchaseCounts(db, owner);
  const dayBonus = readGarageDayBonusSeconds(db, owner);
  return {
    catalog: TV_CAR_SHOP_CATALOG.map((item) => {
      const consumable = isConsumableShopItem(item);
      const permanentlyOwned = !consumable && ownedSet.has(item.id);
      return {
        ...item,
        owned: permanentlyOwned,
        affordable: !permanentlyOwned && balances[item.currency] >= item.price,
        priceLabel: formatPrice(item),
        timesPurchased: consumable ? (consumableCounts.get(item.id) ?? 0) : (permanentlyOwned ? 1 : 0),
      };
    }),
    balances,
    earned,
    spent,
    owned,
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
  return readOwnedShopItems(db, owner);
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
    for (const [uid, list] of out) out.set(uid, normalizeShopUpgrades(list));
  } catch { /* optional table */ }
  return out;
}
