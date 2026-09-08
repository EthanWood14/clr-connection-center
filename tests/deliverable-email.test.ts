import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterRecipients, isUndeliverable, looksLikeEmail,
  filterRecipients as filterWith,
  suppressionFromHistory, suppressionWindowArg,
  SUPPRESS_AFTER_BOUNCES, SUPPRESS_WINDOW_DAYS, SUPPRESSION_HISTORY_SQL,
} from "../server/deliverable-email";

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
  assert.match(fn, /filterRecipients\(requested, suppressed\)/, "the to: list must be filtered");
  assert.match(fn, /const bccList = bcc \? filterRecipients\(/, "bcc must be filtered too");
  // Both lists get the SAME suppression set. A bcc that skipped it would put a
  // dead address back on the message and bounce it for everyone again.
  assert.match(fn, /\[bcc\], suppressed\)/, "bcc must use the suppression set too");
  assert.match(fn, /const suppressed = currentSuppression\(\);/);
  // A send with nobody left must fail loudly, not quietly succeed.
  assert.match(fn, /No deliverable recipients for this email/);
  assert.match(fn, /dropped undeliverable recipient\(s\)/, "drops must be logged, never silent");
});

// ── the learned half: addresses that keep bouncing ──────────────────────────

const send = (recipients: string[], last_event: string) =>
  ({ recipients: JSON.stringify(recipients), last_event });

const DEAD = "gone@westcapitallending.com";
const REAL = "chris@westcapitallending.com";

test("an address that keeps bouncing and never delivers is dropped", () => {
  const history = [
    send([DEAD], "bounced"),
    send([DEAD], "bounced"),
    send([DEAD], "bounced"),
  ];
  const suppressed = suppressionFromHistory(history);
  assert.ok(suppressed.has(DEAD));

  const { to, dropped } = filterWith([DEAD, REAL], suppressed);
  assert.deepEqual(to, [REAL], "the live address still gets the email");
  assert.deepEqual(dropped, [DEAD]);
});

test("ONE delivery clears an address, however many bounces sit beside it", () => {
  // This is the case that matters most. Resend reports one outcome per
  // MESSAGE, so when a group send bounces, every person on it is recorded as
  // bounced — including sixteen whose mail was fine. Counting bounces alone
  // would have removed the whole team from their own chat notifications.
  const history = [
    send([DEAD, REAL], "bounced"),
    send([DEAD, REAL], "bounced"),
    send([DEAD, REAL], "bounced"),
    send([REAL], "delivered"),
  ];
  const suppressed = suppressionFromHistory(history);
  assert.ok(suppressed.has(DEAD), "the address that never delivered is still dropped");
  assert.equal(suppressed.has(REAL), false, "the innocent bystander is kept");
});

test("the real 31 August blast would not have silenced anybody", () => {
  // Reconstructed from production: two 18-recipient chat emails bounced
  // because two system accounts were on them. Every real person also had
  // dozens of delivered emails in the window.
  const team = ["spetrie@wcl.com", "credoble@wcl.com", "elleine@bh.net", "lvuong@wcl.com"];
  const systemAccounts = ["lap-shared@westcapitallending.center", "auto-review@c3.internal"];
  const history = [
    send([...team, ...systemAccounts], "bounced"),
    send([...team, ...systemAccounts], "bounced"),
    send([...team, ...systemAccounts], "bounced"),
    ...team.map((a) => send([a], "delivered")),
  ];
  const suppressed = suppressionFromHistory(history);
  for (const person of team) {
    assert.equal(suppressed.has(person), false, `${person} must not be suppressed`);
  }
  // The system accounts are caught structurally anyway, so belt and braces.
  for (const acct of systemAccounts) assert.ok(suppressed.has(acct));
});

test("bouncing a couple of times is not enough", () => {
  const history = [send([DEAD], "bounced"), send([DEAD], "bounced")];
  assert.equal(suppressionFromHistory(history).has(DEAD), false,
    `under ${SUPPRESS_AFTER_BOUNCES} bounces is a bad week, not a dead mailbox`);
});

test("comparison ignores case and surrounding space", () => {
  const history = [
    send(["  GONE@WestCapitalLending.com "], "bounced"),
    send(["gone@westcapitallending.com"], "bounced"),
    send(["Gone@WESTCAPITALLENDING.COM"], "bounced"),
  ];
  const suppressed = suppressionFromHistory(history);
  assert.ok(suppressed.has(DEAD), "three spellings of one mailbox are one mailbox");
  assert.deepEqual(filterWith(["GONE@WestCapitalLending.com"], suppressed).to, []);
});

test("unreadable history suppresses nobody rather than everybody", () => {
  // Unknown must mean "send it". A parse failure that silenced all mail would
  // be a far worse outage than the bounces it is trying to prevent.
  assert.equal(suppressionFromHistory(null).size, 0);
  assert.equal(suppressionFromHistory(undefined).size, 0);
  assert.equal(suppressionFromHistory([]).size, 0);
  assert.equal(suppressionFromHistory([{ recipients: "not json", last_event: "bounced" }]).size, 0);
  assert.equal(suppressionFromHistory([{ recipients: '{"a":1}', last_event: "bounced" }]).size, 0);
  assert.equal(suppressionFromHistory([{} as any]).size, 0);
});

test("outcomes other than bounced and delivered are ignored", () => {
  const history = [
    send([DEAD], "complained"), send([DEAD], "queued"),
    send([DEAD], "bounced"), send([DEAD], "bounced"), send([DEAD], "bounced"),
  ];
  assert.ok(suppressionFromHistory(history).has(DEAD));
  assert.equal(suppressionFromHistory([send([DEAD], "complained")]).size, 0);
});

test("with no suppression set, filtering behaves exactly as before", () => {
  const before = filterWith([REAL, "lap-shared@westcapitallending.center"]);
  assert.deepEqual(before.to, [REAL]);
  assert.deepEqual(before.dropped, ["lap-shared@westcapitallending.center"]);
});

test("the history query asks for both outcomes, and the window is a real one", () => {
  // Reading only bounces would lose the delivery evidence that exonerates a
  // bystander — the guard above would silently stop working.
  assert.match(SUPPRESSION_HISTORY_SQL, /last_event IN \('bounced', 'delivered'\)/);
  assert.equal(suppressionWindowArg(), `-${SUPPRESS_WINDOW_DAYS} days`);
  assert.equal(suppressionWindowArg(30), "-30 days");
  assert.equal(suppressionWindowArg(0), "-1 days", "never a zero-width window");
  assert.equal(suppressionWindowArg(-5), "-1 days");
});
