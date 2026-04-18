import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldCheck, ExternalLink } from "lucide-react";

/**
 * Full-screen blocking popup shown on login if the user has NMLS checks
 * that have been pending for >= 5 days. Cannot be dismissed without acting.
 */
export function NmlsOverduePopup() {
  const [, navigate] = useLocation();

  const { data } = useQuery<any>({
    queryKey: ["/api/nmls-checks/my-pending"],
    refetchInterval: 60000,
  });

  const checks: any[] = data?.checks ?? [];
  const POPUP_THRESHOLD = 5;

  // Only show if any check is >= 5 days overdue
  const overdueChecks = checks.filter((c) => (c.daysOverdue ?? 0) >= POPUP_THRESHOLD);

  if (overdueChecks.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-background border border-destructive/30 shadow-2xl overflow-hidden">
        {/* Red header band */}
        <div className="bg-destructive/10 border-b border-destructive/20 px-6 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <h2 className="font-bold text-base">NMLS Verification Overdue</h2>
            <p className="text-sm text-muted-foreground">
              You have {overdueChecks.length} check{overdueChecks.length !== 1 ? "s" : ""} overdue by 5+ days
            </p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            NMLS license verification for the following loan officers has not been completed. This must be resolved before you continue.
          </p>

          <div className="space-y-2">
            {overdueChecks.map((check) => (
              <div
                key={check.id}
                className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{check.lo?.fullName ?? `LO #${check.lo_id}`}</p>
                  {check.lo?.nmlsId && (
                    <p className="text-xs text-muted-foreground font-mono">NMLS #{check.lo.nmlsId}</p>
                  )}
                </div>
                <span className="text-xs text-destructive font-semibold">
                  {check.daysOverdue}d overdue
                </span>
              </div>
            ))}
          </div>

          <a
            href="https://www.nmlsconsumeraccess.org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open NMLS Consumer Access to verify
          </a>
        </div>

        <div className="px-6 pb-5">
          <Button
            className="w-full gap-2"
            onClick={() => navigate("/nmls-checks")}
          >
            <ShieldCheck className="w-4 h-4" />
            Go to NMLS Checks to Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
