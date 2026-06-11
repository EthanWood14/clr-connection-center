import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { CalendarDays, Clock, Users, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { parseDbTimestamp } from "@/lib/utils";

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

export default function WeeklySchedule() {
  const { toast } = useToast();
  const { user } = useAuth();

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule/team"] });
      setDirty(false);
    },
    onError: (e: any) => toast({ title: "Could not save schedule", description: e?.message ?? "Check your connection and edit again.", variant: "destructive" }),
  });

  // Auto-save: changes persist on their own (~600ms after the last edit) and
  // the schedule stays in effect permanently until it's changed again.
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveMutation.mutate({ days, notes }), 600);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, notes, dirty]);

  const totalHours = useMemo(
    () => DAY_KEYS.reduce((sum, k) => sum + hoursOf(days[k]), 0),
    [days]
  );

  function setDay(k: string, patch: Partial<DayPlan>) {
    setDays(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }));
    setDirty(true);
  }

  const savedAgo = saved?.updatedAt
    ? formatDistanceToNow(parseDbTimestamp(saved.updatedAt) ?? new Date(), { addSuffix: true })
    : null;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarDays className="w-6 h-6" /> Weekly Schedule
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Set your standard work week so the team knows when you're on. Update it whenever your schedule changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty || saveMutation.isPending ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">Saving…</Badge>
          ) : saved ? (
            <Badge className="bg-green-600 text-white gap-1 text-xs">
              <CheckCircle2 className="w-3 h-3" /> Saved{savedAgo ? ` ${savedAgo}` : ""}
            </Badge>
          ) : null}
        </div>
      </div>

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
            })
          )}

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

          <p className="text-[11px] text-muted-foreground text-right pt-1">
            Changes save automatically and stay in effect until you change them.
          </p>
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
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-semibold">{t.userName}</span>
                  {t.userId === user?.id && <Badge variant="outline" className="text-[10px]">you</Badge>}
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
