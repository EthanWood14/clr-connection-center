import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  receivedCount, percentileNearestRank, flagPromotionCut, fullCreditBandSize, recipientKey,
  recipientCredits, creditIndex, transferCredit, transferDay, snapshotLoads,
  scoreTransferPriority, investmentAssistantKeys, resolveInvestmentRouting,
  FULL_CREDIT_LOS, FULL_CREDIT_SHARE, FLAG_PROMOTION_PERCENTILE,
  SCORE_NON_RECEIVING_RECIPIENTS, MIN_SCORED_TRANSFERS, PRIORITY_WINDOW_DAYS,
  INVESTMENT_PROPERTY_LOAS, INVESTMENT_PROPERTY_INPUT_AVAILABLE,
  INVESTMENT_FOLLOWED_CREDIT, INVESTMENT_IGNORED_CREDIT,
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

const REDOBLE = 1, NATHAN = 2, RYAN_A = 3, SHERVIN = 5, KIM = 13, MATEO_LO = 14;
const COLE_LO = 15, SEAN = 16, DEREK = 17, GARY = 18, KHASHI = 19;
const ALEX_DEMO = 20;
const JUSTIN = 101, JOHN = 102, MATEO_LOA = 104, ERIK = 106, RYAN_LOA = 107;

const lo = (id: number, name: string, transfers: number, extra: Partial<RecipientRow> = {}): RecipientRow =>
  ({ id, name, kind: "lo", transfers, receiving: true, ...extra });

/**
 * An assistant on the roster.
 *
 * No assistant is ever a DESTINATION: her load is not read and the ramp cannot
 * score anybody on her, which is what the route hands over too (transfers 0,
 * receiving false). The row is here for its IDENTITY — the id, the name, and
 * the DESK she sits at — because that is what resolves the three the investment
 * rule names, and the desk is half of what it names.
 *
 * Every assistant in this fixture sits at Christopher Redoble's desk, which is
 * what makes "Chris's Justin, Mateo or John" a statement about these rows. A
 * test below hires another Justin onto somebody else's desk to prove that she
 * is a different person and is not admitted.
 */
const loa = (id: number, name: string, deskId: number = REDOBLE): RecipientRow =>
  ({ id, name, kind: "loa", transfers: 0, receiving: false, deskId });

/** A seeded demo row, or a placeholder: real in the table, real to nobody else. */
const demo = (id: number, name: string): RecipientRow =>
  ({ id, name, kind: "lo", transfers: 0, receiving: false, lastAt: null });

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
  // The seven assistants, every one of them Christopher Redoble's — which is
  // what makes "Chris's Justin, Mateo or John" a statement about these rows.
  // Their own loads are not in this fixture because nothing scores them. Their
  // parent DESK is, because it is half of the rule: an assistant is admitted
  // only where she sits at the one desk all three named rows point at, and that
  // desk is resolved from these rows rather than from any loan officer's name.
  loa(JUSTIN, "Justin"),
  loa(JOHN, "John"),
  loa(103, "Aaron"),
  loa(MATEO_LOA, "Mateo"),
  loa(105, "Cole"),
  loa(ERIK, "Erik"),
  loa(RYAN_LOA, "Ryan"),
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

/**
 * The same row with the ASSISTANT recorded on it as well.
 *
 * A real field the module really reads — but on FLAGGED ROWS ONLY. Every
 * unflagged pairing that uses this asserts EXACT equality rather than a
 * tolerance, because whether somebody used the assistant picker is CRM hygiene
 * and it must not be worth a single point of ordinary placement.
 */
const withLoa = (row: TransferRow, loaId: number | null): TransferRow =>
  ({ ...row, loaId });

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

test("the band is the lightest quarter, capped — which is Ethan's five", () => {
  assert.equal(FULL_CREDIT_SHARE, 0.25);
  assert.equal(fullCreditBandSize(19, FULL_CREDIT_LOS), FULL_CREDIT_LOS);
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
    recipientCredits(unflagged, { fullCreditLos }).filter((c) => c.credit === 1).map((c) => c.name);
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
  assert.equal(loose.filter((c) => c.transfers === 0).length, 8);
});

// ── the ramp ────────────────────────────────────────────────────────────────

test("credit never rises with load — choosing the lighter LO can never score worse", () => {
  // The one invariant this shape exists to guarantee. The old rule jumped a
  // flagged LO to 1.0 and left everybody lighter on the ramp, which meant the
  // stat could pay MORE for the busier desk.
  const mine = [...credits].sort((a, b) => a.transfers - b.transfers);
  for (let i = 1; i < mine.length; i += 1) {
    assert.ok(mine[i].credit <= mine[i - 1].credit,
      `${mine[i].name} (${mine[i].transfers}) beats ${mine[i - 1].name} (${mine[i - 1].transfers})`);
  }
});

test("the ramp falls from the line to the busiest choice, which is exactly 0", () => {
  const ramp = credits.filter((c) => c.band === "ramp")
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
  assert.equal(credits.length, 19, "only the loan officers this rule can judge");
});

// ── one pool, because there is one destination ──────────────────────────────

test("a tie at the edge of the band takes both: equal load, equal credit", () => {
  // Narrow the band to one and Gary Dawson is first by name — but Khashi
  // Tabrizi carries the same zero, and handing one of them 100% and the other
  // 94% for having a later surname would be arbitrary. The line is a LOAD, so a
  // tie cannot be split. (Measured with the needs_transfers flags off, so this
  // is the band edge on its own and not the flag line propping it up.)
  const unflagged = recipients.map(({ needsTransfers, ...r }) => r as RecipientRow);
  const one = recipientCredits(unflagged, { fullCreditLos: 1 });
  const pick = (n: string) => one.filter((c) => c.name === n)[0];
  assert.equal(pick("Gary Dawson").credit, 1);
  assert.equal(pick("Khashi Tabrizi").credit, 1);
  assert.equal(pick("Derek Bullen").credit, 0.9412, "the ramp below them is untouched");
});

test("an assistant is not a recipient at all — the pool is loan officers", () => {
  // Assistants used to be ranked in a pool of their own, so that a row naming
  // only an assistant could still be scored. Nothing is ever scored on an
  // assistant now, so there is no assistant pool and nothing to look one up in.
  assert.equal(credits.filter((c) => /^loa:/.test(c.key)).length, 0);
  const index = creditIndex(credits);
  for (const id of [JUSTIN, JOHN, MATEO_LOA, ERIK, RYAN_LOA]) {
    assert.equal(index.get(recipientKey("loa", id)), undefined, String(id));
  }
  // They are still on the ROSTER, because their identity is what the three
  // names in the investment rule are resolved against.
  assert.equal(recipients.filter((r) => r.kind === "loa").length, 7);
});

// ── the loan officer is the destination ─────────────────────────────────────

test("an assistant can no longer launder a busy loan officer into full credit", () => {
  // Roughly a third of real rows name the LO's assistant as well. The oldest
  // rule took the BEST of the two, so a transfer into the busiest desk in the
  // company scored 100% because of who happened to sit next to him — the
  // headline safeguard bypassed on a third of the data, and the score partly
  // measuring which LOs have their assistant field filled in.
  const index = creditIndex(credits);
  assert.equal(creditOf("Christopher Redoble"), 0);
  assert.equal(transferCredit({ clrId: "x", loId: REDOBLE }, index), 0);
  assert.equal(transferCredit({ clrId: "x", loId: DEREK }, index), 1);
  // And the assistant is not read even when the row carries one anyway.
  assert.equal(transferCredit(withLoa({ clrId: "x", loId: REDOBLE }, ERIK), index), 0);
  assert.equal(transferCredit(withLoa({ clrId: "x", loId: DEREK }, JUSTIN), index), 1);
});

test("an assistant is never the destination, not even alone", () => {
  // A row naming only an assistant used to be scored in the assistant pool. The
  // transfer form cannot produce one — picking an assistant means picking that
  // assistant's loan officer first — and reading it was worth up to a hundred
  // points of CRM hygiene. It now reads as the record with no destination on it
  // that it is, and lands in `unplaced` like any other.
  const index = creditIndex(credits);
  assert.equal(transferCredit(withLoa({ clrId: "x", loId: null }, ERIK), index), null);
  assert.equal(transferCredit(withLoa({ clrId: "x" }, JUSTIN), index), null);
});

test("a transfer with nobody identifiable on it scores nothing — not zero", () => {
  const index = creditIndex(credits);
  assert.equal(transferCredit({ clrId: "x", loId: null }, index), null);
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

// ── the investment routing rule: flat 100, flat 0 ───────────────────────────
//
// Ethan's words, and the whole of the rule: "any investment qualification yes
// should be 100 if transfers to chris LOA justin, mateo, or john. 0 if anything
// else". He has been shown the gaming risk twice and reaffirmed it, so it is
// implemented as given — including the half that stings, which is that a
// flagged transfer with no assistant recorded scores 0 rather than being
// treated as the missing field it would be anywhere else in this file.

/** The three the rule names, as the module resolves them from the roster. */
const THREE = [JUSTIN, JOHN, MATEO_LOA].map((id) => recipientKey("loa", id)).sort();
const keysOf = (rows: RecipientRow[]): string[] =>
  Array.from(investmentAssistantKeys(rows) ?? []).sort();

/** Five transfers to one loan officer, with an assistant recorded or not. */
const five = (clrId: string, loId: number | null, flagged: boolean, loaId: number | null = null): TransferRow[] =>
  [D1, D1, D2, D2, D3].map((d) =>
    ({ clrId, clrName: clrId, loId, at: d, loaId, investmentProperty: flagged }));

test("the three are resolved from the roster by identity, not by matching text", () => {
  // The rule names three ASSISTANTS, so the roster is asked who they are once
  // per scan and what travels on is IDS. Nothing downstream compares a name.
  assert.deepEqual([...INVESTMENT_PROPERTY_LOAS], ["Justin", "John", "Mateo"]);
  assert.deepEqual(keysOf(recipients), THREE);
  // A loan officer's name is never read at all — there is a surname gate
  // elsewhere in this app for LAP eligibility, and this must never become a
  // second copy of it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.ok(!/redoble/i.test(code), "no code path matches a loan officer by name");
});

test("HIGH — a rename moves the rule where the roster has an id, and stops it where it does not", () => {
  // Rename the loan officer they sit with: nothing moves, because his name was
  // never part of the answer — the desk is resolved from the three assistants'
  // OWN rows, as an id.
  const renamedLo = recipients.map((r) =>
    (r.kind === "lo" && r.id === REDOBLE ? { ...r, name: "Christopher Somebodyelse" } : r));
  assert.deepEqual(keysOf(renamedLo), THREE);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, MATEO_LOA), renamedLo)[0].pct, 100);

  // Give an assistant her surname, which is the rename that actually happens:
  // the roster row is the same person, so the same id is admitted and the same
  // five transfers are still worth 100.
  const surnamed = recipients.map((r) =>
    (r.kind === "loa" && r.id === MATEO_LOA ? { ...r, name: "Mateo Reyes" } : r));
  assert.deepEqual(keysOf(surnamed), THREE);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, MATEO_LOA), surnamed)[0].pct, 100);

  // And what it does NOT survive, pinned here rather than promised away. A
  // recorded first name is the only handle the roster offers for the three
  // themselves — nobody has written their ids down anywhere this stat can read
  // — so renaming one past recognition stops the rule. The cost is bounded on
  // purpose: it stops for EVERYBODY, so a roster edit can switch the rule off
  // and can never turn it into a false accusation against the other two.
  const unrecognisable = recipients.map((r) =>
    (r.kind === "loa" && r.id === MATEO_LOA ? { ...r, name: "Teo" } : r));
  assert.equal(investmentAssistantKeys(unrecognisable), null);
  assert.match(resolveInvestmentRouting(unrecognisable).problem ?? "",
    /no active assistant named Mateo/);
  const past = scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), unrecognisable)[0];
  assert.equal(past.breaches, 0, "nobody is accused on the way past");
  assert.equal(past.investmentUnscored, 5, "and the silence is counted, not swallowed");
});

test("HIGH — a name that resolves to NOBODY stops the rule, it does not score everybody 0", () => {
  // Mateo leaves, or is respelled past recognition. Running the rule on the two
  // names that still resolve would read every compliant transfer to the third
  // as a flat zero — the sharpest verdict this file hands out, handed out
  // because of a roster edit. So the rule stops for everybody instead.
  const gone = recipients.filter((r) => !(r.kind === "loa" && r.id === MATEO_LOA));
  assert.equal(investmentAssistantKeys(gone), null);
  assert.equal(investmentAssistantKeys(recipients.filter((r) => r.kind === "lo")), null);
  assert.equal(investmentAssistantKeys([]), null);

  // Cal's five went to Justin and are still compliant work; they are simply not
  // judged by a rule nobody can resolve. They fall back to the placement their
  // record shows, which onto the busiest desk in the building is 0 — and onto
  // the lightest man on the floor is 100. Neither is a breach.
  const onDesk = scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), gone)[0];
  assert.equal(onDesk.investment, 0, "the rule was not applied to anybody");
  assert.equal(onDesk.breaches, 0, "and nobody was accused of anything");
  assert.equal(onDesk.pct, 0);
  assert.equal(onDesk.unrestricted, 5, "scored against the floor, like any ordinary transfer");
  const onStarved = scoreTransferPriority(five("Cal", DEREK, true, null), gone)[0];
  assert.equal(onStarved.pct, 100);
  assert.equal(onStarved.breaches, 0);
});

test("a name TWO people answer to admits both, rather than silently picking one", () => {
  // A second Justin is hired. Choosing between them would be a guess, and a
  // guess here can only fail one of two ways: a wrong 100 costs nobody
  // anything, while a wrong 0 accuses somebody of ignoring a rule they obeyed.
  const OTHER_JUSTIN = 108;
  const twoJustins = [...recipients, loa(OTHER_JUSTIN, "Justin")];
  assert.deepEqual(keysOf(twoJustins), [...THREE, recipientKey("loa", OTHER_JUSTIN)].sort());
  for (const loaId of [JUSTIN, OTHER_JUSTIN]) {
    assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, loaId), twoJustins)[0].pct, 100,
      String(loaId));
  }
  // ...and admitting a fourth id does not admit a fourth PERSON: an assistant
  // the rule does not name is still a breach.
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, ERIK), twoJustins)[0].pct, 0);
});

test("HIGH — \"Chris's\" is enforced: another loan officer's Justin is a different person", () => {
  // Half of Ethan's rule is WHOSE assistants these are, and it is not
  // decoration. Nathan Coutino hires a Justin of his own; she answers to the
  // same first name, and admitting her would quietly widen "Chris's Justin,
  // Mateo or John" into "anybody's Justin".
  const OTHER_DESK_JUSTIN = 109;
  const elsewhere = [...recipients, loa(OTHER_DESK_JUSTIN, "Justin", NATHAN)];
  assert.deepEqual(keysOf(elsewhere), THREE, "she is not one of the three");
  // The desk itself is resolved from the three's OWN rows — the one desk all of
  // them point at — and never by matching a loan officer's name.
  const routing = resolveInvestmentRouting(elsewhere);
  assert.equal(routing.desk, recipientKey("lo", REDOBLE));
  assert.equal(routing.problem, null);
  // So a flagged transfer recording her is 0 by the same clause a blank is.
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, OTHER_DESK_JUSTIN), elsewhere)[0].pct, 0);
  assert.equal(scoreTransferPriority(five("Cal", NATHAN, true, OTHER_DESK_JUSTIN), elsewhere)[0].breaches, 5);
  // ...and Chris's Justin is untouched by hers existing.
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), elsewhere)[0].pct, 100);
});

test("HIGH — the desk is an id off the three's own rows, so the loan officer can be renamed", () => {
  // There is a surname gate elsewhere in this app, for LAP eligibility, and a
  // stat that judges people is the last place that pattern belongs. The desk
  // half of this rule therefore hangs on nobody's spelling.
  assert.equal(resolveInvestmentRouting(recipients).desk, recipientKey("lo", REDOBLE));
  const renamed = recipients.map((r) =>
    (r.kind === "lo" && r.id === REDOBLE ? { ...r, name: "Nobody At All" } : r));
  assert.equal(resolveInvestmentRouting(renamed).desk, recipientKey("lo", REDOBLE));
  assert.deepEqual(keysOf(renamed), THREE);
  // His roster row is not even consulted: the three carry his id themselves.
  assert.deepEqual(keysOf(recipients.filter((r) => !(r.kind === "lo" && r.id === REDOBLE))), THREE);
});

test("HIGH — every way the desk cannot be resolved STOPS the rule and names what failed", () => {
  // A rule that stopped is never silent: the sentence is what the route logs
  // and what the cell says, so "the rule is off" is never a thing somebody has
  // to work out from a column full of zeroes.
  const problemOf = (rows: RecipientRow[]): string => {
    const r = resolveInvestmentRouting(rows);
    assert.equal(r.keys, null, "applied to nobody");
    assert.equal(r.desk, null);
    assert.ok(r.problem, "and it says why");
    return r.problem as string;
  };
  // A name nobody on the roster answers to.
  assert.match(
    problemOf(recipients.filter((r) => !(r.kind === "loa" && r.id === MATEO_LOA))),
    /no active assistant named Mateo/);
  // One of them with no desk recorded at all.
  assert.match(
    problemOf(recipients.map((r) => (r.kind === "loa" && r.id === JOHN ? { ...r, deskId: null } : r))),
    /no loan officer's desk for John/);
  // Three of the right names who share no desk: "Chris's" names no one desk.
  assert.match(
    problemOf(recipients.map((r) => (r.kind === "loa" && r.id === JOHN ? { ...r, deskId: NATHAN } : r))),
    /do not all sit at one loan officer's desk/);
  // A full set at each of two desks — which one the rule means cannot be told.
  assert.match(
    problemOf([...recipients, loa(111, "Justin", NATHAN), loa(112, "John", NATHAN), loa(113, "Mateo", NATHAN)]),
    /sit together at 2 different loan officers' desks/);
});

test("HIGH — a rule that stopped is COUNTED, so a 0% it caused is never printed", () => {
  // The counter the dashboard's dash hangs on. Cal obeyed the rule perfectly:
  // all five went to Justin. With the roster unable to resolve the three, those
  // five are read as ordinary placement onto the busiest desk in the building
  // and come out at 0% — a red cell that is an artefact of a roster edit.
  const gone = recipients.filter((r) => !(r.kind === "loa" && r.id === MATEO_LOA));
  const row = scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), gone)[0];
  assert.equal(row.investmentUnscored, 5, "every flagged transfer the rule did not judge");
  assert.equal(row.investment, 0);
  assert.equal(row.breaches, 0);
  assert.equal(row.pct, 0, "which is why the number must not be shown as it stands");
  // A roster that CAN answer counts nothing unscored.
  assert.equal(
    scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), recipients)[0].investmentUnscored, 0);
});

test("HIGH — investment to Justin, Mateo or John is 100%, however busy that desk is", () => {
  // The point of the rule. Christopher Redoble took 282 of the 687 transfers in
  // the fortnight, so an ordinary transfer onto his desk is worth exactly 0 —
  // the busiest choice there is. An investment property had to reach one of his
  // three assistants, and reaching one is the correct behaviour, so it is worth
  // exactly 100.
  assert.equal(creditOf("Christopher Redoble"), 0);
  for (const [who, loaId] of [["Justin", JUSTIN], ["Mateo", MATEO_LOA], ["John", JOHN]] as const) {
    const row = scoreTransferPriority(five("Cal", REDOBLE, true, loaId), recipients)[0];
    assert.equal(row.pct, 100, who);
    assert.equal(row.mean, 1, `${who} — flat, not a ramp that happens to round to 100`);
    assert.equal(row.investment, 5, `${who} — judged by the rule, not against the floor`);
    assert.equal(row.breaches, 0, who);
    assert.equal(row.scored, 5, who);
    assert.equal(row.unrestricted, 0, `${who} — no pool was consulted at all`);
  }
  assert.equal(INVESTMENT_FOLLOWED_CREDIT, 1);
});

test("HIGH — investment recorded to anybody else is 0%, however starved that desk is", () => {
  // Derek Bullen is the lightest man on the floor and worth a full 1.0 on any
  // ordinary transfer. "0 if anything else" is the rule as it was given, twice,
  // so none of that counts here: a different assistant, a blank, and a
  // different loan officer are the same flat zero.
  assert.equal(creditOf("Derek Bullen"), 1);
  const cases: Array<[string, number | null, number | null]> = [
    ["a different assistant", REDOBLE, ERIK],
    ["no assistant recorded at all", REDOBLE, null],
    ["a different loan officer, and somebody else's assistant", DEREK, RYAN_LOA],
    ["a different loan officer, with nobody recorded", DEREK, null],
    ["nobody recorded anywhere on the row", null, null],
  ];
  for (const [label, loId, loaId] of cases) {
    const row = scoreTransferPriority(five("Cal", loId, true, loaId), recipients)[0];
    assert.equal(row.pct, 0, label);
    assert.equal(row.mean, 0, `${label} — flat, and the worst score there is`);
    assert.equal(row.investment, 5, label);
    assert.equal(row.breaches, 5, label);
    assert.equal(row.scored, 5, `${label} — read, not dropped: a verdict is not a data gap`);
    assert.equal(row.unplaced, 0, label);
  }
  assert.equal(INVESTMENT_IGNORED_CREDIT, 0);

  // ...and it can never outscore a well-placed ordinary transfer, which is why
  // it is 0 rather than the floor mean.
  const mixed = scoreTransferPriority(
    [...five("Cal", DEREK, true), ...five("Ada", DEREK, false)], recipients);
  assert.deepEqual(mixed.map((s) => [s.name, s.pct]), [["Ada", 100], ["Cal", 0]]);
});

test("HIGH — a blank assistant on a flagged row is the ANSWER, not a missing field", () => {
  // The sharp edge of Ethan's rule, and the one place this file departs from
  // its own habit. Everywhere else an unreadable record is valued at the floor
  // mean, because a CRM field nobody wrote is not evidence anybody placed a
  // lead badly. On an investment property the rule asks which of three people
  // took the lead, and a record naming nobody does not say one of them did.
  const blank = scoreTransferPriority(five("Cal", REDOBLE, true, null), recipients)[0];
  assert.equal(blank.pct, 0);
  assert.equal(blank.breaches, 5, "counted, so the cell can say what kind of 0 this is");
  assert.equal(blank.unplaced, 0, "not read as a data gap");

  // The same blank on an UNFLAGGED row is untouched by any of this: it is
  // ordinary placement onto the busiest desk, and it is 0 for that reason
  // instead — with no breach counted against anybody.
  const plain = scoreTransferPriority(five("Ada", REDOBLE, false, null), recipients)[0];
  assert.equal(plain.pct, 0);
  assert.equal(plain.investment, 0);
  assert.equal(plain.breaches, 0);
});

test("a flagged row is judged on the assistant even where the loan officer cannot be read", () => {
  // The loan officer is not a second gate. The record that decides is the
  // assistant, so a flagged row whose loan officer is missing, off the roster,
  // or a seeded placeholder is still answerable: it says whether one of the
  // three got the lead, and that is the whole question.
  for (const loId of [null, 9999, ALEX_DEMO]) {
    const followed = scoreTransferPriority(five("Cal", loId, true, JOHN), recipients)[0];
    assert.equal(followed.pct, 100, String(loId));
    assert.equal(followed.investment, 5, String(loId));
    assert.equal(followed.unplaced, 0, String(loId));
    const breached = scoreTransferPriority(five("Cal", loId, true, null), recipients)[0];
    assert.equal(breached.pct, 0, String(loId));
    assert.equal(breached.breaches, 5, String(loId));
  }
  // The same rows UNFLAGGED are what they always were: unreadable, valued at
  // the floor mean, and never a verdict.
  const unreadable = scoreTransferPriority(
    [...five("Cal", null, false, JOHN), ...five("Ada", DEREK, false)], recipients)
    .filter((s) => s.name === "Cal")[0];
  assert.equal(unreadable.scored, 0);
  assert.equal(unreadable.unplaced, 5);
  assert.equal(unreadable.breaches, 0);
  assert.equal(unreadable.pct, null, "nothing readable at all is a null, not an accusation");
});

test("an UNFLAGGED transfer is scored exactly as it always was", () => {
  // Nothing about ordinary placement changes. The busiest desk in the building
  // is still 0, the lightest man on the floor is still 100, and the middle of
  // the ramp is still the middle of the ramp.
  const worst = scoreTransferPriority(five("Dana", REDOBLE, false), recipients)[0];
  assert.equal(worst.pct, 0);
  assert.equal(worst.investment, 0);
  assert.equal(worst.unrestricted, 5, "compared with the whole floor, and says so");

  const best = scoreTransferPriority(five("Riley", DEREK, false), recipients)[0];
  assert.equal(best.pct, 100);
  assert.equal(best.investment, 0);
  assert.equal(best.unrestricted, 5);

  assert.equal(scoreTransferPriority(five("Sam", NATHAN, false), recipients)[0].pct, 8);
});

test("HIGH — the assistant is worth nothing at all on an unflagged transfer, exactly", () => {
  // loa_id is blank on roughly two thirds of real transfers. Read on the ramp,
  // it would separate two CLRs doing the identical thing by up to a hundred
  // points because one of them used the picker — CRM hygiene printed as a
  // placement judgement, and the reason this column sat held back for a
  // release. It is read on FLAGGED ROWS AND NOWHERE ELSE.
  //
  // EXACT equality, not a tolerance.
  for (const [label, loId] of [["the busiest desk", REDOBLE], ["a starved LO", DEREK]] as const) {
    const named = scoreTransferPriority(five("Ivy", loId, false, MATEO_LOA), recipients)[0];
    const blank = scoreTransferPriority(five("Jo", loId, false, null), recipients)[0];
    const other = scoreTransferPriority(five("Kit", loId, false, ERIK), recipients)[0];
    for (const key of ["mean", "pct", "scored", "investment", "breaches", "unplaced", "unrestricted"] as const) {
      assert.equal(named[key], blank[key], `${label} ${key}`);
      assert.equal(other[key], blank[key], `${label} ${key}`);
    }
  }
  // The two numbers themselves, so this cannot pass by all three being null.
  assert.deepEqual([REDOBLE, DEREK].map((loId) =>
    scoreTransferPriority(five("Ivy", loId, false, MATEO_LOA), recipients)[0].pct), [0, 100]);

  // ...and on a FLAGGED row the same field is the whole verdict, which is the
  // pairing the boundary exists to keep apart.
  assert.deepEqual([MATEO_LOA, ERIK, null].map((loaId) =>
    scoreTransferPriority(five("Ivy", REDOBLE, true, loaId), recipients)[0].mean), [1, 0, 0]);
});

test("a mixed row carries both counters, which is what makes its number readable", () => {
  // Cal made ten readable transfers: five investment properties, three of which
  // reached Justin and two of which recorded nobody, and five ordinary ones
  // onto the lightest man on the floor. 80% — and the 20% he lost is entirely
  // the two breaches, which is a different conversation from 80% earned by
  // middling placement. The counters are what let the cell say so.
  const rows = [
    ...five("Cal", REDOBLE, true, JUSTIN).slice(0, 3),
    ...five("Cal", REDOBLE, true, null).slice(0, 2),
    ...five("Cal", DEREK, false),
  ];
  const cal = scoreTransferPriority(rows, recipients)[0];
  assert.equal(cal.transfers, 10);
  assert.equal(cal.scored, 10);
  assert.equal(cal.investment, 5, "judged on routing");
  assert.equal(cal.breaches, 2, "and two of those went to nobody the rule names");
  assert.equal(cal.pct, 80);
});

test("the loan officer is not a second gate on a flagged row", () => {
  // A row naming Justin at another loan officer's desk cannot come out of the
  // transfer form — it only offers the chosen officer's own assistants — but if
  // one ever did, it still says one of the three got the lead, and it is read
  // that way. Pinned so that "0 if anything else" is not quietly widened into a
  // second condition Ethan did not ask for.
  assert.equal(scoreTransferPriority(five("Ivy", DEREK, true, JUSTIN), recipients)[0].pct, 100);
  assert.equal(scoreTransferPriority(five("Ivy", REDOBLE, true, JUSTIN), recipients)[0].pct, 100);
});

test("the investment rule is switched ON, and the module still guesses nothing", () => {
  // It stayed inert for as long as the FACT did not exist in a form anybody
  // could trust — lead_goal is empty on every transfer in production and
  // lead_type has two rows in total. The qualification question is what
  // switched it on, because the app composes that answer itself.
  assert.equal(INVESTMENT_PROPERTY_INPUT_AVAILABLE, true);

  // The SCORING path never guesses the flag. A transfer that arrives without
  // one is an ordinary placement, whatever might have been written anywhere
  // else about it: switching the rule on moved the decision into the route, it
  // did not move any guessing in here.
  for (const flag of [undefined, null, false] as const) {
    const row = scoreTransferPriority(
      five("Cal", REDOBLE, false, JUSTIN).map((r) => ({ ...r, investmentProperty: flag })), recipients)[0];
    assert.equal(row.investment, 0, String(flag));
    assert.equal(row.breaches, 0, String(flag));
    assert.equal(row.pct, 0, String(flag));
  }
});

test("the rules the flat verdicts rest on are written down next to the arithmetic", () => {
  assert.match(src, /WHAT THE INVESTMENT RULE IS, AND WHAT IT IS NOT/);
  assert.match(src, /THE ASSISTANT IS THE FACT THE RULE TURNS ON/);
  assert.match(src, /WHEN A NAME DOES NOT RESOLVE TO ONE ASSISTANT/);
  // Ethan's own words, so the next reader argues with the rule rather than with
  // whoever implemented it.
  assert.match(src, /0 if anything else/);
  // The two-axis machinery is gone, not left lying about waiting to be revived,
  // and neither is the version that decided the rule from the loan officer.
  assert.doesNotMatch(src, /constrainedTo/);
  assert.doesNotMatch(src, /constraintVerdict/);
  assert.doesNotMatch(src, /investmentPropertyKeys/);
  assert.doesNotMatch(src, /investmentDeskKey/);
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

test("the answer the app composed is what decides the flat verdict", () => {
  // The two halves joined up, on the route's own arithmetic. Cal sends five to
  // Christopher Redoble and records Justin on every one. With an app-composed
  // Yes he is judged by the routing rule and scores 100% for reaching one of
  // the three, even though that desk is the busiest in the building. With a No,
  // or with a sentence merely mentioning the word, the rule never bound him:
  // the same five are an ordinary placement onto the heaviest desk on the floor
  // and score 0%, and the assistant on them is worth nothing. Nothing between
  // those two readings is a guess.
  const rows = (blob: string, loId: number, loaId: number | null): TransferRow[] =>
    [D1, D1, D2, D2, D3].map((d) => ({
      clrId: "Cal", clrName: "Cal", loId, at: d, loaId,
      investmentProperty: isInvestmentProperty(blob),
    }));
  assert.equal(scoreTransferPriority(rows(composed("yes"), REDOBLE, JUSTIN), recipients)[0].pct, 100);
  assert.equal(scoreTransferPriority(rows(composed("no"), REDOBLE, JUSTIN), recipients)[0].pct, 0);
  assert.equal(scoreTransferPriority(rows("not an investment property", REDOBLE, JUSTIN), recipients)[0].pct, 0,
    "a sentence about it is not an answer to it");
  // ...and the other way round, so this is not just the desk being heavy: a Yes
  // that reached nobody the rule names is 0 however starved that loan officer
  // was, and the same rows with a No are 100.
  assert.equal(scoreTransferPriority(rows(composed("yes"), DEREK, null), recipients)[0].pct, 0);
  assert.equal(scoreTransferPriority(rows(composed("no"), DEREK, null), recipients)[0].pct, 100);
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
  // The one place a name is compared is the assistant resolver, and it is the
  // only case-folding in the file.
  assert.equal((code.match(/toLowerCase/g) ?? []).length, 2,
    "only resolveInvestmentRouting folds case");

  // The assistant column IS read now — Ethan's rule names three assistants —
  // but in exactly two places: the field on TransferRow, and the one read
  // inside the flat verdict. Anywhere else it would be scoring CRM hygiene.
  assert.match(code, /loaId\?: number \| string \| null;/, "declared on TransferRow");
  assert.equal((code.match(/t\.loaId/g) ?? []).length, 2,
    "and read on one line only, the flat verdict's own");
  assert.match(code, /hasId\(t\.loaId\) \? recipientKey\("loa", t\.loaId\) : null/);
  const ramp = src.slice(src.indexOf("function destinationKey"), src.indexOf("// ── the routing requirement"));
  assert.ok(!/loaId/.test(ramp), "the ramp scores the loan officer and nothing else");
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

test("HIGH — one CLR's score cannot move on ANOTHER CLR's routing compliance", () => {
  // What fills an unreadable record is the mean of every ORDINARY readable
  // transfer the floor made, and that word is load-bearing. The flat routing
  // verdicts are 0 and 1 with nothing between; folding them in moved Ola's
  // number by tens of points depending on whether somebody else's investment
  // transfers happened to obey the rule that fortnight — work she had no part
  // in and could not have changed.
  const olaIn = (rows: TransferRow[]) =>
    scoreTransferPriority(rows, recipients).filter((s) => s.name === "Ola")[0];
  const alone = olaIn(board);
  const withCompliance = olaIn([...board, ...five("Cal", REDOBLE, true, JUSTIN)]);
  const withBreaches = olaIn([...board, ...five("Cal", REDOBLE, true, ERIK)]);
  for (const other of [withCompliance, withBreaches]) {
    assert.equal(other.unplacedValuedAt, alone.unplacedValuedAt);
    assert.equal(other.mean, alone.mean);
    assert.equal(other.pct, alone.pct);
  }
  // ...and Cal's own two fortnights are nothing like each other, so this is not
  // passing by the extra rows being ignored.
  const calIn = (rows: TransferRow[]) =>
    scoreTransferPriority(rows, recipients).filter((s) => s.name === "Cal")[0];
  assert.equal(calIn([...board, ...five("Cal", REDOBLE, true, JUSTIN)]).pct, 100);
  assert.equal(calIn([...board, ...five("Cal", REDOBLE, true, ERIK)]).pct, 0);
});

test("HIGH — every transfer behind the number is either scored or unplaced", () => {
  // The invariant the cell's breakdown rests on. If a transfer could be
  // neither, the tooltip would be presenting arithmetic that cannot reconcile
  // with the percentage above it, whatever it chose to name.
  const rows = [
    ...board,
    ...five("Cal", REDOBLE, true, JUSTIN).slice(0, 3),
    ...five("Cal", DEREK, true, null).slice(0, 2),
    ...five("Cal", null, false, null),
  ];
  const all = scoreTransferPriority(rows, recipients, { roster: [{ clrId: "Nia", name: "Nia" }] });
  assert.ok(all.length >= 6);
  for (const s of all) {
    assert.equal(s.transfers, s.scored + s.unplaced, `${s.name} — nothing falls between the two`);
    assert.ok(s.investment <= s.scored, s.name);
    assert.ok(s.breaches <= s.investment, s.name);
    assert.ok(s.investmentUnscored <= s.transfers, s.name);
  }
  // And the mean really is taken over both halves, not over the readable one.
  const cal = all.filter((s) => s.name === "Cal")[0];
  assert.equal(cal.transfers, 10);
  assert.equal(cal.scored, 5);
  assert.equal(cal.unplaced, 5);
  assert.equal(cal.pct, Math.round(((3 + 0 * 2) + 5 * cal.unplacedValuedAt!) / 10 * 100));
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
  assert.deepEqual(recipientCredits(recipients, { poolKeys: [] }).length, 19, "an empty pool is no pool");
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
  assert.match(src, /A FORCED ROUTE IS NOT A PLACEMENT DECISION/);
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
  // Every reason the column withholds a number lives in ONE helper, so a third
  // reason cannot be added to the cell and forgotten on the row. The rules it
  // holds are pinned here: too thin a sample, and a routing rule that could not
  // run at all.
  assert.match(routes, /placementScore: placementPct\(placementByUser\.get\(u\.id\)\)/);
  assert.match(routes, /!cell \|\| !cell\.ranked \|\| cell\.investmentUnscored > 0 \? null : cell\.pct/);
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
  // The loan officers are counted from it and still end at the range. The
  // assistants are not counted at all any more: nothing scores an assistant, so
  // there is no load of theirs to reconstruct.
  assert.equal(scan.split(").all(placementFrom, endDate").length - 1, 1,
    "the scored pool reaches back before the range");
  // ...and the transfers being judged are NOT widened with them.
  assert.ok(!/\.all\(placementOrg, placementFrom/.test(scan), "the run-up is never scored");
  // The reason is written where somebody would otherwise 'tidy' it away.
  assert.match(scan, /THE RECIPIENTS ARE COUNTED OVER A RUN-UP AS WELL AS THE RANGE/);
});


test("the module says out loud that the same window on both sides rebuilds zeroes", () => {
  assert.match(src, /THAT SUBTRACTION IS ONLY HONEST IF THE COUNT REACHES FURTHER BACK THAN THE\r?\n \* ROWS\./);
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

test("the placement column is SHOWN, and its tooltip is the stat that exists", () => {
  // It was held back for a release, and the reason was real: the compliance
  // rule hung on loa_id, which could protect nobody in production — an
  // assistant belongs to one loan officer and the form only offers that
  // officer's own — and cost up to 100 points for filling a field in. The rule
  // now hangs on the loan officer and pays 100 for following it, so the column
  // is live.
  const cols = mgr.slice(mgr.indexOf("const cols"), mgr.indexOf("];", mgr.indexOf("const cols")));
  // Comments stripped first, so a commented-out entry could never pass for a
  // rendered one.
  const live = cols
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith(String.fromCharCode(47, 47)))
    .join(String.fromCharCode(10));
  assert.match(live, /key: "placement"/, "the Placed column is rendered");
  assert.match(live, /label: "Placed"/);
  assert.match(live, /get: r => r\.placementScore \?\? null/);
  assert.match(live, /cellTitle: placementNote/, "and a dash still says why it is a dash");
  // The write-up column it sits beside is untouched.
  assert.match(cols, /key: "writeUp"/);
  // Nothing is left claiming the hold is still in force.
  assert.doesNotMatch(mgr, /HELD BACK, deliberately/);
});

test("the tooltip describes the stat the server actually computes", () => {
  // A claim the route did not back has been caught on this column once already,
  // so each half of what the server does is pinned here: the morning-before
  // ramp, the flat investment rule, and the WHOLE floor as the comparison for
  // everything else — never a licensing pool, which is never supplied.
  const at = mgr.indexOf('key: "placement"');
  assert.ok(at > 0, "the column exists");
  const tip = /title: "([^"]*)"/.exec(mgr.slice(at));
  assert.ok(tip, "the column carries a tooltip");
  const text = tip![1];
  assert.match(text, /morning it was made/, "judged on the floor from BEFORE the transfer");
  assert.match(text, /Investment\/2nd Home/, "the flat rule is named");
  // The three the rule is decided on, by name, because a manager cannot check a
  // verdict against a rule the column will not state.
  assert.match(text, /Justin, Mateo or John/);
  assert.match(text, /100% when the transfer records one of those three and 0% for anything else/);
  // ...including the half that stings, which is the half most likely to be
  // quietly dropped from a tooltip.
  assert.match(text, /no assistant recorded at all, scores zero/);
  assert.match(text, /WHOLE floor/);
  assert.doesNotMatch(text, /could have chosen/,
    "no promise of an eligible set the route never supplies");
  // The long-range caveat that the route's own comment says lives here.
  assert.match(text, /fortnight PLUS the range/);
  assert.match(routes, /tooltip spells the difference out/);
});

test("HIGH — the routing counters reach the cell, so a 0% can say which kind it is", () => {
  // A 0% earned by breaching the investment routing rule is a far sharper
  // accusation than a 0% earned by feeding a busy desk, and a manager reading
  // the cell could not tell them apart: the module counted both and the route
  // dropped them on the floor. They now travel with the number they explain.
  const scan = placementScan();
  assert.match(routes, /investment: number; breaches: number;/, "on the cell the column reads");
  assert.match(scan, /investment: s\.investment, breaches: s\.breaches,/, "filled from the module");
  assert.match(routes, /placementInvestment: placementByUser\.get\(u\.id\)\?\.investment \?\? 0/);
  assert.match(routes, /placementBreaches: placementByUser\.get\(u\.id\)\?\.breaches \?\? 0/);
  // ...and the cell reads them and says what they mean, in the tooltip.
  assert.match(mgr, /const investment = Number\(r\.placementInvestment \?\? 0\);/);
  assert.match(mgr, /Number\(r\.placementBreaches \?\? 0\)/);
  assert.match(mgr, /recorded as Investment\/2nd Home and judged on routing alone/);
  assert.match(mgr, /recorded Justin, Mateo or John and scored 100%/);
  assert.match(mgr, /did not and scored 0%/);
  // The note used to answer nothing at all whenever there WAS a number, which
  // is exactly the case a sharp 0% falls into.
  assert.doesNotMatch(mgr, /if \(r\.placementScore != null\) return undefined;/);
});

test("the server computes the placement score the column reads", () => {
  assert.match(routes, /placementScore/);
  assert.match(routes, /placementByUser/);
  assert.match(routes, /placementScored: placementByUser\.get\(u\.id\)\?\.scored \?\? 0/);
  assert.match(routes, /placementMinScored: MIN_SCORED_TRANSFERS/);
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
  // Active only, and both kinds of roster row.
  assert.match(scan, /lo\.internal_status = 'active'/);
  assert.match(scan, /a\.active = 1/);
  assert.match(scan, /kind: "lo"/);
  assert.match(scan, /kind: "loa"/);
  // An assistant is not a destination the ramp can score, so its query counts
  // nothing: the row is on the roster for its identity, which is what resolves
  // the three the investment rule names.
  const loas = scan.slice(scan.indexOf("const placementLoas"), scan.indexOf("const placementRecipients"));
  assert.match(loas, /SELECT a\.id AS id, a\.full_name AS name, a\.lo_id AS deskId/);
  assert.match(loas, /receiving: false/);
  assert.ok(!/lead_outcomes/.test(loas), "nothing counts transfers to an assistant");
  // Her DESK does travel, and it has to. "CHRIS'S Justin, Mateo or John" is half
  // the rule; another loan officer's Justin is a different person, and a.lo_id
  // is the only way to tell the two apart without matching an officer's name.
  // Leave it behind and resolveInvestmentRouting can never answer, so the rule
  // stops for the whole floor -- which is what it did while this was missing.
  assert.match(loas, /deskId: r\.deskId == null \? null : Number\(r\.deskId\)/);
  assert.ok(!/lo\.full_name/.test(loas), "and it is the id, never the loan officer's name");
  // The transfers themselves: org-scoped, the CLR is assistant_id, the
  // destination of a PLACEMENT is the loan officer and only the loan officer...
  assert.match(scan, /outcome_type='transfer'/);
  assert.match(scan, /clrId: o\.assistant_id == null \? "" : Number\(o\.assistant_id\)/);
  assert.match(scan, /loId: o\.lo_id/);
  // ...and loa_id comes down with them, because Ethan's rule names three
  // assistants. Which rows may read it is the module's rule to state, not this
  // query's to pre-decide.
  assert.match(scan, /SELECT assistant_id, lo_id, loa_id, date, conversation_notes/);
  assert.match(scan, /loaId: o\.loa_id == null \? null : Number\(o\.loa_id\)/);
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
  assert.match(scan, /resolveInvestmentRouting\(placementRecipients\)/, "the three come from the roster");
  assert.match(scan, /isInvestmentProperty\(o\.conversation_notes\)/, "the flag from the app's own answer");
  // The FLAG travels whatever the roster managed to resolve. Gating it on the
  // routing having resolved was the same thing as hiding the failure: the
  // module then saw ordinary transfers, and a fortnight of perfect compliance
  // onto the busiest desk in the building came out as a confident red 0%.
  // Passed through, those rows are counted instead (`investmentUnscored`) and
  // the column shows a dash. Only the module's own switch may unflag a row.
  assert.match(scan, /investmentProperty: INVESTMENT_PROPERTY_INPUT_AVAILABLE && isInvestmentProperty/);
  assert.ok(!/investmentProperty: investment\w* !== null/.test(scan),
    "a roster that could not answer must not silently unflag the rows it failed on");
  // A compliance rule that quietly stops running is exactly the kind of thing
  // nobody notices, so it is said out loud -- and the sentence that travels is
  // the module's own, which names what failed and which assistant it failed on.
  assert.match(scan, /console\.warn\(\s*"\[manager-dashboard\] investment routing not scored: " \+/);
  assert.match(scan, /investmentRouting\.problem \?\? "the roster resolves none of the named assistants"/);
  // The module stays clean: the guard test above proves it reads no stored
  // text, and this proves the reading happens somewhere that may.
  assert.ok(!/conversation_notes/.test(src), "server/transfer-priority.ts never sees the column");
});

test("the route's own doc block states the rename limit rather than promising past it", () => {
  // The module says it: a first name is the only handle the roster offers for
  // the three, and the desk is the half that is id-based. The route used to say
  // the opposite of the first half — "renaming one of them moves the rule with
  // her" — which is true of the loan officer and false of the three, and a
  // comment that promises a safety the code does not have is worse than none.
  assert.match(src, /THAT RESOLUTION IS NOT RENAME-SAFE/);
  assert.match(src, /The DESK half of the rule IS id-based, and does survive a rename/);
  const scan = placementScan();
  assert.ok(!/renaming one of them moves the rule with her/.test(scan),
    "the route must not promise rename-safety the roster cannot give");
  assert.match(scan, /A recorded first name is the only handle the roster offers/);
  assert.match(scan, /he can be renamed freely/);
  // ...and the same block used to call the stop "one case only", which stopped
  // being true the moment the desk became part of the answer.
  assert.ok(!/which is one case only/.test(scan));
  assert.match(scan, /there are four ways in/);
});

test("HIGH — the cell's breakdown is taken over EVERY transfer behind the number", () => {
  // The share's denominator is the scored transfers PLUS the unreadable ones
  // counted at the floor's average — see `unplacedValuedAt`. A breakdown over
  // the scored half alone was arithmetic a manager could not reconcile with the
  // percentage sitting above it: Ola's cell said "1 judged on ordinary
  // placement" over a 68% that is the mean of five.
  assert.match(routes, /placementUnplaced: placementByUser\.get\(u\.id\)\?\.unplaced \?\? 0/);
  assert.match(routes, /placementUnplacedValuedAt: placementByUser\.get\(u\.id\)\?\.unplacedValuedAt \?\? null/);
  assert.match(mgr, /const unplaced = Math\.max\(0, Number\(r\.placementUnplaced \?\? 0\)\);/);
  assert.match(mgr, /const behind = scored \+ filled;/);
  assert.match(mgr, /This share is the mean of \$\{behind\}/);
  // All three parts are named, and they are the whole of it: routing, ordinary
  // placement, and the unreadable records counted at the floor's own average.
  assert.match(mgr, /judged on routing alone/);
  assert.match(mgr, /judged on ordinary placement/);
  assert.match(mgr, /counted at the floor's own/);
  // The old sum, which counted the readable half and called it the total.
  assert.doesNotMatch(mgr, /of \$\{scored\} scored/);
  // An unreadable record the server left OUT of the mean — no ordinary
  // placement on the floor to value it from — is said to be out, rather than
  // folded into a sum that then does not add up.
  assert.match(mgr, /const filled = valuedAt == null \? 0 : unplaced;/);
  assert.match(mgr, /left out of the share/);
});

test("HIGH — a routing rule that could not run shows a dash and the reason, never a red 0%", () => {
  // The rule stopping is a fact about the ROSTER, not about anybody's work.
  // Those transfers were required to reach one desk, so ordinary placement
  // scores perfect compliance at 0% — the sharpest verdict this column hands
  // out, arrived at because somebody was renamed.
  assert.match(routes, /placementUnscored: placementByUser\.get\(u\.id\)\?\.investmentUnscored \?\? 0/);
  // The number is withheld, in the one helper that holds every such rule.
  assert.match(routes, /const placementPct = \(cell\?: PlacementCell\): number \| null =>/);
  assert.match(routes, /cell\.investmentUnscored > 0 \? null : cell\.pct/);
  // ...and the dash says WHICH dash it is, ahead of every other reason, because
  // each of those would explain a dash this one is not.
  assert.match(mgr, /if \(unscored > 0\) \{/);
  assert.match(mgr, /The investment routing rule is not running/);
  assert.match(mgr, /roster cannot resolve Chris's/);
  assert.match(mgr, /no share is shown until the roster answers/);
  // The warn names what failed and which assistant: the module's own sentence,
  // not a generic one this route made up.
  const scan = placementScan();
  assert.match(scan, /investmentRouting\.problem/);
});

test("HIGH — a routing 0% and a placement 0% are told apart by the CELL, not by hovering", () => {
  // Two identical red boxes reading 0% are not the same accusation — one is
  // "eleven investment leads went to the wrong people", the other is "your
  // placement was poor" — and a colour-graded table may not leave the
  // difference to whether somebody happened to hover.
  assert.match(mgr, /const placementCellNote = \(r: any\): string \| null => \{/);
  assert.match(mgr, /return breaches > 0 \? `\$\{breaches\} mis-routed` : `\$\{investment\} on routing`;/);
  assert.match(mgr, /if \(Number\(r\.placementUnscored \?\? 0\) > 0\) return "routing rule off";/);
  // An ordinary number says nothing extra, so an unmarked share is placement
  // all the way down and the marker means what it says.
  assert.match(mgr, /if \(investment <= 0\) return null;/);
  // ...and it is RENDERED, not merely computed.
  assert.match(mgr, /cellNote\?: \(r: any\) => string \| null;/);
  assert.match(mgr, /cellNote: placementCellNote/);
  assert.match(mgr, /const note = c\.cellNote\?\.\(r\);/);
  // The column's own tooltip no longer sends the reader to a hover for the one
  // thing the cell now says by itself.
  assert.doesNotMatch(mgr, /Hover a cell to see how much of its number came from that routing rule/);
});
