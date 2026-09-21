// Fixed effective date, not a moving two-month lookback: old history must stay stable.
export const CLR_TREND_WORKDAY_CUTOFF = "2026-07-21";

/** Performance-chart qualification only; not attendance or training tenure.
 * Positive transfer credit includes a shared/half-credit transfer. CallTools
 * time is the cumulative active time for this CLR on this date, in seconds.
 * date is the chart's YYYY-MM-DD day, not today's date or the range start.
 */
export function isClrTrendWorkday(
  date: string,
  transferCredit: number | null | undefined,
  callToolsActiveSeconds: number | null | undefined,
  calls: number | null | undefined,
): boolean {
  const hasTransfer = typeof transferCredit === "number" && Number.isFinite(transferCredit) && transferCredit > 0;
  if (date < CLR_TREND_WORKDAY_CUTOFF) {
    return hasTransfer || (typeof calls === "number" && Number.isFinite(calls) && calls > 0);
  }
  return hasTransfer || (typeof callToolsActiveSeconds === "number" && Number.isFinite(callToolsActiveSeconds) && callToolsActiveSeconds >= 3600);
}
