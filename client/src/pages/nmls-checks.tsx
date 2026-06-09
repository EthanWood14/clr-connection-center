import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, AlertTriangle, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";
import { parseDbTimestamp } from "@/lib/utils";

export default function NmlsChecks() {
  const { toast } = useToast();
  const { user } = useAuth();

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/nmls-checks/my-pending"],
    refetchInterval: 30000,
  });

  const confirm = useMutation({
    mutationFn: (loId: number) =>
      apiRequest("POST", `/api/nmls-checks/${loId}/confirm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nmls-checks/my-pending"] });
      queryClient.invalidateQueries({ queryKey: [`/api/notifications/unread-count?userId=${user?.id ?? 1}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${user?.id ?? 1}`] });
      toast({ title: "NMLS check confirmed", description: "Verification recorded. Thank you!" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not confirm check. Try again.", variant: "destructive" });
    },
  });

  const checks: any[] = data?.checks ?? [];
  const escalationDays: number = data?.escalationDays ?? 7;
  const nextCheckAt: string | null = data?.nextCheckAt ?? null;

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-6 h-6" />
          NMLS License Checks
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Verify that your assigned loan officers' NMLS licenses are still active in all licensed states.
        </p>
      </div>

      {/* What to do */}
      <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
        <p className="text-sm font-medium">How to verify:</p>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Open the NMLS Consumer Access site below</li>
          <li>Search for the LO by name or NMLS ID</li>
          <li>Confirm their license is active in all listed states</li>
          <li>Click <span className="font-semibold text-foreground">Confirm Verified</span> below</li>
        </ol>
        <a
          href="https://www.nmlsconsumeraccess.org"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mt-1"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open NMLS Consumer Access
        </a>
      </div>

      {/* Next automatic check reminder countdown */}
      {nextCheckAt && (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm">
          <Clock className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            Next check reminder goes out{" "}
            <span className="font-semibold text-foreground">
              {formatDistanceToNow(new Date(nextCheckAt), { addSuffix: true })}
            </span>
            <span className="text-muted-foreground/80">
              {" "}— {new Date(nextCheckAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </span>
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : checks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-green-500/70 mb-3" />
            <p className="font-medium text-sm">All clear!</p>
            <p className="text-xs text-muted-foreground mt-1">
              You have no pending NMLS checks assigned to you right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            {checks.length} pending check{checks.length !== 1 ? "s" : ""} assigned to you
          </p>
          {checks.map((check) => {
            const lo = check.lo;
            const daysOverdue = check.daysOverdue ?? 0;
            const isEscalating = daysOverdue >= escalationDays - 2;
            const isUrgent = daysOverdue >= escalationDays;
            return (
              <Card
                key={check.id}
                className={`border-l-4 ${isUrgent ? "border-l-destructive" : isEscalating ? "border-l-yellow-500" : "border-l-primary"}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{lo?.fullName ?? `LO #${check.lo_id}`}</span>
                        {lo?.nmlsId && (
                          <Badge variant="outline" className="font-mono text-xs">
                            NMLS #{lo.nmlsId}
                          </Badge>
                        )}
                        {isUrgent ? (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Escalated
                          </Badge>
                        ) : isEscalating ? (
                          <Badge className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                            Escalating soon
                          </Badge>
                        ) : null}
                      </div>

                      {lo?.licensedStates && (() => {
                        try {
                          const states: string[] = JSON.parse(lo.licensedStates || "[]");
                          return states.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {states.map((s) => (
                                <span key={s} className="text-xs px-1.5 py-0.5 rounded font-mono bg-muted text-muted-foreground">
                                  {s.trim().toUpperCase()}
                                </span>
                              ))}
                            </div>
                          ) : null;
                        } catch { return null; }
                      })()}

                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                        <Clock className="w-3 h-3" />
                        <span>
                          Assigned {formatDistanceToNow(parseDbTimestamp(check.assigned_at) ?? new Date(), { addSuffix: true })}
                          {daysOverdue > 0 && (
                            <span className={isUrgent ? " text-destructive font-semibold" : " text-yellow-600 dark:text-yellow-400"}>
                              {" "}· {daysOverdue} day{daysOverdue !== 1 ? "s" : ""} overdue
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => confirm.mutate(check.lo_id)}
                      disabled={confirm.isPending}
                      className="shrink-0 gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {confirm.isPending ? "Confirming…" : "Confirm Verified"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
