import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

test("C3 and LAP publish distinct installable-app identities", () => {
  const c3 = JSON.parse(read("client/public/manifest.json"));
  const lap = JSON.parse(read("client/public/manifest-lap.json"));

  assert.equal(typeof c3.id, "string");
  assert.equal(typeof lap.id, "string");
  assert.notEqual(c3.id, lap.id);
  assert.equal(c3.start_url, "/#/");
  assert.equal(lap.start_url, "/#/lap");
  assert.notEqual(c3.theme_color, lap.theme_color);
  assert.equal(c3.orientation, undefined, "C3 must remain usable in landscape");
  assert.equal(lap.orientation, undefined, "LAP must remain usable in landscape");

  for (const shortcut of c3.shortcuts ?? []) {
    assert.match(shortcut.url, /^\/#\//, `C3 shortcut ${shortcut.name} must use hash routing`);
  }
  for (const shortcut of lap.shortcuts ?? []) {
    assert.match(shortcut.url, /^\/#\/lap(?:\/|$)/, `LAP shortcut ${shortcut.name} must stay in LAP`);
  }

  const lapIconSources = new Set((lap.icons ?? []).map((icon: any) => String(icon.src)));
  assert.ok(lapIconSources.has("/lap-icon-192.png"));
  assert.ok(lapIconSources.has("/lap-icon-512.png"));
  assert.ok(existsSync(join(root, "client/public/lap-icon-192.png")));
  assert.ok(existsSync(join(root, "client/public/lap-icon-512.png")));
});

test("service worker updates are release-aware and do not delete unrelated origin caches", () => {
  const main = read("client/src/main.tsx");
  const index = read("client/index.html");
  const worker = read("client/public/sw.js");

  assert.match(main, /APP_VERSION/);
  assert.match(main, /serviceWorker\.register\(`\/sw\.js\?v=\$\{release\}`/);
  assert.match(main, /updateViaCache:\s*"none"/);
  assert.doesNotMatch(index, /serviceWorker\.register/);

  assert.match(worker, /CACHE_PREFIX/);
  assert.match(worker, /startsWith\(CACHE_PREFIX\)/);
  assert.doesNotMatch(
    worker,
    /\.filter\(\(key\)\s*=>\s*key\s*!==\s*CACHE_NAME\)/,
    "activation must not delete caches owned by other apps on the origin",
  );
  assert.match(worker, /parsed\.origin\s*!==\s*self\.location\.origin/);
});

test("portal metadata is selected before the React app renders", () => {
  const main = read("client/src/main.tsx");
  const metadata = read("client/src/lib/product-metadata.ts");

  assert.match(main, /applyProductMetadata\(detectProductPortal\(\)/);
  assert.match(metadata, /#\\\/lap/);
  assert.match(metadata, /manifest-lap\.json/);
  assert.match(metadata, /lap-icon-192\.png/);
});
