import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { normalizeOutboundSms, verifyDialpadJwt } from "../server/dialpad-sms";

function jwt(payload: any, secret: string) {
  const enc = (v: any) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  return `${unsigned}.${crypto.createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

test("verifies and normalizes an outbound Dialpad SMS without content", () => {
    const secret = "test-secret";
    const payload = { id: 55, created_date: Date.UTC(2026, 8, 4), direction: "outbound",
      target: { type: "user", id: 42, name: "Jane CLR" }, text: "must never persist" };
    assert.deepEqual(verifyDialpadJwt(jwt(payload, secret), secret), payload);
    assert.deepEqual(normalizeOutboundSms(payload), {
      externalId: "55", agentKey: "janeclr", agentName: "Jane CLR", dialpadUserId: "42",
      messageDate: "2026-09-04", occurredAt: "2026-09-04T00:00:00.000Z", status: null,
    });
});

test("rejects a bad Dialpad signature", () => {
  assert.throws(() => verifyDialpadJwt(jwt({ id: 1 }, "wrong"), "right"), /signature/i);
});

test("does not count inbound Dialpad messages", () => {
  assert.equal(normalizeOutboundSms({ id: 1, direction: "inbound" }), null);
});
