import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filterRecipients, isUndeliverable, looksLikeEmail } from "../server/deliverable-email";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("the app's own web host is not a mail domain", () => {
  // westcapitallending.center has no MX records — it serves C3, it does not
  // receive mail. lap-shared@ there was 0 delivered against 9 bounces.
  assert.equal(isUndeliverable("lap-shared@westcapitallending.center"), true);
  // The real mail domain must keep working.
  assert.equal(isUndeliverable("spetrie@westcapitallending.com"), false);
  assert.equal(isUndeliverable("credoble@westcapitallending.com"), false);
});

test("internal and reserved domains can never receive mail", () => {
  assert.equal(isUndeliverable("auto-review@c3.internal"), true);
  assert.equal(isUndeliverable("x@anything.internal"), true);
  assert.equal(isUndeliverable("x@box.local"), true);
  assert.equal(isUndeliverable("x@foo.invalid"), true);
  assert.equal(isUndeliverable("x@foo.test"), true);
});

test("ordinary addresses are left alone", () => {
  for (const a of [
    "elleine@brighterholdings.net",
    "skylertgrif04@icloud.com",
    "jordonchang7@gmail.com",
    "mercadojonjairo@gmail.com",
    "ethan.anthony.wood@gmail.com",
  ]) assert.equal(isUndeliverable(a), false, `${a} must still receive mail`);
});

test("malformed addresses are refused rather than sent", () => {
  for (const bad of ["", "   ", "no-at-sign", "a@b", "two@at@signs.com", "spaced out@x.com", "x@nodot"]) {
    assert.equal(isUndeliverable(bad), true, `${JSON.stringify(bad)} should be refused`);
  }
  assert.equal(looksLikeEmail("a@b.co"), true);
});

test("one dead address no longer costs everyone else the email", () => {
  // The exact list from the bounced "in Team Chat" sends.
  const actual = [
    "spetrie@westcapitallending.com", "credoble@westcapitallending.com",
    "randrade@westcapitallending.com", "elleine@brighterholdings.net",
    "lvuong@westcapitallending.com", "tommyl@westcapitallending.com",
    "mlane@westcapitallending.com", "mrosas@westcapitallending.com",
    "jordonchang7@gmail.com", "kprudnikova@westcapitallending.com",
    "kroberts@westcapitallending.com", "jlapiz@westcapitallending.com",
    "skylertgrif04@icloud.com", "carreola@westcapitallending.com",
    "aapplegarth@westcapitallending.com", "mercadojonjairo@gmail.com",
    "lap-shared@westcapitallending.center", "auto-review@c3.internal",
  ];
  const { to, dropped } = filterRecipients(actual);
  assert.deepEqual(dropped, ["lap-shared@westcapitallending.center", "auto-review@c3.internal"]);
  assert.equal(to.length, 16, "all sixteen real people must still get it");
  assert.ok(!to.some((a) => a.endsWith("westcapitallending.center")));
});

test("duplicates collapse and order is kept", () => {
  const { to } = filterRecipients(["a@x.com", "A@X.com", "b@y.com", null, undefined, "  "]);
  assert.deepEqual(to, ["a@x.com", "b@y.com"]);
});

test("the filter sits at the one place every email leaves from", () => {
  const fn = routes.slice(routes.indexOf("async function dispatchEmailNow"), routes.indexOf("storageExtra.recordEmailSend"));
  assert.match(fn, /filterRecipients\(requested\)/, "the to: list must be filtered");
  assert.match(fn, /const bccList = bcc \? filterRecipients/, "bcc must be filtered too");
  // A send with nobody left must fail loudly, not quietly succeed.
  assert.match(fn, /No deliverable recipients for this email/);
  assert.match(fn, /dropped undeliverable recipient\(s\)/, "drops must be logged, never silent");
});
