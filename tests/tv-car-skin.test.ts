import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAR_SKIN_PANELS, createBlankCarSkin, validateTvCarSkin, paintCarSkin, fillCarSkin,
  sampleCarSkin, presetCarSkin, skinPanelRgba, skinToRgba, skinFromRgba,
  PANEL_WIDTH, PANEL_HEIGHT, SKIN_ATLAS_WIDTH, SKIN_ATLAS_HEIGHT,
} from "../shared/tv-car-skin";
import { normalizeTvCarAppearance, validateTvCarAppearance } from "../shared/tv-car";

test("skin contract is six independent 32×16 surfaces with exactly 16 safe colors", () => {
  const skin = createBlankCarSkin();
  assert.equal(PANEL_WIDTH, 32); assert.equal(PANEL_HEIGHT, 16);
  assert.equal(skin.palette.length, 16);
  assert.deepEqual(Object.keys(skin.panels).sort(), ["left", "nose", "rear", "right", "top", "wings"]);
  assert.deepEqual(validateTvCarSkin(skin), skin);
  assert.ok(JSON.stringify(skin).length < 4000, "pixel preferences stay small, no large images in main database");
  const other = createBlankCarSkin(); other.palette[0] = "#000000";
  assert.notEqual(other.palette[0], skin.palette[0]);
});

test("skin validation is bounded and rejects URLs, unknown metadata, missing panels and malformed pixels", () => {
  const skin = createBlankCarSkin();
  for (const bad of [null, "x", [], {}, { ...skin, version: 2 }, { ...skin, userId: 1 },
    { ...skin, palette: skin.palette.slice(1) }, { ...skin, palette: [...skin.palette, "#ffffff"] },
    { ...skin, palette: new Array(16) }, { ...skin, palette: ["#123abc\n", ...skin.palette.slice(1)] },
    { ...skin, palette: ["url(https://example.invalid)", ...skin.palette.slice(1)] },
    { ...skin, panels: { ...skin.panels, top: ".".repeat(513) } },
    { ...skin, panels: { ...skin.panels, top: ".".repeat(512) + "\n" } },
    { ...skin, panels: { ...skin.panels, top: "z".repeat(512) } },
    { ...skin, panels: { ...skin.panels, top: [] } },
    { ...skin, panels: { ...skin.panels, wheels: ".".repeat(512) } },
    { ...skin, panels: { top: ".".repeat(512) } },
  ]) assert.equal(validateTvCarSkin(bad), null);
});

test("validated skins are copied and normalized instead of retaining caller-owned structures", () => {
  const skin = createBlankCarSkin(); skin.palette[0] = "#ABCDEF";
  const safe = validateTvCarSkin(skin)!;
  assert.equal(safe.palette[0], "#abcdef");
  skin.palette[0] = "#000000"; skin.panels.top = "0".repeat(512);
  assert.equal(safe.palette[0], "#abcdef"); assert.equal(safe.panels.top, ".".repeat(512));
});

test("pencil painting clips to panel bounds, supports square brushes and mirrors without mutating", () => {
  const skin = createBlankCarSkin();
  const painted = paintCarSkin(skin, "left", 31, 15, "a", 4, true);
  assert.equal(sampleCarSkin(painted, "left", 31, 15), "a");
  assert.equal(sampleCarSkin(painted, "left", 0, 15), "a");
  assert.equal(painted.panels.left.split("a").length - 1, 2);
  assert.equal(painted.panels.right, skin.panels.right);
  assert.equal(skin.panels.left, ".".repeat(512));
  const square = paintCarSkin(skin, "top", 0, 0, "f", 2);
  assert.equal(square.panels.top.split("f").length - 1, 4);
  assert.strictEqual(paintCarSkin(square, "top", 0, 0, "f", 2), square);
  assert.strictEqual(paintCarSkin(skin, "top", -1, 0, "0"), skin);
  assert.strictEqual(paintCarSkin(skin, "top", 1.5, 0, "0"), skin);
  assert.strictEqual(paintCarSkin(skin, "top", 0, 0, "g"), skin);
  assert.strictEqual(paintCarSkin(skin, "top", 0, 0, "0", 512), skin);
});

test("bucket fill does not wrap rows or cross boundaries and eraser preserves other panels", () => {
  let skin = createBlankCarSkin();
  for (let y = 0; y < 16; y++) skin = paintCarSkin(skin, "top", 16, y, "1");
  const filled = fillCarSkin(skin, "top", 0, 0, "2");
  assert.equal(filled.panels.top.split("2").length - 1, 256);
  assert.equal(sampleCarSkin(filled, "top", 17, 0), ".");
  assert.equal(sampleCarSkin(filled, "top", 16, 10), "1");
  assert.equal(filled.panels.left, skin.panels.left);
  assert.strictEqual(fillCarSkin(filled, "top", 0, 0, "2"), filled);
  assert.equal(sampleCarSkin(paintCarSkin(filled, "top", 0, 0, "."), "top", 0, 0), ".");
  assert.equal(sampleCarSkin(skin, "top", 32, 1), ".");
});

test("starter skins produce valid independent designs with the saved body/accent palette", () => {
  const presets = ["racer", "checker", "flames"] as const;
  const skins = presets.map(name => presetCarSkin(name, "#123456", "#ABCDEF"));
  for (const skin of skins) {
    assert.ok(validateTvCarSkin(skin));
    assert.equal(skin.palette[0], "#123456"); assert.equal(skin.palette[1], "#abcdef");
  }
  assert.equal(new Set(skins.map(skin => skin.panels.top)).size, 3);
});

test("3D panel pixels resolve transparency over saved paint and preserve authored colors", () => {
  const skin = paintCarSkin(createBlankCarSkin(), "nose", 1, 0, "f");
  const pixels = skinPanelRgba(skin, "nose", "#123456");
  assert.equal(pixels.length, 32 * 16 * 4);
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [18, 52, 86, 255]);
  assert.deepEqual(Array.from(pixels.slice(4, 8)), [9, 13, 20, 255]);
});

test("portable PNG atlas preserves all six panel coordinates and transparency on roundtrip", () => {
  let skin = createBlankCarSkin();
  CAR_SKIN_PANELS.forEach(({ id }, index) => { skin = paintCarSkin(skin, id, index, index, index.toString(16)); });
  const pixels = skinToRgba(skin);
  assert.equal(pixels.length, 64 * 48 * 4);
  const imported = skinFromRgba(pixels, SKIN_ATLAS_WIDTH, SKIN_ATLAS_HEIGHT);
  assert.deepEqual(skinToRgba(imported), pixels);
  assert.ok(validateTvCarSkin(imported));
  assert.equal(imported.panels.top[1], ".");
});

test("PNG atlas import rejects wrong layout, corrupt buffer and over-16 palettes", () => {
  assert.throws(() => skinFromRgba(new Uint8ClampedArray(64 * 64 * 4), 64, 64), /different layout/);
  assert.throws(() => skinFromRgba(new Uint8ClampedArray(3), 64, 48), /64/);
  const pixels = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < 17; i++) { pixels[i * 4] = i; pixels[i * 4 + 3] = 255; }
  assert.throws(() => skinFromRgba(pixels, 64, 48), /16 colors/);
});

test("appearance reads accept only validated skin, while ordinary paint writes remain strict", () => {
  const paint = { bodyColor: "#123456", accentColor: "#ffffff", livery: "solid" };
  const skin = presetCarSkin("checker");
  assert.deepEqual(normalizeTvCarAppearance({ ...paint, skin }, 7).skin, skin);
  assert.equal(normalizeTvCarAppearance({ ...paint, skin: { ...skin, version: 99 } }, 7).skin, undefined);
  assert.equal(validateTvCarAppearance({ ...paint, skin }), null, "skin never sneaks through paint-only saves");
});
