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
import { HelpIcon } from "@/components/onboarding";
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
import { useAuth } from "@/lib/auth";
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
  ChevronDown,
  ChevronUp,
  StickyNote,
  Save,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { businessTodayClient } from "@/lib/business-day";

// ─── Constants ────────────────────────────────────────────────────────────────

const OUTCOME_TYPES = ["transfer", "appointment", "fell_through"] as const;
const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer",
  appointment: "Appointment",
  fell_through: "Fell Through",
  callback_requested: "Callback",
  deferral: "Deferral",
  future_contact: "Deferral",
  not_interested: "Not Interested",
  voicemail: "Voicemail",
  no_answer: "No Answer",
};

// Colors per appointment subtype
const APPT_BADGE_COLORS: Record<string, string> = {
  appointment: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
  callback_requested: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300",
  deferral: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300",
  future_contact: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300",
};

// Active appointment types — these are the ones that still need to be handled
const ACTIVE_APPT_TYPES = new Set(["appointment", "callback_requested", "deferral", "future_contact"]);

// Filter tab definitions
const FILTER_TABS = [
  { key: "all", label: "All", tooltip: "All appointments, callbacks, and deferrals" },
  { key: "appointment", label: "Appointments", tooltip: "Specific date & time confirmed" },
  { key: "callback_requested", label: "Callbacks", tooltip: "Call back soon — within days/weeks, no exact time" },
  { key: "deferral", label: "Deferrals", tooltip: "Month+ away — open to future contact, no date set" },
] as const;
type FilterKey = typeof FILTER_TABS[number]["key"];

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
    "appointment", "callback_requested", "deferral", "transfer", "fell_through",
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
                <FormLabel>
                  Appointment Date &amp; Time{" "}
                  <span className="text-[11px] font-normal text-muted-foreground">
                    ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </span>
                </FormLabel>
                <FormControl><Input type="datetime-local" {...field} /></FormControl>
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
  clrName,
  isMine,
  isConflict,
  onComplete,
  onQuickComplete,
  onEdit,
  onReschedule,
  onSaveNotes,
  onDelete,
  isPendingComplete,
  isPendingReschedule,
  isPendingNotes,
  isPendingDelete,
}: {
  outcome: Outcome;
  loName: string;
  clrName: string;
  isMine: boolean;
  isConflict: boolean;
  onComplete: (outcome: Outcome) => void;
  onQuickComplete: (id: number) => void;
  onEdit: (outcome: Outcome) => void;
  onReschedule: (id: number, date: string) => void;
  onSaveNotes: (id: number, notes: string) => void;
  onDelete: (outcome: Outcome) => void;
  isPendingComplete: boolean;
  isPendingReschedule: boolean;
  isPendingNotes: boolean;
  isPendingDelete: boolean;
}) {
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState(outcome.notes ?? "");

  const handleReschedule = () => {
    if (!newDate) return;
    onReschedule(outcome.id, newDate);
    setRescheduling(false);
    setNewDate("");
  };

  const handleSaveNotes = () => {
    onSaveNotes(outcome.id, noteDraft);
    setEditingNotes(false);
  };

  const dateStr = outcome.followUpDate ?? "";
  const todayStr = businessTodayClient();
  const isOverdue = !!dateStr && dateStr < todayStr;
  const isUpcoming = !!dateStr && dateStr > todayStr;
  const isTodayAppt = dateStr === todayStr;

  return (
    <Card className={`border transition-colors ${isConflict ? "border-amber-300 dark:border-amber-700/70" : isOverdue ? "border-red-200 dark:border-red-900/50" : "border-border hover:border-primary/30"}`}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Left */}
          <div className="flex-1 min-w-0 space-y-2 cursor-pointer" onClick={() => setExpanded(e => !e)}>
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
              {isConflict && (
                <Badge
                  className="text-xs px-1.5 py-0 gap-1 bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
                  title="Another appointment for this CLR is within 30 minutes of this one"
                  data-testid={`badge-conflict-${outcome.id}`}
                >
                  <AlertCircle className="w-3 h-3" />
                  Conflict
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-xs px-1.5 py-0 capitalize ${APPT_BADGE_COLORS[outcome.outcomeType] ?? ""}`}
              >
                {OUTCOME_LABELS[outcome.outcomeType] ?? outcome.outcomeType}
              </Badge>
              {outcome.notes && !expanded && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 gap-1">
                  <StickyNote className="w-3 h-3" />
                  Note
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span
                className={`inline-flex items-center gap-1 font-medium ${isMine ? "text-primary" : "text-foreground/80"}`}
                title={isMine ? "This appointment is assigned to you" : `Assigned CLR: ${clrName}`}
                data-testid={`text-clr-${outcome.id}`}
              >
                <span className="font-semibold">CLR:</span> {clrName}
                {isMine && (
                  <Badge className="text-[10px] leading-none px-1.5 py-0.5 bg-primary/10 text-primary border-primary/30 ml-0.5">
                    You
                  </Badge>
                )}
              </span>
              <span><span className="font-medium text-foreground/70">LO:</span> {loName}</span>
              <span><span className="font-medium text-foreground/70">Logged:</span> {outcome.date ? format(parseISO(outcome.date), "MMM d, yyyy") : "—"}</span>
              {outcome.followUpDate && (
                <span>
                  <span className="font-medium text-foreground/70">Scheduled:</span>{" "}
                  {format(
                    parseISO(outcome.followUpDate),
                    outcome.followUpDate.includes("T") ? "MMM d · h:mm a" : "MMM d, yyyy",
                  )}
                </span>
              )}
            </div>

            {outcome.notes && !expanded && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{outcome.notes}</p>
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
              title="Complete with outcome (Transfer or Fell Through)"
            >
              {isPendingComplete ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Complete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs gap-1.5"
              onClick={() => setExpanded(e => !e)}
              aria-label="Expand details"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Less" : "Details"}
            </Button>
          </div>
        </div>

        {/* Expanded detail panel */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            {/* Inline notes editor */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-foreground/70 flex items-center gap-1">
                  <StickyNote className="w-3 h-3" />
                  Notes
                </span>
                {!editingNotes && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => { setEditingNotes(true); setNoteDraft(outcome.notes ?? ""); }}>
                    <Pencil className="w-3 h-3 mr-1" />
                    {outcome.notes ? "Edit" : "Add"}
                  </Button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-2">
                  <Textarea
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    rows={3}
                    placeholder='e.g. "Called 3x, no answer. Try afternoon."'
                    className="text-xs"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={handleSaveNotes} disabled={isPendingNotes}>
                      {isPendingNotes ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingNotes(false); setNoteDraft(outcome.notes ?? ""); }}>Cancel</Button>
                  </div>
                </div>
              ) : outcome.notes ? (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{outcome.notes}</p>
              ) : (
                <p className="text-xs text-muted-foreground/70 italic">No notes yet.</p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => onComplete(outcome)}
                disabled={isPendingComplete}
                title="Complete with outcome (Transfer or Fell Through)"
              >
                <CheckCircle2 className="w-3 h-3" />
                Mark Complete…
              </Button>
              {!rescheduling && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setRescheduling(true)}>
                  <CalendarClock className="w-3 h-3" />
                  Reschedule
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => onEdit(outcome)}
              >
                <Pencil className="w-3 h-3" />
                Edit Details
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 border-red-200 dark:border-red-900/50 ml-auto"
                onClick={() => onDelete(outcome)}
                disabled={isPendingDelete}
                data-testid={`button-delete-${outcome.id}`}
                title="Permanently delete this appointment"
              >
                {isPendingDelete ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Delete
              </Button>
            </div>

            {/* Inline reschedule picker */}
            {rescheduling && (
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-8 text-xs w-52"
                />
                <span className="text-[10px] text-muted-foreground">
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </span>
                <Button size="sm" className="h-8 text-xs px-3" onClick={handleReschedule} disabled={!newDate || isPendingReschedule}>
                  {isPendingReschedule ? <RefreshCw className="w-3 h-3 animate-spin" /> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs px-2" onClick={() => { setRescheduling(false); setNewDate(""); }}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>
        )}
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
  const { user } = useAuth();
  const myUserId = (user as any)?.id ?? null;
  const myRole = (user as any)?.role ?? null;
  // Admins and managers see every appointment across the team. CLRs see only
  // their own + anything overdue (so handoffs are picked up).
  const seesAll = myRole === "admin" || myRole === "manager";
  const [pendingCompleteId, setPendingCompleteId] = useState<number | null>(null);
  const [pendingRescheduleId, setPendingRescheduleId] = useState<number | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Outcome | null>(null);
  const [editTarget, setEditTarget] = useState<Outcome | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Outcome | null>(null);
  const [filterType, setFilterType] = useState<FilterKey>("all");

  const { data: outcomes = [], isLoading: loadingOutcomes } = useQuery<Outcome[]>({
    queryKey: ["/api/outcomes"],
  });

  const { data: los = [], isLoading: loadingLos } = useQuery<LoanOfficer[]>({
    queryKey: ["/api/loan-officers"],
  });

  // Users — to display the CLR (assistant) assigned to each appointment
  const { data: users = [] } = useQuery<Array<{ id: number; name?: string; email?: string }>>({
    queryKey: ["/api/users"],
  });

  const isLoading = loadingOutcomes || loadingLos;
  const loMap = new Map<number, string>(los.map((lo) => [lo.id, lo.fullName]));
  const userMap = new Map<number, string>(
    users.map((u) => [u.id, (u.name && u.name.trim()) || u.email || `User #${u.id}`]),
  );
  const clrNameFor = (id: number) => userMap.get(id) ?? `CLR #${id}`;

  const todayStr = businessTodayClient();

  // Active appointments: followUpDate required for appointment/callback, but deferrals may not have a date
  const matchesFilter = (o: Outcome) => {
    if (filterType === "all") return true;
    if (filterType === "deferral") return o.outcomeType === "deferral" || o.outcomeType === "future_contact";
    return o.outcomeType === filterType;
  };

  // Visibility rule: admins and managers see all appointments.
  // CLRs see only their own — appointments belong to the CLR who logged them.
  const isMineOrOverdue = (o: Outcome) => {
    if (seesAll) return true;
    return myUserId != null && o.assistantId === myUserId;
  };

  const allAppointments = outcomes
    .filter(
      (o) =>
        ACTIVE_APPT_TYPES.has(o.outcomeType) &&
        matchesFilter(o) &&
        isMineOrOverdue(o) &&
        (
          // dated entries always show
          (o.followUpDate != null && o.followUpDate !== "") ||
          // undated deferrals still show (they have no date set by definition)
          o.outcomeType === "deferral" ||
          o.outcomeType === "future_contact"
        )
    )
    .sort((a, b) => (a.followUpDate ?? "9999-99-99").localeCompare(b.followUpDate ?? "9999-99-99"));

  const hasDate = (o: Outcome) => o.followUpDate != null && o.followUpDate !== "";
  const overdueList = allAppointments.filter((o) => hasDate(o) && o.followUpDate! < todayStr);
  const todayList = allAppointments.filter((o) => hasDate(o) && o.followUpDate === todayStr);
  const upcomingList = allAppointments.filter((o) => hasDate(o) && o.followUpDate! > todayStr);
  const undatedList = allAppointments.filter((o) => !hasDate(o));

  const totalCount = allAppointments.length;

  // ── Appointment conflict detection ─────────────────────────────────────────
  // A conflict = two real time-bound 'appointment' outcomes for the SAME CLR
  // whose start times are within 30 minutes of each other (overlap window).
  // We scan ALL outcomes (not just filtered ones) so a callback filter still
  // catches a conflicting appointment underneath. Only appointments with a
  // parsable datetime participate — date-only follow-ups have no time so we
  // can't reason about overlap.
  const conflictIds = (() => {
    const CONFLICT_WINDOW_MS = 30 * 60 * 1000;
    type T = { id: number; t: number; a: number };
    const items: T[] = [];
    for (const o of outcomes) {
      if (o.outcomeType !== "appointment") continue;
      const raw = o.followUpDate;
      if (!raw || !raw.includes("T")) continue;
      const ms = Date.parse(raw);
      if (!Number.isFinite(ms)) continue;
      items.push({ id: o.id, t: ms, a: o.assistantId });
    }
    items.sort((x, y) => x.a - y.a || x.t - y.t);
    const ids = new Set<number>();
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length && items[j].a === items[i].a; j++) {
        if (Math.abs(items[j].t - items[i].t) <= CONFLICT_WINDOW_MS) {
          ids.add(items[i].id);
          ids.add(items[j].id);
        } else {
          break; // sorted by time within same assistant
        }
      }
    }
    return ids;
  })();

  // Stats counts (respects current filter since allAppointments is filtered)
  const apptCount = allAppointments.filter(o => o.outcomeType === "appointment").length;
  const callbackCount = allAppointments.filter(o => o.outcomeType === "callback_requested").length;
  const deferralCount = allAppointments.filter(o => o.outcomeType === "deferral" || o.outcomeType === "future_contact").length;
  const overdueCount = overdueList.length;

  // After ANY outcome change — refresh every query so the rest of the app
  // (dashboard counts, leaderboard, EOD stats, etc.) stays in lockstep.
  const refreshAll = () => queryClient.invalidateQueries();

  // Complete mutation — opens dialog flow (Transfer vs Fell Through)
  const completeMutation = useMutation({
    mutationFn: ({ id, type }: { id: number; type: "transfer" | "fell_through" }) => {
      setPendingCompleteId(id);
      const payload: Record<string, any> = { outcomeType: type, followUpDate: null };
      if (type === "transfer") payload.transferType = "appointment";
      return apiRequest("PATCH", `/api/outcomes/${id}`, payload);
    },
    onSuccess: () => {
      refreshAll();
      setPendingCompleteId(null);
      setCompleteTarget(null);
      toast({ title: "Appointment completed" });
    },
    onError: () => {
      setPendingCompleteId(null);
      toast({ title: "Error completing appointment", variant: "destructive" });
    },
  });

  // Quick complete — one-click, marks as transfer without a dialog
  const quickCompleteMutation = useMutation({
    mutationFn: (id: number) => {
      setPendingCompleteId(id);
      return apiRequest("PATCH", `/api/outcomes/${id}`, { outcomeType: "transfer", transferType: "appointment", followUpDate: null });
    },
    onSuccess: () => {
      refreshAll();
      setPendingCompleteId(null);
      toast({ title: "✓ Marked complete" });
    },
    onError: () => {
      setPendingCompleteId(null);
      toast({ title: "Error completing appointment", variant: "destructive" });
    },
  });

  // Notes-only mutation
  const [pendingNotesId, setPendingNotesId] = useState<number | null>(null);
  const notesMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => {
      setPendingNotesId(id);
      return apiRequest("PATCH", `/api/outcomes/${id}`, { notes });
    },
    onSuccess: () => {
      refreshAll();
      setPendingNotesId(null);
      toast({ title: "Notes saved" });
    },
    onError: () => {
      setPendingNotesId(null);
      toast({ title: "Error saving notes", variant: "destructive" });
    },
  });

  // Reschedule mutation (quick date-only update). When the new value is a
  // datetime (datetime-local format includes a 'T'), mirror it onto
  // appointment_datetime as well so the 30-minute reminder cron picks it up.
  const rescheduleMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => {
      setPendingRescheduleId(id);
      const payload: Record<string, any> = { followUpDate: date };
      if (typeof date === "string" && date.includes("T")) {
        payload.appointmentDatetime = date;
      }
      return apiRequest("PATCH", `/api/outcomes/${id}`, payload);
    },
    onSuccess: () => {
      refreshAll();
      setPendingRescheduleId(null);
      toast({ title: "Appointment rescheduled" });
    },
    onError: () => {
      setPendingRescheduleId(null);
      toast({ title: "Error rescheduling", variant: "destructive" });
    },
  });

  // Full edit mutation. Mirror datetime-local values onto appointment_datetime
  // for appointment-typed entries so the 30-minute reminder cron triggers.
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditValues }) => {
      const fud = data.followUpDate || null;
      const payload: Record<string, any> = {
        outcomeType: data.outcomeType,
        loId: data.loId,
        borrowerName: data.borrowerName ?? "",
        notes: data.notes ?? "",
        followUpDate: fud,
      };
      if (data.outcomeType === "appointment") {
        // Sync appointment_datetime: set when there's a time component, clear
        // otherwise so a stale value doesn't shadow the new follow-up date.
        payload.appointmentDatetime =
          fud && typeof fud === "string" && fud.includes("T") ? fud : null;
      }
      return apiRequest("PATCH", `/api/outcomes/${id}`, payload);
    },
    onSuccess: () => {
      refreshAll();
      setEditTarget(null);
      toast({ title: "Appointment updated" });
    },
    onError: () => toast({ title: "Error updating appointment", variant: "destructive" }),
  });

  // Delete mutation — permanently removes the outcome record.
  const deleteMutation = useMutation({
    mutationFn: (id: number) => {
      setPendingDeleteId(id);
      return apiRequest("DELETE", `/api/outcomes/${id}`);
    },
    onSuccess: () => {
      refreshAll();
      setPendingDeleteId(null);
      setDeleteTarget(null);
      toast({ title: "Appointment deleted" });
    },
    onError: () => {
      setPendingDeleteId(null);
      toast({ title: "Error deleting appointment", variant: "destructive" });
    },
  });

  const handleComplete = (outcome: Outcome) => setCompleteTarget(outcome);
  const handleQuickComplete = (id: number) => quickCompleteMutation.mutate(id);
  const handleConfirmComplete = (id: number, type: "transfer" | "fell_through") => completeMutation.mutate({ id, type });
  const handleReschedule = (id: number, date: string) => rescheduleMutation.mutate({ id, date });
  const handleSaveNotes = (id: number, notes: string) => notesMutation.mutate({ id, notes });
  const handleEdit = (outcome: Outcome) => setEditTarget(outcome);
  const handleDelete = (outcome: Outcome) => setDeleteTarget(outcome);
  const handleSubmitEdit = (values: EditValues) => {
    if (!editTarget) return;
    editMutation.mutate({ id: editTarget.id, data: values });
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Upcoming Appointments{" "}
            {!isLoading && <span className="text-muted-foreground font-normal">({totalCount})</span>}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All active appointments — overdue, today, and upcoming — sorted earliest first
          </p>
        </div>
        <HelpIcon title="Appointments">
          All active appointments, callbacks, and deferrals. Mark them complete when done.
        </HelpIcon>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap border-b pb-2">
        {FILTER_TABS.map((tab) => {
          const active = filterType === tab.key;
          return (
            <button
              key={tab.key}
              title={tab.tooltip}
              onClick={() => setFilterType(tab.key)}
              className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border text-muted-foreground"
              }`}
              data-testid={`filter-tab-${tab.key}`}
            >
              {tab.label}
              <span className="ml-1 opacity-70 text-[10px]">ℹ️</span>
            </button>
          );
        })}
      </div>

      {/* Stats bar */}
      {!isLoading && totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs px-3 py-2 rounded-md border border-border bg-muted/30">
          <span className="font-semibold text-foreground">
            {apptCount} <span className="text-muted-foreground font-normal">Appointment{apptCount === 1 ? "" : "s"}</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="font-semibold text-foreground">
            {callbackCount} <span className="text-muted-foreground font-normal">Callback{callbackCount === 1 ? "" : "s"}</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="font-semibold text-foreground">
            {deferralCount} <span className="text-muted-foreground font-normal">Deferral{deferralCount === 1 ? "" : "s"}</span>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className={`font-semibold ${overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
            {overdueCount} <span className="font-normal opacity-70">Overdue</span>
          </span>
        </div>
      )}

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
                clrName={clrNameFor(o.assistantId)} isMine={myUserId != null && o.assistantId === myUserId}
                isConflict={conflictIds.has(o.id)}
                onComplete={handleComplete} onQuickComplete={handleQuickComplete}
                onEdit={handleEdit} onReschedule={handleReschedule} onSaveNotes={handleSaveNotes}
                onDelete={handleDelete}
                isPendingComplete={pendingCompleteId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
                isPendingNotes={pendingNotesId === o.id}
                isPendingDelete={pendingDeleteId === o.id}
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
                clrName={clrNameFor(o.assistantId)} isMine={myUserId != null && o.assistantId === myUserId}
                isConflict={conflictIds.has(o.id)}
                onComplete={handleComplete} onQuickComplete={handleQuickComplete}
                onEdit={handleEdit} onReschedule={handleReschedule} onSaveNotes={handleSaveNotes}
                onDelete={handleDelete}
                isPendingComplete={pendingCompleteId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
                isPendingNotes={pendingNotesId === o.id}
                isPendingDelete={pendingDeleteId === o.id}
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
                clrName={clrNameFor(o.assistantId)} isMine={myUserId != null && o.assistantId === myUserId}
                isConflict={conflictIds.has(o.id)}
                onComplete={handleComplete} onQuickComplete={handleQuickComplete}
                onEdit={handleEdit} onReschedule={handleReschedule} onSaveNotes={handleSaveNotes}
                onDelete={handleDelete}
                isPendingComplete={pendingCompleteId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
                isPendingNotes={pendingNotesId === o.id}
                isPendingDelete={pendingDeleteId === o.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Undated (mostly deferrals) */}
      {!isLoading && undatedList.length > 0 && (
        <section>
          <SectionHeader label="No Date Set" count={undatedList.length} upcoming />
          <div className="space-y-2">
            {undatedList.map((o) => (
              <AppointmentCard
                key={o.id} outcome={o} loName={loMap.get(o.loId) ?? `LO #${o.loId}`}
                clrName={clrNameFor(o.assistantId)} isMine={myUserId != null && o.assistantId === myUserId}
                isConflict={conflictIds.has(o.id)}
                onComplete={handleComplete} onQuickComplete={handleQuickComplete}
                onEdit={handleEdit} onReschedule={handleReschedule} onSaveNotes={handleSaveNotes}
                onDelete={handleDelete}
                isPendingComplete={pendingCompleteId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
                isPendingNotes={pendingNotesId === o.id}
                isPendingDelete={pendingDeleteId === o.id}
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

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.borrowerName?.trim() || "Unknown borrower"} — this permanently removes the outcome record. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
