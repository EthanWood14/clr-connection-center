import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Trophy, Medal, TrendingUp, BarChart2, Users, ArrowUpRight,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend, AreaChart, Area,
} from "recharts";

// ── Colours ───────────────────────────────────────────────────────────────────
const MEDAL_CONFIG = [
  { rank: 1, icon: Trophy,  color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-900/20", border: "border-yellow-200 dark:border-yellow-700" },
  { rank: 2, icon: Medal,   color: "text-slate-400",  bg: "bg-slate-50 dark:bg-slate-800/40",   border: "border-slate-200 dark:border-slate-600" },
  { rank: 3, icon: Medal,   color: "text-amber-600",  bg: "bg-amber-50 dark:bg-amber-900/20",   border: "border-amber-200 dark:border-amber-700" },
];
const CLR_COLORS = ["#01696f","#437a22","#006494","#7a39bb","#a13544","#da7101","#d4a017","#9ca3af","#e11d48","#0284c7"];

// ── Medal podium card ─────────────────────────────────────────────────────────
function MedalCard({ entry, rank }: { entry: any; rank: number }) {
  const medal = MEDAL_CONFIG.find(m => m.rank === rank);
  const Icon = medal ? medal.icon : TrendingUp;
  const initials = entry.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const conv = entry.total > 0 ? Math.round((entry.transfers / entry.total) * 100) : 0;
  return (
    <Card className={`relative overflow-hidden border-2 ${medal?.border ?? "border-border"} ${medal?.bg ?? ""}`}>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
              {initials}
            </div>
            <div>
              <p className="font-semibold text-sm">{entry.name}</p>
              <p className="text-xs text-muted-foreground">Rank #{rank}</p>
            </div>
          </div>
          <Icon className={`w-6 h-6 ${medal?.color ?? "text-muted-foreground"}`} />
        </div>
        <div className="grid grid-cols-4 gap-2 mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{entry.transfers}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Transfers</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{entry.total}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{conv}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">Conv.</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${entry.completionPct != null ? (entry.completionPct >= 80 ? 'text-emerald-600 dark:text-emerald-400' : entry.completionPct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400') : 'text-muted-foreground'}`}>
              {entry.completionPct != null ? `${entry.completionPct}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">LO Comp.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Table row ─────────────────────────────────────────────────────────────────
function LeaderboardRow({ entry, rank }: { entry: any; rank: number }) {
  const initials = entry.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const conv = entry.total > 0 ? Math.round((entry.transfers / entry.total) * 100) : 0;
  const medal = MEDAL_CONFIG.find(m => m.rank === rank);
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-muted/30 transition-colors">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
        ${rank <= 3 ? `${medal?.bg} ${medal?.color}` : "bg-muted text-muted-foreground"}`}>
        {rank}
      </div>
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
        {initials}
      </div>
      <p className="flex-1 text-sm font-medium">{entry.name}</p>
      <div className="flex items-center gap-4 text-sm text-right">
        <div className="w-16">
          <p className="font-bold text-green-600 dark:text-green-400">{entry.transfers}</p>
          <p className="text-[10px] text-muted-foreground">transfers</p>
        </div>
        <div className="w-12">
          <p className="font-semibold">{entry.total}</p>
          <p className="text-[10px] text-muted-foreground">total</p>
        </div>
        <div className="w-12">
          <p className="font-semibold text-blue-600 dark:text-blue-400">{conv}%</p>
          <p className="text-[10px] text-muted-foreground">conv.</p>
        </div>
        <div className="w-14">
          <p className={`font-semibold ${entry.completionPct != null ? (entry.completionPct >= 80 ? 'text-emerald-600 dark:text-emerald-400' : entry.completionPct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400') : 'text-muted-foreground'}`}>
            {entry.completionPct != null ? `${entry.completionPct}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">LO comp.</p>
        </div>
      </div>
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-xs space-y-1 min-w-[140px]">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium">{p.value}{p.name === "Conv. %" ? "%" : ""}</span>
        </div>
      ))}
    </div>
  );
}

// ── Individual CLR stats card ─────────────────────────────────────────────────
function IndividualStats({ clr, periods }: { clr: any; periods: any[] }) {
  const initials = clr.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const convTrend = periods.map((p: any) => ({
    label: p.label,
    "Conv. %": p.convRate,
    Transfers: p.transfers,
    Total: p.total,
  }));
  const totalTransfers = periods.reduce((s, p) => s + p.transfers, 0);
  const totalOutcomes  = periods.reduce((s, p) => s + p.total, 0);
  const avgConv = totalOutcomes > 0 ? Math.round((totalTransfers / totalOutcomes) * 100) : 0;
  const bestPeriod = [...periods].sort((a, b) => b.transfers - a.transfers)[0];

  return (
    <div className="space-y-4">
      {/* Profile header */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-lg">
              {initials}
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold">{clr.name}</h2>
              <p className="text-xs text-muted-foreground">{clr.role === "admin" ? "Admin / CLR" : "CLR Assistant"}</p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{totalTransfers}</p>
                <p className="text-xs text-muted-foreground">All-time Transfers</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{totalOutcomes}</p>
                <p className="text-xs text-muted-foreground">Total Outcomes</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{avgConv}%</p>
                <p className="text-xs text-muted-foreground">Avg Conv.</p>
              </div>
            </div>
          </div>
          {bestPeriod && bestPeriod.transfers > 0 && (
            <div className="mt-3 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-xs text-yellow-800 dark:text-yellow-200 flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 flex-shrink-0" />
              Best period: <span className="font-semibold">{bestPeriod.label}</span> — {bestPeriod.transfers} transfers ({bestPeriod.convRate}% conv.)
            </div>
          )}
        </CardContent>
      </Card>

      {/* Volume + conv area chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> Volume by Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={convTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#01696f" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#01696f" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gTot" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#006494" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#006494" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Total" name="Total Outcomes" stroke="#006494" fill="url(#gTot)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="Transfers" name="Transfers" stroke="#01696f" fill="url(#gT)" strokeWidth={2} dot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Conv rate line */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" /> Conversion Rate Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={convTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="Conv. %" stroke="#7a39bb" strokeWidth={2.5} dot={{ r: 5, fill: "#7a39bb" }} activeDot={{ r: 7 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Period breakdown table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Period Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Period</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Transfers</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Appts</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Total</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {[...periods].reverse().map((p: any, i: number) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{p.label}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 dark:text-green-400 font-semibold">{p.transfers}</td>
                    <td className="px-4 py-2.5 text-right">{p.appointments}</td>
                    <td className="px-4 py-2.5 text-right">{p.total}</td>
                    <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400 font-semibold">{p.convRate}%</td>
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TeamStats() {
  const [selectedClrId, setSelectedClrId] = useState<string>("all");

  const { data: usersData } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const clrs = (usersData ?? []).filter((u: any) => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)));

  const { data: leaderboardData, isLoading } = useQuery<any>({ queryKey: ["/api/leaderboard"] });
  const { data: historyData, isLoading: histLoading } = useQuery<any>({
    queryKey: ["/api/analytics/history", selectedClrId],
    queryFn: () => fetch(`/api/analytics/history${selectedClrId !== "all" ? `?assistantId=${selectedClrId}` : ""}`).then(r => r.json()),
  });

  const leaderboard: any[] = leaderboardData?.leaderboard ?? [];
  const startDate: string | undefined = leaderboardData?.startDate;
  const endDate: string | undefined = leaderboardData?.endDate;
  const periods: any[] = historyData?.periods ?? [];

  // Filter current period leaderboard if a CLR is selected
  const filteredLeaderboard = selectedClrId === "all"
    ? leaderboard
    : leaderboard.filter((e: any) => String(e.assistantId) === selectedClrId);

  const selectedClr = clrs.find((c: any) => String(c.id) === selectedClrId);

  const top3 = filteredLeaderboard.slice(0, 3);
  const rest = filteredLeaderboard.slice(3);
  const totalTransfers = filteredLeaderboard.reduce((s: number, e: any) => s + e.transfers, 0);
  const totalOutcomes  = filteredLeaderboard.reduce((s: number, e: any) => s + e.total, 0);
  const teamConv = totalOutcomes > 0 ? Math.round((totalTransfers / totalOutcomes) * 100) : 0;

  // Build trend data for multi-line CLR chart (team view only)
  const allCLRNames: string[] = [];
  for (const p of periods) {
    for (const c of p.clrStats ?? []) {
      if (!allCLRNames.includes(c.name)) allCLRNames.push(c.name);
    }
  }
  const trendData = periods.map((p: any) => {
    const row: any = { label: p.label };
    for (const name of allCLRNames) {
      const clr = (p.clrStats ?? []).find((c: any) => c.name === name);
      row[name] = clr?.transfers ?? 0;
    }
    return row;
  });
  const convTrend = periods.map((p: any) => ({
    label: p.label,
    "Conv. %": p.convRate,
    Transfers: p.transfers,
    Total: p.total,
  }));

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" /> Team Stats
          </h1>
          {startDate && endDate && (
            <p className="text-xs text-muted-foreground mt-0.5">Current period: {startDate} — {endDate}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* CLR filter */}
          <Select value={selectedClrId} onValueChange={setSelectedClrId}>
            <SelectTrigger className="w-48 h-8 text-sm">
              <SelectValue placeholder="All CLRs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2"><Users className="w-3.5 h-3.5" /> All CLRs</span>
              </SelectItem>
              {clrs.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedClrId === "all" && (
            <>
              <Badge variant="secondary" className="gap-1"><ArrowUpRight className="w-3 h-3" />{totalTransfers} transfers</Badge>
              <Badge variant="outline" className="gap-1"><Users className="w-3 h-3" />{leaderboard.length} CLRs</Badge>
            </>
          )}
        </div>
      </div>

      {/* Individual view */}
      {selectedClrId !== "all" && selectedClr ? (
        histLoading
          ? <div className="space-y-4">{[0,1,2].map(i => <Skeleton key={i} className="h-56" />)}</div>
          : <IndividualStats clr={selectedClr} periods={periods} />
      ) : (
        <Tabs defaultValue="current">
          <TabsList className="mb-4">
            <TabsTrigger value="current">Current Period</TabsTrigger>
            <TabsTrigger value="history">Historical Charts</TabsTrigger>
          </TabsList>

          {/* ── CURRENT PERIOD ── */}
          <TabsContent value="current" className="space-y-4">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[0,1,2].map(i => <Skeleton key={i} className="h-40" />)}
              </div>
            ) : leaderboard.length === 0 ? (
              <Card><CardContent className="py-16 text-center">
                <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No activity logged this period yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Log outcomes to see the leaderboard.</p>
              </CardContent></Card>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Transfers", value: totalTransfers, color: "text-green-600 dark:text-green-400" },
                    { label: "Total Outcomes", value: totalOutcomes, color: "" },
                    { label: "Team Conv.", value: `${teamConv}%`, color: "text-blue-600 dark:text-blue-400" },
                  ].map(k => (
                    <Card key={k.label}><CardContent className="py-4 text-center">
                      <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                      <p className="text-xs text-muted-foreground mt-1">{k.label}</p>
                    </CardContent></Card>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {top3.map((e: any, i: number) => <MedalCard key={e.assistantId} entry={e} rank={i + 1} />)}
                </div>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart2 className="w-4 h-4 text-primary" /> Transfer Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={leaderboard} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={40} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="transfers" name="Transfers" radius={[4,4,0,0]}>
                          {leaderboard.map((_: any, i: number) => (
                            <Cell key={i} fill={CLR_COLORS[i % CLR_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                {rest.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Full Rankings</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      {rest.map((e: any, i: number) => (
                        <LeaderboardRow key={e.assistantId} entry={e} rank={i + 4} />
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── HISTORICAL CHARTS ── */}
          <TabsContent value="history" className="space-y-5">
            {histLoading ? (
              <div className="space-y-4">{[0,1,2].map(i => <Skeleton key={i} className="h-56" />)}</div>
            ) : periods.length === 0 ? (
              <Card><CardContent className="py-16 text-center">
                <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No historical data yet.</p>
              </CardContent></Card>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" /> Team Volume by Period
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={convTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                        <defs>
                          <linearGradient id="gTransfers" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#01696f" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#01696f" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#006494" stopOpacity={0.2}/>
                            <stop offset="95%" stopColor="#006494" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area type="monotone" dataKey="Total" name="Total Outcomes" stroke="#006494" fill="url(#gTotal)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="Transfers" name="Transfers" stroke="#01696f" fill="url(#gTransfers)" strokeWidth={2} dot={{ r: 4 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart2 className="w-4 h-4 text-primary" /> Conversion Rate Trend
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={convTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line type="monotone" dataKey="Conv. %" stroke="#7a39bb" strokeWidth={2.5} dot={{ r: 5, fill: "#7a39bb" }} activeDot={{ r: 7 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                {allCLRNames.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" /> CLR Transfers by Period
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={trendData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip content={<ChartTooltip />} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {allCLRNames.map((name, i) => (
                            <Bar key={name} dataKey={name} stackId="a" fill={CLR_COLORS[i % CLR_COLORS.length]}
                              radius={i === allCLRNames.length - 1 ? [4,4,0,0] : [0,0,0,0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Period Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Period</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Transfers</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Appts</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Total</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Conv.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...periods].reverse().map((p: any, i: number) => (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-2.5 font-medium">{p.label}</td>
                              <td className="px-4 py-2.5 text-right text-green-600 dark:text-green-400 font-semibold">{p.transfers}</td>
                              <td className="px-4 py-2.5 text-right">{p.appointments}</td>
                              <td className="px-4 py-2.5 text-right">{p.total}</td>
                              <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400 font-semibold">{p.convRate}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
