import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import {
  TrendingUp, PhoneCall, Calendar, XCircle, Target, Flame, Trophy,
  Users, ArrowRight, Clock, AlertTriangle,
} from "lucide-react";
import { format, parseISO } from "date-fns";

type Period = "today" | "week" | "month" | "30days" | "90days" | "alltime" | "period";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "30days", label: "Last 30 Days" },
  { value: "90days", label: "Last 90 Days" },
  { value: "alltime", label: "All Time" },
];

const MY_REPORT_PERIOD_LS_KEY = "my-report-period";

interface PersonalReport {
  user: { id: number; name: string; email: string };
  period: string;
  startDate: string;
  endDate: string;
  daysInPeriod: number;
  goals: { calls: number; transfers: number; appointments: number };
  totals: {
    calls: number; transfers: number; appointments: number;
    fellThrough: number; deferrals: number; transferRate: number;
    avgCallsPerDay: number;
  };
  daily: Array<{ date: string; calls: number; transfers: number; appointments: number; fellThrough: number }>;
  transferByType: { direct: number; appointment: number; unspecified: number };
  transferByTimeframe: Record<string, number>;
  appointments: { upcoming: number; overdue: number; completedThisPeriod: number };
  loCoverage: Array<{ loId: number; name: string; outcomes: number }>;
  bestDay: { date: string; transfers: number } | null;
  streak: number;
  weekToDate: { startDate: string; endDate: string; calls: number; transfers: number; appointments: number };
}

const COLORS = {
  calls: "#3B82F6",
  transfers: "#22C55E",
  appointments: "#A855F7",
  fell: "#EF4444",
  direct: "#1E3A8A",       // navy/blue — Direct
  appt: "#14B8A6",         // teal — Appointment/Callback
  other: "#94A3B8",
};

function formatDayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function StatCard({ icon: Icon, label, value, color, sub }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`w-4 h-4 ${color}`} />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        </div>
        <p className={`text-3xl font-bold ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function GoalProgressRow({ label, current, goal, color }: { label: string; current: number; goal: number; color: string }) {
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;
  const met = goal > 0 && current >= goal;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className={met ? "text-green-600 font-semibold" : "text-muted-foreground"}>
          {current} / {goal} goal {goal > 0 ? `(${pct}%)` : ""}
          {met && " ✓"}
        </span>
      </div>
      <Progress value={pct} className={`h-2 ${color}`} />
    </div>
  );
}

function formatTf(tf: string) {
  if (tf === "unspecified") return "Unspecified";
  return tf.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MyReport() {
  const { user } = useAuth();
  const [period, setPeriodState] = useState<Period>(() => {
    if (typeof window === "undefined") return "week";
    const saved = localStorage.getItem(MY_REPORT_PERIOD_LS_KEY) as Period | null;
    if (saved && PERIOD_OPTIONS.some(o => o.value === saved)) return saved;
    return "week";
  });
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    try { localStorage.setItem(MY_REPORT_PERIOD_LS_KEY, p); } catch {}
  };

  const { data, isLoading } = useQuery<PersonalReport>({
    queryKey: ["/api/my-report", period],
    queryFn: () => fetch(`/api/my-report?period=${period}`, { credentials: "include" }).then(r => r.json()),
  });

  const trendData = useMemo(() => {
    return (data?.daily ?? []).map(d => ({
      date: formatDayLabel(d.date),
      Calls: d.calls,
      Transfers: d.transfers,
      Appointments: d.appointments,
    }));
  }, [data?.daily]);

  // Transfer Types: only include Direct + Appointment/Callback; drop unspecified/null entirely.
  const transferTypeData = useMemo(() => {
    if (!data) return [];
    const t = data.transferByType;
    return [
      { name: "Direct", value: t.direct, color: COLORS.direct },
      { name: "Appointment/Callback", value: t.appointment, color: COLORS.appt },
    ].filter(x => x.value > 0);
  }, [data]);

  // Total transfers (used to detect "all unspecified" case — chart hidden then).
  const totalTransfers = data?.totals.transfers ?? 0;
  const hasAnyTransferType = (data?.transferByType.direct ?? 0) + (data?.transferByType.appointment ?? 0) > 0;

  // Timeframe Breakdown: drop null/empty/"unspecified" entries; only show real timeframe values.
  const timeframeData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.transferByTimeframe)
      .filter(([tf, count]) => {
        if (!tf) return false;
        const key = String(tf).trim().toLowerCase();
        if (!key || key === "unspecified" || key === "null" || key === "undefined") return false;
        return (count as number) > 0;
      })
      .map(([tf, count]) => ({ name: formatTf(tf), value: count as number }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const hasGoals = (data?.goals.calls ?? 0) > 0 || (data?.goals.transfers ?? 0) > 0 || (data?.goals.appointments ?? 0) > 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Your Performance Report
            {user && <span className="text-muted-foreground font-normal">— {user.name}</span>}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data && (
              <>
                {format(parseISO(data.startDate), "MMM d")} – {format(parseISO(data.endDate), "MMM d, yyyy")}
              </>
            )}
          </p>
        </div>

        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : !data ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No data.</CardContent></Card>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={PhoneCall} label="Calls" value={data.totals.calls} color="text-blue-600 dark:text-blue-400" />
            <StatCard
              icon={TrendingUp}
              label="Transfers"
              value={data.totals.transfers}
              color="text-green-600 dark:text-green-400"
              sub={data.totals.transferRate > 0 ? `${data.totals.transferRate}% transfer rate` : undefined}
            />
            <StatCard icon={Calendar} label="Appts Set" value={data.totals.appointments} color="text-purple-600 dark:text-purple-400" />
            <StatCard icon={Clock} label="Deferrals" value={data.totals.deferrals} color="text-amber-600 dark:text-amber-400" />
            <StatCard icon={XCircle} label="Fell Through" value={data.totals.fellThrough} color="text-red-600 dark:text-red-400" />
            {period !== "today" && (
              <StatCard
                icon={PhoneCall}
                label="Avg Calls/Day"
                value={data.totals.avgCallsPerDay}
                color="text-sky-600 dark:text-sky-400"
              />
            )}
          </div>

          {/* Weekly goal progress */}
          {hasGoals && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" /> Weekly Goal Progress
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    — {format(parseISO(data.weekToDate.startDate), "MMM d")} – {format(parseISO(data.weekToDate.endDate), "MMM d")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.goals.calls > 0 && (
                  <GoalProgressRow label="Calls" current={data.weekToDate.calls} goal={data.goals.calls} color="" />
                )}
                {data.goals.transfers > 0 && (
                  <GoalProgressRow label="Transfers" current={data.weekToDate.transfers} goal={data.goals.transfers} color="" />
                )}
                {data.goals.appointments > 0 && (
                  <GoalProgressRow label="Appointments" current={data.weekToDate.appointments} goal={data.goals.appointments} color="" />
                )}
              </CardContent>
            </Card>
          )}

          {!hasGoals && (
            <Card className="border-dashed">
              <CardContent className="py-5 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Target className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Set your weekly goals</p>
                    <p className="text-xs text-muted-foreground">Track progress toward personal targets on this page and your dashboard.</p>
                  </div>
                </div>
                <Link href="/settings" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                  Go to Settings <ArrowRight className="w-3 h-3" />
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Trend chart */}
          {period !== "today" && trendData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Your Activity Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis yAxisId="calls" orientation="left" fontSize={11} allowDecimals={false} stroke={COLORS.calls} label={{ value: "Calls", angle: -90, position: "insideLeft", fontSize: 10, fill: COLORS.calls }} />
                    <YAxis yAxisId="small" orientation="right" fontSize={11} allowDecimals={false} stroke={COLORS.transfers} label={{ value: "Transfers / Appts", angle: 90, position: "insideRight", fontSize: 10, fill: COLORS.transfers }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="calls" type="monotone" dataKey="Calls" stroke={COLORS.calls} strokeWidth={2} dot={{ r: 3 }} />
                    <Line yAxisId="small" type="monotone" dataKey="Transfers" stroke={COLORS.transfers} strokeWidth={2} dot={{ r: 3 }} />
                    <Line yAxisId="small" type="monotone" dataKey="Appointments" stroke={COLORS.appointments} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Transfer breakdown */}
          {(totalTransfers > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Transfer Types</CardTitle>
                </CardHeader>
                <CardContent>
                  {!hasAnyTransferType ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No transfer type data yet. Select Direct or Appointment/Callback when logging transfers.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={transferTypeData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          label={(e: any) => `${e.name}: ${e.value}`}
                        >
                          {transferTypeData.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">Timeframe Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {timeframeData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No timeframe data yet. Add lead timeframes when logging transfers.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(180, timeframeData.length * 36 + 40)}>
                      <BarChart data={timeframeData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                        <XAxis type="number" fontSize={11} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" fontSize={11} width={130} interval={0} />
                        <Tooltip />
                        <Bar dataKey="value" fill={COLORS.transfers} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Appointments summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Appointments Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <Link href="/appointments" className="block">
                  <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10 p-4 text-center hover:border-purple-400 transition-colors">
                    <Calendar className="w-4 h-4 text-purple-600 mx-auto mb-1" />
                    <div className="text-2xl font-bold text-purple-700 dark:text-purple-300">{data.appointments.upcoming}</div>
                    <div className="text-xs text-muted-foreground">Upcoming</div>
                  </div>
                </Link>
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-4 text-center">
                  <AlertTriangle className="w-4 h-4 text-red-600 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-red-700 dark:text-red-300">{data.appointments.overdue}</div>
                  <div className="text-xs text-muted-foreground">Overdue</div>
                </div>
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10 p-4 text-center">
                  <Trophy className="w-4 h-4 text-green-600 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-green-700 dark:text-green-300">{data.appointments.completedThisPeriod}</div>
                  <div className="text-xs text-muted-foreground">Completed (this period)</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LO Coverage */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="w-4 h-4" /> LOs You Worked This Period
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.loCoverage.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No LO activity in this period yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.loCoverage.slice(0, 12).map(lo => (
                    <div key={lo.loId} className="flex items-center justify-between py-1.5 border-b last:border-0">
                      <span className="text-sm">{lo.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {lo.outcomes} {lo.outcomes === 1 ? "outcome" : "outcomes"}
                      </Badge>
                    </div>
                  ))}
                  {data.loCoverage.length > 12 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      + {data.loCoverage.length - 12} more
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Personal best + streak */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500" /> Best Day This Period
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.bestDay ? (
                  <p className="text-sm">
                    <span className="text-2xl font-bold text-amber-500">{data.bestDay.transfers}</span>{" "}
                    <span className="text-muted-foreground">transfers on </span>
                    <span className="font-semibold">{format(parseISO(data.bestDay.date), "EEEE, MMM d")}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No transfer days in this period yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-500" /> Current Streak
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.streak > 0 ? (
                  <p className="text-sm">
                    <span className="text-2xl font-bold text-orange-500">{data.streak}</span>{" "}
                    <span className="text-muted-foreground">
                      {data.streak === 1 ? "day" : "days"} with at least 1 transfer
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No active streak — log a transfer today to start one.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
