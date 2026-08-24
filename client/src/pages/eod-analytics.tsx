import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClrTrainingBadge } from "@/components/clr-training-badge";
import {
  AlertCircle, BarChart3, CalendarDays, CheckCircle2, ChevronDown,
  ClipboardCheck, Clock3, Download, FileText, ListFilter, MessageSquare, PhoneCall,
  RefreshCw, Search, Target, TrendingDown, TrendingUp, Users, X,
} from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

type Totals = {
  reportedCalls: number;
  messages: number;
  additionalConversations: number;
  callToolsConversations: number;
  conversations: number;
  callToolsActiveSeconds: number;
  dialpadCalls: number;
  transfers: number;
  appointments: number;
  assignedLosCalled: number;
  additionalLosCalled: number;
};

type Averages = {
  reportedCalls: number;
  messages: number;
  conversations: number;
  callToolsActiveMinutes: number;
  dialpadCalls: number;
  transfers: number;
  appointments: number;
};

type ChecklistMetric = { yes: number; no: number; unanswered: number; yesRate: number };
type Checklist = {
  overallYesRate: number;
  bulkTextAllLos: ChecklistMetric;
  workedRespondedNew: ChecklistMetric;
  retailMetaLeads: ChecklistMetric;
  retailUngraduatedLeads: ChecklistMetric;
};

type ClrRow = {
  userId: number; name: string; email: string; excludeFromStats: boolean;
  inTraining: boolean; activeWorkdays: number;
  expected: number; submitted: number; missing: number; submissionRate: number;
  onTime: number; late: number; onTimeRate: number;
  missingDates: string[]; lateDates: string[];
  totals: Totals; averages: Averages; checklist: Checklist;
  activeTimeDirectionPct: number | null;
};

type ReportRow = {
  id: number; date: string; userId: number; name: string; email: string;
  submittedAt: string | null; late: boolean; reportedCalls: number; messages: number;
  additionalConversations: number; callToolsConversations: number; conversations: number;
  callToolsActiveSeconds: number; dialpadCalls: number; transfers: number; appointments: number;
  notes: string; assignedLosCalled: number; additionalLosCalled: number;
  additionalLosOtherNotes: string | null;
  checklist: Record<string, number | null>;
  activities: Array<{ id: number; type: string; description: string }>;
};

type AnalyticsResponse = {
  window: { from: string; to: string; days: number; priorFrom: string; priorTo: string; dueLabel: string };
  roster: Array<{ userId: number; name: string }>;
  team: {
    expected: number; submitted: number; submittedExpected: number; missing: number;
    submissionRate: number; onTime: number; late: number; onTimeRate: number;
    totals: Totals; averages: Averages; checklist: Checklist;
    prior: { expected: number; submitted: number; submittedExpected: number; submissionRate: number; onTimeRate: number; totals: Totals; averages: Averages };
  };
  daily: Array<{ date: string; expected: number; submitted: number; missing: number; late: number; onTime: number; onTimeRate: number } & Totals>;
  clrs: ClrRow[];
  reports: ReportRow[];
  insights: Array<{ level: "attention" | "watch" | "positive"; title: string; detail: string; userId?: number }>;
};

type ClrView = "all" | "missing" | "late" | "checklist" | "declining";
type ReportView = "all" | "late" | "on-time" | "checklist" | "notes";
type ReportSort = "newest" | "oldest" | "transfers" | "conversations";

const checklistLabels: Array<[keyof Omit<Checklist, "overallYesRate">, string]> = [
  ["bulkTextAllLos", "Bulk texted every assigned LO"],
  ["workedRespondedNew", "Worked Responded / New leads"],
  ["retailMetaLeads", "Worked Retail Meta leads"],
  ["retailUngraduatedLeads", "Worked Retail Ungraduated leads"],
];

function shortDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function longDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function activeTime(seconds: number) {
  const minutes = Math.round((Number(seconds) || 0) / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function submittedTime(value: string | null) {
  if (!value) return "Time unavailable";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function rate(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  // Notes and names are user-controlled. Prefix formula-looking cells so a
  // spreadsheet opens the export as data instead of executing a formula.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function Delta({ current, prior, suffix = "" }: { current: number; prior: number; suffix?: string }) {
  const delta = Math.round((current - prior) * 10) / 10;
  if (!Number.isFinite(delta) || delta === 0) return <span className="text-muted-foreground">No change</span>;
  const up = delta > 0;
  return (
    <span className={up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
      {up ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : <TrendingDown className="inline h-3 w-3 mr-0.5" />}
      {up ? "+" : ""}{delta}{suffix} vs prior
    </span>
  );
}

function KpiCard({ title, value, detail, icon: Icon, accent = "navy" }: {
  title: string; value: string | number; detail: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>; accent?: "navy" | "gold" | "green" | "blue";
}) {
  const colors = {
    navy: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    gold: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    blue: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  };
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight mt-1">{value}</p>
          </div>
          <div className={`rounded-xl p-2 ${colors[accent]}`}><Icon className="h-4 w-4" /></div>
        </div>
        <div className="mt-2 text-[11px]">{detail}</div>
      </CardContent>
    </Card>
  );
}

function YesNo({ value }: { value: number | null | undefined }) {
  if (value === 1) return <span className="text-emerald-600 dark:text-emerald-400">Yes</span>;
  if (value === 0) return <span className="text-rose-600 dark:text-rose-400">No</span>;
  return <span className="text-muted-foreground">Not asked</span>;
}

export default function EodAnalytics() {
  const { user } = useAuth();
  const canView = user?.role === "admin" || !!user?.isManager || !!user?.superAdmin;
  const [days, setDays] = useState("30");
  const [clrId, setClrId] = useState("all");
  const [asOf, setAsOf] = useState("");
  const [clrView, setClrView] = useState<ClrView>("all");
  const [search, setSearch] = useState("");
  const [reportView, setReportView] = useState<ReportView>("all");
  const [reportSort, setReportSort] = useState<ReportSort>("newest");

  const endpoint = `/api/eod-reports/analytics?days=${days}${clrId === "all" ? "" : `&clrId=${clrId}`}${asOf ? `&to=${asOf}` : ""}`;
  const { data, isLoading, isFetching, error, refetch } = useQuery<AnalyticsResponse>({
    queryKey: ["/api/eod-reports/analytics", days, clrId, asOf],
    queryFn: () => apiRequest("GET", endpoint),
    enabled: !!canView,
  });

  const reports = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (data?.reports ?? []).filter((report) => {
      const matchesSearch = !q || report.name.toLowerCase().includes(q) || report.notes.toLowerCase().includes(q) || report.date.includes(q);
      const hasChecklistGap = Object.values(report.checklist).some((value) => value === 0);
      const matchesView = reportView === "all" || (reportView === "late" && report.late) ||
        (reportView === "on-time" && !report.late) || (reportView === "checklist" && hasChecklistGap) ||
        (reportView === "notes" && report.notes.trim().length > 0);
      return matchesSearch && matchesView;
    });
    return filtered.sort((a, b) => {
      if (reportSort === "oldest") return a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
      if (reportSort === "transfers") return b.transfers - a.transfers || b.date.localeCompare(a.date);
      if (reportSort === "conversations") return b.conversations - a.conversations || b.date.localeCompare(a.date);
      return b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
    });
  }, [data?.reports, reportSort, reportView, search]);

  const sortedClrs = useMemo(() => (data?.clrs ?? []).filter((clr) =>
    clrView === "all" || (clrView === "missing" && clr.missing > 0) || (clrView === "late" && clr.late > 0) ||
    (clrView === "checklist" && clr.checklist.overallYesRate < 80) ||
    (clrView === "declining" && clr.activeTimeDirectionPct != null && clr.activeTimeDirectionPct < 0),
  ).sort((a, b) => b.missing - a.missing || a.submissionRate - b.submissionRate || a.name.localeCompare(b.name)), [data?.clrs, clrView]);

  const accountabilityClrs = useMemo(() => (data?.clrs ?? []).filter((clr) => clr.missing > 0 || clr.late > 0)
    .sort((a, b) => b.missing - a.missing || b.late - a.late || a.name.localeCompare(b.name)), [data?.clrs]);

  const transferRate = rate(data?.team.totals.transfers ?? 0, data?.team.totals.conversations ?? 0);
  const appointmentRate = rate(data?.team.totals.appointments ?? 0, data?.team.totals.conversations ?? 0);

  function focusClr(userId: number) {
    setClrId(String(userId));
    setClrView("all");
    setSearch("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearFocus() {
    setClrId("all");
    setClrView("all");
    setSearch("");
    setReportView("all");
  }

  function exportCsv() {
    if (!data) return;
    const headings = ["Date", "CLR", "Submitted", "Status", "Conversations", "CallTools active minutes", "Dialpad calls", "Messages", "Transfers", "Appointments", "Assigned LOs called", "Additional LOs called", "Notes"];
    const rows = reports.map((report) => [
      report.date, report.name, submittedTime(report.submittedAt), report.late ? "Late" : "On time",
      report.conversations, Math.round(report.callToolsActiveSeconds / 60), report.dialpadCalls, report.messages,
      report.transfers, report.appointments, report.assignedLosCalled, report.additionalLosCalled, report.notes,
    ]);
    const csv = [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `eod-analytics-${data.window.from}-to-${data.window.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!canView) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card><CardContent className="py-14 text-center">
          <AlertCircle className="h-9 w-9 mx-auto text-muted-foreground mb-3" />
          <h1 className="text-xl font-semibold">Manager access required</h1>
          <p className="text-sm text-muted-foreground mt-1">EOD Analytics contains team-wide report details.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1500px] mx-auto" data-testid="eod-analytics-page">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-5 sm:px-7 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><BarChart3 className="w-44 h-44 text-white" /></div>
        <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-amber-400/15">
              <ClipboardCheck className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">EOD Analytics</h1>
              <p className="text-sm text-white/65 mt-0.5 max-w-2xl">
                Understand who is reporting, what the team accomplished, and which patterns need a manager's attention.
              </p>
              {data?.window && <p className="text-xs text-white/45 mt-2">{longDate(data.window.from)} – {longDate(data.window.to)} · due by {data.window.dueLabel}</p>}
            </div>
          </div>
          <div className="relative grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:grid-cols-[145px_190px_155px_auto]">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/55">Range</label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-full bg-white/10 border-white/20 text-white" data-testid="eod-range-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/55">Team member</label>
              <Select value={clrId} onValueChange={setClrId}>
                <SelectTrigger className="w-full bg-white/10 border-white/20 text-white" data-testid="eod-clr-select"><SelectValue placeholder="Whole team" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Whole team</SelectItem>
                  {(data?.roster ?? []).map((clr) => <SelectItem key={clr.userId} value={String(clr.userId)}>{clr.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="eod-as-of" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/55">Ending on</label>
              <Input id="eod-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className="w-full border-white/20 bg-white/10 text-white [color-scheme:dark]" data-testid="eod-as-of-date" />
            </div>
            <div className="flex items-end gap-2">
              {asOf && <Button variant="ghost" size="icon" onClick={() => setAsOf("")} className="text-white hover:bg-white/10 hover:text-white" aria-label="Use the current date"><X className="h-4 w-4" /></Button>}
              <Button variant="secondary" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh EOD analytics">
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : error || !data ? (
        <Card><CardContent className="py-14 text-center">
          <AlertCircle className="h-9 w-9 mx-auto text-rose-500 mb-3" />
          <p className="font-semibold">Could not load EOD analytics</p>
          <p className="text-sm text-muted-foreground mt-1">Refresh the page or try again.</p>
          <Button className="mt-4" onClick={() => refetch()}>Try again</Button>
        </CardContent></Card>
      ) : (
        <>
          {clrId !== "all" && data.clrs[0] && <div className="flex flex-col gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm dark:border-sky-900 dark:bg-sky-950/25 sm:flex-row sm:items-center sm:justify-between" data-testid="eod-clr-focus-banner">
            <span><strong>Focused view:</strong> every metric and report below is for {data.clrs[0].name}.</span>
            <Button variant="outline" size="sm" onClick={clearFocus}>Return to whole team</Button>
          </div>}

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3" data-testid="eod-kpi-grid">
            <KpiCard title="Reports submitted" value={`${data.team.submissionRate}%`} icon={FileText} accent="blue"
              detail={<><span className="text-muted-foreground">{data.team.submittedExpected}/{data.team.expected} expected</span> · <Delta current={data.team.submissionRate} prior={data.team.prior.submissionRate} suffix=" pts" /></>} />
            <KpiCard title="Missing reports" value={data.team.missing} icon={AlertCircle} accent="gold"
              detail={<span className="text-muted-foreground">Expected but not submitted in this range</span>} />
            <KpiCard title="On time" value={`${data.team.onTimeRate}%`} icon={Clock3} accent="green"
              detail={<><span className="text-muted-foreground">{data.team.onTime} on time · {data.team.late} late</span> · <Delta current={data.team.onTimeRate} prior={data.team.prior.onTimeRate} suffix=" pts" /></>} />
            <KpiCard title="Avg. active time" value={`${data.team.averages.callToolsActiveMinutes}m`} icon={PhoneCall} accent="navy"
              detail={<><span className="text-muted-foreground">CallTools per report</span> · <Delta current={data.team.averages.callToolsActiveMinutes} prior={data.team.prior.averages.callToolsActiveMinutes} suffix="m" /></>} />
            <KpiCard title="Conversations" value={data.team.totals.conversations.toLocaleString()} icon={MessageSquare} accent="blue"
              detail={<span className="text-muted-foreground">{data.team.totals.callToolsConversations.toLocaleString()} CallTools + {data.team.totals.additionalConversations.toLocaleString()} additional</span>} />
            <KpiCard title="Transfers" value={data.team.totals.transfers.toLocaleString()} icon={TrendingUp} accent="gold"
              detail={<span className="text-muted-foreground">{data.team.averages.transfers} average per report</span>} />
            <KpiCard title="Appointments" value={data.team.totals.appointments.toLocaleString()} icon={Target} accent="green"
              detail={<span className="text-muted-foreground">{data.team.averages.appointments} average per report</span>} />
          </div>

          <Card data-testid="eod-accountability-queue">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-amber-600" />Accountability queue</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Exact missing and late report dates, ready for a quick manager follow-up.</p>
                </div>
                <Badge variant={accountabilityClrs.length ? "destructive" : "secondary"}>{accountabilityClrs.length} {accountabilityClrs.length === 1 ? "person" : "people"} to review</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {accountabilityClrs.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div><p className="font-semibold">No missing or late reports in this view</p><p className="text-xs text-muted-foreground">Every report owed in this date range is accounted for and on time.</p></div>
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {accountabilityClrs.map((clr) => <div key={clr.userId} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold">{clr.name}</p><p className="text-xs text-muted-foreground">{clr.submitted}/{clr.expected} expected reports · {clr.onTimeRate}% on time</p></div>
                      {clrId === "all" && <Button variant="outline" size="sm" onClick={() => focusClr(clr.userId)}>View only</Button>}
                    </div>
                    {clr.missingDates.length > 0 && <div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-rose-600">Missing</p><div className="mt-1 flex flex-wrap gap-1">{clr.missingDates.map((date) => <Badge key={date} variant="destructive" className="font-normal">{shortDate(date)}</Badge>)}</div></div>}
                    {clr.lateDates.length > 0 && <div className="mt-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Late</p><div className="mt-1 flex flex-wrap gap-1">{clr.lateDates.map((date) => <Badge key={date} variant="outline" className="border-amber-300 font-normal text-amber-800 dark:border-amber-800 dark:text-amber-300">{shortDate(date)}</Badge>)}</div></div>}
                  </div>)}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" />Team trend</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[280px]" data-testid="eod-team-trend">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis yAxisId="reports" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                      <Tooltip labelFormatter={(v) => longDate(String(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar yAxisId="reports" dataKey="submitted" name="Submitted" fill="#1A2B4A" radius={[3, 3, 0, 0]} />
                      <Bar yAxisId="reports" dataKey="missing" name="Missing" fill="#ef4444" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="rate" type="monotone" dataKey="onTimeRate" name="On-time %" stroke="#C49A3C" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5" data-testid="eod-productivity-summary">
                  <div className="rounded-lg bg-muted/50 py-2"><strong>{data.team.totals.messages.toLocaleString()}</strong><span className="block text-muted-foreground">messages</span></div>
                  <div className="rounded-lg bg-muted/50 py-2"><strong>{data.team.totals.dialpadCalls.toLocaleString()}</strong><span className="block text-muted-foreground">Dialpad calls</span></div>
                  <div className="rounded-lg bg-muted/50 py-2"><strong>{activeTime(data.team.totals.callToolsActiveSeconds)}</strong><span className="block text-muted-foreground">CallTools active</span></div>
                  <div className="rounded-lg bg-muted/50 py-2"><strong>{transferRate}%</strong><span className="block text-muted-foreground">convos → transfers</span></div>
                  <div className="rounded-lg bg-muted/50 py-2"><strong>{appointmentRate}%</strong><span className="block text-muted-foreground">convos → appts</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-600" />What needs attention</CardTitle></CardHeader>
              <CardContent className="space-y-2 max-h-[355px] overflow-y-auto" data-testid="eod-insights">
                {data.insights.map((insight, i) => (
                  <div key={`${insight.title}-${i}`} className={`rounded-xl border p-3 ${
                    insight.level === "attention" ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20" :
                    insight.level === "positive" ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20" :
                    "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="text-sm font-semibold">{insight.title}</p><p className="text-xs text-muted-foreground mt-0.5">{insight.detail}</p></div>
                      {insight.userId && clrId === "all" && <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => focusClr(insight.userId!)}>Review</Button>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card data-testid="eod-clr-patterns">
            <CardHeader className="pb-3">
              <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
                <div><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-primary" />CLR patterns</CardTitle><p className="mt-1 text-xs text-muted-foreground">Compare accountability, activity, outcomes, and checklist completion in one place.</p></div>
                <div className="flex flex-wrap gap-1" data-testid="eod-clr-view-filters">
                  {([
                    ["all", "Everyone", data.clrs.length],
                    ["missing", "Missing", data.clrs.filter((clr) => clr.missing > 0).length],
                    ["late", "Late", data.clrs.filter((clr) => clr.late > 0).length],
                    ["checklist", "Checklist gaps", data.clrs.filter((clr) => clr.checklist.overallYesRate < 80).length],
                    ["declining", "Activity down", data.clrs.filter((clr) => clr.activeTimeDirectionPct != null && clr.activeTimeDirectionPct < 0).length],
                  ] as Array<[ClrView, string, number]>).map(([value, label, count]) => <Button key={value} variant={clrView === value ? "default" : "outline"} size="sm" className="h-8" onClick={() => setClrView(value)}>{label} <Badge variant="secondary" className="ml-1 px-1.5">{count}</Badge></Button>)}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              {sortedClrs.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No CLRs match this accountability filter.</div> : <>
                <div className="space-y-3 px-4 lg:hidden" data-testid="eod-clr-mobile-cards">
                  {sortedClrs.map((clr) => <div key={clr.userId} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 font-semibold">{clr.name}<ClrTrainingBadge inTraining={clr.inTraining} activeWorkdays={clr.activeWorkdays} /></p><p className="text-xs text-muted-foreground">{clr.submitted}/{clr.expected} expected · {clr.missing ? `${clr.missing} missing` : "nothing missing"}</p></div>{clrId === "all" && <Button size="sm" variant="outline" onClick={() => focusClr(clr.userId)}>View</Button>}</div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-muted/50 p-2"><strong className="block text-base">{clr.submissionRate}%</strong><span className="text-muted-foreground">submitted</span></div>
                      <div className="rounded-lg bg-muted/50 p-2"><strong className="block text-base">{clr.onTimeRate}%</strong><span className="text-muted-foreground">on time</span></div>
                      <div className="rounded-lg bg-muted/50 p-2"><strong className="block text-base">{clr.averages.callToolsActiveMinutes}m</strong><span className="text-muted-foreground">active/report</span></div>
                      <div className="rounded-lg bg-muted/50 p-2"><strong className="block text-base">{clr.averages.conversations}</strong><span className="text-muted-foreground">convos/report</span></div>
                      <div className="rounded-lg bg-muted/50 p-2"><strong className="block text-base">{clr.totals.transfers}</strong><span className="text-muted-foreground">transfers</span></div>
                      <div className="rounded-lg bg-muted/50 p-2"><strong className="block text-base">{clr.totals.appointments}</strong><span className="text-muted-foreground">appointments</span></div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs"><span>Checklist accountability</span><Badge variant={clr.checklist.overallYesRate >= 80 ? "secondary" : "destructive"}>{clr.checklist.overallYesRate}% yes</Badge></div>
                  </div>)}
                </div>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1120px] text-sm">
                  <thead><tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left py-2 px-3">CLR</th><th className="text-right px-3">Reports</th><th className="text-right px-3">On time</th>
                    <th className="text-right px-3">Active / report</th><th className="text-right px-3">Conversations</th><th className="text-right px-3">Messages</th>
                    <th className="text-right px-3">Transfers</th><th className="text-right px-3">Appointments</th><th className="text-right px-3">Checklist</th><th className="px-3"><span className="sr-only">Open CLR</span></th>
                  </tr></thead>
                  <tbody>{sortedClrs.map((clr) => (
                    <tr key={clr.userId} className="border-b last:border-0 hover:bg-muted/35">
                      <td className="py-3 px-3">
                        <div className="font-medium flex items-center gap-1.5">{clr.name}<ClrTrainingBadge inTraining={clr.inTraining} activeWorkdays={clr.activeWorkdays} /></div>
                        <div className="text-[11px] text-muted-foreground">{clr.missing ? `${clr.missing} missing` : "Nothing missing"}{clr.excludeFromStats ? " · non-counted" : ""}</div>
                      </td>
                      <td className="text-right px-3"><strong>{clr.submissionRate}%</strong><div className="text-[11px] text-muted-foreground">{clr.submitted}/{clr.expected}</div></td>
                      <td className="text-right px-3"><strong>{clr.onTimeRate}%</strong><div className="text-[11px] text-muted-foreground">{clr.late} late</div></td>
                      <td className="text-right px-3"><strong>{clr.averages.callToolsActiveMinutes}m</strong>{clr.activeTimeDirectionPct != null && <div className={`text-[11px] ${clr.activeTimeDirectionPct < 0 ? "text-rose-500" : "text-emerald-600"}`}>{clr.activeTimeDirectionPct > 0 ? "+" : ""}{clr.activeTimeDirectionPct}% trend</div>}</td>
                      <td className="text-right px-3"><strong>{clr.averages.conversations}</strong><div className="text-[11px] text-muted-foreground">per report</div></td>
                      <td className="text-right px-3">{clr.averages.messages}</td>
                      <td className="text-right px-3">{clr.totals.transfers}</td><td className="text-right px-3">{clr.totals.appointments}</td>
                      <td className="text-right px-3"><Badge variant={clr.checklist.overallYesRate >= 80 ? "secondary" : "destructive"}>{clr.checklist.overallYesRate}% yes</Badge></td>
                      <td className="px-3">{clrId === "all" && <Button variant="ghost" size="sm" onClick={() => focusClr(clr.userId)}>View</Button>}</td>
                    </tr>
                  ))}</tbody>
                  </table>
                </div>
              </>}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.4fr] gap-4">
            <Card data-testid="eod-checklist-compliance">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Daily checklist compliance</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {checklistLabels.map(([key, label]) => {
                  const metric = data.team.checklist[key];
                  return <div key={key}>
                    <div className="flex justify-between gap-3 text-xs mb-1.5"><span className="font-medium">{label}</span><span>{metric.yesRate}% yes</span></div>
                    <div className="h-2 rounded-full overflow-hidden bg-muted flex">
                      <span className="bg-emerald-500" style={{ width: `${metric.yes + metric.no ? (metric.yes / (metric.yes + metric.no)) * 100 : 0}%` }} />
                      <span className="bg-rose-400" style={{ width: `${metric.yes + metric.no ? (metric.no / (metric.yes + metric.no)) * 100 : 0}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{metric.yes} yes · {metric.no} no · {metric.unanswered} older/unanswered</p>
                  </div>;
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><PhoneCall className="h-4 w-4 text-primary" />Activity by day</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[285px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip labelFormatter={(v) => longDate(String(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="conversations" name="Conversations" fill="#1A2B4A" radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="transfers" name="Transfers" stroke="#C49A3C" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="appointments" name="Appointments" stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <details className="group mt-3 rounded-lg border" data-testid="eod-daily-detail">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium"><span>View exact day-by-day numbers</span><ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></summary>
                  <div className="max-h-80 overflow-auto border-t">
                    <table className="w-full min-w-[720px] text-xs">
                      <thead className="sticky top-0 bg-background"><tr className="border-b text-muted-foreground"><th className="p-2 text-left">Date</th><th className="p-2 text-right">Expected</th><th className="p-2 text-right">Submitted</th><th className="p-2 text-right">Missing</th><th className="p-2 text-right">Late</th><th className="p-2 text-right">Conversations</th><th className="p-2 text-right">Transfers</th><th className="p-2 text-right">Appointments</th></tr></thead>
                      <tbody>{[...data.daily].reverse().map((day) => <tr key={day.date} className="border-b last:border-0"><td className="p-2 font-medium">{longDate(day.date)}</td><td className="p-2 text-right">{day.expected}</td><td className="p-2 text-right">{day.submitted}</td><td className={`p-2 text-right ${day.missing ? "font-semibold text-rose-600" : ""}`}>{day.missing}</td><td className={`p-2 text-right ${day.late ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>{day.late}</td><td className="p-2 text-right">{day.conversations}</td><td className="p-2 text-right">{day.transfers}</td><td className="p-2 text-right">{day.appointments}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="eod-report-explorer">
            <CardHeader className="pb-3">
              <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
                <div><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary" />Report explorer <Badge variant="secondary">{reports.length}</Badge></CardTitle><p className="text-xs text-muted-foreground mt-1">Search, filter, sort, export, or open any report for the complete details.</p></div>
                <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-[240px_170px_170px_auto]" data-testid="eod-report-controls">
                  <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search CLR, note, or date" className="pl-8" /></div>
                  <Select value={reportView} onValueChange={(value) => setReportView(value as ReportView)}>
                    <SelectTrigger><ListFilter className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All reports</SelectItem><SelectItem value="late">Late only</SelectItem><SelectItem value="on-time">On time only</SelectItem><SelectItem value="checklist">Checklist gaps</SelectItem><SelectItem value="notes">Has manager notes</SelectItem></SelectContent>
                  </Select>
                  <Select value={reportSort} onValueChange={(value) => setReportSort(value as ReportSort)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="transfers">Most transfers</SelectItem><SelectItem value="conversations">Most conversations</SelectItem></SelectContent>
                  </Select>
                  <Button variant="outline" onClick={exportCsv} disabled={reports.length === 0}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {reports.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground"><p>No reports match this view.</p>{(search || reportView !== "all") && <Button variant="link" onClick={() => { setSearch(""); setReportView("all"); }}>Clear report filters</Button>}</div> : reports.map((report) => (
                <details key={report.id} className="group rounded-xl border bg-card open:bg-muted/20">
                  <summary className="cursor-pointer list-none p-3 sm:p-4 flex items-center gap-3">
                    <div className="rounded-lg bg-muted p-2 shrink-0"><CalendarDays className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1"><p className="font-medium truncate">{report.name}</p><p className="text-xs text-muted-foreground">{longDate(report.date)} · submitted {submittedTime(report.submittedAt)}</p></div>
                    <div className="hidden md:flex items-center gap-4 text-xs text-right">
                      <span><strong className="block">{report.conversations}</strong><span className="text-muted-foreground">convos</span></span>
                      <span><strong className="block">{activeTime(report.callToolsActiveSeconds)}</strong><span className="text-muted-foreground">active</span></span>
                      <span><strong className="block">{report.transfers}</strong><span className="text-muted-foreground">transfers</span></span>
                    </div>
                    <Badge variant={report.late ? "destructive" : "secondary"}>{report.late ? "Late" : "On time"}</Badge>
                    <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                  </summary>
                  <div className="border-t p-4 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-xs">
                      {[
                        ["CallTools convos", report.callToolsConversations], ["Added convos", report.additionalConversations],
                        ["CallTools active", activeTime(report.callToolsActiveSeconds)], ["Dialpad calls", report.dialpadCalls],
                        ["Reported calls", report.reportedCalls], ["Messages", report.messages],
                        ["Transfers", report.transfers], ["Appointments", report.appointments],
                      ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-background border p-2"><strong className="block text-base">{value}</strong><span className="text-muted-foreground">{label}</span></div>)}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div className="rounded-lg border bg-background p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manager notes</p><p className="text-sm whitespace-pre-wrap mt-1">{report.notes || "No notes entered."}</p></div>
                      <div className="rounded-lg border bg-background p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">LO coverage</p><p className="text-sm mt-1">{report.assignedLosCalled} assigned LOs called · {report.additionalLosCalled} additional LOs called</p>{report.additionalLosOtherNotes && <p className="text-xs text-muted-foreground mt-1">{report.additionalLosOtherNotes}</p>}</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 text-xs">
                      {checklistLabels.map(([key, label]) => <div key={key} className="flex items-center justify-between border-b py-1.5 gap-2"><span>{label}</span><YesNo value={report.checklist[key]} /></div>)}
                    </div>
                    {report.activities.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Additional activity log</p>{report.activities.map((activity) => <p key={activity.id} className="text-sm"><Badge variant="outline" className="mr-2 text-[10px]">{activity.type}</Badge>{activity.description}</p>)}</div>}
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
