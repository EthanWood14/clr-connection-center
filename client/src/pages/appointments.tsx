import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2,
  CalendarClock,
  Clock,
  AlertCircle,
  RefreshCw,
  X,
  ArrowUpRight,
  XCircle,
  Pencil,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const OUTCOME_TYPES = ["transfer", "appointment", "fell_through"] as const;
const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer",
  appointment: "Appointment",
  fell_through: "Fell Through",
  callback_requested: "Callback Requested",
  not_interested: "Not Interested",
  voicemail: "Voicemail",
  no_answer: "No Answer",
};

// Active appointment types — these are the ones that still need to be handled
const ACTIVE_APPT_TYPES = new Set(["appointment", "callback_requested"]);

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

// ─── Edit Schema ──────────────────────────────────────────────────────────────

const editSchema = z.object({
  outcomeType: z.string(),
  loId: z.coerce.number().min(1, "Select a loan officer"),
  borrowerName: z.string().optional(),
  followUpDate: z.string().optional(),
  notes: z.string().optional(),
});
type EditValues = z.infer<typeof editSchema>;

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

function EditDialog({
  outcome,
  open,
  onClose,
  onSubmit,
  isPending,
  los,
}: {
  outcome: Outcome | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (values: EditValues) => void;
  isPending: boolean;
  los: LoanOfficer[];
}) {
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { outcomeType: "appointment", loId: 0, borrowerName: "", followUpDate: "", notes: "" },
  });
  const [bonzoLogged, setBonzoLogged] = useState(false);
  const watchedType = form.watch("outcomeType");
  const isTransfer = watchedType === "transfer";

  useEffect(() => {
    if (open && outcome) {
      form.reset({
        outcomeType: outcome.outcomeType,
        loId: outcome.loId,
        borrowerName: outcome.borrowerName ?? "",
        followUpDate: outcome.followUpDate ?? "",
        notes: outcome.notes ?? "",
      });
      setBonzoLogged(false);
    }
  }, [open, outcome, form]);

  const allOutcomeTypes = [
    "appointment", "callback_requested", "transfer", "fell_through",
    "not_interested", "voicemail", "no_answer",
  ];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Appointment</DialogTitle>
          {outcome?.borrowerName && (
            <DialogDescription>{outcome.borrowerName}</DialogDescription>
          )}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Outcome Type */}
            <FormField control={form.control} name="outcomeType" render={({ field }) => (
              <FormItem>
                <FormLabel>Outcome Type</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {allOutcomeTypes.map(t => (
                      <SelectItem key={t} value={t}>{OUTCOME_LABELS[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Loan Officer */}
            <FormField control={form.control} name="loId" render={({ field }) => (
              <FormItem>
                <FormLabel>Loan Officer</FormLabel>
                <Select value={String(field.value || "")} onValueChange={v => field.onChange(Number(v))}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Select LO" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {los.filter(lo => lo.internalStatus === "active").map(lo => (
                      <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Borrower Name */}
            <FormField control={form.control} name="borrowerName" render={({ field }) => (
              <FormItem>
                <FormLabel>Borrower Name</FormLabel>
                <FormControl><Input {...field} placeholder="Optional" /></FormControl>
              </FormItem>
            )} />

            {/* Appointment / Follow-up Date */}
            <FormField control={form.control} name="followUpDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Appointment Date</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
              </FormItem>
            )} />

            {/* Notes */}
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} rows={2} placeholder="Any notes…" /></FormControl>
              </FormItem>
            )} />

            {/* Bonzo checkbox for transfers */}
            {isTransfer && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                <Checkbox
                  id="edit-bonzo"
                  checked={bonzoLogged}
                  onCheckedChange={v => setBonzoLogged(v === true)}
                />
                <label htmlFor="edit-bonzo" className="text-sm leading-snug cursor-pointer select-none">
                  I have recorded this transfer in Bonzo using the appropriate notation.
                </label>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending || (isTransfer && !bonzoLogged)}>
                {isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
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
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-green-200 bg-green-50 hover:border-green-400 hover:bg-green-100 dark:bg-green-900/10 dark:border-green-800 dark:hover:border-green-600 transition-all"
          >
            <ArrowUpRight className="w-6 h-6 text-green-600 dark:text-green-400" />
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">Transfer</span>
            <span className="text-xs text-muted-foreground text-center">Converted successfully</span>
          </button>
          <button
            onClick={() => onComplete(outcome.id, "fell_through")}
            disabled={isPending}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-red-200 bg-red-50 hover:border-red-400 hover:bg-red-100 dark:bg-red-900/10 dark:border-red-800 dark:hover:border-red-600 transition-all"
          >
            <XCircle className="w-6 h-6 text-red-500 dark:text-red-400" />
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">Fell Through</span>
            <span className="text-xs text-muted-foreground text-center">Did not convert</span>
          </button>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
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
  onEdit,
  onReschedule,
  isPendingComplete,
  isPendingReschedule,
}: {
  outcome: Outcome;
  loName: string;
  onComplete: (outcome: Outcome) => void;
  onEdit: (outcome: Outcome) => void;
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
              <Badge variant="outline" className="text-xs px-1.5 py-0 capitalize">
                {OUTCOME_LABELS[outcome.outcomeType] ?? outcome.outcomeType}
              </Badge>
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
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => onEdit(outcome)}
            >
              <Pencil className="w-3 h-3" />
              Edit
            </Button>
            {!rescheduling && (
              <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5" onClick={() => setRescheduling(true)}>
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
  const [editTarget, setEditTarget] = useState<Outcome | null>(null);

  const { data: outcomes = [], isLoading: loadingOutcomes } = useQuery<Outcome[]>({
    queryKey: ["/api/outcomes"],
  });

  const { data: los = [], isLoading: loadingLos } = useQuery<LoanOfficer[]>({
    queryKey: ["/api/loan-officers"],
  });

  const isLoading = loadingOutcomes || loadingLos;
  const loMap = new Map<number, string>(los.map((lo) => [lo.id, lo.fullName]));

  const todayStr = new Date().toISOString().split("T")[0];

  // Active appointments: must have a followUpDate AND be an active type (not already completed as transfer/fell_through)
  const allAppointments = outcomes
    .filter(
      (o) =>
        o.followUpDate != null &&
        o.followUpDate !== "" &&
        ACTIVE_APPT_TYPES.has(o.outcomeType)
    )
    .sort((a, b) => (a.followUpDate ?? "").localeCompare(b.followUpDate ?? ""));

  const overdueList = allAppointments.filter((o) => o.followUpDate! < todayStr);
  const todayList = allAppointments.filter((o) => o.followUpDate === todayStr);
  const upcomingList = allAppointments.filter((o) => o.followUpDate! > todayStr);

  const totalCount = allAppointments.length;

  // Complete mutation
  const completeMutation = useMutation({
    mutationFn: ({ id, type }: { id: number; type: "transfer" | "fell_through" }) => {
      setPendingCompleteId(id);
      return apiRequest("PATCH", `/api/outcomes/${id}`, { outcomeType: type, followUpDate: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setPendingCompleteId(null);
      setCompleteTarget(null);
      toast({ title: "Appointment completed" });
    },
    onError: () => {
      setPendingCompleteId(null);
      toast({ title: "Error completing appointment", variant: "destructive" });
    },
  });

  // Reschedule mutation (quick date-only update)
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

  // Full edit mutation
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditValues }) => {
      return apiRequest("PATCH", `/api/outcomes/${id}`, {
        outcomeType: data.outcomeType,
        loId: data.loId,
        borrowerName: data.borrowerName ?? "",
        notes: data.notes ?? "",
        followUpDate: data.followUpDate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      setEditTarget(null);
      toast({ title: "Appointment updated" });
    },
    onError: () => toast({ title: "Error updating appointment", variant: "destructive" }),
  });

  const handleComplete = (outcome: Outcome) => setCompleteTarget(outcome);
  const handleConfirmComplete = (id: number, type: "transfer" | "fell_through") => completeMutation.mutate({ id, type });
  const handleReschedule = (id: number, date: string) => rescheduleMutation.mutate({ id, date });
  const handleEdit = (outcome: Outcome) => setEditTarget(outcome);
  const handleSubmitEdit = (values: EditValues) => {
    if (!editTarget) return;
    editMutation.mutate({ id: editTarget.id, data: values });
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">
          Upcoming Appointments{" "}
          {!isLoading && <span className="text-muted-foreground font-normal">({totalCount})</span>}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          All active appointments — overdue, today, and upcoming — sorted earliest first
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
                onComplete={handleComplete} onEdit={handleEdit} onReschedule={handleReschedule}
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
                onComplete={handleComplete} onEdit={handleEdit} onReschedule={handleReschedule}
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
                onComplete={handleComplete} onEdit={handleEdit} onReschedule={handleReschedule}
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

      {/* Edit Dialog */}
      <EditDialog
        outcome={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={handleSubmitEdit}
        isPending={editMutation.isPending}
        los={los}
      />
    </div>
  );
}
