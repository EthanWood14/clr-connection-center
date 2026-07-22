import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  ArrowLeft, CalendarDays, PhoneForwarded, PhoneCall, Percent, CalendarCheck, Timer,
  UserCheck, FileText, Wallet, Target, TrendingUp,
} from "lucide-react";
import { PERIODS, fmtStartDate, fmtTenure, effectiveStart } from "./clr-profiles";

const money = (c: number) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Resp = {
  clr: {
    userId: number; name: string; email: string; role: string; isManager: boolean;
    excludeFromStats: boolean; startDate: string | null; createdAt: string | null;
    tenureDays: number | null; startDateIsEstimate: boolean;
  };
  period: string; startDate: string; endDate: string; dailyTooLong?: boolean; periodWeeks?: number;
  metrics: {
    calls: number; transfers: number; transfersDirect: number; transfersAppointment: number;
    appointments: number; callbacks: number; deferrals: number; fellThrough: number;
    futureContacts: number; noAnswer: number; transferRate: number; daysWithCalls: number;
  };
  goals: { calls: number; transfers: number; appointments: number };
  daily: { date: string; calls: number; transfers: number; appointments: number }[];
  hours: number;
  attendance: { checkins: number; lates: number; outsideArea: number; standing: { count: number; allowance: number; windowDays: number } };
  eodReports: number;
  comp: { earnedCents: number; reimbursedCents: number };
};

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <p className="text-2xl font-bold mt-1 tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1.5">{sub}</p>}
    </div>
  );
}

export default function ClrProfile() {
  const [, params] = useRoute("/clr-profiles/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const id = params?.id;
  const [period, setPeriod] = useState("month");
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraft, setDateDraft] = useState("");

  const { data, isLoading, isError, error } = useQuery<Resp>({
    queryKey: ["/api/clr-profiles", id, period],
    queryFn: () => apiRequest("GET", `/api/clr-profiles/${id}?period=${period}`),
    enabled: !!id,
    retry: false, // a 403/404 shouldn't spin — surface it
    // Keep the previous data while switching PERIODS (so the header doesn't
    // unmount), but never carry it across a different CLR — placeholderData
    // survives queryKey changes, which would briefly show the wrong person.
    placeholderData: (prev: any, prevQuery: any) => (prevQuery?.queryKey?.[1] === id ? prev : undefined),
  });

  const saveDate = useMutation({
    mutationFn: (startDate: string | null) => apiRequest("PATCH", `/api/clr-profiles/${id}/start-date`, { startDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clr-profiles"] });
      setEditingDate(false);
      toast({ title: "Start date saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  const m = data?.metrics;
  const peakCalls = Math.max(1, ...(data?.daily ?? []).map((d) => d.calls));
  const peakTransfers = Math.max(1, ...(data?.daily ?? []).map((d) => d.transfers));

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => navigate("/clr-profiles")}>
        <ArrowLeft className="w-4 h-4" /> All CLRs
      </Button>

      {isError ? (
        <Card>
          <CardContent className="py-16 text-center space-y-1">
            <p className="font-medium text-sm">Can't show this profile</p>
            <p className="text-xs text-muted-foreground">
              {String((error as any)?.message ?? "").includes("403") || String((error as any)?.message ?? "").toLowerCase().includes("manager")
                ? "CLR profiles are visible to managers and admins only."
                : "That CLR wasn't found."}
            </p>
          </CardContent>
        </Card>
      ) : isLoading || !data ? (
        <Skeleton className="h-32 w-full rounded-2xl" />
      ) : (
        <>
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
            <div className="relative flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                  {data.clr.name}
                  {data.clr.isManager && <Badge className="bg-white/15 text-white border-0 text-[10px]">Manager</Badge>}
                  {data.clr.excludeFromStats && <Badge className="bg-white/15 text-white border-0 text-[10px]">Non-counted</Badge>}
                </h1>
                <p className="text-sm text-white/60 mt-0.5">{data.clr.email}</p>
                <div className="flex items-center gap-2 mt-2 text-sm text-white/80">
                  <CalendarDays className="w-4 h-4" />
                  {editingDate ? (
                    <span className="flex items-center gap-1.5">
                      <Input
                        type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)}
                        className="h-7 w-40 text-black dark:text-white" data-testid="input-start-date"
                      />
                      <Button size="sm" className="h-7" disabled={saveDate.isPending} onClick={() => saveDate.mutate(dateDraft || null)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-white/70" onClick={() => setEditingDate(false)}>Cancel</Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Started <strong className="text-white">{fmtStartDate(effectiveStart(data.clr.startDate, data.clr.createdAt))}</strong>
                      {data.clr.tenureDays != null && <span className="text-white/60">· {fmtTenure(data.clr.tenureDays)} on the team</span>}
                      {data.clr.startDateIsEstimate && <span className="text-white/50 text-xs">(from account creation)</span>}
                      {isAdmin && (
                        <Button
                          size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-white/70 hover:text-white"
                          onClick={() => { setDateDraft(data.clr.startDate ?? ""); setEditingDate(true); }}
                          data-testid="btn-edit-start-date"
                        >
                          {data.clr.startDate ? "Edit" : "Set"}
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-[160px] h-9 bg-white/10 border-white/20 text-white" data-testid="select-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Showing {fmtStartDate(data.startDate)} – {fmtStartDate(data.endDate)}
          </p>

          {/* Headline production */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={PhoneForwarded} label="Transfers" value={m!.transfers}
                  sub={`${m!.transfersDirect} direct · ${m!.transfersAppointment} appt`} />
            <Stat icon={PhoneCall} label="Calls" value={m!.calls.toLocaleString()}
                  sub={`${m!.daysWithCalls} day${m!.daysWithCalls === 1 ? "" : "s"} logged`} />
            <Stat icon={Percent} label="Transfer ratio" value={`${m!.transferRate}%`} sub="transfers ÷ calls" />
            <Stat icon={CalendarCheck} label="Appointments" value={m!.appointments} sub={`${m!.callbacks} callbacks`} />
          </div>

          {/* Goals vs actual (weekly targets) */}
          {(data.goals.calls > 0 || data.goals.transfers > 0 || data.goals.appointments > 0) && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" /> Weekly goals</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Goals are WEEKLY, so scale them to the selected window —
                    otherwise a month of work is judged against one week's target. */}
                {([["Calls", m!.calls, data.goals.calls], ["Transfers", m!.transfers, data.goals.transfers], ["Appointments", m!.appointments, data.goals.appointments]] as const).map(([label, actual, weeklyGoal]) => {
                  const target = weeklyGoal > 0 ? weeklyGoal * (data.periodWeeks ?? 1) : 0;
                  return (
                    <div key={label}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="tabular-nums text-muted-foreground">{actual}{target > 0 ? ` / ${target}` : ""}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted mt-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: target > 0 ? `${Math.min(100, (actual / target) * 100)}%` : "0%" }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground sm:col-span-3">
                  {period === "alltime"
                    ? "Weekly goals aren't meaningful over all time — pick a shorter timeframe."
                    : `Weekly goals scaled to this period${(data.periodWeeks ?? 1) > 1 ? ` (×${data.periodWeeks} weeks)` : ""}. A period still in progress will read low.`}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Outcome mix */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Outcome breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {([["Transfers", m!.transfers], ["Appointments", m!.appointments], ["Callbacks", m!.callbacks], ["Deferrals", m!.deferrals],
                   ["Fell through", m!.fellThrough], ["Future contact", m!.futureContacts], ["No answer", m!.noAnswer]] as const).map(([label, v]) => (
                  <div key={label} className="rounded-lg border px-3 py-2">
                    <p className="text-lg font-bold tabular-nums leading-none">{v}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Daily trend. Bar heights are px (not %) — percentage heights on a
              grandchild of the fixed-height row resolve against an auto-height
              parent and collapse to nothing. */}
          {data.dailyTooLong ? (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Daily activity</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Too many days to chart for this range — pick a shorter timeframe to see the daily breakdown.</p>
              </CardContent>
            </Card>
          ) : data.daily.length > 1 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Daily activity</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-end gap-[2px]" style={{ height: 112 }}>
                  {data.daily.map((d) => {
                    const callPx = Math.round((d.calls / peakCalls) * 92);
                    const transferPx = d.transfers > 0 ? Math.max(3, Math.round((d.transfers / peakTransfers) * 20)) : 0;
                    return (
                      <div key={d.date} className="flex-1 min-w-0 flex flex-col justify-end" title={`${d.date}: ${d.calls} calls, ${d.transfers} transfers, ${d.appointments} appts`}>
                        {transferPx > 0 && <div className="w-full bg-emerald-500 rounded-t-sm" style={{ height: transferPx }} />}
                        <div className="w-full bg-primary/30" style={{ height: Math.max(d.calls > 0 ? 2 : 0, callPx) }} />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Calls (light) with transfers (green) on top. Peak {peakCalls} calls/day.</p>
              </CardContent>
            </Card>
          )}

          {/* Operational */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={Timer} label="Hours worked" value={data.hours.toFixed(1)} sub="from the time clock" />
            <Stat icon={UserCheck} label="Check-ins" value={data.attendance.checkins}
                  sub={`${data.attendance.lates} late · ${data.attendance.outsideArea} outside area`} />
            <Stat icon={FileText} label="EOD reports" value={data.eodReports} sub="submitted in period" />
            <Stat icon={Wallet} label="Comp approved" value={money(data.comp.earnedCents)}
                  sub={data.comp.reimbursedCents ? `+ ${money(data.comp.reimbursedCents)} reimbursed` : "earned comp"} />
          </div>

          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
            Attendance standing: <strong className="text-foreground">{data.attendance.standing.count} of {data.attendance.standing.allowance}</strong> lates
            used in the rolling {data.attendance.standing.windowDays}-day window (excused lates don't count).
          </div>
        </>
      )}
    </div>
  );
}
