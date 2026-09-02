import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClrTrainingBadge } from "@/components/clr-training-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  ArrowLeft, CalendarDays, PhoneForwarded, PhoneCall, Percent, CalendarCheck, Timer,
  UserCheck, FileText, Wallet, Target, TrendingUp, X, AlertTriangle, StickyNote, Palmtree,
} from "lucide-react";
import { PERIODS, LONG_PERIODS, fmtStartDate, fmtTenure, effectiveStart } from "./clr-profiles";
import { TRAINING_DAY_RATES, trainingAmountCents, type TrainingRate } from "@shared/training-comp";

/** How a pinned note is drawn. Warnings and PIPs must not look like context. */
const NOTE_STYLES = {
  note:    { label: "Note",    dot: "hsl(38 92% 50%)",  Icon: StickyNote,    ring: "border-amber-400/60 bg-amber-400/10" },
  warning: { label: "Warning", dot: "hsl(0 84% 60%)",   Icon: AlertTriangle, ring: "border-red-500/60 bg-red-500/10" },
  pip:     { label: "PIP",     dot: "hsl(340 82% 52%)", Icon: AlertTriangle, ring: "border-pink-600/60 bg-pink-600/15" },
} as const;
type NoteKind = keyof typeof NOTE_STYLES;
type ClrNote = {
  id: number; noteDate: string; body: string; authorName: string;
  kind: string; showOnChart: boolean; inDailyReport: boolean;
};
const noteStyle = (k: string) => NOTE_STYLES[(k as NoteKind)] ?? NOTE_STYLES.note;

/**
 * What a manager actually wants to see about a day on the phones. Every one of
 * these comes from the dialer feeds or from logged outcomes — the old chart's
 * dominant bar was the self-reported "Additional Calls" box on the EOD form.
 */
const DAILY_SERIES = [
  { key: "callMinutes" as const, label: "Call time", color: "hsl(221 83% 53%)", format: (v: number) => `${v} min` },
  { key: "dialpadCalls" as const, label: "Dialpad calls", color: "hsl(199 89% 48%)", format: (v: number) => `${v}` },
  { key: "callToolsCalls" as const, label: "CallTools calls", color: "hsl(258 90% 66%)", format: (v: number) => `${v}` },
  { key: "conversations" as const, label: "Conversations", color: "hsl(43 96% 46%)", format: (v: number) => `${v}` },
  { key: "transfers" as const, label: "Transfers", color: "hsl(142 71% 45%)", format: (v: number) => `${v}` },
  { key: "appointments" as const, label: "Appointments", color: "hsl(280 65% 60%)", format: (v: number) => `${v}` },
];
type DailySeriesKey = (typeof DAILY_SERIES)[number]["key"];

const money = (c: number) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Comparison = {
  key: string; label: string; value: number; teamMedian: number;
  deltaPct: number | null; better: boolean; lowerIsBetter: boolean;
  rank: number; outOf: number;
};

type Resp = {
  lifetime?: {
    totals: { transfers: number; appointments: number; calls: number; fellThrough: number;
              activeDays: number; firstDay: string | null; lastDay: string | null };
    rates: { transfersPerDay: number; appointmentsPerDay: number; callsPerDay: number;
             transferRate: number; fellThroughRate: number };
    comparisons: Comparison[];
    peerCount: number;
    thin: boolean;
    minDays: number;
    workdayRate?: { workingDays: number; transfers: number; ratePerWorkingDay: number | null; trainingDays: number; trainerDays: number; graduated: boolean } | null;
    workdayRateMinDays?: number;
  };
  clr: {
    userId: number; name: string; email: string; role: string; isManager: boolean;
    activeWorkdays: number; inTraining: boolean;
    excludeFromStats: boolean; startDate: string | null; createdAt: string | null;
    tenureDays: number | null; startDateIsEstimate: boolean;
  };
  period: string; startDate: string; endDate: string; dailyTooLong?: boolean; periodWeeks?: number;
  bucket?: "day" | "week" | "month";
  completeness?: {
    pct: number | null;
    transfers: number;
    filled: number;
    expected: number;
    complete: number;
    byField: Array<{ key: string; label: string; weight?: number; filled: number; expected: number; pct: number | null }>;
  };
  chartStart?: string; chartEnd?: string;
  chartNotes?: ClrNote[];
  metrics: {
    calls: number; transfers: number; transfersDirect: number; transfersAppointment: number;
    appointments: number; callbacks: number; deferrals: number; fellThrough: number;
    futureContacts: number; noAnswer: number; transferRate: number; daysWithCalls: number;
  };
  goals: { calls: number; transfers: number; appointments: number };
  daily: {
    date: string; endDate: string; dayCount: number;
    timeOffDays: number; allTimeOff: boolean;
    callMinutes: number; dialpadCalls: number; callToolsCalls: number;
    conversations: number; transfers: number; appointments: number;
  }[];
  hours: number;
  attendance: { checkins: number; lates: number; outsideArea: number; standing: { count: number; allowance: number; windowDays: number } };
  eodReports: number;
  comp: { earnedCents: number; reimbursedCents: number };
};

// One metric, this CLR against the floor. The bar is a relative position, not a
// percentage of anything — a CLR at twice the median fills it, so the eye can
// scan a column of them without reading every number.
function CompareRow({ c }: { c: Comparison }) {
  const ratio = c.teamMedian > 0 ? c.value / c.teamMedian : (c.value > 0 ? 2 : 0);
  const width = Math.max(2, Math.min(100, ratio * 50));
  const good = c.better;
  return (
    <div className="space-y-1" data-testid={`compare-${c.key}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{c.label}</span>
        <span className="text-xs tabular-nums">
          <span className="font-semibold text-foreground">{c.value}</span>
          <span className="text-muted-foreground"> vs {c.teamMedian} team</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${good ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={good ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
          {c.deltaPct == null
            ? "no team baseline yet"
            : `${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}% vs median${c.lowerIsBetter ? " (lower is better)" : ""}`}
        </span>
        <span className="text-muted-foreground">#{c.rank} of {c.outOf}</span>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold mt-1 tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1.5">{sub}</p>}
    </div>
  );
}

export default function ClrProfile() {
  const [, params] = useRoute("/clr-profiles/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const id = params?.id;
  const [period, setPeriod] = useState("month");
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState("");

  const { data, isLoading, isError, error } = useQuery<Resp>({
    queryKey: ["/api/clr-profiles", id, period],
    queryFn: () => apiRequest("GET", `/api/clr-profiles/${id}?period=${period}`),
    enabled: !!id,
    retry: false, // a 403/404 shouldn't spin — surface it
    // Keep the previous data while switching PERIODS (so the header doesn't
    // unmount), but never carry it across a different CLR — placeholderData
    // survives queryKey changes, which would briefly show the wrong person.
    placeholderData: (prev: any, prevQuery: any) => (prevQuery?.queryKey?.[1] === id ? prev : undefined),
  });

  const saveDate = useMutation({
    mutationFn: (startDate: string | null) => apiRequest("PATCH", `/api/clr-profiles/${id}/start-date`, { startDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clr-profiles"] });
      setEditingDate(false);
      toast({ title: "Start date saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  const m = data?.metrics;
  const [seriesKey, setSeriesKey] = useState<DailySeriesKey>("callMinutes");
  const activeSeries = DAILY_SERIES.find((x) => x.key === seriesKey) ?? DAILY_SERIES[0];
  const periodTotal = (data?.daily ?? []).reduce((sum, d) => sum + Number((d as any)[seriesKey] ?? 0), 0);
  const bucket = data?.bucket ?? "day";
  const bucketWord = bucket === "day" ? "day" : bucket === "week" ? "week" : "month";
  const periodTotalLabel = `${activeSeries.label}: ${activeSeries.format(periodTotal)} across this period · one bar per ${bucketWord}`;

  // A trend only means something once there are enough bars to have a shape,
  // which is exactly the long ranges. Least squares over the visible series.
  const showTrend = LONG_PERIODS.has(period) && (data?.daily?.length ?? 0) >= 3;
  const chartRows = (data?.daily ?? []).map((d, i, arr) => {
    let trend: number | undefined;
    if (showTrend) {
      const n = arr.length;
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let k = 0; k < n; k += 1) {
        const y = Number((arr[k] as any)[seriesKey] ?? 0);
        sx += k; sy += y; sxy += k * y; sxx += k * k;
      }
      const denom = n * sxx - sx * sx;
      if (denom !== 0) {
        const slope = (n * sxy - sx * sy) / denom;
        const intercept = (sy - slope * sx) / n;
        trend = Math.max(0, intercept + slope * i);
      }
    }
    return { ...d, trend };
  });
  const trendDelta = showTrend && chartRows.length > 1
    ? (chartRows[chartRows.length - 1].trend ?? 0) - (chartRows[0].trend ?? 0)
    : 0;

  // Bucket start -> the notes pinned inside it, so a week bar can carry a note
  // written on the Wednesday.
  const notesByBucket = new Map<string, ClrNote[]>();
  for (const n of data?.chartNotes ?? []) {
    const row = (data?.daily ?? []).find((d) => n.noteDate >= d.date && n.noteDate <= d.endDate);
    if (!row) continue;
    const list = notesByBucket.get(row.date) ?? [];
    list.push(n);
    notesByBucket.set(row.date, list);
  }
  // Past a couple of months a weekly target multiplied out stops meaning
  // anything, so the goal bars are withheld rather than drawn against a
  // number nobody set.
  const goalsTooLong = (data?.periodWeeks ?? 1) > 9;
  const axisLabel = (d: string) => {
    if (bucket === "month") return d.slice(0, 7);
    // Keep the year visible once a range can span one.
    return LONG_PERIODS.has(period) ? `${d.slice(5)}/${d.slice(2, 4)}` : d.slice(5);
  };

  // Notes are their own query so posting one never refetches the whole profile.
  const notesQuery = useQuery<{ notes: ClrNote[] }>({
    queryKey: ["/api/clr-profiles", id, "notes"],
    queryFn: () => apiRequest("GET", `/api/clr-profiles/${id}/notes`),
    enabled: !!id,
    retry: false,
  });
  const [noteBody, setNoteBody] = useState("");
  const [noteKind, setNoteKind] = useState<NoteKind>("note");
  // Training-day pay filed for THIS CLR. The server prices the days and drops
  // any already claimed, exactly as it does from the comp page.
  const [trainDates, setTrainDates] = useState<string[]>([]);
  const [trainRate, setTrainRate] = useState<TrainingRate>("standard");
  const [trainDay, setTrainDay] = useState("");
  const [summonReason, setSummonReason] = useState("");
  const summonsQuery = useQuery<{ summons: Array<{ id: number; user_id: number; reason: string; raised_by_name: string }> }>({
    queryKey: ["/api/summons"],
    queryFn: () => apiRequest("GET", "/api/summons"),
    refetchInterval: 20_000,
    retry: false,
  });
  const liveSummons = (summonsQuery.data?.summons ?? []).find((x) => Number(x.user_id) === Number(id));
  const callIn = useMutation({
    mutationFn: () => apiRequest("POST", "/api/summons", { userId: Number(id), reason: summonReason }),
    onSuccess: () => {
      setSummonReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/summons"] });
      toast({ title: "Called in", description: "Their C3 is alarming until you mark them checked in." });
    },
    onError: (e: any) => toast({ title: "Could not call them in", description: String(e?.message ?? e), variant: "destructive" }),
  });
  const clearSummons = useMutation({
    mutationFn: (sid: number) => apiRequest("POST", `/api/summons/${sid}/clear`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/summons"] });
      toast({ title: "Checked in", description: "Their alarm has stopped." });
    },
    onError: (e: any) => toast({ title: "Could not clear it", description: String(e?.message ?? e), variant: "destructive" }),
  });
  const addTrainDay = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    setTrainDates((prev) => (prev.includes(d) ? prev : [...prev, d].sort()));
    setTrainDay("");
  };
  const fileTraining = useMutation({
    mutationFn: () => apiRequest("POST", "/api/comp", {
      category: "training",
      trainingDates: trainDates,
      trainingRate: trainRate,
      onBehalfOf: Number(id),
      amountCents: trainingAmountCents(trainDates.length, trainRate),
    }),
    onSuccess: () => {
      setTrainDates([]); setTrainDay("");
      queryClient.invalidateQueries({ queryKey: ["/api/clr-profiles", id] });
      toast({ title: "Training pay requested", description: "Filed as a comp request and sent for approval." });
    },
    onError: (e: any) => toast({ title: "Could not file training pay", description: String(e?.message ?? e), variant: "destructive" }),
  });
  const [noteOnChart, setNoteOnChart] = useState(false);
  const [noteInReport, setNoteInReport] = useState(false);
  const [noteDate, setNoteDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  // Flipping a switch never edits or removes the note itself.
  const setNoteDisplay = useMutation({
    mutationFn: (v: { id: number; showOnChart?: boolean; inDailyReport?: boolean }) =>
      apiRequest("PATCH", `/api/clr-profiles/notes/${v.id}`, {
        showOnChart: v.showOnChart, inDailyReport: v.inDailyReport,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clr-profiles", id, "notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clr-profiles", id] });
    },
    onError: (e: any) => toast({ title: "Could not update the note", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const addNote = useMutation({
    mutationFn: () => apiRequest("POST", `/api/clr-profiles/${id}/notes`, {
      body: noteBody, noteDate, kind: noteKind,
      showOnChart: noteOnChart, inDailyReport: noteInReport,
    }),
    onSuccess: () => {
      setNoteBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/clr-profiles", id, "notes"] });
      toast({ title: "Note added" });
    },
    onError: (e: any) => toast({ title: "Could not save the note", description: e?.message, variant: "destructive" }),
  });
  const removeNote = useMutation({
    mutationFn: (noteId: number) => apiRequest("DELETE", `/api/clr-profiles/notes/${noteId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/clr-profiles", id, "notes"] }),
    onError: (e: any) => toast({ title: "Could not remove the note", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate("/clr-profiles")}>
        <ArrowLeft className="w-4 h-4" /> All CLRs
      </Button>

      {isError ? (
        <Card>
          <CardContent className="py-16 text-center space-y-1">
            <p className="font-medium text-sm">Can't show this profile</p>
            <p className="text-xs text-muted-foreground">
              {String((error as any)?.message ?? "").includes("403") || String((error as any)?.message ?? "").toLowerCase().includes("manager")
                ? "CLR profiles are visible to managers and admins only."
                : "That CLR wasn't found."}
            </p>
          </CardContent>
        </Card>
      ) : isLoading || !data ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : (
        <>
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
            <div className="relative flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                  {data.clr.name}
                  <ClrTrainingBadge inTraining={data.clr.inTraining} activeWorkdays={data.clr.activeWorkdays} className="border-sky-400/50 bg-sky-400/15 text-sky-100" />
                  {data.clr.isManager && <Badge className="bg-white/15 text-white border-0 text-[10px]">Manager</Badge>}
                  {data.clr.excludeFromStats && <Badge className="bg-white/15 text-white border-0 text-[10px]">Non-counted</Badge>}
                </h1>
                <p className="text-sm text-white/60 mt-0.5">{data.clr.email}</p>
                <div className="flex items-center gap-2 mt-2 text-sm text-white/80">
                  <CalendarDays className="w-4 h-4" />
                  {editingDate ? (
                    <span className="flex items-center gap-1.5">
                      <Input
                        type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)}
                        className="h-7 w-40 text-black dark:text-white" data-testid="input-start-date"
                      />
                      <Button size="sm" className="h-7" disabled={saveDate.isPending} onClick={() => saveDate.mutate(dateDraft || null)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-white/70" onClick={() => setEditingDate(false)}>Cancel</Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Started <strong className="text-white">{fmtStartDate(effectiveStart(data.clr.startDate, data.clr.createdAt))}</strong>
                      {data.clr.tenureDays != null && <span className="text-white/60">· {fmtTenure(data.clr.tenureDays)} on the team</span>}
                      {data.clr.startDateIsEstimate && <span className="text-white/50 text-xs">(from account creation)</span>}
                      {isAdmin && (
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-white/70 hover:text-white"
                          onClick={() => { setDateDraft(data.clr.startDate ?? ""); setEditingDate(true); }}
                          data-testid="btn-edit-start-date"
                        >
                          {data.clr.startDate ? "Edit" : "Set"}
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-[160px] h-9 bg-white/10 border-white/20 text-white" data-testid="select-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Showing {fmtStartDate(data.startDate)} – {fmtStartDate(data.endDate)}
          </p>

          {/* Headline production */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={PhoneForwarded} label="Transfers" value={m!.transfers}
                  sub={`${m!.transfersDirect} direct · ${m!.transfersAppointment} appt`} />
            <Stat icon={PhoneCall} label="Calls" value={m!.calls.toLocaleString()}
                  sub={`${m!.daysWithCalls} day${m!.daysWithCalls === 1 ? "" : "s"} logged`} />
            <Stat icon={Percent} label="Transfer ratio" value={`${m!.transferRate}%`} sub="transfers ÷ calls" />
            <Stat icon={CalendarCheck} label="Appointments" value={m!.appointments} sub={`${m!.callbacks} callbacks`} />
          </div>

          {/* Lifetime record, and how it sits against the floor. Independent of
              the period selector above on purpose — this is the "all time"
              question, the tiles answer the other one. */}
          {data.lifetime && (
            <Card data-testid="lifetime-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> All time vs the team
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <Stat icon={PhoneForwarded} label="Transfers (all time)" value={data.lifetime.totals.transfers.toLocaleString()}
                        sub={`${data.lifetime.rates.transfersPerDay} per active day`} />
                  {/* The fair rate: only normal working days count — the first
                      20 training days and any trainer days are excluded from
                      both sides of the division. */}
                  <Stat icon={TrendingUp} label="Transfers / workday"
                        value={data.lifetime.workdayRate?.ratePerWorkingDay ?? "\u2014"}
                        sub={data.lifetime.workdayRate
                          ? (data.lifetime.workdayRate.graduated
                            ? `${data.lifetime.workdayRate.workingDays} workdays \u00b7 excl. ${data.lifetime.workdayRate.trainingDays} training${data.lifetime.workdayRate.trainerDays ? ` + ${data.lifetime.workdayRate.trainerDays} trainer` : ""} days`
                            : "still in training")
                          : "no data"} />
                  <Stat icon={CalendarCheck} label="Appointments" value={data.lifetime.totals.appointments.toLocaleString()}
                        sub={`${data.lifetime.rates.appointmentsPerDay} per active day`} />
                  <Stat icon={PhoneCall} label="Calls" value={data.lifetime.totals.calls.toLocaleString()}
                        sub={`${data.lifetime.rates.callsPerDay} per active day`} />
                  <Stat icon={Percent} label="Active days" value={data.lifetime.totals.activeDays}
                        sub={data.lifetime.totals.firstDay ? `since ${fmtStartDate(data.lifetime.totals.firstDay)}` : "no activity yet"} />
                </div>

                {/* Totals reward tenure, so the comparison is per active day.
                    Said out loud, because a manager reading a rank deserves to
                    know what it is a rank OF. */}
                <p className="text-[11px] text-muted-foreground">
                  Compared against the median of {data.lifetime.peerCount} other counted CLR
                  {data.lifetime.peerCount === 1 ? "" : "s"}, per active day rather than by total — otherwise
                  whoever has been here longest always wins.
                </p>

                {data.lifetime.thin && (
                  <p className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300"
                     data-testid="thin-sample-warning">
                    Only {data.lifetime.totals.activeDays} active day
                    {data.lifetime.totals.activeDays === 1 ? "" : "s"} logged — under {data.lifetime.minDays} these
                    rates swing on a single call, so treat the ranking as provisional.
                  </p>
                )}

                <div className="space-y-3">
                  {data.lifetime.comparisons.map((c: any) => <CompareRow key={c.key} c={c} />)}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Goals vs actual (weekly targets) */}
          {(data.goals.calls > 0 || data.goals.transfers > 0 || data.goals.appointments > 0) && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Weekly goals</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Goals are WEEKLY, so scale them to the selected window —
                    otherwise a month of work is judged against one week's target. */}
                {([["Calls", m!.calls, data.goals.calls], ["Transfers", m!.transfers, data.goals.transfers], ["Appointments", m!.appointments, data.goals.appointments]] as const).map(([label, actual, weeklyGoal]) => {
                  const target = weeklyGoal > 0 && !goalsTooLong ? weeklyGoal * (data.periodWeeks ?? 1) : 0;
                  return (
                    <div key={label}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="tabular-nums text-muted-foreground">{actual}{target > 0 ? ` / ${target}` : ""}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted mt-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: target > 0 ? `${Math.min(100, (actual / target) * 100)}%` : "0%" }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground sm:col-span-3">
                  {goalsTooLong
                    ? "Weekly goals aren't meaningful over a range this long — pick a shorter timeframe."
                    : `Weekly goals scaled to this period${(data.periodWeeks ?? 1) > 1 ? ` (×${data.periodWeeks} weeks)` : ""}. A period still in progress will read low.`}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Outcome mix */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Outcome breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {([["Transfers", m!.transfers], ["Appointments", m!.appointments], ["Callbacks", m!.callbacks], ["Deferrals", m!.deferrals],
                   ["Fell through", m!.fellThrough], ["Future contact", m!.futureContacts], ["No answer", m!.noAnswer]] as const).map(([label, v]) => (
                  <div key={label} className="rounded-lg border px-3 py-2">
                    <p className="text-lg font-bold tabular-nums leading-none">{v}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* What the day actually looked like on the phones. Every series here
              comes from the dialer feeds or from logged outcomes — none of it is
              self-reported, which is what made the old "calls" bar untrustworthy. */}
          {data.daily.length >= 1 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {bucket === "day" ? "Daily activity" : bucket === "week" ? "Weekly activity" : "Monthly activity"}
                    </CardTitle>
                    <CardDescription>{periodTotalLabel}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {DAILY_SERIES.map((sdef) => (
                      <button
                        key={sdef.key}
                        type="button"
                        onClick={() => setSeriesKey(sdef.key)}
                        className={
                          "rounded-md border px-2.5 py-1 text-xs transition-colors " +
                          (seriesKey === sdef.key ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")
                        }
                        data-testid={"clr-series-" + sdef.key}
                      >
                        {sdef.label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartRows} margin={{ top: 18, right: 8, bottom: 4, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                      {/* Days away are shaded, so an empty bar reads as "off"
                          rather than as a day that went nowhere. */}
                      {chartRows.filter((d) => d.allTimeOff).map((d) => (
                        <ReferenceArea
                          key={"off-" + d.date} x1={d.date} x2={d.date}
                          fill="hsl(var(--muted-foreground))" fillOpacity={0.14}
                        />
                      ))}
                      <XAxis
                        dataKey="date" tickLine={false} axisLine={false}
                        tick={{ fontSize: 11 }} minTickGap={24}
                        tickFormatter={(d: any) => (typeof d === "string" ? axisLabel(d) : String(d))}
                      />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} width={54} />
                      <Tooltip
                        cursor={{ className: "fill-muted/40" }}
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload ?? {};
                          const notes: ClrNote[] = notesByBucket.get(String(label)) ?? [];
                          return (
                            <div className="max-w-[280px] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                              <p className="font-semibold">
                                {row.date === row.endDate ? row.date : row.date + " → " + row.endDate}
                              </p>
                              <p className="mt-0.5 tabular-nums">
                                {activeSeries.label}: {activeSeries.format(Number(row[seriesKey] ?? 0))}
                              </p>
                              {row.timeOffDays > 0 && (
                                <p className="mt-0.5 text-muted-foreground">
                                  {row.timeOffDays === row.dayCount ? "Time off" : row.timeOffDays + " day(s) off"}
                                </p>
                              )}
                              {notes.map((n) => {
                                const st = noteStyle(n.kind);
                                return (
                                  <p key={n.id} className={"mt-1.5 rounded border px-1.5 py-1 " + st.ring}>
                                    <span className="font-semibold">{st.label} · {n.noteDate}</span>
                                    <br />{n.body}
                                    <br /><span className="text-muted-foreground">— {n.authorName}</span>
                                  </p>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey={seriesKey} fill={activeSeries.color} radius={[3, 3, 0, 0]} />
                      {showTrend && (
                        <Line
                          type="monotone" dataKey="trend" dot={false} strokeWidth={2}
                          stroke="hsl(var(--foreground))" strokeOpacity={0.5} strokeDasharray="5 4"
                          isAnimationActive={false} legendType="none"
                        />
                      )}
                      {/* Pinned notes ride above the bars. Annotation only —
                          no total on this page reads them. */}
                      {chartRows.filter((d) => notesByBucket.has(d.date)).map((d) => {
                        const notes = notesByBucket.get(d.date) ?? [];
                        const worst = notes.find((n) => n.kind === "pip")
                          ?? notes.find((n) => n.kind === "warning") ?? notes[0];
                        const st = noteStyle(worst?.kind ?? "note");
                        const hover = notes
                          .map((n) => n.noteDate + " " + noteStyle(n.kind).label + ": " + n.body)
                          .join("\n\n");
                        return (
                          <ReferenceArea
                            key={"note-" + d.date} x1={d.date} x2={d.date}
                            shape={(props: any) => (
                              <g transform={"translate(" + (props.x + (props.width ?? 0) / 2) + ", 8)"}>
                                <title>{hover}</title>
                                <circle r={7} fill={st.dot} />
                                <text textAnchor="middle" y={3.5} fontSize={10} fontWeight={700} fill="#ffffff">
                                  {notes.length > 1 ? notes.length : "!"}
                                </text>
                              </g>
                            )}
                          />
                        );
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {data.completeness && data.completeness.transfers > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">Transfer write-up</CardTitle>
                    <CardDescription>
                      How much of the information a transfer asks for actually got filled in.
                      Each transfer is scored only against the fields that applied to it.
                    </CardDescription>
                  </div>
                  <span
                    className={"text-3xl font-bold tabular-nums "
                      + ((data.completeness.pct ?? 0) >= 90 ? "text-emerald-600 dark:text-emerald-400"
                        : (data.completeness.pct ?? 0) >= 70 ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400")}
                    data-testid="clr-completeness-pct"
                  >
                    {data.completeness.pct === null ? "—" : `${data.completeness.pct}%`}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground" data-testid="clr-completeness-summary">
                  {data.completeness.complete} of {data.completeness.transfers} transfer
                  {data.completeness.transfers === 1 ? "" : "s"} fully written up
                  {" · "}{data.completeness.filled} of {data.completeness.expected} fields
                </p>
                {data.completeness.byField
                  .filter((f) => f.expected > 0)
                  .sort((a, b) => (a.pct ?? 100) - (b.pct ?? 100)
                    || (b.weight ?? 1) - (a.weight ?? 1))
                  .map((f) => (
                    <div key={f.key} className="flex items-center gap-3" data-testid="clr-completeness-field">
                      <span className="w-32 shrink-0 text-xs text-muted-foreground">
                        {f.label}
                        {(f.weight ?? 1) > 1 && (
                          <span
                            className="ml-1 rounded bg-primary/10 px-1 font-semibold text-primary"
                            title={`Counts ${f.weight}x — a qualification answer decides whether the lead is workable at all`}
                            data-testid="clr-completeness-weight"
                          >&times;{f.weight}</span>
                        )}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={"h-full rounded-full "
                            + ((f.pct ?? 0) >= 90 ? "bg-emerald-500" : (f.pct ?? 0) >= 70 ? "bg-amber-500" : "bg-red-500")}
                          style={{ width: `${f.pct ?? 0}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {f.pct}% ({f.filled}/{f.expected})
                      </span>
                    </div>
                  ))}
                <p className="text-[11px] text-muted-foreground">
                  Qualification answers count &times;4. An LOA is only counted on
                  transfers whose loan officer has one, and a section marked N/A
                  is not counted at all.
                </p>
              </CardContent>
            </Card>
          )}

          <Card className={liveSummons ? "border-red-500/70 bg-red-500/5" : undefined}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Call them in</CardTitle>
              <CardDescription>
                Takes over {data.clr.name}&rsquo;s C3 with a siren and a flashing screen until you mark
                them checked in. They cannot switch it off themselves.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {liveSummons ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-red-600 dark:text-red-400" data-testid="summons-active">
                    Alarming now{liveSummons.reason ? ` — “${liveSummons.reason}”` : ""}
                  </p>
                  <Button
                    size="sm"
                    disabled={clearSummons.isPending}
                    onClick={() => clearSummons.mutate(liveSummons.id)}
                    data-testid="summons-clear"
                  >
                    They checked in — stop it
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={summonReason}
                    onChange={(e) => setSummonReason(e.target.value)}
                    placeholder="What is this about? (optional)"
                    className="h-9 flex-1 min-w-[200px]"
                    data-testid="summons-reason-input"
                  />
                  <Button
                    size="sm" variant="destructive"
                    disabled={callIn.isPending}
                    onClick={() => callIn.mutate()}
                    data-testid="summons-raise"
                  >
                    Call them in
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Training pay</CardTitle>
              <CardDescription>
                Days {data.clr.name} spent training someone. Filed as an ordinary comp request for
                them, and it goes through the same approval as everything else.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date" value={trainDay} className="h-9 w-44"
                  onChange={(e) => {
                    // Store every keystroke. A half-typed date is still a value
                    // the field has to hold, or it clears itself as you type.
                    const d = e.target.value;
                    setTrainDay(d);
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) addTrainDay(d);
                  }}
                  data-testid="clr-training-day"
                />
                <Button
                  type="button" size="sm" variant="outline"
                  disabled={!/^\d{4}-\d{2}-\d{2}$/.test(trainDay)}
                  onClick={() => addTrainDay(trainDay)}
                  data-testid="clr-training-add-day"
                >
                  Add day
                </Button>
                <div className="flex gap-1">
                  {(Object.keys(TRAINING_DAY_RATES) as TrainingRate[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setTrainRate(r)}
                      className={"rounded-md border px-2.5 py-1 text-xs transition-colors "
                        + (trainRate === r ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}
                      data-testid={"clr-training-rate-" + r}
                    >
                      {TRAINING_DAY_RATES[r].label} · {TRAINING_DAY_RATES[r].perDay}
                    </button>
                  ))}
                </div>
              </div>
              {trainDates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {trainDates.map((d) => (
                    <span key={d} className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-1 text-xs">
                      {d}
                      <button
                        type="button" aria-label={"Remove " + d}
                        onClick={() => setTrainDates((prev) => prev.filter((x) => x !== d))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {trainDates.length > 0
                    ? `${trainDates.length} day${trainDates.length === 1 ? "" : "s"} \u00d7 ${TRAINING_DAY_RATES[trainRate].perDay} = $${(trainingAmountCents(trainDates.length, trainRate) / 100).toFixed(2)}`
                    : "Pick each day they trained."}
                </p>
                <Button
                  size="sm"
                  disabled={fileTraining.isPending || trainDates.length === 0}
                  onClick={() => fileTraining.mutate()}
                  data-testid="clr-training-submit"
                >
                  Request training pay
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dated manager notes. Deliberately not a metric — nothing on this
              page aggregates or plots them, so a note can never move a number. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Manager notes</CardTitle>
              <CardDescription>
                Every note is kept on the record. The two switches only choose where it also shows —
                no note is ever counted in a statistic.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-start">
                <Input
                  type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)}
                  data-testid="clr-note-date"
                />
                <Textarea
                  rows={2} value={noteBody} onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="What happened, what was discussed, what to watch"
                  data-testid="clr-note-body"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-1">
                    {(Object.keys(NOTE_STYLES) as NoteKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setNoteKind(k);
                          // A warning or a PIP is the thing you most want to see
                          // against the numbers later, so pin it by default.
                          if (k !== "note") setNoteOnChart(true);
                        }}
                        className={
                          "rounded-md border px-2.5 py-1 text-xs transition-colors " +
                          (noteKind === k ? noteStyle(k).ring + " font-semibold" : "hover:bg-muted")
                        }
                        data-testid={"clr-note-kind-" + k}
                      >
                        {noteStyle(k).label}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox" checked={noteOnChart}
                      onChange={(e) => setNoteOnChart(e.target.checked)}
                      data-testid="clr-note-on-chart"
                    />
                    Show on chart
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox" checked={noteInReport}
                      onChange={(e) => setNoteInReport(e.target.checked)}
                      data-testid="clr-note-in-report"
                    />
                    Add to that day&rsquo;s report email
                  </label>
                </div>
                <Button
                  size="sm"
                  disabled={addNote.isPending || !noteBody.trim()}
                  onClick={() => addNote.mutate()}
                  data-testid="clr-note-save"
                >
                  Add note
                </Button>
              </div>
              <div className="space-y-2">
                {(notesQuery.data?.notes ?? []).map((n) => {
                  const st = noteStyle(n.kind);
                  return (
                    <div key={n.id} className={"rounded-lg border px-3 py-2 " + (n.kind === "note" ? "bg-muted/20" : st.ring)} data-testid="clr-note">
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          <st.Icon className="h-3 w-3" style={{ color: st.dot }} />
                          {st.label} · {n.noteDate} · {n.authorName}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeNote.mutate(n.id)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                          aria-label="Remove note"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
                      <div className="mt-1.5 flex flex-wrap gap-3">
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox" checked={n.showOnChart}
                            onChange={(e) => setNoteDisplay.mutate({ id: n.id, showOnChart: e.target.checked })}
                            data-testid="clr-note-toggle-chart"
                          />
                          On chart
                        </label>
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox" checked={n.inDailyReport}
                            onChange={(e) => setNoteDisplay.mutate({ id: n.id, inDailyReport: e.target.checked })}
                            data-testid="clr-note-toggle-report"
                          />
                          In report email
                        </label>
                      </div>
                    </div>
                  );
                })}
                {!notesQuery.isLoading && !(notesQuery.data?.notes ?? []).length && (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Operational */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={Timer} label="Hours worked" value={data.hours.toFixed(1)} sub="from the time clock" />
            <Stat icon={UserCheck} label="Check-ins" value={data.attendance.checkins}
                  sub={`${data.attendance.lates} late · ${data.attendance.outsideArea} different IP`} />
            <Stat icon={FileText} label="EOD reports" value={data.eodReports} sub="submitted in period" />
            <Stat icon={Wallet} label="Comp approved" value={money(data.comp.earnedCents)}
                  sub={data.comp.reimbursedCents ? `+ ${money(data.comp.reimbursedCents)} reimbursed` : "earned comp"} />
          </div>

          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
            Attendance standing: <strong className="text-foreground">{data.attendance.standing.count} of {data.attendance.standing.allowance}</strong> lates
            used in the rolling {data.attendance.standing.windowDays}-day window (excused lates don't count).
          </div>
        </>
      )}
    </div>
  );
}
