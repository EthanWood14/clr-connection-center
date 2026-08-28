import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPortalAccount, clrRoleMatches, CLR_PORTAL_SQL } from "../server/clr-roster";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("portal accounts are never CLRs", () => {
  // The synthetic shared-gate user is the one that was mailed EOD reminders
  // and escalating overdue notices for reports it can never file.
  const shared = { id: 961, role: "assistant", portal: "lap", isActive: true };
  assert.equal(isPortalAccount(shared), true);
  assert.equal(clrRoleMatches(shared), false);
  assert.equal(clrRoleMatches({ role: "assistant", portal: "lop" }), false);
  // Internal staff are unaffected.
  assert.equal(clrRoleMatches({ role: "assistant", portal: null }), true);
  assert.equal(clrRoleMatches({ role: "assistant", portal: "c3" }), true);
  assert.equal(clrRoleMatches({ role: "admin", isClr: true }), true);
  assert.equal(clrRoleMatches({ role: "admin", is_clr: 1 }), true);
  // An admin who is not a CLR still isn't one.
  assert.equal(clrRoleMatches({ role: "admin" }), false);
  assert.equal(clrRoleMatches({ role: "viewer" }), false);
  assert.equal(clrRoleMatches(null), false);
});

test("every hand-rolled CLR role filter now goes through the predicate", () => {
  // Ten copies of this test existed inline; each was a place a portal account
  // could leak into a roster.
  assert.ok(!routes.includes('(u.role === "assistant" || (u.role === "admin" && u.isClr))'),
    "no inline copy of the CLR role filter may remain");
  assert.ok(routes.split("clrRoleMatches(u)").length - 1 >= 10);
});

test("raw roster SQL excludes portal accounts too", () => {
  assert.equal(CLR_PORTAL_SQL, "(portal IS NULL OR portal = 'c3')");
  // The EOD reminder roster is the query that actually sent the mail.
  const reminder = routes.slice(routes.indexOf("SELECT id, name, email, created_at"), routes.indexOf("if (!clrs.length) continue;"));
  assert.match(reminder, /AND \$\{CLR_PORTAL_SQL\}/);
  const assignment = routes.slice(routes.indexOf("SELECT id, name FROM users"), routes.indexOf("in_daily_assignments = 1"));
  assert.match(assignment, /AND \$\{CLR_PORTAL_SQL\}/);
});

test("the overdue reminder subject reads correctly at any number", () => {
  // The subject hardcoded "th" for every count past two, so the third notice
  // went out as "(3th reminder)". The countLabel helper elsewhere is correct
  // for 4th/5th and is deliberately left alone.
  const subject = routes.slice(routes.indexOf("const subject = sendCount === 1"), routes.indexOf("const subject = sendCount === 1") + 500);
  assert.ok(!subject.includes("${sendCount}th reminder"), "the subject must not hardcode a th ordinal");
  assert.match(subject, /\(reminder #\$\{sendCount\}\)/);
});
