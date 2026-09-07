/**
 * The monthly volume tier, in cents per transfer: under 100 = $5, 100-199 =
 * $10, 200+ = $15.
 *
 * `transferCount` is transfer CREDIT, not a row count — a transfer that came
 * off a shotgun lead is worth half to the CLR who published it and half to the
 * one who claimed it (shared/transfer-credit.ts) — so it arrives in halves and
 * the boundaries are now reachable on one:
 *
 *   99.5 pays $5, 100 exactly pays $10, 199.5 pays $10, 200 exactly pays $15.
 *
 * Both comparisons are ">=", so landing EXACTLY on a boundary takes the higher
 * rate, which is the plain reading of the tiers and the direction that favours
 * the CLR. Nothing here rounds: rounding 99.5 up to 100 would hand somebody a
 * doubled rate for half a transfer, and rounding it down would cost the same
 * amount in the other direction at every other point on the scale.
 */
export function tieredTransferCompRateCents(transferCount: number): number {
  return transferCount >= 200 ? 1500 : transferCount >= 100 ? 1000 : 500;
}

export function resolveTransferCompRateCents(
  transferCount: number,
  flatRateCents: unknown,
): number {
  const savedFlatRate = Number(flatRateCents);
  if (Number.isFinite(savedFlatRate) && savedFlatRate > 0) {
    return Math.round(savedFlatRate);
  }
  return tieredTransferCompRateCents(transferCount);
}

export function resolveEmailTransferCompRateCents(
  transferCount: number,
  userName: unknown,
  flatRateCents: unknown,
): number {
  // Elleine's agreement is permanently $5/transfer. Keep the emailed estimate
  // correct even if her saved profile rate is missing or was changed.
  const normalizedName = String(userName ?? "").trim().toLocaleLowerCase("en-US");
  if (/\belleine\b/.test(normalizedName)) return 500;
  return resolveTransferCompRateCents(transferCount, flatRateCents);
}
