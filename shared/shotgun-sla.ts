/**
 * Shotgun / fresh-lead speed scoreboard math (pure).
 *
 * Ethan 20 Sep 2026: unclaimed and claimed are DIFFERENT categories — never
 * blend them into one "% claimed under 30s" that hides still-open leads.
 * Claim-time statistics include unclaimed leads / expired CLR offers at four
 * minutes each. Claimed leads retain their actual time, even above four minutes.
 * Dial SLA remains among claimed only.
 *
 * Claim clock: lead created_at → claimed_at (first Shotgun confirm / reclaim).
 * Dial clock: claimed_at → first_dial_at when we have real dial evidence.
 *
 * Dial evidence preference (see server/shotgun-sla.ts):
 *   1. shotgun_leads.first_dial_at (open-phone / Dialpad launch recorded)
 *   2. earliest matching bonzo_call_events after claim (same CLR + phone)
 * Write-up `called=1` / done_at is NOT used as dial time — that is vanity.
 */

export const SHOTGUN_DIAL_SLA_MS = 60_000;
export const SHOTGUN_UNCLAIMED_CLAIM_SECONDS = 4 * 60;

export type ShotgunSlaLeadRow = {
  /** Lead entered Shotgun (or was created). */
  createdAt: string;
  /** Null while still queued/offered/cancelled without a claim. */
  claimedAt: string | null;
  status: string;
  /**
   * Best-effort first dial after claim. Null means we have no dial evidence
   * yet — counted as NOT dialed-under-60s, not as unknown excluded.
   */
  firstDialAt: string | null;
  /** When set, this CLR's claim is excluded from org scoreboard (exclude_from_stats). */
  claimantExcluded?: boolean;
};

export type ShotgunSlaSummary = {
  /** Leads in scope (org, window). */
  total: number;
  claimed: number;
  /** Still open in rotation (queued / offered) or never claimed. */
  unclaimed: number;
  /** claimed / total, or null when total is 0. */
  claimedPct: number | null;
  unclaimedPct: number | null;
  /** Actual created → claimed seconds, plus 240 seconds per unclaimed lead. */
  medianClaimSeconds: number | null;
  averageClaimSeconds: number | null;
  /** Among claimed: share with dial evidence within 60s of claim. */
  dialedUnder60sCount: number;
  dialedUnder60sPct: number | null;
  /** Claimed leads that still have no dial evidence at all. */
  claimedWithoutDialEvidence: number;
};

function parseMs(iso: string | null | undefined): number | null {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? t : null;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build the org scoreboard from lead rows already filtered to the window.
 * Rows whose claimant is exclude_from_stats are dropped from claim/dial math
 * but still count toward unclaimed when they were never claimed by anyone.
 */
export function summarizeShotgunSla(rows: ShotgunSlaLeadRow[]): ShotgunSlaSummary {
  const inScope = rows.filter((r) => {
    // Cancelled-before-claim and cancelled-after are still "leads that entered";
    // only exclude claimants flagged out of stats from claimed metrics.
    return true;
  });
  const total = inScope.length;
  const claimSeconds: number[] = [];
  let claimed = 0;
  let unclaimed = 0;
  let dialedUnder60sCount = 0;
  let claimedWithoutDialEvidence = 0;

  for (const row of inScope) {
    const created = parseMs(row.createdAt);
    const claimedAt = parseMs(row.claimedAt);
    // Claimed vs unclaimed are separate categories — keyed off claimed_at,
    // not a blended "% under 30s" that hides still-open leads.
    const hasClaim = claimedAt != null;

    if (!hasClaim) {
      unclaimed += 1;
      claimSeconds.push(SHOTGUN_UNCLAIMED_CLAIM_SECONDS);
      continue;
    }
    if (row.claimantExcluded) {
      // Claimed by an excluded person: do not mix into speed/dial, and do not
      // count as org "unclaimed" either — it was taken.
      continue;
    }
    claimed += 1;
    if (created != null && claimedAt! >= created) {
      claimSeconds.push((claimedAt! - created) / 1000);
    }
    const dialAt = parseMs(row.firstDialAt);
    if (dialAt == null) {
      claimedWithoutDialEvidence += 1;
      continue;
    }
    if (dialAt - claimedAt! <= SHOTGUN_DIAL_SLA_MS && dialAt >= claimedAt!) {
      dialedUnder60sCount += 1;
    }
  }

  // Leads claimed only by excluded users were skipped entirely — adjust total
  // display: total stays as input length; claimed/unclaimed as computed.
  const denom = claimed + unclaimed;
  const claimedPct = denom > 0 ? Math.round((claimed / denom) * 1000) / 10 : null;
  const unclaimedPct = denom > 0 ? Math.round((unclaimed / denom) * 1000) / 10 : null;
  const sorted = [...claimSeconds].sort((a, b) => a - b);
  const med = median(sorted);
  const avg = average(claimSeconds);

  return {
    total,
    claimed,
    unclaimed,
    claimedPct,
    unclaimedPct,
    medianClaimSeconds: med == null ? null : round1(med),
    averageClaimSeconds: avg == null ? null : round1(avg),
    dialedUnder60sCount,
    dialedUnder60sPct: claimed > 0 ? Math.round((dialedUnder60sCount / claimed) * 1000) / 10 : null,
    claimedWithoutDialEvidence,
  };
}

/** Format seconds for the scoreboard tiles (e.g. 12.5s or 1m 05s). */
export function formatSlaSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${round1(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}


/** Per-CLR scorecard SLA row (Transfer Scorecard columns). */
export type ShotgunSlaClrSummary = {
  claimed: number;
  /** Offers that timed out on this CLR (expired) — separate from claimed. */
  unclaimed: number;
  claimedPct: number | null;
  unclaimedPct: number | null;
  /** Actual claim times plus 240 seconds per expired offer attributed to this CLR. */
  medianClaimSeconds: number | null;
  averageClaimSeconds: number | null;
  dialedUnder60sCount: number;
  dialedUnder60sPct: number | null;
};

export type ShotgunSlaClrLeadRow = ShotgunSlaLeadRow & {
  /** First confirmer / reclaimer; null while unclaimed. */
  claimantId: number | null;
};

/**
 * Per-CLR SLA from the same lead universe as the org scoreboard.
 * Claimed: attributed to the claimant. Unclaimed (expired offers): attributed
 * to each CLR whose offer timed out. Counts stay separate; each expired offer
 * contributes four minutes to median/average claim time, never to dial SLA.
 */
export function summarizeShotgunSlaByClr(
  leads: ShotgunSlaClrLeadRow[],
  expiredOfferUserIds: number[],
): Map<number, ShotgunSlaClrSummary> {
  type Bucket = {
    claimSeconds: number[];
    claimed: number;
    unclaimed: number;
    dialedUnder60s: number;
  };
  const buckets = new Map<number, Bucket>();
  const bump = (uid: number): Bucket => {
    let b = buckets.get(uid);
    if (!b) {
      b = { claimSeconds: [], claimed: 0, unclaimed: 0, dialedUnder60s: 0 };
      buckets.set(uid, b);
    }
    return b;
  };

  for (const row of leads) {
    const claimedAt = parseMs(row.claimedAt);
    if (claimedAt == null) continue;
    if (row.claimantExcluded) continue;
    const uid = Number(row.claimantId);
    if (!uid) continue;
    const b = bump(uid);
    b.claimed += 1;
    const created = parseMs(row.createdAt);
    if (created != null && claimedAt >= created) {
      b.claimSeconds.push((claimedAt - created) / 1000);
    }
    const dialAt = parseMs(row.firstDialAt);
    if (dialAt != null && dialAt >= claimedAt && dialAt - claimedAt <= SHOTGUN_DIAL_SLA_MS) {
      b.dialedUnder60s += 1;
    }
  }

  for (const uid of expiredOfferUserIds) {
    const id = Number(uid);
    if (!id) continue;
    const b = bump(id);
    b.unclaimed += 1;
    b.claimSeconds.push(SHOTGUN_UNCLAIMED_CLAIM_SECONDS);
  }

  const out = new Map<number, ShotgunSlaClrSummary>();
  for (const [uid, b] of buckets) {
    const denom = b.claimed + b.unclaimed;
    const sorted = [...b.claimSeconds].sort((a, c) => a - c);
    const med = median(sorted);
    const avg = average(b.claimSeconds);
    out.set(uid, {
      claimed: b.claimed,
      unclaimed: b.unclaimed,
      claimedPct: denom > 0 ? Math.round((b.claimed / denom) * 1000) / 10 : null,
      unclaimedPct: denom > 0 ? Math.round((b.unclaimed / denom) * 1000) / 10 : null,
      medianClaimSeconds: med == null ? null : round1(med),
      averageClaimSeconds: avg == null ? null : round1(avg),
      dialedUnder60sCount: b.dialedUnder60s,
      dialedUnder60sPct: b.claimed > 0 ? Math.round((b.dialedUnder60s / b.claimed) * 1000) / 10 : null,
    });
  }
  return out;
}
