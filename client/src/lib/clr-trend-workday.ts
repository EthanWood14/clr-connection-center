/** Performance-chart qualification only; not attendance or training tenure.
 * Positive transfer credit includes a shared/half-credit transfer. CallTools
 * time is the cumulative active time for this CLR on this date, in seconds.
 */
export function isClrTrendWorkday(
  transferCredit: number | null | undefined,
  callToolsActiveSeconds: number | null | undefined,
): boolean {
  return (typeof transferCredit === "number" && Number.isFinite(transferCredit) && transferCredit > 0)
    || (typeof callToolsActiveSeconds === "number" && Number.isFinite(callToolsActiveSeconds) && callToolsActiveSeconds >= 3600);
}
