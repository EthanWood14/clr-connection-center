import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createBlankCarSkin, paintCarSkin, presetCarSkin, skinToRgba, validateTvCarSkin,
} from "../shared/tv-car-skin";
import {
  MAX_CAR_SKIN_IMPORT_BYTES, CAR_SKIN_HISTORY_LIMIT, parseTvCarSkinJson, validateCarSkinPngHeader,
  importTvCarSkinFile, exportTvCarSkinJson, exportTvCarSkinPng, rememberCarSkin, stepCarSkinHistory,
} from "../client/src/lib/tv-car-skin";
import { CarSkinEditor } from "../client/src/components/tv/car-skin-editor";

function pngHeader(width = 64, height = 48) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
const file = (data: string | Uint8Array, name: string, type: string) => ({
  name, type, size: typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength,
  text: async () => String(data), arrayBuffer: async () => typeof data === "string" ? new TextEncoder().encode(data).buffer : data.buffer,
}) as File;

test("JSON skin import/export round trips exact valid pixel data", async () => {
  const skin = presetCarSkin("checker", "#234567", "#abc123");
  const blob = exportTvCarSkinJson(skin);
  assert.equal(blob.type, "application/json");
  const json = await blob.text();
  assert.deepEqual(parseTvCarSkinJson(json), skin);
  assert.deepEqual(await importTvCarSkinFile(file(json, "racing.json", "application/json")), skin);
  assert.deepEqual(await importTvCarSkinFile(file(json, "racing.JSON", "")), skin);
});

test("skin imports reject invalid data, executable metadata, unsupported types and oversized files", async () => {
  assert.throws(() => parseTvCarSkinJson("<script>alert(1)</script>"), /not readable/);
  assert.throws(() => parseTvCarSkinJson(JSON.stringify({ ...createBlankCarSkin(), url: "https://other.test/picture" })), /not a valid/);
  assert.throws(() => parseTvCarSkinJson(JSON.stringify({ ...createBlankCarSkin(), version: 2 })), /not a valid/);
  assert.throws(() => parseTvCarSkinJson(" ".repeat(MAX_CAR_SKIN_IMPORT_BYTES + 1)), /128 KB/);
  for (const input of [
    file("svg", "skin.svg", "image/svg+xml"), file("png", "skin.png", "text/html"),
    file("json", "skin.json", "application/javascript"), file("jpg", "skin.jpg", "image/jpeg"),
    file("", "empty.json", "application/json"), { ...file("png", "skin.png", "image/png"), size: MAX_CAR_SKIN_IMPORT_BYTES + 1 },
  ]) await assert.rejects(importTvCarSkinFile(input as File));
});

test("PNG dimensions and signature are validated before any bitmap decoder runs", async () => {
  assert.doesNotThrow(() => validateCarSkinPngHeader(pngHeader()));
  for (const bytes of [new Uint8Array(), new Uint8Array(33), pngHeader(100000, 100000), pngHeader(64, 64)]) {
    assert.throws(() => validateCarSkinPngHeader(bytes));
  }
  let decoded = false;
  const previous = (globalThis as any).createImageBitmap;
  (globalThis as any).createImageBitmap = () => { decoded = true; throw new Error("should not decode"); };
  try {
    await assert.rejects(importTvCarSkinFile(file(pngHeader(8192, 8192), "huge.png", "image/png")), /exactly 64/);
    assert.equal(decoded, false);
  } finally { (globalThis as any).createImageBitmap = previous; }
});

test("PNG import reads only decoded pixels and always closes its bitmap", async () => {
  const original = paintCarSkin(createBlankCarSkin(), "wings", 5, 6, "3");
  const rgba = skinToRgba(original);
  let closed = 0, drawn = 0;
  const prior = { bitmap: (globalThis as any).createImageBitmap, document: (globalThis as any).document };
  (globalThis as any).createImageBitmap = async (blob: Blob) => {
    assert.equal(blob.type, "image/png");
    return { width: 64, height: 48, close: () => closed++ };
  };
  (globalThis as any).document = { createElement: (tag: string) => {
    assert.equal(tag, "canvas");
    return { width: 0, height: 0, getContext: () => ({ drawImage: () => drawn++, getImageData: () => ({ data: rgba }) }) };
  } };
  try {
    const imported = await importTvCarSkinFile(file(pngHeader(), "skin.png", "image/png"));
    assert.ok(validateTvCarSkin(imported));
    assert.deepEqual(skinToRgba(imported), rgba, "palette remapping must retain the exact displayed pixels");
    assert.equal(closed, 1); assert.equal(drawn, 1);
    (globalThis as any).document = { createElement: () => ({ getContext: () => null }) };
    await assert.rejects(importTvCarSkinFile(file(pngHeader(), "skin.png", "image/png")), /canvas/);
    assert.equal(closed, 2, "decoder resources are freed even when drawing fails");
  } finally { (globalThis as any).createImageBitmap = prior.bitmap; (globalThis as any).document = prior.document; }
});

test("PNG export writes the exact 64 × 48 atlas with transparency preserved", async () => {
  const skin = paintCarSkin(createBlankCarSkin(), "left", 3, 4, "1");
  const expected = skinToRgba(skin);
  let captured: Uint8ClampedArray | null = null;
  const prior = (globalThis as any).document;
  const canvas = { width: 0, height: 0, getContext: () => ({
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (image: { data: Uint8ClampedArray }) => { captured = image.data; },
  }), toBlob: (callback: (value: Blob) => void, type: string) => callback(new Blob(["png"], { type })) };
  (globalThis as any).document = { createElement: () => canvas };
  try {
    const result = await exportTvCarSkinPng(skin);
    assert.equal(result.type, "image/png");
    assert.deepEqual(captured, expected);
    assert.equal(canvas.width, 64); assert.equal(canvas.height, 48);
  } finally { (globalThis as any).document = prior; }
});

test("undo and redo retain at most 40 immutable complete skin snapshots", () => {
  let current = createBlankCarSkin();
  let history = { past: [] as typeof current[], future: [] as typeof current[] };
  for (let index = 0; index < 45; index++) {
    history = rememberCarSkin(history, current);
    current = paintCarSkin(current, "top", index % 32, Math.floor(index / 32), "0");
  }
  assert.equal(history.past.length, CAR_SKIN_HISTORY_LIMIT);
  const final = current;
  const back = stepCarSkinHistory(history, current, "undo");
  assert.notDeepEqual(back.skin, final);
  const forward = stepCarSkinHistory(back.history, back.skin, "redo");
  assert.deepEqual(forward.skin, final);
  assert.deepEqual(forward.history, history);
  const branched = rememberCarSkin(back.history, back.skin);
  assert.deepEqual(branched.future, [], "a new edit discards the abandoned redo branch");
  assert.equal(history.past.length, 40, "older history was not mutated");
});

test("starter presets can be undone without losing the previous design", () => {
  const mine = paintCarSkin(createBlankCarSkin(), "nose", 12, 3, "a");
  for (const name of ["racer", "checker", "flames"] as const) {
    const starter = presetCarSkin(name);
    const history = rememberCarSkin({ past: [], future: [] }, mine);
    assert.deepEqual(stepCarSkinHistory(history, starter, "undo").skin, mine);
  }
});

test("pixel workshop renders all six panels, a keyboard grid, tools, palette and draft-only controls", () => {
  const html = renderToStaticMarkup(React.createElement(CarSkinEditor, { skin: createBlankCarSkin(), onChange: () => {}, bodyColor: "#123456", accentColor: "#abcdef" }));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 6);
  assert.equal((html.match(/role="gridcell"/g) ?? []).length, 512);
  assert.equal((html.match(/aria-label="Select color /g) ?? []).length, 16);
  assert.equal((html.match(/role="gridcell"[^>]*tabindex="0"/g) ?? []).length, 1, "only the active pixel is in the keyboard tab order");
  assert.equal((html.match(/role="tab"[^>]*tabindex="0"/g) ?? []).length, 1, "panel tabs use roving keyboard focus");
  for (const label of ["Pencil", "Erase", "Fill", "Pick color", "Undo", "Redo", "Mirror left / right", "Import skin", "Export PNG", "Export JSON", "Transparent pixels show your body paint"]) assert.ok(html.includes(label), label);
  assert.match(html, /Save button to put your skin on the TV/);
  const source = readFileSync(new URL("../client/src/components/tv/car-skin-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /onPointerCancel=\{endStroke\}/);
  assert.match(source, /ArrowLeft: \[-1, 0\]/);
  assert.match(source, /event\.key === " " \|\| event\.key === "Enter"/);
  assert.match(source, /event\.detail === 0 && !blocked/);
  assert.match(source, /onKeyDown=\{panelKey\}/);
  assert.match(source, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(source, /setBusy\(true\); busyCallback\.current\?\.\(true\)/);
  assert.match(source, /finally \{ if \(ticket === request\.current\) \{ setBusy\(false\); busyCallback\.current\?\.\(false\); \} \}/);
  assert.match(source, /request\.current\+\+; busyCallback\.current\?\.\(false\)/, "unmount cancels imports and releases parent save guard");
  assert.doesNotMatch(source, /apiRequest|fetch\(|localStorage|sessionStorage/);
});

test("disabled workshop has no editable pixel or file controls", () => {
  const html = renderToStaticMarkup(React.createElement(CarSkinEditor, { skin: createBlankCarSkin(), onChange: () => {}, disabled: true, bodyColor: "#123456", accentColor: "#abcdef" }));
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttons.length > 512);
  assert.ok(buttons.every(tag => tag.includes('disabled=""')));
  for (const tag of html.match(/<(?:input|select)\b[^>]*>/g) ?? []) assert.ok(tag.includes('disabled=""'), tag);
});
