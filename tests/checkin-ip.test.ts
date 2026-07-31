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

test("an IPv6 /64 keeps matching when the host suffix rotates", () => {
  // The real case: the office allowlist held one full IPv6 address whose
  // a84d:be38:500:efa4 tail rotates under privacy extensions, so it stopped
  // matching within a day. The delegated /64 prefix is the stable part.
  const prefix = ["2600:1700:1251:1980::/64"];
  const monday = "2600:1700:1251:1980:a84d:be38:500:efa4";
  const tuesday = "2600:1700:1251:1980:9c11:77aa:dead:beef";
  for (const ip of [monday, tuesday]) {
    assert.deepEqual(evaluateCheckinIp("enforce", prefix, ip).ipAllowed, 1, `${ip} should match the /64`);
  }
  // A different delegation must NOT match.
  assert.equal(evaluateCheckinIp("enforce", prefix, "2600:1700:1251:1981::1").ipAllowed, 0);
  // And the old exact-address entry fails the moment the suffix changes —
  // this is the bug being fixed.
  assert.equal(evaluateCheckinIp("enforce", [monday], tuesday).ipAllowed, 0);
});

test("IPv4 CIDR ranges match on the prefix", () => {
  assert.equal(evaluateCheckinIp("enforce", ["203.0.113.0/24"], "203.0.113.77").ipAllowed, 1);
  assert.equal(evaluateCheckinIp("enforce", ["203.0.113.0/24"], "203.0.114.77").ipAllowed, 0);
  // Non-byte-aligned prefixes must work too.
  assert.equal(evaluateCheckinIp("enforce", ["198.51.100.0/26"], "198.51.100.63").ipAllowed, 1);
  assert.equal(evaluateCheckinIp("enforce", ["198.51.100.0/26"], "198.51.100.64").ipAllowed, 0);
  // A bare address still means exactly that address.
  assert.equal(evaluateCheckinIp("enforce", ["203.0.113.8"], "203.0.113.9").ipAllowed, 0);
});

test("address families never cross-match, and bad prefixes are dropped", () => {
  // An IPv4 client must not satisfy an IPv6 prefix even though 0.0.0.0/0-style
  // wildcards would otherwise look tempting.
  assert.equal(evaluateCheckinIp("enforce", ["2600:1700::/32"], "203.0.113.8").ipAllowed, 0);
  assert.equal(evaluateCheckinIp("enforce", ["203.0.113.0/24"], "2600:1700::1").ipAllowed, 0);
  // Out-of-range and malformed prefixes are discarded rather than trusted.
  assert.deepEqual(normalizeAllowedIps(["203.0.113.0/33", "2600::/129", "nope/24", "203.0.113.0/24"]),
    ["203.0.113.0/24"]);
  // Equivalent spellings collapse to one entry.
  assert.deepEqual(normalizeAllowedIps(["2600:1700:0:0::/64", "2600:1700::/64"]), ["2600:1700::/64"]);
});

test("IPv6 parsing handles compression and IPv4-mapped forms", () => {
  // These feed the prefix comparison, so a parsing slip would silently
  // mis-match an entire office.
  assert.equal(evaluateCheckinIp("enforce", ["2001:db8::/32"], "2001:db8:0:0:0:0:0:1").ipAllowed, 1);
  assert.equal(evaluateCheckinIp("enforce", ["2001:db8::/32"], "2001:db9::1").ipAllowed, 0);
  // ::ffff:a.b.c.d normalizes to IPv4 and matches an IPv4 rule.
  assert.equal(evaluateCheckinIp("enforce", ["203.0.113.0/24"], "::ffff:203.0.113.5").ipAllowed, 1);
});
