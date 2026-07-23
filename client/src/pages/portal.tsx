import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, CalendarDays, CheckCircle2, LogIn, LogOut, Save } from "lucide-react";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" }, { key: "tue", label: "Tuesday" }, { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" }, { key: "fri", label: "Friday" }, { key: "sat", label: "Saturday" }, { key: "sun", label: "Sunday" },
];
type Day = { working: boolean; start: string; end: string };
type Resp = {
  subject: { type: "lo" | "loa"; name: string; loName: string | null };
  open: { clockIn: string } | null;
  schedule: Record<string, Day> | null;
  recent: { id: number; clockIn: string; clockOut: string | null; hours: number }[];
};

const blankDays = (): Record<string, Day> =>
  Object.fromEntries(DAYS.map((d) => [d.key, { working: d.key !== "sat" && d.key !== "sun", start: "09:00", end: "17:00" }]));

function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }
function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function Portal() {
  const [, params] = useRoute("/portal/:token");
  const token = params?.token ?? "";
  const qc = useQueryClient();
  const key = ["/api/portal", token];

  const { data, isLoading, isError } = useQuery<Resp>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/portal/${token}`),
    enabled: !!token,
    retry: false,
  });

  const [days, setDays] = useState<Record<string, Day>>(blankDays());
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (data && !dirty) {
      const base = blankDays();
      if (data.schedule) for (const k of Object.keys(base)) if (data.schedule[k]) base[k] = { working: !!data.schedule[k].working, start: data.schedule[k].start || "09:00", end: data.schedule[k].end || "17:00" };
      setDays(base);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live timer while clocked in.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!data?.open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [data?.open?.clockIn]);

  const clockMut = useMutation({
    mutationFn: (action: "clock-in" | "clock-out") => apiRequest("POST", `/api/portal/${token}/${action}`, {}),
    onSuccess: (r: any) => qc.setQueryData(key, r),
  });
  const saveSched = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/portal/${token}/schedule`, { days }),
    onSuccess: (r: any) => { qc.setQueryData(key, r); setDirty(false); },
  });

  const setDay = (k: string, patch: Partial<Day>) => { setDays((d) => ({ ...d, [k]: { ...d[k], ...patch } })); setDirty(true); };

  if (isError || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <Card className="max-w-sm w-full"><CardContent className="py-12 text-center space-y-2">
          <p className="font-semibold">This link isn't valid</p>
          <p className="text-sm text-muted-foreground">Ask your West Capital contact for a new clock-in link.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-md mx-auto space-y-4">
        {/* Header */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg text-white">
          <p className="text-xs uppercase tracking-widest text-white/50">West Capital Lending</p>
          {isLoading || !data ? (
            <Skeleton className="h-7 w-40 mt-2 bg-white/20" />
          ) : (
            <>
              <h1 className="text-2xl font-bold mt-1">{data.subject.name}</h1>
              <p className="text-sm text-white/60">
                {data.subject.type === "loa" ? `Loan Officer Assistant${data.subject.loName ? ` — ${data.subject.loName}` : ""}` : "Loan Officer"}
              </p>
            </>
          )}
        </div>

        {/* Clock */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" /> Time clock</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading || !data ? (
              <Skeleton className="h-16 w-full" />
            ) : data.open ? (
              <>
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 px-4 py-3">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4" /> Clocked in since {fmtTime(data.open.clockIn)}
                  </div>
                  <p className="text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">{elapsed(data.open.clockIn, now)}</p>
                </div>
                <Button className="w-full gap-2" variant="destructive" disabled={clockMut.isPending} onClick={() => clockMut.mutate("clock-out")}>
                  <LogOut className="w-4 h-4" /> {clockMut.isPending ? "…" : "Clock out"}
                </Button>
              </>
            ) : (
              <Button className="w-full gap-2 h-12 text-base" disabled={clockMut.isPending} onClick={() => clockMut.mutate("clock-in")} data-testid="portal-clock-in">
                <LogIn className="w-5 h-5" /> {clockMut.isPending ? "…" : "Clock in"}
              </Button>
            )}
            {!!data?.recent?.length && (
              <div className="pt-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recent shifts</p>
                <div className="space-y-1">
                  {data.recent.slice(0, 5).map((e) => (
                    <div key={e.id} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{fmtDate(e.clockIn)} · {fmtTime(e.clockIn)}{e.clockOut ? `–${fmtTime(e.clockOut)}` : " (open)"}</span>
                      <span className="tabular-nums">{e.clockOut ? `${e.hours}h` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Weekly schedule</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {DAYS.map((d) => {
              const day = days[d.key];
              return (
                <div key={d.key} className="flex items-center gap-2">
                  <label className="flex items-center gap-2 w-28 shrink-0 text-sm">
                    <input type="checkbox" checked={day.working} onChange={(e) => setDay(d.key, { working: e.target.checked })} className="h-4 w-4" />
                    {d.label}
                  </label>
                  <Input type="time" value={day.start} disabled={!day.working} onChange={(e) => setDay(d.key, { start: e.target.value })} className="h-8 flex-1" />
                  <span className="text-muted-foreground text-xs">to</span>
                  <Input type="time" value={day.end} disabled={!day.working} onChange={(e) => setDay(d.key, { end: e.target.value })} className="h-8 flex-1" />
                </div>
              );
            })}
            <Button className="w-full gap-2 mt-2" disabled={!dirty || saveSched.isPending} onClick={() => saveSched.mutate()} data-testid="portal-save-schedule">
              <Save className="w-4 h-4" /> {saveSched.isPending ? "Saving…" : dirty ? "Save schedule" : "Saved"}
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">Bookmark this page — it's your personal link. Don't share it.</p>
      </div>
    </div>
  );
}
