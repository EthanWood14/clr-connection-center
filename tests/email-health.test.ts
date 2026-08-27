import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

test("the send log tells the truth about what Resend did", () => {
  // "delivered" was a lie: Resend returning an id means accepted. That wording
  // is why a four-month blackout looked healthy in every log line.
  assert.ok(!routes.includes("[sendEmail] delivered id="),
    "an accepted send must not be logged as delivered");
  assert.match(routes, /\[sendEmail\] accepted id=/);
});

test("every send is recorded so its real outcome can be checked later", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS email_sends/);
  assert.match(storage, /resend_id TEXT NOT NULL UNIQUE/);
  assert.match(storage, /export function recordEmailSend/);
  // Bookkeeping must never break an actual send.
  const record = storage.slice(storage.indexOf("export function recordEmailSend"), storage.indexOf("export function listOpenEmailSends"));
  assert.match(record, /INSERT OR IGNORE INTO email_sends/);
  assert.match(record, /catch \(e\)/);
  const dispatch = routes.slice(routes.indexOf("async function dispatchEmailNow"), routes.indexOf("const EMAIL_DEAD_EVENTS"));
  assert.match(dispatch, /storageExtra\.recordEmailSend\(\{ resendId: id, recipients: toArr, subject \}\)/);
});

test("a message that reached nobody raises an in-app alert, once", () => {
  const rec = routes.slice(routes.indexOf("async function reconcileEmailStatuses"), routes.indexOf('cron.schedule("*/10 * * * *"'));
  assert.match(rec, /api\.resend\.com\/emails\//);
  assert.match(rec, /body\?\.last_event/);
  assert.match(rec, /updateEmailSendStatus/);
  // suppressed is the exact event that hid the outage.
  assert.match(routes, /EMAIL_DEAD_EVENTS = new Set\(\["suppressed", "bounced", "complained", "failed"\]\)/);
  // In-app, not email — the thing being reported broken is email itself.
  assert.match(rec, /type: "email_blocked"/);
  assert.match(rec, /portal: "c3"/);
  assert.ok(!/sendEmail\(/.test(rec), "the alert must not be sent by the channel it is reporting on");
  // One alert per send, and only for admins who actually use C3.
  assert.match(rec, /row\.alerted/);
  assert.match(rec, /markEmailSendAlerted/);
  assert.match(rec, /portal IS NULL OR portal='c3'/);
  // Scheduled, with a boot catch-up.
  assert.match(routes, /cron\.schedule\("\*\/10 \* \* \* \*"/);
  assert.match(routes, /\[email-health\] boot check failed/);
});

test("the key resolver is shared, so the checker uses the key that sent", () => {
  assert.match(routes, /function resolveResendKey\(\): string/);
  const dispatch = routes.slice(routes.indexOf("async function dispatchEmailNow"), routes.indexOf("const EMAIL_DEAD_EVENTS"));
  assert.match(dispatch, /const apiKey = resolveResendKey\(\);/);
  // Env still wins over a stale DB key (the 2026-06-30 key-abuse fix).
  assert.match(routes, /return DEFAULT_RESEND_KEY \|\| \(looksLikeRealKey \? dbKey : ""\);/);
});
