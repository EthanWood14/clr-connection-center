/**
 * Org-scoped Shotgun speed scoreboard.
 *
 * Dial evidence (prefer real dial over claim-only vanity):
 *   1. shotgun_leads.first_dial_at — set when C3 records a Dialpad open
 *      (/api/shotgun/:id/open-phone) after the lead is claimed.
 *   2. Else earliest bonzo_call_events row for the same claimant + phone
 *      digits after claimed_at (extension-reported Bonzo dial).
 * The write-up flag `called=1` / done_at is intentionally NOT used — marking
 * a result later is not proof the CLR dialed within 60 seconds of claim.
 */
import {
  summarizeShotgunSla,
  summarizeShotgunSlaByClr,
  type ShotgunSlaClrLeadRow,
  type ShotgunSlaClrSummary,
  type ShotgunSlaLeadRow,
  type ShotgunSlaSummary,
} from "../shared/shotgun-sla";

function digits(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/**
 * Resolve first dial time for a claimed lead.
 * `bonzoByUserPhone` maps `${userId}:${last10digits}` → earliest occurred_at ISO.
 */
export function resolveFirstDialAt(opts: {
  firstDialAt: string | null | undefined;
  claimedAt: string | null | undefined;
  claimantId: number | null | undefined;
  phone: string | null | undefined;
  bonzoByUserPhone: Map<string, string>;
}): string | null {
  const stored = String(opts.firstDialAt ?? "").trim();
  if (stored) return stored;
  const claimedMs = Date.parse(String(opts.claimedAt ?? ""));
  const userId = Number(opts.claimantId);
  const phoneDigits = digits(opts.phone);
  if (!Number.isFinite(claimedMs) || !userId || phoneDigits.length < 10) return null;
  const key = `${userId}:${phoneDigits.slice(-10)}`;
  const bonzoAt = opts.bonzoByUserPhone.get(key);
  if (!bonzoAt) return null;
  const bonzoMs = Date.parse(bonzoAt);
  if (!Number.isFinite(bonzoMs) || bonzoMs < claimedMs) return null;
  return bonzoAt;
}

export type ShotgunSlaQueryDb = {
  prepare: (sql: string) => { all: (...args: any[]) => any[]; get: (...args: any[]) => any };
};

function loadSlaLeadRows(
  db: ShotgunSlaQueryDb,
  orgId: number,
  fromIso: string,
  toIso: string,
): { rows: ShotgunSlaClrLeadRow[]; excluded: Set<number> } {
  const leads = db.prepare(`
    SELECT l.id, l.created_at, l.claimed_at, l.status, l.first_dial_at, l.phone, l.phone_key,
           COALESCE(
             (SELECT e.user_id FROM shotgun_offer_events e
              WHERE e.lead_id = l.id AND e.response IN ('confirmed','reclaimed','bounceback_accepted')
              ORDER BY e.responded_at ASC, e.id ASC LIMIT 1),
             CASE WHEN l.claimed_at IS NOT NULL THEN l.current_assignee_id END
           ) AS claimant_id
    FROM shotgun_leads l
    WHERE l.org_id = ? AND l.created_at >= ? AND l.created_at <= ?
  `).all(orgId, fromIso, toIso) as any[];

  const excluded = new Set(
    (db.prepare(`SELECT id FROM users WHERE org_id=? AND exclude_from_stats=1`).all(orgId) as any[])
      .map((r) => Number(r.id)),
  );

  const bonzoRows = db.prepare(`
    SELECT user_id, occurred_at, path
    FROM bonzo_call_events
    WHERE org_id = ? AND counts = 1 AND occurred_at >= ? AND occurred_at <= ?
  `).all(orgId, fromIso, toIso) as any[];

  const bonzoByUserPhone = new Map<string, string>();
  for (const row of bonzoRows) {
    const userId = Number(row.user_id);
    const at = String(row.occurred_at ?? "");
    const pathDigits = digits(String(row.path ?? ""));
    if (!userId || !at || pathDigits.length < 10) continue;
    const key = `${userId}:${pathDigits.slice(-10)}`;
    const prev = bonzoByUserPhone.get(key);
    if (!prev || at < prev) bonzoByUserPhone.set(key, at);
  }

  const rows: ShotgunSlaClrLeadRow[] = leads.map((l) => {
    const claimedAt = l.claimed_at ? String(l.claimed_at) : null;
    const claimantId = Number(l.claimant_id) || null;
    const firstDialAt = claimedAt
      ? resolveFirstDialAt({
          firstDialAt: l.first_dial_at,
          claimedAt,
          claimantId,
          phone: l.phone_key || l.phone,
          bonzoByUserPhone,
        })
      : null;
    return {
      createdAt: String(l.created_at),
      claimedAt,
      status: String(l.status),
      firstDialAt,
      claimantId,
      claimantExcluded: claimantId != null && excluded.has(claimantId),
    };
  });

  return { rows, excluded };
}

/**
 * Load leads created in [fromIso, toIso] for orgId and summarize.
 * Excludes claim/dial metrics for claimants with exclude_from_stats=1.
 */
export function computeShotgunSla(
  db: ShotgunSlaQueryDb,
  orgId: number,
  fromIso: string,
  toIso: string,
): ShotgunSlaSummary {
  const { rows } = loadSlaLeadRows(db, orgId, fromIso, toIso);
  const orgRows: ShotgunSlaLeadRow[] = rows.map((r) => ({
    createdAt: r.createdAt,
    claimedAt: r.claimedAt,
    status: r.status,
    firstDialAt: r.firstDialAt,
    claimantExcluded: r.claimantExcluded,
  }));
  return summarizeShotgunSla(orgRows);
}

/**
 * Per-CLR SLA for the Transfer Scorecard range.
 * Claimed → claimant; unclaimed → expired offers in the same created_at window
 * (offer on a lead that entered Shotgun in-range). exclude_from_stats skipped.
 */
export function computeShotgunSlaByClr(
  db: ShotgunSlaQueryDb,
  orgId: number,
  fromIso: string,
  toIso: string,
): Map<number, ShotgunSlaClrSummary> {
  const { rows, excluded } = loadSlaLeadRows(db, orgId, fromIso, toIso);

  // Expired offers on leads that entered Shotgun in this window — same universe
  // as claimed, so claimed vs unclaimed stay comparable categories per CLR.
  const expiredOfferUserIds: number[] = [];
  try {
    const expired = db.prepare(`
      SELECT e.user_id FROM shotgun_offer_events e
      INNER JOIN shotgun_leads l ON l.id = e.lead_id
      WHERE e.org_id = ? AND e.response = 'expired'
        AND l.org_id = ? AND l.created_at >= ? AND l.created_at <= ?
    `).all(orgId, orgId, fromIso, toIso) as any[];
    for (const r of expired) {
      const uid = Number(r.user_id);
      if (!uid || excluded.has(uid)) continue;
      expiredOfferUserIds.push(uid);
    }
  } catch {
    // shotgun_offer_events may be missing on a brand-new DB
  }

  return summarizeShotgunSlaByClr(rows, expiredOfferUserIds);
}
