import { TV_RACE_GUEST_USER_ID } from "../shared/tv-race-participation";
import { TRANSFER_CREDIT_SQL } from "../shared/transfer-credit";
import { transferCreditExclusionSql } from "../shared/stats-exclusions";

/** Do not promote a TV-only guest into the CLR scorecard, payroll or averages. */
export function withTvRaceGuests<T extends { id: number }>(db: any, orgId: number, roster: T[]): T[] {
  const guests = db.prepare(`SELECT id, name, goal_transfers_weekly, goal_appointments_weekly
    FROM users WHERE org_id=? AND id=? AND role='admin' AND is_active=1
      AND archived_at IS NULL AND (portal IS NULL OR portal='c3')`)
    .all(orgId, TV_RACE_GUEST_USER_ID) as T[];
  const existing = new Set(roster.map(row => Number(row.id)));
  return [...roster, ...guests.filter(row => !existing.has(Number(row.id)))];
}

/** Per-event movement uses the same actual credits as the daily race totals. */
export function tvRaceCreditsForEvents(db: any, orgId: number, today: string, outcomeIds: number[]): Map<number, Array<{ userId: number; credit: number }>> {
  const ids = Array.from(new Set(outcomeIds.filter(id => Number.isSafeInteger(id) && id > 0)));
  const credits = new Map<number, Array<{ userId: number; credit: number }>>();
  if (!ids.length) return credits;
  const rows = db.prepare(`SELECT tc.outcome_id, tc.user_id, SUM(tc.credit) AS credit
    FROM (${TRANSFER_CREDIT_SQL}) tc
    WHERE tc.org_id=? AND tc.date=? AND (${transferCreditExclusionSql("tc.date", "tc.user_id", "tc.org_id")}) AND tc.outcome_id IN (${ids.map(() => "?").join(",")})
    GROUP BY tc.outcome_id, tc.user_id ORDER BY tc.outcome_id, tc.user_id`)
    .all(orgId, today, ...ids) as any[];
  for (const row of rows) {
    const id = Number(row.outcome_id);
    const userId = Number(row.user_id);
    const credit = Number(row.credit);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isFinite(credit) || credit <= 0) continue;
    const outcomeCredits = credits.get(id) ?? [];
    outcomeCredits.push({ userId, credit });
    credits.set(id, outcomeCredits);
  }
  return credits;
}
