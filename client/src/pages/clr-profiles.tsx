import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, CalendarDays, PhoneForwarded, PhoneCall, Percent, ChevronRight } from "lucide-react";

export const PERIODS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "30days", label: "Last 30 days" },
  { value: "90days", label: "Last 90 days" },
  { value: "alltime", label: "All time" },
];

export function fmtStartDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// "1y 3m" / "5m" / "12d" — compact tenure for a tile.
export function fmtTenure(days: number | null) {
  if (days == null) return "—";
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}m`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y}y ${m}m` : `${y}y`;
}

type Row = {
  userId: number; name: string; role: string; isManager: boolean; excludeFromStats: boolean;
  startDate: string | null; createdAt: string | null; tenureDays: number | null; startDateIsEstimate: boolean;
  metrics: { calls: number; transfers: number; appointments: number; transferRate: number };
};

// What to show as "started": the real start date, else fall back to when the
// account was created (flagged with *), so the row never reads "—" while the
// footnote claims we're showing account creation.
export function effectiveStart(startDate: string | null, createdAt: string | null): string | null {
  if (startDate) return startDate;
  return createdAt ? String(createdAt).slice(0, 10) : null;
}

export default function ClrProfiles() {
  const [, navigate] = useLocation();
  const [period, setPeriod] = useState("month");
  const { data, isLoading } = useQuery<{ clrs: Row[]; startDate: string; endDate: string }>({
    queryKey: ["/api/clr-profiles", period],
    queryFn: () => apiRequest("GET", `/api/clr-profiles?period=${period}`),
  });
  const clrs = data?.clrs ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><Users className="w-40 h-40" /></div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <Users className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">CLR Profiles</h1>
            <p className="text-sm text-white/60">Start dates and at-a-glance performance. Open anyone for their full metrics.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {clrs.length} CLR{clrs.length === 1 ? "" : "s"}
          {data?.startDate ? ` · ${fmtStartDate(data.startDate)} – ${fmtStartDate(data.endDate)}` : ""}
        </p>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px] h-9" data-testid="select-period"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
        </div>
      ) : clrs.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">No active CLRs.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {clrs.map((c) => (
            <button
              key={c.userId}
              type="button"
              onClick={() => navigate(`/clr-profiles/${c.userId}`)}
              className="text-left rounded-xl border bg-card p-4 hover:border-primary/50 hover:shadow-sm transition group"
              data-testid={`clr-tile-${c.userId}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate flex items-center gap-1.5">
                    {c.name}
                    {c.excludeFromStats && <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">Non-counted</Badge>}
                  </p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <CalendarDays className="w-3 h-3" />
                    Started {fmtStartDate(effectiveStart(c.startDate, c.createdAt))}
                    {c.startDateIsEstimate && <span title="No start date set — showing account creation">*</span>}
                    {c.tenureDays != null && <span>· {fmtTenure(c.tenureDays)}</span>}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-primary" />
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t">
                <div>
                  <p className="text-lg font-bold tabular-nums leading-none">{c.metrics.transfers}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5"><PhoneForwarded className="w-2.5 h-2.5" /> Transfers</p>
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums leading-none">{c.metrics.calls.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5"><PhoneCall className="w-2.5 h-2.5" /> Calls</p>
                </div>
                <div>
                  <p className="text-lg font-bold tabular-nums leading-none">{c.metrics.transferRate}%</p>
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5"><Percent className="w-2.5 h-2.5" /> Ratio</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {clrs.some((c) => c.startDateIsEstimate) && (
        <p className="text-[11px] text-muted-foreground">* No start date on file — showing when the account was created. Set the real date on their profile page.</p>
      )}
    </div>
  );
}
