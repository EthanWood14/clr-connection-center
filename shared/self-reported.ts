/**
 * Self-reported activity stopped counting on this date.
 *
 * Until 2026-09-14 a CLR typed two numbers in themselves: "calls made" (the
 * morning call-log gate and the EOD's "Additional Calls") and "messages sent"
 * (the EOD's "Additional Texts"). They were the tallest bars on every screen
 * and the least trustworthy figure on any of them — on 2026-09-11 the team
 * hand-reported 1,146 calls and 7,743 texts against 423 Dialpad calls and 1,130
 * Dialpad texts actually observed.
 *
 * From this date, calls are what Dialpad and CallTools recorded and messages
 * are what Dialpad recorded. Nothing a person typed counts. History before the
 * date is left exactly as it was filed — it was the only record of those days.
 *
 * Every consumer goes through the two SQL fragments below so the cutoff lives
 * in one place. The date is an ISO business day, compared as text.
 */
export const SELF_REPORTED_CUTOFF = "2026-09-14";

/** True when a business day still uses the numbers people typed in. */
export function selfReportedCountsOn(isoDate: string): boolean {
  return String(isoDate ?? "") < SELF_REPORTED_CUTOFF;
}

/**
 * Calls per CLR per day, as a subquery: hand-logged before the cutoff,
 * Dialpad after it. Columns: org_id, assistant_id, d, calls.
 *
 * Only Dialpad here. CallTools is added by the consumers that already add it
 * (callSyncActivitySummary), the same way they did before, so nothing is
 * counted twice.
 */
export const COUNTED_CALLS_SQL = `(
  SELECT org_id, assistant_id, log_date AS d, COALESCE(calls_made, 0) AS calls
    FROM daily_call_logs WHERE log_date < '${SELF_REPORTED_CUTOFF}'
  UNION ALL
  SELECT org_id, user_id AS assistant_id, stat_date AS d, COALESCE(calls, 0) AS calls
    FROM dialpad_daily_stats WHERE stat_date >= '${SELF_REPORTED_CUTOFF}' AND user_id IS NOT NULL
)`;

/**
 * Messages per CLR per day, as a subquery: the EOD's typed number before the
 * cutoff, Dialpad texts after it. Columns: org_id, assistant_id, d, messages.
 * eod_reports carries no org_id of its own — the org comes from the user.
 * A text is credited to the mapped user on the event, or to whoever the
 * agent is linked to now — the same rule getDialpadTextsFor uses.
 */
export const COUNTED_MESSAGES_SQL = `(
  SELECT u.org_id, e.assistant_id, e.report_date AS d, COALESCE(e.messages_sent, 0) AS messages
    FROM eod_reports e JOIN users u ON u.id = e.assistant_id
   WHERE e.report_date < '${SELF_REPORTED_CUTOFF}'
  UNION ALL
  SELECT s.org_id, COALESCE(s.user_id, l.user_id) AS assistant_id, s.message_date AS d, 1 AS messages
    FROM dialpad_sms_events s
    LEFT JOIN dialpad_agent_links l ON l.org_id = s.org_id AND l.agent_key = s.agent_key
   WHERE s.message_date >= '${SELF_REPORTED_CUTOFF}' AND COALESCE(s.user_id, l.user_id) IS NOT NULL
)`;
