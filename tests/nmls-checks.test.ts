import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canRunNmlsCheckAll } from "../server/clr-roster";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const routesSrc = routes;
const sidebarSrc = readFileSync(join(root, "client/src/components/app-sidebar.tsx"), "utf8");
const statusPageSrc = readFileSync(join(root, "client/src/pages/nmls-status.tsx"), "utf8");

test("an escalated NMLS check is still outstanding, not done", () => {
  // The escalation cron flips a row from 'pending' to 'escalated'. Both lists
  // used to filter on 'pending', so escalating a check removed it from the page
  // entirely and the tracker read as complete while the licence was unverified.
  const route = routes.slice(
    routes.indexOf(`app.get("/api/nmls-checks/my-pending"`),
    routes.indexOf(`app.post("/api/nmls-checks/:loId/confirm"`),
  );
  assert.match(route, /const isOpen = \(c: any\) => c\.status !== "confirmed";/,
    "only a confirmed check is done");
  assert.ok(!/status === "pending"/.test(route),
    "neither list may filter on 'pending' — that hides every escalated check");
  assert.match(route, /\.filter\(\(c: any\) => c\.assigned_to === userId && isOpen\(c\)\)/);
  assert.match(route, /\.filter\(\(c: any\) => isOpen\(c\) && c\.assigned_to !== userId\)/);
});

test("escalated checks are still chased by the reminder cron", () => {
  const idx = routes.indexOf("const pending = storageExtra.getNmlsChecksForPeriod(periodKey)");
  assert.ok(idx > 0, "the reminder still counts outstanding checks");
  const line = routes.slice(idx, idx + 160);
  assert.match(line, /c\.status !== "confirmed"/,
    "an escalated check must keep being reminded about, not go quiet");
});

test("confirming works on an escalated check", () => {
  // The fix surfaces escalated checks, so clearing one has to actually work —
  // the update must not be restricted to pending rows.
  const fn = storage.slice(storage.indexOf("export function confirmNmlsCheck"), storage.indexOf("export function getPendingNmlsChecks"));
  assert.match(fn, /WHERE lo_id=\? AND period_key=\?/);
  assert.ok(!/status='pending'/.test(fn), "confirming must not require the row to still be pending");
});

test("escalation itself still only fires once per check", () => {
  // getPendingNmlsChecks drives the escalation sweep; it should stay restricted
  // to 'pending' so an already-escalated check is not re-escalated and re-alerted.
  const fn = storage.slice(storage.indexOf("export function getPendingNmlsChecks"), storage.indexOf("export function escalateNmlsCheck"));
  assert.match(fn, /status='pending'/, "the escalation sweep only picks up not-yet-escalated checks");
});

// ── who may use the NMLS pages (owner 9/7/26: everyone on staff) ────────────

test("everyone on staff can run the bulk licence check, not just admins", () => {
  // It reads a PUBLIC register. The reason it was restricted was the cost of
  // the scan, not who is allowed to know the answer.
  assert.equal(canRunNmlsCheckAll({ role: "assistant" }), true);
  assert.equal(canRunNmlsCheckAll({ role: "assistant", isManager: 1 }), true);
  assert.equal(canRunNmlsCheckAll({ role: "admin" }), true);
  assert.equal(canRunNmlsCheckAll({ role: "admin", isClr: true }), true);
});

test("viewers and the portals still cannot", () => {
  assert.equal(canRunNmlsCheckAll({ role: "viewer" }), false);
  assert.equal(canRunNmlsCheckAll({ role: "assistant", portal: "lap" }), false);
  assert.equal(canRunNmlsCheckAll({ role: "admin", portal: "lop" }), false);
  assert.equal(canRunNmlsCheckAll(null), false);
});

test("cost is controlled by a cooldown rather than by a role", () => {
  // Opening a ~20-request external scan to fifteen people without one would
  // be three hundred requests at the register in a minute.
  const fn = routesSrc.slice(
    routesSrc.indexOf('app.post("/api/nmls/check-all"'),
    routesSrc.indexOf('app.post("/api/nmls/check/:loId"'),
  );
  assert.notEqual(fn.length, 0, "the check-all route must still be findable");
  assert.match(fn, /canRunNmlsCheckAll\(/, "the role gate is the shared staff predicate");
  assert.doesNotMatch(fn, /role !== "admin"/, "no admin-only check should remain");
  assert.match(fn, /NMLS_CHECK_ALL_COOLDOWN_MS/);
  assert.match(fn, /nmlsCheckAllInFlight/, "two people pressing at once must not both scan");
  assert.match(fn, /res\.status\(429\)/, "the refusal must be a rate-limit, with a readable reason");
  // The in-flight flag has to be released however the handler exits, or one
  // failed scan locks the button for everybody.
  assert.match(fn, /finally \{[\s\S]*nmlsCheckAllInFlight = false;/);
});

test("the portal is read from the session, not only from the stored row", () => {
  // A LAP device session resolves to a shared C3 user row, so checking the row
  // alone would let the LOA portal through.
  const fn = routesSrc.slice(
    routesSrc.indexOf('app.post("/api/nmls/check-all"'),
    routesSrc.indexOf('app.post("/api/nmls/check/:loId"'),
  );
  assert.match(fn, /portal: sessionUser\?\.portal \?\? actor\?\.portal/);
});

test("the licence board is reachable from the sidebar at last", () => {
  // It has been routed but linked from nowhere since it was built.
  assert.match(sidebarSrc, /url: "\/nmls-status"/);
  assert.match(sidebarSrc, /url: "\/nmls-checks"/);
  // Both sit in Tools, which every role sees — the group is rendered without
  // a manager check.
  const tools = sidebarSrc.slice(sidebarSrc.indexOf("const toolItems"), sidebarSrc.indexOf("];", sidebarSrc.indexOf("const toolItems")));
  assert.match(tools, /\/nmls-status/);
  assert.match(tools, /\/nmls-checks/);
  assert.match(sidebarSrc, /renderCollapsibleGroup\("tools", "Tools", toolItems\)/);
});

test("the licence page shows Refresh to everyone who may use it", () => {
  assert.doesNotMatch(statusPageSrc, /isAdmin/, "the admin-only gate is gone");
  assert.match(statusPageSrc, /const canRefresh =/);
  assert.match(statusPageSrc, /\{canRefresh && \(/);
  // The 429's sentence must reach the person, not be replaced by a generic
  // failure that tells them nothing about when to try again.
  assert.match(statusPageSrc, /description: String\(e\?\.message/);
});

// ── the shared pool: 35 days, and it must be able to SEE the old checks ─────

test("anyone may clear a check nobody has done in 35 days", () => {
  // Owner 8/9/26. Separate from escalation_days (7), which is when the
  // ASSIGNEE starts being chased — a different question from when the job
  // stops being theirs alone.
  assert.match(routesSrc, /const NMLS_SHARED_POOL_DAYS = 35;/);
  const route = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/nmls-checks/my-pending"'),
    routesSrc.indexOf('app.post("/api/nmls-checks/:loId/confirm"'),
  );
  assert.match(route, /\.filter\(\(c: any\) => c\.daysOverdue >= NMLS_SHARED_POOL_DAYS\)/);
  assert.doesNotMatch(route, /daysOverdue >= escalationDays/,
    "the pool must not silently follow the nag setting");
  // The page needs the number to say it out loud.
  assert.match(route, /sharedPoolDays: NMLS_SHARED_POOL_DAYS/);
});

test("the pool reads EVERY open check, not just this round's", () => {
  // The bug that made the request impossible: an unconfirmed check drops out
  // of the per-period query the moment a new round starts, so the licences
  // that had gone longest unverified were on nobody's screen at all.
  // Production had 13 open checks at 69 days, invisible.
  const route = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/nmls-checks/my-pending"'),
    routesSrc.indexOf('app.post("/api/nmls-checks/:loId/confirm"'),
  );
  assert.match(route, /const openAnyPeriod = storageExtra\.getOpenNmlsChecks\(\);/);
  assert.match(route, /const pending = openAnyPeriod/, "my own carried-over checks are still mine");
  assert.match(route, /const overdue = openAnyPeriod/);
  assert.match(storage, /export function getOpenNmlsChecks\(\)/);
  assert.match(storage, /WHERE status <> 'confirmed'/);
});

test("confirming clears a check from an earlier round too", () => {
  // Confirming by (lo, CURRENT period) updated no row for a carried-over
  // check, so the oldest ones were exactly the ones the button could not
  // clear. Anyone pressing it would have seen nothing happen.
  assert.match(storage, /export function confirmOpenNmlsChecksForLo\(/);
  assert.match(storage, /WHERE lo_id=\? AND status <> 'confirmed'/);
  const confirmRoute = routesSrc.slice(
    routesSrc.indexOf('app.post("/api/nmls-checks/:loId/confirm"'),
    routesSrc.indexOf('app.get("/api/nmls/status"'),
  );
  assert.match(confirmRoute, /confirmOpenNmlsChecksForLo\(loId, userId\)/);
  assert.doesNotMatch(confirmRoute, /confirmNmlsCheck\(loId, periodKey/);
});

test("the tracker is open to everyone, page and route alike", () => {
  // No role gate anywhere: it is in Tools, which every role sees, and the
  // endpoints ask only that you are signed in.
  const tools = sidebarSrc.slice(sidebarSrc.indexOf("const toolItems"), sidebarSrc.indexOf("];", sidebarSrc.indexOf("const toolItems")));
  assert.match(tools, /\/nmls-checks/);
  // The tracker's own two routes: list what is outstanding, and confirm one.
  // (nmls-checks/trigger sits between them in the file and IS admin-only on
  // purpose — it restarts the whole round and lives on the Settings page.)
  const list = routesSrc.slice(
    routesSrc.indexOf('app.get("/api/nmls-checks/my-pending"'),
    routesSrc.indexOf('app.post("/api/nmls-checks/:loId/confirm"'),
  );
  const confirm = routesSrc.slice(
    routesSrc.indexOf('app.post("/api/nmls-checks/:loId/confirm"'),
    routesSrc.indexOf('app.post("/api/nmls-checks/trigger"'),
  );
  for (const route of [list, confirm]) {
    assert.notEqual(route.length, 0);
    assert.doesNotMatch(route, /requireManagerOrAdmin|requireAdminSession|role !== "admin"/);
  }
});

test("the page tells people why they are allowed to touch someone else's", () => {
  const page = readFileSync(join(root, "client/src/pages/nmls-checks.tsx"), "utf8");
  assert.match(page, /const sharedPoolDays: number = data\?\.sharedPoolDays \?\? 35;/);
  assert.match(page, /\{sharedPoolDays\}\+ days/, "the number comes from the server, not a hardcoded 7");
});
