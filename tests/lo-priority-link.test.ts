import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/lo-priority-link.tsx"), "utf8");

const publicBlock = routes.slice(
  routes.indexOf("function loPriorityLink(token: string)"),
  routes.indexOf('app.get("/api/lo-priority-links"'),
);

test("the public link is its own revocable, expiring credential", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS lo_priority_links/);
  assert.match(storage, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lo_priority_links_token/);
  // Not a reuse of the org portal code, which grants check-in access.
  assert.ok(!/portal_code/.test(publicBlock), "must not ride the org portal code");
  assert.match(publicBlock, /revoked_at IS NULL/);
  assert.match(publicBlock, /new Date\(row\.expires_at\)\.getTime\(\) < Date\.now\(\)/);
  // A malformed token must not reach the database as a wildcard.
  assert.match(publicBlock, /\^\[A-Za-z0-9_-\]\{16,64\}\$/);
});

test("the link can ONLY move priority tiers", () => {
  // The read exposes names and tiers, nothing else — no phone, email, NMLS or
  // credential columns.
  const read = publicBlock.slice(publicBlock.indexOf('app.get("/api/lo-priority/:token"'), publicBlock.indexOf('app.post("/api/lo-priority/:token"'));
  assert.match(read, /SELECT id, full_name AS fullName, priority_tier AS priorityTier/);
  for (const leak of ["phone", "email", "bonzo_password", "nmls_id", "other_credentials"]) {
    assert.ok(!read.includes(leak), `the public read must not expose ${leak}`);
  }
  const write = publicBlock.slice(publicBlock.indexOf('app.post("/api/lo-priority/:token"'));
  assert.match(write, /\[1, 2, 3\]\.includes\(c\.tier\)/, "only real tiers");
  assert.match(write, /UPDATE loan_officers SET priority_tier=\?, updated_at=\?/);
  // It must not be able to write anything else about an LO.
  assert.equal((write.match(/UPDATE loan_officers SET/g) ?? []).length, 1);
});

test("a link cannot reach another organization's loan officers", () => {
  const write = publicBlock.slice(publicBlock.indexOf('app.post("/api/lo-priority/:token"'));
  assert.match(write, /FROM loan_officers WHERE id=\? AND org_id=\?/);
  assert.match(write, /WHERE id=\? AND org_id=\?/);
});

test("every change through a link is attributed and audited", () => {
  const write = publicBlock.slice(publicBlock.indexOf('app.post("/api/lo-priority/:token"'));
  assert.match(write, /audit\(\{/);
  assert.match(write, /via share link/);
  assert.match(write, /use_count=use_count\+1/, "usage must be countable");
});

test("only managers can mint or revoke a link", () => {
  for (const p of ['app.get("/api/lo-priority-links"', 'app.post("/api/lo-priority-links"', 'app.post("/api/lo-priority-links/:id/revoke"']) {
    const i = routes.indexOf(p);
    assert.ok(i > 0, `missing ${p}`);
    assert.match(routes.slice(i, i + 300), /requireManagerOrAdmin\(req, res\)/);
  }
});

test("a link expires by default rather than living forever", () => {
  const mint = routes.slice(routes.indexOf('app.post("/api/lo-priority-links"'), routes.indexOf('app.post("/api/lo-priority-links/:id/revoke"'));
  assert.match(mint, /Number\(req\.body\?\.days\) \|\| 7/, "defaults to a week");
  assert.match(mint, /Math\.min\(90,/, "and is capped");
  assert.match(mint, /crypto\.randomBytes\(24\)/, "the token must be unguessable");
});

test("the public routes are exempt from the login wall, and only those", () => {
  assert.match(routes, /if \(req\.path\.startsWith\("\/lo-priority\/"\)\) return next\(\);/);
  // The MANAGEMENT routes live at /lo-priority-links and must NOT be exempted.
  assert.ok(!/startsWith\("\/lo-priority-links/.test(routes), "management routes must stay behind auth");
});

test("the page starts from what is set, so an untouched LO is not rewritten", () => {
  assert.match(page, /for \(const lo of data\.los\) next\[lo\.id\] = Number\(lo\.priorityTier\) \|\| 2/);
  assert.match(page, /draft\[lo\.id\] !== \(Number\(lo\.priorityTier\) \|\| 2\)/, "only changed rows are sent");
});
