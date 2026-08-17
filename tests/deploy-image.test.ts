import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("the base image is new enough for the SQLite driver's prebuilds", () => {
  // better-sqlite3 12.x ships prebuilds from ABI 127 (Node 22) upward. On
  // Node 20 there is nothing to fetch for any libc, so the image built green
  // and then failed to start. Verified against the release assets 2026-08-17.
  const bases = dockerfile.match(/^FROM node:(\d+)/gm) ?? [];
  assert.equal(bases.length, 2, "builder and runner stages");
  for (const b of bases) {
    const major = Number(/node:(\d+)/.exec(b)![1]);
    assert.ok(major >= 22, `${b} is too old for better-sqlite3 12.x prebuilds`);
  }
  // Both stages must agree — a binary built on one and run on the other has to
  // match ABI and libc.
  assert.equal(new Set(bases).size, 1, "builder and runner must be the same base");
});

test("the driver version and the base image cannot drift apart", () => {
  const version = String(pkg.dependencies["better-sqlite3"] ?? "");
  assert.match(version, /^\^?12\./, "if this moves, re-check the prebuilt ABI list");
});

test("a compiler is available as a fallback, and removed from the layer", () => {
  // Not the normal path — with a matching prebuild it goes unused. It exists so
  // a future bump that drops prebuilds degrades to a slow build, not a broken
  // image. Deleted in the same RUN so it never reaches the shipped filesystem.
  const runs = dockerfile.match(/RUN apk add[\s\S]*?npm ci[\s\S]*?apk del \.build-deps/g) ?? [];
  assert.equal(runs.length, 2, "both stages need the fallback");
  for (const r of runs) assert.match(r, /--virtual \.build-deps/);
});

test("no login credential is hardcoded in the server", () => {
  // An imported account used to be created with a shared literal password and
  // must_change_password=0 — a known-good credential for a live account,
  // committed forever.
  assert.ok(!/WCL2026/.test(routes), "no password literal may live in the repo");
  const block = routes.slice(routes.indexOf("Find or create Randy Hammond"), routes.indexOf("// LO matcher"));
  assert.match(block, /crypto\.randomBytes\(24\)/, "unguessable secret instead of a shared default");
  assert.match(block, /VALUES \(\?, \?, 'assistant', 1, 1, 0, 0, \?, 1, \?, 0, \?\)/,
    "must_change_password must be 1 so the placeholder secret cannot be used");
});
