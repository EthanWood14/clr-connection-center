import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEmailTransferCompRateCents,
  resolveTransferCompRateCents,
  tieredTransferCompRateCents,
} from "../server/comp-rate";

test("transfer comp tiers remain unchanged without a flat-rate override", () => {
  assert.equal(tieredTransferCompRateCents(99), 500);
  assert.equal(tieredTransferCompRateCents(100), 1000);
  assert.equal(tieredTransferCompRateCents(200), 1500);
});

test("a saved flat rate overrides projected MTD tiers", () => {
  assert.equal(resolveTransferCompRateCents(250, 500), 500);
  assert.equal(resolveTransferCompRateCents(250, "500"), 500);
});

test("missing or invalid flat rates fall back to the volume tier", () => {
  assert.equal(resolveTransferCompRateCents(150, null), 1000);
  assert.equal(resolveTransferCompRateCents(150, 0), 1000);
  assert.equal(resolveTransferCompRateCents(150, "invalid"), 1000);
});

test("Elleine is always shown at a flat $5 in emailed comp estimates", () => {
  assert.equal(resolveEmailTransferCompRateCents(250, "Elleine", null), 500);
  assert.equal(resolveEmailTransferCompRateCents(250, "Elleine Haynes", 1500), 500);
  assert.equal(resolveEmailTransferCompRateCents(250, "ELLEINE HAYNES", 1000), 500);
});

test("other users still honor their saved flat rate or volume tier", () => {
  assert.equal(resolveEmailTransferCompRateCents(250, "Another CLR", 750), 750);
  assert.equal(resolveEmailTransferCompRateCents(250, "Another CLR", null), 1500);
});
