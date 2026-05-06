import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  PhoneCall, Calendar, XCircle, ArrowUpRight, Trophy,
  CheckCircle2, AlertTriangle, ShieldCheck, Send, RefreshCw, TrendingUp,
  Download, Activity, MapPin, Target, Flame, ArrowDown, ArrowUp,
  Minus, AlertOctagon, Info, BarChart3, PieChart as PieIcon, Award,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { useAuth } from "@/lib/auth";

// Theme colors
const NAVY = "#0F182D";
const NAVY_2 = "#1A2B4A";
const GOLD = "#C9A24A";
const GOLD_2 = "#C49A3C";
const GREEN = "#16a34a";
const BLUE = "#2563eb";
const RED = "#dc2626";
const AMBER = "#d97706";
const PURPLE = "#7c3aed";
const CYAN = "#0891b2";

type RangeKey = "week" | "30d" | "3mo" | "all";
const RANGE_OPTIONS: { key: RangeKey; label: string; short: string }[] = [
  { key: "week", short: "Week", label: "Last 7 days" },
  { key: "30d",  short: "30d",  label: "Last 30 days" },
  { key: "3mo",  short: "3mo",  label: "Last 3 months" },
  { key: "all",  short: "All",  label: "All time" },
];

type PipelineRange = "1d" | "3d" | "7d";
const PIPELINE_OPTIONS: { key: PipelineRange; label: string }[] = [
  { key: "1d", label: "1d" },
  { key: "3d", label: "3d" },
  { key: "7d", label: "7d" },
];

type Alert = { level: "warn" | "danger" | "info"; text: string; href?: string };
type RangeBlock = {
  window: { startDate: string; endDate: string; days: number; label: string };
  trend: { date: string; calls: number; transfers: number; appointments: number; fellThrough: number }[];
  outcomeBreakdown: { outcome_type: string; count: number }[];
  fellThroughReasons: { label: string; count: number }[];
  topLos: { id: number; name: string; transfers: number }[];
  leaderboard: {
    userId: number; name: string;
    transfers: number; appointments: number; fellThrough: number;
    totalOutcomes: number; calls: number; conversionRate: number;
    transferPct: number; appointmentPct: number; fellThroughPct: number;
    callToTransferPct: number | null;
  }[];
  heatmap: { dates: string[]; rows: { userId: number; name: string; cells: number[] }[] };
  callsHeatmap: { dates: string[]; rows: { userId: number; name: string; cells: number[] }[] };
  topStates: { state: string; transfers: number }[];
};
type ManagerData = {
  generatedAt: string;
  today: string;
  ranges: { week: any; month: any; last30: any };
  stats: { today: any; week: any; month: any; priorWeek: any; priorMonth: any };
  clrCards: any[];
  eod: {
    date: string;
    total: number;
    submitted: number;
    missing: number;
    rows: { userId: number; name: string; email: string; submitted: boolean; submittedAt: string | null }[];
  };
  pipeline: {
    todayTransfers: any[];
    transfers7d: any[];
    overdueAppointments: any[];
    overdueNmls: any[];
  };
  byRange: Record<RangeKey, RangeBlock>;
  activityFeed: any[];
  alerts: Alert[];
};

// Detect dark mode (reactive to class changes on <html>).
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function deltaInfo(current: number, prior: number) {
  if (!prior && !current) return { dir: "flat" as const, pct: 0, label: "—" };
  if (!prior) return { dir: "up" as const, pct: 100, label: "new" };
  const pct = Math.round(((current - prior) / prior) * 100);
  return { dir: pct > 0 ? "up" as const : pct < 0 ? "down" as const : "flat" as const, pct: Math.abs(pct), label: `${pct > 0 ? "+" : ""}${pct}%` };
}

function DeltaArrow({ dir, pct, label, invert = false }: { dir: "up" | "down" | "flat"; pct: number; label: string; invert?: boolean }) {
  const isPositive = invert ? dir === "down" : dir === "up";
  const isNegative = invert ? dir === "up" : dir === "down";
  const color = dir === "flat" ? "#94a3b8" : isPositive ? GREEN : isNegative ? RED : "#94a3b8";
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums" style={{ color }}>
      <Icon className="w-3 h-3" />
      {label} <span className="text-muted-foreground font-normal">vs prior</span>
    </span>
  );
}

function KpiTile({
  label, value, sub, icon: Icon, color = NAVY, href, delta,
}: { label: string; value: string | number; sub?: React.ReactNode; icon: any; color?: string; href?: string; delta?: React.ReactNode }) {
  const inner = (
    <Card className="overflow-hidden transition-all hover:shadow-lg hover:border-[#C9A24A]/40 h-full">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
            {delta && <div className="mt-1">{delta}</div>}
          </div>
          <div className="rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function SectionTitle({ icon: Icon, children, action }: { icon: any; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 className="text-lg font-semibold flex items-center gap-2 brand-text">
        <Icon className="w-5 h-5" style={{ color: GOLD }} />
        {children}
      </h2>
      {action}
    </div>
  );
}

// Range selector — pill-button group. Compact & dark-mode aware via shadcn tokens.
function RangePills<K extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { key: K; label: string; short?: string }[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel}
         className="inline-flex items-center rounded-md border bg-muted/40 p-0.5 text-xs">
      {options.map(o => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={
              "px-2.5 py-1 rounded-[4px] font-medium transition-colors tabular-nums " +
              (active
                ? "bg-card shadow-sm brand-text"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {o.short ?? o.label}
          </button>
        );
      })}
    </div>
  );
}

function AlertsBanner({ alerts }: { alerts: Alert[] }) {
  if (!alerts?.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const palette =
          a.level === "danger"
            ? { wrap: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200", Icon: AlertOctagon } :
          a.level === "warn"
            ? { wrap: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-200", Icon: AlertTriangle } :
              { wrap: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-900/60 dark:text-blue-200", Icon: Info };
        const Icon = palette.Icon;
        const inner = (
          <div className={"flex items-start gap-3 px-4 py-2.5 rounded-lg border text-sm " + palette.wrap}>
            <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{a.text}</div>
            {a.href && <span className="text-xs font-medium underline">View →</span>}
          </div>
        );
        return a.href ? <Link key={i} href={a.href}>{inner}</Link> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

function GoalBar({ value, goal, pct, color }: { value: number; goal: number; pct: number | null; color: string }) {
  const width = pct == null ? 0 : Math.min(100, pct);
  const overflow = pct != null && pct > 100;
  return (
    <div>
      <div className="flex justify-between items-baseline text-xs mb-0.5">
        <span className="text-muted-foreground tabular-nums">{value} / {goal || "—"}</span>
        <span className="tabular-nums font-medium" style={{ color: pct == null ? "#94a3b8" : overflow ? GREEN : color }}>
          {pct == null ? "no goal" : `${pct}%`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full transition-all"
          style={{
            width: `${width}%`,
            backgroundColor: pct == null ? "#cbd5e1" : overflow ? GREEN : color,
          }}
        />
      </div>
    </div>
  );
}

function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer",
  appointment: "Appointment",
  fell_through: "Fell through",
  callback_requested: "Callback",
  deferral: "Deferral",
  no_answer: "No answer",
  future_contact: "Future contact",
};
const OUTCOME_COLORS: Record<string, string> = {
  transfer: GREEN, appointment: BLUE, fell_through: RED, callback_requested: AMBER,
  deferral: PURPLE, no_answer: "#64748b", future_contact: CYAN,
};

const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"]; // Sun..Sat

// Tiered intensity: returns 0..4 bucket index for a value given a max scale.
function intensityBucket(v: number, max: number): number {
  if (!v || v <= 0) return 0;
  if (max <= 1) return 4;
  const r = v / max;
  if (r <= 0.2) return 1;
  if (r <= 0.45) return 2;
  if (r <= 0.7) return 3;
  return 4;
}

// Concrete numeric thresholds that match intensityBucket(...) so the legend tells the truth.
function bucketRanges(max: number): string[] {
  if (max <= 0) return ["0", "—", "—", "—", "—"];
  if (max === 1) return ["0", "—", "—", "—", "1"];
  const t1 = Math.max(1, Math.round(max * 0.2));
  const t2 = Math.max(t1 + 1, Math.round(max * 0.45));
  const t3 = Math.max(t2 + 1, Math.round(max * 0.7));
  return [
    "0",
    `1–${t1}`,
    `${t1 + 1}–${t2}`,
    `${t2 + 1}–${t3}`,
    `${t3 + 1}+`,
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isDark = useIsDarkMode();
  const [showAllClrs, setShowAllClrs] = useState(false);

  // Per-section range state
  const [rangeTrend, setRangeTrend] = useState<RangeKey>("30d");
  const [rangeMix, setRangeMix] = useState<RangeKey>("30d");
  const [rangeReasons, setRangeReasons] = useState<RangeKey>("30d");
  const [rangeLeaderboard, setRangeLeaderboard] = useState<RangeKey>("30d");
  const [rangeHeatmap, setRangeHeatmap] = useState<RangeKey>("30d");
  const [rangeTopLos, setRangeTopLos] = useState<RangeKey>("30d");
  const [rangeStates, setRangeStates] = useState<RangeKey>("30d");
  const [rangeCompare, setRangeCompare] = useState<RangeKey>("30d");
  type CompareSort = "transferPct" | "appointmentPct" | "fellThroughPct" | "totalOutcomes" | "name";
  const [compareSort, setCompareSort] = useState<CompareSort>("transferPct");
  const [pipelineRange, setPipelineRange] = useState<PipelineRange>("1d");

  const { data, isLoading, refetch, isFetching } = useQuery<ManagerData>({
    queryKey: ["/api/manager-dashboard"],
    refetchInterval: 60_000,
  });

  const sendEodReminders = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/eod-reminders/run-now", {}),
    onSuccess: () => toast({ title: "EOD reminders sent", description: "Reminder cron triggered." }),
    onError: (e: any) => toast({ title: "Failed to send reminders", description: e?.message ?? "Try again", variant: "destructive" }),
  });

  // Trend chart data with formatted labels — depends on range
  const trendData = useMemo(() => {
    const block = data?.byRange?.[rangeTrend];
    if (!block) return [];
    return block.trend.map(d => ({ ...d, label: format(parseISO(d.date), "MMM d") }));
  }, [data?.byRange, rangeTrend]);

  const outcomePieData = useMemo(() => {
    const block = data?.byRange?.[rangeMix];
    if (!block) return [];
    return block.outcomeBreakdown.map(o => ({
      name: OUTCOME_LABELS[o.outcome_type] ?? o.outcome_type,
      value: Number(o.count) || 0,
      color: OUTCOME_COLORS[o.outcome_type] ?? "#94a3b8",
    }));
  }, [data?.byRange, rangeMix]);

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const { stats, clrCards, eod, pipeline, activityFeed, alerts, byRange } = data;

  // KPI summary numbers (pulled from week range trend so they match KPI tiles)
  const trend30 = byRange["30d"]?.trend ?? [];
  const todayCalls = stats.today?.totalCallsToday ?? 0;
  const last7Calls = trend30.slice(-7).reduce((s, d) => s + (d.calls || 0), 0);
  const last30Calls = trend30.reduce((s, d) => s + (d.calls || 0), 0);
  const priorLast7Calls = trend30.slice(-14, -7).reduce((s, d) => s + (d.calls || 0), 0);

  // WoW deltas
  const transferDeltaWk = deltaInfo(stats.week?.transfers ?? 0, stats.priorWeek?.transfers ?? 0);
  const apptDeltaWk = deltaInfo(stats.week?.appointments ?? 0, stats.priorWeek?.appointments ?? 0);
  const fellDeltaWk = deltaInfo(stats.week?.fellThrough ?? 0, stats.priorWeek?.fellThrough ?? 0);
  const callsDeltaWk = deltaInfo(last7Calls, priorLast7Calls);
  const transferDeltaMo = deltaInfo(stats.month?.transfers ?? 0, stats.priorMonth?.transfers ?? 0);
  const apptDeltaMo = deltaInfo(stats.month?.appointments ?? 0, stats.priorMonth?.appointments ?? 0);
  const fellDeltaMo = deltaInfo(stats.month?.fellThrough ?? 0, stats.priorMonth?.fellThrough ?? 0);

  const visibleClrs = showAllClrs ? clrCards : clrCards.slice(0, 6);

  // Pipeline transfers — slice to selected range
  const cutoffDate = (() => {
    const days = pipelineRange === "1d" ? 0 : pipelineRange === "3d" ? 2 : 6;
    const d = new Date(); d.setDate(d.getDate() - days);
    return d.toISOString().split("T")[0];
  })();
  const filteredTransfers = (pipeline.transfers7d ?? []).filter((t: any) => t.date >= cutoffDate);
  const filteredOverdueAppts = pipeline.overdueAppointments; // overdue is independent of range
  const filteredOverdueNmls = pipeline.overdueNmls;

  // Active range blocks
  const reasonsBlock = byRange[rangeReasons];
  const leaderboardBlock = byRange[rangeLeaderboard];
  const heatmapBlock = byRange[rangeHeatmap];
  const topLosBlock = byRange[rangeTopLos];
  const statesBlock = byRange[rangeStates];
  const compareBlock = byRange[rangeCompare];

  // Sorted CLR-comparison rows, filtered to CLRs with at least one logged outcome.
  const compareRows = (compareBlock?.leaderboard ?? [])
    .filter(r => r.totalOutcomes > 0)
    .sort((a, b) => {
      if (compareSort === "name") return a.name.localeCompare(b.name);
      const av = (a as any)[compareSort] ?? 0;
      const bv = (b as any)[compareSort] ?? 0;
      return bv - av;
    });
  // Chart data — stacked %s, ordered same as compareRows. Recharts uses one row per CLR.
  const compareChartData = compareRows.map(r => ({
    name: r.name,
    transferPct: r.transferPct,
    appointmentPct: r.appointmentPct,
    fellThroughPct: r.fellThroughPct,
    otherPct: Math.max(0, Math.round((100 - r.transferPct - r.appointmentPct - r.fellThroughPct) * 10) / 10),
    transfers: r.transfers,
    appointments: r.appointments,
    fellThrough: r.fellThrough,
    totalOutcomes: r.totalOutcomes,
  }));

  const handleExportCsv = () => {
    const rows = clrCards.map(c => ({
      Name: c.name, Email: c.email,
      Calls: c.calls, "Calls goal (prorated)": c.goalCalls, "Calls %": c.callsPct ?? "",
      Transfers: c.transfers, "Transfer goal (prorated)": c.goalTransfers, "Transfer %": c.transfersPct ?? "",
      Appointments: c.appointments, "Appt goal (prorated)": c.goalAppts, "Appt %": c.apptsPct ?? "",
      "Fell through": c.fellThrough,
      Callbacks: c.callbacks, "No answer": c.noAnswer, "Future contact": c.futureContact,
      "Assigned": c.assigned, "Completed": c.completed, "Completion %": c.completionPct ?? "",
      "Call→Transfer %": c.callToTransferRatio ?? "",
    }));
    const dateTag = format(new Date(), "yyyy-MM-dd");
    downloadCsv(`clr-team-report-${dateTag}.csv`, rows);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider"
                  style={{ backgroundColor: NAVY, color: GOLD }}>
              Manager view
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mt-1 brand-text">
            Welcome back, {user?.name?.split(" ")[0] ?? "Manager"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Team overview · {format(parseISO(data.today), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Alerts banner */}
      <AlertsBanner alerts={alerts} />

      {/* KPI tiles — Today */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Today</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Calls" value={todayCalls.toLocaleString()} icon={PhoneCall} color={isDark ? GOLD : NAVY} />
          <KpiTile label="Transfers" value={stats.today?.transfers ?? 0} icon={ArrowUpRight} color={GREEN} />
          <KpiTile label="Appointments" value={stats.today?.appointments ?? 0} icon={Calendar} color={BLUE} />
          <KpiTile label="Fell through" value={stats.today?.fellThrough ?? 0} icon={XCircle} color={RED} />
        </div>
      </div>

      {/* KPI tiles — This week with WoW deltas */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">This week</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Calls (7d)" value={last7Calls.toLocaleString()} icon={PhoneCall} color={isDark ? GOLD : NAVY}
                   delta={<DeltaArrow {...callsDeltaWk} />} />
          <KpiTile label="Transfers" value={stats.week?.transfers ?? 0} icon={ArrowUpRight} color={GREEN}
                   delta={<DeltaArrow {...transferDeltaWk} />} />
          <KpiTile label="Appointments" value={stats.week?.appointments ?? 0} icon={Calendar} color={BLUE}
                   delta={<DeltaArrow {...apptDeltaWk} />} />
          <KpiTile label="Fell through" value={stats.week?.fellThrough ?? 0} icon={XCircle} color={RED}
                   delta={<DeltaArrow {...fellDeltaWk} invert />} />
        </div>
      </div>

      {/* KPI tiles — This month with MoM deltas */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">This month</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Transfers" value={stats.month?.transfers ?? 0} sub={`Conv ${stats.month?.conversionRate ?? 0}%`}
                   icon={ArrowUpRight} color={GREEN} delta={<DeltaArrow {...transferDeltaMo} />} />
          <KpiTile label="Appointments" value={stats.month?.appointments ?? 0} icon={Calendar} color={BLUE}
                   delta={<DeltaArrow {...apptDeltaMo} />} />
          <KpiTile label="Fell through" value={stats.month?.fellThrough ?? 0} icon={XCircle} color={RED}
                   delta={<DeltaArrow {...fellDeltaMo} invert />} />
          <KpiTile label="Calls (30d)" value={last30Calls.toLocaleString()} sub={`${last7Calls.toLocaleString()} this wk`}
                   icon={TrendingUp} color={isDark ? GOLD_2 : NAVY_2} />
        </div>
      </div>

      {/* Trend chart with range selector */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2 brand-text">
              <TrendingUp className="w-4 h-4" style={{ color: GOLD }} />
              Team trend — {byRange[rangeTrend]?.window?.label ?? ""}
            </CardTitle>
            <RangePills options={RANGE_OPTIONS} value={rangeTrend} onChange={setRangeTrend} ariaLabel="Trend range" />
          </div>
        </CardHeader>
        <CardContent>
          {trendData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data in this range</div>
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#27272a" : "#e5e7eb"} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} interval={Math.max(0, Math.floor(trendData.length / 8))} />
                    <YAxis tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} />
                    <Tooltip contentStyle={{ backgroundColor: isDark ? "#1f1d1c" : "#ffffff", border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`, color: isDark ? "#e4e4e7" : "#0f172a" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="transfers" stroke={GREEN} strokeWidth={2} dot={false} name="Transfers" />
                    <Line type="monotone" dataKey="appointments" stroke={BLUE} strokeWidth={2} dot={false} name="Appointments" />
                    <Line type="monotone" dataKey="fellThrough" stroke={RED} strokeWidth={2} dot={false} name="Fell through" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-32 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#27272a" : "#e5e7eb"} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} interval={Math.max(0, Math.floor(trendData.length / 8))} />
                    <YAxis tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} />
                    <Tooltip contentStyle={{ backgroundColor: isDark ? "#1f1d1c" : "#ffffff", border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`, color: isDark ? "#e4e4e7" : "#0f172a" }} />
                    <Bar dataKey="calls" fill={isDark ? GOLD : NAVY_2} name="Calls" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Outcome mix + Fell-through reasons (each with own range) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle icon={PieIcon}
            action={<RangePills options={RANGE_OPTIONS} value={rangeMix} onChange={setRangeMix} ariaLabel="Outcome mix range" />}
          >
            Outcome mix — {byRange[rangeMix]?.window?.label ?? ""}
          </SectionTitle>
          <Card>
            <CardContent className="p-4">
              {outcomePieData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No outcomes in this range</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={outcomePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                           label={(e: any) => `${e.name} ${Math.round((e.percent || 0) * 100)}%`}
                           stroke={isDark ? "#1f1d1c" : "#ffffff"}>
                        {outcomePieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: isDark ? "#1f1d1c" : "#ffffff", border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`, color: isDark ? "#e4e4e7" : "#0f172a" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <SectionTitle icon={Flame}
            action={<RangePills options={RANGE_OPTIONS} value={rangeReasons} onChange={setRangeReasons} ariaLabel="Reasons range" />}
          >
            Fell-through reasons — {byRange[rangeReasons]?.window?.label ?? ""}
          </SectionTitle>
          <Card>
            <CardContent className="p-4">
              {(reasonsBlock?.fellThroughReasons ?? []).length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No fell-through reasons recorded</div>
              ) : (
                <ul className="space-y-2.5">
                  {reasonsBlock!.fellThroughReasons.map((r, i) => {
                    const max = reasonsBlock!.fellThroughReasons[0].count;
                    const pct = Math.round((r.count / max) * 100);
                    return (
                      <li key={r.label}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium brand-text">{r.label}</span>
                          <span className="tabular-nums text-muted-foreground">{r.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: RED, opacity: 0.7 }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground mt-4">
                Reasons inferred from EOD note keywords. Refine notes for tighter classification.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Per-CLR drilldown cards (kept month-to-date — goals are weekly-prorated) */}
      <div>
        <SectionTitle icon={Target} action={
          <Button variant="ghost" size="sm" className="px-0 h-auto brand-text underline-offset-4 hover:underline"
                  onClick={() => setShowAllClrs(s => !s)}>
            {showAllClrs ? "Show top 6" : `Show all ${clrCards.length}`} →
          </Button>
        }>
          Per-CLR performance — month to date
        </SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleClrs.map(c => (
            <Card key={c.userId}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold truncate brand-text">{c.name}</div>
                  {c.completionPct != null && (
                    <Badge variant="outline" className="tabular-nums" style={{
                      borderColor: c.completionPct >= 80 ? GREEN : c.completionPct >= 50 ? AMBER : RED,
                      color: c.completionPct >= 80 ? GREEN : c.completionPct >= 50 ? AMBER : RED,
                    }}>
                      {c.completionPct}% list
                    </Badge>
                  )}
                </div>
                <div className="space-y-2.5">
                  <GoalBar value={c.calls} goal={c.goalCalls} pct={c.callsPct} color={isDark ? GOLD_2 : NAVY_2} />
                  <GoalBar value={c.transfers} goal={c.goalTransfers} pct={c.transfersPct} color={GREEN} />
                  <GoalBar value={c.appointments} goal={c.goalAppts} pct={c.apptsPct} color={BLUE} />
                </div>
                <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fell</div>
                    <div className="text-sm font-semibold tabular-nums" style={{ color: RED }}>{c.fellThrough}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Callbacks</div>
                    <div className="text-sm font-semibold tabular-nums" style={{ color: AMBER }}>{c.callbacks}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">C→T %</div>
                    <div className="text-sm font-semibold tabular-nums brand-text">
                      {c.callToTransferRatio == null ? "—" : `${c.callToTransferRatio}%`}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {clrCards.length === 0 && (
            <div className="col-span-full text-center text-muted-foreground py-6 text-sm">No CLRs found</div>
          )}
        </div>
      </div>

      {/* Heatmaps — outcomes + calls, shared range selector */}
      <div>
        <SectionTitle icon={BarChart3}
          action={<RangePills options={RANGE_OPTIONS} value={rangeHeatmap} onChange={setRangeHeatmap} ariaLabel="Heatmap range" />}
        >
          Activity by CLR — {byRange[rangeHeatmap]?.window?.label ?? ""}
        </SectionTitle>
        <div className="grid grid-cols-1 gap-4">
          <HeatmapCard
            title="Outcomes per day"
            tone="navy"
            block={heatmapBlock?.heatmap}
            isDark={isDark}
            valueLabel="outcome"
          />
          <HeatmapCard
            title="Calls per day"
            tone="green"
            block={heatmapBlock?.callsHeatmap}
            isDark={isDark}
            valueLabel="call"
          />
        </div>
      </div>

      {/* Adjustable Leaderboard */}
      <div>
        <SectionTitle icon={Trophy}
          action={
            <div className="flex items-center gap-2">
              <RangePills options={RANGE_OPTIONS} value={rangeLeaderboard} onChange={setRangeLeaderboard} ariaLabel="Leaderboard range" />
              <Link href="/leaderboard"><Button variant="ghost" size="sm" className="px-0 h-auto brand-text underline-offset-4 hover:underline">View all →</Button></Link>
            </div>
          }
        >
          Leaderboard — {byRange[rangeLeaderboard]?.window?.label ?? ""}
        </SectionTitle>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">CLR</th>
                  <th className="text-right px-2 py-2 font-medium">Transfers</th>
                  <th className="text-right px-4 py-2 font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {(leaderboardBlock?.leaderboard ?? []).length === 0 && (
                  <tr><td colSpan={3} className="text-center text-muted-foreground py-6">No activity in this range</td></tr>
                )}
                {(leaderboardBlock?.leaderboard ?? []).slice(0, 10).map((row, idx) => (
                  <tr key={row.userId} className="border-t">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold"
                              style={{
                                backgroundColor: idx === 0 ? GOLD : isDark ? "#3f3d3a" : "#e5e7eb",
                                color: idx === 0 ? NAVY : isDark ? "#e4e4e7" : "#374151",
                              }}>
                          {idx + 1}
                        </span>
                        <span className="font-medium">{row.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="text-right px-2 py-2 tabular-nums font-semibold" style={{ color: GREEN }}>{row.transfers ?? 0}</td>
                    <td className="text-right px-4 py-2 tabular-nums font-medium brand-text-soft">
                      {(row.calls ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* CLR conversion comparison — stacked %s by CLR */}
      <div>
        <SectionTitle
          icon={BarChart3}
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <RangePills options={RANGE_OPTIONS} value={rangeCompare} onChange={setRangeCompare} ariaLabel="Comparison range" />
              <select
                value={compareSort}
                onChange={(e) => setCompareSort(e.target.value as CompareSort)}
                aria-label="Sort comparison by"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium brand-text focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="transferPct">Sort: Transfer %</option>
                <option value="appointmentPct">Sort: Appt %</option>
                <option value="fellThroughPct">Sort: Fell %</option>
                <option value="totalOutcomes">Sort: Total outcomes</option>
                <option value="name">Sort: Name (A–Z)</option>
              </select>
            </div>
          }
        >
          CLR conversion comparison — {compareBlock?.window?.label ?? ""}
        </SectionTitle>
        <Card>
          <CardContent className="p-4">
            {compareRows.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                No outcomes recorded in this range
              </div>
            ) : (
              <>
                <div style={{ height: Math.max(240, compareRows.length * 36 + 60) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={compareChartData}
                      layout="vertical"
                      margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#27272a" : "#e5e7eb"} horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={130}
                        tick={{ fontSize: 11, fill: isDark ? "#e4e4e7" : "#0f172a" }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: isDark ? "#1f1d1c" : "#ffffff",
                          border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`,
                          color: isDark ? "#e4e4e7" : "#0f172a",
                        }}
                        formatter={(value: any, name: any, props: any) => {
                          const r = props?.payload ?? {};
                          if (name === "Transfer %") return [`${value}% (${r.transfers})`, name];
                          if (name === "Appt %") return [`${value}% (${r.appointments})`, name];
                          if (name === "Fell %") return [`${value}% (${r.fellThrough})`, name];
                          if (name === "Other %") return [`${value}%`, name];
                          return [value, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="transferPct" stackId="a" fill={GREEN} name="Transfer %" />
                      <Bar dataKey="appointmentPct" stackId="a" fill={BLUE} name="Appt %" />
                      <Bar dataKey="fellThroughPct" stackId="a" fill={RED} name="Fell %" />
                      <Bar dataKey="otherPct" stackId="a" fill="#94a3b8" name="Other %" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">#</th>
                        <th className="text-left px-3 py-2 font-medium">CLR</th>
                        <th className="text-right px-3 py-2 font-medium">Transfer %</th>
                        <th className="text-right px-3 py-2 font-medium">Appt %</th>
                        <th className="text-right px-3 py-2 font-medium">Fell %</th>
                        <th className="text-right px-3 py-2 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((row, idx) => (
                        <tr key={row.userId} className="border-t hover:bg-muted/40">
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium brand-text">{row.name ?? "—"}</td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            <span className="font-semibold" style={{ color: GREEN }}>{row.transferPct}%</span>
                            <span className="ml-1 text-xs text-muted-foreground">({row.transfers})</span>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            <span className="font-semibold" style={{ color: BLUE }}>{row.appointmentPct}%</span>
                            <span className="ml-1 text-xs text-muted-foreground">({row.appointments})</span>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            <span className="font-semibold" style={{ color: RED }}>{row.fellThroughPct}%</span>
                            <span className="ml-1 text-xs text-muted-foreground">({row.fellThrough})</span>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums font-medium brand-text-soft">{row.totalOutcomes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* EOD reports row (full width on its own) */}
      <div>
        <SectionTitle
          icon={CheckCircle2}
          action={
            <Button variant="outline" size="sm" onClick={() => sendEodReminders.mutate()}
                    disabled={sendEodReminders.isPending || eod.missing === 0}>
              <Send className="w-4 h-4 mr-2" />
              {sendEodReminders.isPending ? "Sending..." : `Remind ${eod.missing}`}
            </Button>
          }
        >
          EOD reports — today
        </SectionTitle>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 mb-3">
              <div className="text-2xl font-bold tabular-nums brand-text">
                {eod.submitted}<span className="text-muted-foreground font-normal">/{eod.total}</span>
              </div>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full transition-all" style={{
                    width: `${eod.total > 0 ? Math.round((eod.submitted / eod.total) * 100) : 0}%`,
                    backgroundColor: eod.missing === 0 ? GREEN : GOLD,
                  }} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {eod.missing === 0 ? "All reports submitted" : `${eod.missing} outstanding`}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1 max-h-72 overflow-y-auto">
              {eod.rows.map(row => (
                <div key={row.userId} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/40">
                  <div className="flex items-center gap-2 min-w-0">
                    {row.submitted ? (
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: GREEN }} />
                    ) : (
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: AMBER }} />
                    )}
                    <span className="text-sm truncate">{row.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {row.submitted && row.submittedAt
                      ? format(new Date(row.submittedAt), "h:mm a")
                      : <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800/60 dark:bg-amber-950/30">Missing</Badge>}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top LOs + Top States (each with own range) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle icon={Award}
            action={
              <div className="flex items-center gap-2">
                <RangePills options={RANGE_OPTIONS} value={rangeTopLos} onChange={setRangeTopLos} ariaLabel="Top LOs range" />
                <Link href="/lo-stats"><Button variant="ghost" size="sm" className="px-0 h-auto brand-text underline-offset-4 hover:underline">LO stats →</Button></Link>
              </div>
            }
          >
            Top LOs by transfers — {byRange[rangeTopLos]?.window?.label ?? ""}
          </SectionTitle>
          <Card>
            <CardContent className="p-4">
              {(topLosBlock?.topLos ?? []).length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-6">No transfers in this range</div>
              ) : (
                <ul className="space-y-2.5">
                  {topLosBlock!.topLos.map((lo, i) => {
                    const max = topLosBlock!.topLos[0].transfers;
                    const pct = Math.round((lo.transfers / max) * 100);
                    return (
                      <li key={lo.id}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium truncate brand-text">
                            <span className="text-muted-foreground mr-1.5 tabular-nums">{i + 1}.</span>
                            {lo.name ?? `LO #${lo.id}`}
                          </span>
                          <span className="tabular-nums font-semibold" style={{ color: GREEN }}>{lo.transfers}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: GREEN }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top states by NPA — render only if there's any data, otherwise hidden */}
        {(statesBlock?.topStates?.length ?? 0) > 0 ? (
          <div>
            <SectionTitle icon={MapPin}
              action={<RangePills options={RANGE_OPTIONS} value={rangeStates} onChange={setRangeStates} ariaLabel="States range" />}
            >
              Top states (by phone area code) — {byRange[rangeStates]?.window?.label ?? ""}
            </SectionTitle>
            <Card>
              <CardContent className="p-4">
                <ul className="space-y-2.5">
                  {statesBlock!.topStates.map(s => {
                    const max = statesBlock!.topStates[0].transfers;
                    const pct = Math.round((s.transfers / max) * 100);
                    return (
                      <li key={s.state}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium brand-text">{s.state}</span>
                          <span className="tabular-nums font-semibold" style={{ color: isDark ? GOLD : GOLD_2 }}>{s.transfers}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: GOLD }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-muted-foreground mt-3">
                  Derived from caller area codes (NPA → state). Excludes non-US numbers.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      {/* Pipeline */}
      <div>
        <SectionTitle icon={ArrowUpRight}
          action={<RangePills options={PIPELINE_OPTIONS} value={pipelineRange} onChange={setPipelineRange} ariaLabel="Pipeline range" />}
        >
          Pipeline — last {pipelineRange}
        </SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: GREEN }}>
                  {pipelineRange === "1d" ? "Today's transfers" : `Transfers (${pipelineRange})`}
                </span>
                <Badge variant="outline" className="tabular-nums">{filteredTransfers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {filteredTransfers.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">No transfers in this range</div>
              ) : (
                <ul className="space-y-2">
                  {filteredTransfers.slice(0, 20).map((t: any) => (
                    <li key={t.id} className="text-sm border-l-2 pl-2" style={{ borderColor: GREEN }}>
                      <div className="font-medium truncate">{t.borrower_name || "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.clr_name ?? "—"} → {t.lo_name ?? "—"}
                        {pipelineRange !== "1d" && t.date && (
                          <span className="ml-2 tabular-nums">· {format(parseISO(t.date), "MMM d")}</span>
                        )}
                        {t.transfer_type && <Badge variant="outline" className="ml-2 text-[10px] py-0 h-4">{t.transfer_type}</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: AMBER }}>Overdue appointments</span>
                <Badge variant="outline" className="tabular-nums">{filteredOverdueAppts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {filteredOverdueAppts.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">All appointments on track</div>
              ) : (
                <ul className="space-y-2">
                  {filteredOverdueAppts.slice(0, 12).map((a: any) => (
                    <li key={a.id} className="text-sm border-l-2 pl-2" style={{ borderColor: AMBER }}>
                      <div className="font-medium truncate">{a.borrower_name || "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.clr_name ?? "—"} · due {a.follow_up_date ? format(parseISO(a.follow_up_date), "MMM d") : "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {filteredOverdueAppts.length > 0 && (
                <div className="text-right mt-2">
                  <Link href="/appointments">
                    <Button variant="ghost" size="sm" className="px-0 h-auto text-xs underline-offset-4 hover:underline">View all →</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: RED }}>Overdue NMLS checks</span>
                <Badge variant="outline" className="tabular-nums">{filteredOverdueNmls.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {filteredOverdueNmls.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">No overdue checks</div>
              ) : (
                <ul className="space-y-2">
                  {filteredOverdueNmls.slice(0, 12).map((c: any) => (
                    <li key={c.id} className="text-sm border-l-2 pl-2" style={{ borderColor: RED }}>
                      <div className="font-medium truncate">{c.lo?.fullName ?? c.lo?.full_name ?? `LO #${c.lo_id}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.assignedTo?.name ?? "—"} · {c.daysOverdue}d overdue
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {filteredOverdueNmls.length > 0 && (
                <div className="text-right mt-2">
                  <Link href="/nmls-checks">
                    <Button variant="ghost" size="sm" className="px-0 h-auto text-xs underline-offset-4 hover:underline">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      View tracker →
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent activity feed */}
      <div>
        <SectionTitle icon={Activity}>Recent team activity</SectionTitle>
        <Card>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              {activityFeed.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-6">No recent activity</div>
              ) : (
                <ul className="divide-y">
                  {activityFeed.map((a: any) => {
                    const type = a.outcome_type as string;
                    const color = OUTCOME_COLORS[type] ?? "#94a3b8";
                    const label = OUTCOME_LABELS[type] ?? type;
                    return (
                      <li key={a.id} className="px-4 py-2.5 hover:bg-muted/40">
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ backgroundColor: color }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap text-sm">
                              <span className="font-medium brand-text">{a.clr_name ?? "—"}</span>
                              <Badge variant="outline" className="text-[10px] py-0 h-4" style={{ borderColor: color, color }}>{label}</Badge>
                              <span className="text-muted-foreground">·</span>
                              <span className="truncate">{a.borrower_name || "Unnamed"}</span>
                              {a.lo_name && <>
                                <span className="text-muted-foreground">→</span>
                                <span className="truncate text-muted-foreground">{a.lo_name}</span>
                              </>}
                            </div>
                            {a.notes && (
                              <div className="text-xs text-muted-foreground mt-0.5 truncate">{a.notes}</div>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                            {a.date ? format(parseISO(a.date), "MMM d") : "—"}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground text-center pt-2">
        Updated {format(new Date(data.generatedAt), "h:mm a")} · auto-refresh every 60s
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Heatmap card — clean, weekday-labeled, dark-mode aware, with concrete legend.

function HeatmapCard({
  title, tone, block, isDark, valueLabel,
}: {
  title: string;
  tone: "navy" | "green";
  block: { dates: string[]; rows: { userId: number; name: string; cells: number[] }[] } | undefined;
  isDark: boolean;
  valueLabel: string;
}) {
  if (!block || block.dates.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm brand-text">{title}</CardTitle></CardHeader>
        <CardContent className="p-4 text-sm text-muted-foreground text-center py-6">No data</CardContent>
      </Card>
    );
  }

  const max = Math.max(1, ...block.rows.flatMap(r => r.cells));
  const ranges = bucketRanges(max);

  // Color stops per tone — five intensity levels (light → dark)
  // Light mode uses the brand color; dark mode swaps to a brighter ramp so cells stay visible.
  const STOPS_LIGHT = tone === "navy"
    ? ["#f1f5f9", "rgba(15,24,45,0.18)", "rgba(15,24,45,0.38)", "rgba(15,24,45,0.62)", "rgba(15,24,45,0.92)"]
    : ["#f1f5f9", "rgba(22,163,74,0.20)", "rgba(22,163,74,0.40)", "rgba(22,163,74,0.65)", "rgba(22,163,74,0.95)"];
  const STOPS_DARK  = tone === "navy"
    ? ["#1f1d1c", "rgba(201,162,74,0.22)", "rgba(201,162,74,0.42)", "rgba(201,162,74,0.66)", "rgba(232,217,168,0.92)"]
    : ["#1f1d1c", "rgba(74,222,128,0.22)", "rgba(74,222,128,0.42)", "rgba(74,222,128,0.66)", "rgba(74,222,128,0.95)"];
  const stops = isDark ? STOPS_DARK : STOPS_LIGHT;

  // Day-of-week label uses the JS day index of each date string (treat as local).
  const dowLabels = block.dates.map(d => {
    const dt = new Date(d + "T00:00:00");
    return WEEKDAY_SHORT[dt.getDay()];
  });
  const domLabels = block.dates.map(d => {
    const dt = new Date(d + "T00:00:00");
    return String(dt.getDate());
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm brand-text">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 overflow-x-auto">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: "2px 2px" }}>
          <thead>
            <tr>
              <th className="text-left pr-3 pb-1 sticky left-0 bg-card z-10 brand-text">CLR</th>
              {dowLabels.map((dow, i) => (
                <th key={"dow-"+i} className="px-0 pb-0 font-medium text-muted-foreground tabular-nums text-center">
                  <div>{dow}</div>
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 bg-card z-10"></th>
              {domLabels.map((dom, i) => (
                <th key={"dom-"+i} className="px-0 pb-1 font-normal text-[10px] text-muted-foreground tabular-nums text-center"
                    title={block.dates[i]}>
                  {dom}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map(row => (
              <tr key={row.userId}>
                <td className="pr-3 py-0.5 truncate max-w-[140px] sticky left-0 bg-card font-medium brand-text">
                  {row.name}
                </td>
                {row.cells.map((v, i) => {
                  const bucket = intensityBucket(v, max);
                  const bg = stops[bucket];
                  // Foreground: only bucket 4 needs inverted text; otherwise readable in either mode.
                  const fg = bucket === 0
                    ? (isDark ? "#52525b" : "#94a3b8")
                    : bucket >= 3
                      ? (isDark && tone === "navy" ? "#0f172a" : "#ffffff")
                      : (isDark ? "#e4e4e7" : "#0f172a");
                  return (
                    <td key={i} className="p-0">
                      <div className="w-7 h-7 rounded flex items-center justify-center text-[11px] font-medium tabular-nums"
                           style={{ backgroundColor: bg, color: fg }}
                           title={`${block.dates[i]} (${WEEKDAY_SHORT[new Date(block.dates[i] + "T00:00:00").getDay()]}): ${v} ${valueLabel}${v === 1 ? "" : "s"}`}>
                        {v || ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {/* Legend with concrete numeric tiers */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-3 flex-wrap">
          <span>Range:</span>
          {stops.map((bg, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: bg, border: i === 0 ? "1px dashed currentColor" : "none" }} />
              <span className="tabular-nums">{ranges[i]}</span>
            </div>
          ))}
          <span className="ml-auto">Max in range: <span className="tabular-nums font-medium brand-text">{max}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}
