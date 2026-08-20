import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modal = readFileSync(join(root, "client/src/components/daily-lo-priorities-modal.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");

test("the first C3 screen of each business day is the LO priority briefing", () => {
  assert.match(app, /showDailyPriorities && \(/);
  assert.ok(
    app.indexOf("<DailyLoPrioritiesModal") < app.indexOf("<IntroModal"),
    "the daily priorities must render before onboarding or refresher popups",
  );
  assert.match(app, /showIntro \|\| showDailyPriorities/,
    "the pipeline refresher must wait until the daily priorities are dismissed");
});

test("the daily acknowledgement is scoped by org, user and C3 business date", () => {
  assert.match(modal, /c3:daily-lo-priorities:\$\{orgId\}:\$\{userId\}:\$\{businessDate\}/);
  assert.match(modal, /businessTodayInTz\(timezone\)/);
  assert.match(modal, /localStorage\.setItem\(dailyLoPrioritiesStorageKey/);
});

test("the briefing uses the existing priority and assignment sources", () => {
  assert.match(modal, /queryKey: \["\/api\/loan-officers"\]/);
  assert.match(modal, /lo\.needsTransfers \?\? lo\.needs_transfers/);
  assert.match(modal, /queryKey: \["\/api\/assignments\/today"\]/);
  assert.match(modal, /assistantRank \?\? a\.assistant_rank/);
  assert.match(modal, /Today&apos;s prioritized loan officers/);
  assert.match(modal, /Your daily LO order/);
});
