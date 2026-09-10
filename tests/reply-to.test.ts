import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");
const settings = read("client/src/pages/settings.tsx");

/**
 * C3 sends from an address with no mailbox behind it. Pressing Reply-All on a
 * digest with five people on it — a completely reasonable thing to do — came
 * back as a Microsoft delivery failure with the whole original header block
 * attached, to everyone on the thread (Ethan, 10 Sep 2026).
 *
 * Nothing in C3 can stop somebody pressing Reply. It can only decide where the
 * reply lands.
 */

test("every C3 email can carry a reply-to, not just the portals", () => {
  // LAP and LOP have had one since July; the main sender had none.
  assert.match(storage, /ADD COLUMN reply_to TEXT NOT NULL DEFAULT ''/);
  const fn = routes.slice(routes.indexOf("async function dispatchEmailNow"), routes.indexOf("[sendEmail] SDK threw"));
  assert.match(fn, /const orgReplyTo = String\(s\.reply_to \|\| ""\)\.trim\(\);/);
  assert.match(fn, /replyTo: effectiveReplyTo/);
});

test("a caller's own reply-to still wins over the org default", () => {
  // The portals set theirs per send, and a portal's mail must keep reading as
  // that portal's rather than as C3's.
  const fn = routes.slice(routes.indexOf("async function dispatchEmailNow"), routes.indexOf("[sendEmail] SDK threw"));
  assert.match(fn, /const effectiveReplyTo = replyTo \?\? \(orgReplyTo\.includes\("@"\) \? orgReplyTo : undefined\);/);
  // ?? and not ||, so a caller that deliberately passes "" is not silently
  // upgraded to the org address.
  assert.ok(!/replyTo \|\| orgReplyTo/.test(fn));
});

test("an unset or nonsense value sends no header at all", () => {
  // The old behaviour, unchanged: better no Reply-To than one pointing at
  // another dead address.
  const fn = routes.slice(routes.indexOf("async function dispatchEmailNow"), routes.indexOf("[sendEmail] SDK threw"));
  assert.match(fn, /orgReplyTo\.includes\("@"\) \? orgReplyTo : undefined/);
  assert.match(fn, /effectiveReplyTo && effectiveReplyTo\.includes\("@"\) \? \{ replyTo: effectiveReplyTo \} : \{\}/);
});

test("it is settable without a deploy, and says why it exists", () => {
  // A setting nobody can find is a setting nobody uses, and the reason has to
  // be on screen: "replies go to X" reads as cosmetic until you know the From
  // address is a dead letter box.
  assert.match(settings, /data-testid="input-reply-to"/);
  assert.match(settings, /replyTo: replyTo\.trim\(\)/, "saved with the rest of the email settings");
  assert.match(settings, /setReplyTo\(String\(emailSettings\.reply_to/, "and loaded back into the field");
  assert.match(settings, /which has no mailbox/);
});
