import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BedDouble, Bell, CalendarClock, User } from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";

const TIER_LABELS: Record<number, string> = { 1: "VIP", 2: "Standard", 3: "Low" };
const TIER_COLORS: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

export default function SnoozeDashboard() {
  const { toast } = useToast();

  const { data: snoozed = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/loan-officers/snoozed"],
    refetchInterval: 60000,
  });

  const { data: allLOs = [] } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });

  const unsnooze = useMutation({
    mutationFn: (id: number) =>
      apiRequest("PATCH", `/api/loan-officers/${id}`, { snoozeUntil: null, snoozeReason: null }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers/snoozed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      const lo = allLOs.find((l) => l.id === id);
      toast({ title: `${lo?.fullName ?? "LO"} unsnoozed`, description: "They'll appear in the next assignment cycle." });
    },
  });

  const today = new Date().toISOString().split("T")[0];
  const expiringSoon = snoozed.filter((lo) => {
    const diff = differenceInDays(parseISO(lo.snoozeUntil), new Date());
    return diff <= 3;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Snooze Manager</h1>
          <p className="text-muted-foreground text-sm mt-1">
            LOs currently excluded from daily assignments.
          </p>
        </div>
        {snoozed.length > 0 && (
          <Badge variant="outline" className="text-base px-3 py-1">
            {snoozed.length} snoozed
          </Badge>
        )}
      </div>

      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800 p-4">
          <CalendarClock className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              {expiringSoon.length} LO{expiringSoon.length !== 1 ? "s" : ""} expiring within 3 days
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
              {expiringSoon.map((lo) => lo.fullName).join(", ")}
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-5 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : snoozed.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Bell className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm font-medium">No LOs are currently snoozed</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Snooze an LO from the Directory when they're temporarily unavailable.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {snoozed
            .sort((a, b) => (a.snoozeUntil > b.snoozeUntil ? 1 : -1))
            .map((lo) => {
              const daysLeft = differenceInDays(parseISO(lo.snoozeUntil), new Date());
              const urgent = daysLeft <= 1;
              return (
                <Card key={lo.id} className="border-l-4" style={{ borderLeftColor: urgent ? "hsl(38 92% 50%)" : "hsl(183 98% 22%)" }}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{lo.fullName}</span>
                          <Badge className={`text-xs ${TIER_COLORS[lo.priorityTier]}`}>
                            {TIER_LABELS[lo.priorityTier]}
                          </Badge>
                        </div>
                        {lo.nmlsId && <p className="text-xs text-muted-foreground">NMLS #{lo.nmlsId}</p>}
                        <div className="flex items-center gap-1.5 text-xs mt-2">
                          <BedDouble className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Snoozed until</span>
                          <span className={`font-medium ${urgent ? "text-yellow-600 dark:text-yellow-400" : ""}`}>
                            {format(parseISO(lo.snoozeUntil), "MMM d, yyyy")}
                          </span>
                          <span className="text-muted-foreground/60">
                            ({daysLeft === 0 ? "expires today" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`})
                          </span>
                        </div>
                        {lo.snoozeReason && (
                          <p className="text-xs text-muted-foreground italic mt-1 border-t pt-1">
                            Reason: {lo.snoozeReason}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => unsnooze.mutate(lo.id)}
                        disabled={unsnooze.isPending}
                        className="shrink-0"
                      >
                        <Bell className="w-3.5 h-3.5 mr-1.5" />
                        Unsnooze
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
