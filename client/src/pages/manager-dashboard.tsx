import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
// Note: queryClient import removed — not directly used in this file.
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

type Alert = { level: "warn" | "danger" | "info"; text: string; href?: string };
type ManagerData = {
  generatedAt: string;
  today: string;
  ranges: { week: any; month: any; last30: any };
  stats: { today: any; week: any; month: any; priorWeek: any; priorMonth: any };
  leaderboard: any[];
  clrCards: any[];
  eod: {
    date: string;
    total: number;
    submitted: number;
    missing: number;
    rows: { userId: number; name: string; email: string; submitted: boolean; submittedAt: string | null }[];
  };
  pipeline: { todayTransfers: any[]; overdueAppointments: any[]; overdueNmls: any[] };
  trend: { date: string; calls: number; transfers: number; appointments: number; fellThrough: number }[];
  outcomeBreakdown: { outcome_type: string; count: number }[];
  topStates: { state: string; transfers: number }[];
  topLos: { id: number; name: string; transfers: number }[];
  activityFeed: any[];
  fellThroughReasons: { label: string; count: number }[];
  heatmap: { dates: string[]; rows: { userId: number; name: string; cells: number[] }[] };
  alerts: Alert[];
};

function deltaInfo(current: number, prior: number) {
  if (!prior && !current) return { dir: "flat" as const, pct: 0, label: "—" };
  if (!prior) return { dir: "up" as const, pct: 100, label: "new" };
  const pct = Math.round(((current - prior) / prior) * 100);
  return { dir: pct > 0 ? "up" as const : pct < 0 ? "down" as const : "flat" as const, pct: Math.abs(pct), label: `${pct > 0 ? "+" : ""}${pct}%` };
}

function DeltaArrow({ dir, pct, label, invert = false }: { dir: "up" | "down" | "flat"; pct: number; label: string; invert?: boolean }) {
  // For metrics where down is bad (transfers/appts), up=green. For metrics where down is good (fell-through), invert.
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
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: NAVY }}>
        <Icon className="w-5 h-5" style={{ color: GOLD }} />
        {children}
      </h2>
      {action}
    </div>
  );
}

function AlertsBanner({ alerts }: { alerts: Alert[] }) {
  if (!alerts?.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const palette =
          a.level === "danger" ? { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", Icon: AlertOctagon } :
          a.level === "warn"   ? { bg: "#fffbeb", border: "#fde68a", color: "#92400e", Icon: AlertTriangle } :
                                 { bg: "#eff6ff", border: "#bfdbfe", color: "#1e40af", Icon: Info };
        const Icon = palette.Icon;
        const inner = (
          <div className="flex items-start gap-3 px-4 py-2.5 rounded-lg border text-sm"
               style={{ backgroundColor: palette.bg, borderColor: palette.border, color: palette.color }}>
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

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showAllClrs, setShowAllClrs] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<ManagerData>({
    queryKey: ["/api/manager-dashboard"],
    refetchInterval: 60_000,
  });

  const sendEodReminders = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/eod-reminders/run-now", {}),
    onSuccess: () => toast({ title: "EOD reminders sent", description: "Reminder cron triggered." }),
    onError: (e: any) => toast({ title: "Failed to send reminders", description: e?.message ?? "Try again", variant: "destructive" }),
  });

  const trendData = useMemo(() => {
    return (data?.trend ?? []).map(d => ({ ...d, label: format(parseISO(d.date), "MMM d") }));
  }, [data?.trend]);

  const outcomePieData = useMemo(() => {
    return (data?.outcomeBreakdown ?? []).map(o => ({
      name: OUTCOME_LABELS[o.outcome_type] ?? o.outcome_type,
      value: Number(o.count) || 0,
      color: OUTCOME_COLORS[o.outcome_type] ?? "#94a3b8",
    }));
  }, [data?.outcomeBreakdown]);

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

  const { stats, leaderboard, clrCards, eod, pipeline, topStates, topLos, activityFeed, fellThroughReasons, heatmap, alerts } = data;
  const todayCalls = stats.today?.totalCallsToday ?? 0;
  const last7Calls = (data.trend ?? []).slice(-7).reduce((s, d) => s + (d.calls || 0), 0);
  const last30Calls = (data.trend ?? []).reduce((s, d) => s + (d.calls || 0), 0);
  const priorLast7Calls = (data.trend ?? []).slice(-14, -7).reduce((s, d) => s + (d.calls || 0), 0);

  // WoW deltas
  const transferDeltaWk = deltaInfo(stats.week?.transfers ?? 0, stats.priorWeek?.transfers ?? 0);
  const apptDeltaWk = deltaInfo(stats.week?.appointments ?? 0, stats.priorWeek?.appointments ?? 0);
  const fellDeltaWk = deltaInfo(stats.week?.fellThrough ?? 0, stats.priorWeek?.fellThrough ?? 0);
  const callsDeltaWk = deltaInfo(last7Calls, priorLast7Calls);
  const transferDeltaMo = deltaInfo(stats.month?.transfers ?? 0, stats.priorMonth?.transfers ?? 0);
  const apptDeltaMo = deltaInfo(stats.month?.appointments ?? 0, stats.priorMonth?.appointments ?? 0);
  const fellDeltaMo = deltaInfo(stats.month?.fellThrough ?? 0, stats.priorMonth?.fellThrough ?? 0);

  const visibleClrs = showAllClrs ? clrCards : clrCards.slice(0, 6);
  const heatmapMax = Math.max(1, ...heatmap.rows.flatMap(r => r.cells));

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
            <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider" style={{ backgroundColor: NAVY, color: GOLD }}>
              Manager view
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mt-1" style={{ color: NAVY }}>
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
          <KpiTile label="Calls" value={todayCalls.toLocaleString()} icon={PhoneCall} color={NAVY} />
          <KpiTile label="Transfers" value={stats.today?.transfers ?? 0} icon={ArrowUpRight} color={GREEN} />
          <KpiTile label="Appointments" value={stats.today?.appointments ?? 0} icon={Calendar} color={BLUE} />
          <KpiTile label="Fell through" value={stats.today?.fellThrough ?? 0} icon={XCircle} color={RED} />
        </div>
      </div>

      {/* KPI tiles — This week with WoW deltas */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">This week</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Calls (7d)" value={last7Calls.toLocaleString()} icon={PhoneCall} color={NAVY}
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
                   icon={TrendingUp} color={NAVY_2} />
        </div>
      </div>

      {/* 30-day trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2" style={{ color: NAVY }}>
            <TrendingUp className="w-4 h-4" style={{ color: GOLD }} />
            30-day team trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={Math.max(0, Math.floor(trendData.length / 8))} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={Math.max(0, Math.floor(trendData.length / 8))} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="calls" fill={NAVY_2} name="Calls" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Outcome breakdown + Fell-through reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle icon={PieIcon}>Outcome mix — last 30 days</SectionTitle>
          <Card>
            <CardContent className="p-4">
              {outcomePieData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No outcomes recorded</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={outcomePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.name} ${Math.round((e.percent || 0) * 100)}%`}>
                        {outcomePieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <SectionTitle icon={Flame}>Fell-through reasons — last 30d</SectionTitle>
          <Card>
            <CardContent className="p-4">
              {fellThroughReasons.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No fell-through outcomes</div>
              ) : (
                <ul className="space-y-2.5">
                  {fellThroughReasons.map(r => {
                    const max = fellThroughReasons[0].count;
                    const pct = Math.round((r.count / max) * 100);
                    return (
                      <li key={r.label}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium" style={{ color: NAVY }}>{r.label}</span>
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
              <p className="text-[11px] text-muted-foreground mt-4">Reasons inferred from EOD note keywords. Refine notes for tighter classification.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Per-CLR drilldown cards */}
      <div>
        <SectionTitle icon={Target} action={
          <Button variant="link" size="sm" className="px-0 h-auto" style={{ color: NAVY }}
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
                  <div className="font-semibold truncate" style={{ color: NAVY }}>{c.name}</div>
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
                  <GoalBar value={c.calls} goal={c.goalCalls} pct={c.callsPct} color={NAVY_2} />
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
                    <div className="text-sm font-semibold tabular-nums" style={{ color: NAVY }}>
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

      {/* CLR activity heatmap (14 days) */}
      <div>
        <SectionTitle icon={BarChart3}>14-day activity heatmap</SectionTitle>
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left pr-3 pb-2 sticky left-0 bg-card z-10" style={{ color: NAVY }}>CLR</th>
                  {heatmap.dates.map(d => (
                    <th key={d} className="px-1 pb-2 font-normal text-muted-foreground tabular-nums" title={d}>
                      {format(parseISO(d), "M/d")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.rows.map(row => (
                  <tr key={row.userId}>
                    <td className="pr-3 py-1 truncate max-w-[140px] sticky left-0 bg-card font-medium" style={{ color: NAVY }}>{row.name}</td>
                    {row.cells.map((v, i) => {
                      const intensity = v / heatmapMax;
                      const bg = v === 0 ? "#f1f5f9" : `rgba(15, 24, 45, ${0.15 + intensity * 0.85})`;
                      const fg = intensity > 0.5 ? "#fff" : NAVY;
                      return (
                        <td key={i} className="px-0.5 py-1">
                          <div className="w-7 h-7 rounded flex items-center justify-center text-[11px] font-medium tabular-nums"
                               style={{ backgroundColor: bg, color: v === 0 ? "#94a3b8" : fg }}
                               title={`${heatmap.dates[i]}: ${v} outcome${v === 1 ? "" : "s"}`}>
                            {v || ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-3">
              <span>Less</span>
              {[0.15, 0.3, 0.5, 0.7, 0.95].map((o, i) => (
                <div key={i} className="w-4 h-4 rounded" style={{ backgroundColor: `rgba(15, 24, 45, ${o})` }} />
              ))}
              <span>More</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column: Leaderboard + EOD status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle icon={Trophy} action={
            <Link href="/leaderboard"><Button variant="link" size="sm" className="px-0 h-auto" style={{ color: NAVY }}>View all →</Button></Link>
          }>
            Leaderboard — this month
          </SectionTitle>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">CLR</th>
                    <th className="text-right px-2 py-2 font-medium">Transfers</th>
                    <th className="text-right px-2 py-2 font-medium">Appts</th>
                    <th className="text-right px-4 py-2 font-medium">List %</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 && (
                    <tr><td colSpan={4} className="text-center text-muted-foreground py-6">No activity yet this month</td></tr>
                  )}
                  {leaderboard.slice(0, 10).map((row: any, idx: number) => (
                    <tr key={row.userId || row.user_id || idx} className="border-t">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold" style={{ backgroundColor: idx === 0 ? GOLD : "#e5e7eb", color: idx === 0 ? NAVY : "#374151" }}>
                            {idx + 1}
                          </span>
                          <span className="font-medium">{row.name ?? row.user_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="text-right px-2 py-2 tabular-nums font-semibold" style={{ color: GREEN }}>{row.transfers ?? 0}</td>
                      <td className="text-right px-2 py-2 tabular-nums" style={{ color: BLUE }}>{row.appointments ?? 0}</td>
                      <td className="text-right px-4 py-2 tabular-nums text-muted-foreground">
                        {row.completionPct == null ? "—" : `${row.completionPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

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
                <div className="text-2xl font-bold tabular-nums" style={{ color: NAVY }}>
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
              <div className="space-y-1 max-h-72 overflow-y-auto">
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
                        : <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">Missing</Badge>}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Top LOs + Top States */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle icon={Award} action={
            <Link href="/lo-stats"><Button variant="link" size="sm" className="px-0 h-auto" style={{ color: NAVY }}>LO stats →</Button></Link>
          }>
            Top LOs by transfers — last 30d
          </SectionTitle>
          <Card>
            <CardContent className="p-4">
              {topLos.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-6">No transfers in the last 30 days</div>
              ) : (
                <ul className="space-y-2.5">
                  {topLos.map((lo, i) => {
                    const max = topLos[0].transfers;
                    const pct = Math.round((lo.transfers / max) * 100);
                    return (
                      <li key={lo.id}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium truncate" style={{ color: NAVY }}>
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

        <div>
          <SectionTitle icon={MapPin}>Top states — last 30d transfers</SectionTitle>
          <Card>
            <CardContent className="p-4">
              {topStates.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-6">No state data available</div>
              ) : (
                <ul className="space-y-2.5">
                  {topStates.map((s, i) => {
                    const max = topStates[0].transfers;
                    const pct = Math.round((s.transfers / max) * 100);
                    return (
                      <li key={s.state || i}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium" style={{ color: NAVY }}>{s.state || "—"}</span>
                          <span className="tabular-nums font-semibold" style={{ color: GOLD_2 }}>{s.transfers}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: GOLD }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Pipeline section */}
      <div>
        <SectionTitle icon={ArrowUpRight}>Pipeline</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: GREEN }}>Today's transfers</span>
                <Badge variant="outline" className="tabular-nums">{pipeline.todayTransfers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {pipeline.todayTransfers.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">No transfers yet today</div>
              ) : (
                <ul className="space-y-2">
                  {pipeline.todayTransfers.slice(0, 12).map((t: any) => (
                    <li key={t.id} className="text-sm border-l-2 pl-2" style={{ borderColor: GREEN }}>
                      <div className="font-medium truncate">{t.borrower_name || "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.clr_name ?? "—"} → {t.lo_name ?? "—"}
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
                <Badge variant="outline" className="tabular-nums">{pipeline.overdueAppointments.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {pipeline.overdueAppointments.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">All appointments on track</div>
              ) : (
                <ul className="space-y-2">
                  {pipeline.overdueAppointments.slice(0, 12).map((a: any) => (
                    <li key={a.id} className="text-sm border-l-2 pl-2" style={{ borderColor: AMBER }}>
                      <div className="font-medium truncate">{a.borrower_name || "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.clr_name ?? "—"} · due {a.follow_up_date ? format(parseISO(a.follow_up_date), "MMM d") : "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {pipeline.overdueAppointments.length > 0 && (
                <div className="text-right mt-2">
                  <Link href="/appointments">
                    <Button variant="link" size="sm" className="px-0 h-auto text-xs">View all →</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: RED }}>Overdue NMLS checks</span>
                <Badge variant="outline" className="tabular-nums">{pipeline.overdueNmls.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {pipeline.overdueNmls.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">No overdue checks</div>
              ) : (
                <ul className="space-y-2">
                  {pipeline.overdueNmls.slice(0, 12).map((c: any) => (
                    <li key={c.id} className="text-sm border-l-2 pl-2" style={{ borderColor: RED }}>
                      <div className="font-medium truncate">{c.lo?.fullName ?? c.lo?.full_name ?? `LO #${c.lo_id}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.assignedTo?.name ?? "—"} · {c.daysOverdue}d overdue
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {pipeline.overdueNmls.length > 0 && (
                <div className="text-right mt-2">
                  <Link href="/nmls-checks">
                    <Button variant="link" size="sm" className="px-0 h-auto text-xs">
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
                              <span className="font-medium" style={{ color: NAVY }}>{a.clr_name ?? "—"}</span>
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
