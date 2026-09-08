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
