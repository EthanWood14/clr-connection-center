import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal, TrendingUp, PhoneCall, Calendar, ArrowUpRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const MEDAL_CONFIG = [
  { rank: 1, icon: Trophy, color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-900/20", border: "border-yellow-200 dark:border-yellow-700", label: "1st" },
  { rank: 2, icon: Medal, color: "text-slate-400", bg: "bg-slate-50 dark:bg-slate-800/40", border: "border-slate-200 dark:border-slate-600", label: "2nd" },
  { rank: 3, icon: Medal, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20", border: "border-amber-200 dark:border-amber-700", label: "3rd" },
];

const BAR_COLORS = ["#d4a017", "#9ca3af", "#d97706", "#01696f", "#437a22", "#006494", "#7a39bb", "#a13544", "#da7101"];

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer", appointment: "Appointment", fell_through: "Fell Through",
  no_answer: "No Answer", callback_requested: "Callback",
  not_interested: "Not Interested", wrong_number: "Wrong Number", other: "Other",
};

function MedalCard({ entry, rank }: { entry: any; rank: number }) {
  const medal = MEDAL_CONFIG.find(m => m.rank === rank);
  const Icon = medal ? medal.icon : TrendingUp;
  const initials = entry.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <Card className={`relative overflow-hidden border-2 ${medal?.border ?? "border-border"} ${medal?.bg ?? ""}`}>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
              {initials}
            </div>
            <div>
              <p className="font-semibold text-sm" data-testid={`text-leaderboard-name-${entry.assistantId}`}>{entry.name}</p>
              <p className="text-xs text-muted-foreground">Rank #{rank}</p>
            </div>
          </div>
          <Icon className={`w-6 h-6 ${medal?.color ?? "text-muted-foreground"}`} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid={`stat-transfers-${entry.assistantId}`}>
              {entry.transfers}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Transfers</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{entry.total}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {entry.total > 0 ? Math.round((entry.transfers / entry.total) * 100) : 0}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Conv.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LeaderboardRow({ entry, rank }: { entry: any; rank: number }) {
  const initials = entry.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const convRate = entry.total > 0 ? Math.round((entry.transfers / entry.total) * 100) : 0;
  const medal = MEDAL_CONFIG.find(m => m.rank === rank);

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 border-b last:border-0 hover:bg-muted/30 transition-colors"
      data-testid={`row-leaderboard-${entry.assistantId}`}
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
        ${rank <= 3 ? `${medal?.bg} ${medal?.color}` : "bg-muted text-muted-foreground"}`}>
        {rank}
      </div>
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" data-testid={`text-lb-row-name-${entry.assistantId}`}>{entry.name}</p>
      </div>
      <div className="flex items-center gap-3 sm:gap-6 text-sm flex-shrink-0">
        <div className="text-center min-w-[40px]">
          <p className="font-bold text-green-600 dark:text-green-400">{entry.transfers}</p>
          <p className="text-[10px] text-muted-foreground">Trans.</p>
        </div>
        <div className="hidden sm:block text-center min-w-[40px]">
          <p className="font-semibold">{entry.appointments ?? 0}</p>
          <p className="text-[10px] text-muted-foreground">Appts</p>
        </div>
        <div className="text-center min-w-[36px]">
          <p className="font-semibold">{entry.total}</p>
          <p className="text-[10px] text-muted-foreground">Total</p>
        </div>
        <div className="text-center min-w-[40px]">
          <p className="font-semibold text-blue-600 dark:text-blue-400">{convRate}%</p>
          <p className="text-[10px] text-muted-foreground">Conv.</p>
        </div>
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const { data: leaderboardData, isLoading } = useQuery<any>({ queryKey: ["/api/leaderboard"] });

  const leaderboard: any[] = leaderboardData?.leaderboard ?? [];
  const period = leaderboardData?.period ?? {};

  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  const totalTransfers = leaderboard.reduce((sum: number, e: any) => sum + e.transfers, 0);
  const totalOutcomes = leaderboard.reduce((sum: number, e: any) => sum + e.total, 0);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            CLR Leaderboard
          </h1>
          {period.startDate && period.endDate && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Reporting period: {period.startDate} — {period.endDate}
            </p>
          )}
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="stat-total-transfers">{totalTransfers}</p>
            <p className="text-xs text-muted-foreground">Team Transfers</p>
          </div>
          <div>
            <p className="text-xl font-bold">{totalOutcomes}</p>
            <p className="text-xs text-muted-foreground">Total Outcomes</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : leaderboard.length === 0 ? (
        <div className="py-20 text-center">
          <Trophy className="w-16 h-16 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-1">No activity logged this period yet.</p>
          <p className="text-xs text-muted-foreground">Log outcomes to see the leaderboard.</p>
        </div>
      ) : (
        <>
          {/* Podium — Top 3 */}
          {top3.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {top3.map((entry: any, i: number) => (
                <MedalCard key={entry.assistantId} entry={entry} rank={i + 1} />
              ))}
              {top3.length < 3 && Array.from({ length: 3 - top3.length }).map((_, i) => (
                <Card key={`empty-${i}`} className="border-dashed opacity-40">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No data
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-green-500" />
                Transfers by CLR
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={leaderboard} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-popover border rounded-lg p-2.5 shadow-lg text-xs">
                          <p className="font-semibold mb-1">{d.name}</p>
                          <p className="text-green-600">Transfers: {d.transfers}</p>
                          <p>Total: {d.total}</p>
                          <p className="text-blue-600">Conv: {d.total > 0 ? Math.round((d.transfers / d.total) * 100) : 0}%</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="transfers" radius={[4, 4, 0, 0]} name="Transfers">
                    {leaderboard.map((_: any, i: number) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Full Rankings Table */}
          {rest.length > 0 && (
            <Card>
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-semibold">Full Rankings</CardTitle>
              </CardHeader>
              <CardContent className="p-0 mt-2">
                {rest.map((entry: any, i: number) => (
                  <LeaderboardRow key={entry.assistantId} entry={entry} rank={i + 4} />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
