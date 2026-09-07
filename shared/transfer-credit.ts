/**
 * Who a transfer counts for, and how much of it.
 *
 * Almost every transfer counts once, for the CLR who made it. A transfer that
 * came off a SHOTGUN lead counts HALF for the CLR who published the lead and
 * HALF for the one who claimed it and got it over the line — Ethan's rule:
 * "if someone transfers off the shotgun, it counts as half a transfer for the
 * person who sent it and half a transfer for those who received it".
 *
 * It applies to EVERYTHING, pay included. A shotgun transfer is worth half a
 * transfer on the wall, half toward a goal, half toward the monthly tier, and
 * half the per-transfer rate — to each of the two people. The total the
 * company counts is unchanged: one transfer is still one transfer, it is just
 * shared. That is the whole point of the split, and it only works if every
 * surface agrees, which is why the rule lives here and not in 45 queries.
 *
 * WHY A COLUMN ON THE OUTCOME rather than a join to shotgun_leads: the count
 * queries are already the heaviest thing on several pages, and a transfer's
 * origin never changes after it is written. The shotgun result route stamps
 * it once, at the moment it creates the outcome.
 *
 * SAME PERSON, BOTH ENDS: when the publisher claims their own lead the sender
 * is NOT stamped, so it stays an ordinary whole transfer. Splitting somebody
 * with themselves sums back to one anyway; leaving it unstamped keeps the row
 * honest and the queries simple.
 */

/** An ordinary transfer, made by one person. */
export const FULL_TRANSFER_CREDIT = 1;

/** A shotgun transfer, to each of the two people. They sum to one. */
export const SHOTGUN_SENDER_CREDIT = 0.5;
export const SHOTGUN_CLAIMER_CREDIT = 0.5;

/** The column that marks a transfer as having come off a shotgun. */
export const SHOTGUN_SENDER_COLUMN = "shotgun_sender_id";

/**
 * The credit ONE named user earns from one outcome row, given the row.
 *
 * The pure form of the SQL below — same rule, so a caller working in
 * JavaScript cannot drift from a caller working in SQL.
 */
export function transferCreditFor(
  row: { assistantId?: unknown; assistant_id?: unknown; shotgunSenderId?: unknown; shotgun_sender_id?: unknown } | null | undefined,
  userId: number | string,
): number {
  if (!row) return 0;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const who = num(userId);
  if (!who) return 0;
  const maker = num(row.assistantId ?? row.assistant_id);
  const sender = num(row.shotgunSenderId ?? row.shotgun_sender_id);
  if (!sender) return maker === who ? FULL_TRANSFER_CREDIT : 0;
  // A shotgun transfer. The publisher and the claimer take half each; the
  // route never stamps a sender equal to the maker, but if some older row
  // carries one anyway, the two halves land on the same person and still
  // total a whole transfer rather than paying them twice.
  let credit = 0;
  if (maker === who) credit += SHOTGUN_CLAIMER_CREDIT;
  if (sender === who) credit += SHOTGUN_SENDER_CREDIT;
  return credit;
}

/**
 * One person's credit over a list of lead_outcomes rows.
 *
 * The JavaScript twin of `SUM(credit) ... WHERE user_id = ?` over
 * TRANSFER_CREDIT_SQL, and the only correct way to total a person from rows in
 * memory. It must be handed EVERY outcome in the window, not the ones bearing
 * that person's name: the shotgun half a publisher earned sits on a row whose
 * assistant_id is somebody else, so a list pre-filtered by assistant_id has
 * already thrown their half away.
 *
 * Non-transfer rows are ignored, so a caller can pass an unfiltered day.
 */
export function transferCreditIn(
  rows: ReadonlyArray<{ outcomeType?: unknown; outcome_type?: unknown } & Parameters<typeof transferCreditFor>[0]> | null | undefined,
  userId: number | string,
): number {
  let total = 0;
  for (const row of rows ?? []) {
    if (!row) continue;
    if (((row as any).outcomeType ?? (row as any).outcome_type) !== "transfer") continue;
    total += transferCreditFor(row, userId);
  }
  return total;
}

/**
 * Credit per user over a list of lead_outcomes rows, keyed by user id.
 *
 * Same contract as transferCreditIn: pass every outcome in the window. One
 * shotgun transfer contributes 0.5 to two different keys, so the map sums back
 * to the number of transfer rows and never to more.
 */
export function transferCreditByUser(
  rows: ReadonlyArray<any> | null | undefined,
): Map<number, number> {
  const out = new Map<number, number>();
  const add = (id: unknown, amount: number) => {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) return;
    out.set(n, (out.get(n) ?? 0) + amount);
  };
  for (const row of rows ?? []) {
    if (!row) continue;
    if ((row.outcomeType ?? row.outcome_type) !== "transfer") continue;
    const maker = row.assistantId ?? row.assistant_id;
    const sender = row.shotgunSenderId ?? row.shotgun_sender_id;
    const senderId = Number(sender);
    if (!Number.isFinite(senderId) || senderId <= 0) {
      add(maker, FULL_TRANSFER_CREDIT);
    } else {
      add(maker, SHOTGUN_CLAIMER_CREDIT);
      add(senderId, SHOTGUN_SENDER_CREDIT);
    }
  }
  return out;
}

/**
 * Every transfer, expanded into the rows it credits.
 *
 * One ordinary transfer yields one row worth 1. One shotgun transfer yields
 * TWO rows worth 0.5 — the claimer and the publisher. Join or count against
 * this instead of counting lead_outcomes directly, and a shotgun transfer
 * lands correctly everywhere without each query knowing the rule.
 *
 * Deliberately a string rather than a database VIEW: this repo builds its
 * schema from idempotent statements at boot, and a view that some deploys
 * have and others do not is a worse failure than a shared constant.
 */
export const TRANSFER_CREDIT_SQL = `
  SELECT o.id AS outcome_id, o.org_id AS org_id, o.date AS date,
         o.assistant_id AS user_id, o.lo_id AS lo_id, o.loa_id AS loa_id,
         CASE WHEN o.shotgun_sender_id IS NULL THEN ${FULL_TRANSFER_CREDIT} ELSE ${SHOTGUN_CLAIMER_CREDIT} END AS credit,
         0 AS is_shotgun_sender
    FROM lead_outcomes o
   WHERE o.outcome_type = 'transfer' AND o.assistant_id IS NOT NULL
  UNION ALL
  SELECT o.id, o.org_id, o.date,
         o.shotgun_sender_id, o.lo_id, o.loa_id,
         ${SHOTGUN_SENDER_CREDIT} AS credit,
         1 AS is_shotgun_sender
    FROM lead_outcomes o
   WHERE o.outcome_type = 'transfer' AND o.shotgun_sender_id IS NOT NULL
`;

/**
 * How a shared count should read on screen.
 *
 * A half never wants a trailing ".0", and "4.5" must not be rounded to 5 on a
 * leaderboard where somebody can count the rows themselves. So: whole numbers
 * print whole, halves print with one decimal, and nothing else can occur —
 * every credit is a multiple of a half.
 */
export function formatTransferCount(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Whether a shotgun result should stamp a sender at all.
 *
 * Three ways the answer is no:
 *
 *  1. The publisher claimed their own lead. See the SAME PERSON note at the
 *     top — one person did all of it, so it is one whole transfer.
 *  2. Either id is missing.
 *  3. THE PUBLISHER IS NOT A CLR. The split is between two CLRs sharing the
 *     work of one transfer. Managers and admins can always publish — that is
 *     what the Shotgun board is for — and they are not on transfer comp, so
 *     stamping them would take half the money off the CLR who made the call
 *     and hand it to a line item nobody pays. The CLR keeps the whole one.
 *
 * `publisherIsClr` is required rather than defaulted, so a new call site has
 * to decide rather than inherit the expensive answer by omission.
 */
export function shotgunSenderToStamp(
  publishedByUserId: unknown,
  claimedByUserId: unknown,
  publisherIsClr: unknown,
): number | null {
  const pub = Number(publishedByUserId);
  const claim = Number(claimedByUserId);
  if (!Number.isFinite(pub) || pub <= 0) return null;
  if (!Number.isFinite(claim) || claim <= 0) return null;
  if (pub === claim) return null;
  const isClr = publisherIsClr === true || publisherIsClr === 1 || publisherIsClr === "1";
  return isClr ? pub : null;
}
