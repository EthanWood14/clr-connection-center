import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOutboundSms, smsMessageDate, verifyDialpadJwt } from "../server/dialpad-sms";

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
    // Midnight UTC on the 4th is 5 PM Pacific on the 3rd: the text belongs to
    // the 3rd's scorecard, not tomorrow's (Ethan, 15 Sep 2026: "why are
    // dialpad texts for today off so much?").
    assert.deepEqual(normalizeOutboundSms(payload), {
      externalId: "55", agentKey: "janeclr", agentName: "Jane CLR", dialpadUserId: "42",
      messageDate: "2026-09-03", occurredAt: "2026-09-04T00:00:00.000Z", status: null,
    });
});

test("a text is filed under its Pacific day, and old rows are re-filed once at boot", () => {
  assert.equal(smsMessageDate("2026-09-14T23:59:00.000Z"), "2026-09-14", "4:59 PM PT");
  assert.equal(smsMessageDate("2026-09-15T02:30:00.000Z"), "2026-09-14", "7:30 PM PT is still the 14th");
  assert.equal(smsMessageDate("2026-09-15T07:00:00.000Z"), "2026-09-15", "midnight PT");
  assert.equal(smsMessageDate("2026-12-15T07:30:00.000Z"), "2026-12-14", "standard time: 11:30 PM PST");
  const storage = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server", "storage.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(storage, /dialpad_sms_pacific_dates_v1/);
  assert.match(storage, /UPDATE dialpad_sms_events SET message_date=\? WHERE id=\?/);
});

test("rejects a bad Dialpad signature", () => {
  assert.throws(() => verifyDialpadJwt(jwt({ id: 1 }, "wrong"), "right"), /signature/i);
});

test("does not count inbound Dialpad messages", () => {
  assert.equal(normalizeOutboundSms({ id: 1, direction: "inbound" }), null);
});
