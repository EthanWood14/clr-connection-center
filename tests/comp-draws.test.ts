import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isCompDrawPerson, compDrawPeople } from "../shared/comp-draws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/comp-requests.tsx"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("Ethan Wood style admin (isClr=false) can receive a draw", () => {
  // Seeded as role=admin, is_clr=0, super_admin=1. Draws used to reuse the
  // CLR-only person filter and omit him from the dropdown.
  assert.equal(
    isCompDrawPerson({ id: 1, name: "Ethan Wood", role: "admin", isActive: true, isClr: false }),
    true,
  );
  assert.equal(
    isCompDrawPerson({ id: 1, name: "Ethan Wood", role: "admin", is_active: 1, is_clr: 0 }),
    true,
  );
});

test("admin flagged as CLR still can receive a draw", () => {
  assert.equal(
    isCompDrawPerson({ role: "admin", isActive: true, isClr: true }),
    true,
  );
});

test("active assistant CLR can receive a draw", () => {
  assert.equal(
    isCompDrawPerson({ role: "assistant", isActive: true, isClr: true }),
    true,
  );
});

test("inactive people and viewers and portal accounts cannot", () => {
  assert.equal(isCompDrawPerson({ role: "admin", isActive: false }), false);
  assert.equal(isCompDrawPerson({ role: "viewer", isActive: true }), false);
  assert.equal(isCompDrawPerson({ role: "assistant", isActive: true, portal: "lap" }), false);
  assert.equal(isCompDrawPerson({ role: "assistant", isActive: true, portal: "lop" }), false);
  assert.equal(isCompDrawPerson(null), false);
});

test("compDrawPeople sorts and keeps Ethan alongside CLRs", () => {
  const names = compDrawPeople([
    { id: 2, name: "Zed CLR", role: "assistant", isActive: true },
    { id: 1, name: "Ethan Wood", role: "admin", isActive: true, isClr: false },
    { id: 3, name: "Amy CLR", role: "assistant", isActive: true },
    { id: 4, name: "LAP Person", role: "assistant", isActive: true, portal: "lap" },
    { id: 5, name: "Gone", role: "admin", isActive: false },
  ]).map((u) => u.name);
  assert.deepEqual(names, ["Amy CLR", "Ethan Wood", "Zed CLR"]);
});

test("DrawsPanel uses the shared eligibility helper, not a CLR-only filter", () => {
  assert.match(page, /import \{ compDrawPeople \} from "@shared\/comp-draws"/);
  assert.match(page, /compDrawPeople\(users/);
  // The old CLR-only line must not remain as the Draws staff filter.
  const drawsStart = page.indexOf("function DrawsPanel()");
  const drawsEnd = page.indexOf("function ManagersPanel()");
  assert.ok(drawsStart >= 0 && drawsEnd > drawsStart, "DrawsPanel / ManagersPanel anchors");
  const draws = page.slice(drawsStart, drawsEnd);
  assert.doesNotMatch(
    draws,
    /admin && u\.isClr/,
    "Draws person list must not require isClr on admins",
  );
});

test("POST /api/comp/draws applies the same eligibility check", () => {
  assert.match(routes, /import \{ isCompDrawPerson \} from "@shared\/comp-draws"/);
  const postStart = routes.indexOf('app.post("/api/comp/draws"');
  const postEnd = routes.indexOf('app.post("/api/comp/draws/:id/settle"');
  assert.ok(postStart >= 0 && postEnd > postStart);
  const post = routes.slice(postStart, postEnd);
  assert.match(post, /isCompDrawPerson\(target\)/);
});
