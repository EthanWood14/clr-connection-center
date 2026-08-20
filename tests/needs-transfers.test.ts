import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/state-lookup.tsx"), "utf8");

test("any number of loan officers can be flagged as needing transfers", () => {
  const fn = routes.slice(routes.indexOf('app.post("/api/loan-officers/:id/needs-transfers"'), routes.indexOf('app.patch("/api/loan-officers/:id"'));
  assert.doesNotMatch(fn, /NEEDS_TRANSFERS_MAX/);
  assert.doesNotMatch(fn, /Only .* loan officers can need transfers at once/);
  assert.doesNotMatch(fn, /SELECT COUNT\(\*\).*needs_transfers/s,
    "flagging must not depend on how many LOs are already flagged");
  assert.match(fn, /requireManagerOrAdmin\(req, res\)/);
  assert.match(fn, /org_id=\?/, "must not flag another org's LO");
});

test("flagged LOs are pinned to the top of every state they cover", () => {
  // Ahead of both sort modes — being flagged is the whole point.
  assert.match(page, /\(\(b\.needsTransfers \? 1 : 0\) - \(a\.needsTransfers \? 1 : 0\)\) \|\|/);
  assert.match(page, /Needs transfers/);
  assert.match(page, /data-testid=\{lo\.needsTransfers \? `lo-needs-transfers-\$\{lo\.id\}` : undefined\}/);
});

test("the shortlist is visible without hunting for a highlight", () => {
  assert.match(page, /data-testid="needs-transfers-summary"/);
  assert.match(page, /\{flaggedNames\.join\(", "\)\}/);
});

test("only managers can change the list, and a refusal is surfaced", () => {
  assert.match(page, /isAdminOrManager && \(/);
  assert.match(page, /data-testid=\{`toggle-needs-transfers-\$\{lo\.id\}`\}/);
  assert.match(page, /onError:[\s\S]{0,120}variant: "destructive"/, "a 409 must not be swallowed");
  assert.match(storage, /ALTER TABLE loan_officers ADD COLUMN needs_transfers INTEGER NOT NULL DEFAULT 0/);
  assert.match(storage, /needs_transfers: "needsTransfers"/, "the flag must reach the client");
});
