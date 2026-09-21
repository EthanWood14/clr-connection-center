/** Source-separated headline totals. Never use the dashboard's blended `calls`. */
export function managerDailyMetrics(input: {
  callToolsTotal?: number;
  localCallTools: { calls: number; conversations: number };
  transfers: number;
  appointments: number;
  dialpadCalls: number;
  dialpadTextsByUser: ReadonlyMap<number, number>;
}) {
  const count = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value!) : 0;
  const providerTotal = input.callToolsTotal;
  const hasProviderTotal = providerTotal != null && Number.isFinite(providerTotal);
  return {
    callToolsCalls: count(hasProviderTotal ? providerTotal : input.localCallTools.calls),
    callToolsSource: hasProviderTotal ? "provider" as const : "local" as const,
    transfers: count(input.transfers),
    appointments: count(input.appointments),
    callToolsConversations: count(input.localCallTools.conversations),
    dialpadCalls: count(input.dialpadCalls),
    // Include everyone mapped in today's feed, not just the current scorecard
    // roster. The storage helper already scopes the org/date and deduplicates SMS.
    dialpadMessages: [...input.dialpadTextsByUser.values()].reduce((total, n) => total + count(n), 0),
  };
}

export type ManagerDailyMetrics = ReturnType<typeof managerDailyMetrics>;
