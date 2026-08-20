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
const queryClient = readFileSync(join(root, "client/src/lib/queryClient.ts"), "utf8");

test("only the browser that successfully logs a transfer receives the celebration", () => {
  assert.match(app, /<TransferCelebration \/>/);
  assert.match(routes, /celebrateTransfer: true/);
  assert.match(routes, /dailyTotal/);
  assert.match(routes, /monthlyTotal/);
  assert.match(routes, /isDailyLeader: dailyTotal > maxOther/);
  assert.match(queryClient, /window\.dispatchEvent\(new CustomEvent\("c3-transfer-logged"/);
  assert.match(transfer, /window\.addEventListener\(TRANSFER_CELEBRATION_EVENT/);
  assert.doesNotMatch(routes, /\/api\/transfer-celebrations/);
  assert.doesNotMatch(transfer, /useQuery|refetchInterval/);
});

test("the initiating CLR gets a full-screen animated and audible celebration", () => {
  assert.match(transfer, /<GoalCelebration/);
  assert.match(transfer, /playChime\(\)/);
  assert.match(transfer, /Keep it rolling/);
  assert.match(transfer, /variant="transfer"/);
  assert.match(overlay, /<Confetti running=\{show\}/);
  assert.match(overlay, /position: "fixed"/);
  assert.match(overlay, /inset: 0/);
  assert.match(overlay, /radial-gradient/);
  assert.match(overlay, /celebration-rays/);
  assert.match(overlay, /celebration-orbit/);
  assert.match(overlay, /celebration-shine/);
  assert.match(overlay, /dramatic \? 8500 : 6000/);
  assert.match(overlay, /const multiplier = dramatic \? 8 : 1/);
  assert.match(transfer, /dailyTotal=\{current\?\.dailyTotal\}/);
  assert.match(transfer, /monthlyTotal=\{current\?\.monthlyTotal\}/);
  assert.match(transfer, /showRaceCar=\{!!current\?\.isDailyLeader\}/);
  assert.match(overlay, /celebration-car-race/);
  assert.match(overlay, /DAILY LEADER/);
  assert.match(overlay, /prefers-reduced-motion/);
});
