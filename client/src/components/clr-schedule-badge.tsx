import { Badge } from "@/components/ui/badge";
import type { ScorecardScheduleKind, ScorecardScheduleStatus } from "@shared/scorecard-schedule";

const colors: Record<ScorecardScheduleKind, string> = {
  other_work: "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  full: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  half: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  time_off: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  sick: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  excused: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  weekend: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  holiday: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  inactive: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  unknown: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

export function ClrScheduleBadge({ status }: { status?: ScorecardScheduleStatus }) {
  if (!status) return null;
  const description = `${status.date} (Pacific): ${status.label}. ${status.detail} Schedule context only; scorecard calculations are unchanged.`;
  return <Badge variant="outline"
    className={`whitespace-nowrap px-1.5 py-0 text-[10px] font-medium ${colors[status.kind] ?? colors.unknown}`}
    title={description} aria-label={description} data-testid="clr-schedule-badge">
    {status.label}
  </Badge>;
}
