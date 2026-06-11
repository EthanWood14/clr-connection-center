import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { CalendarDays, Clock, Users, CheckCircle2, Send } from "lucide-react";

type DayPlan = { working: boolean; start: string; end: string };
type DaysMap = Record<string, DayPlan>;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

function defaultDays(): DaysMap {
  const out: DaysMap = {};
  for (const k of DAY_KEYS) {
    out[k] = { working: k !== "sat" && k !== "sun", start: "08:00", end: "16:00" };
  }
  return out;
}

function hoursOf(p: DayPlan): number {
  if (!p.working) return 0;
  const [sh, sm] = p.start.split(":").map(Number);
  const [eh, em] = p.end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? mins / 60 : 0;
}

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")} ${ampm}` : `${hh} ${ampm}`;
}

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// Calendar-style week grid: hour labels down the left, one column per day,
// the working window drawn as a filled block.
function WeekGrid({ days }: { days: DaysMap }) {
  const HOUR_PX = 34;
  const working = DAY_KEYS.map(k => days[k]).filter(p => p?.working && toMin(p.end) > toMin(p.start));
  let minH = 8, maxH = 17;
  if (working.length) {
    minH = Math.min(...working.map(p => Math.floor(toMin(p.start) / 60)));
    maxH = Math.max(...working.map(p => Math.ceil(toMin(p.end) / 60)));
  }
  if (maxH - minH < 4) maxH = minH + 4;
  const hours: number[] = [];
  for (let h = minH; h <= maxH; h++) hours.push(h);
  const fmtHour = (h: number) => (h % 12 === 0 ? 12 : h % 12) + (h >= 12 ? " PM" : " AM");

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        {/* Day headers */}
        <div className="flex">
          <div className="w-14 shrink-0" />
          {DAY_KEYS.map(k => (
            <div key={k} className={`flex-1 text-center text-xs font-semibold py-1.5 border-b ${days[k]?.working ? "text-foreground" : "text-muted-foreground/60"}`}>
              {DAY_LABELS[k].slice(0, 3)}
            </div>
          ))}
        </div>
        <div className="flex">
          {/* Hour gutter */}
          <div className="w-14 shrink-0 relative" style={{ height: (maxH - minH) * HOUR_PX }}>
            {hours.slice(0, -1).map((h, i) => (
              <div key={h} className="absolute right-1.5 text-[10px] text-muted-foreground tabular-nums" style={{ top: i * HOUR_PX - 6 }}>
                {i === 0 ? "" : fmtHour(h)}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {DAY_KEYS.map(k => {
            const p = days[k];
            const on = !!p?.working && toMin(p.end) > toMin(p.start);
            const top = on ? ((toMin(p.start) - minH * 60) / 60) * HOUR_PX : 0;
            const height = on ? ((toMin(p.end) - toMin(p.start)) / 60) * HOUR_PX : 0;
            return (
              <div key={k} className="flex-1 relative border-l last:border-r" style={{ height: (maxH - minH) * HOUR_PX }}>
                {/* hour lines */}
                {hours.slice(0, -1).map((h, i) => (
                  <div key={h} className="absolute left-0 right-0 border-b border-border/60" style={{ top: (i + 1) * HOUR_PX }} />
                ))}
                {!on && <div className="absolute inset-0 bg-muted/40" />}
                {on && (
                  <div
                    className="absolute left-0.5 right-0.5 rounded-md bg-primary/80 text-primary-foreground px-1 py-0.5 overflow-hidden"
                    style={{ top, height: Math.max(height, 14) }}
                    title={`${DAY_LABELS[k]}: ${fmtTime(p.start)} – ${fmtTime(p.end)}`}
                  >
                    {height >= 30 && (
                      <div className="text-[9px] leading-tight font-medium">
                        {fmtTime(p.start)}<br />–{fmtTime(p.end)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function WeeklySchedule() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager = !!(user && (user.role === "admin" || (user as any).isManager || (user as any).superAdmin));

  const [days, setDays] = useState<DaysMap>(defaultDays());
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery<{ schedule: any }>({
    queryKey: ["/api/schedule"],
    queryFn: () => apiRequest("GET", "/api/schedule"),
  });
  const saved = data?.schedule ?? null;

  // Load the saved schedule (or defaults) once data arrives. Never clobber
  // edits the user made while a save/refetch was in flight.
  useEffect(() => {
    if (isLoading || dirty) return;
    if (saved?.days && Object.keys(saved.days).length) {
      const merged = defaultDays();
      for (const k of DAY_KEYS) if (saved.days[k]) merged[k] = { ...merged[k], ...saved.days[k] };
      setDays(merged);
      setNotes(saved.notes ?? "");
    } else {
      setDays(defaultDays());
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, saved?.updatedAt]);

  const { data: team = [] } = useQuery<any[]>({
    queryKey: ["/api/schedule/team"],
    queryFn: () => apiRequest("GET", "/api/schedule/team"),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { days: DaysMap; notes: string }) => apiRequest("PUT", "/api/schedule", payload),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule/team"] });
      setDirty(false);
      toast({
        title: "Schedule submitted for approval",
        description: d?.emailedTo ? "Sent to " + d.emailedTo + " for review." : "A manager will review it.",
      });
    },
    onError: (e: any) => toast({ title: "Could not submit", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  // Manager/admin: approve or deny a teammate's submitted schedule.
  const decideMutation = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "denied" }) =>
      apiRequest("POST", "/api/schedule/" + v.id + "/decision", { status: v.status }),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule/team"] });
      toast({ title: "Schedule " + v.status });
    },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const totalHours = useMemo(
    () => DAY_KEYS.reduce((sum, k) => sum + hoursOf(days[k]), 0),
    [days]
  );

  function setDay(k: string, patch: Partial<DayPlan>) {
    setDays(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }));
    setDirty(true);
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="w-6 h-6" /> Weekly Schedule
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Set your standard work week and submit it for manager approval. It stays in effect until you change it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Badge variant="outline" className="text-xs text-orange-500 border-orange-300">Unsubmitted changes</Badge>
          ) : saved?.status === "approved" ? (
            <Badge className="bg-green-600 text-white gap-1 text-xs">
              <CheckCircle2 className="w-3 h-3" /> Approved{saved.reviewerName ? ` by ${saved.reviewerName}` : ""}
            </Badge>
          ) : saved?.status === "denied" ? (
            <Badge className="bg-red-600 text-white text-xs">Denied — update & resubmit</Badge>
          ) : saved ? (
            <Badge className="bg-amber-500 text-white text-xs">Pending approval</Badge>
          ) : null}
        </div>
      </div>

      {saved?.status === "denied" && saved.reviewerNote && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-2.5 text-sm text-red-800 dark:text-red-300">
          <strong>Reviewer note:</strong> {saved.reviewerNote}
        </div>
      )}

      {/* Day grid */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> My Week
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              Total: <strong className="text-foreground tabular-nums">{totalHours.toFixed(totalHours % 1 ? 1 : 0)}h / week</strong>
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              {/* Calendar-style week view */}
              <div className="rounded-lg border bg-card mb-4 pb-1 px-1">
                <WeekGrid days={days} />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest pt-1">Edit hours</p>
            </>
          )}
          {!isLoading &&
            DAY_KEYS.map((k) => {
              const p = days[k];
              const h = hoursOf(p);
              return (
                <div key={k} className={`flex items-center gap-3 rounded-lg border px-3 py-2 flex-wrap ${p.working ? "" : "bg-muted/40"}`} data-testid={"day-row-" + k}>
                  <label className="flex items-center gap-2.5 w-36 shrink-0 cursor-pointer">
                    <Switch checked={p.working} onCheckedChange={(v) => setDay(k, { working: v })} data-testid={"day-working-" + k} />
                    <span className={`text-sm font-medium ${p.working ? "" : "text-muted-foreground"}`}>{DAY_LABELS[k]}</span>
                  </label>
                  {p.working ? (
                    <div className="flex items-center gap-2 flex-1 flex-wrap">
                      <Input type="time" value={p.start} onChange={e => setDay(k, { start: e.target.value })} className="h-8 w-[110px] text-sm" data-testid={"day-start-" + k} />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input type="time" value={p.end} onChange={e => setDay(k, { end: e.target.value })} className="h-8 w-[110px] text-sm" data-testid={"day-end-" + k} />
                      <span className={`ml-auto text-xs tabular-nums ${h > 0 ? "text-muted-foreground" : "text-red-500 font-medium"}`}>
                        {h > 0 ? h.toFixed(h % 1 ? 1 : 0) + "h" : "end must be after start"}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Off</span>
                  )}
                </div>
              );
            })}

          <div className="pt-1">
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setDirty(true); }}
              rows={2} maxLength={1000}
              placeholder="Anything the team should know — lunch breaks, timezone, recurring commitments, etc."
              data-testid="schedule-notes"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <p className="text-[11px] text-muted-foreground">
              Submissions are reviewed by a manager and stay in effect until you change them.
            </p>
            <Button onClick={() => saveMutation.mutate({ days, notes })} disabled={saveMutation.isPending} className="gap-1.5 shrink-0" data-testid="submit-schedule">
              <Send className="w-4 h-4" />
              {saveMutation.isPending ? "Submitting…" : saved ? "Resubmit for Approval" : "Submit for Approval"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Team schedules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" /> Team Schedules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {team.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">No one has set a weekly schedule yet.</p>
          ) : (
            team.map((t: any) => (
              <div key={t.userId} className="rounded-lg border px-3 py-2.5" data-testid={"team-sched-" + t.userId}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-sm font-semibold">{t.userName}</span>
                  {t.userId === user?.id && <Badge variant="outline" className="text-[10px]">you</Badge>}
                  {t.status === "approved" ? (
                    <Badge className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Approved{t.reviewerName ? ` · ${t.reviewerName}` : ""}</Badge>
                  ) : t.status === "denied" ? (
                    <Badge className="text-[10px] bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Denied</Badge>
                  ) : (
                    <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Pending</Badge>
                  )}
                  {isManager && t.status === "pending" && (
                    <span className="ml-auto flex items-center gap-1.5">
                      <Button
                        size="sm" className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                        onClick={() => decideMutation.mutate({ id: t.id, status: "approved" })}
                        disabled={decideMutation.isPending} data-testid={"approve-sched-" + t.userId}
                      >
                        <CheckCircle2 className="w-3 h-3" /> Approve
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-7 px-2.5 text-xs border-red-300 text-red-700 hover:bg-red-50"
                        onClick={() => decideMutation.mutate({ id: t.id, status: "denied" })}
                        disabled={decideMutation.isPending} data-testid={"deny-sched-" + t.userId}
                      >
                        Deny
                      </Button>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_KEYS.map(k => {
                    const p = t.days?.[k];
                    const on = !!p?.working;
                    return (
                      <span
                        key={k}
                        className={`text-[11px] px-2 py-0.5 rounded-md border ${on ? "bg-primary/10 border-primary/20 text-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        <span className="font-semibold uppercase">{k}</span>
                        {on ? ` ${fmtTime(p.start)}–${fmtTime(p.end)}` : " off"}
                      </span>
                    );
                  })}
                </div>
                {t.notes && <p className="text-xs text-muted-foreground mt-1.5 italic">{t.notes}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
