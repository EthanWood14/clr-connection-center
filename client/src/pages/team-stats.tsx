import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowUpIcon, ArrowDownIcon, MinusIcon, ArrowUpDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";

const COLORS = {
  calls: "#3B82F6",
  transfers: "#22C55E",
  appointments: "#A855F7",
  fell_through: "#EF4444",
  deferral: "#F59E0B",
  callback: "#0EA5E9",
  no_answer: "#9CA3AF",
};

const BREAKDOWN_SEGMENTS = [
  { key: "transfer",          label: "Transfer",     color: COLORS.transfers },
  { key: "appointment",       label: "Appointment",  color: COLORS.appointments },
  { key: "callback_requested",label: "Callback",     color: COLORS.callback },
  { key: "deferral",          label: "Deferral",     color: COLORS.deferral },
  { key: "fell_through",      label: "Fell Through", color: COLORS.fell_through },
  { key: "no_answer",         label: "No Answer",    color: COLORS.no_answer },
];

type Period = "today" | "week" | "month" | "30days" | "90days" | "alltime" | "period";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "30days", label: "Last 30 Days" },
  { value: "90days", label: "Last 90 Days" },
  { value: "alltime", label: "All Time" },
];

const STATS_PERIOD_LS_KEY = "team-stats-period";

interface StatsResponse {
  period: string;
  startDate: string;
  endDate: string;
  clrId: number | null;
  totals: { calls: number; transfers: number; appointments: number; fellThrough: number; transferRate: number };
  previous: { calls: number; transfers: number; appointments: number; transferRate: number };
  daily: Array<{ date: string; calls: number; transfers: number; appointments: number; fellThrough: number; transferRate: number }>;
  breakdown: Record<string, number>;
  perClr: Array<{ userId: number; name: string; calls: number; transfers: number; appointments: number; fellThrough: number; deferrals: number; transferRate: number }>;
}

function formatDayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function TrendBadge({ current, previous, suffix = "" }: { current: number; previous: number; suffix?: string }) {
  const delta = current - previous;
  if (previous === 0 && current === 0) {
    return <span className="text-xs text-muted-foreground flex items-center gap-1"><MinusIcon className="w-3 h-3" />no data</span>;
  }
  const pct = previous === 0 ? null : ((delta / previous) * 100);
  const isUp = delta > 0;
  const isDown = delta < 0;
  const color = isUp ? "text-green-600 dark:text-green-400" : isDown ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
  const Icon = isUp ? ArrowUpIcon : isDown ? ArrowDownIcon : MinusIcon;
  return (
    <span className={`text-xs flex items-center gap-1 ${color}`}>
      <Icon className="w-3 h-3" />
      {pct == null ? `+${delta}${suffix}` : `${delta >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
      <span className="text-muted-foreground">vs. prev</span>
    </span>
  );
}

function SummaryCard({ title, value, previous, suffix = "" }: { title: string; value: number | string; previous: number; suffix?: string }) {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
        <p className="text-3xl font-bold mt-1.5">{value}{suffix}</p>
        <div className="mt-2">
          <TrendBadge current={num} previous={previous} suffix={suffix} />
        </div>
      </CardContent>
    </Card>
  );
}

type SortKey = "name" | "calls" | "transfers" | "transferRate" | "appointments" | "fellThrough" | "deferrals";

export default function TeamStats() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [period, setPeriodState] = useState<Period>(() => {
    if (typeof window === "undefined") return "week";
    const saved = localStorage.getItem(STATS_PERIOD_LS_KEY) as Period | null;
    if (saved && PERIOD_OPTIONS.some(o => o.value === saved)) return saved;
    return "week";
  });
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    try { localStorage.setItem(STATS_PERIOD_LS_KEY, p); } catch {}
  };
  const [clrFilter, setClrFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("transfers");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    document.title = "Stats · WCLCC";
  }, []);

  // Non-admin CLRs are locked to themselves
  useEffect(() => {
    if (!isAdmin && user?.id) setClrFilter(String(user.id));
  }, [isAdmin, user?.id]);

  const effectiveClr = isAdmin ? clrFilter : (user?.id ? String(user.id) : "all");

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const clrOptions = useMemo(
    () => users.filter(u => (u.role === "assistant" || u.role === "admin") && u.isActive),
    [users],
  );

  const { data, isLoading } = useQuery<StatsResponse>({
    queryKey: [`/api/stats?period=${period}&clr_id=${effectiveClr}`],
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const perClrSorted = useMemo(() => {
    if (!data?.perClr) return [];
    const rows = [...data.perClr];
    rows.sort((a: any, b: any) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [data?.perClr, sortKey, sortDir]);

  const donutData = useMemo(() => {
    if (!data?.breakdown) return [];
    return BREAKDOWN_SEGMENTS
      .map(s => ({ name: s.label, value: data.breakdown[s.key] ?? 0, color: s.color }))
      .filter(s => s.value > 0);
  }, [data?.breakdown]);
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  const dailyDisplay = useMemo(
    () => (data?.daily ?? []).map(d => ({ ...d, label: formatDayLabel(d.date) })),
    [data?.daily],
  );

  if (isLoading || !data) {
    return (
      <div className="container mx-auto p-4 lg:p-6 space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const showClrComparison = isAdmin && effectiveClr === "all";

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6" data-testid="page-team-stats">
      {/* Header + filters */}
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-bold">Team Stats</h1>
          <p className="text-sm text-muted-foreground">
            {data.startDate} → {data.endDate}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-48" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isAdmin && (
            <Select value={clrFilter} onValueChange={setClrFilter}>
              <SelectTrigger className="w-56" data-testid="select-clr-filter">
                <SelectValue placeholder="Select CLR" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All CLRs</SelectItem>
                {clrOptions.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {effectiveClr !== "all" && (
            <Badge variant="secondary" className="text-xs">
              Viewing: {clrOptions.find(u => String(u.id) === effectiveClr)?.name ?? "You"}
            </Badge>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard title="Total Calls" value={data.totals.calls} previous={data.previous.calls} />
        <SummaryCard title="Total Transfers" value={data.totals.transfers} previous={data.previous.transfers} />
        <SummaryCard title="Transfer Rate" value={data.totals.transferRate.toFixed(1)} previous={data.previous.transferRate} suffix="%" />
        <SummaryCard title="Total Appointments" value={data.totals.appointments} previous={data.previous.appointments} />
      </div>

      {/* Chart 1: Daily Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyDisplay.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No activity for this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dailyDisplay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="calls" orientation="left" tick={{ fontSize: 11 }} allowDecimals={false} stroke={COLORS.calls} label={{ value: "Calls", angle: -90, position: "insideLeft", fontSize: 10, fill: COLORS.calls }} />
                <YAxis yAxisId="small" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} stroke={COLORS.transfers} label={{ value: "Transfers / Appts", angle: 90, position: "insideRight", fontSize: 10, fill: COLORS.transfers }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="calls" dataKey="calls" name="Calls" fill={COLORS.calls} radius={[2,2,0,0]} />
                <Bar yAxisId="small" dataKey="transfers" name="Transfers" fill={COLORS.transfers} radius={[2,2,0,0]} />
                <Bar yAxisId="small" dataKey="appointments" name="Appointments" fill={COLORS.appointments} radius={[2,2,0,0]} />
                <Bar yAxisId="small" dataKey="fellThrough" name="Fell Through" fill={COLORS.fell_through} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Row: Donut + Transfer Rate Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outcome Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {donutTotal === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No outcomes recorded.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={95}
                      paddingAngle={2}
                      label={({ percent }) => percent && percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""}
                      labelLine={false}
                    >
                      {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(value: any) => [`${value} (${((value / donutTotal) * 100).toFixed(1)}%)`, ""]}
                      contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 justify-center mt-2">
                  {donutData.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs">
                      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                      <span>{d.name}</span>
                      <span className="text-muted-foreground">({d.value})</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transfer Rate Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {dailyDisplay.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No activity for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={dailyDisplay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    formatter={(v: any) => [`${v}%`, "Transfer rate"]}
                    contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="transferRate" stroke={COLORS.transfers} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Chart 3: CLR Comparison (admin + All CLRs only) */}
      {showClrComparison && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">CLR Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            {data.perClr.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center">No CLR data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(300, data.perClr.length * 50)}>
                <BarChart data={data.perClr} layout="vertical" margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis xAxisId="calls" type="number" orientation="top" tick={{ fontSize: 10 }} allowDecimals={false} stroke={COLORS.calls} />
                  <XAxis xAxisId="small" type="number" orientation="bottom" tick={{ fontSize: 10 }} allowDecimals={false} stroke={COLORS.transfers} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar xAxisId="calls" dataKey="calls" name="Calls" fill={COLORS.calls} />
                  <Bar xAxisId="small" dataKey="transfers" name="Transfers" fill={COLORS.transfers} />
                  <Bar xAxisId="small" dataKey="appointments" name="Appointments" fill={COLORS.appointments} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Detail table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-CLR Detail</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr className="text-left">
                  {([
                    ["name","CLR Name"],
                    ["calls","Calls"],
                    ["transfers","Transfers"],
                    ["transferRate","Transfer Rate"],
                    ["appointments","Appointments"],
                    ["fellThrough","Fell Through"],
                    ["deferrals","Deferrals"],
                  ] as [SortKey, string][]).map(([k, label]) => (
                    <th
                      key={k}
                      className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none"
                      onClick={() => handleSort(k)}
                      data-testid={`th-${k}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? "text-foreground" : "opacity-40"}`} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perClrSorted.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No CLR data.</td>
                  </tr>
                ) : perClrSorted.map((row: any) => (
                  <tr
                    key={row.userId}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => isAdmin && setClrFilter(String(row.userId))}
                    data-testid={`row-clr-${row.userId}`}
                  >
                    <td className="px-4 py-2.5 font-medium">{row.name}</td>
                    <td className="px-4 py-2.5">{row.calls}</td>
                    <td className="px-4 py-2.5 font-semibold text-green-600 dark:text-green-400">{row.transfers}</td>
                    <td className="px-4 py-2.5">{row.transferRate.toFixed(1)}%</td>
                    <td className="px-4 py-2.5">{row.appointments}</td>
                    <td className="px-4 py-2.5 text-red-600 dark:text-red-400">{row.fellThrough}</td>
                    <td className="px-4 py-2.5 text-amber-600 dark:text-amber-400">{row.deferrals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
