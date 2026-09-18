/**
 * Boot/seed helper: apply timed needs_transfers pins (Markus Wood week, etc.).
 * Idempotent — safe on every boot beside ensureSeededHalfDays.
 */
import {
  TIMED_NEEDS_TRANSFERS_PINS,
  matchesTimedNeedsTransfersName,
  pacificCalendarDate,
  timedNeedsTransfersDesired,
  type TimedNeedsTransfersRule,
} from "@shared/timed-needs-transfers";

export {
  MARKUS_WOOD_NAME_RE,
  MARKUS_WOOD_PIN,
  TIMED_NEEDS_TRANSFERS_PINS,
  matchesMarkusWood,
  matchesTimedNeedsTransfersName,
  pacificCalendarDate,
  timedNeedsTransfersDesired,
  isTimedNeedsTransfersWindowActive,
} from "@shared/timed-needs-transfers";

type LoRow = { id: number; full_name?: string | null; needs_transfers?: number | null; org_id?: number | null; internal_status?: string | null };

function activeLoanOfficers(db: any): LoRow[] {
  try {
    return db.prepare(
      `SELECT id, full_name, needs_transfers, org_id, internal_status FROM loan_officers
        WHERE COALESCE(internal_status, 'active') = 'active'`,
    ).all() as LoRow[];
  } catch {
    try {
      return db.prepare(
        `SELECT id, full_name, needs_transfers, org_id FROM loan_officers`,
      ).all() as LoRow[];
    } catch {
      return [];
    }
  }
}

export type TimedPinChange = {
  ruleReason: string;
  loId: number;
  name: string;
  from: number;
  to: 0 | 1;
  ptDate: string;
};

/**
 * For each timed rule, set or clear `loan_officers.needs_transfers` for the
 * matched LO based on the Pacific calendar date. Never touches other LOs.
 * Does not flip exclude_from_stats. Idempotent.
 */
export function ensureTimedNeedsTransfersPins(
  db: any,
  when: Date = new Date(),
  rules: readonly TimedNeedsTransfersRule[] = TIMED_NEEDS_TRANSFERS_PINS,
): { updated: number; matched: TimedPinChange[]; ptDate: string; skipped: string[] } {
  const ptDate = pacificCalendarDate(when);
  const matched: TimedPinChange[] = [];
  const skipped: string[] = [];
  let updated = 0;
  const now = when.toISOString();
  const los = activeLoanOfficers(db);

  for (const rule of rules) {
    const desired = timedNeedsTransfersDesired(ptDate, rule);
    if (desired == null) {
      skipped.push(`${rule.reason}: before window (${ptDate})`);
      continue;
    }
    const hits = los.filter((lo) => matchesTimedNeedsTransfersName(lo.full_name, rule));
    if (!hits.length) {
      skipped.push(`${rule.reason}: no LO matched`);
      continue;
    }
    for (const lo of hits) {
      const loId = Number(lo.id);
      if (!Number.isSafeInteger(loId) || loId <= 0) continue;
      const from = Number(lo.needs_transfers) ? 1 : 0;
      const to = desired;
      matched.push({
        ruleReason: rule.reason,
        loId,
        name: String(lo.full_name ?? ""),
        from,
        to,
        ptDate,
      });
      if (from === to) continue;
      try {
        db.prepare(
          `UPDATE loan_officers SET needs_transfers=?, updated_at=? WHERE id=?`,
        ).run(to, now, loId);
        lo.needs_transfers = to;
        updated += 1;
      } catch (e: any) {
        console.error("[timed-needs-transfers] update failed:", e?.message ?? e);
      }
    }
  }

  return { updated, matched, ptDate, skipped };
}
