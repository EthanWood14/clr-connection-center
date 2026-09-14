import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nudge = readFileSync(join(root, "client/src/components/push-nudge.tsx"), "utf8").replace(/\r\n/g, "\n");

/**
 * "Have everyone enable push notifications" (14 Sep 2026). New leads and
 * Shotgun offers reach a CLR by notification when C3 is a background tab —
 * most of the day — and 7 of 11 CLRs had none. For a CLR the prompt now stays
 * until it is on; everyone else keeps the gentle version.
 */

test("a CLR is required: no permanent dismiss, a short snooze, and it keys off the signed-in user", () => {
  assert.match(nudge, /export function pushRequiredFor\(/);
  assert.match(nudge, /!!user\.isClr \|\| String\(user\.role \?\? ""\) === "assistant"/);
  assert.match(nudge, /const required = pushRequiredFor\(user\);/);
  assert.match(nudge, /export const CLR_SNOOZE_MS = 4 \* 60 \* 60 \* 1000;/);
  assert.match(nudge, /required \? CLR_SNOOZE_MS : SNOOZE_MS/);
  // The permanent dismiss is neither honoured nor offered for a CLR.
  assert.match(nudge, /if \(!required\) \{\s*\n\s*try \{\s*\n\s*if \(localStorage\.getItem\(PERM_DISMISS_KEY\) === "1"\) return;/);
  assert.match(nudge, /if \(required\) return; \/\/ not offered to CLRs/);
  assert.match(nudge, /\{!required && \(\s*\n\s*<button\s*\n\s*onClick=\{permDismiss\}/);
});

test("a browser-level block is explained to a CLR, not hidden", () => {
  assert.match(nudge, /if \(Notification\.permission === "denied"\) \{\s*\n\s*if \(required && !cancelled\) \{ setBlocked\(true\); setVisible\(true\); \}/);
  assert.match(nudge, /data-testid="push-nudge-unblock"/);
  assert.match(nudge, /lock icon/);
  assert.match(nudge, /data-testid="button-push-nudge-reload"/);
});

test("everyone sees it once more: the dismiss keys moved to v4", () => {
  assert.match(nudge, /clr_push_nudge_perm_dismissed_v4/);
  assert.match(nudge, /clr_push_nudge_snoozed_until_v4/);
  assert.doesNotMatch(nudge, /_v3"/);
});
