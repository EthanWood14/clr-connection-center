// Outbound CLR Calls — admin-only reporting page. Data is proxied from
// LeadVault's outbound-summary feed (Dialpad + Mojo call logs) by
// GET /api/outbound-calls; the server caches upstream responses for 5 minutes.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { PhoneOutgoing, RefreshCw, Settings2, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type AgentRow = {
  agent: string;
  calls_total: number;
  calls_connected: number;
  talk_seconds: number;
  last_call_at: string | null;
  by_day: { date: string; calls: number }[];
};

type OutboundSummary = {
  configured?: boolean;
  upstream_error?: boolean;
  days: number;
  generated_at?: string;
  agents?: AgentRow[];
};

const DAY_RANGES = [7, 30, 90] as const;

function fmtTalkTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtLastCall(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function connectPct(row: AgentRow): string {
  if (!row.calls_total) return "—";
  return `${Math.round((row.calls_connected / row.calls_total) * 100)}%`;
}

// Tiny per-CLR daily volume sparkline — plain divs, no chart dep needed at row level.
function Sparkline({ byDay }: { byDay: AgentRow["by_day"] }) {
  const days = Array.isArray(byDay) ? byDay : [];
  const max = Math.max(1, ...days.map((d) => d.calls || 0));
  if (!days.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    // gap-px is dropped for long ranges (90d) — 1px gaps would leave sub-pixel bars.
    <div className={`flex items-end h-6 w-28 ${days.length > 45 ? "" : "gap-px"}`} aria-hidden>
      {days.map((d) => (
        <div
          key={d.date}
          className="flex-1 min-w-0 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(6, Math.round(((d.calls || 0) / max) * 100))}%` }}
          title={`${d.date}: ${d.calls || 0} calls`}
        />
      ))}
    </div>
  );
}

export default function OutboundCallsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [days, setDays] = useState<number>(30);

  useEffect(() => {
    document.title = "Outbound CLR Calls · WCLCC";
  }, []);

  useEffect(() => {
    if (user && user.role !== "admin") navigate("/");
  }, [user, navigate]);

  const queryKey = `/api/outbound-calls?days=${days}`;
  const { data, isLoading, isFetching } = useQuery<OutboundSummary>({
    queryKey: [queryKey],
    enabled: user?.role === "admin",
  });

  const agents = useMemo(() => {
    const rows = Array.isArray(data?.agents) ? [...(data!.agents as AgentRow[])] : [];
    return rows.sort((a, b) => (b.calls_total || 0) - (a.calls_total || 0));
  }, [data]);

  const totals = useMemo(() => {
    return agents.reduce(
      (acc, a) => ({
        calls: acc.calls + (a.calls_total || 0),
        connected: acc.connected + (a.calls_connected || 0),
        talk: acc.talk + (a.talk_seconds || 0),
      }),
      { calls: 0, connected: 0, talk: 0 }
    );
  }, [agents]);

  // Team-wide calls per day, summed across CLRs, for the totals-by-day chart.
  const byDayTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of agents) {
      for (const d of a.by_day ?? []) {
        map.set(d.date, (map.get(d.date) ?? 0) + (d.calls || 0));
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, calls]) => ({ date: date.slice(5), calls }));
  }, [agents]);

  if (user && user.role !== "admin") return null;

  const notConfigured = data && data.configured === false;
  const upstreamError = data && data.upstream_error === true;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PhoneOutgoing className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Outbound CLR Calls</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Data source: LeadVault (Dialpad + Mojo call logs).
            {data?.generated_at && (
              <span> Updated {fmtLastCall(data.generated_at)}.</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {DAY_RANGES.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? "default" : "outline"}
                onClick={() => setDays(d)}
                data-testid={`button-range-${d}`}
              >
                {d}d
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: [queryKey] })}
            disabled={isFetching}
            data-testid="button-refresh-outbound"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {notConfigured ? (
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <Settings2 className="w-8 h-8 text-muted-foreground/40" />
              <div className="text-sm font-medium">LeadVault reporting is not configured</div>
              <div className="text-xs text-muted-foreground max-w-md">
                Add the LeadVault reporting token on the Integrations page (or set the
                LEADVAULT_REPORTING_TOKEN environment variable) to pull outbound call
                summaries from LeadVault.
              </div>
              <Button size="sm" variant="outline" className="mt-1" onClick={() => navigate("/integrations")}>
                Go to Integrations
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : upstreamError ? (
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
              <div className="text-sm font-medium">Couldn't reach LeadVault</div>
              <div className="text-xs text-muted-foreground max-w-md">
                The LeadVault reporting feed didn't respond or returned an error. Check that
                the reporting token is valid and try refreshing in a minute.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Outbound</div>
              <div className="text-2xl font-bold">{totals.calls.toLocaleString()}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Connected</div>
              <div className="text-2xl font-bold">{totals.connected.toLocaleString()}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Connect %</div>
              <div className="text-2xl font-bold">
                {totals.calls ? `${Math.round((totals.connected / totals.calls) * 100)}%` : "—"}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Talk Time</div>
              <div className="text-2xl font-bold">{fmtTalkTime(totals.talk)}</div>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Team Calls by Day — Last {days} Days</CardTitle>
            </CardHeader>
            <CardContent>
              {byDayTotals.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                  {isLoading ? "Loading..." : "No call data for this period"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={byDayTotals} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={36} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="calls" fill="#01696f" radius={[4, 4, 0, 0]} name="Calls" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">By CLR</CardTitle>
              <CardDescription>Outbound activity per CLR over the last {days} days, busiest first.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2">CLR</th>
                      <th className="px-3 py-2 text-right">Total Outbound</th>
                      <th className="px-3 py-2 text-right">Connected</th>
                      <th className="px-3 py-2 text-right">Connect %</th>
                      <th className="px-3 py-2 text-right">Talk Time</th>
                      <th className="px-3 py-2">Last Call</th>
                      <th className="px-3 py-2">Daily Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">Loading...</td></tr>
                    ) : agents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-12 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <PhoneOutgoing className="w-8 h-8 text-muted-foreground/40" />
                            <div className="text-sm font-medium">No outbound calls recorded</div>
                            <div className="text-xs text-muted-foreground max-w-md">
                              LeadVault hasn't reported any outbound call activity for this period.
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      agents.map((a) => (
                        <tr key={a.agent} className="border-t hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium">{a.agent}</td>
                          <td className="px-3 py-2 text-right font-mono">{(a.calls_total || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono">{(a.calls_connected || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono">{connectPct(a)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmtTalkTime(a.talk_seconds)}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtLastCall(a.last_call_at)}</td>
                          <td className="px-3 py-2"><Sparkline byDay={a.by_day} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
