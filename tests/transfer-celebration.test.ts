import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const transfer = readFileSync(join(root, "client/src/components/transfer-celebration.tsx"), "utf8");
const overlay = readFileSync(join(root, "client/src/components/goal-celebration.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("every successful transfer still reaches the organization-wide celebration feed", () => {
  assert.match(app, /<TransferCelebration \/>/);
  assert.match(routes, /if \(outcome\.outcomeType === "transfer"\)[\s\S]*?broadcastTransferCelebration/);
  assert.match(routes, /app\.get\("\/api\/transfer-celebrations", requireAuth/);
  assert.match(routes, /transferNotificationsEnabled \?\? me\?\.transfer_notifications_enabled/,
    "the existing per-user celebration preference must remain authoritative");
});

test("transfer alerts are full-screen, animated, audible, and queued", () => {
  assert.match(transfer, /<GoalCelebration/);
  assert.match(transfer, /refetchInterval: 5000/);
  assert.match(transfer, /setQueue\(\(existing\)/);
  assert.match(transfer, /playChime\(\)/);
  assert.match(transfer, /Celebrate the next one/);
  assert.match(overlay, /<Confetti running=\{show\}/);
  assert.match(overlay, /position: "fixed"/);
  assert.match(overlay, /inset: 0/);
  assert.match(overlay, /radial-gradient/);
  assert.match(overlay, /prefers-reduced-motion/);
});
