import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { parseISO, isToday, isFuture, format } from "date-fns";
import {
  CheckCircle2,
  CalendarClock,
  Clock,
  AlertCircle,
  RefreshCw,
  X,
  ArrowUpRight,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Outcome {
  id: number;
  date: string;
  assistantId: number;
  loId: number;
  borrowerName?: string;
  outcomeType: string;
  journeyId?: string;
  notes?: string;
  followUpDate?: string | null;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface LoanOfficer {
  id: number;
  fullName: string;
  internalStatus?: string;
}

// ─── Complete Dialog ──────────────────────────────────────────────────────────

function CompleteDialog({
  outcome,
  loName,
  open,
  onClose,
  onComplete,
  isPending,
}: {
  outcome: Outcome;
  loName: string;
  open: boolean;
  onClose: () => void;
  onComplete: (id: number, type: "transfer" | "fell_through") => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Complete Appointment
          </DialogTitle>
          <DialogDescription className="text-sm">
            <span className="font-medium text-foreground">{outcome.borrowerName || "Unknown Borrower"}</span>
            {" · "}LO: {loName}
            <br />
            How did this appointment end up?
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <button
            onClick={() => onComplete(outcome.id, "transfer")}
            disabled={isPending}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-green-200 bg-green-50 hover:border-green-400 hover:bg-green-100 dark:bg-green-900/10 dark:border-green-800 dark:hover:border-green-600 transition-all group"
          >
            <ArrowUpRight className="w-6 h-6 text-green-600 dark:text-green-400" />
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">Transfer</span>
            <span className="text-xs text-muted-foreground text-center">Converted successfully</span>
          </button>
          <button
            onClick={() => onComplete(outcome.id, "fell_through")}
            disabled={isPending}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-red-200 bg-red-50 hover:border-red-400 hover:bg-red-100 dark:bg-red-900/10 dark:border-red-800 dark:hover:border-red-600 transition-all group"
          >
            <XCircle className="w-6 h-6 text-red-500 dark:text-red-400" />
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">Fell Through</span>
            <span className="text-xs text-muted-foreground text-center">Did not convert</span>
          </button>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Appointment Card ─────────────────────────────────────────────────────────

function AppointmentCard({
  outcome,
  loName,
  onComplete,
  onReschedule,
  isPendingComplete,
  isPendingReschedule,
}: {
  outcome: Outcome;
  loName: string;
  onComplete: (outcome: Outcome) => void;
  onReschedule: (id: number, date: string) => void;
  isPendingComplete: boolean;
  isPendingReschedule: boolean;
}) {
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");

  const handleReschedule = () => {
    if (!newDate) return;
    onReschedule(outcome.id, newDate);
    setRescheduling(false);
    setNewDate("");
  };

  const followUpParsed = outcome.followUpDate ? parseISO(outcome.followUpDate) : null;
  const dateStr = outcome.followUpDate ?? "";
  const todayStr = new Date().toISOString().split("T")[0];
  const isOverdue = dateStr < todayStr;
  const isUpcoming = dateStr > todayStr;
  const isTodayAppt = dateStr === todayStr;

  return (
    <Card className="border border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Left */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold truncate">{outcome.borrowerName || "Unknown Borrower"}</span>
              {isOverdue && (
                <Badge className="text-xs px-1.5 py-0 bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400">
                  Overdue
                </Badge>
              )}
              {isTodayAppt && (
                <Badge className="text-xs px-1.5 py-0 bg-primary/10 text-primary border-primary/30">
                  Today
                </Badge>
              )}
              {isUpcoming && (
                <Badge className="text-xs px-1.5 py-0 bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
                  Upcoming
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><span className="font-medium text-foreground/70">LO:</span> {loName}</span>
              <span><span className="font-medium text-foreground/70">Logged:</span> {outcome.date ? format(parseISO(outcome.date), "MMM d, yyyy") : "—"}</span>
              {outcome.followUpDate && (
                <span>
                  <span className="font-medium text-foreground/70">Scheduled:</span>{" "}
                  {format(parseISO(outcome.followUpDate), "MMM d, yyyy")}
                </span>
              )}
            </div>

            {outcome.notes && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{outcome.notes}</p>
            )}

            {rescheduling && (
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-8 text-xs w-40"
                  min={new Date().toISOString().split("T")[0]}
                />
                <Button size="sm" className="h-8 text-xs px-3" onClick={handleReschedule} disabled={!newDate || isPendingReschedule}>
                  {isPendingReschedule ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs px-2" onClick={() => { setRescheduling(false); setNewDate(""); }}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-2 flex-wrap">
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs gap-1.5"
              onClick={() => onComplete(outcome)}
              disabled={isPendingComplete}
            >
              {isPendingComplete ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Complete
            </Button>
            {!rescheduling && (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setRescheduling(true)}>
                <CalendarClock className="w-3 h-3" />
                Reschedule
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ label, count, overdue, upcoming }: { label: string; count: number; overdue?: boolean; upcoming?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {overdue
        ? <AlertCircle className="w-4 h-4 text-red-500" />
        : upcoming
        ? <CalendarClock className="w-4 h-4 text-blue-500" />
        : <Clock className="w-4 h-4 text-primary" />}
      <h2 className={`text-sm font-semibold tracking-wide ${overdue ? "text-red-600 dark:text-red-400" : upcoming ? "text-blue-600 dark:text-blue-400" : "text-primary"}`}>
        {label}
      </h2>
      <Badge variant="outline" className={`text-xs px-1.5 py-0 ${overdue ? "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400" : upcoming ? "border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400" : "border-primary/40 text-primary"}`}>
        {count}
      </Badge>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Appointments() {
  const { toast } = useToast();
  const [pendingCompleteId, setPendingCompleteId] = useState<number | null>(null);
  const [pendingRescheduleId, setPendingRescheduleId] = useState<number | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Outcome | null>(null);

  const { data: outcomes = [], isLoading: loadingOutcomes } = useQuery<Outcome[]>({
    queryKey: ["/api/outcomes"],
  });

  const { data: los = [], isLoading: loadingLos } = useQuery<LoanOfficer[]>({
    queryKey: ["/api/loan-officers"],
  });

  const isLoading = loadingOutcomes || loadingLos;
  const loMap = new Map<number, string>(los.map((lo) => [lo.id, lo.fullName]));

  const todayStr = new Date().toISOString().split("T")[0];

  // All uncompleted appointments: any outcome with a followUpDate set (appointment, transfer follow-up, etc.)
  const allAppointments = outcomes.filter(
    (o) => o.followUpDate != null && o.followUpDate !== ""
  );

  const overdueList = allAppointments.filter((o) => o.followUpDate! < todayStr)
    .sort((a, b) => a.followUpDate!.localeCompare(b.followUpDate!));
  const todayList = allAppointments.filter((o) => o.followUpDate === todayStr);
  const upcomingList = allAppointments.filter((o) => o.followUpDate! > todayStr)
    .sort((a, b) => a.followUpDate!.localeCompare(b.followUpDate!));

  const totalCount = allAppointments.length;

  // Complete mutation — updates outcomeType to transfer or fell_through, clears followUpDate
  const completeMutation = useMutation({
    mutationFn: ({ id, type }: { id: number; type: "transfer" | "fell_through" }) => {
      setPendingCompleteId(id);
      return apiRequest("PATCH", `/api/outcomes/${id}`, { outcomeType: type, followUpDate: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      setPendingCompleteId(null);
      setCompleteTarget(null);
      toast({ title: "Appointment completed" });
    },
    onError: () => {
      setPendingCompleteId(null);
      toast({ title: "Error completing appointment", variant: "destructive" });
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => {
      setPendingRescheduleId(id);
      return apiRequest("PATCH", `/api/outcomes/${id}`, { followUpDate: date });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      setPendingRescheduleId(null);
      toast({ title: "Appointment rescheduled" });
    },
    onError: () => {
      setPendingRescheduleId(null);
      toast({ title: "Error rescheduling", variant: "destructive" });
    },
  });

  const handleComplete = (outcome: Outcome) => setCompleteTarget(outcome);
  const handleConfirmComplete = (id: number, type: "transfer" | "fell_through") => {
    completeMutation.mutate({ id, type });
  };
  const handleReschedule = (id: number, date: string) => rescheduleMutation.mutate({ id, date });

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">
          Upcoming Schedule{" "}
          {!isLoading && <span className="text-muted-foreground font-normal">({totalCount})</span>}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          All pending appointments — overdue, today, and upcoming
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      )}

      {/* Empty */}
      {!isLoading && totalCount === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">All clear!</p>
              <p className="text-sm text-muted-foreground mt-1">No pending appointments right now.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overdue */}
      {!isLoading && overdueList.length > 0 && (
        <section>
          <SectionHeader label="Overdue" count={overdueList.length} overdue />
          <div className="space-y-2">
            {overdueList.map((o) => (
              <AppointmentCard
                key={o.id} outcome={o} loName={loMap.get(o.loId) ?? `LO #${o.loId}`}
                onComplete={handleComplete} onReschedule={handleReschedule}
                isPendingComplete={pendingCompleteId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Today */}
      {!isLoading && todayList.length > 0 && (
        <section>
          <SectionHeader label="Today" count={todayList.length} />
          <div className="space-y-2">
            {todayList.map((o) => (
              <AppointmentCard
                key={o.id} outcome={o} loName={loMap.get(o.loId) ?? `LO #${o.loId}`}
                onComplete={handleComplete} onReschedule={handleReschedule}
                isPendingComplete={pendingCompleteId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming */}
      {!isLoading && upcomingList.length > 0 && (
        <section>
          <SectionHeader label="Upcoming" count={upcomingList.length} upcoming />
          <div className="space-y-2">
            {upcomingList.map((o) => (
              <AppointmentCard
                key={o.id} outcome={o} loName={loMap.get(o.loId) ?? `LO #${o.loId}`}
                onComplete={handleComplete} onReschedule={handleReschedule}
                isPendingComplete={pendingCompleteId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Complete Dialog */}
      {completeTarget && (
        <CompleteDialog
          outcome={completeTarget}
          loName={loMap.get(completeTarget.loId) ?? `LO #${completeTarget.loId}`}
          open={!!completeTarget}
          onClose={() => setCompleteTarget(null)}
          onComplete={handleConfirmComplete}
          isPending={completeMutation.isPending}
        />
      )}
    </div>
  );
}
