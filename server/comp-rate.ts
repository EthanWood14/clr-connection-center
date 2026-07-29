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
