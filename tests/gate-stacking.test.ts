/**
 * Only one blocking gate may hold the screen at a time.
 *
 * DailyReportGate renders the whole app inside `pointer-events-none` and puts
 * its own dialog at z-50. Every other full-screen gate and startup prompt is
 * nested below it, so each must explicitly stand down while a higher-priority
 * requirement is active. Otherwise a clickable-looking layer can be painted
 * inside a dead zone and freeze the CLR out of C3.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const app = read("client/src/App.tsx");
const outer = read("client/src/components/daily-report-gate.tsx");
const inner = read("client/src/components/eod-lock-gate.tsx");
const dialog = read("client/src/components/ui/dialog.tsx");

test("the EOD lock still renders inside the daily report gate", () => {
  // If this ever stops being true the hazard is gone, but so is the reason for
  // the guard below — revisit both together rather than deleting one.
  const gateOpen = app.indexOf("<DailyReportGate>");
  const lockOpen = app.indexOf("<EodLockGate>");
  const gateClose = app.indexOf("</DailyReportGate>");
  assert.ok(gateOpen !== -1 && lockOpen !== -1 && gateClose !== -1);
  assert.ok(gateOpen < lockOpen && lockOpen < gateClose,
    "EodLockGate is nested inside DailyReportGate, so it inherits pointer-events-none");
});

test("the daily report gate disables everything it renders beneath itself", () => {
  assert.match(outer, /pointer-events-none select-none blur-sm/,
    "this is what makes any nested overlay unclickable");
  assert.match(outer, /export const DailyReportGateActive/,
    "and why it must publish that it is holding the screen");
  assert.match(outer, /<DailyReportGateActive\.Provider value=\{gated\}>/);
});

test("the EOD lock stands down while the daily report gate is up", () => {
  assert.match(inner, /useContext\(DailyReportGateActive\)/);
  const guard = inner.indexOf("const lockActive = !outerGateActive");
  const overlay = inner.indexOf("fixed inset-0 z-[60]");
  assert.notEqual(guard, -1, "without this the overlay covers a dialog nobody can click");
  assert.notEqual(overlay, -1);
  assert.ok(guard < overlay, "the outer-gate guard has to control the overlay");
  assert.match(inner, /showOverlay = lockActive && location !== "\/eod-report"/);
});

test("the overlay really does sit above the dialog it would cover", () => {
  // Documents the ordering the guard exists to defuse. If someone drops the
  // lock overlay below z-50 this still passes on the guard alone, which is the
  // belt-and-braces we want.
  assert.match(inner, /z-\[60\]/);
  assert.match(dialog, /fixed inset-0 z-50/, "DialogOverlay");
});

test("the EOD report page stays reachable so the lock can be cleared", () => {
  // The lock links to /eod-report?date=…; wouter's useHashLocation puts the
  // query in location.search and leaves the hash as "/eod-report", so this
  // exact-match exemption is what lets a locked CLR reach the form.
  assert.match(inner, /location !== "\/eod-report"/);
  assert.match(inner, /navigate\(`\/eod-report\?date=\$\{d\}`\)/);
});

test("the EOD lock publishes its state while keeping Shotgun mounted", () => {
  assert.match(inner, /export const EodLockGateActive = createContext\(false\)/);
  assert.match(inner, /<EodLockGateActive\.Provider value=\{lockActive\}>/);
  const alert = app.indexOf("<ShotgunOfferAlert />");
  const lockOpen = app.indexOf("<EodLockGate>");
  const lockClose = app.indexOf("</EodLockGate>");
  assert.ok(lockOpen < alert && alert < lockClose,
    "the alert must remain mounted inside both gate contexts so it can suspend routing immediately");
});

test("optional startup prompts wait for both reporting gates", () => {
  const prompts = app.slice(app.indexOf("function DeferredAppPrompts"), app.indexOf("function AuthenticatedApp"));
  assert.match(prompts, /useContext\(DailyReportGateActive\)/);
  assert.match(prompts, /useContext\(EodLockGateActive\)/);
  assert.match(prompts, /if \(dailyReportGateActive \|\| eodLockGateActive\) return null/);

  const promptsOpen = app.indexOf("<DeferredAppPrompts");
  const gateOpen = app.indexOf("<DailyReportGate>");
  const gateClose = app.indexOf("</DailyReportGate>");
  const lockOpen = app.indexOf("<EodLockGate>");
  const lockClose = app.indexOf("</EodLockGate>");
  assert.ok(gateOpen < promptsOpen && promptsOpen < gateClose,
    "startup prompts must read the daily-report gate context");
  assert.ok(lockOpen < promptsOpen && promptsOpen < lockClose,
    "startup prompts must read the EOD-lock context");
});

test("full-screen startup prompts and notices are serialized", () => {
  const prompts = app.slice(app.indexOf("function DeferredAppPrompts"), app.indexOf("function AuthenticatedApp"));
  assert.match(prompts, /!showDailyPriorities && showIntro/);
  assert.match(prompts, /!showDailyPriorities && !showIntro && showPipelineSop/);
  assert.match(prompts, /!showDailyPriorities && !showIntro && !showPipelineSop/);
  assert.ok(prompts.indexOf("<DailyLoPrioritiesModal") < prompts.indexOf("<IntroModal"));
  assert.ok(prompts.indexOf("<IntroModal") < prompts.indexOf("<PipelineSopModal"));
  assert.ok(prompts.indexOf("<PipelineSopModal") < prompts.indexOf("<CookieNotice"));
  assert.match(prompts, /<CookieNotice onResolved=\{resolveCookieNotice\}/);
  assert.match(prompts, /cookieNoticeResolved &&/);
  assert.ok(prompts.indexOf("cookieNoticeResolved &&") < prompts.indexOf("<UpdatePrompt"),
    "the update dialog must wait until the cookie notice is resolved");
  assert.match(prompts, /<UpdatePrompt onBlockingChange=\{trackUpdatePrompt\}/);
  assert.match(prompts, /!updatePromptBlocking &&/,
    "smaller nudges must wait while the update dialog owns the prompt layer");
});
