import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the Shark Tank feature is fully removed", () => {
  // Removed 2026-08-14 at the owner's request. This guards against a partial
  // revival — a dangling route, a nav entry pointing at a deleted page, or a
  // cron calling a module that no longer exists.
  for (const gone of ["client/src/pages/shark-tank.tsx", "server/shark-tank-sync.ts"]) {
    assert.ok(!existsSync(join(root, gone)), `${gone} must be deleted`);
  }
  for (const f of ["server/routes.ts", "server/storage.ts", "client/src/App.tsx",
                   "client/src/components/app-sidebar.tsx", "AGENTS.md"]) {
    const text = readFileSync(join(root, f), "utf8");
    assert.ok(!/shark/i.test(text), `${f} still references shark tank`);
  }
});
