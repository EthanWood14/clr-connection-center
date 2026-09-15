import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fitTvCarWrapDimensions, prepareTvCarWrap, TV_CAR_WRAP_INPUT_MAX_BYTES, validateTvCarWrapFile } from "../client/src/lib/tv-car-wrap";
import { TV_CAR_WRAP_MAX_BYTES } from "../shared/tv-car";

test("picture input permits supported raster formats and rejects SVG, empty and oversized files", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(validateTvCarWrapFile({ type, size: 1 }), null);
    assert.equal(validateTvCarWrapFile({ type, size: TV_CAR_WRAP_INPUT_MAX_BYTES }), null);
  }
  for (const type of ["image/svg+xml", "image/gif", "text/html", "", "image/png;script=yes"]) {
    assert.match(validateTvCarWrapFile({ type, size: 2 })!, /PNG, JPG, or WebP/);
  }
  assert.match(validateTvCarWrapFile({ type: "image/png", size: 0 })!, /empty/);
  assert.match(validateTvCarWrapFile({ type: "image/png", size: TV_CAR_WRAP_INPUT_MAX_BYTES + 1 })!, /8 MB/);
});

test("preview dimensions preserve aspect ratio, never upscale and constrain the longest edge", () => {
  assert.deepEqual(fitTvCarWrapDimensions(4000, 2000), { width: 1024, height: 512 });
  assert.deepEqual(fitTvCarWrapDimensions(3000, 6000), { width: 512, height: 1024 });
  assert.deepEqual(fitTvCarWrapDimensions(200, 100), { width: 200, height: 100 });
  assert.deepEqual(fitTvCarWrapDimensions(10000, 1), { width: 1024, height: 1 });
  for (const [width, height] of [[0, 10], [10, 0], [-1, 20], [NaN, 20], [20, Infinity], [9000, 9000]]) {
    assert.throws(() => fitTvCarWrapDimensions(width, height));
  }
});

async function withPictureHarness(options: { sizes?: number[]; badPicture?: boolean }, run: (h: { drawn: number[][]; revoked: string[]; outputs: string[] }) => Promise<void>) {
  const prior = { Image: (globalThis as any).Image, document: (globalThis as any).document, FileReader: (globalThis as any).FileReader, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const drawn: number[][] = [], revoked: string[] = [], outputs: string[] = [];
  let encodes = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => drawn.push([width, height]) }),
    toBlob: (done: (blob: Blob) => void, type: string) => {
      outputs.push(type);
      const sizes = options.sizes ?? [100];
      done(new Blob([new Uint8Array(sizes[Math.min(encodes++, sizes.length - 1)])], { type }));
    },
  };
  (globalThis as any).Image = class {
    naturalWidth = 4000; naturalHeight = 2000;
    onload?: () => void; onerror?: () => void;
    set src(_value: string) { queueMicrotask(() => options.badPicture ? this.onerror?.() : this.onload?.()); }
  };
  (globalThis as any).document = { createElement: (tag: string) => { assert.equal(tag, "canvas"); return canvas; } };
  (globalThis as any).FileReader = class {
    result = "data:image/png;base64,normalized-pixels";
    onload?: () => void;
    readAsDataURL(blob: Blob) { assert.equal(blob.type, "image/png"); queueMicrotask(() => this.onload?.()); }
  };
  URL.createObjectURL = () => "blob:local-input";
  URL.revokeObjectURL = url => { revoked.push(url); };
  try { await run({ drawn, revoked, outputs }); }
  finally {
    (globalThis as any).Image = prior.Image; (globalThis as any).document = prior.document; (globalThis as any).FileReader = prior.FileReader;
    URL.createObjectURL = prior.create; URL.revokeObjectURL = prior.revoke;
  }
}

const photo = { name: "my photo.jpg", type: "image/jpeg", size: 20_000 } as File;

test("upload preparation always re-encodes decoded pixels and releases its local object URL", async () => {
  await withPictureHarness({}, async h => {
    const prepared = await prepareTvCarWrap(photo);
    assert.equal(prepared.blob.type, "image/png");
    assert.equal(prepared.name, photo.name);
    assert.equal(prepared.width, 1024);
    assert.equal(prepared.height, 512);
    assert.match(prepared.previewUrl, /^data:image\/png;/);
    assert.deepEqual(h.drawn, [[1024, 512]]);
    assert.deepEqual(h.outputs, ["image/png"]);
    assert.deepEqual(h.revoked, ["blob:local-input"]);
  });
});

test("large PNG output shrinks again until it fits the secure upload limit", async () => {
  await withPictureHarness({ sizes: [TV_CAR_WRAP_MAX_BYTES + 1, 500_000] }, async h => {
    const prepared = await prepareTvCarWrap(photo);
    assert.equal(prepared.blob.size, 500_000);
    assert.deepEqual(h.drawn, [[1024, 512], [819, 409]]);
    assert.equal(prepared.width, 819);
    assert.equal(prepared.height, 409);
  });
});

test("decode failures keep image errors usable and still release the temporary URL", async () => {
  await withPictureHarness({ badPicture: true }, async h => {
    await assert.rejects(prepareTvCarWrap(photo), /could not be opened/);
    assert.deepEqual(h.revoked, ["blob:local-input"]);
    assert.deepEqual(h.drawn, []);
  });
});

test("actual TV race body panels show authenticated wraps with paint fallback and owned textures", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  assert.match(scene, /isSafeTvCarWrapUrl\(driver\.car\.wrapUrl\)/);
  assert.match(scene, /wrapLoader\.load\(driver\.car\.wrapUrl,picture=>\{\s*if\(disposed\)return/);
  assert.match(scene, /context\.fillStyle=driver\.color/);
  assert.match(scene, /const texture=keep\(new THREE\.CanvasTexture\(canvas\)\)/);
  assert.match(scene, /bodyPaint\.map=texture/);
  assert.equal((scene.match(/rounded\(root,[^\n]*bodyPaint/g) ?? []).length, 3, "all three body panels get the wrap");
  assert.match(scene, /const stripeOffsets=driver\.car\.livery/);
  assert.match(scene, /missing\/revoked picture leaves the normal paint visible/);
  assert.match(scene, /redrawWraps=\(\)=>\{if\(!disposed\)\{try\{renderer\.render\(scene,camera\)/);
  assert.doesNotMatch(scene.slice(scene.indexOf("redrawWraps=()=>{if")), /requestAnimationFrame\(redrawWraps/);
});
