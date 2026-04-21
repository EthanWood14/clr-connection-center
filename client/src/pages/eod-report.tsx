import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  PhoneCall, TrendingUp, Calendar, ClipboardList, Plus, Trash2,
  CheckCircle2, Clock, ChevronLeft, ChevronRight, FileText, Send, XCircle, Info,
  History, ChevronDown, ChevronUp, User, Users, X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format, subDays, addDays, parseISO } from "date-fns";

const ACTIVITY_TYPES = [
  { value: "follow_up",          label: "Follow-Up Call" },
  { value: "email_sent",         label: "Email Sent" },
  { value: "transfer_assisted",  label: "Transfer Assisted" },
  { value: "appointment_set",    label: "Appointment Set" },
  { value: "lo_contact",         label: "LO Contact" },
  { value: "training",           label: "Training / Meeting" },
  { value: "admin",              label: "Admin Work" },
  { value: "other",              label: "Other" },
];

const ACTIVITY_COLORS: Record<string, string> = {
  follow_up:         "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  email_sent:        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  transfer_assisted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  appointment_set:   "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  lo_contact:        "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  training:          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  admin:             "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  other:             "bg-muted text-muted-foreground",
};

function ReadOnlyStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-muted/50 border border-border/50 flex-1 min-w-[90px]">
      <Icon className={`w-4 h-4 ${color}`} />
      <span className={`text-xl font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide text-center leading-tight">{label}</span>
    </div>
  );
}

export default function EodReport() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = (user as any)?.isAdmin || (user as any)?.role === 'admin';
  const todayStr = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Form state — calls + notes + LO coverage
  const [callsMade, setCallsMade] = useState("");
  const [notes, setNotes]         = useState("");
  const [dirty, setDirty]         = useState(false);
  const [assignedCalled, setAssignedCalled] = useState<number[]>([]);
  const [additionalCalled, setAdditionalCalled] = useState<number[]>([]);
  const [additionalPick, setAdditionalPick] = useState<string>("");

  // Activity form state
  const [activityType, setActivityType] = useState("follow_up");
  const [activityDesc, setActivityDesc] = useState("");

  // EOD report + activities
  const { data, isLoading, refetch } = useQuery<{ report: any; activities: any[] }>({
    queryKey: ["/api/eod-reports", selectedDate],
    queryFn: () => fetch(`/api/eod-reports?date=${selectedDate}`).then(r => r.json()),
  });

  // Today's (selected-date's) assignments for the current CLR
  const { data: dayAssignments = [] } = useQuery<any[]>({
    queryKey: ["/api/assignments", selectedDate],
    queryFn: () => fetch(`/api/assignments?date=${selectedDate}`, { credentials: "include" }).then(r => r.json()),
  });
  const myAssignments = useMemo(
    () => (dayAssignments as any[]).filter(a => (a.assistantId ?? a.assistant_id) === user?.id),
    [dayAssignments, user?.id]
  );
  const assignedLoIdSet = useMemo(() => new Set<number>(myAssignments.map((a: any) => a.loId ?? a.lo_id)), [myAssignments]);

  // All LOs — for the "additional LOs covered" picker
  const { data: allLos = [] } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });
  const loNameById = (id: number): string => {
    const lo = (allLos as any[]).find(l => l.id === id);
    return lo ? (lo.fullName ?? lo.full_name ?? `LO #${id}`) : `LO #${id}`;
  };
  const loAssistantId = (lo: any) => lo.assistantId ?? lo.assistant_id;
  const additionalPickable = useMemo(
    () => (allLos as any[])
      .filter(lo => !assignedLoIdSet.has(lo.id) && !additionalCalled.includes(lo.id) && (lo.isActive ?? lo.is_active ?? 1))
      .sort((a, b) => String(a.fullName ?? a.full_name ?? "").localeCompare(String(b.fullName ?? b.full_name ?? ""))),
    [allLos, assignedLoIdSet, additionalCalled]
  );

  // Today's outcomes for this user — auto-tally transfers/appointments/fell-through
  const { data: allOutcomes = [] } = useQuery<any[]>({ queryKey: ["/api/outcomes"] });
  const dayOutcomes = useMemo(() =>
    (allOutcomes as any[]).filter((o: any) => {
      const oDate = (o.date || o.createdAt || "").slice(0, 10);
      const uid   = o.assistantId || o.assistant_id;
      return oDate === selectedDate && uid === user?.id;
    }),
    [allOutcomes, selectedDate, user?.id]
  );

  const autoTransfers    = dayOutcomes.filter((o: any) => (o.outcomeType || o.outcome_type) === "transfer").length;
  const autoAppointments = dayOutcomes.filter((o: any) => (o.outcomeType || o.outcome_type) === "appointment").length;
  const autoFellThrough  = dayOutcomes.filter((o: any) => (o.outcomeType || o.outcome_type) === "fell_through").length;

  const report     = data?.report ?? null;
  const activities = data?.activities ?? [];

  // Sync form when report/date changes
  const reportKey = `${selectedDate}-${report?.id}`;
  useMemo(() => {
    if (report) {
      setCallsMade(String(report.calls_made ?? report.callsMade ?? ""));
      setNotes(report.notes ?? "");
      setAssignedCalled(Array.isArray(report.assignedLosCalled) ? report.assignedLosCalled : []);
      setAdditionalCalled(Array.isArray(report.additionalLosCalled) ? report.additionalLosCalled : []);
    } else {
      setCallsMade("");
      setNotes("");
      setAssignedCalled([]);
      setAdditionalCalled([]);
    }
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/eod-reports", {
        reportDate:   selectedDate,
        callsMade:    parseInt(callsMade) || 0,
        transfers:    autoTransfers,
        appointments: autoAppointments,
        notes:        notes.trim() || null,
        assignedLosCalled: assignedCalled,
        additionalLosCalled: additionalCalled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/eod-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      refetch();
      setDirty(false);
      toast({ title: "EOD report saved", description: `Report for ${format(parseISO(selectedDate), "MMM d")} saved.` });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const addActivityMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/eod-reports/activities", {
        reportDate:   selectedDate,
        activityType,
        description:  activityDesc.trim(),
      }),
    onSuccess: () => {
      refetch();
      setActivityDesc("");
      toast({ title: "Activity added" });
    },
    onError: () => toast({ title: "Failed to add activity", variant: "destructive" }),
  });

  const deleteActivityMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/eod-reports/activities/${id}`),
    onSuccess: () => { refetch(); toast({ title: "Activity removed" }); },
  });

  function navigateDate(dir: -1 | 1) {
    const d = parseISO(selectedDate);
    setSelectedDate(
      dir === -1
        ? subDays(d, 1).toISOString().split("T")[0]
        : addDays(d, 1).toISOString().split("T")[0]
    );
  }

  const isToday   = selectedDate === todayStr;
  const isFuture  = selectedDate > todayStr;
  const displayDate = format(parseISO(selectedDate), "EEEE, MMMM d, yyyy");

  const callsNum = parseInt(callsMade) || 0;
  const ratioPreview = callsNum > 0
    ? ((autoTransfers / callsNum) * 100).toFixed(1) + "%"
    : null;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> EOD Reporting
          </h1>
          <p className="text-sm text-muted-foreground">
            {isToday ? "Complete before you log off for the day" : "Viewing a past report"}
          </p>
        </div>

        {/* Date navigator */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => navigateDate(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium px-2 min-w-[190px] text-center">{displayDate}</span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => navigateDate(1)} disabled={isToday}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          {!isToday && (
            <Button size="sm" variant="ghost" className="h-8 text-xs px-2" onClick={() => setSelectedDate(todayStr)}>
              Today
            </Button>
          )}
        </div>
      </div>

      {isFuture ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No report for future dates.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          {/* Auto-tallied stats from logged outcomes */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ClipboardList className="w-4 h-4" /> Logged Outcomes Today
                <span className="text-xs font-normal text-muted-foreground ml-1">— pulled from your Lead Outcomes entries</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 flex-wrap">
                <ReadOnlyStat icon={TrendingUp}  label="Transfers"   value={autoTransfers}    color="text-green-600 dark:text-green-400" />
                <ReadOnlyStat icon={Calendar}    label="Appointments" value={autoAppointments} color="text-blue-600 dark:text-blue-400" />
                <ReadOnlyStat icon={XCircle}     label="Fell Through" value={autoFellThrough}  color="text-orange-500 dark:text-orange-400" />
              </div>
              {dayOutcomes.length === 0 && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  No outcomes logged for this date yet. Log them in Lead Outcomes and they'll appear here.
                </p>
              )}
            </CardContent>
          </Card>

          {/* LO Coverage card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="w-4 h-4" /> LO Coverage
                <span className="text-xs font-normal text-muted-foreground ml-1">— which LOs did you call for today?</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Assigned LOs checklist */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your assigned LOs</p>
                {myAssignments.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No LOs assigned for this date.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {myAssignments.map((a: any) => {
                      const loId = a.loId ?? a.lo_id;
                      const loName = a.lo?.fullName ?? a.lo?.full_name ?? loNameById(loId);
                      const checked = assignedCalled.includes(loId);
                      return (
                        <label key={loId} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${checked ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800" : "bg-muted/30 border-border hover:bg-muted/60"}`}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setDirty(true);
                              setAssignedCalled(prev => v ? Array.from(new Set([...prev, loId])) : prev.filter(id => id !== loId));
                            }}
                          />
                          <span className="text-sm">{loName}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Additional LOs picker */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Additional LOs you covered</p>
                <div className="flex gap-2">
                  <Select
                    value={additionalPick}
                    onValueChange={(v) => {
                      const id = parseInt(v);
                      if (!Number.isFinite(id)) return;
                      setDirty(true);
                      setAdditionalCalled(prev => Array.from(new Set([...prev, id])));
                      setAdditionalPick("");
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm flex-1 min-w-0">
                      <SelectValue placeholder={additionalPickable.length ? "Add an LO you covered…" : "No more LOs to add"} />
                    </SelectTrigger>
                    <SelectContent>
                      {additionalPickable.map((lo: any) => (
                        <SelectItem key={lo.id} value={String(lo.id)}>
                          {lo.fullName ?? lo.full_name ?? `LO #${lo.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {additionalCalled.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">None added.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {additionalCalled.map(id => (
                      <Badge key={id} variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs">
                        {loNameById(id)}
                        <button
                          type="button"
                          onClick={() => { setDirty(true); setAdditionalCalled(prev => prev.filter(x => x !== id)); }}
                          className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label={`Remove ${loNameById(id)}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Summary card — calls + notes only */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <PhoneCall className="w-4 h-4" /> Daily Summary
                </CardTitle>
                {report && !dirty && (
                  <Badge className="text-xs bg-green-600 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Submitted
                  </Badge>
                )}
                {dirty && (
                  <Badge variant="outline" className="text-xs text-orange-500 border-orange-300">
                    Unsaved changes
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Calls made — the one manual entry */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <PhoneCall className="w-3.5 h-3.5" /> Total Calls Made
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number" min={0} placeholder="Enter your total calls for the day"
                    value={callsMade}
                    onChange={e => { setCallsMade(e.target.value); setDirty(true); }}
                    className="h-9 max-w-[200px]"
                  />
                  {ratioPreview && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-primary" />
                      Transfer/Call: <strong className="text-foreground ml-0.5">{ratioPreview}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notes / Comments</label>
                <Textarea
                  placeholder="Anything notable about today? Challenges, wins, feedback from LOs..."
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setDirty(true); }}
                  className="min-h-[80px] resize-none text-sm"
                />
              </div>

              <Button
                className="w-full gap-2"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || (!dirty && !!report)}
              >
                {saveMutation.isPending ? (
                  <><Clock className="w-4 h-4 animate-spin" /> Saving…</>
                ) : report && !dirty ? (
                  <><CheckCircle2 className="w-4 h-4" /> Already submitted</>
                ) : (
                  <><Send className="w-4 h-4" /> {report ? "Update Report" : "Submit Report"}</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Plus className="w-4 h-4" /> Additional Activity Log
                <span className="text-xs font-normal text-muted-foreground ml-1">— any other notable work done today not mentioned</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Select value={activityType} onValueChange={setActivityType}>
                  <SelectTrigger className="w-48 h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Brief description..."
                  value={activityDesc}
                  onChange={e => setActivityDesc(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && activityDesc.trim()) addActivityMutation.mutate(); }}
                  className="flex-1 min-w-[160px] h-9 text-sm"
                />
                <Button
                  size="sm" className="h-9 gap-1.5"
                  onClick={() => addActivityMutation.mutate()}
                  disabled={!activityDesc.trim() || addActivityMutation.isPending}
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>

              {activities.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No additional activities logged yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {activities.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Badge className={`text-xs shrink-0 ${ACTIVITY_COLORS[a.activity_type] ?? ACTIVITY_COLORS.other}`}>
                          {ACTIVITY_TYPES.find(t => t.value === a.activity_type)?.label ?? a.activity_type}
                        </Badge>
                        <span className="text-sm truncate">{a.description}</span>
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => deleteActivityMutation.mutate(a.id)}
                        disabled={deleteActivityMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-center pb-2">
            Your EOD report feeds the daily, weekly, and monthly performance analytics in Team Stats.
          </p>
        </>
      )}

      {/* ── Report History ── */}
      <ReportHistory isAdmin={isAdmin} />
    </div>
  );
}

// ── Report History Component ────────────────────────────────────────────────
function ReportHistory({ isAdmin }: { isAdmin: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: history = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/eod-reports/history"],
    queryFn: () => fetch("/api/eod-reports/history", { credentials: "include" }).then(r => r.json()),
  });

  if (isLoading) return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
    </div>
  );

  if (history.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        No past reports yet.
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Report History</h2>
        {isAdmin && <span className="text-xs text-muted-foreground">(all CLRs)</span>}
      </div>

      <div className="space-y-2">
        {history.map((r: any) => {
          const dateLabel = format(parseISO(r.report_date), "EEE, MMM d, yyyy");
          const isOpen = expanded === r.id;
          const calls = r.calls_made ?? 0;
          const xfers = r.transfers ?? 0;
          const appts = r.appointments ?? 0;

          return (
            <Card key={r.id} className="border border-border overflow-hidden">
              <button
                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isOpen ? null : r.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{dateLabel}</span>
                      {isAdmin && r.clr_name && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="w-3 h-3" />{r.clr_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">{calls} calls</span>
                      <span className="text-xs text-emerald-600 font-medium">{xfers} transfers</span>
                      <span className="text-xs text-blue-600">{appts} appts</span>
                    </div>
                  </div>
                </div>
                {isOpen
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-border bg-muted/20 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Calls", val: calls, color: "text-foreground" },
                      { label: "Transfers", val: xfers, color: "text-emerald-600" },
                      { label: "Appointments", val: appts, color: "text-blue-600" },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg bg-background border border-border px-3 py-2 text-center">
                        <div className={`text-xl font-bold ${s.color}`}>{s.val}</div>
                        <div className="text-xs text-muted-foreground">{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Transfer prospect names */}
                  {xfers > 0 && (
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 px-3 py-2.5 space-y-1.5">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Transfer Prospects</p>
                      {r.transferProspects && r.transferProspects.length > 0 ? (
                        <div className="space-y-1">
                          {r.transferProspects.map((p: any, i: number) => {
                            // Back-compat: older cached responses may have returned string[] instead of { name, transferType }
                            const name = typeof p === "string" ? p : p?.name;
                            const tt = typeof p === "string" ? null : p?.transferType;
                            const ttLabel = tt === "direct" ? "Direct" : tt === "appointment" ? "Appt" : null;
                            return (
                              <div key={i} className="flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold shrink-0">{i + 1}</span>
                                <span className="text-xs font-medium text-emerald-900 dark:text-emerald-300">{name}</span>
                                {ttLabel && (
                                  <span className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80">({ttLabel})</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">Names not recorded for these transfers.</p>
                      )}
                    </div>
                  )}

                  {/* LO Coverage */}
                  {r.loCoverage && ((r.loCoverage.assignedCalled?.length ?? 0) + (r.loCoverage.notCalled?.length ?? 0) + (r.loCoverage.additional?.length ?? 0) > 0) && (
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 px-3 py-2.5 space-y-2">
                      <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">LO Coverage</p>
                      {r.loCoverage.assignedCalled?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">
                            Assigned called ({r.loCoverage.assignedCalled.length}{r.loCoverage.notCalled?.length ? `/${r.loCoverage.assignedCalled.length + r.loCoverage.notCalled.length}` : ""})
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {r.loCoverage.assignedCalled.map((n: string, i: number) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">{n}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.loCoverage.notCalled?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-400 mb-1">Not called ({r.loCoverage.notCalled.length})</p>
                          <div className="flex flex-wrap gap-1">
                            {r.loCoverage.notCalled.map((n: string, i: number) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200">{n}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.loCoverage.additional?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400 mb-1">Additional covered ({r.loCoverage.additional.length})</p>
                          <div className="flex flex-wrap gap-1">
                            {r.loCoverage.additional.map((n: string, i: number) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200">{n}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Notes */}
                  {r.notes && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Notes</p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{r.notes}</p>
                    </div>
                  )}

                  {r.submitted_at && (
                    <p className="text-xs text-muted-foreground">Submitted: {format(new Date(r.submitted_at), "MMM d, yyyy 'at' h:mm a")}</p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
