import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/state-lookup.tsx"), "utf8");

test("the shortlist is capped at three, and the cap is enforced server-side", () => {
  // The cap IS the feature — a priority flag with no limit drifts to "everyone
  // is a priority", which carries no information.
  assert.match(routes, /const NEEDS_TRANSFERS_MAX = 3/);
  const fn = routes.slice(routes.indexOf('app.post("/api/loan-officers/:id/needs-transfers"'), routes.indexOf('app.patch("/api/loan-officers/:id"'));
  assert.match(fn, /Number\(current\.c\) >= NEEDS_TRANSFERS_MAX/);
  assert.match(fn, /res\.status\(409\)/, "refuse rather than silently bumping someone off");
  assert.match(fn, /Clear one first/, "…and name who currently holds the slots");
  assert.match(fn, /requireManagerOrAdmin\(req, res\)/);
  assert.match(fn, /org_id=\?/, "must not flag another org's LO");
});

test("unflagging is never blocked by the cap", () => {
  // Otherwise a full list could not be edited at all.
  const fn = routes.slice(routes.indexOf('app.post("/api/loan-officers/:id/needs-transfers"'), routes.indexOf('app.patch("/api/loan-officers/:id"'));
  assert.ok(fn.indexOf("if (on) {") < fn.indexOf("NEEDS_TRANSFERS_MAX"), "the cap check only runs when turning it ON");
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
