import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

import {
  SHOP_HATS, SHOP_HAT_IDS, SHOP_PASSENGERS, SHOP_PASSENGER_IDS, TV_CAR_SHOP_CATALOG,
  resolveShopEquipment, shopHatLook, shopItemSlot, shopPassengerLook,
} from "../shared/tv-car-shop";
import { createTvCarModel } from "../client/src/components/tv/car-model";
import { defaultTvCarAppearance } from "../shared/tv-car";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * "Add more characters that you can add, like a clown, hat, panda, etc."
 * — Ethan, 22 Sep 2026.
 */

const NEW_RIDERS = ["clown-copilot", "panda-copilot", "cat-copilot", "shark-copilot", "robot-copilot", "dino-copilot"];

test("the new riders and hats are all real, buyable catalog items", () => {
  for (const id of [...NEW_RIDERS, ...SHOP_HAT_IDS]) {
    const item = TV_CAR_SHOP_CATALOG.find((entry) => entry.id === id);
    assert.ok(item, `${id} is missing from the catalog`);
    assert.equal(item!.kind, "cosmetic");
    assert.equal(item!.consumable, false, `${id} must be a keepsake, not a consumable`);
    assert.ok(item!.price > 0 && Number.isInteger(item!.price), `${id} needs a whole price`);
    assert.ok(item!.description.length > 20, `${id} needs a description worth reading`);
  }
  // Every look has a catalog entry and every passenger/hat entry has a look:
  // one without the other is an item nobody can see or a card nobody can buy.
  for (const look of SHOP_PASSENGERS) assert.ok(TV_CAR_SHOP_CATALOG.some((i) => i.id === look.id), `${look.id} has no card`);
  for (const hat of SHOP_HATS) assert.ok(TV_CAR_SHOP_CATALOG.some((i) => i.id === hat.id), `${hat.id} has no card`);
  for (const item of TV_CAR_SHOP_CATALOG) {
    if (item.preview.motif === "passenger") assert.ok(shopPassengerLook(item.id), `${item.id} looks like a passenger but has no look`);
    if (item.preview.motif === "hat") assert.ok(shopHatLook(item.id), `${item.id} looks like a hat but has no look`);
  }
  assert.equal(new Set(TV_CAR_SHOP_CATALOG.map((i) => i.id)).size, TV_CAR_SHOP_CATALOG.length, "no duplicate ids");
});

test("one rider and one hat at a time, and they do not fight over a slot", () => {
  for (const id of SHOP_PASSENGER_IDS) assert.equal(shopItemSlot(id), "passenger", id);
  for (const id of SHOP_HAT_IDS) assert.equal(shopItemSlot(id), "hat", id);
  // A panda in a top hat is a thing you can own: different slots, both worn.
  const owned = ["panda-copilot", "clown-copilot", "top-hat", "gold-crown"];
  const worn = resolveShopEquipment(owned, owned);
  assert.equal(worn.filter((id) => SHOP_PASSENGER_IDS.includes(id)).length, 1, "only one rider fits in the seat");
  assert.equal(worn.filter((id) => SHOP_HAT_IDS.includes(id)).length, 1, "and only one hat fits on a head");
  assert.equal(worn.length, 2);
  // Nothing can be worn that was not bought.
  assert.deepEqual(resolveShopEquipment([], ["panda-copilot", "top-hat"]), []);
});

test("every character is visibly its own thing, not a recoloured blob", () => {
  // Distinct silhouettes matter more than distinct colours on a car this small
  // on the wall: at least one shape feature has to differ between any two.
  const shape = (id: string) => {
    const look = shopPassengerLook(id)!;
    return JSON.stringify([look.neck ?? false, !!look.beak, look.eyes, look.ears ?? "", look.pointedEars ?? false,
      look.patches ?? "", look.nose ?? "", look.hair ?? "", look.fin ?? "", look.antenna ?? "", look.wave ?? false]);
  };
  const shapes = SHOP_PASSENGER_IDS.map(shape);
  assert.equal(new Set(shapes).size, shapes.length, "two characters are built from identical features");
  for (const look of SHOP_PASSENGERS) assert.match(look.body, /^#[0-9a-f]{6}$/i, `${look.id} needs a real colour`);
  for (const hat of SHOP_HATS) assert.match(hat.crown, /^#[0-9a-f]{6}$/i, `${hat.id} needs a real colour`);
  assert.equal(new Set(SHOP_HATS.map((h) => h.shape)).size, SHOP_HATS.length, "every hat is a different shape");
});

test("the model builds every one of them, and hangs the hat on the right head", () => {
  const appearance = (upgrades: string[]) => ({ ...defaultTvCarAppearance(7), upgrades });
  const names = (model: { root: THREE.Object3D }) => {
    const found: string[] = [];
    model.root.traverse((child) => { if (child.name) found.push(child.name); });
    return found;
  };
  for (const id of SHOP_PASSENGER_IDS) {
    const model = createTvCarModel({ appearance: appearance([id]) as any });
    try {
      assert.ok(names(model).includes(id), `${id} does not appear on the car`);
      // The rider sits in the passenger seat, offset from the driver.
      const rider = model.root.getObjectByName(id)!;
      assert.ok(rider.position.x > .2, `${id} is sitting on the driver`);
      assert.ok(rider.children.length >= 3, `${id} is too plain to read at a distance`);
    } finally { model.dispose(); }
  }
  for (const id of SHOP_HAT_IDS) {
    // Worn by a passenger…
    const withRider = createTvCarModel({ appearance: appearance([id, "panda-copilot"]) as any });
    try {
      const group = withRider.root.getObjectByName("panda-copilot")!;
      assert.ok(group.children.some((child) => child.name.startsWith("hat-")), `${id} is not on the panda`);
      assert.ok(group.position.x > .2);
    } finally { withRider.dispose(); }
    // …and, with an empty seat, by the driver instead.
    const alone = createTvCarModel({ appearance: appearance([id]) as any });
    try {
      const group = alone.root.getObjectByName(id)!;
      assert.ok(group, `${id} vanishes when nobody is riding`);
      assert.equal(group.position.x, 0, `${id} should be on the driver, who sits in the middle`);
      assert.ok(group.children.some((child) => child.name.startsWith("hat-")));
    } finally { alone.dispose(); }
  }
});

test("characters are data, not another chain of id checks", () => {
  const model = read("client/src/components/tv/car-model.ts");
  // The old renderer was `passenger === "goose-copilot" ? ... : ...`, which is
  // why adding one used to mean editing geometry code in three places.
  assert.match(model, /const rider = shopPassengerLook\(SHOP_PASSENGER_IDS\.find\(id=>upgrades\.has\(id\)\)\);/);
  assert.match(model, /const hat = shopHatLook\(SHOP_HAT_IDS\.find\(id=>upgrades\.has\(id\)\)\);/);
  for (const id of SHOP_PASSENGER_IDS) {
    assert.ok(!model.includes(`"${id}"`), `${id} is still hard-coded in the model`);
  }
  // The sunroof cut-out and the slot table read the same list too.
  assert.match(model, /if \(SHOP_PASSENGER_IDS\.some\(id=>upgrades\.has\(id\)\)\) box\(root,\.65,\.02,\.7,\.38,1\.58,-\.18,black\)/);
  const shared = read("shared/tv-car-shop.ts");
  assert.match(shared, /if \(SHOP_PASSENGER_IDS\.includes\(id\)\) return "passenger";/);
  assert.match(shared, /if \(SHOP_HAT_IDS\.includes\(id\)\) return "hat";/);
  // And so does the shop tile, so a new character is never a blank card.
  const shop = read("client/src/components/tv/neon-shop.tsx");
  assert.match(shop, /const look = shopPassengerLook\(item\.id\);/);
  assert.match(shop, /const look = shopHatLook\(item\.id\);/);
  assert.match(shop, /<option value="hat">Hats<\/option>/, "hats are findable in the category filter");
});
