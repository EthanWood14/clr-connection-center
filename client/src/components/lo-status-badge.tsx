import { Badge } from "@/components/ui/badge";

const COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  inactive: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  vacation: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  archived: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  vacation: "🏖 Vacation",
  archived: "Archived",
};

export function LoStatusBadge({
  status,
  hideWhenActive = false,
  className = "",
}: {
  status: string | null | undefined;
  hideWhenActive?: boolean;
  className?: string;
}) {
  const s = (status ?? "active").toLowerCase();
  if (hideWhenActive && s === "active") return null;
  const color = COLORS[s] ?? COLORS.active;
  const label = LABELS[s] ?? s;
  return (
    <Badge className={`text-[10px] px-1.5 py-0 font-medium ${color} ${className}`}>
      {label}
    </Badge>
  );
}

export const LO_STATUS_COLORS = COLORS;
export const LO_STATUS_LABELS = LABELS;
