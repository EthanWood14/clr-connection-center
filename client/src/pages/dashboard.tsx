import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, TrendingUp, Users, PhoneCall, Calendar, XCircle, RefreshCw, Trophy } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Link } from "wouter";

const COLORS = ["#01696f", "#437a22", "#964219", "#a12c7b", "#006494", "#d19900", "#7a39bb", "#da7101", "#a13544"];

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer", appointment: "Appointment", fell_through: "Fell Through",
  no_answer: "No Answer", callback_requested: "Callback",
  not_interested: "Not Interested", wrong_number: "Wrong Number", other: "Other",
};

function StatCard({ title, value, icon: Icon, sub, color = "primary", href }: any) {
  const inner = (
    <Card className={href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">{title}</p>
            <p className="text-2xl font-bold text-foreground" data-testid={`stat-${title.toLowerCase().replace(/ /g, "-")}`}>{value ?? "—"}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg ${color === "primary" ? "bg-primary/10 text-primary" : color === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400" : color === "warning" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400" : "bg-muted text-muted-foreground"}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: leaderboardData } = useQuery<any>({ queryKey: ["/api/leaderboard"] });
  const { data: losData } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const generateAssignments = useMutation({
    mutationFn: () => apiRequest("POST", "/api/assignments/generate", { date: new Date().toISOString().split("T")[0] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/assignments"] }),
  });

  const todayDate = new Date().toISOString().split("T")[0];
  const { data: todayAssignments = [] } = useQuery<any[]>({
    queryKey: [`/api/assignments?date=${todayDate}`],
  });

  const pieData = stats?.outcomesByType
    ? Object.entries(stats.outcomesByType).map(([key, val]) => ({
        name: OUTCOME_LABELS[key] || key,
        value: val as number,
      }))
    : [];

  const leaderboard = leaderboardData?.leaderboard ?? [];

  const staleThreshold = 7;
  const staleLOs = (losData ?? []).filter((lo: any) => {
    if (!lo.lastWorkedDate || lo.internalStatus !== "active") return false;
    const days = Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86400000);
    return days >= staleThreshold;
  });

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {stats?.startDate && stats?.endDate ? `${stats.startDate} — ${stats.endDate}` : "Current period"}
          </p>
        </div>
        <Button onClick={() => generateAssignments.mutate()} disabled={generateAssignments.isPending} data-testid="button-generate-assignments" className="shrink-0">
          <RefreshCw className={`w-4 h-4 mr-2 ${generateAssignments.isPending ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Generate Today's Assignments</span>
          <span className="sm:hidden">Generate</span>
        </Button>
      </div>

      {/* KPI Row */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard title="Transfers" value={stats?.transfers} icon={ArrowUpRight} color="success" sub="this period" href="/outcomes" />
          <StatCard title="Appointments" value={stats?.appointments} icon={Calendar} color="primary" sub="this period" href="/outcomes" />
          <StatCard title="Total Activities" value={stats?.total} icon={PhoneCall} color="default" sub="all outcomes" href="/outcomes" />
          <StatCard title="Fell Through" value={stats?.fellThrough} icon={XCircle} color="warning" href="/outcomes" />
          <StatCard title="Conversion Rate" value={`${stats?.conversionRate ?? 0}%`} icon={TrendingUp} color="success" sub="transfers / total" href="/outcomes" />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outcome Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Outcome Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Leaderboard Card */}
        <Link href="/leaderboard">
        <Card className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" /> CLR Leaderboard
              </CardTitle>
              <Badge variant="outline" className="text-xs">This Period</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {leaderboard.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No activity logged yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={leaderboard.slice(0, 5)} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip />
                  <Bar dataKey="transfers" fill="#01696f" radius={[0, 4, 4, 0]} name="Transfers" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        </Link>
      </div>

      {/* Today's Assignments + Stale LOs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Link href="/assignments">
        <Card className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Today's Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            {todayAssignments.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                No assignments generated yet. Click "Generate Today's Assignments" above.
              </div>
            ) : (
              <div className="space-y-2">
                {todayAssignments.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground w-5">#{a.globalRank}</span>
                      <span className="text-sm font-medium">{a.lo?.fullName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{a.assistant?.name}</span>
                      <Badge variant={a.status === "worked" ? "default" : a.status === "skipped" ? "destructive" : "secondary"} className="text-xs">
                        {a.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </Link>

        <Link href="/directory">
        <Card className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4" /> LOs Not Worked Recently
              {staleLOs.length > 0 && <Badge variant="destructive" className="text-xs">{staleLOs.length}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {staleLOs.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">All active LOs worked in the last 7 days 🎉</div>
            ) : (
              <div className="space-y-2">
                {staleLOs.slice(0, 6).map((lo: any) => {
                  const days = lo.lastWorkedDate
                    ? Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86400000)
                    : null;
                  return (
                    <div key={lo.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <span className="text-sm font-medium">{lo.fullName}</span>
                      <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                        {days !== null ? `${days}d ago` : "Never worked"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        </Link>
      </div>
    </div>
  );
}
