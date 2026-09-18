import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

test("viewport enables iOS safe-area without breaking PWA install meta", () => {
  const index = read("client/index.html");
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /apple-mobile-web-app-capable/);
  assert.match(index, /rel="manifest"/);
  assert.doesNotMatch(index, /user-scalable=no/);
});

test("shared Dialog / AlertDialog are phone bottom-sheets with scroll + safe area", () => {
  const dialog = read("client/src/components/ui/dialog.tsx");
  const alert = read("client/src/components/ui/alert-dialog.tsx");
  for (const src of [dialog, alert]) {
    assert.match(src, /max-sm:bottom-0/);
    assert.match(src, /max-sm:rounded-t-2xl/);
    assert.match(src, /overflow-y-auto/);
    assert.match(src, /safe-area-inset-bottom/);
    assert.match(src, /92dvh|100dvh/);
  }
  assert.match(dialog, /min-h-11 min-w-11/, "close control is a real tap target");
  assert.match(alert, /min-h-11/, "alert actions are phone-friendly");
});

test("sheet and drawer respect viewport height and safe area", () => {
  const sheet = read("client/src/components/ui/sheet.tsx");
  const drawer = read("client/src/components/ui/drawer.tsx");
  assert.match(sheet, /max-h-\[min\(92dvh,100dvh\)\]/);
  assert.match(sheet, /safe-area-inset-bottom/);
  assert.match(drawer, /max-h-\[min\(92dvh,100dvh\)\]/);
  assert.match(drawer, /safe-area-inset-bottom/);
});

test("lead dock + shotgun CTAs stay reachable on phones", () => {
  const dock = read("client/src/components/lead-popup-dock.tsx");
  assert.match(dock, /fixed bottom-20 left-3/);
  assert.match(dock, /sm:bottom-4 sm:left-4/);
  assert.match(dock, /safe-area-inset-bottom/);
  assert.match(dock, /overflow-y-auto/);
  for (const file of [
    "client/src/components/shotgun-offer-alert.tsx",
    "client/src/components/shotgun-presence-prompt.tsx",
    "client/src/components/shotgun-reclaim-prompt.tsx",
    "client/src/components/shotgun-bounceback-prompt.tsx",
  ]) {
    assert.match(read(file), /min-h-12/, `${file} primary CTA`);
  }
});

test("fixed overlays fit short viewports", () => {
  const files = [
    "client/src/components/nmls-overdue-popup.tsx",
    "client/src/components/task-overdue-popup.tsx",
    "client/src/components/intro-modal.tsx",
    "client/src/components/pipeline-sop-modal.tsx",
    "client/src/components/daily-lo-priorities-modal.tsx",
    "client/src/components/goal-nudge.tsx",
    "client/src/components/eod-siren.tsx",
    "client/src/components/manager-summons-alarm.tsx",
  ];
  for (const file of files) {
    const src = read(file);
    assert.match(src, /safe-area-inset-bottom|dvh/, `${file} uses viewport-safe sizing`);
  }
  assert.match(read("client/src/components/task-overdue-popup.tsx"), /bottom-20/);
});
