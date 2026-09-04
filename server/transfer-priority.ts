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
 * ...with one exception, and it is FLAT rather than graded. A transfer the app
 * recorded as an investment property carried no placement decision at all: it
 * was required to reach one of three named assistants. It is worth 100% when
 * the record names one of them and 0% when it does not, however starved the
 * loan officer was that morning. See INVESTMENT_PROPERTY_LOAS.
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
 *   3. A FORCED ROUTE IS NOT A PLACEMENT DECISION — see
 *      `TransferRow.investmentProperty` and `resolveInvestmentRouting`.
 *      Following a routing requirement is correct behaviour and is worth 100%
 *      flat; ignoring it is worth 0 flat. How starved the desk was never
 *      enters into it, in either direction.
 *   4. THE LOAN OFFICER IS THE DESTINATION OF A PLACEMENT — see
 *      `transferCredit`. Every RAMPED transfer is scored on the loan officer
 *      and on nothing else. The assistant is read in exactly one place, the
 *      flat verdict above, because the routing rule names three assistants and
 *      the assistant recorded on the transfer is the only record that says
 *      whether one of them got it.
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

/**
 * The full-credit band as a SHARE of the pool, which is what makes the band
 * survive being handed three names instead of nineteen.
 *
 * "The lightest quarter" reproduces Ethan's number exactly on the prod floor —
 * ceil(19 x 0.25) = 5 loan officers — so nothing about the everyday reading of
 * the stat changes. What it adds is a sensible answer when a CLR is handed a
 * lead in a state with only three licensed loan officers: a fixed five would
 * put every one of them at 100% and measure nothing at all, while the
 * quarter-share puts one there and ramps the other two.
 *
 * The absolute constant above stays as the ceiling, so growing the floor from
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
 * Ethan's rule, verbatim: "any investment qualification yes should be 100 if
 * transfers to chris LOA justin, mateo, or john. 0 if anything else".
 *
 * ── WHAT THE INVESTMENT RULE IS, AND WHAT IT IS NOT ─────────────────────────
 *
 * A transfer the app recorded as "Investment/2nd Home: Yes" carried no
 * placement decision. It was required to reach one of the three assistants
 * named above, so it is not graded on how starved anybody was, and it is not
 * graded on anything else either:
 *
 *   FOLLOWED — the transfer records one of the three as its assistant. Exactly
 *     100%, flat, however busy that desk was that morning. This is the point of
 *     the rule rather than an exemption from it: obeying a forced routing
 *     requirement is the correct behaviour, and the stat has to say so.
 *   NOT FOLLOWED — anything else. A different assistant, no assistant recorded
 *     at all, a different loan officer: exactly 0%, flat. "Anything else" is
 *     the rule as it was given, and a blank is one of the things it names.
 *
 * "Chris's" is half of the rule, not decoration, and it is enforced. The three
 * are HIS assistants, so an assistant only counts when she is on that desk:
 * `resolveInvestmentRouting` resolves the desk from the three named assistants'
 * OWN parent loan officer — never by matching an officer's name — and admits
 * only the assistants who sit there. Another loan officer's Justin is not the
 * Justin the rule names, and a flagged transfer recording him scores 0 under
 * the same clause a blank does.
 *
 * The loan officer recorded ON THE TRANSFER is not a second gate on top of
 * that. The transfer form only offers the chosen officer's own assistants, so
 * naming an admitted assistant IS naming that desk; a flagged transfer sent to
 * a different loan officer carries a different assistant or none, and lands on
 * the 0 by the clause above rather than by a check on `loId`.
 *
 * An UNFLAGGED transfer knows nothing about any of this: it is scored by the
 * ordinary placement rules, on how starved the receiving loan officer was that
 * morning, exactly as it always was. Nothing about ordinary placement changes.
 *
 * ── THE ASSISTANT IS THE FACT THE RULE TURNS ON ─────────────────────────────
 *
 * The rule names three ASSISTANTS, so the assistant column decides it:
 * `TransferRow.loaId` carries the one the transfer recorded, and a flagged row
 * is compared against the ids those three names resolve to.
 *
 * It is read for FLAGGED ROWS AND NOTHING ELSE, and that boundary is what makes
 * reading it safe at all. The column is blank on roughly two thirds of real
 * transfers. Read on the ramp, it would separate CLRs by which of them used the
 * assistant picker — CRM hygiene printed as a placement judgement, and charged
 * for a second time by a stat that is not about paperwork. So it is not read
 * there: `destinationKey` and `transferCredit` see the loan officer alone, and
 * an unflagged transfer scores exactly the same whether the field was filled in
 * or left empty.
 *
 * On a flagged row the blank is not paperwork, it is the answer. The rule asks
 * which of three people took an investment lead, and a record naming nobody
 * does not say one of them did.
 *
 * The three are never resolved by matching their names against free text, and a
 * loan officer's NAME is never matched at all: there is a surname gate
 * elsewhere in this app, for LAP eligibility, and a stat that judges people is
 * the last place that pattern belongs. The names below are resolved against the
 * assistant ROSTER once per scan, and what the rule compares from then on is
 * ids.
 *
 * THAT RESOLUTION IS NOT RENAME-SAFE, and this file used to claim it was. The
 * roster's stabler handles — the row id and the parent desk — cannot be reached
 * from the words "Justin, Mateo or John" without matching a name somewhere, and
 * nobody has recorded the three ids anywhere this stat can read. So a recorded
 * first name is the only handle available for the three themselves, and it is
 * mutable: rename one of them past recognition and the roster stops answering.
 *
 * What that costs is bounded on purpose. The rule STOPS for everybody instead
 * of running on the two that still resolve, so a rename can only ever switch
 * the rule off, never turn it into a false accusation — and when it happens it
 * is counted, logged and shown rather than absorbed.
 *
 * The DESK half of the rule IS id-based, and does survive a rename: the desk is
 * whichever parent loan officer the three assistants' own roster rows point at,
 * so that officer can be renamed and the rule will not notice.
 *
 * ── WHEN A NAME DOES NOT RESOLVE TO ONE ASSISTANT ───────────────────────────
 *
 * `resolveInvestmentRouting` states what it does in every awkward case rather
 * than quietly taking the first row it finds, and it hands back a sentence
 * naming what failed so the route can log it and the cell can say it:
 *
 *   NOBODY — a name matches no assistant on the roster, because they left or
 *     because the spelling moved. The rule STOPS: null, applied to nobody, and
 *     every flagged transfer falls through to the ordinary placement its record
 *     shows. Running on two of the three instead would read every compliant
 *     transfer to the third as a flat zero — the sharpest verdict this file
 *     hands out, arrived at because somebody was renamed.
 *   TWO OR MORE ON THE SAME DESK — a name matches several of that officer's
 *     assistants, because a second Justin was hired onto it. All of them are
 *     admitted, so a transfer naming either scores 100. Choosing between them
 *     would be a guess, and a guess here can only fail in one of two
 *     directions: a wrong 100 costs nothing, while a wrong 0 accuses somebody
 *     of ignoring a routing rule they actually obeyed.
 *   ON SOMEBODY ELSE'S DESK — a name matches an assistant who does not sit at
 *     the desk the three share. She is simply not admitted and the rule runs on
 *     the rest, because another loan officer's Justin is a different person.
 *     That is the ordinary case rather than a failure.
 *   NO SHARED DESK, OR MORE THAN ONE — the three sit at no desk in common, or a
 *     full set of them sits at each of two desks, or one of them has no parent
 *     desk recorded at all. "Chris's" cannot then be resolved without picking a
 *     desk, so the rule STOPS for everybody rather than guess which was meant.
 *
 * A rule that stopped is never silent. The flagged transfers it did not judge
 * are counted on the CLR's row (`investmentUnscored`), the route logs the
 * sentence once per scan, and the dashboard shows those CLRs a dash and the
 * reason instead of a share that would be read as a verdict on their placement.
 *
 * ── WHY THIS IS NOW SWITCHED ON ─────────────────────────────────────────────
 *
 * The rule was built long before it could be used, because what was missing was
 * the FACT. `lead_goal` is empty on every transfer in production and
 * `lead_type` has two rows in total, so the only trace of an investment
 * property used to be free text somebody typed. A stat that judges people must
 * never hinge on finding a word in a sentence that might perfectly well be
 * denying it, so the rule stayed inert rather than guess.
 *
 * The fact now exists. The qualification question is asked on both capture
 * surfaces and the app composes the answer itself, and `isInvestmentProperty`
 * in @shared/transfer-completeness reads it the same strict way that file
 * already reads its section markers: the label at the start of a line, the
 * answer compared whole, everything else failing closed. A "No", a description,
 * and a missing answer all leave the transfer unflagged — the reading has to be
 * wrong in the harmless direction, because an invented flag would hand somebody
 * a flat 0 for a rule that never bound them.
 *
 * What has NOT changed is which file does that reading. Nothing here touches
 * stored text: the route reads the app's own answer and passes a boolean down
 * on the rows it applies to. A test enforces that separation, because the guess
 * this rule refuses to make is exactly the one that would be easiest to add
 * here later.
 */
export const INVESTMENT_PROPERTY_LOAS = ["Justin", "John", "Mateo"] as const;

/** What a transfer that obeyed the routing requirement is worth. Flat. */
export const INVESTMENT_FOLLOWED_CREDIT = 1;

/** What one that ignored it is worth. Flat, and the worst score there is. */
export const INVESTMENT_IGNORED_CREDIT = 0;

/**
 * True since the transfer form began recording the answer in a form the app
 * composed itself, rather than in a sentence somebody typed.
 *
 * Kept as one switch in one file so the rule can be taken back off in one edit
 * if the question ever stops being asked, and so a test can pin what it means
 * in both positions rather than let it drift into decoration. The route honours
 * it at the call site: with the switch off, no row is ever flagged.
 */
export const INVESTMENT_PROPERTY_INPUT_AVAILABLE = true;

// ── inputs ──────────────────────────────────────────────────────────────────

/**
 * The two kinds of row a roster carries.
 *
 * Only a loan officer is ever SCORED. An assistant row is on the roster for one
 * reason — its IDENTITY: the name, the id, and the desk it sits at — because
 * that is what resolves the investment rule, which names three of ONE loan
 * officer's assistants. Its own load is never read and it is never a
 * destination the ramp can score.
 */
export type RecipientKind = "lo" | "loa";

/**
 * One row of the roster.
 *
 * Extends the TV's StarvedRow so the same rows can be fed to orderStarved
 * without a second shape to keep in sync.
 */
export interface RecipientRow extends StarvedRow {
  /** loan_officers.id or loan_officer_assistants.id, as the roster carries it. */
  id: number | string;
  kind: RecipientKind;
  /**
   * On an ASSISTANT row, the loan officer whose desk she sits at
   * (loan_officer_assistants.lo_id). Meaningless on a loan officer's own row,
   * and never read there.
   *
   * This is what makes "Chris's Justin, Mateo or John" enforceable without
   * matching anybody's name: the desk the rule means is the one those three
   * roster rows point at, and an assistant on another officer's desk is a
   * different person however she is spelled. See `resolveInvestmentRouting`.
   */
  deskId?: number | string | null;
  /**
   * Transfers received across the WHOLE window — the figure the TV's Starved
   * page shows. Per-transfer scoring walks backwards from it; see
   * `snapshotLoads`. Read on a loan officer, and only on a loan officer.
   */
  transfers: number;
  /**
   * Is this a real destination that is actually taking transfers? Required, not
   * optional, so a caller has to make the decision rather than inherit a
   * default — see SCORE_NON_RECEIVING_RECIPIENTS. An assistant is not a
   * destination at all under this stat, so an assistant row is false.
   */
  receiving: boolean;
}

/** One transfer, reduced to who made it, where it went, and when. */
export interface TransferRow {
  /** The CLR who made the transfer (lead_outcomes.assistant_id). */
  clrId: number | string;
  clrName?: string | null;
  /**
   * The loan officer it landed on — the destination of a PLACEMENT, and the
   * only one. Every ramped transfer is scored on this and on nothing else.
   */
  loId?: number | string | null;
  /**
   * The assistant the transfer recorded (lead_outcomes.loa_id).
   *
   * Read on FLAGGED ROWS AND NOWHERE ELSE. The routing rule names three
   * assistants, so on an investment property this column is the compliance
   * fact: one of the three is 100%, anything else — a different assistant, a
   * blank — is 0%. On every other transfer it is not read at all, because it
   * is blank on two thirds of real rows and scoring it there would separate
   * CLRs by who used the assistant picker. See INVESTMENT_PROPERTY_LOAS.
   */
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
   * Did the app record this transfer as an investment property or second home?
   *
   * The FACT only, never the text it came from: the route reads the app's own
   * composed answer with `isInvestmentProperty` and passes the boolean down.
   * True means the transfer was required to reach one of the three named
   * assistants, and it is scored flat — 100% when `loaId` names one of them,
   * 0% when it does not. Anything else (false, null, absent) is an ordinary
   * transfer, scored on the floor as usual.
   */
  investmentProperty?: boolean | null;
}

export interface PriorityOptions {
  fullCreditLos?: number;
  flagPercentile?: number;
  scoreNonReceiving?: boolean;
  /** Overrides MIN_SCORED_TRANSFERS. */
  minScored?: number;
  /**
   * Restrict the pool to these `recipientKey` strings. This is how a per-transfer
   * eligible set is scored; unknown keys are ignored, and a set that names
   * nobody on the roster falls back to the whole pool.
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
  /** `lo:${id}` — how transfers are matched to this row. */
  key: string;
  id: number | string;
  name: string;
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
   * How many could not be read — no loan officer on the row, one who is no
   * longer on the roster, or one excluded by TRAP 2. They are NOT dropped; see
   * `unplacedValuedAt`.
   */
  unplaced: number;
  /** How many were scored against the whole floor because no eligible set came with them. */
  unrestricted: number;
  /**
   * How many were judged by the investment routing rule instead of by the ramp
   * — flagged rows, whenever the roster could resolve the three names. Each one
   * scored exactly 100% or exactly 0%, and none of them was compared with the
   * floor at all.
   */
  investment: number;
  /**
   * How many flagged transfers the routing rule did NOT judge, because the
   * roster could not resolve it — see `resolveInvestmentRouting`. They were
   * read as ordinary placement instead, which is the only honest fallback and
   * also a misleading one: a CLR who obeyed the rule perfectly sent every one
   * of these onto the busiest desk on the floor, and ordinary placement scores
   * that 0. So this count is carried out to the dashboard, which shows those
   * CLRs a dash and the reason rather than a percentage they did not earn.
   */
  investmentUnscored: number;
  /**
   * How many of those recorded somebody other than the three, or nobody at all.
   * Each one scored exactly 0.
   *
   * These two counters are what makes a 0% READABLE, so they are carried all
   * the way to the cell rather than computed and dropped. "0%, and eleven of
   * your twelve transfers broke the investment routing rule" and "0%, you fed
   * the busiest desk in the building" are very different accusations, and a
   * manager looking at the number cannot tell them apart without this. The same
   * goes in the other direction: a 100% earned by following the routing rule is
   * not the same achievement as a 100% earned by feeding the starved.
   */
  breaches: number;
  /** The mean, 0-100 — or null when there is nothing at all to average. */
  pct: number | null;
  /** The same figure unrounded-ish (4dp), for sorting and for charts. */
  mean: number | null;
  /**
   * What each unreadable transfer was counted as: the mean credit of every
   * ORDINARY readable transfer the whole floor made in the window. Null when
   * the floor made none.
   *
   * Ordinary only, and that word is load-bearing. The flat routing verdicts are
   * 0 and 1 with nothing in between, and mixing them in made one CLR's score
   * move on other people's compliance: a fortnight in which the floor's
   * investment transfers happened to be breaches dragged this filler down by
   * tens of points, and every CLR with an unreadable record was re-scored for
   * something they had no part in. A transfer whose destination cannot be read
   * is valued from placement, because placement is what it failed to record.
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
 * Computed over every eligible recipient INCLUDING the ones on zero: a real loan
 * officer who took nothing is still part of the floor this cut measures, and
 * leaving them out would judge "heaviest" against only the people already being
 * fed.
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

// ── what a transfer to each loan officer is worth ───────────────────────────

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
 *
 * ONE POOL, because there is one kind of destination. Assistants used to be
 * ranked in a pool of their own so that an assistant-only row could be scored;
 * no row is ever scored on an assistant now, so an assistant is not a recipient
 * here at all. See INVESTMENT_PROPERTY_LOAS.
 *
 * Recipients excluded by TRAP 2 get no entry at all — not a zero. A transfer
 * that reaches only them cannot be read, and lands in `unplaced`.
 */
export function recipientCredits(rows: RecipientRow[], opts: PriorityOptions = {}): RecipientCredit[] {
  let list = (rows ?? []).filter((r) => r && r.kind === "lo");

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
  const eligible = dedupeRecipients(list.filter((r) => scoreNonReceiving || r.receiving === true));
  if (!eligible.length) return [];

  // Fewest received first, ties by name — the TV's rule, not a second copy.
  const ordered = orderStarved(eligible);
  const loads = ordered.map(receivedCount);

  const bandSize = fullCreditBandSize(ordered.length, positiveInt(opts.fullCreditLos, FULL_CREDIT_LOS));
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
      transfers,
      credit: inBand ? 1 : round(busier / rampSize, 4),
      band,
    };
  });
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
 * THE LOAN OFFICER IS THE DESTINATION OF A PLACEMENT, and he is the only one.
 *
 * A transfer row names a loan officer and, on roughly a third of real rows, that
 * loan officer's assistant. The first version took Math.max across the two, so a
 * transfer into the busiest desk in the company could score 100% because of who
 * happened to be sitting next to him — the headline safeguard bypassed on a
 * third of the data, and the stat partly measuring which LOs have their
 * assistant field filled in.
 *
 * So the assistant is not read HERE, on the ramp, in any form. The form only
 * offers the chosen loan officer's own assistants, so on an ordinary transfer
 * the field carries no decision to score, and two thirds of real rows leave it
 * blank; reading it on the ramp could only ever separate CLRs by CRM hygiene,
 * which the write-up completeness stat already charges for exactly once.
 *
 * The one place it IS read is the flat investment verdict in
 * `scoreTransferPriority`, where the routing rule names three assistants and
 * the column is the only record of whether one of them got the lead. See
 * INVESTMENT_PROPERTY_LOAS.
 */
function destinationKey(row: TransferRow): string | null {
  return hasId(row?.loId) ? recipientKey("lo", row.loId) : null;
}

export function transferCredit(row: TransferRow, index: Map<string, number>): number | null {
  const key = destinationKey(row);
  if (key === null) return null;
  const c = index?.get(key);
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

// ── the routing requirement, resolved from the roster ────────────────────────

/** "Justin", "Justin and Mateo", "Justin, John and Mateo". */
function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the roster was able to say about the routing requirement. */
export interface InvestmentRouting {
  /**
   * The assistants the rule admits, as `recipientKey` strings — or null when
   * the roster cannot answer the question, in which case the rule runs against
   * nobody at all and every flagged transfer is read as ordinary placement.
   */
  keys: Set<string> | null;
  /**
   * The `recipientKey` of the loan officer whose desk those three sit at — the
   * "Chris's" in the rule, resolved from THEIR rows and never from his name.
   * Null whenever `keys` is.
   */
  desk: string | null;
  /**
   * Null when the rule resolved. Otherwise one sentence saying what failed and
   * naming who it failed on, because "the rule stopped" is useless to whoever
   * has to fix it without "and here is which name did not answer". The route
   * logs it once per scan and the cell says it, since a compliance rule that
   * quietly stops running is exactly the kind of thing nobody notices.
   */
  problem: string | null;
}

/**
 * The routing requirement, resolved from the roster: which assistants an
 * investment property was required to reach, and whose desk they sit at.
 *
 * The names in INVESTMENT_PROPERTY_LOAS are resolved against the assistant
 * ROSTER once per scan, and what comes back is a set of ids. Nothing downstream
 * ever compares a name again: a flagged transfer is judged by whether its
 * `loa_id` is in this set.
 *
 * THE DESK IS PART OF THE ANSWER, because the rule is "CHRIS'S Justin, Mateo or
 * John" and other loan officers have a Justin too. The desk is resolved from
 * the three named assistants' own parent rows — the one desk all three of them
 * sit at — and only assistants on that desk are admitted. A loan officer's NAME
 * is never read to get there, here or anywhere else in this file: there is a
 * surname gate elsewhere in this app, for LAP eligibility, and a stat that
 * judges people cannot hang a hundred points on somebody's surname surviving a
 * rename. Because the desk is an id, the officer can be renamed freely.
 *
 * The three assistants themselves are matched on their recorded first name,
 * which is mutable, and that is stated rather than papered over — see the
 * rename section on INVESTMENT_PROPERTY_LOAS. Every way this can fail to
 * resolve is decided out loud below rather than by taking the first row that
 * matches, and every one of them STOPS the rule for everybody instead of
 * running it on part of the roster, because a rule running on two names out of
 * three reads the third's compliant transfers as flat zeroes.
 */
export function resolveInvestmentRouting(recipients: RecipientRow[]): InvestmentRouting {
  const stopped = (problem: string): InvestmentRouting => ({ keys: null, desk: null, problem });
  // Only assistants, and only ones with an id a transfer could name.
  const rows = (recipients ?? []).filter((r) => r && r.kind === "loa" && hasId(r.id));
  const sought = INVESTMENT_PROPERTY_LOAS.map((named) => {
    const first = named.toLowerCase();
    // Their full name, or the first word of it: "Justin" and "Justin Alvarez"
    // are the same person, and the roster carries whichever HR typed.
    const matches = rows.filter((r) => {
      const name = String(r.name ?? "").trim().toLowerCase();
      return name === first || name.split(/\s+/)[0] === first;
    });
    const desks = matches.filter((r) => hasId(r.deskId)).map((r) => recipientKey("lo", r.deskId as number | string));
    return { named, matches, desks: Array.from(new Set(desks)) };
  });

  const missing = sought.filter((s) => !s.matches.length).map((s) => s.named);
  if (missing.length) return stopped(`the roster has no active assistant named ${andList(missing)}`);

  const deskless = sought.filter((s) => !s.desks.length).map((s) => s.named);
  if (deskless.length) return stopped(`the roster records no loan officer's desk for ${andList(deskless)}`);

  const everyone = andList(INVESTMENT_PROPERTY_LOAS as readonly string[]);
  // The one desk all three answer to. Their own rows decide it; nobody's name does.
  const shared = sought[0].desks.filter((d) => sought.every((s) => s.desks.indexOf(d) >= 0));
  if (!shared.length) return stopped(`${everyone} do not all sit at one loan officer's desk`);
  if (shared.length > 1) {
    return stopped(`${everyone} sit together at ${shared.length} different loan officers' desks,`
      + ` so which desk the rule means cannot be told from the roster`);
  }

  const desk = shared[0];
  const keys = new Set<string>();
  for (const s of sought) {
    for (const r of s.matches) {
      // An assistant of the same name on ANOTHER officer's desk is a different
      // person, and admitting her would widen the rule past what it says.
      if (hasId(r.deskId) && recipientKey("lo", r.deskId) === desk) keys.add(recipientKey("loa", r.id));
    }
  }
  return { keys, desk, problem: null };
}

/**
 * Just the admitted assistants, for callers that only need the comparison set.
 * Null carries the same meaning it does above: the rule could not be resolved,
 * so it is applied to nobody. `resolveInvestmentRouting` says why.
 */
export function investmentAssistantKeys(recipients: RecipientRow[]): Set<string> | null {
  return resolveInvestmentRouting(recipients).keys;
}

// ── when the transfer happened, and what the floor looked like then ──────────

/** The date part of an ISO date or timestamp, or null when there isn't one. */
export function transferDay(at?: string | null): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(at ?? "").trim());
  return m ? m[1] : null;
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
    const key = destinationKey(t);
    if (key === null) continue;
    totals.set(key, (totals.get(key) ?? 0) + 1);
    const day = transferDay(t?.at);
    if (day === null) continue;
    let counts = perDay.get(key);
    if (!counts) {
      counts = new Array(days.length).fill(0) as number[];
      perDay.set(key, counts);
    }
    counts[dayIndex.get(day) as number] += 1;
  }

  const endLoad = new Map<string, number>();
  for (const r of recipients ?? []) {
    if (!r || r.kind !== "lo") continue;
    const key = recipientKey("lo", r.id);
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
 * every ORDINARY readable transfer the whole floor made in the same window. It
 * says the only honest thing available, which is "this one looked like
 * everybody else's".
 *
 * ORDINARY, because the flat routing verdicts have no business valuing a
 * placement. They are 0 or 1 with nothing between, and folding them in made one
 * CLR's score move on other people's compliance: the same unreadable record was
 * worth tens of points more in a fortnight where the floor's investment
 * transfers happened to obey the rule than in one where they did not, though
 * nothing about the CLR's own work had changed. The filler is now derived from
 * ramped transfers alone, so an unreadable ordinary transfer is valued only
 * from ordinary placement — and when the floor made none, there is no filler
 * and the unreadable rows stay out of the denominator.
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
 *
 * A FLAGGED transfer is the one exception, and it is Ethan's, twice affirmed
 * with the gaming risk in front of him: "0 if anything else". On an investment
 * property the assistant is not a field somebody forgot to fill in, it is the
 * answer to the only question the rule asks, so a blank one scores 0 and is
 * counted as a breach rather than valued at the floor mean. The loan officer on
 * such a row is not consulted at all — see the forced-route branch below.
 */
export function scoreTransferPriority(
  transfers: TransferRow[],
  recipients: RecipientRow[],
  opts: PriorityOptions = {},
): ClrPriorityScore[] {
  const roster = (recipients ?? []).filter((r) => r && (r.kind === "lo" || r.kind === "loa"));
  const officers = roster.filter((r) => r.kind === "lo");
  const { days, loadAt } = snapshotLoads(transfers ?? [], officers);
  const dayOf = new Map(days.map((d, i) => [d, i] as const));
  // Every loan officer the roster answers to, which is what an eligible set is
  // resolved against.
  const known = new Set(officers.map((r) => recipientKey("lo", r.id)));
  // The assistants an investment property was required to reach — the three
  // named, narrowed to the desk they share — resolved once for the whole scan.
  // Null means the roster cannot answer that today, and a rule nobody can
  // resolve is not applied to anybody. Flagged rows are still COUNTED in that
  // case (`investmentUnscored`), so the silence is visible downstream.
  const allowed = resolveInvestmentRouting(roster).keys;

  // Credits cost a sort per pool and repeat hard: one snapshot per day per
  // distinct eligible set, not one per transfer.
  const cache = new Map<string, Map<string, number>>();
  const creditsFor = (dayIndex: number, keys: string[]): Map<string, number> => {
    const cacheKey = `${dayIndex} ${keys.length ? [...keys].sort().join("|") : "*"}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    // dayIndex -1 is "no usable date", and loadAt reads that as the end of the
    // window — the harshest snapshot, and the only one nobody can game.
    const rows = officers.map((r) => ({ ...r, transfers: loadAt(recipientKey("lo", r.id), dayIndex) }));
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
    investment: number;
    investmentUnscored: number;
    breaches: number;
    sum: number;
    /**
     * The ramped half of `sum`, and how many transfers it came from. Kept apart
     * so the floor mean below is built from ordinary placement alone: a flat
     * routing verdict must never move what somebody else's unreadable record is
     * worth.
     */
    rampSum: number;
    rampScored: number;
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
        unplaced: 0, unrestricted: 0, investment: 0, investmentUnscored: 0,
        breaches: 0, sum: 0, rampSum: 0, rampScored: 0,
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

    /*
     * THE FORCED ROUTE, AND IT IS FLAT.
     *
     * An investment property had three allowed destinations and the CLR made no
     * placement decision, so there is nothing here to grade: it is worth
     * everything if one of the three is on the record and nothing if not. No
     * snapshot is taken, no pool is built and the eligible set is not consulted,
     * because none of them has anything to say about a decision nobody made.
     *
     * The record that decides is the ASSISTANT, and a blank one is a 0 rather
     * than a data gap. That is deliberate and it is the sharp edge of this rule:
     * everywhere else in this file a missing field is read as "we cannot say"
     * and valued at the floor mean, but the rule asks which of three people took
     * an investment lead and a row naming nobody does not say one of them did.
     * The loan officer is not consulted either way — naming one of the three IS
     * naming that desk, so a flagged transfer sent elsewhere carries a different
     * assistant or none and lands on the 0 below by the same clause.
     *
     * The ONE thing that can stop the rule is the roster failing to resolve the
     * three names and their desk, which is a fact about the roster rather than
     * about anybody's work. That falls through to the ordinary reading below —
     * and is counted on the way past, because falling through is not harmless:
     * the desk these transfers were required to reach is the busiest on the
     * floor, so ordinary placement scores perfect compliance as 0.
     */
    if (t.investmentProperty === true && allowed === null) row.investmentUnscored += 1;
    if (t.investmentProperty === true && allowed !== null) {
      row.investment += 1;
      row.scored += 1;
      const recorded = hasId(t.loaId) ? recipientKey("loa", t.loaId) : null;
      if (recorded !== null && allowed.has(recorded)) row.sum += INVESTMENT_FOLLOWED_CREDIT;
      else {
        row.sum += INVESTMENT_IGNORED_CREDIT;
        row.breaches += 1;
      }
      continue;
    }

    // The floor as it stood at the START of the day this transfer was made —
    // never as it stands now, which would read the CLR's own work back at them.
    // A row with no usable date has no snapshot to sit in front of, so it falls
    // to -1: the end of the window, the harshest reading, and the only one a
    // missing date cannot profit from. See `snapshotLoads`.
    const day = transferDay(t.at);
    const dayIndex = day === null ? -1 : dayOf.get(day) ?? -1;
    // A pool naming nobody on the roster is a list we cannot resolve, not a
    // constraint. It falls back to the whole floor and is reported as such, so
    // "scored against everybody" never hides behind a rule that never applied.
    const free = keyList(t.eligible).filter((k) => known.has(k));
    if (!free.length) row.unrestricted += 1;

    const credit = transferCredit(t, creditsFor(dayIndex, free));
    if (credit === null) row.unplaced += 1;
    else {
      row.scored += 1;
      row.sum += credit;
      row.rampScored += 1;
      row.rampSum += credit;
    }
  }

  const all = Array.from(acc.values());
  // ORDINARY placement only. The flat routing verdicts are deliberately left
  // out of this: they are 0 or 1 with nothing between, and letting them value
  // an unreadable record moved a CLR's score on OTHER people's compliance. See
  // `unplacedValuedAt`.
  const ramped = all.reduce((n, r) => n + r.rampScored, 0);
  const floorMean = ramped ? all.reduce((n, r) => n + r.rampSum, 0) / ramped : null;
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
      investment: r.investment,
      investmentUnscored: r.investmentUnscored,
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
