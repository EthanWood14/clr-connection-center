import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  receivedCount, percentileNearestRank, flagPromotionCut, fullCreditBandSize, recipientKey,
  recipientCredits, creditIndex, transferCredit, transferDay, snapshotLoads,
  scoreTransferPriority, investmentAssistantKeys, resolveInvestmentRouting,
  prioritisedDeskIds, deskAssistantCredits,
  FULL_CREDIT_LOS, FULL_CREDIT_SHARE, FLAG_PROMOTION_PERCENTILE,
  SCORE_NON_RECEIVING_RECIPIENTS, MIN_SCORED_TRANSFERS, PRIORITY_WINDOW_DAYS,
  INVESTMENT_PROPERTY_LOAS, INVESTMENT_PROPERTY_INPUT_AVAILABLE,
  INVESTMENT_FOLLOWED_CREDIT, INVESTMENT_IGNORED_CREDIT, PRIORITY_FLOOR_CREDIT,
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

const REDOBLE = 1, NATHAN = 2, RYAN_A = 3, SHERVIN = 5, MARK = 7, KIM = 13, MATEO_LO = 14;
const COLE_LO = 15, SEAN = 16, DEREK = 17, GARY = 18, KHASHI = 19;
const ALEX_DEMO = 20;
const JONJAIRO = 100, JUSTIN = 101, JOHN = 102, AARON = 103, MATEO_LOA = 104;
const COLE_LOA = 105, ERIK = 106, RYAN_LOA = 107;

const lo = (id: number, name: string, transfers: number, extra: Partial<RecipientRow> = {}): RecipientRow =>
  ({ id, name, kind: "lo", transfers, receiving: true, ...extra });

/**
 * An assistant on the roster.
 *
 * She is never a destination on the ORDINARY ramp — `receiving` is false and
 * `recipientCredits` filters her out — but she is the destination that gets
 * RANKED on a prioritised desk, so her own load travels with her, exactly as
 * the route hands it over. The rest of the row is IDENTITY — the id, the name,
 * and the DESK she sits at — which is what resolves the three the investment
 * rule names, and the desk is half of what it names.
 *
 * Every assistant in this fixture sits at Christopher Redoble's desk, which is
 * what makes "Chris's Justin, Mateo or John" a statement about these rows. A
 * test below hires another Justin onto somebody else's desk to prove that she
 * is a different person and is not admitted.
 */
const loa = (id: number, name: string, deskId: number = REDOBLE, transfers = 0): RecipientRow =>
  ({ id, name, kind: "loa", transfers, receiving: false, deskId });

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
  // The eight assistants, every one of them Christopher Redoble's — which is
  // what makes "Chris's Justin, Mateo or John" a statement about these rows.
  // Their parent DESK is half of that rule: an assistant is admitted only where
  // she sits at the one desk all three named rows point at, and that desk is
  // resolved from these rows rather than from any loan officer's name.
  //
  // Their OWN loads are the fortnight's, off prod, because his desk is the one
  // the floor is told to feed and the assistant is therefore the destination
  // that gets ranked on it. These eight numbers are the whole of the 60-100
  // ladder every transfer onto that desk is scored against.
  loa(JONJAIRO, "Jonjairo", REDOBLE, 0),
  loa(ERIK, "Erik", REDOBLE, 26),
  loa(RYAN_LOA, "Ryan", REDOBLE, 27),
  loa(COLE_LOA, "Cole", REDOBLE, 28),
  loa(MATEO_LOA, "Mateo", REDOBLE, 35),
  loa(AARON, "Aaron", REDOBLE, 39),
  loa(JUSTIN, "Justin", REDOBLE, 51),
  loa(JOHN, "John", REDOBLE, 54),
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

/** The module reports its mean to 4dp, so arithmetic checked against one rounds too. */
const round4 = (n: number) => Math.round(n * 10000) / 10000;

const D1 = "2026-08-24", D2 = "2026-08-25", D3 = "2026-08-26";

/** One transfer, from a CLR to a loan officer, on a day. */
const t = (clrId: string, loId: number | null, at: string | null = D1): TransferRow =>
  ({ clrId, clrName: clrId, loId, at });

/**
 * The same row with the ASSISTANT recorded on it as well.
 *
 * A real field the module really reads — but only where it answers something:
 * on a FLAGGED row it is the routing gate, and on a PRIORITISED DESK it is the
 * rung. Off both, every pairing that uses this asserts EXACT equality rather
 * than a tolerance, because whether somebody used the assistant picker is CRM
 * hygiene and it must not be worth a single point of ordinary placement.
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

test("an assistant is not on the ORDINARY ramp, however heavy her own load", () => {
  // The ordinary pool is loan officers and nothing else. An assistant carries a
  // real load now — the prioritised desk ranks her on it — but that load lives
  // in its own ladder and never enters the placement ramp: a transfer whose
  // only destination is an assistant still cannot be read.
  assert.equal(credits.filter((c) => /^loa:/.test(c.key)).length, 0);
  const index = creditIndex(credits);
  for (const id of [JONJAIRO, JUSTIN, JOHN, AARON, MATEO_LOA, COLE_LOA, ERIK, RYAN_LOA]) {
    assert.equal(index.get(recipientKey("loa", id)), undefined, String(id));
  }
  // John carries 54 — heavier than every loan officer but Christopher Redoble
  // — and it moves nothing at all about the loan-officer ramp.
  assert.equal(credits.length, 19);
  assert.equal(creditOf("Nathan Coutino"), 0.0833);
  // They are still on the ROSTER: their identity is what the three names in the
  // investment rule resolve against, and their load is the desk ladder itself.
  assert.equal(recipients.filter((r) => r.kind === "loa").length, 8);
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

// ── the prioritised desk, and the floor under it ────────────────────────────
//
// Ethan asked for a ladder on a prioritised desk, in these words:
//
//   "for chris's or anyone with LOA's, the LOA that gets it should be
//   prioritized like an LO (one with the fewest transfers is at 100, one with
//   the most at 0) unless the LO is marked as prioritized, then everyone gets
//   60 no matter what (the floor starts at 60) or if its an
//   investment/commercial property"
//
// So a PRIORITISED DESK — a loan officer flagged needs_transfers who also has
// assistants, which on prod is Christopher Redoble and nobody else — is scored
// on the ASSISTANT who took the lead, ranked by her own load over 60-100
// instead of 0-100. The floor is the whole point: the floor was TOLD to feed
// that desk, so a transfer onto it can never be marked down as a bad placement.
// A blank assistant is not a breach and not a zero there; it is the floor.
//
// An investment or second home is NOT on that ladder. It was required to reach
// one of three named assistants, so the three names gate it — 0 for anything
// else — and among those three it is ranked over their loads alone. The desk
// the row names does not enter into it; see the gate section below.
//
// The three names are still resolved from the roster, by id and by desk, and
// the resolver is still what the route logs. What the tests below pin is that
// the resolver answers exactly as it did, and that the desk ladder is what
// decides an ORDINARY transfer onto a prioritised desk.

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

// ── the ladder: an assistant ranked like a loan officer, over 60-100 ─────────

test("the ladder's rungs are the desk's own loads, fewest at 100 and busiest at 60", () => {
  // Ethan's ladder, rung by rung, on the eight loads Christopher Redoble's desk
  // actually carried in the fortnight. Jonjairo has taken nothing and is worth
  // everything; John has taken 54 and is worth the floor — never less.
  assert.equal(PRIORITY_FLOOR_CREDIT, 0.6);
  assert.deepEqual([...prioritisedDeskIds(recipients)], [recipientKey("lo", REDOBLE)]);
  const ladder = deskAssistantCredits(recipients, recipientKey("lo", REDOBLE));
  assert.deepEqual(
    [[JONJAIRO, 0], [ERIK, 26], [RYAN_LOA, 27], [COLE_LOA, 28],
     [MATEO_LOA, 35], [AARON, 39], [JUSTIN, 51], [JOHN, 54]]
      .map(([id]) => Math.round((ladder.get(recipientKey("loa", id)) as number) * 100)),
    [100, 94, 89, 83, 77, 71, 66, 60],
  );
  // ...and the same rungs read end to end through the stat itself, because a
  // ladder nobody is scored on is decoration.
  const pctTo = (loaId: number | null, flagged = false) =>
    scoreTransferPriority(five("Cal", REDOBLE, flagged, loaId), recipients)[0].pct;
  assert.deepEqual(
    [JONJAIRO, ERIK, RYAN_LOA, COLE_LOA, MATEO_LOA, AARON, JUSTIN, JOHN].map((id) => pctTo(id)),
    [100, 94, 89, 83, 77, 71, 66, 60],
  );
  // The flag takes the transfer OFF this ladder entirely. An investment is
  // required to reach one of three named assistants, so it is ranked over those
  // three alone: Jonjairo is the lightest desk in the building and worth 100 on
  // the ordinary ladder, and nothing at all on this one, because he is not one
  // of the three. Mateo is the lightest OF THE THREE and takes the full marks
  // his 77th rung never gave him.
  assert.deepEqual([JONJAIRO, MATEO_LOA, JOHN].map((id) => pctTo(id, true)), [0, 100, 60]);
});

// ── the gate: an investment is ranked over the three named assistants ALONE ──
//
// Ethan was shown that "must go to Justin, Mateo or John" had stopped being
// enforced: the desk ladder scored whichever assistant happened to take it, so
// an investment routed to Erik — a man the rule does not name — came out at
// 94%. He chose the gate. The three names decide whether the transfer counts at
// all, and among those three the ladder ranks by load, so following the rule
// well and following it barely are still different numbers.

test("HIGH — the three-name ladder is 100, 80 and 60: the lightest OF THE THREE takes full marks", () => {
  // The rungs, and the loads they come from. Mateo carries 35, Justin 51 and
  // John 54, and the ladder is built over those three and nobody else — so the
  // lightest of them is worth everything rather than the 77 he is worth as the
  // fourth-lightest of eight.
  const pct = (loaId: number | null, flagged = true) =>
    scoreTransferPriority(five("Cal", REDOBLE, flagged, loaId), recipients)[0];
  assert.deepEqual([MATEO_LOA, JUSTIN, JOHN].map((id) => pct(id).pct), [100, 80, 60]);
  assert.deepEqual([MATEO_LOA, JUSTIN, JOHN].map((id) => pct(id).mean), [1, 0.8, 0.6]);
  assert.equal(pct(MATEO_LOA).mean, INVESTMENT_FOLLOWED_CREDIT, "obeying it well is worth the top");
  assert.equal(pct(JOHN).mean, PRIORITY_FLOOR_CREDIT, "and obeying it at all is worth the floor");
  // The same three read on the DESK ladder are a different set of numbers, which
  // is the whole of what changed: eight rungs answer "who on this desk needed
  // it most", three answer "which of the three took it".
  assert.deepEqual([MATEO_LOA, JUSTIN, JOHN].map((id) => pct(id, false).pct), [77, 66, 60]);
  // Load still orders them, so the ladder is a ladder and not three flat names.
  const loadOf = (id: number) => receivedCount(recipients.filter((r) => r.kind === "loa" && r.id === id)[0]);
  assert.deepEqual([MATEO_LOA, JUSTIN, JOHN].map(loadOf), [35, 51, 54]);
  for (const id of [MATEO_LOA, JUSTIN, JOHN]) {
    const row = pct(id);
    assert.equal(row.investment, 5, String(id));
    assert.equal(row.breaches, 0, `${id} — the rule was followed`);
    assert.equal(row.scored, 5, String(id));
    assert.equal(row.priorityDeskScored, 0, `${id} — judged by the gate, not by the desk`);
    assert.equal(row.unrestricted, 0, `${id} — and no pool was consulted at all`);
  }
});

test("HIGH — a lightly loaded assistant OUTSIDE the three scores 0, not her own high rung", () => {
  // The bug this rework exists for, pinned by name. Every one of these sits on
  // Christopher Redoble's desk and every one of them is worth more than John on
  // the desk ladder — Jonjairo has taken nothing at all and is worth 100 there
  // — and on an investment every one of them is worth nothing, because the rule
  // does not name them.
  const outside = [JONJAIRO, ERIK, RYAN_LOA, COLE_LOA, AARON];
  assert.deepEqual(outside.map((id) =>
    scoreTransferPriority(five("Cal", REDOBLE, false, id), recipients)[0].pct), [100, 94, 89, 83, 71]);
  for (const id of outside) {
    const row = scoreTransferPriority(five("Cal", REDOBLE, true, id), recipients)[0];
    assert.equal(row.pct, 0, String(id));
    assert.equal(row.breaches, 5, `${id} — five investments that missed the three`);
    assert.equal(row.investment, 5, String(id));
  }
  // ...so on an investment the lightest desk in the building loses outright to
  // the busiest of the three, which is the ordering the gate exists to impose.
  assert.ok(scoreTransferPriority(five("Cal", REDOBLE, true, JONJAIRO), recipients)[0].mean!
    < scoreTransferPriority(five("Cal", REDOBLE, true, JOHN), recipients)[0].mean!);
});

test("HIGH — `breaches` counts investments that missed the three, and nothing else", () => {
  // The counter that makes a 0% readable. "0%, and eleven of your twelve
  // investment leads went to the wrong people" and "0%, you fed the busiest
  // desk in the building" are very different accusations.
  const breachesOf = (rows: TransferRow[], roster: RecipientRow[] = recipients) =>
    scoreTransferPriority(rows, roster)[0].breaches;
  // Ordinary placement never breaches anything, however bad it is.
  assert.equal(breachesOf(five("Cal", NATHAN, false)), 0, "the worst ordinary placement there is");
  assert.equal(breachesOf(five("Cal", REDOBLE, false, null)), 0, "a blank on a prioritised desk");
  assert.equal(breachesOf(five("Cal", REDOBLE, false, ERIK)), 0, "an assistant the rule does not name");
  assert.equal(breachesOf(five("Cal", null, false, null)), 0, "a record nothing can read");
  // An investment that reached one of the three never breaches either.
  for (const id of [MATEO_LOA, JUSTIN, JOHN]) assert.equal(breachesOf(five("Cal", REDOBLE, true, id)), 0);
  // Only the misses count, one per transfer.
  assert.equal(breachesOf(five("Cal", REDOBLE, true, ERIK)), 5);
  assert.equal(breachesOf(five("Cal", REDOBLE, true, ERIK).slice(0, 2)), 2);
  // A fortnight of both counts the misses alone, and never more than the
  // investments it saw.
  const mixed = scoreTransferPriority([
    ...five("Cal", REDOBLE, true, MATEO_LOA).slice(0, 2),
    ...five("Cal", REDOBLE, true, ERIK).slice(0, 3),
    ...five("Cal", NATHAN, false),
    ...five("Cal", null, false).slice(0, 1),
  ], recipients)[0];
  assert.equal(mixed.transfers, 11);
  assert.equal(mixed.investment, 5);
  assert.equal(mixed.breaches, 3);
  assert.ok(mixed.breaches <= mixed.investment);
  // And a rule that could not run accuses nobody of anything.
  const gone = recipients.filter((r) => !(r.kind === "loa" && r.id === MATEO_LOA));
  assert.equal(breachesOf(five("Cal", REDOBLE, true, ERIK), gone), 0);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, ERIK), gone)[0].investmentUnscored, 5);
});

test("HIGH — the floor is never breached by an ORDINARY transfer to a prioritised desk", () => {
  // "the floor starts at 60". Every way an ordinary transfer can reach that
  // desk — the busiest assistant on it, an assistant who sits somewhere else,
  // one who is not on the roster at all, and no assistant recorded — and every
  // one of them is at or above 60. Nothing about a placement onto a prioritised
  // desk can score like a bad one, because the CLR did as the floor told them.
  const OFF_ROSTER = 999;
  const elsewhere = [...recipients, loa(140, "Wanda", NATHAN, 2)];
  const cases: Array<[string, number | null, RecipientRow[]]> = [
    ["the busiest assistant on the desk", JOHN, recipients],
    ["no assistant recorded at all", null, recipients],
    ["an assistant off the roster entirely", OFF_ROSTER, recipients],
    ["another loan officer's assistant", 140, elsewhere],
  ];
  for (const [label, loaId, roster] of cases) {
    const row = scoreTransferPriority(five("Cal", REDOBLE, false, loaId), roster)[0];
    assert.ok(row.mean! >= PRIORITY_FLOOR_CREDIT, `${label} — ${row.mean}`);
    assert.equal(row.pct, 60, label);
    assert.equal(row.priorityDeskScored, 5, label);
    assert.equal(row.breaches, 0, label);
  }

  // An INVESTMENT is not on that floor at all, and the floor was never a
  // promise about it: it is a promise about placement, and an investment
  // carried no placement decision. It is gated on the three names instead, so
  // three of the same four records are a flat 0 and a breach — and the fourth
  // is 60 because John is one of the three and the busiest of them, not
  // because any floor caught it.
  const gated: Array<[string, number | null, RecipientRow[], number, number]> = [
    ["the busiest of the three", JOHN, recipients, 60, 0],
    ["no assistant recorded at all", null, recipients, 0, 5],
    ["an assistant off the roster entirely", OFF_ROSTER, recipients, 0, 5],
    ["another loan officer's assistant", 140, elsewhere, 0, 5],
  ];
  for (const [label, loaId, roster, pct, breaches] of gated) {
    const row = scoreTransferPriority(five("Cal", REDOBLE, true, loaId), roster)[0];
    assert.equal(row.pct, pct, label);
    assert.equal(row.breaches, breaches, label);
    assert.equal(row.investment, 5, label);
    assert.equal(row.priorityDeskScored, 0, `${label} — judged on the gate, not on the desk`);
  }

  // ...and the busiest desk in the building is still worth exactly 0 on the
  // ORDINARY ramp, which is the number the floor exists to keep off this desk.
  assert.equal(creditOf("Christopher Redoble"), 0);
});

test("HIGH — a blank assistant is 0% on an investment and 60% on an ordinary transfer to the same desk", () => {
  // THE ASYMMETRY, pinned deliberately, because it looks like an inconsistency
  // and is not. The investment rule asks WHICH of three people took the lead,
  // and a row naming nobody does not answer that — so a blank is the answer,
  // and the answer is no. Everywhere else the assistant is a record nobody is
  // judged on the absence of: on the same desk, on the same day, an ordinary
  // transfer with the same blank field is the floor.
  const flagged = scoreTransferPriority(five("Cal", REDOBLE, true, null), recipients)[0];
  assert.equal(flagged.pct, 0);
  assert.equal(flagged.mean, INVESTMENT_IGNORED_CREDIT);
  assert.equal(flagged.scored, 5, "read, not dropped");
  assert.equal(flagged.unplaced, 0, "and not a data gap either");
  assert.equal(flagged.breaches, 5, "a blank on an investment IS the mis-routing");
  assert.equal(flagged.investment, 5);
  assert.equal(flagged.priorityDeskScored, 0, "it never touched the desk ladder");

  const plain = scoreTransferPriority(five("Ada", REDOBLE, false, null), recipients)[0];
  assert.equal(plain.pct, 60);
  assert.equal(plain.mean, PRIORITY_FLOOR_CREDIT);
  assert.equal(plain.scored, 5);
  assert.equal(plain.unplaced, 0);
  assert.equal(plain.investment, 0, "the flag is what `investment` counts, and it was not set");
  assert.equal(plain.breaches, 0, "nobody is accused of mis-routing");
  assert.equal(plain.priorityDeskScored, 5);

  // The two rows are otherwise identical: same CLR-shaped work, same desk, same
  // days, same empty field. Only the qualification separates them.
  assert.equal(plain.pct! - flagged.pct!, 60);
});

test("a desk that is FLAGGED but has no assistants is an ordinary desk", () => {
  // Both halves of `prioritisedDeskIds` are load-bearing. Shervin Mohseni and
  // Michael Kim carry needs_transfers and nobody sits with them, so there is no
  // assistant to rank and no reason to lift a floor: they are scored on the
  // ordinary ramp, at their own place on it.
  assert.ok(!prioritisedDeskIds(recipients).has(recipientKey("lo", SHERVIN)));
  assert.ok(!prioritisedDeskIds(recipients).has(recipientKey("lo", KIM)));
  assert.equal(scoreTransferPriority(five("Cal", SHERVIN, false), recipients)[0].pct, 53,
    "32 received, well up the ramp — and below the 60 floor, which is the point");
  assert.equal(scoreTransferPriority(five("Cal", KIM, false), recipients)[0].pct, 100,
    "17 received and flagged, so the flag line carries him — on the RAMP, not a floor");
  // Hire him an assistant and the same desk becomes a prioritised one.
  const withAssistant = [...recipients, loa(150, "Nadia", SHERVIN, 4)];
  assert.deepEqual([...prioritisedDeskIds(withAssistant)].sort(),
    [recipientKey("lo", REDOBLE), recipientKey("lo", SHERVIN)]);
  assert.equal(scoreTransferPriority(five("Cal", SHERVIN, false, 150), withAssistant)[0].pct, 100,
    "the only assistant on the desk, so nobody is busier: the top of the band");
});

test("a desk with assistants that is NOT flagged is an ordinary desk", () => {
  // The other half. Nathan Coutino is the second-heaviest man on the floor and
  // nobody has told anybody to feed him, so hiring him an assistant must not
  // buy his desk a 60% floor: his transfers stay on the ramp at 8%.
  const nathanDesk = [...recipients, loa(151, "Paz", NATHAN, 0)];
  assert.deepEqual([...prioritisedDeskIds(nathanDesk)], [recipientKey("lo", REDOBLE)]);
  const row = scoreTransferPriority(five("Cal", NATHAN, false, 151), nathanDesk)[0];
  assert.equal(row.pct, 8, "the ordinary ramp, exactly as before he hired her");
  assert.equal(row.priorityDeskScored, 0);
  assert.equal(row.unrestricted, 5, "scored against the floor, like any ordinary transfer");
});

test("two assistants tied on load score identically, and one alone sits at the top", () => {
  // The ladder ranks DISTINCT loads, so a tie cannot be split — the same
  // promise the loan-officer band makes, for the same reason: equal load is
  // equal need, and splitting it would be arbitrary.
  const TWIN = 152;
  const tied = [...recipients, loa(TWIN, "Nadia", REDOBLE, 51)];
  const ladder = deskAssistantCredits(tied, recipientKey("lo", REDOBLE));
  assert.equal(ladder.get(recipientKey("loa", TWIN)), ladder.get(recipientKey("loa", JUSTIN)));
  assert.deepEqual([JUSTIN, TWIN].map((id) =>
    scoreTransferPriority(five("Cal", REDOBLE, false, id), tied)[0].pct), [66, 66]);
  // ...and a tie does not re-score the rest of the desk either.
  assert.deepEqual([JONJAIRO, MATEO_LOA, JOHN].map((id) =>
    scoreTransferPriority(five("Cal", REDOBLE, false, id), tied)[0].pct), [100, 77, 60]);

  // One assistant and one only is the degenerate case: nobody on that desk is
  // busier than anybody, so she is the top of the band and not the bottom of it.
  const solo = recipients.filter((r) => r.kind !== "loa").concat([loa(153, "Solo", REDOBLE, 999)]);
  assert.deepEqual([...deskAssistantCredits(solo, recipientKey("lo", REDOBLE))],
    [[recipientKey("loa", 153), 1]]);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, false, 153), solo)[0].pct, 100);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, false, null), solo)[0].pct, 60,
    "and the floor is still the floor for a row that names nobody");
});

// ── the three, still resolved by identity and still bounded by the desk ──────

test("HIGH — a rename moves the rule where the roster has an id, and stops it where it does not", () => {
  // Rename the loan officer they sit with: nothing moves, because his name was
  // never part of the answer — the desk is resolved from the three assistants'
  // OWN rows, as an id, and so is the ladder his transfers are scored on.
  const renamedLo = recipients.map((r) =>
    (r.kind === "lo" && r.id === REDOBLE ? { ...r, name: "Christopher Somebodyelse" } : r));
  assert.deepEqual(keysOf(renamedLo), THREE);
  assert.deepEqual([...prioritisedDeskIds(renamedLo)], [recipientKey("lo", REDOBLE)]);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, MATEO_LOA), renamedLo)[0].pct, 100);

  // Give an assistant her surname, which is the rename that actually happens:
  // the roster row is the same person, so the same id is admitted and she is on
  // the same rung of the three-name ladder.
  const surnamed = recipients.map((r) =>
    (r.kind === "loa" && r.id === MATEO_LOA ? { ...r, name: "Mateo Reyes" } : r));
  assert.deepEqual(keysOf(surnamed), THREE);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, MATEO_LOA), surnamed)[0].pct, 100);

  // And what a rename does NOT survive, pinned here rather than promised away.
  // A recorded first name is the only handle the roster offers for the three
  // themselves, so renaming one past recognition stops the RESOLVER — which the
  // route still logs. The cost is bounded on purpose: it stops for EVERYBODY,
  // so a roster edit can switch the resolver off and can never turn it into a
  // false accusation against the other two.
  const unrecognisable = recipients.map((r) =>
    (r.kind === "loa" && r.id === MATEO_LOA ? { ...r, name: "Teo" } : r));
  assert.equal(investmentAssistantKeys(unrecognisable), null);
  assert.match(resolveInvestmentRouting(unrecognisable).problem ?? "",
    /no active assistant named Mateo/);
  // What a stopped resolver costs is bounded in the one direction that matters:
  // it can switch the GATE off, and it can never turn it into an accusation.
  // Cal's five investments fall through to the reading their record shows — the
  // desk ladder, where Justin's 51 is the 66th rung — nobody is charged with a
  // breach, and the transfers the rule did not judge are counted so the
  // dashboard can withhold the number rather than print it as a verdict.
  const past = scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), unrecognisable)[0];
  assert.equal(past.pct, 66);
  assert.equal(past.breaches, 0, "nobody is accused on the way past");
  assert.equal(past.investment, 0, "the rule judged none of them...");
  assert.equal(past.investmentUnscored, 5, "...and says so, on the row");
  assert.equal(past.priorityDeskScored, 5, "read as the ordinary desk transfer it looks like");
});

test("HIGH — a name that resolves to NOBODY stops the rule, rather than scoring everybody 0", () => {
  // Mateo leaves, or is respelled past recognition. Running the gate on the two
  // names that still resolve would read every compliant transfer to the third
  // as a flat zero — the sharpest verdict this file hands out, arrived at
  // because somebody was renamed. So it stops for everybody instead.
  const gone = recipients.filter((r) => !(r.kind === "loa" && r.id === MATEO_LOA));
  assert.equal(investmentAssistantKeys(gone), null);
  assert.equal(investmentAssistantKeys(recipients.filter((r) => r.kind === "lo")), null);
  assert.equal(investmentAssistantKeys([]), null);

  // And STOPPED means stopped: not one flagged transfer is scored 0, not even
  // the ones that would have been breaches with the roster intact. Every one of
  // them falls through to the reading its own record shows — the desk ladder
  // here — and every one is counted, so the number can be withheld rather than
  // printed as a verdict the roster caused.
  const unrecognisable = recipients.map((r) =>
    (r.kind === "loa" && r.id === MATEO_LOA ? { ...r, name: "Teo" } : r));
  assert.equal(investmentAssistantKeys(unrecognisable), null);
  const stopped = [JONJAIRO, MATEO_LOA, JUSTIN, JOHN, null].map((loaId) =>
    scoreTransferPriority(five("Cal", REDOBLE, true, loaId), unrecognisable)[0]);
  assert.deepEqual(stopped.map((s) => s.pct), [100, 77, 66, 60, 60], "the desk ladder, untouched");
  for (const s of stopped) {
    assert.equal(s.breaches, 0, "nobody is accused while the rule is off");
    assert.equal(s.investment, 0, "and nothing claims to have been judged by it");
    assert.equal(s.investmentUnscored, 5, "the flagged rows are counted, not absorbed");
  }
  // With the roster intact the same five records are gated, and two of them are
  // the flat 0 the stop refuses to hand out on a rename.
  assert.deepEqual([JONJAIRO, MATEO_LOA, JUSTIN, JOHN, null].map((loaId) =>
    scoreTransferPriority(five("Cal", REDOBLE, true, loaId), recipients)[0].pct),
    [0, 100, 80, 60, 0]);

  // Off a prioritised desk the fallback is ordinary placement, which is the
  // honest reading of a record the rule could not judge — and the misleading
  // one the counter exists to flag: Derek is the lightest man on the floor, so
  // these five read 100% for a routing rule nobody checked.
  const onStarved = scoreTransferPriority(five("Cal", DEREK, true, null), gone)[0];
  assert.equal(onStarved.pct, 100);
  assert.equal(onStarved.breaches, 0);
  assert.equal(onStarved.investmentUnscored, 5);
});

test("a name TWO people answer to admits both, rather than silently picking one", () => {
  // A second Justin is hired onto the same desk. The resolver admits both,
  // because choosing between them would be a guess and the roster cannot break
  // the tie honestly.
  const OTHER_JUSTIN = 108;
  const twoJustins = [...recipients, loa(OTHER_JUSTIN, "Justin", REDOBLE, 51)];
  assert.deepEqual(keysOf(twoJustins), [...THREE, recipientKey("loa", OTHER_JUSTIN)].sort());
  // Both are admitted, so a transfer naming either passes the gate — and each
  // is then ranked on her OWN load, which for these two is the same 51 and so
  // the same rung. A wrong 100 costs nothing; a wrong 0 accuses somebody of
  // ignoring a rule they obeyed.
  for (const loaId of [JUSTIN, OTHER_JUSTIN]) {
    const row = scoreTransferPriority(five("Cal", REDOBLE, true, loaId), twoJustins)[0];
    assert.equal(row.pct, 80, String(loaId));
    assert.equal(row.breaches, 0, String(loaId));
  }
  // An assistant the rule does not name is outside the gate however light she
  // is. Erik carries 26 — the second-lightest desk in the building, and worth
  // 94% on the ordinary ladder — and an investment recorded to him is 0.
  const erik = scoreTransferPriority(five("Cal", REDOBLE, true, ERIK), twoJustins)[0];
  assert.equal(erik.pct, 0);
  assert.equal(erik.breaches, 5);
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, false, ERIK), twoJustins)[0].pct, 94,
    "the same record, unflagged, is his own rung on the desk");
});

test("HIGH — \"Chris's\" is enforced: another loan officer's Justin is a different person", () => {
  // Half of Ethan's rule is WHOSE assistants these are, and it is not
  // decoration. Nathan Coutino hires a Justin of his own; she answers to the
  // same first name, and admitting her would quietly widen "Chris's Justin,
  // Mateo or John" into "anybody's Justin".
  const OTHER_DESK_JUSTIN = 109;
  const elsewhere = [...recipients, loa(OTHER_DESK_JUSTIN, "Justin", NATHAN, 3)];
  assert.deepEqual(keysOf(elsewhere), THREE, "she is not one of the three");
  // The desk itself is resolved from the three's OWN rows — the one desk all of
  // them point at — and never by matching a loan officer's name.
  const routing = resolveInvestmentRouting(elsewhere);
  assert.equal(routing.desk, recipientKey("lo", REDOBLE));
  assert.equal(routing.problem, null);
  // Both the GATE and the ladder are bounded by that same desk id, and that is
  // where "Chris's" is enforced. Her 3 is the lightest load either would rank,
  // and it buys her nothing on his desk: an investment recording her is outside
  // the gate — 0 and a breach — and an ordinary transfer recording her is the
  // floor, not the 100% her own load would have been worth.
  assert.equal(deskAssistantCredits(elsewhere, recipientKey("lo", REDOBLE))
    .get(recipientKey("loa", OTHER_DESK_JUSTIN)), undefined);
  const hers = scoreTransferPriority(five("Cal", REDOBLE, true, OTHER_DESK_JUSTIN), elsewhere)[0];
  assert.equal(hers.pct, 0);
  assert.equal(hers.breaches, 5, "another officer's Justin does not satisfy the rule");
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, false, OTHER_DESK_JUSTIN), elsewhere)[0].pct, 60);
  // Her own desk is not prioritised — Nathan carries no flag — so a transfer
  // there is ordinary placement, and her sitting on it changes nothing.
  assert.deepEqual([...prioritisedDeskIds(elsewhere)], [recipientKey("lo", REDOBLE)]);
  assert.equal(scoreTransferPriority(five("Cal", NATHAN, false, OTHER_DESK_JUSTIN), elsewhere)[0].pct, 8);
  // ...and Chris's Justin is untouched by hers existing.
  assert.equal(scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), elsewhere)[0].pct, 80);
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

test("HIGH — `investmentUnscored` fires when the roster cannot resolve the three, and only then", () => {
  // The counter the dashboard's dash hangs on. A roster that cannot resolve the
  // three leaves every flagged transfer to fall through to the reading its
  // record shows, and that fallback is misleading in both directions: onto the
  // busiest desk in the building it prints a rung nobody was judged on, and
  // onto the lightest man on the floor it prints a triumphant 100% for a
  // routing rule that never ran. So the transfers are counted and the number is
  // withheld rather than shown.
  const gone = recipients.filter((r) => !(r.kind === "loa" && r.id === MATEO_LOA));
  const row = scoreTransferPriority(five("Cal", REDOBLE, true, JUSTIN), gone)[0];
  assert.equal(row.investmentUnscored, 5, "five flagged transfers the rule could not judge");
  assert.equal(row.investment, 0, "and none it did");
  assert.equal(row.breaches, 0, "a roster edit is not an accusation");
  assert.equal(row.pct, 67, "the desk ladder Justin's 51 puts her on, minus the departed Mateo");
  // Off a prioritised desk, and with a roster that cannot answer either.
  const off = scoreTransferPriority(five("Cal", DEREK, true, null), gone)[0];
  assert.equal(off.investmentUnscored, 5);
  assert.equal(off.pct, 100, "ordinary placement, which is exactly why it is withheld");

  // With the roster intact nothing is ever left unjudged: every flagged
  // transfer is gated, whatever it recorded and wherever it went.
  for (const [loId, loaId] of [[REDOBLE, MATEO_LOA], [REDOBLE, ERIK], [REDOBLE, null],
                               [DEREK, null], [NATHAN, JUSTIN], [null, null]] as const) {
    const judged = scoreTransferPriority(five("Cal", loId, true, loaId), recipients)[0];
    assert.equal(judged.investmentUnscored, 0, `${loId} ${loaId}`);
    assert.equal(judged.investment, 5, `${loId} ${loaId}`);
  }
});

test("HIGH — the dials say what each band is: a 60-100 ladder, and a flat 0 for a miss", () => {
  // The three constants the scoring bands are built from, pinned together so
  // their shape cannot drift without a test saying so. Both ladders — the
  // desk's eight and the rule's three — run from the floor to the top and no
  // rung on either is a zero; the zero is what sits OUTSIDE the three, and it
  // is reachable, which is the change.
  assert.equal(PRIORITY_FLOOR_CREDIT, 0.6);
  assert.equal(INVESTMENT_FOLLOWED_CREDIT, 1, "the top of both ladders");
  assert.equal(INVESTMENT_IGNORED_CREDIT, 0, "and the flat verdict on a routing miss");
  const ladder = [...deskAssistantCredits(recipients, recipientKey("lo", REDOBLE)).values()];
  assert.equal(Math.min(...ladder), PRIORITY_FLOOR_CREDIT);
  assert.equal(Math.max(...ladder), INVESTMENT_FOLLOWED_CREDIT);
  assert.ok(!ladder.includes(INVESTMENT_IGNORED_CREDIT), "no rung is a zero");
  // The three-name ladder has the same two ends, read through the stat itself.
  const meanOf = (loaId: number | null) =>
    scoreTransferPriority(five("Cal", REDOBLE, true, loaId), recipients)[0].mean;
  assert.equal(meanOf(MATEO_LOA), INVESTMENT_FOLLOWED_CREDIT);
  assert.equal(meanOf(JOHN), PRIORITY_FLOOR_CREDIT);
  assert.equal(meanOf(ERIK), INVESTMENT_IGNORED_CREDIT, "and off the ladder is the flat 0");
  assert.equal(meanOf(null), INVESTMENT_IGNORED_CREDIT);
});

test("HIGH — the ladder beats the ordinary ramp on the busiest desk in the building", () => {
  // The point of the whole rework. Christopher Redoble took 282 of the 687
  // transfers in the fortnight, so his desk is worth exactly 0 on the ordinary
  // ramp — and the floor was TOLD to feed him. Scoring his transfers on that
  // ramp marks a CLR down for doing as they were told.
  assert.equal(creditOf("Christopher Redoble"), 0, "the ordinary ramp still says 0");
  for (const [who, loaId, pct] of [["Jonjairo", JONJAIRO, 100], ["Mateo", MATEO_LOA, 77],
                                   ["John", JOHN, 60], ["nobody", null, 60]] as const) {
    const row = scoreTransferPriority(five("Cal", REDOBLE, false, loaId), recipients)[0];
    assert.equal(row.pct, pct, who);
    assert.equal(row.investment, 0, `${who} — an ordinary placement, not a routed one`);
    assert.equal(row.breaches, 0, `${who} — and nobody is accused of mis-routing`);
    assert.equal(row.scored, 5, who);
    assert.equal(row.priorityDeskScored, 5, `${who} — scored on the desk, not on the ramp`);
    assert.equal(row.unrestricted, 0, `${who} — no pool was consulted at all`);
  }
  // An INVESTMENT onto the same desk leaves that ladder for the three-name one,
  // which is a different question with a different answer: the lightest desk in
  // the building is worth nothing on it, and the lightest of the three is worth
  // everything.
  assert.deepEqual([JONJAIRO, MATEO_LOA, JOHN, null].map((loaId) =>
    scoreTransferPriority(five("Cal", REDOBLE, true, loaId), recipients)[0].pct), [0, 100, 60, 0]);
});

test("HIGH — an investment that missed the three is 0%, however well placed it looks", () => {
  // Ethan's rule, and the reason the three names are a GATE rather than a
  // flavour of the ladder: the assistant ladder was scoring whichever assistant
  // took it, so an investment routed to Erik came out at 94%. It is required to
  // reach Justin, Mateo or John, and a record that does not say one of them did
  // is worth nothing — however starved the loan officer on the row was, and
  // however light the assistant it names.
  assert.equal(creditOf("Derek Bullen"), 1, "worth a full 1.0 on any ordinary transfer");
  const cases: Array<[string, number | null, number | null]> = [
    ["the lightest man on the floor, and nobody named", DEREK, null],
    ["the lightest man on the floor, with another assistant recorded", DEREK, RYAN_LOA],
    ["the busiest ORDINARY desk", NATHAN, null],
    ["a loan officer off the roster", 9999, ERIK],
    ["a seeded placeholder nobody has ever transferred to", ALEX_DEMO, ERIK],
    ["nobody recorded anywhere on the row", null, null],
    ["the prioritised desk, but its lightest assistant", REDOBLE, JONJAIRO],
  ];
  for (const [label, loId, loaId] of cases) {
    const row = scoreTransferPriority(five("Cal", loId, true, loaId), recipients)[0];
    assert.equal(row.pct, 0, label);
    assert.equal(row.mean, INVESTMENT_IGNORED_CREDIT, `${label} — flat, and the worst there is`);
    assert.equal(row.investment, 5, label);
    assert.equal(row.breaches, 5, `${label} — and every one of them is counted as a miss`);
    assert.equal(row.scored, 5, `${label} — read, not dropped: a routed transfer is not a data gap`);
    assert.equal(row.unplaced, 0, label);
    assert.equal(row.priorityDeskScored, 0, `${label} — the gate, never the desk ladder`);
  }

  // What the gate reads is the ASSISTANT: naming an admitted one IS naming that
  // desk, because the form only offers the chosen officer's own assistants, so
  // the loan officer on the row is not a second gate on top of it. These
  // pairings cannot arise from the form; the rule's answer to them is the same
  // three-name ladder, and nothing about the loan officer moves it.
  assert.deepEqual([DEREK, NATHAN, 9999, null].map((loId) =>
    scoreTransferPriority(five("Cal", loId, true, MATEO_LOA), recipients)[0].pct),
    [100, 100, 100, 100]);

  // A miss cannot be rescued by good placement, and it is the one reading in
  // this file that scores below the busiest desk on the ordinary ramp.
  const mixed = scoreTransferPriority(
    [...five("Cal", DEREK, true), ...five("Ada", DEREK, false)], recipients);
  assert.deepEqual(mixed.map((s) => [s.name, s.pct]), [["Ada", 100], ["Cal", 0]]);
});

test("a flagged row is judged by the assistant alone, off a prioritised desk as on it", () => {
  // The gate asks one question — which of three people took it — and the loan
  // officer on the row does not answer it. So the same three readings come out
  // of every destination: John is one of the three and the busiest of them
  // (60), Erik is not one of them at all (0), and a row naming nobody does not
  // say one of them took it (0).
  for (const loId of [null, 9999, ALEX_DEMO, DEREK, REDOBLE]) {
    for (const [loaId, pct] of [[JOHN, 60], [ERIK, 0], [null, 0]] as const) {
      const row = scoreTransferPriority(five("Cal", loId, true, loaId), recipients)[0];
      assert.equal(row.pct, pct, `${loId} ${loaId}`);
      assert.equal(row.investment, 5, `${loId} ${loaId}`);
      assert.equal(row.unplaced, 0, `${loId} ${loaId}`);
      assert.equal(row.breaches, pct === 0 ? 5 : 0, `${loId} ${loaId}`);
    }
  }
  // The same rows UNFLAGGED and with no readable loan officer are what they
  // always were: unreadable, valued at the floor mean, and never a verdict.
  const unreadable = scoreTransferPriority(
    [...five("Cal", null, false, JOHN), ...five("Ada", DEREK, false)], recipients)
    .filter((s) => s.name === "Cal")[0];
  assert.equal(unreadable.scored, 0);
  assert.equal(unreadable.unplaced, 5);
  assert.equal(unreadable.breaches, 0);
  assert.equal(unreadable.pct, null, "nothing readable at all is a null, not an accusation");
});

test("an UNFLAGGED transfer to an ordinary desk is scored exactly as it always was", () => {
  // Nothing about ordinary placement changes. The busiest ORDINARY desk is
  // still 8%, the lightest man on the floor is still 100%, and the middle of
  // the ramp is still the middle of the ramp. None of this ever sees a floor.
  const worst = scoreTransferPriority(five("Dana", NATHAN, false), recipients)[0];
  assert.equal(worst.pct, 8);
  assert.equal(worst.investment, 0);
  assert.equal(worst.priorityDeskScored, 0);
  assert.equal(worst.unrestricted, 5, "compared with the whole floor, and says so");

  const best = scoreTransferPriority(five("Riley", DEREK, false), recipients)[0];
  assert.equal(best.pct, 100);
  assert.equal(best.investment, 0);
  assert.equal(best.unrestricted, 5);

  assert.equal(scoreTransferPriority(five("Sam", MARK, false), recipients)[0].pct, 65,
    "Mark Gomez on 30 — halfway up the ramp, and nowhere near the 60 floor by accident");
  assert.equal(scoreTransferPriority(five("Sam", RYAN_A, false), recipients)[0].pct, 20,
    "Ryan Andrade on 39 — low on the ramp, and his own five push him lower as they land");
});

test("HIGH — the assistant is worth nothing at all on an ORDINARY desk, exactly", () => {
  // loa_id is blank on roughly two thirds of real transfers. Read on the ramp,
  // it would separate two CLRs doing the identical thing by up to a hundred
  // points because one of them used the picker — CRM hygiene printed as a
  // placement judgement. Off a prioritised desk it is still read nowhere at all.
  //
  // EXACT equality, not a tolerance.
  for (const [label, loId] of [["the busiest ordinary desk", NATHAN], ["a starved LO", DEREK]] as const) {
    const named = scoreTransferPriority(five("Ivy", loId, false, MATEO_LOA), recipients)[0];
    const blank = scoreTransferPriority(five("Jo", loId, false, null), recipients)[0];
    const other = scoreTransferPriority(five("Kit", loId, false, ERIK), recipients)[0];
    for (const key of ["mean", "pct", "scored", "investment", "breaches", "unplaced", "unrestricted"] as const) {
      assert.equal(named[key], blank[key], `${label} ${key}`);
      assert.equal(other[key], blank[key], `${label} ${key}`);
    }
  }
  // The two numbers themselves, so this cannot pass by all three being null.
  assert.deepEqual([NATHAN, DEREK].map((loId) =>
    scoreTransferPriority(five("Ivy", loId, false, MATEO_LOA), recipients)[0].pct), [8, 100]);

  // ...and where the same field IS the whole answer, it is worth up to a
  // hundred points — which is the pairing the boundary exists to keep apart.
  // On a prioritised desk it is her rung; on an investment it is the gate, and
  // the two orderings are not even the same shape.
  assert.deepEqual([MATEO_LOA, ERIK, null].map((loaId) =>
    scoreTransferPriority(five("Ivy", REDOBLE, false, loaId), recipients)[0].pct), [77, 94, 60]);
  assert.deepEqual([MATEO_LOA, ERIK, null].map((loaId) =>
    scoreTransferPriority(five("Ivy", REDOBLE, true, loaId), recipients)[0].pct), [100, 0, 0]);
});

test("a mixed row carries its counters, which is what makes its number readable", () => {
  // Cal made ten readable transfers: five investment properties, three of which
  // reached Justin (the busiest but one of the three, so the 80 rung) and two
  // of which recorded nobody (a miss, so 0), and five ordinary ones onto the
  // lightest man on the floor. 74% — and what he "lost" is two investment leads
  // that never named one of the three, which is a very different conversation
  // from 74% earned by middling placement. The counters are what let the cell
  // say so.
  const rows = [
    ...five("Cal", REDOBLE, true, JUSTIN).slice(0, 3),
    ...five("Cal", REDOBLE, true, null).slice(0, 2),
    ...five("Cal", DEREK, false),
  ];
  const cal = scoreTransferPriority(rows, recipients)[0];
  assert.equal(cal.transfers, 10);
  assert.equal(cal.scored, 10);
  assert.equal(cal.investment, 5, "recorded as investment properties");
  assert.equal(cal.breaches, 2, "and two of the five named nobody at all");
  assert.equal(cal.priorityDeskScored, 0, "none of them was judged on the desk ladder");
  assert.equal(cal.unrestricted, 5, "only the ordinary five ever consulted a pool");
  assert.equal(cal.mean, 0.74);
  assert.equal(cal.pct, 74);
  assert.equal(cal.mean, round4((3 * 0.8 + 2 * INVESTMENT_IGNORED_CREDIT + 5 * 1) / 10),
    "three rungs, two misses and five perfect placements, over ten");
});

test("the desk decides which ORDINARY reading applies; the qualification decides whether any does", () => {
  // Pinned so that "prioritised" is not quietly widened into "anything with one
  // of Chris's assistants on it". On an ordinary transfer the same assistant is
  // a rung when the transfer reached his desk and unread when it did not,
  // because the desk is what the floor was told to feed.
  assert.equal(scoreTransferPriority(five("Ivy", REDOBLE, false, JUSTIN), recipients)[0].pct, 66);
  assert.equal(scoreTransferPriority(five("Ivy", DEREK, false, JUSTIN), recipients)[0].pct, 100);
  assert.equal(scoreTransferPriority(five("Ivy", NATHAN, false, JUSTIN), recipients)[0].pct, 8);
  // Flagged, the desk stops deciding anything: the gate asks which of the three
  // took it, so Justin is the same 80 wherever the row says it went...
  assert.equal(scoreTransferPriority(five("Ivy", REDOBLE, true, JUSTIN), recipients)[0].pct, 80);
  assert.equal(scoreTransferPriority(five("Ivy", DEREK, true, JUSTIN), recipients)[0].pct, 80);
  // ...and an assistant on his desk who is not one of the three is worth her
  // rung when nothing routed the lead and nothing at all when something did.
  assert.equal(scoreTransferPriority(five("Ivy", REDOBLE, false, ERIK), recipients)[0].pct, 94);
  assert.equal(scoreTransferPriority(five("Ivy", REDOBLE, true, ERIK), recipients)[0].pct, 0);
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
      five("Cal", NATHAN, false, JUSTIN).map((r) => ({ ...r, investmentProperty: flag })), recipients)[0];
    assert.equal(row.investment, 0, String(flag));
    assert.equal(row.breaches, 0, String(flag));
    assert.equal(row.pct, 8, `${flag} — the ordinary ramp, not the 60 floor`);
  }
  // ...and `investment` counts the FLAG, never the desk. The same record read
  // both ways is two different questions with two different answers: Mateo is
  // the fourth-lightest of eight assistants (77) and the lightest of the three
  // the rule names (100).
  const flagged = scoreTransferPriority(five("Cal", REDOBLE, true, MATEO_LOA), recipients)[0];
  const plain = scoreTransferPriority(five("Cal", REDOBLE, false, MATEO_LOA), recipients)[0];
  assert.deepEqual([flagged.pct, plain.pct], [100, 77]);
  assert.deepEqual([flagged.investment, plain.investment], [5, 0]);
  assert.deepEqual([flagged.priorityDeskScored, plain.priorityDeskScored], [0, 5]);
});

test("the rules the routing resolver rests on are written down next to the arithmetic", () => {
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

test("the answer the app composed is what decides whether the routing gate applies", () => {
  // The two halves joined up, on the route's own arithmetic. Cal sends five to
  // Nathan Coutino, the busiest ORDINARY desk on the floor, naming no assistant.
  // With an app-composed Yes the transfer was required to reach one of three
  // people and the record does not say it did: 0%. With a No, or with a
  // sentence merely mentioning the word, nothing routed it: the same five are
  // an ordinary placement onto the heaviest desk a CLR could have avoided, and
  // score 8%. Nothing between those readings is a guess.
  const rows = (blob: string, loId: number, loaId: number | null): TransferRow[] =>
    [D1, D1, D2, D2, D3].map((d) => ({
      clrId: "Cal", clrName: "Cal", loId, at: d, loaId,
      investmentProperty: isInvestmentProperty(blob),
    }));
  assert.equal(scoreTransferPriority(rows(composed("yes"), NATHAN, null), recipients)[0].pct, 0);
  assert.equal(scoreTransferPriority(rows(composed("no"), NATHAN, null), recipients)[0].pct, 8);
  assert.equal(scoreTransferPriority(rows("not an investment property", NATHAN, null), recipients)[0].pct, 8,
    "a sentence about it is not an answer to it");
  // ...and the other way round, so this is not just the desk being heavy: a Yes
  // takes the lightest man on the floor from 100% to 0, because feeding the
  // starved was not the question this lead was asked.
  assert.equal(scoreTransferPriority(rows(composed("yes"), DEREK, null), recipients)[0].pct, 0);
  assert.equal(scoreTransferPriority(rows(composed("no"), DEREK, null), recipients)[0].pct, 100);
  // On the PRIORITISED desk the answer still changes the question: unrouted,
  // Justin's 51 is her rung among eight; routed, it is her rung among three.
  assert.deepEqual([composed("yes"), composed("no")].map((blob) =>
    scoreTransferPriority(rows(blob, REDOBLE, JUSTIN), recipients)[0].pct), [80, 66]);
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

  // The assistant column IS read now — she is the destination a prioritised
  // desk ranks — but in exactly two places: the field on TransferRow, and the
  // one read inside the desk branch. Anywhere else it would be CRM hygiene.
  assert.match(code, /loaId\?: number \| string \| null;/, "declared on TransferRow");
  assert.equal((code.match(/t\.loaId/g) ?? []).length, 2,
    "and read on one line only, the prioritised desk's own");
  assert.match(code, /hasId\(t\.loaId\) \? recipientKey\("loa", t\.loaId\) : null/);
  const ramp = src.slice(src.indexOf("function destinationKey"), src.indexOf("// ── the routing requirement"));
  assert.ok(!/loaId/.test(ramp), "the ramp scores the loan officer and nothing else");
});

// ── the stat, over a floor of CLRs ──────────────────────────────────────────

const board: TransferRow[] = [
  // Dana: six into the busiest desk in the building — which is also the one the
  // floor was TOLD to feed, so she rides its floor rather than its 0.
  t("Dana", REDOBLE, D1), t("Dana", REDOBLE, D1), t("Dana", REDOBLE, D2),
  t("Dana", REDOBLE, D2), t("Dana", REDOBLE, D3), t("Dana", REDOBLE, D3),
  // Riley: six into Derek Bullen, who began the fortnight on nothing.
  t("Riley", DEREK, D1), t("Riley", DEREK, D1), t("Riley", DEREK, D2),
  t("Riley", DEREK, D2), t("Riley", DEREK, D3), t("Riley", DEREK, D3),
  // Vic: six into Nathan Coutino, the busiest desk nobody told anybody to feed
  // — the worst ORDINARY placement on this board, and no floor under it.
  t("Vic", NATHAN, D1), t("Vic", NATHAN, D1), t("Vic", NATHAN, D2),
  t("Vic", NATHAN, D2), t("Vic", NATHAN, D3), t("Vic", NATHAN, D3),
  // Sam: a mixed bag of five — the prioritised desk, the best, and three off
  // the ramp.
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

test("a CLR who fed only the busiest ORDINARY desk scores 0%", () => {
  // Vic put every one of six leads on Nathan Coutino, who is second only to the
  // prioritised desk and whom nobody asked anybody to feed. There is no floor
  // under that: 0% is a verdict the data earned.
  const vic = clr("Vic");
  assert.equal(vic.transfers, 6);
  assert.equal(vic.scored, 6);
  assert.equal(vic.pct, 8);
  assert.equal(vic.priorityDeskScored, 0);
  assert.equal(vic.ranked, true, "and it is ranked, not hidden");
  // The busiest desk in the BUILDING is worth exactly 0 on the same ramp — the
  // reading Dana would have got before the floor went under his desk.
  assert.equal(creditOf("Christopher Redoble"), 0);
});

test("a CLR who fed the desk the floor was told to feed sits on 60%", () => {
  // Dana's six all went to Christopher Redoble with no assistant recorded. The
  // ordinary ramp would call that the worst placement in the building; the
  // floor says it is the instruction being followed, and it is 60.
  const dana = clr("Dana");
  assert.equal(dana.transfers, 6);
  assert.equal(dana.scored, 6);
  assert.equal(dana.priorityDeskScored, 6);
  assert.equal(dana.pct, 60);
  assert.equal(dana.ranked, true);
  // ...and it still does not beat feeding the starved, or lose to nothing.
  assert.ok(dana.mean! < clr("Riley").mean!);
  assert.ok(dana.mean! > clr("Vic").mean!);
});

test("a CLR who fed the starved scores 100%, and volume is not what did it", () => {
  assert.equal(clr("Riley").pct, 100);
  assert.equal(clr("Riley").transfers, clr("Vic").transfers);
  assert.equal(clr("Vic").pct, 8);
});

test("a mixed CLR lands in the middle", () => {
  const sam = clr("Sam");
  assert.equal(sam.scored, 5);
  assert.equal(sam.priorityDeskScored, 1, "one of the five landed on the prioritised desk");
  assert.equal(sam.pct, 74);
  assert.equal(sam.mean, 0.7367);
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
  assert.equal(ola.unplacedValuedAt, 0.6623, "the mean of every ORDINARY readable transfer on the floor");
  assert.equal(ola.pct, 73, "not the 100% the old rule printed");
  assert.ok(ola.mean! < clr("Riley").mean!, "and no longer level with a clean sheet");
});

test("...and a data gap is never an accusation either", () => {
  // Moe fed the busiest ordinary desk three times and filed two records nothing
  // can read. The gap does not score him 0 — it lifts him toward the floor,
  // because a CRM field that never got written is not evidence anybody placed a
  // lead badly.
  const moe: TransferRow[] = [
    t("Moe", NATHAN, D1), t("Moe", NATHAN, D1), t("Moe", NATHAN, D2),
    t("Moe", null, D2), t("Moe", null, D3),
  ];
  const row = scoreTransferPriority([...board, ...moe], recipients)
    .filter((s) => s.name === "Moe")[0];
  assert.equal(row.scored, 3);
  assert.equal(row.unplaced, 2);
  assert.equal(row.mean, 0.3227);
  assert.ok(row.mean! > 0, "never 0");
  assert.ok(row.mean! < row.unplacedValuedAt!, "and never the floor's own average either");
});

test("HIGH — one CLR's score cannot move on ANOTHER CLR's forced routes", () => {
  // What fills an unreadable record is the mean of every ORDINARY readable
  // transfer the floor made, and that word is load-bearing. The forced-route
  // readings — the prioritised desk's ladder and the investment floor — are not
  // placement decisions at all; folding them in moved Ola's number depending on
  // where somebody else's investment leads happened to land that fortnight,
  // work she had no part in and could not have changed.
  const olaIn = (rows: TransferRow[]) =>
    scoreTransferPriority(rows, recipients).filter((s) => s.name === "Ola")[0];
  const alone = olaIn(board);
  const withFullMarks = olaIn([...board, ...five("Cal", REDOBLE, true, MATEO_LOA)]);
  const withBottomRung = olaIn([...board, ...five("Cal", REDOBLE, true, JOHN)]);
  const withBreaches = olaIn([...board, ...five("Cal", DEREK, true, null)]);
  for (const other of [withFullMarks, withBottomRung, withBreaches]) {
    assert.equal(other.unplacedValuedAt, alone.unplacedValuedAt);
    assert.equal(other.mean, alone.mean);
    assert.equal(other.pct, alone.pct);
  }
  // ...and Cal's own three fortnights are nothing like each other, so this is
  // not passing by the extra rows being ignored.
  const calIn = (rows: TransferRow[]) =>
    scoreTransferPriority(rows, recipients).filter((s) => s.name === "Cal")[0];
  assert.equal(calIn([...board, ...five("Cal", REDOBLE, true, MATEO_LOA)]).pct, 100);
  assert.equal(calIn([...board, ...five("Cal", REDOBLE, true, JOHN)]).pct, 60);
  assert.equal(calIn([...board, ...five("Cal", DEREK, true, null)]).pct, 0);
  // The filler itself is the tell: three fortnights running from perfect
  // compliance to five breaches, and the figure every unreadable record on the
  // floor is valued at does not move a hundredth.
  assert.equal(alone.unplacedValuedAt, 0.6623);
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
    assert.ok(s.priorityDeskScored <= s.scored, s.name);
    assert.ok(s.investmentUnscored <= s.transfers, s.name);
  }
  // And the mean really is taken over both halves, not over the readable one.
  // Cal's five readable ones are three investments that reached Justin (0.8
  // each) and two that named nobody (0 each, and counted as breaches).
  const cal = all.filter((s) => s.name === "Cal")[0];
  assert.equal(cal.transfers, 10);
  assert.equal(cal.scored, 5);
  assert.equal(cal.investment, 5);
  assert.equal(cal.breaches, 2);
  assert.equal(cal.priorityDeskScored, 0, "gated, so none of them touched the desk ladder");
  assert.equal(cal.unplaced, 5);
  assert.equal(cal.pct, Math.round(((3 * 0.8 + 2 * INVESTMENT_IGNORED_CREDIT)
    + 5 * cal.unplacedValuedAt!) / 10 * 100));
  assert.equal(cal.pct, 57);
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
  // A perfect two sits below a ranked 8%, because two is not a sample.
  assert.ok(scored.indexOf(pia) > scored.indexOf(clr("Vic")));
  // And the floor is a dial, not a law of nature: drop it to one and her two
  // perfect transfers rejoin the ranking, above everybody who placed worse.
  const loose = scoreTransferPriority(board, recipients, { roster: [{ clrId: "Nia", name: "Nia" }], minScored: 1 });
  const loosePia = loose.filter((s) => s.name === "Pia")[0];
  assert.equal(loosePia.ranked, true);
  assert.deepEqual(loose.map((s) => s.name),
    ["Riley", "Pia", "Sam", "Ola", "Dana", "Vic", "Nia", "Wes"]);
});

// ── the order of the board ──────────────────────────────────────────────────

test("the ranking is above the fold, and everything else is a footnote", () => {
  // A null used to sort BELOW a 0%, which re-imposed the accusation the null
  // existed to avoid: the bottom of a league table reads as worst on the floor.
  // `ranked` splits the list instead — the dashboard renders the tail as a
  // footnote, not as places four through seven.
  assert.deepEqual(scored.map((s) => s.name),
    ["Riley", "Sam", "Dana", "Vic", "Pia", "Ola", "Nia", "Wes"]);
  assert.deepEqual(scored.filter((s) => s.ranked).map((s) => s.name),
    ["Riley", "Sam", "Dana", "Vic"]);
  // Inside the tail: the provisional numbers first, then the silent rows by name.
  const tail = scored.filter((s) => !s.ranked);
  assert.deepEqual(tail.map((s) => s.pct), [100, 73, null, null]);
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
  // The floor and the ladder, in Ethan's own words, next to the constant they
  // set — so the next reader argues with the rule rather than with whoever
  // implemented it.
  assert.match(src, /The bottom of the ramp for a transfer nobody should be marked down for/);
  assert.match(src, /the LOA that gets it should be prioritized like an LO/);
  assert.match(src, /the floor starts at\r?\n \* 60/);
  assert.match(src, /flagged `needs_transfers` AND\r?\n \* carrying at least one assistant/);
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
  // Both rosters are counted from it and both still end at the range: the loan
  // officers because the ordinary ramp is rebuilt from them, and the assistants
  // because a prioritised desk's 60-100 ladder is ranked on their own loads. A
  // ladder handed zeroes ties every assistant and puts the whole desk at 100.
  assert.equal(scan.split(").all(placementFrom, endDate").length - 1, 2,
    "both the scored pool and the desk ladder reach back before the range");
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
    ...[1, 2, 3, 4, 5].map(() => t("Dana", NATHAN, D1)),
    ...[1, 2, 3, 4, 5].map(() => t("Riley", DEREK, D1)),
  ];
  // The floor as the old scan handed it over: counted over the day itself.
  const dayOnly: RecipientRow[] = recipients.map((r) => ({
    ...r,
    transfers: r.kind === "lo" && (r.id === NATHAN || r.id === DEREK) ? 5 : 0,
  }));
  const flat = scoreTransferPriority(oneDay, dayOnly);
  assert.deepEqual(flat.map((s) => [s.name, s.pct]), [["Dana", 100], ["Riley", 100]]);

  // The same day against a floor counted over the run-up as well: the answer
  // the manager is actually owed.
  const real = scoreTransferPriority(oneDay, recipients);
  assert.deepEqual(real.map((s) => [s.name, s.pct]), [["Riley", 100], ["Dana", 8]]);

  // ...and the prioritised desk is the one place the ORDINARY ramp is not the
  // answer, on a one-day window like any other: its floor is 60 whatever the
  // snapshot says.
  const onDesk = scoreTransferPriority([
    ...[1, 2, 3, 4, 5].map(() => t("Dana", REDOBLE, D1)),
    ...[1, 2, 3, 4, 5].map(() => t("Riley", DEREK, D1)),
  ], recipients);
  assert.deepEqual(onDesk.map((s) => [s.name, s.pct]), [["Riley", 100], ["Dana", 60]]);
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
  // An assistant is not a destination the ORDINARY ramp can score — receiving
  // stays false — but she IS the destination that gets ranked on a prioritised
  // desk, so her own load is counted over the same run-up and range the loan
  // officers are counted over. Hand it over as zero and every assistant on the
  // desk ties, which puts the whole desk at the top of the band.
  const loas = scan.slice(scan.indexOf("const placementLoas"), scan.indexOf("const placementRecipients"));
  assert.match(loas, /SELECT a\.id AS id, a\.full_name AS name, a\.lo_id AS deskId/);
  assert.match(loas, /receiving: false/);
  assert.match(loas, /SUM\(CASE WHEN o\.date >= \? AND o\.date <= \? THEN 1 ELSE 0 END\) AS transfers/);
  assert.match(loas, /ON o\.loa_id = a\.id/, "her own transfers, not her loan officer's");
  assert.match(loas, /o\.outcome_type = 'transfer'/);
  assert.match(loas, /transfers: Number\(r\.transfers\) \|\| 0/);
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
