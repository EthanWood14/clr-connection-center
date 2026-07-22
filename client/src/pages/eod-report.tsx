import { useState, useMemo, useEffect, useRef } from "react";
import { useSearch } from "wouter";
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
  History, ChevronDown, ChevronUp, User, Users, X, Save, Printer, MessageSquare, Pencil, Check,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpIcon, markStep } from "@/components/onboarding";
import { format, subDays, addDays, parseISO } from "date-fns";
import { parseServerTimestamp } from "@/lib/dates";
import { businessTodayClient } from "@/lib/business-day";

const ACTIVITY_TYPES = [
  { value: "follow_up",          label: "Follow-Up Call" },
  { value: "email_sent",         label: "Email Sent" },
  { value: "transfer_assisted",  label: "Transfer Assisted" },
  { value: "appointment_set",    label: "Appointment Set" },
  { value: "lo_contact",         label: "LO Contact" },
  { value: "training",           label: "Training / Meeting" },
  { value: "project_work",       label: "Project Work" },
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
  project_work:      "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
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
  const todayStr = businessTodayClient();
  // Honor a ?date=YYYY-MM-DD query param so prompts / reminder emails and the
  // EOD lock gate can deep-link to a specific missed day instead of dumping the
  // user on today. Under wouter's hash routing, navigate("/eod-report?date=X")
  // puts the query into window.location.search (URL becomes "?date=X#/eod-report"),
  // so we must read the real query string — not the hash. We still check the
  // hash as a fallback for any old-style "#/eod-report?date=X" links.
  const search = useSearch();
  const parseDateParam = (...sources: string[]): string | null => {
    for (const src of sources) {
      if (!src) continue;
      try {
        const qIdx = src.indexOf("?");
        const qs = qIdx >= 0 ? src.slice(qIdx + 1) : src;
        const d = new URLSearchParams(qs).get("date");
        if (d && d.length === 10 && d[4] === "-" && d[7] === "-") return d;
      } catch {}
    }
    return null;
  };
  const initialDate = (() => {
    if (typeof window === "undefined") return todayStr;
    return parseDateParam(search, window.location.search, window.location.hash) ?? todayStr;
  })();
  const [selectedDate, setSelectedDate] = useState(initialDate);

  // If the ?date= param changes after mount (e.g. the user clicks a different
  // missing day in the lock gate while the page is already mounted), follow it.
  useEffect(() => {
    const d = parseDateParam(search, typeof window !== "undefined" ? window.location.search : "");
    if (d && d !== selectedDate) setSelectedDate(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Form state — calls + messages + notes + LO coverage
  const [callsMade, setCallsMade] = useState("");
  const [messagesSent, setMessagesSent] = useState("");
  const [notes, setNotes]         = useState("");
  const [dirty, setDirty]         = useState(false);
  const [assignedCalled, setAssignedCalled] = useState<number[]>([]);
  const [additionalCalled, setAdditionalCalled] = useState<number[]>([]);
  const [additionalPick, setAdditionalPick] = useState<string>("");
  const [additionalOtherNotes, setAdditionalOtherNotes] = useState<string>("");
  const [showOtherInput, setShowOtherInput] = useState(false);

  // Activity form state
  const [activityType, setActivityType] = useState("follow_up");
  const [activityDesc, setActivityDesc] = useState("");
  const [editingActivityId, setEditingActivityId] = useState<number | null>(null);
  const [editActivityType, setEditActivityType] = useState("follow_up");
  const [editActivityDesc, setEditActivityDesc] = useState("");

  // ── EOD draft (auto-save) ──────────────────────────────────────────────
  const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);
  const [draftBannerDismissed, setDraftBannerDismissed] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLoadedRef = useRef(false);
  const skipAutoSaveRef = useRef(false);

  // EOD report + activities
  const { data, isLoading, refetch } = useQuery<{ report: any; activities: any[] }>({
    queryKey: ["/api/eod-reports", selectedDate],
    queryFn: () => fetch(`/api/eod-reports?date=${selectedDate}`).then(r => r.json()),
  });

  // Today's report (independent of selectedDate) — drives whether the user is
  // allowed to navigate to tomorrow and whether tomorrow is treated as a
  // normal in-progress EOD page.
  const { data: todayData } = useQuery<{ report: any; activities: any[] }>({
    queryKey: ["/api/eod-reports", todayStr, "today-flag"],
    queryFn: () => fetch(`/api/eod-reports?date=${todayStr}`).then(r => r.json()),
    staleTime: 30_000,
  });
  const todaySubmitted = !!todayData?.report;

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
      .filter(lo => {
        if (assignedLoIdSet.has(lo.id) || additionalCalled.includes(lo.id)) return false;
        // Only currently-active LOs (same definition the assignment generator
        // uses): active flag set, internal status "active", and not snoozed.
        if (!(lo.isActive ?? lo.is_active ?? 1)) return false;
        const status = String(lo.internalStatus ?? lo.internal_status ?? "active").toLowerCase();
        if (status !== "active") return false;
        const sn = lo.snoozeUntil ?? lo.snooze_until;
        if (sn && new Date(sn).getTime() > Date.now()) return false;
        return true;
      })
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

  const outcomeCount = (t: string) =>
    dayOutcomes.filter((o: any) => (o.outcomeType || o.outcome_type) === t).length;
  const autoTransfers    = outcomeCount("transfer");
  const autoAppointments = outcomeCount("appointment");
  const autoFellThrough  = outcomeCount("fell_through");
  const autoCallbacks    = outcomeCount("callback_requested");
  const autoDeferrals    = outcomeCount("deferral");
  const autoFuture       = outcomeCount("future_contact");
  const autoNoAnswer     = outcomeCount("no_answer");
  const autoTotalLogged  = dayOutcomes.length;

  const report     = data?.report ?? null;
  const activities = data?.activities ?? [];

  // Sync form when report/date changes
  const reportKey = `${selectedDate}-${report?.id}`;
  useMemo(() => {
    if (report) {
      setCallsMade(String(report.calls_made ?? report.callsMade ?? ""));
      setMessagesSent(String(report.messages_sent ?? report.messagesSent ?? ""));
      setNotes(report.notes ?? "");
      setAssignedCalled(Array.isArray(report.assignedLosCalled) ? report.assignedLosCalled : []);
      setAdditionalCalled(Array.isArray(report.additionalLosCalled) ? report.additionalLosCalled : []);
      const savedOther = (report.additionalLosOtherNotes ?? report.additional_los_other_notes ?? "") as string;
      setAdditionalOtherNotes(savedOther || "");
      setShowOtherInput(!!savedOther);
    } else {
      setCallsMade("");
      setMessagesSent("");
      setNotes("");
      setAssignedCalled([]);
      setAdditionalCalled([]);
      setAdditionalOtherNotes("");
      setShowOtherInput(false);
    }
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  // Load the persisted draft once on mount. Only runs for today's page and
  // only when no report has been submitted yet — a submitted report always
  // wins, since the draft is meant to hold an in-progress first submission.
  useEffect(() => {
    if (draftLoadedRef.current) return;
    if (selectedDate !== todayStr) return;
    if (isLoading) return;
    if (report) { draftLoadedRef.current = true; return; }
    draftLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/eod/draft", { credentials: "include" });
        if (!res.ok) return;
        const body = await res.json();
        if (!body || !body.data) return;
        const d = body.data;
        skipAutoSaveRef.current = true;
        if (typeof d.callsMade === "string") setCallsMade(d.callsMade);
        if (typeof d.messagesSent === "string") setMessagesSent(d.messagesSent);
        if (typeof d.notes === "string") setNotes(d.notes);
        if (Array.isArray(d.assignedCalled)) setAssignedCalled(d.assignedCalled);
        if (Array.isArray(d.additionalCalled)) setAdditionalCalled(d.additionalCalled);
        if (typeof d.additionalOtherNotes === "string") setAdditionalOtherNotes(d.additionalOtherNotes);
        if (typeof d.showOtherInput === "boolean") setShowOtherInput(d.showOtherInput);
        setDirty(true);
        setDraftRestoredAt(body.updatedAt ?? null);
        if (body.updatedAt) setDraftSavedAt(new Date(body.updatedAt));
        setTimeout(() => { skipAutoSaveRef.current = false; }, 50);
      } catch { /* ignore — draft restore is best-effort */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, todayStr, isLoading, report]);

  async function saveDraft(silent: boolean): Promise<boolean> {
    try {
      if (!silent) setDraftSaving(true);
      const res = await fetch("/api/eod/draft", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            selectedDate,
            callsMade,
            messagesSent,
            notes,
            assignedCalled,
            additionalCalled,
            additionalOtherNotes,
            showOtherInput,
          },
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setDraftSavedAt(new Date());
      return true;
    } catch (e: any) {
      if (!silent) toast({ title: "Draft save failed", description: e?.message ?? "", variant: "destructive" });
      return false;
    } finally {
      if (!silent) setDraftSaving(false);
    }
  }

  // Debounced auto-save — fires 500ms after the last form edit while on today.
  useEffect(() => {
    if (selectedDate !== todayStr) return;
    if (!dirty) return;
    if (skipAutoSaveRef.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { void saveDraft(true); }, 500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsMade, messagesSent, notes, assignedCalled, additionalCalled, additionalOtherNotes, showOtherInput, selectedDate, todayStr, dirty]);

  async function clearDraft(resetForm: boolean) {
    try {
      await fetch("/api/eod/draft", { method: "DELETE", credentials: "include" });
    } catch { /* best effort */ }
    setDraftRestoredAt(null);
    setDraftSavedAt(null);
    setDraftBannerDismissed(true);
    if (resetForm) {
      skipAutoSaveRef.current = true;
      setCallsMade("");
      setNotes("");
      setAssignedCalled([]);
      setAdditionalCalled([]);
      setAdditionalOtherNotes("");
      setShowOtherInput(false);
      setDirty(false);
      setTimeout(() => { skipAutoSaveRef.current = false; }, 50);
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/eod-reports", {
        reportDate:   selectedDate,
        // null when blank so the server rejects it rather than silently filing a 0.
        callsMade:    callsMade.trim() === "" ? null : (parseInt(callsMade) || 0),
        messagesSent: parseInt(messagesSent) || 0,
        transfers:    autoTransfers,
        appointments: autoAppointments,
        notes:        notes.trim() || null,
        assignedLosCalled: assignedCalled,
        additionalLosCalled: additionalCalled,
        additionalLosOtherNotes: additionalOtherNotes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/eod-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/eod-lock-status"] });
      refetch();
      setDirty(false);
      // Final submission succeeded — draft is no longer needed.
      void clearDraft(false);
      markStep(user?.id, "submit_eod");
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

  const updateActivityMutation = useMutation({
    mutationFn: (v: { id: number; activityType: string; description: string }) =>
      apiRequest("PATCH", `/api/eod-reports/activities/${v.id}`, { activityType: v.activityType, description: v.description }),
    onSuccess: () => { refetch(); setEditingActivityId(null); toast({ title: "Activity updated" }); },
    onError: () => toast({ title: "Failed to update activity", variant: "destructive" }),
  });

  function startEditActivity(a: any) {
    setEditingActivityId(a.id);
    setEditActivityType(a.activity_type);
    setEditActivityDesc(a.description ?? "");
  }
  function saveEditActivity(id: number) {
    if (!editActivityDesc.trim()) return;
    updateActivityMutation.mutate({ id, activityType: editActivityType, description: editActivityDesc.trim() });
  }

  function navigateDate(dir: -1 | 1) {
    const d = parseISO(selectedDate);
    setSelectedDate(
      dir === -1
        ? subDays(d, 1).toISOString().split("T")[0]
        : addDays(d, 1).toISOString().split("T")[0]
    );
  }

  const tomorrowStr = addDays(parseISO(todayStr), 1).toISOString().split("T")[0];
  const isToday    = selectedDate === todayStr;
  const isTomorrow = selectedDate === tomorrowStr;
  // Once today's EOD is submitted, tomorrow becomes a regular in-progress day.
  const isFuture   = selectedDate > todayStr && !(isTomorrow && todaySubmitted);
  // Allow the right arrow to move to tomorrow once today is submitted.
  const canGoForward = !isFuture && !(isTomorrow);
  const displayDate = format(parseISO(selectedDate), "EEEE, MMMM d, yyyy");

  // Calls made is mandatory on the EOD — blank blocks submission (0 is fine).
  const callsValid = callsMade.trim() !== "" && Number.isFinite(Number(callsMade)) && Number(callsMade) >= 0;
  const callsNum = parseInt(callsMade) || 0;
  const ratioPreview = callsNum > 0
    ? ((autoTransfers / callsNum) * 100).toFixed(1) + "%"
    : null;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl mx-auto print-report">
      {/* Print-only header (West Capital Lending) */}
      <div className="print-only print-header">
        <img src="/wcl-logo.png" alt="West Capital Lending" className="print-logo" />
        <div className="print-title">End-of-Day Report — {displayDate}</div>
      </div>

      {/* Print-only full report sheet. Renders a complete value-based
          export when the user clicks "Print / Export PDF" on a submitted
          past report. All interactive form controls are hidden during print. */}
      {!isToday && report && (
        <EodPrintSheet
          report={report}
          activities={activities}
          displayDate={displayDate}
          callsMade={Number((report as any).calls_made ?? (report as any).callsMade ?? 0)}
          messagesSent={Number((report as any).messages_sent ?? (report as any).messagesSent ?? 0)}
          autoTransfers={autoTransfers}
          autoAppointments={autoAppointments}
          autoFellThrough={autoFellThrough}
          autoCallbacks={autoCallbacks}
          autoDeferrals={autoDeferrals}
          autoFuture={autoFuture}
          autoNoAnswer={autoNoAnswer}
          autoTotalLogged={autoTotalLogged}
          fallbackUser={user}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />{" "}
            {isToday && report
              ? "Resubmit EOD Report"
              : isTomorrow && todaySubmitted
                ? "EOD Reporting — Tomorrow"
                : "EOD Reporting"}
            <HelpIcon title="EOD Report">
              Submit your end-of-day summary. Include which LOs you called for, and add any notable notes. This sends an email to your managers.
            </HelpIcon>
          </h1>
          <p className="text-sm text-muted-foreground">
            {isToday && report
              ? "Today's report is in. You can edit and resubmit, or start tomorrow."
              : isToday
                ? "Complete before you log off for the day"
                : isTomorrow && todaySubmitted
                  ? "Anything you log now will count toward tomorrow's report."
                  : "Viewing a past report"}
          </p>
        </div>

        {/* Date navigator */}
        <div className="flex items-center gap-2 flex-wrap">
          {!isToday && report && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.print()}
              data-testid="button-print-eod-report"
              className="h-9"
            >
              <Printer className="w-4 h-4 mr-1.5" />
              Print / Export PDF
            </Button>
          )}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => navigateDate(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium px-2 min-w-[190px] text-center">{displayDate}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => navigateDate(1)}
            disabled={!canGoForward || (isToday && !todaySubmitted)}
            title={isToday && !todaySubmitted ? "Submit today's EOD to unlock tomorrow" : ""}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          {!isToday && (
            <Button size="sm" variant="ghost" className="h-8 text-xs px-2" onClick={() => setSelectedDate(todayStr)}>
              Today
            </Button>
          )}
          </div>
        </div>
      </div>

      {isFuture ? (
        <Card className="no-print">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No report for future dates.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4 no-print">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="no-print space-y-6">
          {/* Restored-draft banner — appears once per load if a draft was found */}
          {draftRestoredAt && !draftBannerDismissed && !report && (
            <Card className="border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
              <CardContent className="py-3 px-4 flex flex-wrap items-center gap-3">
                <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                <p className="text-xs text-amber-900 dark:text-amber-200 flex-1 min-w-[200px]">
                  You have a saved draft from{" "}
                  <strong>{format(parseServerTimestamp(draftRestoredAt) ?? new Date(), "MMM d, h:mm a")}</strong>. Your progress has been restored.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  onClick={() => { void clearDraft(true); }}
                >
                  <Trash2 className="w-3 h-3" /> Clear Draft
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-amber-700 hover:text-amber-900"
                  onClick={() => setDraftBannerDismissed(true)}
                  aria-label="Dismiss banner"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Auto-tallied stats from logged outcomes */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ClipboardList className="w-4 h-4" /> Logged Outcomes Today
                <span className="text-xs font-normal text-muted-foreground ml-1">— pulled from your Lead Outcomes entries</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <ReadOnlyStat icon={TrendingUp}    label="Transfers"    value={autoTransfers}    color="text-green-600 dark:text-green-400" />
                <ReadOnlyStat icon={Calendar}      label="Appointments" value={autoAppointments} color="text-blue-600 dark:text-blue-400" />
                <ReadOnlyStat icon={XCircle}       label="Fell Through" value={autoFellThrough}  color="text-orange-500 dark:text-orange-400" />
                <ReadOnlyStat icon={PhoneCall}     label="Callbacks"    value={autoCallbacks}    color="text-amber-600 dark:text-amber-400" />
                <ReadOnlyStat icon={Clock}         label="Future"       value={autoFuture}       color="text-indigo-600 dark:text-indigo-400" />
                <ReadOnlyStat icon={ClipboardList} label="No Answer"    value={autoNoAnswer}     color="text-muted-foreground" />
              </div>
              <div className="mt-3 flex items-center justify-between px-1 text-xs">
                <span className="text-muted-foreground">Total logged today</span>
                <span className="font-semibold tabular-nums">{autoTotalLogged}</span>
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
                      if (v === "__other__") {
                        setShowOtherInput(true);
                        setAdditionalPick("");
                        return;
                      }
                      const id = parseInt(v);
                      if (!Number.isFinite(id)) return;
                      setDirty(true);
                      setAdditionalCalled(prev => Array.from(new Set([...prev, id])));
                      setAdditionalPick("");
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm flex-1 min-w-0">
                      <SelectValue placeholder={additionalPickable.length ? "Add an LO you covered…" : "Add an LO…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {additionalPickable.map((lo: any) => (
                        <SelectItem key={lo.id} value={String(lo.id)}>
                          {lo.fullName ?? lo.full_name ?? `LO #${lo.id}`}
                        </SelectItem>
                      ))}
                      <SelectItem value="__other__">Other…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {additionalCalled.length === 0 && !additionalOtherNotes && !showOtherInput ? (
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

                {showOtherInput && (
                  <div className="mt-2 space-y-1.5 border border-dashed border-border rounded-lg p-2.5 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">Other — enter LO name or description</label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowOtherInput(false);
                          setAdditionalOtherNotes("");
                          setDirty(true);
                        }}
                        className="rounded-full hover:bg-destructive/20 p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Remove other"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <Input
                      placeholder="e.g. John Smith (new LO) or an external LO name"
                      value={additionalOtherNotes}
                      onChange={e => { setAdditionalOtherNotes(e.target.value); setDirty(true); }}
                      className="h-8 text-sm"
                    />
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

              {/* Calls made — the one manual entry, and it's REQUIRED. Enter 0 if
                  you genuinely made none; the report can't be submitted blank. */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <PhoneCall className="w-3.5 h-3.5" /> Total Calls Made <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number" min={0} placeholder="Required — enter your total calls (0 if none)"
                    value={callsMade}
                    onChange={e => { setCallsMade(e.target.value); setDirty(true); }}
                    aria-required="true"
                    aria-invalid={!callsValid}
                    className={"h-9 max-w-[240px]" + (callsValid ? "" : " border-red-400 focus-visible:ring-red-400")}
                    data-testid="input-calls-made"
                  />
                  {ratioPreview && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-primary" />
                      Transfer/Call: <strong className="text-foreground ml-0.5">{ratioPreview}</strong>
                    </span>
                  )}
                </div>
                {!callsValid && (
                  <p className="text-[11px] font-medium text-red-600 dark:text-red-400" data-testid="calls-required-msg">
                    Required — enter how many calls you made today (enter 0 if none).
                  </p>
                )}
              </div>

              {/* Messages sent — texts/DMs sent instead of calls */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Messages Sent
                </label>
                <Input
                  type="number" min={0} placeholder="Texts / DMs sent today"
                  value={messagesSent}
                  onChange={e => { setMessagesSent(e.target.value); setDirty(true); }}
                  className="h-9 max-w-[200px]"
                  data-testid="input-messages-sent"
                />
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

              <div className="flex flex-wrap gap-2">
                <Button
                  className="flex-1 min-w-[180px] gap-2"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || (!dirty && !!report) || !callsValid}
                  title={!callsValid ? "Enter your total calls made first" : ""}
                >
                  {saveMutation.isPending ? (
                    <><Clock className="w-4 h-4 animate-spin" /> Saving…</>
                  ) : report && !dirty ? (
                    <><CheckCircle2 className="w-4 h-4" /> Already submitted</>
                  ) : (
                    <><Send className="w-4 h-4" /> {report ? "Resubmit Report" : "Submit Report"}</>
                  )}
                </Button>
                {selectedDate === todayStr && !report && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={async () => {
                      const ok = await saveDraft(false);
                      if (ok) toast({ title: "Draft saved successfully" });
                    }}
                    disabled={draftSaving}
                  >
                    <Save className="w-4 h-4" />
                    {draftSaving ? "Saving…" : "Save Draft"}
                  </Button>
                )}
              </div>
              {selectedDate === todayStr && !report && draftSavedAt && (
                <p className="text-[11px] text-muted-foreground -mt-1">
                  Saved · {format(draftSavedAt, "h:mm a")}
                </p>
              )}
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
                    <div key={a.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                      {editingActivityId === a.id ? (
                        <div className="flex gap-2 flex-wrap items-center w-full">
                          <Select value={editActivityType} onValueChange={setEditActivityType}>
                            <SelectTrigger className="w-44 h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ACTIVITY_TYPES.map(t => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={editActivityDesc}
                            onChange={e => setEditActivityDesc(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" && editActivityDesc.trim()) saveEditActivity(a.id);
                              if (e.key === "Escape") setEditingActivityId(null);
                            }}
                            className="flex-1 min-w-[160px] h-8 text-sm"
                            autoFocus
                          />
                          <Button
                            size="sm" className="h-8 gap-1"
                            onClick={() => saveEditActivity(a.id)}
                            disabled={!editActivityDesc.trim() || updateActivityMutation.isPending}
                          >
                            <Check className="w-3.5 h-3.5" /> Save
                          </Button>
                          <Button
                            size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground"
                            onClick={() => setEditingActivityId(null)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Badge className={`text-xs shrink-0 ${ACTIVITY_COLORS[a.activity_type] ?? ACTIVITY_COLORS.other}`}>
                              {ACTIVITY_TYPES.find(t => t.value === a.activity_type)?.label ?? a.activity_type}
                            </Badge>
                            <span className="text-sm truncate">{a.description}</span>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              onClick={() => startEditActivity(a)}
                              aria-label="Edit activity"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteActivityMutation.mutate(a.id)}
                              disabled={deleteActivityMutation.isPending}
                              aria-label="Delete activity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-center pb-2">
            Your EOD report feeds the daily, weekly, and monthly performance analytics in Team Stats.
          </p>
        </div>
      )}

      {/* ── Report History ── */}
      <div className="no-print">
        <ReportHistory isAdmin={isAdmin} />
      </div>

      {/* Print-only footer */}
      <div className="print-only print-footer">
        WCL Team: Team Members Only · CLR Connection Center · Generated {new Date().toLocaleString()}
      </div>
    </div>
  );
}

// ── Print-Only EOD Report Sheet ────────────────────────────────────────────
// Renders a complete, value-based EOD report for printing / PDF export.
// Only visible via the @media print stylesheet (class="print-only").
function EodPrintSheet({
  report, activities, displayDate, callsMade, messagesSent,
  autoTransfers, autoAppointments, autoFellThrough,
  autoCallbacks, autoDeferrals, autoFuture, autoNoAnswer, autoTotalLogged,
  fallbackUser,
}: {
  report: any;
  activities: any[];
  displayDate: string;
  callsMade: number;
  messagesSent: number;
  autoTransfers: number;
  autoAppointments: number;
  autoFellThrough: number;
  autoCallbacks: number;
  autoDeferrals: number;
  autoFuture: number;
  autoNoAnswer: number;
  autoTotalLogged: number;
  fallbackUser: any;
}) {
  const breakdown = (report?.outcomeBreakdown ?? {}) as Record<string, number>;
  const transfers    = breakdown.transfer           ?? report?.transfers    ?? autoTransfers;
  const appointments = breakdown.appointment        ?? report?.appointments ?? autoAppointments;
  const fellThrough  = breakdown.fell_through       ?? autoFellThrough;
  const callbacks    = breakdown.callback_requested ?? autoCallbacks;
  const deferrals    = breakdown.deferral           ?? autoDeferrals;
  const future       = breakdown.future_contact     ?? autoFuture;
  const noAnswer     = breakdown.no_answer          ?? autoNoAnswer;
  const totalLogged  = transfers + appointments + fellThrough + callbacks + deferrals + future + noAnswer || autoTotalLogged;

  const clrName  = report?.clr_name  ?? fallbackUser?.name  ?? fallbackUser?.fullName ?? "—";
  const clrEmail = report?.clr_email ?? fallbackUser?.email ?? "";
  const clrRole  = report?.clr_role  ?? fallbackUser?.role  ?? "";

  const submittedAtRaw = report?.submitted_at ?? report?.submittedAt ?? report?.updated_at ?? report?.updatedAt ?? null;
  const submittedAt = submittedAtRaw
    ? format(parseServerTimestamp(submittedAtRaw) ?? new Date(submittedAtRaw), "MMM d, yyyy 'at' h:mm a")
    : null;

  const ratio = callsMade > 0 ? ((transfers / callsMade) * 100).toFixed(1) + "%" : "—";

  const transferProspects = (report?.transferProspectsWithLo ?? report?.transferProspects ?? []) as Array<
    { name: string; loName?: string | null; transferType?: string | null }
  >;
  const coverage = report?.loCoverage ?? null;

  const coverageCount = (coverage?.assignedCalled?.length ?? 0) +
    (coverage?.notCalled?.length ?? 0) +
    (coverage?.additional?.length ?? 0);
  const hasCoverage = !!coverage && (coverageCount > 0 || !!coverage.otherNotes);

  const outcomeRows: Array<{ label: string; count: number }> = [
    { label: "Transfers",            count: transfers },
    { label: "Appointments Set",     count: appointments },
    { label: "Fell Through",         count: fellThrough },
    { label: "Callbacks & Deferrals", count: callbacks + deferrals },
    { label: "Future Contact",       count: future },
    { label: "No Answer",            count: noAnswer },
  ];

  return (
    <div className="print-only eod-print-sheet">
      {/* Identity / submission metadata */}
      <table className="eod-meta">
        <tbody>
          <tr>
            <td><strong>CLR</strong></td>
            <td>{clrName}{clrRole ? ` · ${String(clrRole).toUpperCase()}` : ""}</td>
            <td><strong>Report Date</strong></td>
            <td>{displayDate}</td>
          </tr>
          <tr>
            <td><strong>Email</strong></td>
            <td>{clrEmail || "—"}</td>
            <td><strong>Submitted</strong></td>
            <td>{submittedAt ?? "—"}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="eod-h2">Daily Summary</h2>
      <table className="eod-kv">
        <tbody>
          <tr><td>Total Calls Made</td><td className="num">{callsMade}</td></tr>
          <tr><td>Messages Sent</td><td className="num">{messagesSent}</td></tr>
          <tr><td>Total Outcomes Logged</td><td className="num">{totalLogged}</td></tr>
          <tr><td>Transfer / Call Ratio</td><td className="num">{ratio}</td></tr>
        </tbody>
      </table>

      <h2 className="eod-h2">Outcome Breakdown</h2>
      <table className="eod-table">
        <thead>
          <tr><th>Outcome</th><th className="num">Count</th></tr>
        </thead>
        <tbody>
          {outcomeRows.map(r => (
            <tr key={r.label}><td>{r.label}</td><td className="num">{r.count}</td></tr>
          ))}
          <tr className="eod-total">
            <td><strong>Total</strong></td>
            <td className="num"><strong>{totalLogged}</strong></td>
          </tr>
        </tbody>
      </table>

      <h2 className="eod-h2">
        Transfer Prospects{" "}
        <span className="eod-h2-sub">({transferProspects.length})</span>
      </h2>
      {transferProspects.length === 0 ? (
        <p className="eod-empty">No transfers logged for this date.</p>
      ) : (
        <table className="eod-table">
          <thead>
            <tr>
              <th style={{ width: "32px" }}>#</th>
              <th>Prospect</th>
              <th>LO</th>
              <th>Transfer Type</th>
            </tr>
          </thead>
          <tbody>
            {transferProspects.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{p.name}</td>
                <td>{p.loName || "—"}</td>
                <td>
                  {p.transferType === "direct"      ? "Direct" :
                   p.transferType === "appointment" ? "Appointment" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="eod-h2">LO Coverage</h2>
      {!hasCoverage ? (
        <p className="eod-empty">No LO coverage recorded for this date.</p>
      ) : (
        <div className="eod-coverage">
          {coverage.assignedCalled?.length > 0 && (
            <div>
              <p className="eod-cov-label">
                Assigned — Called ({coverage.assignedCalled.length}
                {coverage.notCalled?.length
                  ? `/${coverage.assignedCalled.length + coverage.notCalled.length}`
                  : ""})
              </p>
              <p className="eod-cov-names">{coverage.assignedCalled.join(" · ")}</p>
            </div>
          )}
          {coverage.notCalled?.length > 0 && (
            <div>
              <p className="eod-cov-label">Assigned — Not Called ({coverage.notCalled.length})</p>
              <p className="eod-cov-names">{coverage.notCalled.join(" · ")}</p>
            </div>
          )}
          {coverage.additional?.length > 0 && (
            <div>
              <p className="eod-cov-label">Additional Covered ({coverage.additional.length})</p>
              <p className="eod-cov-names">{coverage.additional.join(" · ")}</p>
            </div>
          )}
          {coverage.otherNotes && (
            <div>
              <p className="eod-cov-label">Additional (Other)</p>
              <p className="eod-cov-names">{coverage.otherNotes}</p>
            </div>
          )}
        </div>
      )}

      <h2 className="eod-h2">Notes / Comments</h2>
      {report?.notes ? (
        <p className="eod-notes">{report.notes}</p>
      ) : (
        <p className="eod-empty">No notes recorded.</p>
      )}

      <h2 className="eod-h2">
        Additional Activity Log{" "}
        <span className="eod-h2-sub">({activities.length})</span>
      </h2>
      {activities.length === 0 ? (
        <p className="eod-empty">No additional activities logged.</p>
      ) : (
        <table className="eod-table">
          <thead>
            <tr>
              <th style={{ width: "180px" }}>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((a: any) => (
              <tr key={a.id}>
                <td>{ACTIVITY_TYPES.find(t => t.value === a.activity_type)?.label ?? a.activity_type}</td>
                <td>{a.description || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Signature block */}
      <div className="eod-sign">
        <div className="eod-sign-block">
          <div className="eod-sign-line" />
          <p className="eod-sign-label">CLR Signature</p>
        </div>
        <div className="eod-sign-block">
          <div className="eod-sign-line" />
          <p className="eod-sign-label">Manager Signature</p>
        </div>
      </div>
    </div>
  );
}

// ── Report History Component ────────────────────────────────────────────────
function ReportHistory({ isAdmin }: { isAdmin: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: history = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/eod-reports/history"],
    queryFn: () => fetch("/api/eod-reports/history", { credentials: "include" }).then(r => r.json()),
  });

  // Inline editing of a past report's Additional Activity Log entries. Anything
  // shown here is editable by the current user: the history endpoint scopes
  // non-admins to their own reports, and admins may edit any CLR's entries.
  const [editingActivityId, setEditingActivityId] = useState<number | null>(null);
  const [editActivityType, setEditActivityType] = useState("follow_up");
  const [editActivityDesc, setEditActivityDesc] = useState("");

  const refreshAll = () => {
    refetch();
    // Keep the open EOD form's activity list in sync if it's showing the same entry.
    queryClient.invalidateQueries({ queryKey: ["/api/eod-reports"] });
  };

  const updateActivityMutation = useMutation({
    mutationFn: (v: { id: number; activityType: string; description: string }) =>
      apiRequest("PATCH", `/api/eod-reports/activities/${v.id}`, { activityType: v.activityType, description: v.description }),
    onSuccess: () => { refreshAll(); setEditingActivityId(null); toast({ title: "Activity updated" }); },
    onError: () => toast({ title: "Failed to update activity", variant: "destructive" }),
  });
  const deleteHistActivityMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/eod-reports/activities/${id}`),
    onSuccess: () => { refreshAll(); toast({ title: "Activity removed" }); },
    onError: () => toast({ title: "Failed to remove activity", variant: "destructive" }),
  });

  function startEditActivity(a: any) {
    setEditingActivityId(a.id);
    setEditActivityType(a.activity_type);
    setEditActivityDesc(a.description ?? "");
  }
  function saveEditActivity(id: number) {
    if (!editActivityDesc.trim()) return;
    updateActivityMutation.mutate({ id, activityType: editActivityType, description: editActivityDesc.trim() });
  }

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
          const messages = r.messages_sent ?? 0;
          const breakdown = r.outcomeBreakdown ?? {};
          const xfers = breakdown.transfer ?? r.transfers ?? 0;
          const appts = breakdown.appointment ?? r.appointments ?? 0;
          const fellThrough = breakdown.fell_through ?? 0;
          const callbacks = breakdown.callback_requested ?? 0;
          const deferrals = breakdown.deferral ?? 0;
          const callbacksAndDeferrals = callbacks + deferrals;
          const future = breakdown.future_contact ?? 0;
          const noAnswer = breakdown.no_answer ?? 0;
          const summaryChips: Array<{ label: string; val: number; cls: string }> = [
            { label: "calls",                  val: calls,                cls: "text-muted-foreground" },
            { label: "messages",               val: messages,             cls: "text-muted-foreground" },
            { label: "transfers",              val: xfers,                cls: "text-emerald-600 font-medium" },
            { label: "appts",                  val: appts,                cls: "text-blue-600" },
            { label: "fell through",           val: fellThrough,          cls: "text-rose-600" },
            { label: "callbacks & deferrals", val: callbacksAndDeferrals, cls: "text-amber-600" },
            { label: "future",                 val: future,               cls: "text-indigo-600" },
            { label: "no answer",              val: noAnswer,             cls: "text-muted-foreground" },
          ].filter(c => c.val > 0);

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
                    <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 flex-wrap">
                      {summaryChips.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No activity</span>
                      ) : (
                        summaryChips.map(c => (
                          <span key={c.label} className={`text-xs ${c.cls}`}>{c.val} {c.label}</span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                {isOpen
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-border bg-muted/20 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  {/* Stats — full outcome breakdown */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {[
                      { label: "Calls",                 val: calls,                color: "text-foreground" },
                      { label: "Transfers",             val: xfers,                color: "text-emerald-600" },
                      { label: "Appointments",          val: appts,                color: "text-blue-600" },
                      { label: "Fell Through",          val: fellThrough,          color: "text-rose-600" },
                      { label: "Callbacks & Deferrals", val: callbacksAndDeferrals, color: "text-amber-600" },
                      { label: "Future",                val: future,               color: "text-indigo-600" },
                      { label: "No Answer",             val: noAnswer,             color: "text-muted-foreground" },
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
                  {r.loCoverage && ((r.loCoverage.assignedCalled?.length ?? 0) + (r.loCoverage.notCalled?.length ?? 0) + (r.loCoverage.additional?.length ?? 0) > 0 || r.loCoverage.otherNotes) && (
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
                      {r.loCoverage.otherNotes && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400 mb-1">Additional (Other)</p>
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{r.loCoverage.otherNotes}</p>
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

                  {/* Additional activity log — the "other tasks done that day".
                      Editable inline: edit the type/description or remove an entry. */}
                  {Array.isArray(r.activities) && r.activities.length > 0 && (
                    <div className="rounded-lg bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 px-3 py-2.5 space-y-2">
                      <p className="text-xs font-semibold text-violet-700 dark:text-violet-400">
                        Additional Activities ({r.activities.length})
                      </p>
                      <div className="space-y-1.5">
                        {r.activities.map((a: any) => (
                          editingActivityId === a.id ? (
                            <div key={a.id} className="flex flex-wrap items-center gap-1.5">
                              <Select value={editActivityType} onValueChange={setEditActivityType}>
                                <SelectTrigger className="w-40 h-8 text-xs bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ACTIVITY_TYPES.map(t => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                value={editActivityDesc}
                                onChange={e => setEditActivityDesc(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter" && editActivityDesc.trim()) saveEditActivity(a.id);
                                  if (e.key === "Escape") setEditingActivityId(null);
                                }}
                                className="flex-1 min-w-[140px] h-8 text-xs bg-background"
                                autoFocus
                              />
                              <Button
                                size="sm" className="h-8 gap-1"
                                onClick={() => saveEditActivity(a.id)}
                                disabled={!editActivityDesc.trim() || updateActivityMutation.isPending}
                              >
                                <Check className="w-3.5 h-3.5" /> Save
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground"
                                onClick={() => setEditingActivityId(null)}
                                aria-label="Cancel edit"
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div key={a.id} className="flex items-start gap-2 group">
                              <Badge
                                className={`text-[10px] shrink-0 ${ACTIVITY_COLORS[a.activity_type] ?? ACTIVITY_COLORS.other}`}
                              >
                                {ACTIVITY_TYPES.find(t => t.value === a.activity_type)?.label ?? a.activity_type}
                              </Badge>
                              <span className="text-xs text-muted-foreground leading-relaxed flex-1 min-w-0">
                                {a.description?.trim() || "—"}
                              </span>
                              <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                  onClick={() => startEditActivity(a)}
                                  aria-label="Edit activity"
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => deleteHistActivityMutation.mutate(a.id)}
                                  disabled={deleteHistActivityMutation.isPending}
                                  aria-label="Delete activity"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  )}

                  {r.submitted_at && (
                    <p className="text-xs text-muted-foreground">Submitted: {format(parseServerTimestamp(r.submitted_at) ?? new Date(), "MMM d, yyyy 'at' h:mm a")}</p>
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
