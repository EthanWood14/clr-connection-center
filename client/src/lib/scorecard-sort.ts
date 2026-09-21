export type ScorecardSort = { key: string; direction: "asc" | "desc" };
export type ScorecardSortColumn<T> = {
  key: string;
  get: (row: T) => number | string | null | undefined;
  better: boolean;
};

export const DEFAULT_SCORECARD_SORT: ScorecardSort = { key: "transfers", direction: "desc" };

export function selectScorecardSort<T>(current: ScorecardSort, column: ScorecardSortColumn<T>): ScorecardSort {
  return { key: column.key, direction: current.key === column.key
    ? current.direction === "desc" ? "asc" : "desc"
    : column.better ? "desc" : "asc" };
}

/** Do not keep sorting by an MTD-only metric once that column is hidden. */
export function resolveScorecardSort<T>(sort: ScorecardSort, columns: readonly ScorecardSortColumn<T>[]): ScorecardSort {
  return columns.some(column => column.key === sort.key) ? sort : DEFAULT_SCORECARD_SORT;
}

function validValue(value: number | string | null | undefined): number | string | null {
  return typeof value === "number" ? Number.isFinite(value) ? value : null
    : typeof value === "string" && value.trim() ? value : null;
}

/** Raw metrics, not formatted percentages/durations or rounded transfer credit. */
export function sortScorecardRows<T extends { transfers?: number; appointments?: number; calls?: number }>(
  rows: readonly T[], sort: ScorecardSort, columns: readonly ScorecardSortColumn<T>[],
): T[] {
  const active = resolveScorecardSort(sort, columns);
  const column = columns.find(candidate => candidate.key === active.key);
  if (!column) return [...rows];
  const count = (value: number | undefined) => Number.isFinite(value) ? value as number : 0;
  return [...rows].sort((a, b) => {
    const left = validValue(column.get(a)), right = validValue(column.get(b));
    // Dashes never become zeroes or jump above real results on ascending sorts.
    if (left === null && right !== null) return 1;
    if (left !== null && right === null) return -1;
    const comparison = left === null || right === null ? 0
      : typeof left === "number" && typeof right === "number" ? left - right
      : String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
    if (comparison) return active.direction === "asc" ? comparison : -comparison;
    // Preserve the established transfer → appointment → call tie-break order.
    // Completely equal rows retain their original order through stable sort.
    return count(b.transfers) - count(a.transfers)
      || count(b.appointments) - count(a.appointments)
      || count(b.calls) - count(a.calls);
  });
}
