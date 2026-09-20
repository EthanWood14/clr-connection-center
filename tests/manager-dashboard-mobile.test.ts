import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");

test("Manager Home page root uses mobile-friendly padding and does not force edge-to-edge overflow", () => {
  assert.match(dash, /className="p-3 sm:p-4 md:p-6[^"]*min-w-0 max-w-full"/);
});

test("KPI tiles compact on small screens and sit in a responsive grid", () => {
  assert.match(dash, /CardContent className="p-3 sm:p-5"/);
  assert.match(dash, /text-2xl sm:text-3xl/);
  assert.match(dash, /grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 sm:gap-3/);
});

test("range pills wrap and keep touch-sized hit targets", () => {
  assert.match(dash, /inline-flex max-w-full flex-wrap/);
  assert.match(dash, /min-h-9[^"]*touch-manipulation/);
});

test("wide scorecard / leaderboard / EOD / split tables scroll inside the page", () => {
  assert.match(dash, /overflow-x-auto overscroll-x-contain[\s\S]*?min-w-\[640px\]/);
  assert.match(dash, /min-w-\[420px\]/);
  assert.match(dash, /eod-digest-table[\s\S]*?min-w-\[560px\]|min-w-\[560px\][\s\S]*?eod-digest-table/);
  assert.match(dash, /data-testid=\{testId\}[\s\S]*?min-w-\[360px\]|min-w-\[360px\][\s\S]*?data-testid=\{testId\}/);
});

test("activity heatmap keeps a sticky name column that shrinks on phones", () => {
  assert.match(dash, /min-w-\[7\.5rem\] sm:min-w-\[190px\]/);
  assert.match(dash, /min-w-\[36px\] sm:min-w-\[44px\]/);
  assert.match(dash, /overflow-auto overscroll-contain/);
});

test("charts avoid fixed-width overflow on phones", () => {
  assert.match(dash, /useIsMobile/);
  assert.match(dash, /outerRadius=\{isMobile \? 70 : 90\}/);
  assert.match(dash, /width=\{isMobile \? 72 : 130\}/);
  assert.match(dash, /min-w-0 w-full overflow-hidden/);
});
