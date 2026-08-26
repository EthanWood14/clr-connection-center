import { test } from "node:test";
import assert from "node:assert/strict";
import { stateCallStatus } from "../client/src/lib/state-call-window";

test("state call protection allows a normal weekday inside the window", () => {
  const status = stateCallStatus("CA", new Date("2026-08-24T17:00:00.000Z"));
  assert.equal(status.status, "allowed");
  assert.match(status.localTime, /Mon/);
});

test("state call protection blocks after the local cutoff", () => {
  const status = stateCallStatus("CA", new Date("2026-08-25T05:00:00.000Z"));
  assert.equal(status.status, "prohibited");
  assert.match(status.reason, /end by/);
});

test("state-specific Sunday prohibitions override otherwise-open hours", () => {
  const status = stateCallStatus("AL", new Date("2026-08-23T17:00:00.000Z"));
  assert.equal(status.status, "prohibited");
  assert.match(status.reason, /Sunday/);
});

test("a missing state never pretends the call is compliant", () => {
  assert.equal(stateCallStatus("").status, "unknown");
});
