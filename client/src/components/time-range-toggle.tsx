import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TimeRange = "1d" | "1w" | "1m" | "all";

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "All Time" },
];

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "1d": "Today",
  "1w": "This Week",
  "1m": "Last 6 Months",
  "all": "All Time",
};

export function getStoredRange(key: string): TimeRange {
  try {
    const stored = localStorage.getItem(`ccc:trendRange:${key}`) as TimeRange | null;
    if (stored && TIME_RANGE_OPTIONS.some(o => o.value === stored)) return stored;
  } catch {}
  return "1m";
}

export function storeRange(key: string, value: TimeRange) {
  try { localStorage.setItem(`ccc:trendRange:${key}`, value); } catch {}
}

export function TimeRangeToggle({
  value,
  onChange,
  className,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as TimeRange)}
      className={className}
      size="sm"
      variant="outline"
    >
      {TIME_RANGE_OPTIONS.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o.label}
          className="text-xs px-2.5"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
