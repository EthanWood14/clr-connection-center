import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  UserCheck, ChevronLeft, ChevronRight, MapPin, CheckCircle2, XCircle, MinusCircle,
  Clock, AlertTriangle, CalendarOff,
} from "lucide-react";
// Check-ins use the PLAIN local calendar date — deliberately NOT the shared
// business-day helper, which rolls forward at 7pm and would point the roster at
// tomorrow all evening.
const todayLocal = () => new Date().toLocaleDateString("en-CA");

type Mine = {
  id: number;
  checked_in_at: string;
  on_time: number | null;
  in_area: number | null;
  distance_m: number | null;
  minutes_late: number | null;
  expected_start: string | null;
  late_excused?: number | null;
  excuse_reason?: string | null;
} | null;

type LateRow = {
  id: number; date: string; checkedInAt: string; minutesLate: number | null; expectedStart: string | null;
  excused?: boolean; excusedBy?: string | null; excuseReason?: string | null;
};
type LateStats = {
  allowance: number; windowDays: number; windowStart: string;
  count: number; remaining: number; overLimit: boolean; lates: LateRow[];
};
type MineResp = {
  enabled: boolean;
  start: string | null;
  startSource: "schedule" | "none";
  working: boolean;
  graceMin: number;
  officeSet: boolean;
  radiusM: number;
  date: string;
  mine: Mine;
  lateStats: LateStats;
};

type CheckinRow = {
  userId: number;
  name: string;
  checkin: Mine;
  expectedStart: string | null;
  scheduledOff: boolean;
  noSchedule?: boolean;
  lateCount: number;
  lateOverLimit: boolean;
  lateAtLimit: boolean;
};
type AdminResp = {
  date: string;
  config: { enabled: boolean; start: string; graceMin: number; radiusM: number; lat: number | null; lng: number | null };
  clrs: CheckinRow[];
  policy: { allowance: number; windowDays: number; windowStart: string };
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
function fmtDay(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
// "08:00" → "8:00 AM"
function fmtHm(hm: string | null) {
  if (!hm) return "—";
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export default function CheckIns() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || (user as any)?.isManager;

  const { data: me, isLoading: meLoading } = useQuery<MineResp>({ queryKey: ["/api/checkin"] });
  const [locating, setLocating] = useState(false);

  const checkinMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/checkin", body),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/checkin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/admin"] });
      const ci = r?.checkin;
      toast({
        title: ci?.on_time === 1 ? "Checked in — on time" : "Checked in — late",
        description: ci?.on_time === 1
          ? "Have a great day!"
          : `${ci?.minutes_late ?? 0} min past your ${fmtHm(ci?.expected_start ?? null)} start.`,
        variant: ci?.on_time === 1 ? undefined : "destructive",
      });
    },
    onError: (e: any) => toast({ title: "Couldn't check in", description: e?.message, variant: "destructive" }),
  });

  function doCheckIn() {
    // Location is best-effort: if it's denied or unavailable we still record the
    // time, just without the in-office verification.
    const submit = (body: any) => { setLocating(false); checkinMut.mutate(body); };
    if (!navigator.geolocation) return submit({});
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => submit({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      () => submit({}),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  const stats = me?.lateStats;
  const mine = me?.mine ?? null;

  // Managers can reverse a late (and undo the reversal). The row keeps its real
  // times; excusing only stops it counting toward the 90-day allowance.
  const excuseMut = useMutation({
    mutationFn: (v: { id: number; excused: boolean; reason: string }) =>
      apiRequest("POST", `/api/checkin/${v.id}/excuse`, { excused: v.excused, reason: v.reason }),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin"] });
      toast({ title: v.excused ? "Late excused" : "Late re-applied" });
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: e?.message, variant: "destructive" }),
  });
  function excuseLate(id: number, currentlyExcused: boolean) {
    if (currentlyExcused) { excuseMut.mutate({ id, excused: false, reason: "" }); return; }
    const reason = window.prompt("Reason for excusing this late (optional):", "") ?? "";
    excuseMut.mutate({ id, excused: true, reason });
  }

  // ── Manager roster (below the personal card) ──
  const [date, setDate] = useState(() => todayLocal());
  const { data: adminData, isLoading: adminLoading } = useQuery<AdminResp>({
    queryKey: ["/api/checkin/admin", date],
    queryFn: () => apiRequest("GET", `/api/checkin/admin?date=${date}`),
    enabled: !!isManager,
  });
  const clrs = adminData?.clrs ?? [];
  const checkedIn = clrs.filter(c => c.checkin).length;
  const onTimeCount = clrs.filter(c => c.checkin && c.checkin.on_time === 1).length;
  const inAreaCount = clrs.filter(c => c.checkin && c.checkin.in_area === 1).length;

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
            <h1 className="text-2xl font-bold text-white">Check-In</h1>
            <p className="text-sm text-white/60">
              Check in when you start. Your start time comes from your weekly schedule, and you're
              verified as being at the office.
            </p>
          </div>
        </div>
      </div>

      {me && !me.enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          Check-ins are currently disabled — an admin can enable them (and set the office location) in Settings → Morning Check-In.
        </div>
      )}

      {/* ── Your check-in ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" /> Today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Order matters: an existing check-in always wins (so a check-in on a
              day off is still shown), and a failed load must not masquerade as a
              scheduled day off. */}
          {meLoading || !me ? (
            <Skeleton className="h-20 w-full" />
          ) : mine ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {mine.late_excused ? (
                  <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800" title={mine.excuse_reason || "Excused by a manager"}>
                    <CheckCircle2 className="w-3 h-3" /> Excused
                  </Badge>
                ) : mine.on_time === 1 ? (
                  <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                    <CheckCircle2 className="w-3 h-3" /> On time
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                    <XCircle className="w-3 h-3" /> Late{mine.minutes_late ? ` by ${mine.minutes_late} min` : ""}
                  </Badge>
                )}
                {mine.in_area === 1 ? (
                  <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                    <MapPin className="w-3 h-3" /> At the office
                  </Badge>
                ) : mine.in_area === 0 ? (
                  <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                    <MapPin className="w-3 h-3" /> Outside{mine.distance_m != null ? ` · ${fmtDist(mine.distance_m)}` : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                    <MinusCircle className="w-3 h-3" /> No location
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Checked in at <strong className="text-foreground">{fmtTime(mine.checked_in_at)}</strong>
                {" · "}due {fmtHm(mine.expected_start ?? me?.start ?? null)}
                {me?.graceMin ? ` (+${me.graceMin} min grace)` : ""}
              </p>
            </div>
          ) : me.startSource === "none" ? (
            // No schedule on file — they can still check in, it just isn't scored.
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <CalendarOff className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  No weekly schedule on file, so there's no start time to check you against. You can still check in —
                  it's recorded, but it won't be scored on time until you submit your <strong className="text-foreground">Weekly Schedule</strong>.
                </span>
              </div>
              <Button onClick={doCheckIn} disabled={!me.enabled || locating || checkinMut.isPending} className="gap-2" data-testid="btn-check-in">
                <UserCheck className="w-4 h-4" />
                {locating ? "Getting location…" : checkinMut.isPending ? "Checking in…" : "Check in now"}
              </Button>
            </div>
          ) : !me.working ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarOff className="w-4 h-4" />
              You're not scheduled to work today — no check-in needed.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your start today is <strong className="text-foreground">{fmtHm(me?.start ?? null)}</strong>
                {me?.graceMin ? ` (+${me.graceMin} min grace)` : ""}
                {" — from your weekly schedule."}
              </p>
              <Button onClick={doCheckIn} disabled={!me?.enabled || locating || checkinMut.isPending} className="gap-2" data-testid="btn-check-in">
                <UserCheck className="w-4 h-4" />
                {locating ? "Getting location…" : checkinMut.isPending ? "Checking in…" : "Check in now"}
              </Button>
              {me?.officeSet && (
                <p className="text-[11px] text-muted-foreground">
                  We'll check you're within {me.radiusM} m of the office. Allow location when prompted.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Lates in the last 90 days ── */}
      {stats && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Lates — last {stats.windowDays} days
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={
                  "text-3xl font-bold tabular-nums " +
                  (stats.count >= stats.allowance ? "text-red-600 dark:text-red-400" : stats.count > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")
                }
                data-testid="late-count"
              >
                {stats.count}
              </span>
              <span className="text-sm text-muted-foreground">
                of <strong className="text-foreground">{stats.allowance}</strong> allowed
                {stats.remaining > 0
                  ? ` · ${stats.remaining} left`
                  : stats.overLimit ? " · over the limit" : " · limit reached"}
              </span>
            </div>

            {/* allowance pips */}
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.max(stats.allowance, stats.count) }).map((_, i) => (
                <span
                  key={i}
                  className={
                    "h-2 flex-1 rounded-full " +
                    (i < stats.count
                      ? (i >= stats.allowance ? "bg-red-600" : "bg-amber-500")
                      : "bg-muted")
                  }
                />
              ))}
            </div>

            {stats.count >= stats.allowance && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-[12px] text-red-800 dark:text-red-300">
                {stats.overLimit
                  ? `You're over the ${stats.allowance}-late limit for this ${stats.windowDays}-day window, and your managers were notified when you reached it.`
                  : `You've used all ${stats.allowance} lates for this ${stats.windowDays}-day window — your managers have been notified. Any further late puts you over.`}
              </div>
            )}

            {stats.lates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No late check-ins in the last {stats.windowDays} days. Nice work.</p>
            ) : (
              <div className="rounded-md border divide-y">
                {stats.lates.map((l) => (
                  <div key={l.date} className={`flex items-center justify-between gap-3 px-3 py-2 ${l.excused ? "opacity-70" : ""}`} data-testid={`late-row-${l.date}`}>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${l.excused ? "line-through" : ""}`}>{fmtDay(l.date)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        In at {fmtTime(l.checkedInAt)} · due {fmtHm(l.expectedStart)}
                        {l.excused && ` · excused${l.excusedBy ? ` by ${l.excusedBy}` : ""}${l.excuseReason ? ` — ${l.excuseReason}` : ""}`}
                      </p>
                    </div>
                    {l.excused ? (
                      <Badge variant="outline" className="font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 shrink-0">
                        Excused
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 shrink-0">
                        {l.minutesLate != null ? `${l.minutesLate} min late` : "Late"}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Rolling window since {fmtDay(stats.windowStart)}. Lates drop off automatically as they age past {stats.windowDays} days.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Manager roster ── */}
      {isManager && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><UserCheck className="w-4 h-4" /> Team check-ins</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setDate(d => shiftDate(d, -1))}><ChevronLeft className="w-4 h-4" /></Button>
                <span className="text-sm font-semibold w-44 text-center">{fmtDay(date)}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={date >= todayLocal()} onClick={() => setDate(d => shiftDate(d, 1))}><ChevronRight className="w-4 h-4" /></Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {checkedIn}/{clrs.length} checked in · {onTimeCount} on time · {inAreaCount} in office
              </div>
            </div>

            <div className="rounded-md border divide-y">
              {adminLoading ? (
                <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : clrs.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">No active CLRs.</p>
              ) : (
                clrs.map((c) => {
                  const ci = c.checkin;
                  return (
                    <div key={c.userId} className="flex items-center gap-3 px-4 py-2.5" data-testid={`checkin-row-${c.userId}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate flex items-center gap-1.5">
                          {c.name}
                          {c.lateCount > 0 && (
                            <span
                              className={
                                "text-[10px] px-1.5 py-0.5 rounded font-semibold " +
                                (c.lateOverLimit
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                  : c.lateAtLimit
                                  ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300")
                              }
                              title={`${c.lateCount} late check-in(s) in the last ${adminData?.policy?.windowDays ?? 90} days`}
                            >
                              {c.lateCount}/{adminData?.policy?.allowance ?? 3} late
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ci
                            ? `Checked in ${fmtTime(ci.checked_in_at)}${c.expectedStart ? ` · due ${fmtHm(c.expectedStart)}` : c.noSchedule ? " · no schedule" : ""}`
                            : c.noSchedule ? "No schedule on file — not scored"
                            : c.scheduledOff ? "Scheduled off"
                            : `No check-in${c.expectedStart ? ` · due ${fmtHm(c.expectedStart)}` : ""}`}
                        </p>
                      </div>
                      {ci ? (
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {ci.on_time === 1 ? (
                            <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> On time
                            </Badge>
                          ) : ci.late_excused ? (
                            <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800" title={ci.excuse_reason || "Excused"}>
                              <CheckCircle2 className="w-3 h-3" /> Excused
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                              <XCircle className="w-3 h-3" /> Late{ci.minutes_late ? ` ${ci.minutes_late}m` : ""}
                            </Badge>
                          )}
                          {/* Reverse a late (or put it back) — managers only. */}
                          {ci.on_time !== 1 && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              disabled={excuseMut.isPending}
                              onClick={() => excuseLate(ci.id, !!ci.late_excused)}
                              data-testid={`excuse-${c.userId}`}
                            >
                              {ci.late_excused ? "Undo" : "Excuse"}
                            </Button>
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
                      ) : c.scheduledOff ? (
                        <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                          <CalendarOff className="w-3 h-3" /> Off
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                          <XCircle className="w-3 h-3" /> Missing
                        </Badge>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
