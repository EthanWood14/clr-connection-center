import { AlertTriangle } from "lucide-react";

export function ScheduleAccountabilityNotice() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 px-5 py-4 text-amber-950 shadow-md dark:border-amber-500 dark:from-amber-950/70 dark:via-orange-950/50 dark:to-amber-950/70 dark:text-amber-100"
      role="alert"
      data-testid="schedule-accountability-notice"
    >
      <div className="absolute -right-6 -top-8 opacity-[0.08]" aria-hidden="true">
        <AlertTriangle className="h-28 w-28" />
      </div>
      <div className="relative flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400/25 ring-1 ring-amber-500/40 dark:bg-amber-400/15">
          <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-extrabold tracking-tight sm:text-lg">Your schedule is your commitment</p>
          <p className="mt-1 text-sm font-medium leading-relaxed sm:text-base">
            Once saved, your check-ins are evaluated against these days and start times. You will be accountable for
            keeping this schedule, so enter the <strong>least restrictive schedule permitted for your role</strong> and
            only commit to hours you can reliably meet.
          </p>
        </div>
      </div>
    </div>
  );
}
