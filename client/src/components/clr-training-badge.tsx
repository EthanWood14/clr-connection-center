import { Badge } from "@/components/ui/badge";

export function ClrTrainingBadge({
  inTraining,
  activeWorkdays,
  className = "",
}: {
  inTraining?: boolean;
  activeWorkdays?: number;
  className?: string;
}) {
  if (activeWorkdays == null && !inTraining) return null;
  const days = Math.max(0, Number(activeWorkdays) || 0);
  if (!inTraining && days >= 20) return null;
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap border-sky-300 bg-sky-50 px-1.5 py-0 text-[10px] font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 ${className}`}
      title={`${days} business workdays completed. Included in averages after 10 workdays; first month ends at 20 workdays.`}
      data-testid="clr-training-badge"
    >
      {inTraining ? "In training" : "First month"}
    </Badge>
  );
}
