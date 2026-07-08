import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCheck, ChevronLeft, ChevronRight, MapPin, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { businessTodayClient } from "@/lib/business-day";

type CheckinRow = {
  userId: number;
  name: string;
  checkin: {
    checked_in_at: string;
    on_time: number | null;
    in_area: number | null;
    distance_m: number | null;
  } | null;
};
type AdminResp = {
  date: string;
  config: { enabled: boolean; start: string; graceMin: number; radiusM: number; lat: number | null; lng: number | null };
  clrs: CheckinRow[];
};

function shiftDate(d: string, days: number): string {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function fmtDist(m: number | null) {
  if (m == null) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export default function CheckIns() {
  const [date, setDate] = useState(() => businessTodayClient());
  const { data, isLoading } = useQuery<AdminResp>({
    queryKey: ["/api/checkin/admin", date],
    queryFn: () => apiRequest("GET", `/api/checkin/admin?date=${date}`),
  });

  const clrs = data?.clrs ?? [];
  const checkedIn = clrs.filter(c => c.checkin).length;
  const onTime = clrs.filter(c => c.checkin && c.checkin.on_time === 1).length;
  const inArea = clrs.filter(c => c.checkin && c.checkin.in_area === 1).length;
  const dateLabel = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><UserCheck className="w-40 h-40" /></div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <UserCheck className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Morning Check-Ins</h1>
            <p className="text-sm text-white/60">
              Who checked in, whether they were on time{data?.config?.start ? ` (start ${data.config.start}${data.config.graceMin ? `, +${data.config.graceMin} min grace` : ""})` : ""}, and whether they were in the office area.
            </p>
          </div>
        </div>
      </div>

      {!data?.config?.enabled && !isLoading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          Check-ins are currently disabled — enable them (and set the office location) in Settings → Morning Check-In.
        </div>
      )}

      {/* Date nav + summary */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setDate(d => shiftDate(d, -1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-semibold w-44 text-center">{dateLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={date >= businessTodayClient()} onClick={() => setDate(d => shiftDate(d, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="text-xs text-muted-foreground">
          {checkedIn}/{clrs.length} checked in · {onTime} on time · {inArea} in office
        </div>
      </div>

      {/* Roster */}
      <Card>
        <CardContent className="p-0 divide-y">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : clrs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No active CLRs.</p>
          ) : (
            clrs.map((c) => {
              const ci = c.checkin;
              return (
                <div key={c.userId} className="flex items-center gap-3 px-4 py-2.5" data-testid={`checkin-row-${c.userId}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ci ? `Checked in ${new Date(ci.checked_in_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "No check-in"}
                    </p>
                  </div>
                  {ci ? (
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {ci.on_time === 1 ? (
                        <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3" /> On time
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                          <XCircle className="w-3 h-3" /> Late
                        </Badge>
                      )}
                      {ci.in_area === 1 ? (
                        <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                          <MapPin className="w-3 h-3" /> In area
                        </Badge>
                      ) : ci.in_area === 0 ? (
                        <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                          <MapPin className="w-3 h-3" /> Outside{ci.distance_m != null ? ` · ${fmtDist(ci.distance_m)}` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                          <MinusCircle className="w-3 h-3" /> No location
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                      <XCircle className="w-3 h-3" /> Missing
                    </Badge>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
