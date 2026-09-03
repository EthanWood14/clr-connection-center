/**
 * The transfer dashboard's PLACEMENT stat.
 *
 * Every other transfer number on that page counts how many a CLR sent. This one
 * answers a different question, in Ethan's words: "who is transferring to LO's
 * that actually need transfers". It is a share, not a count — a CLR who made
 * four transfers and put every one of them in front of somebody starved scores
 * higher than one who made forty into the busiest desk in the building.
 *
 * The rule in six lines:
 *
 *   - every transfer is judged on the state of the floor BEFORE it landed
 *   - and only against the recipients that CLR could legitimately have chosen
 *   - the lightest few of those choices are worth full credit
 *   - everybody else ramps down by how many of the choices were busier
 *   - the busiest choice available is worth exactly 0
 *   - a CLR's score is the mean over the transfers they actually made
 *
 * Pure arithmetic over plain rows, exactly like server/tv-pages.ts: the route
 * runs the SQL and hands the rows over, so every rule in this file is testable
 * without a database and without booting Express.
 *
 * ── WHAT CHANGED IN THE REWORK, AND WHY ─────────────────────────────────────
 *
 * The first version of this stat scored a transfer against the recipient's load
 * at the END of the fortnight. That load already contained the CLR's own
 * transfers, so the harder you worked at feeding a starved loan officer, the
 * less starved he looked when the stat finally read him, and the worse you
 * scored. The optimal play was one lead each to the bottom five and never a
 * follow-up. A stat that pays for abandoning the person you just started
 * helping is worse than no stat, so five rules moved together:
 *
 *   1. BEFORE, NOT AFTER — see `snapshotLoads`. "Before" is only reconstructable
 *      if the caller counts recipients over a run-up as well as the range; the
 *      same window on both sides rebuilds every load as zero.
 *   2. AGAINST THE CHOICES THAT EXISTED — see `TransferRow.eligible`.
 *   3. A FORCED DESTINATION IS NOT A CHOICE — see `TransferRow.constrainedTo`
 *      and `constraintVerdict`. It protects the AXIS it forced; it does not
 *      excuse the rest of the transfer, and it does not excuse the one that
 *      disobeyed it.
 *   4. THE LOAN OFFICER IS THE DESTINATION — see `transferCredit`. Rule 3 is
 *      not allowed to suspend rule 4: a compliance answer narrows the pool on
 *      the axis it names and leaves every other axis judged exactly as it
 *      would have been without it.
 *   5. A RECORD NOBODY CAN READ IS NOT A GOOD PLACEMENT — see the UNPLACED note
 *      on `scoreTransferPriority`.
 */
import { orderStarved, STARVED_WINDOW_DAYS, type StarvedRow } from "./tv-pages";

/*
 * Ranking is NOT reimplemented here.
 *
 * `orderStarved` (server/tv-pages.ts) is the one place that decides who is
 * starved and in what order; the TV's Starved page and this stat have to agree,
 * because two rankings of "who needs work next" that disagree are worse than
 * either one alone. This module imports that comparator and never sorts by
 * transfers itself.
 *
 * Where the rule genuinely differs, said out loud so the two do not drift:
 * compareStarved deliberately keeps `needs_transfers` OUT of the ordering,
 * because sorting by it would put Christopher Redoble — 282 received in the same
 * fortnight the bottom of the list took six — at the head of a starvation list.
 * Here the flag DOES do something: it lifts the full-credit LINE up to that
 * person's load. That is only safe because it is gated (see
 * FLAG_PROMOTION_PERCENTILE), and the gate exists for precisely the case that
 * comment warns about. The ORDER still comes from orderStarved — the flag can
 * only ever move the line, it never moves the ranking.
 */

// ── the dials ───────────────────────────────────────────────────────────────

/**
 * The same fortnight the TV's Starved page measures, on purpose. Two windows
 * would give two different answers to "who is starved right now". Use
 * `starvedWindowStart(today)` from server/tv-pages.ts for the boundary date.
 */
export const PRIORITY_WINDOW_DAYS = STARVED_WINDOW_DAYS;

/**
 * The CAP on how many of the lightest loan officers sit at full credit.
 *
 * Ethan asked for "the lowest 3-5 LO's at 100%". Five, not three, because two of
 * the lightest rows on prod are real loan officers who took nothing at all in
 * the fortnight (idle, not fake). At three the band is spent on those two plus
 * Derek Bullen (6), and Sean Murphy (8) and Cole Thomas Fairon (14) — names
 * anybody on the floor would call starved — fall off it.
 *
 * It is a cap rather than a fixed count because the band now has to work over a
 * pool of three as well as a pool of nineteen: see `fullCreditBandSize`.
 */
export const FULL_CREDIT_LOS = 5;

/** "as well as ... lowest 2 LOA's". LOAs are a much smaller pool. */
export const FULL_CREDIT_LOAS = 2;

/**
 * The full-credit band as a SHARE of the pool, which is what makes the band
 * survive being handed three names instead of nineteen.
 *
 * "The lightest quarter" reproduces both of Ethan's numbers exactly on the prod
 * floor — ceil(19 x 0.25) = 5 loan officers, ceil(7 x 0.25) = 2 assistants — so
 * nothing about the everyday reading of the stat changes. What it adds is a
 * sensible answer when a CLR is handed a lead in a state with only three
 * licensed loan officers: a fixed five would put every one of them at 100% and
 * measure nothing at all, while the quarter-share puts one there and ramps the
 * other two.
 *
 * The absolute constants above stay as the ceiling, so growing the floor from
 * nineteen loan officers to forty does not silently widen the band to ten.
 */
export const FULL_CREDIT_SHARE = 0.25;

/**
 * TRAP 1 — the flag cannot promote somebody who is already well fed.
 *
 * `loan_officers.needs_transfers` is a human asking for work to be sent their
 * way, and it belongs in this stat: a "stated prioritized LO", in Ethan's words.
 * But on prod the flag is carried by Christopher Redoble, who took 282 of the
 * 687 transfers in the window — 41% of everything the floor sent. If the flag
 * alone granted 100%, most transfers in the company would score full marks and
 * the stat would separate nobody, which is the one thing it exists to do.
 *
 * The cut moved from the 75th percentile to the MEDIAN in the rework, and the
 * reason is the monotonicity fix. The flag no longer promotes one person: it
 * raises the full-credit line to that person's load, and everybody lighter comes
 * with them. That is the only way to keep the promise that choosing the lighter
 * loan officer can never score worse than choosing the heavier one — the old
 * rule handed flagged Michael Kim (17) a 1.0 while Mateo Tedeschi (16), who was
 * genuinely lighter, got 0.91 for it. But a line that drags everybody lighter
 * along cannot be allowed to start at the 75th percentile: promoting Shervin
 * Mohseni (32) there would put fifteen of nineteen loan officers at full credit.
 *
 * At the median (26 on 2026-09-03) Michael Kim (17) is promoted and carries
 * Mateo Tedeschi (16) with him; Shervin Mohseni (32) keeps his badge on the TV
 * but not a promotion here; Redoble gets neither. This constant is the dial if
 * the floor decides otherwise.
 */
export const FLAG_PROMOTION_PERCENTILE = 0.5;

/**
 * TRAP 2 — a recipient who has never actually received a transfer must not sit
 * in the full-credit band.
 *
 * The loan-officer table carries seeded demo rows (and one "Unknown LO
 * (Recovered)" placeholder) that have taken nothing, ever. They are the lightest
 * rows in the table by definition, so a naive "lowest five" hands 100% to a CLR
 * for transferring work to nobody. The signal is an INPUT — `RecipientRow.receiving`
 * — because no rule in this file should ever know a person's name; the route
 * derives it (an active row that has a real last-transfer date).
 *
 * Flip this to true only to prove what the exclusion is worth: it puts the demo
 * rows straight back at the top of the band.
 */
export const SCORE_NON_RECEIVING_RECIPIENTS = false;

/**
 * The smallest number of readable transfers that earns a place in the ranking.
 *
 * Without a floor, one lucky transfer tops the leaderboard over sixty careful
 * ones, and somebody who sent a single lead on their first morning outranks the
 * whole floor. Five, because the full-credit band is about a quarter of the
 * choices available (FULL_CREDIT_SHARE), so a CLR picking destinations blindly
 * scores 100% on any one transfer roughly one time in four — and five in a row
 * only about once in a thousand tries. Five is where a perfect score stops being
 * something the draw can hand you.
 *
 * A CLR under the floor is NOT hidden and NOT nulled: their number is still
 * printed, `ranked` is false, and they sort below everybody with a real sample.
 * Hiding it would be its own kind of accusation.
 */
export const MIN_SCORED_TRANSFERS = 5;

/**
 * Ethan's rule: "investment properties must go to justin, john, or mateo".
 *
 * ── WHAT "PROTECTED" MEANS, AND WHAT IT DOES NOT ────────────────────────────
 *
 * PROTECTED MEANS: the axis the rule forced is judged only against the
 * destinations the rule allowed, never against the whole floor. Sending an
 * investment property to Justin — the busiest assistant in the building — is
 * compared with John and Mateo and with nobody else, so obeying a routing
 * requirement can never be read as bad placement.
 *
 * PROTECTED DOES NOT MEAN the transfer is excused. The rule names three
 * ASSISTANTS. It says nothing whatever about which loan officer the lead lands
 * in front of, and the loan officer is the destination (rule 4 at the top of
 * this file). So every axis the rule did not force is judged exactly as it
 * would have been without the rule, and a row that names a loan officer is
 * scored on that loan officer.
 *
 * That is the whole of the fix for a real inversion. The first version scored a
 * constrained row against the forced set ALONE, which meant the loan officer
 * was not scored at all: a lead pushed onto the single busiest desk in the
 * company came out at 100% because the row also happened to name an allowed
 * assistant. A compliance rule exists to stop somebody being marked DOWN for
 * obeying it. It must never become a way to score UP, and answering a
 * qualification question is not a placement decision.
 *
 * ── THE THREE READINGS ──────────────────────────────────────────────────────
 *
 * `constraintVerdict` is where they are decided:
 *
 *   OBEYED — the row records a destination inside the allowed set. That axis is
 *     scored inside the set alone (protected); every other axis on the row is
 *     scored as the free choice it was.
 *
 *   IGNORED — the row records a destination the rule did not allow. That is not
 *     a forced choice, and it certainly is not a better one: it scores 0, the
 *     same as the busiest desk in the building. Both halves of that verdict are
 *     system-written — the answer the app composed itself, and the destination
 *     the transfer landed on — so nobody is being marked down for a sentence
 *     somebody typed. The first version scored this case as UNREADABLE, which
 *     valued it at the floor mean: answering "Yes" then sending the lead
 *     anywhere at all paid better than the placement actually deserved.
 *
 *   UNREADABLE — the row records nothing at all on the axis the rule names (an
 *     investment property with no loa_id). See `constraintVerdict` for why that
 *     is "we cannot tell" and not "they broke it", and for why it now costs
 *     almost nothing either way.
 *
 * ── WHY THIS IS NOW SWITCHED ON ─────────────────────────────────────────────
 *
 * A forced destination is not a placement decision. Sending an investment
 * property to Justin — the busiest LOA on the floor — is compliance on that
 * axis, and the stat must not read it as bad placement. The mechanism for that
 * is `TransferRow.constrainedTo`, and this constant is the list it is switched
 * on with.
 *
 * The mechanism was built long before it could be used, because what was
 * missing was the FACT. `lead_goal` is empty on every transfer in production
 * and `lead_type` has two rows in total, so the only trace of an investment
 * property used to be free text somebody typed. A stat that judges people must
 * never hinge on finding a word in a sentence that might perfectly well be
 * denying it, so the rule stayed inert rather than guess.
 *
 * The fact now exists. The qualification question is asked on both capture
 * surfaces and the app composes the answer itself, and
 * `isInvestmentProperty` in @shared/transfer-completeness reads it the same
 * strict way that file already reads its section markers: the label at the
 * start of a line, the answer compared whole, everything else failing closed.
 * A "No", a description, and a missing answer all leave the transfer
 * unconstrained — the reading has to be wrong in the harmless direction,
 * because an invented constraint would hand somebody full credit for a rule
 * that never bound them.
 *
 * What has NOT changed is which file does that reading. Nothing here touches
 * stored text and nothing here calls `investmentPropertyKeys`; the route does
 * both and passes the result down on the rows it applies to. A test enforces
 * that separation, because the guess this rule refuses to make is exactly the
 * one that would be easiest to add here later.
 */
export const INVESTMENT_PROPERTY_LOAS = ["Justin", "John", "Mateo"] as const;

/**
 * True since the transfer form began recording the answer in a form the app
 * composed itself, rather than in a sentence somebody typed.
 *
 * Kept as one switch in one file so the rule can be taken back off in one edit
 * if the question ever stops being asked, and so a test can pin what it means
 * in both positions rather than let it drift into decoration.
 */
export const INVESTMENT_PROPERTY_INPUT_AVAILABLE = true;

// ── inputs ──────────────────────────────────────────────────────────────────

/** A transfer lands on a loan officer, and sometimes on that LO's assistant. */
export type RecipientKind = "lo" | "loa";

/**
 * One possible destination for a transfer.
 *
 * Extends the TV's StarvedRow so the same rows can be fed to orderStarved
 * without a second shape to keep in sync.
 */
export interface RecipientRow extends StarvedRow {
  /** loan_officers.id or loan_officer_assistants.id, as the transfer rows carry it. */
  id: number | string;
  kind: RecipientKind;
  /**
   * Transfers received across the WHOLE window — the figure the TV's Starved
   * page shows. Per-transfer scoring walks backwards from it; see
   * `snapshotLoads`.
   */
  transfers: number;
  /**
   * Is this a real destination that is actually taking transfers? Required, not
   * optional, so a caller has to make the decision rather than inherit a
   * default — see SCORE_NON_RECEIVING_RECIPIENTS.
   */
  receiving: boolean;
}

/** One transfer, reduced to who made it, where it went, and when. */
export interface TransferRow {
  /** The CLR who made the transfer (lead_outcomes.assistant_id). */
  clrId: number | string;
  clrName?: string | null;
  loId?: number | string | null;
  loaId?: number | string | null;
  /**
   * When it landed — an ISO date or timestamp; only the date part is used.
   * System-written (created_at), never typed by a CLR. A transfer with no usable
   * date is judged against the END of the window instead of a day snapshot; see
   * `snapshotLoads`.
   */
  at?: string | null;
  /**
   * The recipients this CLR could LEGITIMATELY have chosen for this transfer —
   * `recipientKey` strings, typically the loan officers licensed in the
   * borrower's state.
   *
   * A CLR handed a lead in a state where every licensed LO is buried has no
   * discretion at all, and the app itself told them they picked correctly.
   * Scoring them against the whole floor marks them near zero for obeying it.
   *
   * Left out or empty means UNKNOWN, and unknown falls back to the whole pool —
   * never to an invented constraint. The CLR's row reports how many of their
   * transfers were scored that way (`unrestricted`) so the fallback is visible
   * rather than silent.
   */
  eligible?: Array<number | string> | null;
  /**
   * The recipients this transfer was FORCED to go to — a compliance rule, not a
   * choice. Same key format as `eligible`, and it wins over it ON THE AXIS IT
   * NAMES and only there.
   *
   * It PROTECTS the axis it forced and CHARGES a transfer that ignored it; a
   * row that records nothing on the axis it names is judged as the free
   * placement it looks like. What it never does is take the rest of the row out
   * of the reckoning: a set of assistants leaves the loan officer judged
   * exactly as an unconstrained transfer's would be. `constraintVerdict`
   * decides which reading applies, and what "protected" means is spelled out on
   * INVESTMENT_PROPERTY_LOAS.
   *
   * The route sets it for an investment property; see
   * INVESTMENT_PROPERTY_LOAS for where the fact comes from and why nothing in
   * this file reads it.
   */
  constrainedTo?: Array<number | string> | null;
}

export interface PriorityOptions {
  fullCreditLos?: number;
  fullCreditLoas?: number;
  flagPercentile?: number;
  scoreNonReceiving?: boolean;
  /** Overrides MIN_SCORED_TRANSFERS. */
  minScored?: number;
  /**
   * Restrict the pool to these `recipientKey` strings. This is how a per-transfer
   * eligible or constrained set is scored; unknown keys are ignored, and a set
   * that names nobody on the roster falls back to the whole pool.
   */
  poolKeys?: Array<number | string> | null;
  /**
   * Every CLR who should appear on the dashboard, including the ones who
   * transferred nobody this fortnight. Without it, only CLRs with at least one
   * transfer in the window get a row.
   */
  roster?: Array<{ clrId: number | string; name?: string | null }>;
}

// ── outputs ─────────────────────────────────────────────────────────────────

/** Why a recipient is worth what they are worth, for the tooltip. */
export type CreditBand =
  /** Among the lightest few actually taking work. */
  | "starved"
  /** At or below the line a needs_transfers flag pulled up. */
  | "flagged"
  /** On the ramp between the line and the busiest choice available. */
  | "ramp";

export interface RecipientCredit {
  /** `${kind}:${id}` — how transfers are matched to this row. */
  key: string;
  id: number | string;
  name: string;
  kind: RecipientKind;
  /** Transfers received as at the moment this credit describes. */
  transfers: number;
  /** 0-1. A transfer here is worth this much to the CLR who made it. */
  credit: number;
  band: CreditBand;
}

export interface ClrPriorityScore {
  clrId: number | string;
  name: string;
  /** Transfers made in the window. */
  transfers: number;
  /** How many landed on a destination this rule could read. */
  scored: number;
  /**
   * How many could not be read — no recipient on the row, a recipient who is no
   * longer on the roster, or one excluded by TRAP 2. They are NOT dropped; see
   * `unplacedValuedAt`.
   */
  unplaced: number;
  /** How many were scored against the whole floor because no eligible set came with them. */
  unrestricted: number;
  /**
   * How many had an axis scored against a forced set rather than a free choice.
   *
   * A forced set binds ONE axis, so a constrained row can still have a free one
   * — the loan officer, under the assistant rule — and that axis is judged
   * against the eligible set, or against the whole floor when none came with
   * the row. Those transfers are counted here rather than in `unrestricted`,
   * because the label says which rule was binding, not which pool every axis
   * happened to land in.
   */
  constrained: number;
  /**
   * How many landed OUTSIDE a set that was forced on them. Each one scored 0;
   * see the three cases on INVESTMENT_PROPERTY_LOAS. Kept on the row for the
   * same reason `unplaced` is: a verdict this sharp has to be countable.
   */
  breaches: number;
  /** The mean, 0-100 — or null when there is nothing at all to average. */
  pct: number | null;
  /** The same figure unrounded-ish (4dp), for sorting and for charts. */
  mean: number | null;
  /**
   * What each unreadable transfer was counted as: the mean credit of every
   * readable transfer the whole floor made in the window. Null when the floor
   * made none.
   */
  unplacedValuedAt: number | null;
  /**
   * Does this row have enough readable transfers to hold a league position?
   * Rows with `ranked: false` are a footnote under the table, NOT the bottom of
   * it — see MIN_SCORED_TRANSFERS and the sort at the end of this file.
   */
  ranked: boolean;
}

// ── small shared arithmetic ─────────────────────────────────────────────────

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** The same clamp compareStarved uses, so the two agree on what junk means. */
export function receivedCount(row: { transfers?: number | null }): number {
  const n = Math.round(Number(row?.transfers));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function recipientKey(kind: RecipientKind, id: number | string): string {
  return `${kind}:${String(id)}`;
}

/** Ids that name somebody. `0` is a real id; empty string, null and undefined are not. */
function hasId(id: number | string | null | undefined): id is number | string {
  return id !== null && id !== undefined && id !== "";
}

/**
 * Nearest-rank percentile: the value at position ceil(p x n) of the sorted list.
 *
 * No interpolation, deliberately. The cut has to be a load somebody on the floor
 * actually carries — "26, which is Carlton" is a sentence a manager can check,
 * "26.5" is not.
 *
 * A percentile that is not a number fails CLOSED (p = 0, the lightest value)
 * rather than returning `undefined` from a function typed `number`, which is
 * what the first version did and which would have crept into the credit
 * arithmetic as a silent NaN.
 */
export function percentileNearestRank(values: number[], p: number): number {
  const sorted = (values ?? []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const raw = Number(p);
  const pct = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  const rank = Math.ceil(pct * sorted.length);
  const value = sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
  return Number.isFinite(value) ? value : 0;
}

/**
 * The heaviest load a needs_transfers flag can still promote (TRAP 1).
 *
 * Computed over every eligible recipient of the kind INCLUDING the ones on
 * zero: a real loan officer who took nothing is still part of the floor this cut
 * measures, and leaving them out would judge "heaviest" against only the people
 * already being fed.
 */
export function flagPromotionCut(rows: RecipientRow[], percentile: number = FLAG_PROMOTION_PERCENTILE): number {
  return percentileNearestRank((rows ?? []).map(receivedCount), percentile);
}

/**
 * How many of the lightest sit at full credit, given how many there are to
 * choose from.
 *
 * The lightest quarter, never more than the cap, never fewer than one, and never
 * wider than the pool — because a band that swallows everybody scores everybody
 * the same and answers nothing. A cap of zero switches the band off entirely,
 * which is only ever useful in a test.
 */
export function fullCreditBandSize(poolSize: number, cap: number): number {
  const n = Math.max(0, Math.round(Number(poolSize)) || 0);
  const c = Math.max(0, Math.round(Number(cap)) || 0);
  if (!n || !c) return 0;
  return Math.min(c, n, Math.max(1, Math.ceil(n * FULL_CREDIT_SHARE)));
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Normalise a caller-supplied key list: strings, deduplicated, junk dropped. */
function keyList(keys: Array<number | string> | null | undefined): string[] {
  if (!Array.isArray(keys)) return [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (!hasId(k)) continue;
    seen.add(String(k));
  }
  return Array.from(seen);
}

/**
 * One row per recipient, keeping the heaviest reading of any duplicate.
 *
 * A fanned-out join used to be able to put the same loan officer in the pool
 * twice, which shifted the band edge by a person and made the ramp a step
 * shallower. Keeping the heaviest of the duplicates fails in the safe direction:
 * nobody gets to look starved because their row arrived twice.
 */
function dedupeRecipients(rows: RecipientRow[]): RecipientRow[] {
  const seen = new Map<string, RecipientRow>();
  for (const r of rows) {
    const key = recipientKey(r.kind, r.id);
    const prev = seen.get(key);
    if (!prev || receivedCount(r) > receivedCount(prev)) seen.set(key, r);
  }
  return Array.from(seen.values());
}

// ── what a transfer to each recipient is worth ──────────────────────────────

/**
 * Credit is a function of LOAD ALONE, and never increases with it.
 *
 * That invariant is the point of this shape. The first version promoted a
 * flagged loan officer straight to 1.0 and left everybody lighter on the ramp,
 * so choosing the genuinely lighter person could score strictly worse — a
 * perverse incentive hidden inside a fairness feature. Here there is a single
 * full-credit LINE:
 *
 *   line = max(load of the k-th lightest, load of the heaviest promotable flag)
 *
 * everyone at or below it is worth 1.0, and everyone above it ramps. Equal load
 * therefore always earns equal credit, and lighter always earns at least as
 * much, with no exceptions to remember.
 *
 * The ramp is the share of the ramp that was BUSIER than this recipient. Two
 * things follow. The busiest choice available is worth exactly 0, which a
 * straight interpolation on raw counts cannot do honestly with a 282-transfer
 * outlier in the pool — that would put Nathan Coutino (46) at 94% and separate
 * nobody. And the denominator is now PEOPLE rather than distinct load values,
 * which is what the first version used: two loan officers happening to land on
 * the same number is not a change in the world, and it should not silently
 * re-score everybody else.
 */
function creditsForKind(
  rows: RecipientRow[],
  capBandSize: number,
  percentile: number,
  scoreNonReceiving: boolean,
): RecipientCredit[] {
  const eligible = dedupeRecipients(rows.filter((r) => scoreNonReceiving || r.receiving === true));
  if (!eligible.length) return [];

  // Fewest received first, ties by name — the TV's rule, not a second copy.
  const ordered = orderStarved(eligible);
  const loads = ordered.map(receivedCount);

  const bandSize = fullCreditBandSize(ordered.length, capBandSize);
  const baseLine = bandSize > 0 ? loads[bandSize - 1] : -1;

  // ...plus the stated priorities, so long as they are not already well fed.
  const cut = flagPromotionCut(ordered, percentile);
  let flagLine = -1;
  ordered.forEach((r, i) => {
    if (r.needsTransfers === true && loads[i] <= cut) flagLine = Math.max(flagLine, loads[i]);
  });

  const fullLine = Math.max(baseLine, flagLine);
  const rampLoads = loads.filter((n) => n > fullLine);
  const rampSize = rampLoads.length;

  return ordered.map((r, i) => {
    const transfers = loads[i];
    const inBand = transfers <= fullLine;
    const busier = rampSize ? rampLoads.filter((n) => n > transfers).length : 0;
    const band: CreditBand = !inBand ? "ramp" : transfers <= baseLine ? "starved" : "flagged";
    return {
      key: recipientKey(r.kind, r.id),
      id: r.id,
      name: String(r.name ?? ""),
      kind: r.kind,
      transfers,
      credit: inBand ? 1 : round(busier / rampSize, 4),
      band,
    };
  });
}

/**
 * What a transfer to each recipient is worth, 0-1.
 *
 * Loan officers and assistants are scored inside their own pools. They are not
 * comparable: the heaviest LOA on prod took 54, which would be a quiet fortnight
 * for a loan officer, and one shared ramp would make every LOA look starved.
 *
 * Recipients excluded by TRAP 2 get no entry at all — not a zero. A transfer
 * that reaches only them cannot be read, and lands in `unplaced`.
 */
export function recipientCredits(rows: RecipientRow[], opts: PriorityOptions = {}): RecipientCredit[] {
  let list = (rows ?? []).filter((r) => r && (r.kind === "lo" || r.kind === "loa"));

  // A pool restriction that names nobody on the roster is treated as no
  // restriction at all: an eligibility list we cannot resolve is missing
  // information, and missing information must never become an invented cage.
  const pool = keyList(opts.poolKeys);
  if (pool.length) {
    const allowed = new Set(pool);
    const kept = list.filter((r) => allowed.has(recipientKey(r.kind, r.id)));
    if (kept.length) list = kept;
  }

  const percentile = Number.isFinite(Number(opts.flagPercentile))
    ? Number(opts.flagPercentile)
    : FLAG_PROMOTION_PERCENTILE;
  const scoreNonReceiving = opts.scoreNonReceiving ?? SCORE_NON_RECEIVING_RECIPIENTS;
  return [
    ...creditsForKind(
      list.filter((r) => r.kind === "lo"),
      positiveInt(opts.fullCreditLos, FULL_CREDIT_LOS),
      percentile,
      scoreNonReceiving,
    ),
    ...creditsForKind(
      list.filter((r) => r.kind === "loa"),
      positiveInt(opts.fullCreditLoas, FULL_CREDIT_LOAS),
      percentile,
      scoreNonReceiving,
    ),
  ];
}

/**
 * Credits keyed for lookup by `recipientKey`.
 *
 * A Map, not an object literal. `__proto__` arriving as an id used to write onto
 * Object.prototype instead of into the index, and no dashboard stat is worth
 * corrupting the runtime for.
 */
export function creditIndex(credits: RecipientCredit[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const c of credits ?? []) index.set(c.key, c.credit);
  return index;
}

/**
 * Which destination on the row this transfer is judged on.
 *
 * THE LOAN OFFICER IS THE DESTINATION. A transfer row names a loan officer and,
 * on roughly a third of real rows, that loan officer's assistant. The first
 * version took Math.max across the two, so a transfer into the busiest desk in
 * the company could score 100% because of who happened to be sitting next to
 * him — the headline safeguard bypassed on a third of the data, and the stat
 * partly measuring which LOs have their assistant field filled in. The assistant
 * on the row is an org-chart fact, not a place the CLR chose to send the lead.
 *
 * The assistant IS the destination when they are the only one named: an
 * LOA-only row is a real placement, and the LOA pool is scored for exactly
 * that. A compliance rule naming three assistants does NOT make the assistant
 * the destination — it narrows the pool the assistant is compared in, and the
 * loan officer on the row goes on being the destination. That is why the two
 * axes can be handed different pools: pass a function and each `kind` is looked
 * up in the index built for it. See `scoreTransferPriority`.
 */
export type CreditLookup = (kind: RecipientKind) => Map<string, number> | null | undefined;

export function transferCredit(row: TransferRow, index: Map<string, number> | CreditLookup): number | null {
  const indexFor: CreditLookup = typeof index === "function" ? index : () => index;
  const lookup = (kind: RecipientKind, id: number | string | null | undefined): number | null => {
    if (!hasId(id)) return null;
    const c = indexFor(kind)?.get(recipientKey(kind, id));
    return typeof c === "number" && Number.isFinite(c) ? c : null;
  };
  const lo = lookup("lo", row?.loId);
  return lo === null ? lookup("loa", row?.loaId) : lo;
}

// ── when the transfer happened, and what the floor looked like then ──────────

/** The date part of an ISO date or timestamp, or null when there isn't one. */
export function transferDay(at?: string | null): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(at ?? "").trim());
  return m ? m[1] : null;
}

/** Both destinations named on a row — both of their received counts include it. */
function destinationKeys(row: TransferRow): string[] {
  const keys: string[] = [];
  if (hasId(row?.loId)) keys.push(recipientKey("lo", row.loId));
  if (hasId(row?.loaId)) keys.push(recipientKey("loa", row.loaId));
  return keys;
}

/**
 * The floor as it stood at the START of each day in the window.
 *
 * ── WHAT "BEFORE" MEANS, AND WHY IT IS THE DAY ──────────────────────────────
 *
 * A transfer is judged on how starved the recipient was BEFORE it landed — the
 * state the CLR was actually looking at when they chose — and "before" is
 * resolved to the start of the DAY it was made. Every transfer made on the same
 * day sees the same floor.
 *
 * The alternatives are worse, each for a stated reason:
 *
 *   - END of the window (what this stat used to do) reads the CLR's own work
 *     back at them. Feed a starved loan officer all fortnight and he is not
 *     starved by the time the stat looks, so you score as though you had fed the
 *     busiest desk in the building. It paid for sending one lead each to the
 *     bottom five and never following up. This is the bug the rework exists for.
 *
 *   - EXACTLY before, transfer by transfer, needs an order the data cannot
 *     honestly supply. lead_outcomes carries a date, several land the same day,
 *     and whichever order the query happened to return would decide who got the
 *     100%. Two CLRs feeding the same starved LO within the same hour cannot see
 *     each other, so scoring them differently for it is noise dressed as a
 *     judgement.
 *
 * The day snapshot has the two properties that matter. It is NOT gameable by
 * ORDERING: permuting a day's transfers, or splitting one CLR's five into five
 * rows, changes nothing at all, because they all read the same snapshot. And it
 * makes REPEATEDLY FEEDING A STARVED LO SCORE WELL — the tenth lead you send
 * Derek today is worth exactly what the first was, so nobody is punished for
 * following through. Tomorrow's snapshot has seen all ten, and if he is
 * genuinely fed by then the eleventh is worth less, which is the honest answer
 * rather than a penalty: by then he is not the person who needs it most.
 *
 * The reconstruction runs backwards from the figure the TV shows. A recipient's
 * load at the start of the window is their end-of-window count minus the
 * transfers in this window that named them, and each day adds back the ones that
 * landed on the days before it. Clamped at zero, because the two inputs come
 * from two queries and a stat must not go negative when they disagree.
 *
 * THAT SUBTRACTION IS ONLY HONEST IF THE COUNT REACHES FURTHER BACK THAN THE
 * ROWS. Hand this the same window on both sides — every transfer in the range,
 * and each recipient counted over exactly that range — and the subtraction is
 * the whole count: everybody starts the window on nothing, the floor is flat on
 * day one, and the stat cannot tell the best placement from the worst. On the
 * dashboard's default "Today" that made a one-day window in which every CLR
 * scored 100%. The caller therefore counts recipients over a run-up as well as
 * the range (server/routes.ts uses `starvedWindowStart`, so the run-up is the
 * same fortnight the TV's Starved page measures), and what survives the
 * subtraction is the load each recipient was already carrying when the window
 * opened.
 *
 * A transfer with no usable date is judged against the END of the window
 * instead. That is the harshest reading available, and it is the only one that
 * is not exploitable — a missing date can then only ever cost credit, never earn
 * it. The date is written by the system, not typed by a CLR, so it is not a gap
 * anybody can be blamed for; on prod every row has one.
 */
export function snapshotLoads(
  transfers: TransferRow[],
  recipients: RecipientRow[],
): { days: string[]; loadAt: (key: string, dayIndex: number) => number } {
  const rows = (transfers ?? []).filter(Boolean);
  const days = Array.from(new Set(rows.map((t) => transferDay(t?.at)).filter((d): d is string => d !== null))).sort();
  const dayIndex = new Map(days.map((d, i) => [d, i] as const));

  const perDay = new Map<string, number[]>();
  const totals = new Map<string, number>();
  for (const t of rows) {
    const day = transferDay(t?.at);
    for (const key of destinationKeys(t)) {
      totals.set(key, (totals.get(key) ?? 0) + 1);
      if (day === null) continue;
      let counts = perDay.get(key);
      if (!counts) {
        counts = new Array(days.length).fill(0) as number[];
        perDay.set(key, counts);
      }
      counts[dayIndex.get(day) as number] += 1;
    }
  }

  const endLoad = new Map<string, number>();
  for (const r of recipients ?? []) {
    if (!r || (r.kind !== "lo" && r.kind !== "loa")) continue;
    const key = recipientKey(r.kind, r.id);
    endLoad.set(key, Math.max(endLoad.get(key) ?? 0, receivedCount(r)));
  }

  /*
   * Cumulative once, not re-walked per lookup.
   *
   * `before[i]` is everything that landed on this recipient BEFORE day i, so a
   * snapshot is a single array read. Summing the days on every call instead made
   * `loadAt` O(days), and the scan asks for one per recipient per day with a
   * transfer in it, which put the walk at O(days squared).
   *
   * WHAT THIS IS NOT is "the most expensive work on the manager-dashboard
   * endpoint", which is what this note used to claim. It is off by a factor of
   * roughly fifty: that endpoint runs a dozen scans over lead_outcomes for each
   * of ten windows, and the SQL either side of this module dwarfs anything in
   * it. Inside the module, the thing that actually holds the cost down is the
   * MEMO in `scoreTransferPriority` — `creditsFor` builds one credit table per
   * day per distinct pool instead of one per transfer, and each build is a sort
   * over a couple of dozen recipients — with the route's `placementCache` above
   * it keeping the whole scan off all but one request every two minutes. This
   * pass is a cheap constant-factor win worth keeping; it is not where the next
   * person should look for time.
   */
  const before = new Map<string, number[]>();
  perDay.forEach((counts, key) => {
    const run = new Array(counts.length + 1).fill(0) as number[];
    for (let d = 0; d < counts.length; d += 1) run[d + 1] = run[d] + counts[d];
    before.set(key, run);
  });

  const loadAt = (key: string, i: number): number => {
    const end = endLoad.get(key) ?? 0;
    // A negative index is "no usable date": the end of the window, as it stands.
    if (i < 0) return end;
    const start = Math.max(0, end - (totals.get(key) ?? 0));
    const run = before.get(key);
    return start + (run ? run[Math.min(i, run.length - 1)] : 0);
  };

  return { days, loadAt };
}

// ── the stat ────────────────────────────────────────────────────────────────

/** Which pool a transfer is judged against, and why. */
type PoolSource = "constrained" | "eligible" | "floor";

/**
 * The TWO pools a transfer can be judged in, resolved against the roster.
 *
 * `free` is the choice the CLR actually had — their eligible set, or an empty
 * list meaning the whole floor. `forced` is the set a compliance rule imposed
 * on one axis. They are not alternatives: a constrained row is judged in BOTH,
 * one axis in each, which is the difference between protecting the forced part
 * of a decision and excusing the whole of it.
 */
function poolsFor(row: TransferRow, known: Set<string>): { free: string[]; forced: string[] } {
  const free = keyList(row?.eligible).filter((k) => known.has(k));
  const forced = keyList(row?.constrainedTo).filter((k) => known.has(k));
  if (!forced.length) return { free, forced: [] };
  // Where eligibility is also known the two are intersected — nobody can be
  // asked to send to somebody unlicensed — but an empty intersection means the
  // two inputs disagree, and the compliance rule is the one that was actually
  // binding on the CLR.
  const both = free.length ? forced.filter((k) => free.includes(k)) : forced;
  return { free, forced: both.length ? both : forced };
}

/** The two axes a forced set can be written on. */
const RECIPIENT_KINDS: RecipientKind[] = ["lo", "loa"];

/** What a forced set has to say about one transfer. */
type ConstraintVerdict = "obeyed" | "breach" | "unreadable";

interface ConstraintReading {
  verdict: ConstraintVerdict;
  /**
   * The axes the set actually binds ON THIS ROW. Only these are scored inside
   * the forced set; everything else on the row stays a free choice. Empty
   * unless the verdict is `obeyed`, because nothing is protected otherwise.
   */
  bound: RecipientKind[];
}

/**
 * Can this forced set be read against this transfer at all, and what does it
 * say?
 *
 * A forced set is written on an AXIS — the investment rule names three
 * assistants, so it binds `loaId` and says nothing whatever about which loan
 * officer the row also carries. So the set is only applied to a transfer that
 * actually records a destination on that axis, and it is applied to THAT AXIS
 * ONLY:
 *
 *   - the destination is in the set → OBEYED. That axis is judged inside the
 *     set, protected; the axes the set does not name are judged as usual.
 *   - the destination is a roster name the set does not allow → BREACH. Scored
 *     0, because ignoring a compliance rule is not a forced choice and must not
 *     score better than an ordinary good placement.
 *   - nothing on the axis at all → UNREADABLE.
 *
 * ── WHAT AN INVESTMENT PROPERTY WITH NO loa_id MEANS ────────────────────────
 *
 * It means WE CANNOT TELL, and that is a different answer from "they broke the
 * rule". `loa_id` is filled on roughly a third of real transfer rows; a blank
 * one is overwhelmingly a field nobody wrote, not a lead that demonstrably went
 * somewhere it was not allowed. This file already refuses to read a missing
 * field as a verdict — see the UNPLACED note — and a compliance breach is the
 * sharpest verdict it can hand out, so it is the last one to hang off a blank.
 *
 * What "we cannot tell" must NOT mean is "no score". Dropping the rule and then
 * dropping the transfer with it is how answering "Investment/2nd Home: Yes"
 * came to ERASE a bad placement: the row went unreadable and was valued at the
 * floor mean, so a lead pushed onto the busiest desk in the building paid better
 * than the 0 it had earned. So the rule steps out of the way and the transfer is
 * judged as the placement the record does show — the free choice it looks like,
 * against the whole floor — and reported as unrestricted rather than
 * constrained, exactly as an unresolvable pool already is.
 *
 * ── AND WHY A BLANK BARELY MATTERS ANY MORE ─────────────────────────────────
 *
 * `loa_id` is optional, so whether the rule can be read at all comes down to
 * whether somebody used the picker. That decided a hundred points of score
 * while a constrained row was judged on the assistant alone: two CLRs doing the
 * identical, identically compliant thing came out 100% apart because one of
 * them filled a field in. A placement stat that swings on CRM hygiene is
 * measuring the wrong thing, and the completeness stat already charges for the
 * gap once.
 *
 * It cannot swing that way now. A row that names a loan officer is scored on
 * that loan officer whether the assistant is recorded or not — the forced axis
 * is protected when it is there and simply absent when it is not, and neither
 * reading touches the destination the score is taken from. So RECORDED and NOT
 * RECORDED are the same number for the same behaviour: no penalty for the gap,
 * and no windfall from it.
 *
 * The one place a recorded loa_id still changes the answer is a BREACH, and
 * that is evidence rather than hygiene: it takes a destination the rule
 * forbade, written by the system, to earn it. A blank is never read as one.
 *
 * An id nobody on the roster answers to is skipped rather than read as a
 * breach: it is one more thing we cannot resolve, not evidence.
 */
function constraintVerdict(row: TransferRow, keys: string[], known: Set<string>): ConstraintReading {
  const allowed = new Set(keys);
  const bound: RecipientKind[] = [];
  let obeyed = false;
  let recorded = false;
  for (const kind of RECIPIENT_KINDS) {
    // A set that names nobody of this kind does not bind this axis.
    if (!keys.some((k) => k.startsWith(`${kind}:`))) continue;
    const id = kind === "lo" ? row?.loId : row?.loaId;
    if (!hasId(id)) continue;
    const key = recipientKey(kind, id);
    if (!known.has(key)) continue;
    bound.push(kind);
    if (allowed.has(key)) obeyed = true;
    else recorded = true;
  }
  return obeyed ? { verdict: "obeyed", bound } : { verdict: recorded ? "breach" : "unreadable", bound: [] };
}

/**
 * A percentage per CLR: the mean of the transfers they made.
 *
 * ── UNPLACED: WHAT AN UNREADABLE RECORD IS WORTH ────────────────────────────
 *
 * A transfer whose destination this rule cannot read used to be dropped from the
 * denominator, which quietly PAID for a mis-filed record: the rows that could
 * not be read left the average alone, so a CLR's score was computed from a
 * hand-picked subset of their work. That pays in the opposite direction to the
 * write-up completeness stat, which charges for exactly the same gap.
 *
 * Scoring it 0 is not the answer either. 0 is a verdict — "you fed the busiest
 * desk in the building" — and a CRM field that never got written is not evidence
 * that anybody placed a lead badly.
 *
 * So an unreadable transfer is counted at the FLOOR MEAN: the average credit of
 * every readable transfer the whole floor made in the same window. It says the
 * only honest thing available, which is "this one looked like everybody else's".
 * It cannot be a reward, because a CLR placing better than the floor is pulled
 * down by it and nobody profits from a missing field. It cannot be an
 * accusation, because it is never 0 and a CLR placing worse than the floor is
 * pulled up. And the count stays on the row (`unplaced`, `unplacedValuedAt`) so
 * the dashboard can say "3 of 14 records could not be read" instead of hiding it
 * inside an average. The missing field is still charged exactly once, on the
 * completeness stat, where it belongs.
 *
 * A CLR with NOTHING readable scores null rather than the floor mean: with no
 * readable transfer at all there is nothing to say about them, and printing the
 * floor's average over an empty record would be a number about the floor wearing
 * their name.
 */
export function scoreTransferPriority(
  transfers: TransferRow[],
  recipients: RecipientRow[],
  opts: PriorityOptions = {},
): ClrPriorityScore[] {
  const pool = (recipients ?? []).filter((r) => r && (r.kind === "lo" || r.kind === "loa"));
  const { days, loadAt } = snapshotLoads(transfers ?? [], pool);
  const dayOf = new Map(days.map((d, i) => [d, i] as const));
  const known = new Set(pool.map((r) => recipientKey(r.kind, r.id)));

  // Credits cost a sort per pool and repeat hard: one snapshot per day per
  // distinct eligible set, not one per transfer.
  const cache = new Map<string, Map<string, number>>();
  const creditsFor = (dayIndex: number, keys: string[]): Map<string, number> => {
    const cacheKey = `${dayIndex} ${keys.length ? [...keys].sort().join("|") : "*"}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    // dayIndex -1 is "no usable date", and loadAt reads that as the end of the
    // window — the harshest snapshot, and the only one nobody can game.
    const rows = pool.map((r) => ({ ...r, transfers: loadAt(recipientKey(r.kind, r.id), dayIndex) }));
    const built = creditIndex(recipientCredits(rows, { ...opts, poolKeys: keys, roster: undefined }));
    cache.set(cacheKey, built);
    return built;
  };

  type Acc = {
    clrId: number | string;
    name: string;
    transfers: number;
    scored: number;
    unplaced: number;
    unrestricted: number;
    constrained: number;
    breaches: number;
    sum: number;
  };
  // A Map, not an object literal: a clrId of `__proto__` used to write onto
  // Object.prototype rather than into the accumulator.
  const acc = new Map<string, Acc>();
  const open = (clrId: number | string, name?: string | null): Acc => {
    const key = String(clrId);
    let row = acc.get(key);
    if (!row) {
      row = {
        clrId, name: String(name ?? clrId), transfers: 0, scored: 0,
        unplaced: 0, unrestricted: 0, constrained: 0, breaches: 0, sum: 0,
      };
      acc.set(key, row);
    }
    // A name on any row beats the id fallback.
    if (name && row.name === String(row.clrId)) row.name = String(name);
    return row;
  };

  // The roster first, so CLRs who transferred nobody still get a (null) row.
  for (const c of opts.roster ?? []) {
    if (c && hasId(c.clrId)) open(c.clrId, c.name);
  }

  for (const t of transfers ?? []) {
    // A transfer with no CLR on it is a data problem, not a phantom person.
    if (!t || !hasId(t.clrId)) continue;
    const row = open(t.clrId, t.clrName);
    row.transfers += 1;

    // The floor as it stood at the START of the day this transfer was made —
    // never as it stands now, which would read the CLR's own work back at them.
    // A row with no usable date has no snapshot to sit in front of, so it falls
    // to -1: the end of the window, the harshest reading, and the only one a
    // missing date cannot profit from. See `snapshotLoads`.
    const day = transferDay(t.at);
    const dayIndex = day === null ? -1 : dayOf.get(day) ?? -1;
    // A pool naming nobody on the roster is a list we cannot resolve, not a
    // constraint. It falls back to whatever IS resolvable — the eligible set if
    // one came with the row, the whole floor otherwise — and is reported as
    // such, so "scored against everybody" never hides behind a rule that never
    // applied.
    const { free, forced } = poolsFor(t, known);
    let source: PoolSource = forced.length ? "constrained" : free.length ? "eligible" : "floor";
    // A forced set only binds a transfer it can actually be read against, and
    // when it IS read it can say the CLR ignored it. See `constraintVerdict`.
    let breach = false;
    let bound: RecipientKind[] = [];
    if (source === "constrained") {
      const reading = constraintVerdict(t, forced, known);
      if (reading.verdict === "breach") breach = true;
      else if (reading.verdict === "unreadable") source = free.length ? "eligible" : "floor";
      else bound = reading.bound;
    }
    if (source === "constrained") row.constrained += 1;
    else if (source === "floor") row.unrestricted += 1;

    // ONE POOL PER AXIS, which is what keeps a compliance answer from washing
    // a placement out. The axis the rule forced is judged inside the forced set
    // — protected, never compared with a destination the rule forbade — and
    // every other axis is judged in the free pool exactly as it would have been
    // with no rule at all. `transferCredit` then picks the destination as it
    // always does: the loan officer, or the assistant when nobody else is
    // named. Both pools are memoised, and only the axis actually read is built.
    //
    // 0 without a lookup: a breach is a verdict on the rule, not a reading of
    // the pool, and the destination is not in that pool by definition.
    const credit = breach ? 0 : transferCredit(t, (kind) =>
      creditsFor(dayIndex, bound.includes(kind) ? forced : free));
    if (credit === null) row.unplaced += 1;
    else {
      row.scored += 1;
      row.sum += credit;
      if (breach) row.breaches += 1;
    }
  }

  const all = Array.from(acc.values());
  const readable = all.reduce((n, r) => n + r.scored, 0);
  const floorMean = readable ? all.reduce((n, r) => n + r.sum, 0) / readable : null;
  const minScored = positiveInt(opts.minScored, MIN_SCORED_TRANSFERS);

  const scores: ClrPriorityScore[] = all.map((r) => {
    const filler = floorMean ?? 0;
    const denom = r.scored + (floorMean === null ? 0 : r.unplaced);
    const mean = r.scored && denom ? (r.sum + r.unplaced * filler) / denom : null;
    return {
      clrId: r.clrId,
      name: r.name,
      transfers: r.transfers,
      scored: r.scored,
      unplaced: r.unplaced,
      unrestricted: r.unrestricted,
      constrained: r.constrained,
      breaches: r.breaches,
      pct: mean === null ? null : Math.round(mean * 100),
      mean: mean === null ? null : round(mean, 4),
      unplacedValuedAt: floorMean === null ? null : round(floorMean, 4),
      ranked: r.scored >= minScored,
    };
  });

  /*
   * Best placement first — and the rows without a real sample are not IN that
   * ranking, they are underneath it.
   *
   * The first version sorted a null BELOW a 0%, which re-imposed exactly the
   * accusation the null existed to avoid: the bottom of a league table reads as
   * worst on the floor, and "we have nothing to score" is not worse than "you
   * fed the busiest desk in the building". So `ranked` splits the list in two.
   * Above the split is the ranking. Below it come the provisional rows (too few
   * readable transfers, number still shown) and then the silent ones (nothing
   * readable at all, sorted by name, no number and no position). The dashboard
   * must render that tail as a footnote, not as places 7 through 12.
   */
  return scores.sort((a, b) => {
    if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
    if (a.mean === null || b.mean === null) {
      if (a.mean !== b.mean) return a.mean === null ? 1 : -1;
      return a.name.localeCompare(b.name) || String(a.clrId).localeCompare(String(b.clrId));
    }
    return (
      b.mean - a.mean ||
      b.scored - a.scored ||
      a.name.localeCompare(b.name) ||
      String(a.clrId).localeCompare(String(b.clrId))
    );
  });
}

// ── the compliance rule ─────────────────────────────────────────────────────

/**
 * The `constrainedTo` set for an investment property, resolved from the ROSTER.
 *
 * Names are matched against `loan_officer_assistants.name` — a roster field
 * somebody maintains — and never against stored text, which is where the guess
 * this stat must not make would live. Nothing in the SCORING path calls this:
 * the route calls it, decides per transfer whether the rule applies, and passes
 * the result down on the rows it applies to. A transfer that arrives without a
 * `constrainedTo` is judged as the free choice it was.
 */
export function investmentPropertyKeys(recipients: RecipientRow[]): string[] {
  const wanted = new Set(INVESTMENT_PROPERTY_LOAS.map((n) => n.toLowerCase()));
  const keys: string[] = [];
  for (const r of recipients ?? []) {
    if (!r || r.kind !== "loa") continue;
    const name = String(r.name ?? "").trim().toLowerCase();
    if (!name) continue;
    if (wanted.has(name) || wanted.has(name.split(/\s+/)[0])) keys.push(recipientKey(r.kind, r.id));
  }
  return keys;
}
