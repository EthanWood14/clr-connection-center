import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

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
