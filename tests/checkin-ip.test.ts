import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCheckinIp,
  normalizeAllowedIps,
  normalizeIpAddress,
} from "../server/checkin-ip";

test("IP normalization handles proxy-style IPv4-mapped addresses", () => {
  assert.equal(normalizeIpAddress("::ffff:203.0.113.8"), "203.0.113.8");
  assert.equal(normalizeIpAddress("[2001:DB8::1]"), "2001:db8::1");
  assert.equal(normalizeIpAddress("not-an-ip"), null);
});

test("allowed IPs are validated, deduplicated, and bounded", () => {
  assert.deepEqual(
    normalizeAllowedIps(["203.0.113.8", "::ffff:203.0.113.8", "bad"]),
    ["203.0.113.8"],
  );
});

test("enforcement accepts only an approved server-observed IP", () => {
  assert.deepEqual(evaluateCheckinIp("enforce", ["203.0.113.8"], "::ffff:203.0.113.8"), {
    ok: true,
    ipAddress: "203.0.113.8",
    ipAllowed: 1,
  });
  const denied = evaluateCheckinIp("enforce", ["203.0.113.8"], "198.51.100.4");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "IP_NOT_ALLOWED");
});

test("record mode never blocks and off mode stores no IP", () => {
  assert.deepEqual(evaluateCheckinIp("record", ["203.0.113.8"], "198.51.100.4"), {
    ok: true,
    ipAddress: "198.51.100.4",
    ipAllowed: 0,
  });
  assert.deepEqual(evaluateCheckinIp("off", ["203.0.113.8"], "198.51.100.4"), {
    ok: true,
    ipAddress: null,
    ipAllowed: null,
  });
});

test("an empty allowlist records IPs without locking everyone out", () => {
  assert.deepEqual(evaluateCheckinIp("enforce", [], "198.51.100.4"), {
    ok: true,
    ipAddress: "198.51.100.4",
    ipAllowed: null,
  });
});
