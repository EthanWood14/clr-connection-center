import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  receivedCount, percentileNearestRank, flagPromotionCut, fullCreditBandSize, recipientKey,
  recipientCredits, creditIndex, transferCredit, transferDay, snapshotLoads,
  scoreTransferPriority, investmentPropertyKeys,
  FULL_CREDIT_LOS, FULL_CREDIT_LOAS, FULL_CREDIT_SHARE, FLAG_PROMOTION_PERCENTILE,
  SCORE_NON_RECEIVING_RECIPIENTS, MIN_SCORED_TRANSFERS, PRIORITY_WINDOW_DAYS,
  INVESTMENT_PROPERTY_LOAS, INVESTMENT_PROPERTY_INPUT_AVAILABLE,
  type RecipientRow, type TransferRow, type RecipientCredit, type ClrPriorityScore,
} from "../server/transfer-priority";
import { orderStarved, STARVED_WINDOW_DAYS } from "../server/tv-pages";
import {
  isInvestmentProperty, qualAnswer, INVESTMENT_PROPERTY_LABEL, QUAL_LABELS,
} from "../shared/transfer-completeness";
import { composeLeadCaptureNotes, emptyLeadCapture } from "../client/src/lib/lead-capture";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "server/transfer-priority.ts"), "utf8");
/** The route is where this stat is wired up, so the wiring is read out of it. */
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const mgr = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");

// ── the floor, as it actually stood ─────────────────────────────────────────
//
// Transfers RECEIVED in the fourteen days to 2026-09-03, off prod. Nothing here
// is invented except the ids: these are the numbers the rule has to survive, and
// the reason it is shaped the way it is. 687 transfers went to loan officers in
// that fortnight and 282 of them — 41% — went to one man.

const lo = (id: number, name: string, transfers: number, extra: Partial<RecipientRow> = {}): RecipientRow =>
  ({ id, name, kind: "lo", transfers, receiving: true, ...extra });

const loa = (id: number, name: string, transfers: number): RecipientRow =>
  ({ id, name, kind: "loa", transfers, receiving: true });

/** A seeded demo row, or a placeholder: real in the table, real to nobody else. */
const demo = (id: number, name: string): RecipientRow =>
  ({ id, name, kind: "lo", transfers: 0, receiving: false, lastAt: null });

const REDOBLE = 1, NATHAN = 2, RYAN_A = 3, SHERVIN = 5, KIM = 13, MATEO_LO = 14;
const COLE_LO = 15, SEAN = 16, DEREK = 17, GARY = 18, KHASHI = 19;
const ALEX_DEMO = 20;
const JUSTIN = 101, JOHN = 102, MATEO_LOA = 104, ERIK = 106, RYAN_LOA = 107;

const recipients: RecipientRow[] = [
  lo(REDOBLE, "Christopher Redoble", 282, { needsTransfers: true }),
  lo(NATHAN, "Nathan Coutino", 46),
  lo(RYAN_A, "Ryan Andrade", 39),
  lo(4, "Bill Neessen", 36),
  lo(SHERVIN, "Shervin Mohseni", 32, { needsTransfers: true }),
  lo(6, "Kurt Christman", 31),
  lo(7, "Mark Gomez", 30),
  lo(8, "Nick Barq", 30),
  lo(9, "Marcus Woods", 27),
  lo(10, "Carlton Long", 26),
  lo(11, "Ian Militello", 24),
  lo(12, "Dan Baker", 23),
  lo(KIM, "Michael Kim", 17, { needsTransfers: true }),
  lo(MATEO_LO, "Mateo Tedeschi", 16),
  lo(COLE_LO, "Cole Thomas Fairon", 14),
  lo(SEAN, "Sean Murphy", 8),
  lo(DEREK, "Derek Bullen", 6),
  // Real loan officers who took nothing in the fortnight. Idle, not fake — they
  // have a last transfer, which is what `receiving` is derived from.
  lo(GARY, "Gary Dawson", 0, { lastAt: "2026-07-30" }),
  lo(KHASHI, "Khashi Tabrizi", 0, { lastAt: "2026-08-04" }),
  // ...and the rows that have never received anything, ever. (Prod carries one
  // more seeded row than the six named here; six is plenty to prove the rule.)
  demo(ALEX_DEMO, "Alex Thompson"),
  demo(21, "Jordan Rivera"),
  demo(22, "Taylor Morgan"),
  demo(23, "Casey Bennett"),
  demo(24, "Morgan Ellis"),
  demo(25, "Unknown LO (Recovered)"),
  loa(JUSTIN, "Justin", 54),
  loa(JOHN, "John", 53),
  loa(103, "Aaron", 35),
  loa(MATEO_LOA, "Mateo", 32),
  loa(105, "Cole", 27),
  loa(ERIK, "Erik", 25),
  loa(RYAN_LOA, "Ryan", 25),
];

const credits = recipientCredits(recipients);
const byName = (name: string): RecipientCredit => {
  const found = credits.filter((c) => c.name === name);
  assert.equal(found.length, 1, `exactly one ${name}`);
  return found[0];
};
const creditOf = (name: string) => byName(name).credit;
const bandOf = (name: string) => byName(name).band;
const inBand = () => credits.filter((c) => c.band !== "ramp").map((c) => c.name);

const D1 = "2026-08-24", D2 = "2026-08-25", D3 = "2026-08-26";

/** One transfer, from a CLR to a loan officer, on a day. */
const t = (clrId: string, loId: number | null, at: string | null = D1): TransferRow =>
  ({ clrId, clrName: clrId, loId, at });

// ── the window ──────────────────────────────────────────────────────────────

test("the stat measures the same fortnight as the TV's starved page", () => {
  // Two windows would give two different answers to "who is starved right now".
  assert.equal(PRIORITY_WINDOW_DAYS, STARVED_WINDOW_DAYS);
  assert.equal(PRIORITY_WINDOW_DAYS, 14);
});

// ── THE BLOCKER: judged on the floor BEFORE the transfer, not after ──────────

test("BLOCKER — the CLR who single-handedly fixed a starvation scores 65%, not 8%", () => {
  // Nathan Coutino ends the fortnight second-heaviest on the floor with 46. He
  // started it on 6, and one CLR is why: Ada sent him forty leads over eight
  // days because he was the man who needed them.
  //
  // Scored on his load at the END of the window — which is what this stat used
  // to do — every one of those forty is judged against a well-fed loan officer,
  // and Ada comes out at 8%: near the bottom of the floor, for doing exactly the
  // thing the stat exists to reward. Scored on the floor as it stood BEFORE each
  // transfer, her early days are full credit and her last ones are not, because
  // by then he genuinely was fed. 65%.
  const days = ["2026-08-21", "2026-08-22", "2026-08-24", "2026-08-25",
                "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31"];
  const ada: TransferRow[] = [];
  for (const day of days) for (let i = 0; i < 5; i += 1) ada.push(t("Ada", NATHAN, day));

  const before = scoreTransferPriority(ada, recipients)[0];
  assert.equal(before.scored, 40);
  assert.equal(before.pct, 65);
  assert.equal(before.mean, 0.6458);

  // The same forty with the date taken off fall back to the end of the window,
  // which is precisely the old rule — and precisely the trap.
  const after = scoreTransferPriority(ada.map(({ at, ...row }) => row), recipients)[0];
  assert.equal(after.pct, 8);
  assert.ok(before.mean! > after.mean! * 7, "the two readings are not close");
});

test("BLOCKER — feeding a starved LO again and again keeps scoring full credit", () => {
  // Derek Bullen took six in the fortnight and Riley sent all six, two a day for
  // three days. Every one of them is worth 1.0: the second lead of the day is
  // worth what the first was, and the sixth is worth what the second was, so
  // nobody is punished for following through on somebody they started helping.
  const riley: TransferRow[] = [D1, D1, D2, D2, D3, D3].map((d) => t("Riley", DEREK, d));
  const row = scoreTransferPriority(riley, recipients, { minScored: 1 })[0];
  assert.equal(row.transfers, 6);
  assert.equal(row.scored, 6);
  assert.equal(row.pct, 100);

  // And it is not a fluke of doing it all at once: one a day for six days is the
  // same 100%, because Derek is still the lightest man on the floor each morning.
  const spread = ["2026-08-21", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]
    .map((d) => t("Riley", DEREK, d));
  assert.equal(scoreTransferPriority(spread, recipients, { minScored: 1 })[0].pct, 100);
});

test("BLOCKER — the rule is not gameable by ordering", () => {
  // Every transfer made on the same day reads the same snapshot, so the order
  // the rows arrive in cannot change anybody's number. This is the reason
  // "before" is resolved to the day and not to the row: lead_outcomes carries a
  // date, several land the same day, and whichever order the query happened to
  // return would otherwise decide who got the 100%.
  const rows: TransferRow[] = [
    t("Ann", DEREK, D1), t("Ann", SEAN, D1), t("Bob", DEREK, D1),
    t("Bob", GARY, D2), t("Ann", KHASHI, D2), t("Bob", COLE_LO, D2),
  ];
  const forwards = scoreTransferPriority(rows, recipients, { minScored: 1 });
  const backwards = scoreTransferPriority([...rows].reverse(), recipients, { minScored: 1 });
  assert.deepEqual(forwards, backwards);

  // Two CLRs feeding the same starved LO within the same day cannot see each
  // other, so neither gets a first-mover premium.
  const pair = scoreTransferPriority(
    [t("First", DEREK, D1), t("Second", DEREK, D1)], recipients, { minScored: 1 });
  assert.deepEqual(pair.map((s) => s.mean), [1, 1]);

  // Nor does it matter whether a CLR's day is one row or five.
  const one = scoreTransferPriority([t("Cy", DEREK, D1)], recipients, { minScored: 1 })[0];
  const five = scoreTransferPriority(
    [D1, D1, D1, D1, D1].map((d) => t("Cy", DEREK, d)), recipients, { minScored: 1 })[0];
  assert.equal(one.mean, five.mean);
});

test("the snapshot is reconstructed backwards from the figure the TV shows", () => {
  const rows: TransferRow[] = [D1, D1, D2, D2, D3, D3].map((d) => t("Riley", DEREK, d));
  const { days, loadAt } = snapshotLoads(rows, recipients);
  assert.deepEqual(days, [D1, D2, D3]);
  const derek = recipientKey("lo", DEREK);
  // Six received across the window, so he began it on nothing and climbed.
  assert.equal(loadAt(derek, 0), 0);
  assert.equal(loadAt(derek, 1), 2);
  assert.equal(loadAt(derek, 2), 4);
  assert.equal(loadAt(derek, 3), 6);
  // A row with no usable date reads the end of the window — the harshest
  // snapshot, and the only one that a missing date cannot profit from.
  assert.equal(loadAt(derek, -1), 6);
  // Somebody nobody in this set transferred to never moves.
  assert.equal(loadAt(recipientKey("lo", REDOBLE), 0), 282);
});

test("the reconstruction clamps at zero when the two queries disagree", () => {
  // The received counts and the transfer rows come from two different queries.
  // If more rows name Derek than his count admits, the floor does not go
  // negative and the stat does not crash.
  const rows: TransferRow[] = new Array(10).fill(0).map((_, i) => t("Zed", DEREK, i < 4 ? D1 : D2));
  const { loadAt } = snapshotLoads(rows, recipients);
  assert.equal(loadAt(recipientKey("lo", DEREK), 0), 0);
  assert.equal(scoreTransferPriority(rows, recipients)[0].pct, 100);
});

test("a date is only ever read as a date", () => {
  assert.equal(transferDay("2026-08-24"), "2026-08-24");
  assert.equal(transferDay("2026-08-24T17:04:11.000Z"), "2026-08-24");
  assert.equal(transferDay(""), null);
  assert.equal(transferDay(null), null);
  assert.equal(transferDay("yesterday"), null);
});

// ── the full-credit line ────────────────────────────────────────────────────

test("the band is the lightest quarter, capped — which is Ethan's five and two", () => {
  assert.equal(FULL_CREDIT_SHARE, 0.25);
  assert.equal(fullCreditBandSize(19, FULL_CREDIT_LOS), FULL_CREDIT_LOS);
  assert.equal(fullCreditBandSize(7, FULL_CREDIT_LOAS), FULL_CREDIT_LOAS);
  // The cap holds as the floor grows, so a hiring spree does not widen the band.
  assert.equal(fullCreditBandSize(40, FULL_CREDIT_LOS), 5);
  // ...and it shrinks when there is barely a choice to make, because a band that
  // swallows the whole pool scores everybody the same and answers nothing.
  assert.deepEqual([1, 2, 3, 4, 8].map((n) => fullCreditBandSize(n, FULL_CREDIT_LOS)), [1, 1, 1, 1, 2]);
  assert.equal(fullCreditBandSize(19, 0), 0, "a cap of zero switches the band off");
});

test("the lowest five loan officers actually taking work sit at 100%", () => {
  assert.equal(FULL_CREDIT_LOS, 5);
  const eligible = recipients.filter((r) => r.kind === "lo" && r.receiving);
  // The band IS the head of the shared ranking — not a second sort of its own.
  assert.deepEqual(
    orderStarved(eligible).slice(0, FULL_CREDIT_LOS).map((r) => r.name),
    ["Gary Dawson", "Khashi Tabrizi", "Derek Bullen", "Sean Murphy", "Cole Thomas Fairon"],
  );
  for (const name of ["Gary Dawson", "Khashi Tabrizi", "Derek Bullen", "Sean Murphy", "Cole Thomas Fairon"]) {
    assert.equal(creditOf(name), 1, name);
    assert.equal(bandOf(name), "starved", name);
  }
});

test("Derek Bullen and Sean Murphy — the two names the floor would call starved — are in the band", () => {
  // The reason the band is five and not three: two of the lightest rows are real
  // loan officers sitting on zero, so a three-wide band is spent before it
  // reaches the people everyone means when they say "he needs transfers".
  assert.equal(creditOf("Derek Bullen"), 1);
  assert.equal(creditOf("Sean Murphy"), 1);
  // Measured with the needs_transfers flags off, so this is the cap on its own
  // and not the flag line propping the band up.
  const unflagged = recipients.map(({ needsTransfers, ...r }) => r as RecipientRow);
  const bandAt = (fullCreditLos: number) =>
    recipientCredits(unflagged, { fullCreditLos }).filter((c) => c.kind === "lo" && c.credit === 1).map((c) => c.name);
  assert.deepEqual(bandAt(5),
    ["Gary Dawson", "Khashi Tabrizi", "Derek Bullen", "Sean Murphy", "Cole Thomas Fairon"]);
  assert.deepEqual(bandAt(3), ["Gary Dawson", "Khashi Tabrizi", "Derek Bullen"],
    "at three the band is spent before it reaches Sean Murphy");
});

test("an idle-but-real loan officer is starved, not excluded", () => {
  // Gary Dawson and Khashi Tabrizi took nothing in the fortnight and have a real
  // last-transfer date. Zero is the loudest possible cry for work, so long as
  // there is somebody on the other end of it.
  assert.equal(creditOf("Gary Dawson"), 1);
  assert.equal(creditOf("Khashi Tabrizi"), 1);
});

// ── TRAP 1: the flag promotes, but not the man taking 41% of everything ──────

test("the flag lifts the line to the flagged LO — and carries everybody lighter with him", () => {
  assert.equal(FLAG_PROMOTION_PERCENTILE, 0.5);
  // Over the 19 loan officers actually receiving, the median load is 26.
  assert.equal(flagPromotionCut(recipients.filter((r) => r.kind === "lo" && r.receiving)), 26);
  // Michael Kim (17) carries the flag and is under the median, so the
  // full-credit line moves from 14 up to 17.
  assert.equal(creditOf("Michael Kim"), 1);
  assert.equal(bandOf("Michael Kim"), "flagged");
  // ...and Mateo Tedeschi (16), who never asked for anything but is genuinely
  // lighter, comes with him. This is the monotonicity fix, not a bonus: the old
  // rule gave Kim 1.0 and left Mateo on 0.91, so sending the lead to the lighter
  // of the two scored strictly worse.
  assert.equal(creditOf("Mateo Tedeschi"), 1);
  assert.equal(bandOf("Mateo Tedeschi"), "flagged");
});

test("the flag cannot promote a loan officer who is already well fed", () => {
  // Shervin Mohseni (32) carries the flag and keeps his badge on the TV, but he
  // is above the floor's median. Promoting him would drag every one of the
  // fifteen loan officers lighter than him to full credit, and the stat would
  // separate nobody.
  assert.equal(bandOf("Shervin Mohseni"), "ramp");
  assert.equal(creditOf("Shervin Mohseni"), 0.3333);
  const flip = (name: string) =>
    recipientCredits(recipients.map((r) => (r.name === name ? { ...r, needsTransfers: true } : r)))
      .filter((c) => c.name === name)[0];
  assert.equal(flip("Carlton Long").band, "flagged");   // 26, exactly on the median
  assert.equal(flip("Marcus Woods").band, "ramp");      // 27, one over it
  assert.equal(flip("Bill Neessen").band, "ramp");      // 36, well over it
  assert.equal(flip("Nathan Coutino").band, "ramp");    // 46, over it
});

test("Christopher Redoble is flagged AND scores zero", () => {
  // The whole point of the trap. He carries needs_transfers and took 282 of the
  // 687 transfers in the fortnight; if the flag alone granted 100%, 41% of every
  // transfer in the company would score full marks and the stat would separate
  // nobody.
  const him = byName("Christopher Redoble");
  assert.equal(him.transfers, 282);
  assert.equal(him.band, "ramp", "the flag did not promote him");
  assert.equal(him.credit, 0, "and he is the heaviest receiver, so exactly 0");
});

// ── TRAP 2: rows nobody has ever transferred to ─────────────────────────────

test("demo rows are excluded from the stat, not promoted into the band", () => {
  assert.equal(SCORE_NON_RECEIVING_RECIPIENTS, false);
  const names = inBand();
  for (const ghost of ["Alex Thompson", "Jordan Rivera", "Taylor Morgan",
                       "Casey Bennett", "Morgan Ellis", "Unknown LO (Recovered)"]) {
    assert.ok(!names.includes(ghost), `${ghost} must not sit at 100%`);
    // Not credited at all — not a zero either. A transfer there cannot be read.
    assert.equal(credits.filter((c) => c.name === ghost).length, 0, ghost);
    assert.equal(creditIndex(credits).get(recipientKey("lo", ALEX_DEMO)), undefined);
  }
});

test("the exclusion is exactly what keeps them out — flip it and they take the band", () => {
  // Proof the constant is load-bearing rather than decorative: with the demo
  // rows scored, the whole full-credit band is spent on eight rows nobody has
  // ever transferred to, and Derek Bullen and Sean Murphy — the two names this
  // stat exists to reward — are off it. They are only still at 1.0 at all
  // because Michael Kim's flag happens to hold the line above them, which is
  // luck rather than design.
  const loose = recipientCredits(recipients, { scoreNonReceiving: true });
  const starved = loose.filter((c) => c.band === "starved").map((c) => c.name);
  assert.ok(starved.includes("Alex Thompson"));
  assert.ok(starved.includes("Unknown LO (Recovered)"));
  assert.equal(starved.filter((n) => n === "Derek Bullen" || n === "Sean Murphy").length, 0);
  assert.equal(loose.filter((c) => c.kind === "lo" && c.transfers === 0).length, 8);
});

// ── the ramp ────────────────────────────────────────────────────────────────

test("credit never rises with load — choosing the lighter LO can never score worse", () => {
  // The one invariant this shape exists to guarantee. The old rule jumped a
  // flagged LO to 1.0 and left everybody lighter on the ramp, which meant the
  // stat could pay MORE for the busier desk.
  for (const kind of ["lo", "loa"] as const) {
    const mine = credits.filter((c) => c.kind === kind).sort((a, b) => a.transfers - b.transfers);
    for (let i = 1; i < mine.length; i += 1) {
      assert.ok(mine[i].credit <= mine[i - 1].credit,
        `${mine[i].name} (${mine[i].transfers}) beats ${mine[i - 1].name} (${mine[i - 1].transfers})`);
    }
  }
});

test("the ramp falls from the line to the busiest choice, which is exactly 0", () => {
  const ramp = credits.filter((c) => c.kind === "lo" && c.band === "ramp")
    .sort((a, b) => a.transfers - b.transfers);
  assert.deepEqual(ramp.map((c) => c.credit),
    [0.9167, 0.8333, 0.75, 0.6667, 0.5, 0.5, 0.4167, 0.3333, 0.25, 0.1667, 0.0833, 0]);
  // A 282-strong outlier must not squash everyone else against 100%: a straight
  // interpolation on raw counts would put Nathan Coutino (46) at 94% and
  // separate nobody.
  assert.equal(creditOf("Nathan Coutino"), 0.0833);
  assert.equal(creditOf("Christopher Redoble"), 0);
});

test("the ramp denominator is people, not distinct loads", () => {
  // The old denominator was the number of DISTINCT loads on the floor, so two
  // loan officers happening to land on the same number re-scored everybody else.
  // Drop Kurt Christman from 31 to 30 and only the three men now tied on 30
  // move; nobody else's number changes at all.
  const tied = recipients.map((r) => (r.name === "Kurt Christman" ? { ...r, transfers: 30 } : r));
  const after = new Map(recipientCredits(tied).map((c) => [c.name, c.credit]));
  const moved = credits.filter((c) => after.get(c.name) !== c.credit).map((c) => c.name);
  assert.deepEqual(moved.sort(), ["Mark Gomez", "Nick Barq"]);
  assert.equal(after.get("Dan Baker"), 0.9167);
  assert.equal(after.get("Shervin Mohseni"), 0.3333);
  assert.equal(after.get("Nathan Coutino"), 0.0833);
});

test("equal load earns equal credit", () => {
  assert.equal(byName("Mark Gomez").transfers, byName("Nick Barq").transfers);
  assert.equal(creditOf("Mark Gomez"), creditOf("Nick Barq"));
});

test("every credit is a share between 0 and 1", () => {
  for (const c of credits) {
    assert.ok(c.credit >= 0 && c.credit <= 1, `${c.name} ${c.credit}`);
  }
  assert.equal(credits.length, 19 + 7, "only the recipients this rule can judge");
});

// ── the LOA pool ────────────────────────────────────────────────────────────

test("the two lightest assistants are promoted, and the 25-25 tie is deterministic", () => {
  assert.equal(FULL_CREDIT_LOAS, 2);
  const loas = recipients.filter((r) => r.kind === "loa");
  // orderStarved breaks the tie by name, always the same way.
  assert.deepEqual(orderStarved(loas).map((r) => r.name),
    ["Erik", "Ryan", "Cole", "Mateo", "Aaron", "John", "Justin"]);
  assert.equal(creditOf("Erik"), 1);
  assert.equal(creditOf("Ryan"), 1);
  assert.equal(bandOf("Erik"), "starved");
  assert.equal(bandOf("Ryan"), "starved");
});

test("a tie at the edge of the band takes both: equal load, equal credit", () => {
  // Narrow the band to one and Erik is first by name — but Ryan carries the same
  // 25, and handing one of them 100% and the other 80% for having a later
  // surname would be arbitrary. The line is a LOAD, so a tie cannot be split.
  const one = recipientCredits(recipients, { fullCreditLoas: 1 });
  const pick = (n: string) => one.filter((c) => c.kind === "loa" && c.name === n)[0];
  assert.equal(pick("Erik").credit, 1);
  assert.equal(pick("Ryan").credit, 1);
  assert.equal(pick("Cole").credit, 0.8, "the ramp below them is untouched");
});

test("assistants ramp inside their own pool, never against the loan officers", () => {
  // The heaviest LOA took 54 — a quiet fortnight for a loan officer. One shared
  // ramp would paint every assistant as starved.
  assert.equal(creditOf("Justin"), 0);     // 54
  assert.equal(creditOf("John"), 0.2);     // 53
  assert.equal(creditOf("Aaron"), 0.4);    // 35
  assert.equal(creditOf("Mateo"), 0.6);    // 32
  assert.equal(creditOf("Cole"), 0.8);     // 27
});

// ── the loan officer is the destination ─────────────────────────────────────

test("an assistant can no longer launder a busy loan officer into full credit", () => {
  // Roughly a third of real rows name the LO's assistant as well. The old rule
  // took the BEST of the two, so a transfer into the busiest desk in the company
  // scored 100% because of who happened to sit next to him — the safeguard
  // bypassed on a third of the data, and the score partly measuring which LOs
  // have their assistant field filled in.
  const index = creditIndex(credits);
  assert.equal(creditOf("Christopher Redoble"), 0);
  assert.equal(creditOf("Erik"), 1);
  assert.equal(transferCredit({ clrId: "x", loId: REDOBLE, loaId: ERIK }, index), 0);
  // The starved LO is still worth full credit whoever his assistant is.
  assert.equal(transferCredit({ clrId: "x", loId: DEREK, loaId: JUSTIN }, index), 1);
});

test("the assistant IS the destination when nobody else is named", () => {
  // An LOA-only row is a real placement, and the LOA pool exists for exactly it.
  const index = creditIndex(credits);
  assert.equal(transferCredit({ clrId: "x", loId: null, loaId: ERIK }, index), 1);
  assert.equal(transferCredit({ clrId: "x", loaId: JUSTIN }, index), 0);
});

test("a transfer with nobody identifiable on it scores nothing — not zero", () => {
  const index = creditIndex(credits);
  assert.equal(transferCredit({ clrId: "x", loId: null, loaId: null }, index), null);
  assert.equal(transferCredit({ clrId: "x", loId: 9999 }, index), null, "an LO no longer on the roster");
  assert.equal(transferCredit({ clrId: "x", loId: ALEX_DEMO }, index), null, "a row nobody has ever transferred to");
});

// ── eligibility: scored against the choices that existed ────────────────────

const HEAVY_STATE = [recipientKey("lo", REDOBLE), recipientKey("lo", NATHAN), recipientKey("lo", RYAN_A)];

test("a CLR restricted to a heavy-only state is not punished for obeying the licence", () => {
  // Bea is handed five leads in a state where the only licensed loan officers
  // are the three busiest men in the company. She picks the lightest of them
  // every time — the best available choice, and the app itself told her she had
  // picked correctly.
  const bea: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Bea", clrName: "Bea", loId: RYAN_A, at: d, eligible: HEAVY_STATE }));

  const scoped = scoreTransferPriority(bea, recipients)[0];
  assert.equal(scoped.pct, 100);
  assert.equal(scoped.unrestricted, 0, "she was judged against her own state, not the floor");

  // Scored against the whole floor — which is what the stat used to do — the
  // same five perfect decisions come out at 20%.
  const floor = scoreTransferPriority(bea.map(({ eligible, ...row }) => row), recipients)[0];
  assert.equal(floor.pct, 20);
  assert.equal(floor.unrestricted, 5);
});

test("inside the eligible set the best available is 1 and the worst available is 0", () => {
  const only = recipientCredits(recipients, { poolKeys: HEAVY_STATE });
  assert.deepEqual(only.map((c) => [c.name, c.credit]), [
    ["Ryan Andrade", 1],        // 39 — the lightest she could reach
    ["Nathan Coutino", 0.5],    // 46
    ["Christopher Redoble", 0], // 282 — the worst available, and only 0 here
  ]);
});

test("unknown eligibility falls back to the whole floor, and says so", () => {
  // Never invent a constraint. A missing list means we do not know what the CLR
  // could reach, and the row reports how many transfers were read that way so
  // the fallback cannot hide.
  const rows: TransferRow[] = [D1, D1, D2, D2, D3].map((d) => t("Gil", DEREK, d));
  for (const eligible of [undefined, null, [] as string[]]) {
    const row = scoreTransferPriority(rows.map((r) => ({ ...r, eligible })), recipients)[0];
    assert.equal(row.unrestricted, 5, String(eligible));
    assert.equal(row.pct, 100);
  }
  // An eligibility list naming nobody on the roster is a list we cannot resolve,
  // not a cage. It falls back too, and is reported as the fallback it is.
  const unresolvable = scoreTransferPriority(
    rows.map((r) => ({ ...r, eligible: ["lo:88888", "loa:99999"] })), recipients)[0];
  assert.equal(unresolvable.unrestricted, 5);
  assert.equal(unresolvable.pct, 100);
});

// ── forced destinations: built, documented, and switched off ────────────────

const INVESTMENT_SET = [recipientKey("loa", JUSTIN), recipientKey("loa", JOHN), recipientKey("loa", MATEO_LOA)];

test("HIGH — a compliance answer cannot launder the busiest desk in the building into 100%", () => {
  // The inversion this replaced: a constrained row was scored on the ASSISTANT
  // axis alone, so the loan officer — the destination, by this module's own
  // headline rule — was not scored at all. Cal answers "Investment/2nd Home:
  // Yes", names an allowed assistant, and pushes five leads onto Christopher
  // Redoble, who took 282 of the 687 transfers in the fortnight. That printed
  // 100%: a routing requirement turned into a way to score UP, which is the one
  // thing a rule that exists to stop people being marked DOWN must never be.
  const cal = (loaId: number | null): TransferRow[] => [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loId: REDOBLE, loaId, at: d, constrainedTo: INVESTMENT_SET }));

  const laundered = scoreTransferPriority(cal(MATEO_LOA), recipients)[0];
  assert.equal(laundered.pct, 0, "the loan officer is still the destination");
  assert.equal(laundered.constrained, 5, "the rule did bind the row — it just did not excuse it");
  assert.equal(laundered.breaches, 0, "and he obeyed it");

  // Exactly what the same five are worth with no rule named at all. Obeying a
  // routing requirement buys nothing extra; it only stops a charge.
  assert.equal(
    scoreTransferPriority(cal(MATEO_LOA).map(({ constrainedTo, ...row }) => row), recipients)[0].pct, 0);
});

test("HIGH — ...and a compliant transfer onto a starved desk is still protected", () => {
  // Dee is forced onto Justin — the busiest assistant on the floor, worth
  // exactly 0 in his own pool — and puts the lead in front of Derek Bullen, the
  // lightest loan officer there is. The forced assistant cannot drag her down:
  // the axis the rule forced is compared with John and Mateo and with nobody
  // else, and the axis she was free to choose is judged on its own merits.
  assert.equal(creditOf("Justin"), 0, "the assistant she was sent to is the heaviest on the floor");
  const dee: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Dee", clrName: "Dee", loId: DEREK, loaId: JUSTIN, at: d, constrainedTo: INVESTMENT_SET }));
  const row = scoreTransferPriority(dee, recipients)[0];
  assert.equal(row.pct, 100);
  assert.equal(row.constrained, 5);
  assert.equal(row.breaches, 0);
});

test("the protection bites where the rule is the only thing that chose", () => {
  // An LOA-only row has no free axis at all: the rule picked the destination,
  // so the destination is judged inside the rule's own set. Cal sends five to
  // Mateo — the lightest of the three he is allowed — and scores full marks for
  // making the best choice left to him, against 60% for the same lead judged
  // across the whole assistant pool where Mateo is only mid-table. That gap is
  // the punishment the rule exists to remove.
  const cal: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loaId: MATEO_LOA, at: d, constrainedTo: INVESTMENT_SET }));
  const forced = scoreTransferPriority(cal, recipients)[0];
  assert.equal(forced.pct, 100, "he made the best choice the rule left him");
  assert.equal(forced.constrained, 5);
  assert.equal(forced.unrestricted, 0);
  const free = scoreTransferPriority(cal.map(({ constrainedTo, ...row }) => row), recipients)[0];
  assert.equal(free.pct, 60);
  assert.equal(free.constrained, 0);

  // Protected is still not excused: inside the allowed three there is a choice,
  // and taking the heaviest of them is worth less than taking the lightest.
  const heaviest: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loaId: JUSTIN, at: d, constrainedTo: INVESTMENT_SET }));
  assert.equal(scoreTransferPriority(heaviest, recipients)[0].pct, 40);
});

test("a forced set of one is not a placement decision at all", () => {
  // No discretion, so no judgement: full credit, even though Justin is the
  // busiest assistant on the floor.
  const rows: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loaId: JUSTIN, at: d, constrainedTo: [recipientKey("loa", JUSTIN)] }));
  const row = scoreTransferPriority(rows, recipients)[0];
  assert.equal(row.pct, 100);
  assert.equal(row.constrained, 5);
  // Unconstrained, the same five leads are the heaviest assistant on the floor
  // and the CLR is marked down to 16% for a decision they never made.
  assert.equal(scoreTransferPriority(rows.map(({ constrainedTo, ...r }) => r), recipients)[0].pct, 16);
});

// ── the rule protects the transfer that obeyed it, and only that one ────────

test("HIGH — ignoring the rule scores 0, and never better than an ordinary placement", () => {
  // The inversion this replaced: the constrained pool holds only the three
  // allowed assistants, so a transfer that went somewhere else fell out of the
  // pool entirely, was counted UNREADABLE, and was valued at the floor mean.
  // Answering "Investment/2nd Home: Yes" and then sending the lead to whoever
  // you liked paid BETTER than the placement had earned — the rule erased a bad
  // decision instead of protecting a forced one.
  const rows = (loaId: number): TransferRow[] => [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loId: REDOBLE, loaId, at: d, constrainedTo: INVESTMENT_SET }));

  // Erik is the LIGHTEST assistant on the floor — an excellent placement in any
  // other week, and worth 1.0 unconstrained. Under a rule that did not allow
  // him it is worth nothing at all.
  assert.equal(creditOf("Erik"), 1);
  const gone = scoreTransferPriority(rows(ERIK), recipients)[0];
  assert.equal(gone.pct, 0);
  assert.equal(gone.breaches, 5);
  assert.equal(gone.scored, 5, "a breach is read, not dropped");
  assert.equal(gone.unplaced, 0);
  assert.equal(gone.constrained, 5, "the rule did bind it — that is why it counts against him");

  // And the obedient version of the same five is not a breach — it is judged on
  // the loan officer it landed on, exactly as it would have been with no rule
  // named at all. Redoble is the busiest desk in the building either way, so
  // this is 0 for the placement rather than 0 for the rule, and the counters
  // are what tell a manager which of the two happened.
  const obeyed = scoreTransferPriority(rows(MATEO_LOA), recipients)[0];
  assert.equal(obeyed.pct, 0);
  assert.equal(obeyed.breaches, 0);

  // Sharper, on the same desk: Derek Bullen is the lightest man on the floor,
  // so the placement is worth 1.0 — and a breach still takes it to 0, because
  // ignoring a compliance rule is a verdict on the rule and not a reading of
  // the pool.
  const onDerek = (loaId: number): TransferRow[] => [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loId: DEREK, loaId, at: d, constrainedTo: INVESTMENT_SET }));
  assert.equal(scoreTransferPriority(onDerek(ERIK), recipients)[0].pct, 0);
  assert.equal(scoreTransferPriority(onDerek(MATEO_LOA), recipients)[0].pct, 100);

  // A breach can never outscore a well-placed transfer, which was the whole
  // complaint: it is the worst score available, not the floor's average.
  const mixed = scoreTransferPriority(
    [...rows(ERIK), ...[D1, D1, D2, D2, D3].map((d) => t("Ada", DEREK, d))], recipients);
  assert.deepEqual(mixed.map((s) => [s.name, s.pct]), [["Ada", 100], ["Cal", 0]]);
});

test("a flagged transfer with no LOA on it means WE CANNOT TELL, and is judged as it stands", () => {
  // loa_id is filled on roughly a third of real rows, so a blank one is a field
  // nobody wrote — not a lead that demonstrably went where it was not allowed.
  // A compliance breach is the sharpest verdict this stat hands out and it is
  // the last thing that may hang off a blank.
  //
  // But "we cannot tell whether the rule was followed" must not become "we
  // cannot tell where this went". The rule steps aside and the transfer is
  // judged as the placement the record does show — which is how a lead pushed
  // onto the busiest desk in the building stops being laundered into the floor
  // mean by an answer on a form.
  const onto = (loId: number): TransferRow[] => [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loId, loaId: null, at: d, constrainedTo: INVESTMENT_SET }));

  const worst = scoreTransferPriority(onto(REDOBLE), recipients)[0];
  assert.equal(worst.pct, 0, "the busiest desk in the building is still the busiest desk");
  assert.equal(worst.unplaced, 0, "and it is no longer unreadable");
  assert.equal(worst.breaches, 0, "nor is it called a breach");
  assert.equal(worst.constrained, 0);
  assert.equal(worst.unrestricted, 5, "reported as the free reading it fell back to");

  // The same fallback is not a punishment either: a genuinely good placement
  // with no assistant recorded still scores what it deserves.
  const best = scoreTransferPriority(onto(DEREK), recipients)[0];
  assert.equal(best.pct, 100);
  assert.equal(best.unrestricted, 5);

  // An eligible set that came with the row is honoured on the way down, rather
  // than the whole floor being reached for.
  const scoped = scoreTransferPriority(
    onto(RYAN_A).map((r) => ({ ...r, eligible: HEAVY_STATE })), recipients)[0];
  assert.equal(scoped.pct, 100);
  assert.equal(scoped.unrestricted, 0);
});

test("an id nobody on the roster answers to is not evidence of a breach", () => {
  // Same rule as everywhere else in this file: a thing we cannot resolve is
  // missing information, never an accusation.
  const rows: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loId: DEREK, loaId: 99999, at: d, constrainedTo: INVESTMENT_SET }));
  const row = scoreTransferPriority(rows, recipients)[0];
  assert.equal(row.breaches, 0);
  assert.equal(row.unrestricted, 5, "read as unconstrained, and judged on the LO it names");
  assert.equal(row.pct, 100);
});

test("HIGH — recording the LOA or leaving it blank is the same score for the same work", () => {
  // `loa_id` is optional and blank on roughly two-thirds of real transfers, so
  // whether the compliance rule can be read at all came down to whether
  // somebody used the picker. While a constrained row was judged on the
  // assistant ALONE that was worth a hundred points: two CLRs doing the
  // identical, identically compliant thing came out 100% apart because one of
  // them filled a field in. That is CRM hygiene, not placement, and the
  // write-up completeness stat already charges for the gap exactly once.
  const mix = [REDOBLE, NATHAN, KIM, SEAN, DEREK];
  const days = [D1, D1, D2, D2, D3];
  const rows = (clrId: string, loaId: number | null): TransferRow[] => mix.map((loId, i) =>
    ({ clrId, clrName: clrId, loId, loaId, at: days[i], constrainedTo: INVESTMENT_SET }));

  const both = scoreTransferPriority([...rows("Ivy", MATEO_LOA), ...rows("Jo", null)], recipients);
  const ivy = both.filter((s) => s.name === "Ivy")[0];
  const jo = both.filter((s) => s.name === "Jo")[0];
  assert.equal(ivy.pct, 62);
  assert.equal(jo.pct, 62);
  // The stated tolerance is ONE POINT, and the actual difference is nothing at
  // all: the score is taken from the same destination either way, and all the
  // recorded field changes is which counter the row lands in.
  assert.ok(Math.abs(ivy.pct! - jo.pct!) <= 1, "inside the one-point tolerance");
  assert.equal(ivy.mean, jo.mean, "identical, not merely close");
  assert.equal(ivy.constrained, 5);
  assert.equal(jo.unrestricted, 5);

  // And it holds at both ends of the scale, not only in the middle of it.
  for (const [only, expected] of [[REDOBLE, 0], [DEREK, 100]] as const) {
    const pair = scoreTransferPriority([
      ...days.map((d) => ({ clrId: "Ivy", clrName: "Ivy", loId: only, loaId: MATEO_LOA, at: d, constrainedTo: INVESTMENT_SET })),
      ...days.map((d) => ({ clrId: "Jo", clrName: "Jo", loId: only, loaId: null, at: d, constrainedTo: INVESTMENT_SET })),
    ], recipients);
    assert.deepEqual(pair.map((s) => s.pct), [expected, expected], String(only));
  }
});

test("the three readings of a compliance rule are written down next to the arithmetic", () => {
  assert.match(src, /WHAT "PROTECTED" MEANS, AND WHAT IT DOES NOT/);
  assert.match(src, /PROTECTED DOES NOT MEAN the transfer is excused/);
  assert.match(src, /THE THREE READINGS/);
  assert.match(src, /WHAT AN INVESTMENT PROPERTY WITH NO loa_id MEANS/);
  assert.match(src, /It means WE CANNOT TELL, and that is a different answer from "they broke the\n \* rule"/);
  // And why a blank can no longer move a score by anything like a hundred.
  assert.match(src, /AND WHY A BLANK BARELY MATTERS ANY MORE/);
});

test("an unresolvable forced set is not a constraint, and is reported as the floor", () => {
  const rows: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loaId: MATEO_LOA, at: d, constrainedTo: ["loa:99999"] }));
  const row = scoreTransferPriority(rows, recipients)[0];
  assert.equal(row.constrained, 0);
  assert.equal(row.unrestricted, 5);
  assert.equal(row.pct, 60, "scored exactly as if no rule had been named");
});

test("the investment-property rule is switched ON, and still reads nothing itself", () => {
  // It stayed inert for as long as the FACT did not exist in a form anybody
  // could trust — lead_goal is empty on every transfer in production and
  // lead_type has two rows in total. The qualification question is what
  // switched it on, because the app composes that answer itself.
  assert.equal(INVESTMENT_PROPERTY_INPUT_AVAILABLE, true);
  assert.deepEqual([...INVESTMENT_PROPERTY_LOAS], ["Justin", "John", "Mateo"]);
  // The constant still resolves against the ROSTER, and only against the roster.
  assert.deepEqual(investmentPropertyKeys(recipients).sort(), [...INVESTMENT_SET].sort());
  assert.deepEqual(investmentPropertyKeys([]), []);

  // And the SCORING path still never calls it. A transfer that arrives with no
  // `constrainedTo` is judged as the free choice it was, whatever might have
  // been written anywhere else about it — switching the rule on moved the
  // decision into the route, it did not move any guessing in here.
  const rows: TransferRow[] = [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId: "Cal", clrName: "Cal", loaId: JUSTIN, at: d }));
  const row = scoreTransferPriority(rows, recipients)[0];
  assert.equal(row.constrained, 0);
  assert.equal(row.pct, 16, "judged as a free choice, because nothing said otherwise");
});

// ── the fact the rule now hangs off ─────────────────────────────────────────
//
// This is the parse that decides whether somebody is measured against three
// assistants or against the whole floor, so it is pinned against the REAL
// composer rather than against a hand-typed approximation of it.

/** A capture with only the investment question answered, as the app writes it. */
const composed = (answer: "yes" | "no" | ""): string =>
  composeLeadCaptureNotes({ ...emptyLeadCapture(), qualInvestment: answer });

test("an app-composed Yes is the only thing that counts as an investment property", () => {
  const yes = composed("yes");
  // The composer rides its routing hint on the answer, and the parse has to
  // read past it — this is the exact string production stores.
  assert.match(yes, /^Investment\/2nd Home: Yes — give to LOA Justin, Mateo, or John$/);
  assert.equal(isInvestmentProperty(yes), true);
  assert.equal(qualAnswer(yes, INVESTMENT_PROPERTY_LABEL), "yes");
  // The label is one the completeness parser already knows, not a new string
  // invented here that could drift away from the composer.
  assert.ok((QUAL_LABELS as readonly string[]).includes(INVESTMENT_PROPERTY_LABEL));
});

test("an app-composed No does not constrain anything", () => {
  const no = composed("no");
  assert.match(no, /^Investment\/2nd Home: No$/);
  assert.equal(isInvestmentProperty(no), false);
  assert.equal(qualAnswer(no, INVESTMENT_PROPERTY_LABEL), "no");
  // Unanswered is not No, and it is certainly not Yes.
  assert.equal(composed(""), "");
  assert.equal(isInvestmentProperty(composed("")), false);
  assert.equal(qualAnswer(composed(""), INVESTMENT_PROPERTY_LABEL), null);
});

test("free text mentioning the word is never an investment property", () => {
  // The Shotgun result path stores a CLR's raw note straight into
  // conversation_notes, so every one of these really can reach the parser. A
  // keyword search would constrain the first four, and the first of them says
  // the OPPOSITE of what it would have been read as.
  for (const note of [
    "Not an investment property, they live there",
    "Borrower asked about investment properties later on",
    "investment",
    "Property is a second home? unclear — call back",
    "Investment/2nd Home: not sure",
    "Investment/2nd Home: maybe, sounded like a rental",
    "Investment/2nd Home: Yes it is a rental",
    "Investment/2nd Home:",
    "Owns Home: Yes",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isInvestmentProperty(note), false, String(note));
  }
});

test("the answer is read at the START of a line, like every other marker", () => {
  const real = composed("yes");
  // Sitting inside a bigger blob is the normal case and must work...
  assert.equal(isInvestmentProperty(`Owns Home: Yes\n${real}\nMilitary: No`), true);
  // ...but a label mentioned mid-sentence is somebody talking, not an answer.
  assert.equal(isInvestmentProperty(`Asked about Investment/2nd Home: Yes was the reply`), false);
  assert.equal(isInvestmentProperty(`Second Investment/2nd Home: Yes`), false);
});

test("the constraint the parse feeds is the one the stat already tested", () => {
  // The two halves joined up, on the route's own arithmetic. Cal sends five to
  // Mateo — the lightest of the three the rule allows him. With an app-composed
  // Yes he is judged against those three and scores 100% for making the best
  // choice left to him. With a No, or with a sentence merely mentioning the
  // word, the rule never bound him: the same five are a free choice across the
  // whole assistant pool, where Mateo is mid-table, and score 60%. Nothing
  // between those two readings is a guess.
  const constrainedTo = investmentPropertyKeys(recipients);
  const rows = (note: string): TransferRow[] => [D1, D1, D2, D2, D3].map((d) => ({
    clrId: "Cal", clrName: "Cal", loaId: MATEO_LOA, at: d,
    constrainedTo: isInvestmentProperty(note) ? constrainedTo : null,
  }));
  const yes = scoreTransferPriority(rows(composed("yes")), recipients)[0];
  assert.equal(yes.constrained, 5);
  assert.equal(yes.pct, 100);
  const no = scoreTransferPriority(rows(composed("no")), recipients)[0];
  assert.equal(no.constrained, 0);
  assert.equal(no.pct, 60);
  const chatter = scoreTransferPriority(rows("not an investment property"), recipients)[0];
  assert.equal(chatter.constrained, 0, "a sentence about it is not an answer to it");
  assert.equal(chatter.pct, 60);
});

test("nothing in this module reads note text or matches a keyword", () => {
  // The guard that keeps the mechanism from quietly becoming the guess. Comments
  // are allowed to discuss notes; code is not allowed to touch them.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const literals = code.match(/(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g) ?? [];
  assert.ok(!/\bnotes?\b/i.test(code), "no code path reads a note field");
  assert.ok(!literals.some((s) => /invest|property|goal|lead_?type/i.test(s)),
    "no string literal reaches for the fact this rule refuses to guess");
  assert.ok(!/\.includes\(\s*["'`]/.test(code), "no substring matching against a literal");
  // The one place a name is compared is the roster resolver, and it is the only
  // case-folding in the file.
  assert.equal((code.match(/toLowerCase/g) ?? []).length, 2, "only investmentPropertyKeys folds case");
});

// ── the stat, over a floor of CLRs ──────────────────────────────────────────

const board: TransferRow[] = [
  // Dana: six into the busiest desk in the building.
  t("Dana", REDOBLE, D1), t("Dana", REDOBLE, D1), t("Dana", REDOBLE, D2),
  t("Dana", REDOBLE, D2), t("Dana", REDOBLE, D3), t("Dana", REDOBLE, D3),
  // Riley: six into Derek Bullen, who began the fortnight on nothing.
  t("Riley", DEREK, D1), t("Riley", DEREK, D1), t("Riley", DEREK, D2),
  t("Riley", DEREK, D2), t("Riley", DEREK, D3), t("Riley", DEREK, D3),
  // Sam: a mixed bag of five — the worst, the best, and three off the ramp.
  t("Sam", REDOBLE, D1), t("Sam", KIM, D1), t("Sam", MATEO_LO, D2),
  t("Sam", NATHAN, D2), t("Sam", SEAN, D3),
  // Wes: three records nothing can read.
  t("Wes", null, D1), t("Wes", 9999, D1), t("Wes", ALEX_DEMO, D2),
  // Ola: one perfect placement and four records nothing can read.
  t("Ola", COLE_LO, D1), t("Ola", null, D1), t("Ola", null, D2),
  t("Ola", 9999, D2), t("Ola", ALEX_DEMO, D3),
  // Pia: two, both perfect — under the sample floor.
  t("Pia", GARY, D1), t("Pia", KHASHI, D2),
];

const scored = scoreTransferPriority(board, recipients, { roster: [{ clrId: "Nia", name: "Nia" }] });
const clr = (name: string): ClrPriorityScore => {
  const found = scored.filter((s) => s.name === name);
  assert.equal(found.length, 1, `exactly one ${name}`);
  return found[0];
};

test("a CLR who fed only the busiest desk scores 0%", () => {
  const dana = clr("Dana");
  assert.equal(dana.transfers, 6);
  assert.equal(dana.scored, 6);
  assert.equal(dana.pct, 0);
  assert.equal(dana.ranked, true, "0% is a verdict the data earned, and it is ranked");
});

test("a CLR who fed the starved scores 100%, and volume is not what did it", () => {
  assert.equal(clr("Riley").pct, 100);
  assert.equal(clr("Riley").transfers, clr("Dana").transfers);
  assert.equal(clr("Dana").pct, 0);
});

test("a mixed CLR lands in the middle", () => {
  const sam = clr("Sam");
  assert.equal(sam.scored, 5);
  assert.equal(sam.pct, 62);
  assert.equal(sam.mean, 0.6167);
});

// ── a record nobody can read no longer pays ─────────────────────────────────

test("mis-filed records stop lifting a score — they are counted at the floor mean", () => {
  // Ola made one placement anybody would applaud and four records nothing can
  // read. The old rule dropped the four and printed 100%, which paid for a data
  // gap in exactly the direction the write-up completeness stat charges for it.
  const ola = clr("Ola");
  assert.equal(ola.transfers, 5);
  assert.equal(ola.scored, 1);
  assert.equal(ola.unplaced, 4);
  assert.equal(ola.unplacedValuedAt, 0.6042, "the mean of every readable transfer on the floor");
  assert.equal(ola.pct, 68, "not the 100% the old rule printed");
  assert.ok(ola.mean! < clr("Riley").mean!, "and no longer level with a clean sheet");
});

test("...and a data gap is never an accusation either", () => {
  // Moe fed the busiest desk three times and filed two records nothing can read.
  // The gap does not score him 0 — it lifts him toward the floor, because a CRM
  // field that never got written is not evidence anybody placed a lead badly.
  const moe: TransferRow[] = [
    t("Moe", REDOBLE, D1), t("Moe", REDOBLE, D1), t("Moe", REDOBLE, D2),
    t("Moe", null, D2), t("Moe", null, D3),
  ];
  const row = scoreTransferPriority([...board, ...moe], recipients)
    .filter((s) => s.name === "Moe")[0];
  assert.equal(row.scored, 3);
  assert.equal(row.unplaced, 2);
  assert.equal(row.mean, 0.2101);
  assert.ok(row.mean! > 0, "never 0");
  assert.ok(row.mean! < row.unplacedValuedAt!, "and never the floor's own average either");
});

test("a CLR with nothing readable at all scores null, not the floor's average", () => {
  const wes = clr("Wes");
  assert.deepEqual(
    [wes.transfers, wes.scored, wes.unplaced, wes.pct, wes.mean, wes.ranked],
    [3, 0, 3, null, null, false],
  );
});

test("a CLR with no transfers scores null, not 0%", () => {
  // 0% is a verdict — "you fed the busiest desk in the building". Printing it
  // over an empty fortnight would be an accusation the data never earned.
  const nia = clr("Nia");
  assert.deepEqual([nia.transfers, nia.scored, nia.pct, nia.mean, nia.ranked], [0, 0, null, null, false]);
});

// ── the minimum sample ──────────────────────────────────────────────────────

test("one lucky transfer cannot top the leaderboard over sixty careful ones", () => {
  assert.equal(MIN_SCORED_TRANSFERS, 5);
  const pia = clr("Pia");
  assert.equal(pia.pct, 100, "the number is still shown — hiding it is its own accusation");
  assert.equal(pia.ranked, false);
  // A perfect two sits below a ranked zero, because two is not a sample.
  assert.ok(scored.indexOf(pia) > scored.indexOf(clr("Dana")));
  // And the floor is a dial, not a law of nature: drop it to one and her two
  // perfect transfers rejoin the ranking, above everybody who placed worse.
  const loose = scoreTransferPriority(board, recipients, { roster: [{ clrId: "Nia", name: "Nia" }], minScored: 1 });
  const loosePia = loose.filter((s) => s.name === "Pia")[0];
  assert.equal(loosePia.ranked, true);
  assert.deepEqual(loose.map((s) => s.name), ["Riley", "Pia", "Ola", "Sam", "Dana", "Nia", "Wes"]);
});

// ── the order of the board ──────────────────────────────────────────────────

test("the ranking is above the fold, and everything else is a footnote", () => {
  // A null used to sort BELOW a 0%, which re-imposed the accusation the null
  // existed to avoid: the bottom of a league table reads as worst on the floor.
  // `ranked` splits the list instead — the dashboard renders the tail as a
  // footnote, not as places four through seven.
  assert.deepEqual(scored.map((s) => s.name), ["Riley", "Sam", "Dana", "Pia", "Ola", "Nia", "Wes"]);
  assert.deepEqual(scored.filter((s) => s.ranked).map((s) => s.name), ["Riley", "Sam", "Dana"]);
  // Inside the tail: the provisional numbers first, then the silent rows by name.
  const tail = scored.filter((s) => !s.ranked);
  assert.deepEqual(tail.map((s) => s.pct), [100, 68, null, null]);
  assert.deepEqual(tail.filter((s) => s.pct === null).map((s) => s.name), ["Nia", "Wes"]);
});

test("the sort is total, so two identical CLRs cannot swap places between runs", () => {
  const rows = (ids: string[]) => ids.flatMap((id) =>
    [D1, D1, D2, D2, D3].map((d) => ({ clrId: id, clrName: "Same Name", loId: DEREK, at: d })));
  const forwards = scoreTransferPriority(rows(["a", "b"]), recipients).map((s) => s.clrId);
  const backwards = scoreTransferPriority(rows(["b", "a"]), recipients).map((s) => s.clrId);
  assert.deepEqual(forwards, ["a", "b"]);
  assert.deepEqual(backwards, ["a", "b"]);
});

test("a transfer with no CLR on it does not invent a person", () => {
  const rows = scoreTransferPriority(
    [t("Dana", DEREK, D1), { clrId: "", loId: DEREK, at: D1 }, { clrId: null as any, loId: DEREK, at: D1 }],
    recipients,
  );
  assert.deepEqual(rows.map((s) => s.name), ["Dana"]);
  assert.equal(rows[0].transfers, 1);
});

test("no transfers at all is an empty board, not a crash", () => {
  assert.deepEqual(scoreTransferPriority([], recipients), []);
  assert.deepEqual(scoreTransferPriority([], []), []);
  assert.deepEqual(recipientCredits([]), []);
  assert.deepEqual(recipientCredits(recipients, { poolKeys: [] }).length, 26, "an empty pool is no pool");
});

// ── the small arithmetic, and the sharp edges ───────────────────────────────

test("junk counts clamp exactly the way compareStarved clamps them", () => {
  assert.equal(receivedCount({ transfers: 30 }), 30);
  assert.equal(receivedCount({ transfers: -3 }), 0);
  assert.equal(receivedCount({ transfers: Number.NaN }), 0);
  assert.equal(receivedCount({ transfers: null }), 0);
});

test("the percentile is a load somebody actually carries, and is always a number", () => {
  assert.equal(percentileNearestRank([1, 2, 3, 4], 0.75), 3);
  assert.equal(percentileNearestRank([10], 0.75), 10);
  assert.equal(percentileNearestRank([], 0.75), 0);
  // It is typed `number`, so it must never hand back undefined. A percentile
  // that is not a number fails closed rather than leaking a NaN into the credit.
  for (const junk of [Number.NaN, undefined as any, "half" as any]) {
    const v = percentileNearestRank([1, 2, 3, 4], junk);
    assert.equal(typeof v, "number");
    assert.ok(Number.isFinite(v), String(junk));
  }
  assert.equal(percentileNearestRank([1, 2, 3, 4], 5), 4, "clamped to the top");
  assert.equal(percentileNearestRank([1, 2, 3, 4], -2), 1, "clamped to the bottom");
  const loads = recipients.filter((r) => r.kind === "lo" && r.receiving).map((r) => r.transfers);
  assert.equal(loads.length, 19);
  assert.equal(percentileNearestRank(loads, FLAG_PROMOTION_PERCENTILE), 26);
});

test("a recipient arriving twice does not shift the band", () => {
  // A fanned-out join used to be able to put the same loan officer in the pool
  // twice, which moved the band edge by a person and made the ramp shallower.
  const dupes = [
    ...recipients,
    lo(REDOBLE, "Christopher Redoble", 282, { needsTransfers: true }),
    lo(DEREK, "Derek Bullen", 6),
    lo(DEREK, "Derek Bullen", 0),
  ];
  const twice = recipientCredits(dupes);
  assert.equal(twice.length, credits.length);
  assert.deepEqual(twice.map((c) => `${c.name}=${c.credit}`), credits.map((c) => `${c.name}=${c.credit}`));
});

test("a clrId of __proto__ is a row, not a write to Object.prototype", () => {
  const before = Object.keys(Object.prototype).length;
  const rows = scoreTransferPriority(
    [D1, D1, D2, D2, D3].map((d) => ({ clrId: "__proto__", clrName: "__proto__", loId: DEREK, at: d })),
    recipients,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pct, 100);
  assert.equal(Object.keys(Object.prototype).length, before);
  assert.equal(({} as Record<string, unknown>).transfers, undefined);
  // The credit index is a Map for the same reason.
  assert.ok(creditIndex(credits) instanceof Map);
});

// ── the rule this module must not quietly re-implement ──────────────────────

test("the ranking comes from tv-pages, so the TV and the dashboard cannot drift", () => {
  assert.match(src, /import \{[^}]*orderStarved[^}]*\} from "\.\/tv-pages"/);
  assert.match(src, /orderStarved\(eligible\)/);
  // No second comparator of its own: whoever changes the starved order changes
  // both pages at once, on purpose.
  assert.ok(!/function compare/.test(src), "no local ranking function");
  assert.ok(!/receivedCount\([a-z]\) - receivedCount/.test(src), "no local sort by transfers received");
  // And the difference between the two rules is written down where it lives.
  assert.match(src, /compareStarved deliberately keeps `needs_transfers` OUT/);
});

test("the rules that judge people are written down next to the arithmetic", () => {
  // Every one of these is a decision somebody will be asked to defend to a CLR
  // whose number went down. If the sentence goes, the reason goes with it.
  assert.match(src, /WHAT "BEFORE" MEANS, AND WHY IT IS THE DAY/);
  assert.match(src, /THE LOAN OFFICER IS THE DESTINATION/);
  assert.match(src, /UNPLACED: WHAT AN UNREADABLE RECORD IS WORTH/);
  assert.match(src, /WHY THIS IS NOW SWITCHED ON/);
  assert.match(src, /Credit is a function of LOAD ALONE, and never increases with it/);
});

// ── wired up: the server row and the dashboard column ───────────────────────

/** Just the manager-dashboard placement scan. */
function placementScan(): string {
  const start = routes.indexOf("const placementByUser = new Map<number, PlacementCell>();");
  assert.ok(start > 0, "the manager dashboard builds a placement score");
  const end = routes.indexOf("const leaderboard = countedClrs", start);
  assert.ok(end > start, "and it sits just above the leaderboard rows it feeds");
  return routes.slice(start, end);
}


test("the server fills that column from this module, over the row's own window", () => {
  const scan = placementScan();
  assert.match(scan, /scoreTransferPriority\(/, "the rule is not reimplemented in the route");
  assert.match(routes, /placementScore: placementByUser\.get\(u\.id\)\?\.ranked \? placementByUser\.get\(u\.id\)!\.pct : null/);
  // The transfers SCORED are startDate/endDate — the range every other cell on
  // that row is counted over. A second scoring window would put two different
  // fortnights on one line.
  assert.match(scan, /outcome_type='transfer' AND date >= \? AND date <= \?`,\r?\n\s*\)\.all\(placementOrg, startDate, endDate\)/);
  assert.ok(!/\bw\.weekStart\b/.test(scan), "no window of its own");
  // Context, never a reason to fail the dashboard — the bargain the write-up
  // scan beside it already makes.
  assert.match(scan, /catch \(e: any\) \{/);
});

// ── BLOCKER: the floor a transfer is judged against has to be a real one ────

test("the recipients are counted over a RUN-UP, so nobody starts the window on zero", () => {
  // The reconstruction subtracts the range's own transfers from each
  // recipient's count. Count the recipients over the range alone — which is
  // what this scan used to do — and the subtraction takes the whole thing:
  // every loan officer begins the window on nothing, the floor is flat, and the
  // busiest desk in the building is worth what the emptiest is.
  const scan = placementScan();
  assert.match(scan, /const placementFrom = starvedWindowStart\(startDate\);/,
    "the run-up is the same fortnight the TV's starved page measures");
  // Both recipient queries are counted from it, and both still end at the range.
  assert.equal(scan.split(").all(placementFrom, endDate").length - 1, 2,
    "loan officers and assistants both reach back before the range");
  // ...and the transfers being judged are NOT widened with them.
  assert.ok(!/\.all\(placementOrg, placementFrom/.test(scan), "the run-up is never scored");
  // The reason is written where somebody would otherwise 'tidy' it away.
  assert.match(scan, /THE RECIPIENTS ARE COUNTED OVER A RUN-UP AS WELL AS THE RANGE/);
});


test("the module says out loud that the same window on both sides rebuilds zeroes", () => {
  assert.match(src, /THAT SUBTRACTION IS ONLY HONEST IF THE COUNT REACHES FURTHER BACK THAN THE\n \* ROWS\./);
  assert.match(src, /starvedWindowStart/, "and names the helper the caller uses");
});

test("a start-of-window load is exactly what the run-up left behind", () => {
  // Derek took six in the range and Riley sent all six — but the count handed
  // over covers the run-up too, so he was already carrying four when the window
  // opened. Every snapshot sits on top of those four instead of on zero.
  const withRunUp = recipients.map((r) =>
    (r.kind === "lo" && r.id === DEREK ? { ...r, transfers: 10 } : r));
  const rows: TransferRow[] = [D1, D1, D2, D2, D3, D3].map((d) => t("Riley", DEREK, d));
  const { loadAt } = snapshotLoads(rows, withRunUp);
  const derek = recipientKey("lo", DEREK);
  assert.deepEqual([0, 1, 2, 3].map((i) => loadAt(derek, i)), [4, 6, 8, 10]);
  // Counted over the range alone the same six rows rebuild him as empty, which
  // is the bug: his first morning of the window looks identical to a loan
  // officer nobody has sent anything to in a fortnight.
  assert.equal(snapshotLoads(rows, recipients).loadAt(derek, 0), 0);
});

test("BLOCKER — a real floor separates the best placement from the worst on a ONE-DAY window", () => {
  // The dashboard's default range is a single day. With the recipients counted
  // over that day alone every load rebuilds as zero, so the whole floor sits in
  // the full-credit band and every CLR reads 100% — including the one who put
  // every lead on the busiest desk in the building.
  const oneDay: TransferRow[] = [
    ...[1, 2, 3, 4, 5].map(() => t("Dana", REDOBLE, D1)),
    ...[1, 2, 3, 4, 5].map(() => t("Riley", DEREK, D1)),
  ];
  // The floor as the old scan handed it over: counted over the day itself.
  const dayOnly: RecipientRow[] = recipients.map((r) => ({
    ...r,
    transfers: r.kind === "lo" && (r.id === REDOBLE || r.id === DEREK) ? 5 : 0,
  }));
  const flat = scoreTransferPriority(oneDay, dayOnly);
  assert.deepEqual(flat.map((s) => [s.name, s.pct]), [["Dana", 100], ["Riley", 100]]);

  // The same day against a floor counted over the run-up as well: the answer
  // the manager is actually owed.
  const real = scoreTransferPriority(oneDay, recipients);
  assert.deepEqual(real.map((s) => [s.name, s.pct]), [["Riley", 100], ["Dana", 0]]);
});


test("the scan is memoised, because one request builds ten windows", () => {
  // "All time" reads every transfer the company has logged and rebuilds the
  // floor for every day of it, and the endpoint does that ten times per page
  // load, synchronously, for every manager with the dashboard open.
  assert.match(routes, /const PLACEMENT_CACHE_TTL_MS = 2 \* 60 \* 1000;/);
  assert.match(routes, /const placementCache = new Map<string, \{ at: number; rows: Map<number, PlacementCell> \}>\(\);/);
  const scan = placementScan();
  // Keyed on the window, so the ten windows cannot share an entry and
  // yesterday's "Today" cannot be served as today's.
  assert.match(scan, /const placementKey = `\$\{placementOrg\}\|\$\{startDate\}\|\$\{endDate\}`;/);
  assert.match(scan, /placementCache\.set\(placementKey, \{ at: cachedAt, rows: cached \}\)/);
  // The keys carry dates, so yesterday's can never be asked for again. A cache
  // that only ever grows is a slow leak in a process that runs for weeks.
  assert.match(scan, /if \(cachedAt - v\.at >= PLACEMENT_CACHE_TTL_MS\) placementCache\.delete\(k\);/);
});

test("the placement column is held back, and says why in the source", () => {
  // The scoring is finished and the server still computes placementScore, but
  // the column is NOT rendered. Review found the compliance rule cannot protect
  // anyone in production — an assistant belongs to exactly one loan officer and
  // the transfer form only offers that LO's assistants — so the rule can only
  // ever lower a score, and recording loa_id costs up to 100 points where
  // leaving it blank does not. That rewards withholding data, which is the
  // opposite of what a number managers judge people by should do.
  //
  // This test exists so the column cannot quietly reappear without the two
  // things that would make it fair: loa_id required on a transfer, and state
  // licensing supplying TransferRow.eligible.
  const cols = mgr.slice(mgr.indexOf("const cols"), mgr.indexOf("];", mgr.indexOf("const cols")));
  // Comments stripped first: the held-back entry is left commented in place,
  // so a raw match would find the very string this test exists to forbid.
  const live = cols
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith(String.fromCharCode(47, 47)))
    .join(String.fromCharCode(10));
  assert.doesNotMatch(live, /key: "placement"/, "the Placed column must not be rendered yet");
  assert.doesNotMatch(live, /label: "Placed"/);
  assert.match(mgr, /HELD BACK, deliberately/, "and the source says why");
  assert.match(mgr, /loa_id is required/, "naming what would unblock it");
  // The write-up column it was meant to sit beside is untouched.
  assert.match(cols, /key: "writeUp"/);
});

test("the server still computes the placement score, ready to render", () => {
  // Holding the column back is a UI decision, not a rollback: the scan, the
  // cache and the module all stay, so re-adding one entry to `cols` is the
  // whole job once the data supports it.
  assert.match(routes, /placementScore/);
  assert.match(routes, /placementByUser/);
});

test("a snapshot is an array read, not a walk over the window", () => {
  // loadAt used to sum the days before it on every call, and the scan asks for
  // one per recipient per day: O(days squared) over a window that can be six
  // years long. The cumulative pass makes it O(1), and the numbers do not move.
  assert.match(src, /const before = new Map<string, number\[\]>\(\);/);
  assert.match(src, /run\[d \+ 1\] = run\[d\] \+ counts\[d\]/);
  assert.ok(!/for \(let d = 0; d < i /.test(src), "no per-lookup walk survives");
  // ...and the note beside it no longer sends the next person at the wrong
  // loop. It used to call this walk "the most expensive work on the
  // manager-dashboard endpoint", which is out by roughly fifty times: the
  // endpoint's cost is the SQL around this module, and inside the module it is
  // the memo that does the work.
  assert.match(src, /WHAT THIS IS NOT is "the most expensive work on the manager-dashboard/);
  assert.match(src, /the thing that actually holds the cost down is the/);
  assert.match(src, /MEMO in `scoreTransferPriority`/);
  const rows: TransferRow[] = [D1, D1, D2, D2, D3, D3].map((d) => t("Riley", DEREK, d));
  const { loadAt } = snapshotLoads(rows, recipients);
  const derek = recipientKey("lo", DEREK);
  assert.deepEqual([-1, 0, 1, 2, 3, 9].map((i) => loadAt(derek, i)), [6, 0, 2, 4, 6, 6]);
});

test("recipients are the ones actually receiving, and nobody is named to get there", () => {
  const scan = placementScan();
  // TRAP 2, in SQL. A real MAX(o.date) is what separates a loan officer who is
  // idle from a seeded demo row that has never taken anything, and it does it
  // without this query knowing a single name.
  assert.match(scan, /MAX\(o\.date\) AS lastAt/);
  assert.match(scan, /receiving: !!r\.lastAt/);
  // Comments may DISCUSS the demo rows; the query may not know they exist.
  const code = scan.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.ok(!/Alex Thompson|Unknown LO|Jordan Rivera|Recovered/.test(code), "no row is excluded by name");
  // Active only, and both kinds of recipient.
  assert.match(scan, /lo\.internal_status = 'active'/);
  assert.match(scan, /a\.active = 1/);
  assert.match(scan, /kind: "lo"/);
  assert.match(scan, /kind: "loa"/);
  // The transfers themselves: org-scoped, the CLR is assistant_id, and the
  // destination is the pair the module reads.
  assert.match(scan, /outcome_type='transfer'/);
  assert.match(scan, /clrId: o\.assistant_id == null \? "" : Number\(o\.assistant_id\)/);
  assert.match(scan, /loId: o\.lo_id/);
  assert.match(scan, /loaId: o\.loa_id/);
});

test("the placement scan reads EVERY transfer in the range, excluded CLRs included", () => {
  // Not a style choice. The stat rebuilds each morning's floor by walking the
  // recipients' range totals BACKWARDS through these rows, so a filtered subset
  // makes every loan officer look like they began the range busier than they
  // did. Excluded CLRs never surface anyway: the leaderboard reads the map by
  // the ids it is already showing.
  const scan = placementScan();
  assert.ok(!/exClause/.test(scan), "the excluded-CLR filter must not reach this query");
  assert.match(scan, /roster: countedClrs\.map/, "but only counted CLRs get a row");
});

test("the route applies the investment rule; the module never guesses it", () => {
  const scan = placementScan();
  assert.match(scan, /INVESTMENT_PROPERTY_INPUT_AVAILABLE/, "one switch, honoured at the call site");
  assert.match(scan, /investmentPropertyKeys\(placementRecipients\)/, "resolved from the roster");
  assert.match(scan, /isInvestmentProperty\(o\.conversation_notes\)/, "and from the app's own answer");
  assert.match(scan, /constrainedTo: investmentKeys\.length && isInvestmentProperty/);
  // The module stays clean: the guard test above proves it reads no stored
  // text, and this proves the reading happens somewhere that may.
  assert.ok(!/conversation_notes/.test(src), "server/transfer-priority.ts never sees the column");
});
