import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, parseISO, isToday, isPast, format } from "date-fns";
import {
  CheckCircle2,
  CalendarClock,
  Clock,
  AlertCircle,
  RefreshCw,
  X,
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

// ─── Constants ────────────────────────────────────────────────────────────────

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer",
  appointment: "Appointment",
  fell_through: "Fell Through",
  no_answer: "No Answer",
  callback_requested: "Callback",
  deferral: "Deferral",
  future_contact: "Deferral",
  not_interested: "Not Interested",
  wrong_number: "Wrong Number",
  other: "Other",
};

const OUTCOME_COLORS: Record<string, string> = {
  transfer: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  appointment: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  fell_through: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  callback_requested: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  deferral: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  future_contact: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  no_answer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  not_interested: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  wrong_number: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

// ─── Follow-up Card ───────────────────────────────────────────────────────────

function AppointmentCard({
  outcome,
  loName,
  onMarkContacted,
  onReschedule,
  isPendingMark,
  isPendingReschedule,
}: {
  outcome: Outcome;
  loName: string;
  onMarkContacted: (id: number) => void;
  onReschedule: (id: number, date: string) => void;
  isPendingMark: boolean;
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
  const overdueDays = followUpParsed
    ? Math.floor((new Date().setHours(0, 0, 0, 0) - followUpParsed.setHours(0, 0, 0, 0)) / 86400000)
    : 0;

  return (
    <Card
      className="border border-border hover:border-primary/30 transition-colors"
      data-testid={`card-appointment-${outcome.id}`}
    >
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: Info */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Top row: borrower + outcome badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-sm font-semibold text-foreground truncate"
                data-testid={`text-borrower-${outcome.id}`}
              >
                {outcome.borrowerName || "Unknown Borrower"}
              </span>
              <Badge
                className={`text-xs px-2 py-0.5 border-0 ${OUTCOME_COLORS[outcome.outcomeType] ?? OUTCOME_COLORS.other}`}
              >
                {OUTCOME_LABELS[outcome.outcomeType] ?? outcome.outcomeType}
              </Badge>
            </div>

            {/* LO name + original date */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground/70">LO:</span>{" "}
                {loName}
              </span>
              <span>
                <span className="font-medium text-foreground/70">Logged:</span>{" "}
                {outcome.date ? format(parseISO(outcome.date), "MMM d, yyyy") : "—"}
              </span>
              {outcome.followUpDate && (
                <span>
                  <span className="font-medium text-foreground/70">Follow-up:</span>{" "}
                  {format(
                    parseISO(outcome.followUpDate),
                    outcome.followUpDate.includes("T") ? "MMM d · h:mm a" : "MMM d, yyyy",
                  )}
                </span>
              )}
            </div>

            {/* Notes */}
            {outcome.notes && (
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {outcome.notes}
              </p>
            )}

            {/* Reschedule inline input */}
            {rescheduling && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Input
                  type="datetime-local"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-8 text-xs w-52"
                  min={new Date().toISOString().slice(0, 16)}
                  data-testid={`input-reschedule-${outcome.id}`}
                />
                <span className="text-[10px] text-muted-foreground">
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </span>
                <Button
                  size="sm"
                  className="h-8 text-xs px-3"
                  onClick={handleReschedule}
                  disabled={!newDate || isPendingReschedule}
                  data-testid={`button-confirm-reschedule-${outcome.id}`}
                >
                  {isPendingReschedule ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs px-2"
                  onClick={() => { setRescheduling(false); setNewDate(""); }}
                >
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
              onClick={() => onMarkContacted(outcome.id)}
              disabled={isPendingMark}
              data-testid={`button-mark-contacted-${outcome.id}`}
            >
              {isPendingMark ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3 h-3" />
              )}
              Mark Contacted
            </Button>
            {!rescheduling && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => setRescheduling(true)}
                data-testid={`button-reschedule-${outcome.id}`}
              >
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

function SectionHeader({
  label,
  count,
  overdue,
}: {
  label: string;
  count: number;
  overdue?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {overdue ? (
        <AlertCircle className="w-4 h-4 text-red-500" />
      ) : (
        <Clock className="w-4 h-4 text-primary" />
      )}
      <h2
        className={`text-sm font-semibold tracking-wide ${
          overdue ? "text-red-600 dark:text-red-400" : "text-primary"
        }`}
      >
        {label}
      </h2>
      <Badge
        variant="outline"
        className={`text-xs px-1.5 py-0 ${
          overdue
            ? "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400"
            : "border-primary/40 text-primary"
        }`}
      >
        {count}
      </Badge>
    </div>
  );
}

// ─── Date Group ───────────────────────────────────────────────────────────────

function DateGroup({
  date,
  outcomes,
  loMap,
  onMarkContacted,
  onReschedule,
  pendingMarkId,
  pendingRescheduleId,
}: {
  date: string;
  outcomes: Outcome[];
  loMap: Map<number, string>;
  onMarkContacted: (id: number) => void;
  onReschedule: (id: number, date: string) => void;
  pendingMarkId: number | null;
  pendingRescheduleId: number | null;
}) {
  const parsed = parseISO(date);
  const today = isToday(parsed);
  const daysDiff = today
    ? 0
    : Math.floor((new Date().setHours(0, 0, 0, 0) - parsed.setHours(0, 0, 0, 0)) / 86400000);

  return (
    <div className="mb-6">
      {/* Date sub-header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-mono text-muted-foreground">
          {format(parsed, "EEEE, MMM d")}
        </span>
        {today ? (
          <Badge className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border border-primary/30">
            Today
          </Badge>
        ) : (
          <Badge className="text-[10px] px-1.5 py-0 bg-red-50 text-red-600 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700">
            {daysDiff === 1 ? "1 day overdue" : `${daysDiff} days overdue`}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {outcomes.map((o) => (
          <AppointmentCard
            key={o.id}
            outcome={o}
            loName={loMap.get(o.loId) ?? `LO #${o.loId}`}
            onMarkContacted={onMarkContacted}
            onReschedule={onReschedule}
            isPendingMark={pendingMarkId === o.id}
            isPendingReschedule={pendingRescheduleId === o.id}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Appointments() {
  const { toast } = useToast();
  const [pendingMarkId, setPendingMarkId] = useState<number | null>(null);
  const [pendingRescheduleId, setPendingRescheduleId] = useState<number | null>(null);

  const { data: outcomes = [], isLoading: loadingOutcomes } = useQuery<Outcome[]>({
    queryKey: ["/api/outcomes"],
  });

  const { data: los = [], isLoading: loadingLos } = useQuery<LoanOfficer[]>({
    queryKey: ["/api/loan-officers"],
  });

  const isLoading = loadingOutcomes || loadingLos;

  // Build LO name map
  const loMap = new Map<number, string>(los.map((lo) => [lo.id, lo.fullName]));

  // Filter: followUpDate not null AND date portion <= today
  const todayStr = new Date().toISOString().split("T")[0];
  // Extract the YYYY-MM-DD portion so datetime values compare correctly.
  const datePart = (s: string) => (s.length >= 10 ? s.slice(0, 10) : s);

  const dueOutcomes = outcomes.filter(
    (o) => o.followUpDate != null && datePart(o.followUpDate) <= todayStr
  );

  // Separate today vs overdue
  const todayOutcomes = dueOutcomes.filter((o) => datePart(o.followUpDate!) === todayStr);
  const overdueOutcomes = dueOutcomes.filter((o) => datePart(o.followUpDate!) < todayStr);

  // Group overdue by date (date portion only), oldest first
  const overdueByDate = overdueOutcomes.reduce<Map<string, Outcome[]>>((acc, o) => {
    const key = datePart(o.followUpDate!);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(o);
    return acc;
  }, new Map());

  // Sort dates oldest first
  const sortedOverdueDates = Array.from(overdueByDate.keys()).sort();

  // Mutations
  const markContactedMutation = useMutation({
    mutationFn: (id: number) => {
      setPendingMarkId(id);
      return apiRequest("PATCH", `/api/outcomes/${id}`, { followUpDate: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      setPendingMarkId(null);
      toast({ title: "Marked as contacted" });
    },
    onError: () => {
      setPendingMarkId(null);
      toast({ title: "Error updating appointment", variant: "destructive" });
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
      toast({ title: "Follow-up rescheduled" });
    },
    onError: () => {
      setPendingRescheduleId(null);
      toast({ title: "Error rescheduling appointment", variant: "destructive" });
    },
  });

  const handleMarkContacted = (id: number) => {
    markContactedMutation.mutate(id);
  };

  const handleReschedule = (id: number, date: string) => {
    rescheduleMutation.mutate({ id, date });
  };

  const totalCount = dueOutcomes.length;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">
          Appointments{" "}
          {!isLoading && (
            <span className="text-muted-foreground font-normal">
              ({totalCount})
            </span>
          )}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Leads that need a appointment call today or are overdue
        </p>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && totalCount === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">All caught up!</p>
              <p className="text-sm text-muted-foreground mt-1">
                No appointments are due today. Check back tomorrow.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overdue section */}
      {!isLoading && sortedOverdueDates.length > 0 && (
        <section>
          <SectionHeader
            label="Overdue"
            count={overdueOutcomes.length}
            overdue
          />
          {sortedOverdueDates.map((date) => (
            <DateGroup
              key={date}
              date={date}
              outcomes={overdueByDate.get(date)!}
              loMap={loMap}
              onMarkContacted={handleMarkContacted}
              onReschedule={handleReschedule}
              pendingMarkId={pendingMarkId}
              pendingRescheduleId={pendingRescheduleId}
            />
          ))}
        </section>
      )}

      {/* Today section */}
      {!isLoading && todayOutcomes.length > 0 && (
        <section>
          <SectionHeader label="Due Today" count={todayOutcomes.length} />
          <div className="space-y-2">
            {todayOutcomes.map((o) => (
              <AppointmentCard
                key={o.id}
                outcome={o}
                loName={loMap.get(o.loId) ?? `LO #${o.loId}`}
                onMarkContacted={handleMarkContacted}
                onReschedule={handleReschedule}
                isPendingMark={pendingMarkId === o.id}
                isPendingReschedule={pendingRescheduleId === o.id}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
