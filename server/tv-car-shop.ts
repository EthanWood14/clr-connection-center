/**
 * Garage-shop persistence and earned-balance readers.
 *
 * Earned totals come from tables C3 already fills (Dialpad daily stats,
 * CallTools/CallSync activity, transfer credit). Spent totals come only from
 * tv_car_shop_purchases. Nothing here writes to lead_outcomes or scoreboards.
 */

import {
  availableShopBalances,
  emptyShopBalances,
  evaluateShopPurchase,
  garageDailyBonusSeconds,
  normalizeShopUpgrades,
  TV_CAR_SHOP_CATALOG,
  type ShopBalances,
  type ShopItem,
  type ShopCurrency,
} from "../shared/tv-car-shop";
import { TV_CAR_DAILY_SECONDS } from "../shared/tv-car-budget";

export type ShopOwner = { id: number; org_id: number };

export type ShopSnapshot = {
  catalog: Array<ShopItem & { owned: boolean; affordable: boolean; priceLabel: string }>;
  balances: ShopBalances;
  earned: ShopBalances;
  spent: ShopBalances;
  owned: string[];
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

export function readSpentShopBalances(db: any, owner: ShopOwner): ShopBalances {
  const spent = emptyShopBalances();
  try {
    const rows = db.prepare(
      `SELECT currency, COALESCE(SUM(price), 0) AS n FROM tv_car_shop_purchases
        WHERE org_id = ? AND user_id = ? GROUP BY currency`,
    ).all(owner.org_id, owner.id) as Array<{ currency: string; n: number }>;
    for (const row of rows) {
      const key = row.currency as ShopCurrency;
      if (key in spent) spent[key] = floorNonNeg(row.n);
    }
  } catch { /* table may be mid-migrate in a test */ }
  return spent;
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
  return {
    catalog: TV_CAR_SHOP_CATALOG.map((item) => ({
      ...item,
      owned: ownedSet.has(item.id),
      affordable: !ownedSet.has(item.id) && balances[item.currency] >= item.price,
      priceLabel: formatPrice(item),
    })),
    balances,
    earned,
    spent,
    owned,
    garageDailySeconds: TV_CAR_DAILY_SECONDS + garageDailyBonusSeconds(owned),
  };
}

/**
 * Buy one catalog item. Idempotent: a second buy of the same item returns
 * `already_owned` and writes nothing. Insufficient funds never inserts a row.
 */
export function purchaseShopItem(
  db: any,
  owner: ShopOwner,
  itemId: unknown,
  transferCredit: number,
  formatPrice: (item: ShopItem) => string,
  nowIso = new Date().toISOString(),
): { evaluation: ReturnType<typeof evaluateShopPurchase>; snapshot: ShopSnapshot; inserted: boolean } {
  const owned = readOwnedShopItems(db, owner);
  const earned = readEarnedShopBalances(db, owner, transferCredit);
  const spent = readSpentShopBalances(db, owner);
  const available = availableShopBalances(earned, spent);
  let evaluation = evaluateShopPurchase({ itemId, owned, available });
  let inserted = false;
  if (evaluation.status === "ok") {
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
