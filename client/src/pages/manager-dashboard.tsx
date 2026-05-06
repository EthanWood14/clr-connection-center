import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  Users, PhoneCall, Calendar, XCircle, ArrowUpRight, Trophy,
  CheckCircle2, AlertTriangle, ShieldCheck, Send, RefreshCw, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar,
} from "recharts";
import { useAuth } from "@/lib/auth";

// Theme colors
const NAVY = "#0F182D";
const NAVY_2 = "#1A2B4A";
const GOLD = "#C9A24A";
const GREEN = "#16a34a";
const BLUE = "#2563eb";
const RED = "#dc2626";
const AMBER = "#d97706";

type ManagerData = {
  generatedAt: string;
  today: string;
  ranges: { week: any; month: any; last30: any };
  stats: { today: any; week: any; month: any };
  leaderboard: any[];
  eod: {
    date: string;
    total: number;
    submitted: number;
    missing: number;
    rows: { userId: number; name: string; email: string; submitted: boolean; submittedAt: string | null }[];
  };
  pipeline: {
    todayTransfers: any[];
    overdueAppointments: any[];
    overdueNmls: any[];
  };
  trend: { date: string; calls: number; transfers: number; appointments: number; fellThrough: number }[];
};

function KpiTile({
  label, value, sub, icon: Icon, color = NAVY, href,
}: { label: string; value: string | number; sub?: string; icon: any; color?: string; href?: string }) {
  const inner = (
    <Card className="overflow-hidden transition-all hover:shadow-lg hover:border-[#C9A24A]/40">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
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

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data, isLoading, refetch, isFetching } = useQuery<ManagerData>({
    queryKey: ["/api/manager-dashboard"],
    refetchInterval: 60_000,
  });

  const sendEodReminders = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/eod-reminders/run-now", {}),
    onSuccess: () => {
      toast({ title: "EOD reminders sent", description: "Reminder cron triggered." });
    },
    onError: (e: any) => {
      toast({ title: "Failed to send reminders", description: e?.message ?? "Try again", variant: "destructive" });
    },
  });

  const trendData = useMemo(() => {
    return (data?.trend ?? []).map(d => ({
      ...d,
      label: format(parseISO(d.date), "MMM d"),
    }));
  }, [data?.trend]);

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

  const { stats, leaderboard, eod, pipeline } = data;
  const todayCalls = stats.today?.totalCallsToday ?? 0;
  const weekCalls = stats.week?.totalCallsToday ?? 0; // unreliable; we'll prefer trend sum
  const last7Calls = (data.trend ?? []).slice(-7).reduce((s, d) => s + (d.calls || 0), 0);
  const last30Calls = (data.trend ?? []).reduce((s, d) => s + (d.calls || 0), 0);

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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

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

      {/* KPI tiles — This month */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">This month</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Transfers" value={stats.month?.transfers ?? 0} sub={`Conv ${stats.month?.conversionRate ?? 0}%`} icon={ArrowUpRight} color={GREEN} />
          <KpiTile label="Appointments" value={stats.month?.appointments ?? 0} icon={Calendar} color={BLUE} />
          <KpiTile label="Fell through" value={stats.month?.fellThrough ?? 0} icon={XCircle} color={RED} />
          <KpiTile label="Calls (30d)" value={last30Calls.toLocaleString()} sub={`${last7Calls.toLocaleString()} this wk`} icon={TrendingUp} color={NAVY_2} />
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

      {/* Two-column: Leaderboard + EOD status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leaderboard */}
        <div>
          <SectionTitle icon={Trophy} action={<Link href="/leaderboard"><Button variant="link" size="sm" className="px-0 h-auto" style={{ color: NAVY }}>View all →</Button></Link>}>
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

        {/* EOD status grid */}
        <div>
          <SectionTitle
            icon={CheckCircle2}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => sendEodReminders.mutate()}
                disabled={sendEodReminders.isPending || eod.missing === 0}
              >
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
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${eod.total > 0 ? Math.round((eod.submitted / eod.total) * 100) : 0}%`,
                        backgroundColor: eod.missing === 0 ? GREEN : GOLD,
                      }}
                    />
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

      {/* Pipeline section */}
      <div>
        <SectionTitle icon={ArrowUpRight}>Pipeline</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Today's transfers */}
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

          {/* Overdue appointments */}
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

          {/* Overdue NMLS */}
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

      <div className="text-xs text-muted-foreground text-center pt-2">
        Updated {format(new Date(data.generatedAt), "h:mm a")} · auto-refresh every 60s
      </div>
    </div>
  );
}
