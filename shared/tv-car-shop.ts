/**
 * Garage shop: cosmetic / garage upgrades bought with earned CLR stats.
 *
 * Currencies are ONLY metrics C3 already tracks per person:
 *   - transfers          → lifetime transfer credit (same scale as scorecards)
 *   - dialpad_calls      → all counted calls (legacy currency key retained for receipts)
 *   - texts              → all counted outbound texts
 *   - calltools_seconds  → CallTools talk / active seconds (callsync daily)
 *
 * Spending never touches real transfer scoring, race position, or goals.
 * Cosmetics are permanent (one row per item). Garage time boosts are
 * consumable one-time grants: each buy adds minutes to *today's* budget only
 * and may be bought again.
 */

export type ShopCurrency = "transfers" | "dialpad_calls" | "texts" | "calltools_seconds";

export type ShopItemKind = "cosmetic" | "garage";

/** Motif keys the garage UI maps to inline preview illustrations. */
export type ShopPreviewMotif =
  | "rims"
  | "underglow"
  | "rain-light"
  | "fin"
  | "plume"
  | "garage"
  | "mirrors"
  | "hood"
  | "exhaust"
  | "cabin"
  | "number"
  | "headlights"
  | "wing" | "passenger" | "body" | "hat";

export type ShopItemPreview = {
  from: string;
  to: string;
  motif: ShopPreviewMotif;
};

export const SHOP_TIERS = ["Street", "Rare", "Epic", "Legendary"] as const;
export type ShopTier = typeof SHOP_TIERS[number];

export type ShopItem = {
  tier: ShopTier;
  id: string;
  name: string;
  description: string;
  currency: ShopCurrency;
  /** Integer units of `currency`. Never fractional. */
  price: number;
  kind: ShopItemKind;
  /**
   * Consumable items charge every buy and never become "owned". Garage boosts
   * use this: each purchase grants extra minutes once for the current day.
   */
  consumable: boolean;
  /** Visual tile for the shop card (colors + motif). */
  preview: ShopItemPreview;
};

export type ShopBalances = Record<ShopCurrency, number>;

export type PurchaseEvaluation =
  | { status: "ok"; item: ShopItem; balance: number; remainingAfter: number }
  | { status: "already_owned"; item: ShopItem; balance: number }
  | { status: "unknown_item"; itemId: string }
  | { status: "insufficient"; item: ShopItem; balance: number; need: number };

/**
 * Who can ride along, and what they look like.
 *
 * The renderer used to be a chain of `passenger === "goose-copilot"` checks,
 * which is fine for four characters and unreadable at a dozen (owner, 22 Sep
 * 2026: "add more characters that you can add, like a clown, hat, panda,
 * etc."). Everything that distinguishes one rider from another lives here as
 * data, so a new one is a row in this table plus a catalog entry — and the
 * slot list, the sunroof cut-out and the model all read the same source
 * instead of each keeping their own copy of the ids.
 */
export type ShopPassengerLook = {
  id: string;
  /** Body colour. */
  body: string;
  /** Head colour, when the face is not the same as the body. */
  head?: string;
  /** A long upright neck. */
  neck?: boolean;
  /** Beak colour. A beak implies no separate nose. */
  beak?: string;
  /** How the eyes read at a distance. */
  eyes: "dot" | "big" | "visor" | "patch";
  /** Round ears on top of the head, in this colour. */
  ears?: string;
  /** Makes those ears pointed instead of round. */
  pointedEars?: boolean;
  /** Dark patches around the eyes, panda-style. */
  patches?: string;
  /** A round nose, clown-style. */
  nose?: string;
  /** Puffs of hair either side of the head. */
  hair?: string;
  /** A dorsal fin or row of back spikes. */
  fin?: string;
  /** A single antenna with a bulb on top. */
  antenna?: string;
  /** A raised, waving arm. */
  wave?: boolean;
};

export const SHOP_PASSENGERS: readonly ShopPassengerLook[] = [
  { id: "rubber-duck", body: "#ffe34d", beak: "#ff8e32", eyes: "dot" },
  { id: "goose-copilot", body: "#fff8e6", neck: true, beak: "#ff8e32", eyes: "dot" },
  { id: "alien-copilot", body: "#93fa71", eyes: "big", antenna: "#c6ffb0" },
  { id: "helmet-buddy", body: "#ff66b6", eyes: "visor", wave: true },
  { id: "clown-copilot", body: "#ff5566", head: "#fdf6ef", nose: "#ff2d3f", hair: "#ff8a3d", eyes: "dot" },
  { id: "panda-copilot", body: "#f5f3ee", ears: "#1d2129", patches: "#1d2129", eyes: "dot" },
  { id: "cat-copilot", body: "#ff9f4a", ears: "#ffc389", pointedEars: true, eyes: "dot", wave: true },
  { id: "shark-copilot", body: "#8fa6bd", fin: "#6c8199", eyes: "dot" },
  { id: "robot-copilot", body: "#b9c4cf", eyes: "visor", antenna: "#ff5a5a" },
  { id: "dino-copilot", body: "#5fc98a", fin: "#2f8f5c", eyes: "dot" },
] as const;

export const SHOP_PASSENGER_IDS: readonly string[] = SHOP_PASSENGERS.map((p) => p.id);

/**
 * Headwear. Its own slot, so a panda in a top hat is a thing you can own.
 *
 * A hat with no passenger sits on the driver's own helmet, which is why it is
 * worth being a separate purchase rather than baked into a character.
 */
export type ShopHatLook = {
  id: string;
  crown: string;
  band?: string;
  /** How it is built: a stovepipe, a cone, a wide brim, or a ring of points. */
  shape: "stovepipe" | "cone" | "wide" | "points";
};

export const SHOP_HATS: readonly ShopHatLook[] = [
  { id: "top-hat", crown: "#16181d", band: "#c8102e", shape: "stovepipe" },
  { id: "cowboy-hat", crown: "#b07a42", band: "#5c3b1e", shape: "wide" },
  { id: "party-hat", crown: "#ff5fa2", band: "#ffe066", shape: "cone" },
  { id: "gold-crown", crown: "#ffd34d", band: "#ff8e32", shape: "points" },
] as const;

export const SHOP_HAT_IDS: readonly string[] = SHOP_HATS.map((h) => h.id);

export function shopPassengerLook(id: string | undefined): ShopPassengerLook | null {
  return SHOP_PASSENGERS.find((p) => p.id === id) ?? null;
}

export function shopHatLook(id: string | undefined): ShopHatLook | null {
  return SHOP_HATS.find((h) => h.id === id) ?? null;
}

/** One-time +5 minutes of garage edit time for the Pacific day of purchase. */
export const GARAGE_PLUS_5_ITEM_ID = "garage-plus-5";
export const GARAGE_PLUS_5_SECONDS = 5 * 60;

/**
 * Catalog. Prices are meant to feel expensive on a normal CLR week — harder
 * to unlock than the first shop pass — without inventing new tracking.
 * CallTools prices are in seconds (UI shows minutes / hours).
 */
export const TV_CAR_SHOP_CATALOG: readonly ShopItem[] = [
  {
    id: "chrome-rims",
    tier: "Street",
    name: "Chrome rims",
    description: "Bright metal rims on your TV car. Purely cosmetic.",
    currency: "dialpad_calls",
    price: 800,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#1b2430", to: "#8a96a3", motif: "rims" },
  },
  {
    id: "neon-underglow",
    tier: "Rare",
    name: "Neon underglow",
    description: "A soft cyan glow under the chassis on the TV race.",
    currency: "dialpad_calls",
    price: 1_400,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#061820", to: "#5cf0ff", motif: "underglow" },
  },
  {
    id: "ice-headlights",
    tier: "Rare",
    name: "Ice headlights",
    description: "Cool ice-blue headlights that cut through the night race.",
    currency: "dialpad_calls",
    price: 1_100,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#0a1220", to: "#9ad8ff", motif: "headlights" },
  },
  {
    id: "carbon-mirrors",
    tier: "Street",
    name: "Carbon mirrors",
    description: "Matte carbon-fiber side mirrors — subtle garage flex.",
    currency: "dialpad_calls",
    price: 600,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#141414", to: "#3a3a3a", motif: "mirrors" },
  },
  {
    id: "cabin-leds",
    tier: "Street",
    name: "Cabin LED wash",
    description: "A soft teal wash inside the cockpit glass on TV.",
    currency: "dialpad_calls",
    price: 950,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#0c1c22", to: "#3dd6c3", motif: "cabin" },
  },
  {
    id: "gold-rain-light",
    tier: "Rare",
    name: "Gold rain light",
    description: "Your rear rain light shines gold instead of accent paint.",
    currency: "transfers",
    price: 80,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#2a1c05", to: "#f1d552", motif: "rain-light" },
  },
  {
    id: "trophy-fin",
    tier: "Epic",
    name: "Trophy shark fin",
    description: "A gold shark fin on the engine cover — bragging rights only.",
    currency: "transfers",
    price: 200,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#241805", to: "#f6c94a", motif: "fin" },
  },
  {
    id: "matte-hood",
    tier: "Street",
    name: "Matte hood stripe",
    description: "A dark matte stripe down the nose — looks fast standing still.",
    currency: "transfers",
    price: 120,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#1a1a1a", to: "#4a4a4a", motif: "hood" },
  },
  {
    id: "champion-plate",
    tier: "Legendary",
    name: "Champion number plate",
    description: "A gold number plate behind the rank digit on the nose.",
    currency: "transfers",
    price: 250,
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#3a2a08", to: "#ffe08a", motif: "number" },
  },
  {
    id: "victory-plume",
    tier: "Epic",
    name: "Victory plume",
    description: "A warmer boost trail when you score a transfer on the wall.",
    currency: "calltools_seconds",
    price: 10 * 60 * 60, // 10 hours of CallTools talk time
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#2a1408", to: "#ffb347", motif: "plume" },
  },
  {
    id: "spark-exhaust",
    tier: "Rare",
    name: "Spark exhaust",
    description: "Copper-tipped exhaust that pops a spark on celebration boosts.",
    currency: "calltools_seconds",
    price: 6 * 60 * 60, // 6 hours
    kind: "cosmetic",
    consumable: false,
    preview: { from: "#1c1008", to: "#e07a3a", motif: "exhaust" },
  },
  {
    id: GARAGE_PLUS_5_ITEM_ID,
    tier: "Street",
    name: "+5 min garage boost",
    description:
      "One-time: adds five minutes to today's garage edit time only. Not a permanent daily raise — buy again whenever you need another boost.",
    currency: "calltools_seconds",
    price: 5 * 60 * 60, // 5 hours of CallTools talk time
    kind: "garage",
    consumable: true,
    preview: { from: "#0f1f18", to: "#5dcea0", motif: "garage" },
  },
  {"id":"pulse-rims","name":"Pulse rims","description":"Electric cyan wheel rings with a bright neon core.","currency":"dialpad_calls","price":2400,"tier":"Rare","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#38e8ff","motif":"rims"}},
  {"id":"plasma-underglow","name":"Plasma underglow","description":"A wide violet halo underneath your car. Replaces cyan underglow.","currency":"texts","price":3500,"tier":"Epic","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#b67bff","motif":"underglow"}},
  {"id":"laser-headlights","name":"Laser headlights","description":"Twin pink laser blades across the nose. Replaces ice headlights.","currency":"texts","price":1600,"tier":"Rare","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#ff58c8","motif":"headlights"}},
  {"id":"ion-cabin","name":"Ion cockpit","description":"A violet canopy framed by luminous rails. Replaces the teal cabin wash.","currency":"texts","price":700,"tier":"Street","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#a78bfa","motif":"cabin"}},
  {"id":"prism-rims","name":"Prism turbine rims","description":"Alternating cyan and pink turbine rings. Takes priority over Pulse and Chrome.","currency":"dialpad_calls","price":6000,"tier":"Legendary","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#ff69db","motif":"rims"}},
  {"id":"solar-fin","name":"Solar crown fin","description":"A gold dorsal blade with three radiant crown points. Replaces the trophy fin.","currency":"transfers","price":450,"tier":"Legendary","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#ffdc73","motif":"fin"}},
  {"id":"reactor-exhaust","name":"Reactor exhaust","description":"Twin violet reactor ports with glowing cyan cores.","currency":"calltools_seconds","price":64800,"tier":"Epic","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#976dff","motif":"exhaust"}},
  {"id":"hyperdrive-trail","name":"Hyperdrive trail","description":"Four neon energy trails light up when your car celebrates a transfer.","currency":"calltools_seconds","price":144000,"tier":"Legendary","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#64ffda","motif":"plume"}},
  {"id":"holo-wing","name":"Holographic wing","description":"A luminous cyan rear aero wing with pink endplates.","currency":"transfers","price":300,"tier":"Epic","kind":"cosmetic","consumable":false,"preview":{"from":"#090d22","to":"#51edff","motif":"wing"}},
  {"id": "ducktail-spoiler", "name": "Ducktail spoiler", "description": "A short swept lip for a clean retro silhouette.", "currency": "dialpad_calls", "price": 1000, "tier": "Street", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#79e4ff", "motif": "wing"}},
  {"id": "double-decker-wing", "name": "Double-decker wing", "description": "Two tall aero blades and neon endplates. Subtlety sold separately.", "currency": "texts", "price": 2800, "tier": "Epic", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#f28aff", "motif": "wing"}},
  {"id": "angel-wing", "name": "Angel wings", "description": "Pearl feather-shaped wings at the rear. Aerodynamics by wishful thinking.", "currency": "transfers", "price": 350, "tier": "Legendary", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#fff0bb", "motif": "wing"}},
  {"id": "rubber-duck", "name": "Rubber duck copilot", "description": "A giant yellow duck in the cockpit. Absolutely no license.", "currency": "texts", "price": 900, "tier": "Street", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ffe55d", "motif": "passenger"}},
  {"id": "goose-copilot", "name": "Chaos goose", "description": "Long neck, orange beak, zero respect for the racing line.", "currency": "dialpad_calls", "price": 1800, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#f5f4e9", "motif": "passenger"}},
  {"id": "alien-copilot", "name": "Alien copilot", "description": "A lime-green visitor with enormous eyes. Here for your transfers.", "currency": "calltools_seconds", "price": 28800, "tier": "Epic", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#9eff80", "motif": "passenger"}},
  {"id": "helmet-buddy", "name": "Helmet buddy", "description": "A tiny passenger in a bright pink racing helmet, waving from the cockpit.", "currency": "texts", "price": 1400, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ff72b9", "motif": "passenger"}},
  {"id": "body-f1-60s", "name": "1960s Grand Prix", "description": "A slim cigar body, exposed wheels and almost no aero. Inspired by early Formula 1.", "currency": "dialpad_calls", "price": 1800, "tier": "Street", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#7fe5a1", "motif": "body"}},
  {"id": "body-f1-90s", "name": "1990s Grand Prix", "description": "A raised narrow nose, squared sidepods and a tall rear wing.", "currency": "texts", "price": 3200, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ffbd65", "motif": "body"}},
  {"id": "body-f1-modern", "name": "Modern Grand Prix", "description": "Sculpted sidepods, a wide layered front wing and a protective cockpit halo.", "currency": "transfers", "price": 400, "tier": "Legendary", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#64e8ff", "motif": "body"}},
  {"id": "body-stock-80s", "name": "1980s Stock Car", "description": "A long square hood, upright cabin and slab-sided NASCAR-inspired body.", "currency": "dialpad_calls", "price": 2800, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ff826e", "motif": "body"}},
  {"id": "clown-copilot", "name": "Clown copilot", "description": "Red nose, orange hair, and the unshakeable confidence of someone who has never checked a mirror.", "currency": "texts", "price": 1600, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ff5566", "motif": "passenger"}},
  {"id": "panda-copilot", "name": "Panda copilot", "description": "Round, calm, and entirely unbothered by the racing line.", "currency": "dialpad_calls", "price": 2200, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#f5f3ee", "motif": "passenger"}},
  {"id": "cat-copilot", "name": "Copilot cat", "description": "Pointed ears, one paw raised. Waving, or asking to be let out.", "currency": "texts", "price": 1200, "tier": "Street", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ff9f4a", "motif": "passenger"}},
  {"id": "shark-copilot", "name": "Shark copilot", "description": "Grey, finned, and technically a long way from water.", "currency": "calltools_seconds", "price": 32400, "tier": "Epic", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#8fa6bd", "motif": "passenger"}},
  {"id": "robot-copilot", "name": "Robot copilot", "description": "A visor, a red antenna, and opinions about your braking points.", "currency": "dialpad_calls", "price": 2600, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#b9c4cf", "motif": "passenger"}},
  {"id": "dino-copilot", "name": "Tiny dinosaur", "description": "Green, spiked down the back, and 66 million years late for the grid.", "currency": "transfers", "price": 250, "tier": "Epic", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#5fc98a", "motif": "passenger"}},
  {"id": "top-hat", "name": "Top hat", "description": "A stovepipe with a red band, worn by your passenger — or by you, if the seat is empty.", "currency": "texts", "price": 1500, "tier": "Rare", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#c8102e", "motif": "hat"}},
  {"id": "cowboy-hat", "name": "Cowboy hat", "description": "Wide brim, tan felt. Suits absolutely everyone in the cockpit.", "currency": "dialpad_calls", "price": 1400, "tier": "Street", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#b07a42", "motif": "hat"}},
  {"id": "party-hat", "name": "Party hat", "description": "A pink cone with a gold pom. Every transfer is an occasion.", "currency": "texts", "price": 800, "tier": "Street", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ff5fa2", "motif": "hat"}},
  {"id": "gold-crown", "name": "Gold crown", "description": "For whoever is leading. Nobody checks.", "currency": "transfers", "price": 300, "tier": "Legendary", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#ffd34d", "motif": "hat"}},
  {"id": "body-stock-modern", "name": "Modern Stock Car", "description": "A wide closed-wheel coupe, low roof, splitter and rear spoiler. NASCAR-inspired.", "currency": "calltools_seconds", "price": 43200, "tier": "Epic", "kind": "cosmetic", "consumable": false, "preview": {"from": "#090d22", "to": "#b08aff", "motif": "body"}},
] as const;

const CATALOG_BY_ID = new Map(TV_CAR_SHOP_CATALOG.map((item) => [item.id, item]));

export function shopItemById(id: unknown): ShopItem | null {
  if (typeof id !== "string" || !id) return null;
  return CATALOG_BY_ID.get(id) ?? null;
}

export function isConsumableShopItem(item: ShopItem): boolean {
  return item.consumable === true || item.kind === "garage";
}

/** Variants occupy one slot; unrelated accessories can be combined. */
export function shopItemSlot(id: string): string {
  const slots: Record<string, string> = {
    "chrome-rims": "wheels", "pulse-rims": "wheels", "prism-rims": "wheels",
    "neon-underglow": "underglow", "plasma-underglow": "underglow",
    "ice-headlights": "headlights", "laser-headlights": "headlights",
    "cabin-leds": "cockpit", "ion-cabin": "cockpit",
    "trophy-fin": "fin", "solar-fin": "fin",
    "spark-exhaust": "exhaust", "reactor-exhaust": "exhaust",
    "victory-plume": "trail", "hyperdrive-trail": "trail",
  };
  if (id.startsWith("body-")) return "body";
  if (["holo-wing", "ducktail-spoiler", "double-decker-wing", "angel-wing"].includes(id)) return "rear-aero";
  if (SHOP_PASSENGER_IDS.includes(id)) return "passenger";
  if (SHOP_HAT_IDS.includes(id)) return "hat";
  return slots[id] ?? id;
}

/** Only owned cosmetics may be equipped, at most one per slot. */
export function resolveShopEquipment(owned: string[], selected?: unknown): string[] {
  const candidates = Array.isArray(selected) ? selected : TV_CAR_SHOP_CATALOG.filter(i => owned.includes(i.id)).map(i => i.id);
  const slots = new Map<string, string>();
  for (const id of normalizeShopUpgrades(candidates)) {
    if (owned.includes(id)) slots.set(shopItemSlot(id), id);
  }
  return Array.from(slots.values());
}

/** Known cosmetic upgrade ids only — never trust a free-form string from storage. */
export function normalizeShopUpgrades(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || seen.has(value)) continue;
    const item = CATALOG_BY_ID.get(value);
    if (!item || item.kind !== "cosmetic" || item.consumable) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function emptyShopBalances(): ShopBalances {
  return { transfers: 0, dialpad_calls: 0, texts: 0, calltools_seconds: 0 };
}

/** Clamp earned/spent figures so bad rows cannot invent negative money. */
export function shopBalance(earned: number, spent: number): number {
  const e = Number.isFinite(Number(earned)) ? Math.max(0, Math.floor(Number(earned))) : 0;
  const s = Number.isFinite(Number(spent)) ? Math.max(0, Math.floor(Number(spent))) : 0;
  return Math.max(0, e - s);
}

export function availableShopBalances(earned: ShopBalances, spent: ShopBalances): ShopBalances {
  return {
    transfers: Math.max(0, (Number(earned.transfers) || 0) - (Number(spent.transfers) || 0)),
    texts: shopBalance(earned.texts, spent.texts),
    dialpad_calls: shopBalance(earned.dialpad_calls, spent.dialpad_calls),
    calltools_seconds: shopBalance(earned.calltools_seconds, spent.calltools_seconds),
  };
}

/**
 * Decide whether a buy may proceed. Pure: no DB.
 * Consumables never return `already_owned` — each purchase charges again.
 * Permanent cosmetics still short-circuit when owned (no second charge).
 */
export function evaluateShopPurchase(args: {
  itemId: unknown;
  owned: Iterable<string>;
  available: ShopBalances;
}): PurchaseEvaluation {
  const item = shopItemById(args.itemId);
  if (!item) return { status: "unknown_item", itemId: String(args.itemId ?? "") };
  const owned = new Set(Array.from(args.owned ?? []).map(String));
  const raw = Number(args.available[item.currency]);
  const balance = Number.isFinite(raw) ? Math.max(0, item.currency === "transfers" ? raw : Math.floor(raw)) : 0;
  if (!isConsumableShopItem(item) && owned.has(item.id)) {
    return { status: "already_owned", item, balance };
  }
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

/**
 * Permanent daily garage bonus removed in 4.122.19.
 * Garage boosts are one-time consumables applied to today's bonus_seconds.
 * Kept as a no-op so older call sites stay safe until cleaned up.
 */
export function garageDailyBonusSeconds(_owned: Iterable<string>): number {
  return 0;
}

export function formatShopPrice(item: ShopItem): string {
  if (item.currency === "texts") return `${item.price.toLocaleString()} texts`;
  if (item.currency === "transfers") {
    return `${item.price} transfer${item.price === 1 ? "" : "s"}`;
  }
  if (item.currency === "dialpad_calls") {
    return `${item.price} call${item.price === 1 ? "" : "s"}`;
  }
  const hours = item.price / 3600;
  if (hours >= 1 && item.price % 3600 === 0) {
    return `${hours} hr CallTools time`;
  }
  const minutes = Math.round(item.price / 60);
  return `${minutes} min CallTools time`;
}

export function formatShopBalance(currency: ShopCurrency, amount: number): string {
  const n = Math.max(0, currency === "transfers" ? (Number(amount) || 0) : Math.floor(Number(amount) || 0));
  if (currency === "texts") return `${n.toLocaleString()} texts`;
  if (currency === "transfers") return `${n} transfer${n === 1 ? "" : "s"}`;
  if (currency === "dialpad_calls") return `${n} call${n === 1 ? "" : "s"}`;
  const hours = Math.floor(n / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  const seconds = n % 60;
  return hours ? `${hours}h ${minutes}m CallTools time` : `${minutes}m ${seconds}s CallTools time`;
}

export function shopCurrencyLabel(currency: ShopCurrency): string {
  if (currency === "texts") return "Texts";
  if (currency === "transfers") return "Transfers";
  if (currency === "dialpad_calls") return "Calls";
  return "CallTools talk time";
}
