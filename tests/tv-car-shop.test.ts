import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GARAGE_PLUS_5_ITEM_ID,
  GARAGE_PLUS_5_SECONDS,
  TV_CAR_SHOP_CATALOG,
  availableShopBalances,
  emptyShopBalances,
  evaluateShopPurchase,
  formatShopPrice,
  garageDailyBonusSeconds,
  normalizeShopUpgrades,
  shopBalance,
  shopItemById,
} from "../shared/tv-car-shop";
import { TV_CAR_DAILY_SECONDS, tvCarBudget } from "../shared/tv-car-budget";
import { normalizeTvCarAppearance, validateTvCarAppearance } from "../shared/tv-car";

test("catalog uses only existing CLR metrics as currency", () => {
  assert.ok(TV_CAR_SHOP_CATALOG.length >= 4);
  const currencies = new Set(TV_CAR_SHOP_CATALOG.map((item) => item.currency));
  assert.deepEqual([...currencies].sort(), ["calltools_seconds", "dialpad_calls", "transfers"]);
  for (const item of TV_CAR_SHOP_CATALOG) {
    assert.ok(Number.isInteger(item.price) && item.price > 0, item.id);
    assert.ok(item.kind === "cosmetic" || item.kind === "garage", item.id);
    assert.ok(item.name.trim().length > 2);
    assert.match(formatShopPrice(item), /transfer|Dialpad|CallTools/);
  }
  assert.ok(shopItemById(GARAGE_PLUS_5_ITEM_ID));
  assert.equal(shopItemById("nope"), null);
});

test("balances never go negative and ignore garbage input", () => {
  assert.equal(shopBalance(100, 40), 60);
  assert.equal(shopBalance(10, 40), 0);
  assert.equal(shopBalance(-5, 3), 0);
  assert.equal(shopBalance(NaN as any, 3), 0);
  assert.deepEqual(
    availableShopBalances(
      { transfers: 50, dialpad_calls: 200, calltools_seconds: 3600 },
      { transfers: 15, dialpad_calls: 250, calltools_seconds: 600 },
    ),
    { transfers: 35, dialpad_calls: 0, calltools_seconds: 3000 },
  );
  assert.deepEqual(emptyShopBalances(), { transfers: 0, dialpad_calls: 0, calltools_seconds: 0 });
});

test("purchase rules: unknown, insufficient, ok, and already-owned (no double charge)", () => {
  const available = { transfers: 20, dialpad_calls: 300, calltools_seconds: 10_000 };
  assert.equal(evaluateShopPurchase({ itemId: "missing", owned: [], available }).status, "unknown_item");

  const gold = shopItemById("gold-rain-light")!;
  const poor = evaluateShopPurchase({
    itemId: gold.id,
    owned: [],
    available: { ...available, transfers: gold.price - 1 },
  });
  assert.equal(poor.status, "insufficient");
  if (poor.status === "insufficient") {
    assert.equal(poor.need, gold.price);
    assert.equal(poor.balance, gold.price - 1);
  }

  const ok = evaluateShopPurchase({ itemId: gold.id, owned: [], available });
  assert.equal(ok.status, "ok");
  if (ok.status === "ok") {
    assert.equal(ok.remainingAfter, available.transfers - gold.price);
  }

  const again = evaluateShopPurchase({ itemId: gold.id, owned: [gold.id], available });
  assert.equal(again.status, "already_owned");
  // Owned short-circuits even if the balance could not afford a second charge.
  const brokeButOwned = evaluateShopPurchase({
    itemId: gold.id,
    owned: [gold.id],
    available: { transfers: 0, dialpad_calls: 0, calltools_seconds: 0 },
  });
  assert.equal(brokeButOwned.status, "already_owned");
});

test("garage +5 unlock adds five minutes and never invents unknown upgrades", () => {
  assert.equal(garageDailyBonusSeconds([]), 0);
  assert.equal(garageDailyBonusSeconds([GARAGE_PLUS_5_ITEM_ID]), GARAGE_PLUS_5_SECONDS);
  assert.equal(garageDailyBonusSeconds(["chrome-rims", "bogus"]), 0);
  assert.deepEqual(normalizeShopUpgrades(["chrome-rims", "chrome-rims", "nope", 3, null]), ["chrome-rims"]);
  assert.deepEqual(normalizeShopUpgrades("chrome-rims"), []);

  const withBonus = tvCarBudget(0, "2026-09-18", TV_CAR_DAILY_SECONDS + GARAGE_PLUS_5_SECONDS);
  assert.equal(withBonus.remaining, 20 * 60);
  assert.equal(withBonus.locked, false);
  // Spending the original 15 minutes still leaves the bonus five.
  assert.equal(tvCarBudget(15 * 60, "2026-09-18", TV_CAR_DAILY_SECONDS + GARAGE_PLUS_5_SECONDS).remaining, 5 * 60);
});

test("appearance carries owned upgrades read-only and paint saves still ignore them", () => {
  const appearance = normalizeTvCarAppearance({
    bodyColor: "#123456",
    accentColor: "#abcdef",
    livery: "solid",
    upgrades: ["neon-underglow", "neon-underglow", "fake"],
  }, 7);
  assert.deepEqual(appearance.upgrades, ["neon-underglow"]);
  // Paint saves still only accept the three cosmetic fields — upgrades are server-owned.
  assert.equal(validateTvCarAppearance({
    bodyColor: "#123456", accentColor: "#abcdef", livery: "solid", upgrades: ["neon-underglow"],
  }), null);
});
