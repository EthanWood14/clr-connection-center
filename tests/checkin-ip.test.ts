import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

test("the observed IP is the client, not an intermediate proxy", () => {
  // req.ip with trust proxy = 1 counts one hop from the RIGHT, which is only the
  // client when exactly one proxy sits in front. In production more than one
  // does: check-ins recorded a rotating datacentre range and every one landed on
  // ip_allowed = 0, while login rate-limiting on the same server — which reads
  // the leftmost X-Forwarded-For — saw ordinary client addresses.
  const routes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server/routes.ts"), "utf8");
  const fn = routes.slice(routes.indexOf("function requestIp(req: Request)"), routes.indexOf("function validateCheckinIp"));
  assert.match(fn, /x-forwarded-for/, "must read the forwarded chain");
  assert.match(fn, /\.split\(","\)\[0\]/, "and take the leftmost entry — the original client");
  // req.ip stays as the fallback for direct connections with no proxy header.
  assert.match(fn, /\?\?\s*normalizeIpAddress\(req\.ip/);
  // Assert on the expression, not the prose above it.
  const ret = fn.slice(fn.indexOf("const forwarded"));
  assert.ok(ret.indexOf("forwarded") < ret.indexOf("req.ip"),
    "the forwarded client must win over req.ip, not the other way round");
});
