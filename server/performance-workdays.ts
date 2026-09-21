import { TRANSFER_CREDIT_SQL } from "@shared/transfer-credit";
import { COUNTED_CALLS_SQL } from "@shared/self-reported";
import { transferCreditExclusionSql } from "@shared/stats-exclusions";
import { isPerformanceWorkday, type PerformanceDay } from "@shared/performance-workday";

/** Read-only, tenant-scoped daily evidence. No check-ins, texts or EOD proxies.
 * CallTools' daily table already accumulates reconnect deltas and deduplicates
 * observations; summing event durations or EOD snapshots would double count it.
 */
export function loadPerformanceDays(db: any, orgId: number, from = "0001-01-01", to = "9999-12-31"): PerformanceDay[] {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) throw new Error("Performance statistics require an organization");
  const rows = db.prepare(`
    SELECT userId, date, SUM(transfers) AS transfers, SUM(calls) AS calls,
           MAX(activeSeconds) AS callToolsActiveSeconds
    FROM (
      SELECT tc.user_id AS userId, tc.date, tc.credit AS transfers, 0 AS calls, 0 AS activeSeconds
      FROM (${TRANSFER_CREDIT_SQL}) tc
      WHERE tc.org_id=? AND tc.date BETWEEN ? AND ? AND tc.user_id IS NOT NULL
        AND (${transferCreditExclusionSql("tc.date", "tc.user_id", "tc.org_id")})
      UNION ALL
      SELECT assistant_id, d, 0, calls, 0 FROM ${COUNTED_CALLS_SQL}
      WHERE org_id=? AND d BETWEEN ? AND ? AND assistant_id IS NOT NULL
      UNION ALL
      SELECT assistant_id, activity_date, 0,
             COUNT(DISTINCT COALESCE(NULLIF(call_id,''), external_event_id)), 0
      FROM callsync_activity_events
      WHERE org_id=? AND activity_date BETWEEN ? AND ? AND assistant_id IS NOT NULL
      GROUP BY assistant_id, activity_date
      UNION ALL
      SELECT assistant_id, activity_date, 0, 0, MAX(0, active_seconds)
      FROM callsync_agent_activity_daily
      WHERE org_id=? AND activity_date BETWEEN ? AND ? AND assistant_id IS NOT NULL
    ) evidence
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.id=evidence.userId AND u.org_id=?)
    GROUP BY userId, date
    ORDER BY date, userId
  `).all(orgId, from, to, orgId, from, to, orgId, from, to, orgId, from, to, orgId) as PerformanceDay[];
  return rows.filter((r) => isPerformanceWorkday(r.date, r.transfers, r.callToolsActiveSeconds, r.calls));
}
