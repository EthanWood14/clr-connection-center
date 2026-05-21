import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight } from "lucide-react";

interface LockStatus {
  locked: boolean;
  missingDates: string[];
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function EodLockGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [location, navigate] = useLocation();

  const isClr = !!(user && (user.role === "assistant" || (user.role === "admin" && (user as any).isClr)));

  const { data, isLoading } = useQuery<LockStatus>({
    queryKey: ["/api/auth/eod-lock-status"],
    enabled: !!user && !authLoading && isClr,
    staleTime: 60 * 1000,
    retry: false,
  });

  if (authLoading || isLoading || !user) return <>{children}</>;
  if (!isClr) return <>{children}</>;
  if (!data?.locked) return <>{children}</>;

  // Always allow the EOD Report tab through so the user can unlock themselves.
  if (location === "/eod-report") return <>{children}</>;

  const oldestMissing = data.missingDates[0];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/95 backdrop-blur-sm">
      <div className="max-w-md w-full rounded-xl border-2 border-amber-500/60 bg-card shadow-2xl">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold">App Access Locked</h2>
          </div>

          <p className="text-sm text-muted-foreground">
            You haven&apos;t submitted your EOD report for the following day{data.missingDates.length === 1 ? "" : "s"}:
          </p>

          <ul className="rounded-lg border bg-muted/40 divide-y overflow-hidden">
            {data.missingDates.map((d) => (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => navigate(`/eod-report?date=${d}`)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium tabular-nums hover:bg-muted/70 transition-colors"
                >
                  <span>{formatDate(d)}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>

          <p className="text-sm text-muted-foreground">
            {data.missingDates.length === 1
              ? "Click the date above to fill out that day's report."
              : "Click any date above to jump to that day. Start with the oldest."}
          </p>

          <Button
            onClick={() => navigate(`/eod-report?date=${oldestMissing}`)}
            className="w-full gap-2"
            size="lg"
          >
            Go to {data.missingDates.length === 1 ? "EOD Report" : "Oldest Missing Report"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
