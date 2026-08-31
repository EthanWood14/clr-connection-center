import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wd = readFileSync(join(root, "client/src/components/summons-watchdog.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const code = wd.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

test("the watchdog does not depend on the thing that may be broken", () => {
  // The alarm renders off a React Query poll. If that poll is what wedged, a
  // watchdog built on it cannot save anything.
  assert.ok(!/useQuery|refetchInterval/.test(code),
    "the watchdog must not use React Query to check for a summons");
  assert.match(code, /fetch\("\/api\/summons\/mine"/);
  assert.match(code, /cache: "no-store"/, "a cached response would defeat the point");
});

test("it reloads at most once per summons, so it can never loop", () => {
  // A reload that does not fix the problem must not become an infinite cycle
  // that makes the machine unusable.
  assert.match(code, /alreadyRefreshedFor\(id\)/);
  assert.match(code, /rememberRefresh\(id\)/);
  // The marker is written BEFORE the reload, or the reload would re-fire.
  const i = code.indexOf("rememberRefresh(id)");
  const j = code.indexOf("window.location.reload()");
  assert.ok(i > 0 && j > i, "the reload must be recorded before it happens");
});

test("no storage means no reloading, rather than endless reloading", () => {
  // If sessionStorage is unavailable there is no way to remember a reload, so
  // the safe answer is to not reload at all.
  const fn = wd.slice(wd.indexOf("function alreadyRefreshedFor"), wd.indexOf("function rememberRefresh"));
  assert.match(fn, /catch \{[\s\S]*return true;/, "an unreadable store must report 'already refreshed'");
  const rem = wd.slice(wd.indexOf("function rememberRefresh"), wd.indexOf("export function SummonsWatchdog"));
  assert.match(rem, /catch \{[\s\S]*return false;/, "a failed write must block the reload");
});

test("a freshly loaded page is never reloaded again immediately", () => {
  assert.match(code, /MIN_AGE_BEFORE_RELOAD_MS/);
  const m = wd.match(/const MIN_AGE_BEFORE_RELOAD_MS = ([\d_]+)/);
  assert.ok(m, "the minimum page age must be explicit");
  assert.ok(Number(String(m[1]).replace(/_/g, "")) >= 5000, "too short a window risks a reload cycle");
  assert.equal((code.match(/loadedAt\.current < MIN_AGE_BEFORE_RELOAD_MS/g) ?? []).length, 2,
    "both reload paths must respect it");
});

test("a stale build is treated as its own reason to reload", () => {
  // The other way the alarm goes quiet: the tab is running code from before
  // the feature existed, so nothing in it knows to alarm.
  assert.match(code, /fetch\("\/api\/health"/);
  assert.match(code, /live === APP_VERSION/);
  assert.match(code, /alreadyRefreshedFor\(-1\)/, "the build reload needs its own once-only marker");
});

test("waking from sleep re-checks immediately instead of waiting out the poll", () => {
  for (const ev of ["visibilitychange", "online", "focus"]) {
    assert.ok(code.includes(`"${ev}"`), `must react to ${ev}`);
  }
  // And must clean up after itself.
  for (const ev of ["visibilitychange", "online", "focus"]) {
    assert.ok(code.includes(`removeEventListener("${ev}"`), `must remove the ${ev} listener`);
  }
});

test("the poll cannot pile up on a slow or offline network", () => {
  assert.match(code, /busy\.current/, "an in-flight check must not be started twice");
  // setTimeout recursion rather than setInterval, so a slow request delays the
  // next check instead of stacking them.
  assert.ok(!/setInterval/.test(code), "setInterval would queue checks behind a hung fetch");
  assert.match(code, /timer = setTimeout\(loop, POLL_MS\)/);
});

test("it only runs for a signed-in person, and is mounted with the alarm", () => {
  assert.match(code, /if \(!user\) return;/);
  assert.match(app, /<SummonsWatchdog \/>/);
});
