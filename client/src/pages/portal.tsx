import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCheck, CalendarDays, CheckCircle2, Search, ArrowLeft, Save, XCircle } from "lucide-react";

const DAYS = [
  { key: "mon", label: "Monday" }, { key: "tue", label: "Tuesday" }, { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" }, { key: "fri", label: "Friday" }, { key: "sat", label: "Saturday" }, { key: "sun", label: "Sunday" },
];
type Day = { working: boolean; start: string; end: string };
type Who = { type: "lo" | "loa"; id: number; name: string; loName: string | null; checkedIn: boolean };
type Me = {
  date: string;
  today: { checkedInAt: string; onTime: number | null; minutesLate: number | null; expectedStart: string | null } | null;
  expectedStart: string | null; working: boolean; schedule: Record<string, Day> | null;
};

const blankDays = (): Record<string, Day> =>
  Object.fromEntries(DAYS.map((d) => [d.key, { working: d.key !== "sat" && d.key !== "sun", start: "09:00", end: "17:00" }]));
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtHm = (hm: string | null) => {
  if (!hm) return "—";
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const REMEMBER = "portal.me";

export default function Portal() {
  const [, params] = useRoute("/portal/:code");
  const code = params?.code ?? "";
  const qc = useQueryClient();
  const [who, setWho] = useState<Who | null>(() => {
    try { const r = localStorage.getItem(REMEMBER); return r ? JSON.parse(r) : null; } catch { return null; }
  });
  const [q, setQ] = useState("");

  const rosterQ = useQuery<{ date: string; roster: Who[] }>({
    queryKey: ["/api/portal", code, "roster"],
    queryFn: () => apiRequest("GET", `/api/portal/${code}/roster`),
    enabled: !!code,
    retry: false,
  });
  const meQ = useQuery<Me>({
    queryKey: ["/api/portal", code, "me", who?.type, who?.id],
    queryFn: () => apiRequest("GET", `/api/portal/${code}/me?type=${who!.type}&id=${who!.id}`),
    enabled: !!code && !!who,
    retry: false,
  });

  const [days, setDays] = useState<Record<string, Day>>(blankDays());
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (meQ.data && !dirty) {
      const base = blankDays();
      const s = meQ.data.schedule;
      if (s) for (const k of Object.keys(base)) if (s[k]) base[k] = { working: !!s[k].working, start: s[k].start || "09:00", end: s[k].end || "17:00" };
      setDays(base);
    }
  }, [meQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (w: Who) => {
    setWho(w); setDirty(false);
    try { localStorage.setItem(REMEMBER, JSON.stringify(w)); } catch {}
  };
  const forget = () => { setWho(null); setDirty(false); try { localStorage.removeItem(REMEMBER); } catch {} };

  const checkIn = useMutation({
    mutationFn: () => apiRequest("POST", `/api/portal/${code}/checkin`, { type: who!.type, id: who!.id }),
    onSuccess: (r: any) => {
      qc.setQueryData(["/api/portal", code, "me", who?.type, who?.id], r);
      qc.invalidateQueries({ queryKey: ["/api/portal", code, "roster"] });
    },
  });
  const saveSched = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/portal/${code}/schedule`, { type: who!.type, id: who!.id, days }),
    onSuccess: (r: any) => { qc.setQueryData(["/api/portal", code, "me", who?.type, who?.id], r); setDirty(false); },
  });
  const setDay = (k: string, patch: Partial<Day>) => { setDays((d) => ({ ...d, [k]: { ...d[k], ...patch } })); setDirty(true); };

  if (!code || rosterQ.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <Card className="max-w-sm w-full"><CardContent className="py-12 text-center space-y-2">
          <p className="font-semibold">This link isn't valid</p>
          <p className="text-sm text-muted-foreground">Ask your West Capital contact for the current check-in link.</p>
        </CardContent></Card>
      </div>
    );
  }

  const roster = rosterQ.data?.roster ?? [];
  const filtered = roster.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.toLowerCase()) || (r.loName ?? "").toLowerCase().includes(q.toLowerCase()));
  const me = meQ.data;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-md mx-auto space-y-4">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg text-white">
          <p className="text-xs uppercase tracking-widest text-white/50">West Capital Lending</p>
          <h1 className="text-2xl font-bold mt-1">Daily Check-In</h1>
          {who ? (
            <button onClick={forget} className="text-sm text-white/60 hover:text-white mt-1 flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> {who.name}{who.loName ? ` — ${who.loName}` : ""} (not you?)
            </button>
          ) : (
            <p className="text-sm text-white/60">Find your name to check in for today.</p>
          )}
        </div>

        {/* Pick who you are */}
        {!who ? (
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your name…" className="pl-8" autoFocus />
              </div>
              {rosterQ.isLoading ? (
                <div className="space-y-1">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto divide-y rounded-md border">
                  {filtered.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">No match.</p>}
                  {filtered.map((r) => (
                    <button key={`${r.type}-${r.id}`} onClick={() => pick(r)}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted flex items-center justify-between gap-2"
                      data-testid={`pick-${r.type}-${r.id}`}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{r.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{r.type === "loa" ? `Assistant${r.loName ? ` — ${r.loName}` : ""}` : "Loan Officer"}</span>
                      </span>
                      {r.checkedIn && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Check in */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><UserCheck className="w-4 h-4" /> Today</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {meQ.isLoading || !me ? (
                  <Skeleton className="h-16 w-full" />
                ) : me.today ? (
                  <div className={`rounded-lg border px-4 py-3 ${me.today.onTime === 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800" : "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800"}`}>
                    <div className={`flex items-center gap-2 text-sm font-medium ${me.today.onTime === 0 ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300"}`}>
                      {me.today.onTime === 0 ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      Checked in at {fmtTime(me.today.checkedInAt)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {me.today.expectedStart
                        ? me.today.onTime === 0
                          ? `${me.today.minutesLate} min past your ${fmtHm(me.today.expectedStart)} start`
                          : `On time — start ${fmtHm(me.today.expectedStart)}`
                        : "Recorded (no schedule set, so it isn't scored)"}
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {me.working && me.expectedStart
                        ? <>Your start today is <strong className="text-foreground">{fmtHm(me.expectedStart)}</strong>.</>
                        : me.schedule && !me.working
                        ? "You're not scheduled today — check in anyway if you're working."
                        : "Set your schedule below so your check-in can be scored on time."}
                    </p>
                    <Button className="w-full gap-2 h-12 text-base" disabled={checkIn.isPending} onClick={() => checkIn.mutate()} data-testid="portal-check-in">
                      <UserCheck className="w-5 h-5" /> {checkIn.isPending ? "…" : "Check in"}
                    </Button>
                  </>
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
          </>
        )}
      </div>
    </div>
  );
}
