import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BedDouble, Bell, CalendarClock, PlusCircle, Info, TrendingDown, RotateCcw } from "lucide-react";
import { format, parseISO, differenceInDays, addDays } from "date-fns";
import { useState } from "react";

const TIER_LABELS: Record<number, string> = { 1: "VIP", 2: "Standard", 3: "Low" };
const TIER_COLORS: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

// Quick-pick snooze durations
const QUICK_DURATIONS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
];

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function SnoozeDashboard() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLoId, setSelectedLoId] = useState<string>("");
  const [snoozeUntil, setSnoozeUntil] = useState(toDateStr(addDays(new Date(), 7)));
  const [snoozeReason, setSnoozeReason] = useState("");

  const { data: snoozed = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/loan-officers/snoozed"],
    refetchInterval: 60000,
  });

  const { data: allLOs = [] } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });

  // Active, non-snoozed LOs available to snooze
  const today = toDateStr(new Date());
  const activeLOs = allLOs.filter(
    (lo) =>
      lo.internalStatus === "active" &&
      (!lo.snoozeUntil || lo.snoozeUntil < today)
  );

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

  const snoozeNow = useMutation({
    mutationFn: ({ id, until, reason }: { id: number; until: string; reason: string }) =>
      apiRequest("PATCH", `/api/loan-officers/${id}`, { snoozeUntil: until, snoozeReason: reason }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers/snoozed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      const lo = allLOs.find((l) => l.id === vars.id);
      toast({ title: `${lo?.fullName ?? "LO"} snoozed`, description: `Excluded from assignments until ${vars.until}.` });
      setDialogOpen(false);
      setSelectedLoId("");
      setSnoozeReason("");
      setSnoozeUntil(toDateStr(addDays(new Date(), 7)));
    },
  });

  const expiringSoon = snoozed.filter((lo) => {
    const diff = differenceInDays(parseISO(lo.snoozeUntil), new Date());
    return diff <= 3;
  });

  function handleQuickPick(days: number) {
    setSnoozeUntil(toDateStr(addDays(new Date(), days)));
  }

  function handleSubmit() {
    if (!selectedLoId || !snoozeUntil) return;
    if (snoozeUntil <= today) {
      toast({ title: "Invalid date", description: "Snooze date must be in the future.", variant: "destructive" });
      return;
    }
    snoozeNow.mutate({ id: parseInt(selectedLoId), until: snoozeUntil, reason: snoozeReason });
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Snooze Manager</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Temporarily exclude LOs from daily assignments. Snoozed LOs are removed from the algorithm until their return date.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <PlusCircle className="w-4 h-4" />
          Snooze an LO
        </Button>
      </div>

      {/* Algorithm impact callout */}
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <TrendingDown className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Algorithm impact:</span> Snoozed LOs are completely skipped during daily assignment generation. Their scores still accumulate — so when they return, days-since-worked will be high, giving them priority in the next cycle.
        </p>
      </div>

      {/* Expiring soon alert */}
      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800 p-4">
          <CalendarClock className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
              {expiringSoon.length} LO{expiringSoon.length !== 1 ? "s" : ""} returning within 3 days
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
              {expiringSoon.map((lo) => lo.fullName).join(", ")} — they'll automatically re-enter the assignment pool.
            </p>
          </div>
        </div>
      )}

      {/* Snoozed list */}
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
              All active LOs are included in daily assignment generation.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Currently Snoozed — {snoozed.length} LO{snoozed.length !== 1 ? "s" : ""}
          </p>
          {snoozed
            .sort((a, b) => (a.snoozeUntil > b.snoozeUntil ? 1 : -1))
            .map((lo) => {
              const daysLeft = differenceInDays(parseISO(lo.snoozeUntil), new Date());
              const urgent = daysLeft <= 1;
              return (
                <Card key={lo.id} className="border-l-4" style={{ borderLeftColor: urgent ? "hsl(38 92% 50%)" : "hsl(183 98% 22%)" }}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{lo.fullName}</span>
                          <Badge className={`text-xs ${TIER_COLORS[lo.priorityTier]}`}>
                            {TIER_LABELS[lo.priorityTier]}
                          </Badge>
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            skipped in algorithm
                          </Badge>
                        </div>
                        {lo.nmlsId && <p className="text-xs text-muted-foreground">NMLS #{lo.nmlsId}</p>}
                        <div className="flex items-center gap-1.5 text-xs mt-2">
                          <BedDouble className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Returns</span>
                          <span className={`font-medium ${urgent ? "text-yellow-600 dark:text-yellow-400" : ""}`}>
                            {format(parseISO(lo.snoozeUntil), "MMM d, yyyy")}
                          </span>
                          <span className="text-muted-foreground/60">
                            ({daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `${daysLeft} days`})
                          </span>
                        </div>
                        {lo.snoozeReason && (
                          <p className="text-xs text-muted-foreground italic mt-1 border-t pt-1">
                            {lo.snoozeReason}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => unsnooze.mutate(lo.id)}
                          disabled={unsnooze.isPending}
                          className="gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Return Early
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {/* Snooze dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Snooze a Loan Officer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Loan Officer</Label>
              <Select value={selectedLoId} onValueChange={setSelectedLoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an LO..." />
                </SelectTrigger>
                <SelectContent>
                  {activeLOs.length === 0 ? (
                    <SelectItem value="__none__" disabled>No active LOs available</SelectItem>
                  ) : (
                    activeLOs
                      .sort((a, b) => a.fullName.localeCompare(b.fullName))
                      .map((lo) => (
                        <SelectItem key={lo.id} value={String(lo.id)}>
                          {lo.fullName}
                          {lo.nmlsId ? ` · NMLS #${lo.nmlsId}` : ""}
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Return Date</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_DURATIONS.map((d) => (
                  <button
                    key={d.days}
                    onClick={() => handleQuickPick(d.days)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      snoozeUntil === toDateStr(addDays(new Date(), d.days))
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <Input
                type="date"
                value={snoozeUntil}
                min={toDateStr(addDays(new Date(), 1))}
                onChange={(e) => setSnoozeUntil(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="On vacation, medical leave, etc."
                value={snoozeReason}
                onChange={(e) => setSnoozeReason(e.target.value)}
              />
            </div>

            <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This LO will be skipped in all daily assignment generation until their return date. Their algorithm score continues to accumulate while snoozed.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedLoId || !snoozeUntil || snoozeNow.isPending}
            >
              <BedDouble className="w-4 h-4 mr-1.5" />
              {snoozeNow.isPending ? "Snoozing…" : "Confirm Snooze"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
