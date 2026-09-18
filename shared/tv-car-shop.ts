/**
 * Garage shop: small cosmetic / garage upgrades bought with earned CLR stats.
 *
 * Currencies are ONLY metrics C3 already tracks per person:
 *   - transfers          → lifetime transfer credit (same scale as scorecards)
 *   - dialpad_calls      → Dialpad outbound calls (dialpad_daily_stats)
 *   - calltools_seconds  → CallTools talk / active seconds (callsync daily)
 *
 * Spending never touches real transfer scoring, race position, or goals. A
 * purchase is a row in tv_car_shop_purchases; balances are earned − spent.
 * Buying an item you already own is a no-op (idempotent, no second charge).
 */

export type ShopCurrency = "transfers" | "dialpad_calls" | "calltools_seconds";

export type ShopItemKind = "cosmetic" | "garage";

export type ShopItem = {
  id: string;
  name: string;
  description: string;
  currency: ShopCurrency;
  /** Integer units of `currency`. Never fractional. */
  price: number;
  kind: ShopItemKind;
};

export type ShopBalances = Record<ShopCurrency, number>;

export type PurchaseEvaluation =
  | { status: "ok"; item: ShopItem; balance: number; remainingAfter: number }
  | { status: "already_owned"; item: ShopItem; balance: number }
  | { status: "unknown_item"; itemId: string }
  | { status: "insufficient"; item: ShopItem; balance: number; need: number };

/** Permanent +5 minutes of garage time once this item is owned. */
export const GARAGE_PLUS_5_ITEM_ID = "garage-plus-5";
export const GARAGE_PLUS_5_SECONDS = 5 * 60;

/**
 * Catalog. Prices are meant to feel earned on a normal CLR week without
 * inventing new tracking. CallTools prices are in seconds (UI shows minutes).
 */
export const TV_CAR_SHOP_CATALOG: readonly ShopItem[] = [
  {
    id: "chrome-rims",
    name: "Chrome rims",
    description: "Bright metal rims on your TV car. Purely cosmetic.",
    currency: "dialpad_calls",
    price: 150,
    kind: "cosmetic",
  },
  {
    id: "neon-underglow",
    name: "Neon underglow",
    description: "A soft cyan glow under the chassis on the TV race.",
    currency: "dialpad_calls",
    price: 250,
    kind: "cosmetic",
  },
  {
    id: "gold-rain-light",
    name: "Gold rain light",
    description: "Your rear rain light shines gold instead of accent paint.",
    currency: "transfers",
    price: 15,
    kind: "cosmetic",
  },
  {
    id: "trophy-fin",
    name: "Trophy shark fin",
    description: "A gold shark fin on the engine cover — bragging rights only.",
    currency: "transfers",
    price: 40,
    kind: "cosmetic",
  },
  {
    id: "victory-plume",
    name: "Victory plume",
    description: "A warmer boost trail when you score a transfer on the wall.",
    currency: "calltools_seconds",
    price: 2 * 60 * 60, // 2 hours of CallTools talk time
    kind: "cosmetic",
  },
  {
    id: GARAGE_PLUS_5_ITEM_ID,
    name: "+5 min garage / day",
    description: "Every day you get 20 minutes in the garage instead of 15. Stats and race standing stay the same.",
    currency: "calltools_seconds",
    price: 60 * 60, // 1 hour of CallTools talk time
    kind: "garage",
  },
] as const;

const CATALOG_BY_ID = new Map(TV_CAR_SHOP_CATALOG.map((item) => [item.id, item]));

export function shopItemById(id: unknown): ShopItem | null {
  if (typeof id !== "string" || !id) return null;
  return CATALOG_BY_ID.get(id) ?? null;
}

/** Known upgrade ids only — never trust a free-form string from storage. */
export function normalizeShopUpgrades(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !CATALOG_BY_ID.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function emptyShopBalances(): ShopBalances {
  return { transfers: 0, dialpad_calls: 0, calltools_seconds: 0 };
}

/** Clamp earned/spent figures so bad rows cannot invent negative money. */
export function shopBalance(earned: number, spent: number): number {
  const e = Number.isFinite(Number(earned)) ? Math.max(0, Math.floor(Number(earned))) : 0;
  const s = Number.isFinite(Number(spent)) ? Math.max(0, Math.floor(Number(spent))) : 0;
  return Math.max(0, e - s);
}

export function availableShopBalances(earned: ShopBalances, spent: ShopBalances): ShopBalances {
  return {
    transfers: shopBalance(earned.transfers, spent.transfers),
    dialpad_calls: shopBalance(earned.dialpad_calls, spent.dialpad_calls),
    calltools_seconds: shopBalance(earned.calltools_seconds, spent.calltools_seconds),
  };
}

/**
 * Decide whether a buy may proceed. Pure: no DB. `already_owned` means the
 * caller must NOT charge again — repeat POSTs are safe.
 */
export function evaluateShopPurchase(args: {
  itemId: unknown;
  owned: Iterable<string>;
  available: ShopBalances;
}): PurchaseEvaluation {
  const item = shopItemById(args.itemId);
  if (!item) return { status: "unknown_item", itemId: String(args.itemId ?? "") };
  const owned = new Set(Array.from(args.owned ?? []).map(String));
  const balance = Math.max(0, Math.floor(Number(args.available[item.currency]) || 0));
  if (owned.has(item.id)) return { status: "already_owned", item, balance };
  if (balance < item.price) {
    return { status: "insufficient", item, balance, need: item.price };
  }
  return {
    status: "ok",
    item,
    balance,
    remainingAfter: balance - item.price,
  };
}

/** Extra daily garage seconds unlocked by owned shop items. */
export function garageDailyBonusSeconds(owned: Iterable<string>): number {
  const ids = new Set(Array.from(owned ?? []).map(String));
  return ids.has(GARAGE_PLUS_5_ITEM_ID) ? GARAGE_PLUS_5_SECONDS : 0;
}

export function formatShopPrice(item: ShopItem): string {
  if (item.currency === "transfers") {
    return `${item.price} transfer${item.price === 1 ? "" : "s"}`;
  }
  if (item.currency === "dialpad_calls") {
    return `${item.price} Dialpad call${item.price === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(item.price / 60);
  return `${minutes} min CallTools time`;
}

export function formatShopBalance(currency: ShopCurrency, amount: number): string {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (currency === "transfers") return `${n} transfer${n === 1 ? "" : "s"}`;
  if (currency === "dialpad_calls") return `${n} Dialpad call${n === 1 ? "" : "s"}`;
  const minutes = Math.floor(n / 60);
  return `${minutes} min CallTools time`;
}

export function shopCurrencyLabel(currency: ShopCurrency): string {
  if (currency === "transfers") return "Transfers";
  if (currency === "dialpad_calls") return "Dialpad calls";
  return "CallTools talk time";
}
