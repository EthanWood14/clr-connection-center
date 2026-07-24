import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronUp,
  Clock3, Copy, Save, Search, UserCheck, UsersRound, XCircle,
} from "lucide-react";

const DAYS = [
  { key: "mon", label: "Monday" }, { key: "tue", label: "Tuesday" }, { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" }, { key: "fri", label: "Friday" }, { key: "sat", label: "Saturday" }, { key: "sun", label: "Sunday" },
] as const;
type Day = { working: boolean; start: string; end: string };
type Who = { type: "lo" | "loa"; id: number; name: string; loName: string | null; checkedIn: boolean };
type RecentCheckin = {
  date: string;
  checkedInAt: string;
  onTime: number | null;
  minutesLate: number | null;
  expectedStart: string | null;
};
type TodayCheckin = Omit<RecentCheckin, "date">;
type Me = {
  date: string;
  timeZone: string;
  timeZoneLabel?: string;
  enabled: boolean;
  graceMin: number;
  today: TodayCheckin | null;
  expectedStart: string | null;
  working: boolean;
  schedule: Record<string, Day> | null;
  recentCheckins: RecentCheckin[];
  lateStats: { count: number; allowance: number; windowDays: number; remaining: number; overLimit: boolean };
};
type RosterResp = {
  date: string;
  timeZone: string;
  timeZoneLabel?: string;
  enabled: boolean;
  roster: Who[];
};

const blankDays = (): Record<string, Day> =>
  Object.fromEntries(DAYS.map((d) => [d.key, { working: d.key !== "sat" && d.key !== "sun", start: "09:00", end: "17:00" }]));

function fmtTime(iso: string, timeZone = "America/Los_Angeles") {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}
function fmtHm(hm: string | null) {
  if (!hm) return "—";
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function addMinutes(hm: string | null, minutes: number) {
  if (!hm) return null;
  const [h, m] = hm.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function fmtDay(date: string, long = false) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: long ? "long" : "short",
    month: long ? "long" : "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function scheduleSummary(days: Record<string, Day>) {
  const working = DAYS.filter((d) => days[d.key]?.working);
  if (!working.length) return "No working days selected";
  const weekdayKeys = working.map((d) => d.key).join(",");
  const first = days[working[0].key];
  const sameHours = working.every((d) => days[d.key].start === first.start && days[d.key].end === first.end);
  if (weekdayKeys === "mon,tue,wed,thu,fri" && sameHours) {
    return `Monday–Friday · ${fmtHm(first.start)}–${fmtHm(first.end)}`;
  }
  return `${working.length} working day${working.length === 1 ? "" : "s"}${sameHours ? ` · ${fmtHm(first.start)}–${fmtHm(first.end)}` : ""}`;
}

export default function Portal() {
  const [, params] = useRoute("/portal/:code");
  const code = params?.code ?? "";
  const rememberKey = `portal.me:${code}`;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [who, setWho] = useState<Who | null>(() => {
    try {
      const raw = localStorage.getItem(rememberKey) ?? localStorage.getItem("portal.me");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "lo" | "loa">("all");
  const [editingSchedule, setEditingSchedule] = useState(false);

  useEffect(() => {
    document.title = "LO / LOA Daily Check-In · WCLCC";
  }, []);

  const rosterQ = useQuery<RosterResp>({
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
    if (!meQ.data || dirty) return;
    const base = blankDays();
    const saved = meQ.data.schedule;
    if (saved) {
      for (const key of Object.keys(base)) {
        if (saved[key]) {
          base[key] = {
            working: !!saved[key].working,
            start: saved[key].start || "09:00",
            end: saved[key].end || "17:00",
          };
        }
      }
    }
    setDays(base);
  }, [meQ.data, dirty]);

  // A remembered person may have been archived or moved to another organization.
  // Recover to the picker instead of leaving the Today card in a permanent load.
  useEffect(() => {
    if (!who || !rosterQ.data) return;
    const current = rosterQ.data.roster.find((r) => r.type === who.type && r.id === who.id);
    if (!current) {
      setWho(null);
      setDays(blankDays());
      setDirty(false);
      setEditingSchedule(false);
      try {
        localStorage.removeItem(rememberKey);
        localStorage.removeItem("portal.me");
      } catch {}
      return;
    }
    if (current.name !== who.name || current.loName !== who.loName || current.checkedIn !== who.checkedIn) {
      setWho(current);
      try { localStorage.setItem(rememberKey, JSON.stringify(current)); } catch {}
    }
  }, [rememberKey, rosterQ.data, who]);

  const pick = (person: Who) => {
    setWho(person);
    setDays(blankDays());
    setDirty(false);
    setEditingSchedule(false);
    try {
      localStorage.setItem(rememberKey, JSON.stringify(person));
      localStorage.removeItem("portal.me");
    } catch {}
  };
  const forget = () => {
    setWho(null);
    setDays(blankDays());
    setDirty(false);
    setEditingSchedule(false);
    try {
      localStorage.removeItem(rememberKey);
      localStorage.removeItem("portal.me");
    } catch {}
  };

  const checkIn = useMutation({
    mutationFn: () => apiRequest("POST", `/api/portal/${code}/checkin`, { type: who!.type, id: who!.id }),
    onSuccess: (result: Me) => {
      qc.setQueryData(["/api/portal", code, "me", who?.type, who?.id], result);
      qc.invalidateQueries({ queryKey: ["/api/portal", code, "roster"] });
      const status = result.today?.onTime;
      toast({
        title: status === 1 ? "Checked in — on time" : status === 0 ? "Checked in" : "Check-in recorded",
        description: status === null ? "No schedule was set, so this check-in is not scored." : undefined,
      });
    },
    onError: (error: any) => toast({ title: "Couldn't check in", description: error?.message, variant: "destructive" }),
  });
  const saveSched = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/portal/${code}/schedule`, { type: who!.type, id: who!.id, days }),
    onSuccess: (result: Me) => {
      qc.setQueryData(["/api/portal", code, "me", who?.type, who?.id], result);
      setDirty(false);
      setEditingSchedule(false);
      toast({ title: "Schedule saved" });
    },
    onError: (error: any) => toast({ title: "Couldn't save schedule", description: error?.message, variant: "destructive" }),
  });

  const setDay = (key: string, patch: Partial<Day>) => {
    setDays((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    setDirty(true);
  };
  const copyMondayToWeekdays = () => {
    setDays((current) => {
      const next = { ...current };
      for (const key of ["tue", "wed", "thu", "fri"]) next[key] = { ...current.mon };
      return next;
    });
    setDirty(true);
  };
  const invalidDay = DAYS.find((d) => days[d.key].working && (!days[d.key].start || !days[d.key].end || days[d.key].end <= days[d.key].start));
  const scheduleError = invalidDay ? `${invalidDay.label}: end time must be after start time.` : null;

  const roster = rosterQ.data?.roster ?? [];
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return roster.filter((r) =>
      (roleFilter === "all" || r.type === roleFilter)
      && (!query || r.name.toLowerCase().includes(query) || (r.loName ?? "").toLowerCase().includes(query)),
    );
  }, [q, roleFilter, roster]);
  const me = meQ.data;
  const timeZone = me?.timeZone ?? rosterQ.data?.timeZone ?? "America/Los_Angeles";
  const timeZoneLabel = me?.timeZoneLabel ?? rosterQ.data?.timeZoneLabel ?? "Pacific Time";
  const currentDate = me?.date;
  const priorCheckins = (me?.recentCheckins ?? []).filter((r) => r.date !== currentDate).slice(0, 5);

  if (!code || rosterQ.isError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <Card className="max-w-sm w-full">
          <CardContent className="py-12 text-center space-y-3">
            <AlertCircle className="w-9 h-9 text-amber-500 mx-auto" />
            <p className="font-semibold">This link isn't valid</p>
            <p className="text-sm text-muted-foreground">Ask your West Capital contact for the current check-in link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-3 sm:p-6">
      <main className="max-w-lg mx-auto space-y-4">
        <header className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-5 py-5 sm:px-6 sm:py-6 shadow-lg text-white">
          <div className="absolute -right-8 -top-10 opacity-[0.07]"><UserCheck className="w-40 h-40" /></div>
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/50">West Capital Lending</p>
              {rosterQ.data?.date && (
                <p className="text-[11px] text-white/55 text-right">{fmtDay(rosterQ.data.date)} · {timeZoneLabel}</p>
              )}
            </div>
            <h1 className="text-2xl font-bold mt-1">LO / LOA Daily Check-In</h1>
            {who ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{who.name}</p>
                  <p className="text-xs text-white/55 truncate">
                    {who.type === "loa" ? `Loan Officer Assistant${who.loName ? ` · Supports ${who.loName}` : ""}` : "Loan Officer"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={forget} className="text-white/75 hover:text-white hover:bg-white/10 shrink-0 h-9 px-2.5">
                  <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Switch
                </Button>
              </div>
            ) : (
              <p className="text-sm text-white/60 mt-1">Find your name, then check in for today.</p>
            )}
          </div>
        </header>

        {rosterQ.data?.enabled === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200" role="status">
            Daily check-ins are currently paused. You can still review or update your weekly schedule.
          </div>
        )}

        {!who ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><UsersRound className="w-4 h-4" /> Who are you?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search your name…"
                  aria-label="Search the LO and LOA roster"
                  className="pl-9 h-11"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" aria-label="Filter by role">
                {([
                  ["all", "Everyone"],
                  ["lo", "LOs"],
                  ["loa", "LOAs"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={roleFilter === value}
                    onClick={() => setRoleFilter(value)}
                    className={`min-h-9 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      roleFilter === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {rosterQ.isLoading ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : (
                <div className="max-h-[56vh] overflow-y-auto divide-y rounded-lg border">
                  {filtered.length === 0 && <p className="p-8 text-sm text-muted-foreground text-center">No matching person found.</p>}
                  {filtered.map((person) => (
                    <button
                      key={`${person.type}-${person.id}`}
                      type="button"
                      onClick={() => pick(person)}
                      className="w-full min-h-14 text-left px-3 py-2.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring flex items-center justify-between gap-3"
                      data-testid={`pick-${person.type}-${person.id}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{person.name}</span>
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {person.type === "loa" ? `Loan Officer Assistant${person.loName ? ` · Supports ${person.loName}` : ""}` : "Loan Officer"}
                        </span>
                      </span>
                      {person.checkedIn ? (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-4 h-4" /> In today
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground shrink-0">Select</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground text-center">Your selection is remembered on this device for faster daily check-ins.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Clock3 className="w-4 h-4" /> Today</span>
                  {me?.date && <span className="text-xs font-normal text-muted-foreground">{fmtDay(me.date, true)}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {meQ.isLoading ? (
                  <Skeleton className="h-28 w-full" />
                ) : meQ.isError || !me ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3" role="alert">
                    <p className="text-sm font-medium text-red-800 dark:text-red-300">We couldn't load your check-in.</p>
                    <p className="text-xs text-muted-foreground mt-1">{(meQ.error as Error)?.message || "Switch back to the roster and try again."}</p>
                    <Button variant="outline" size="sm" onClick={forget} className="mt-3">Back to roster</Button>
                  </div>
                ) : me.today ? (
                  <div
                    aria-live="polite"
                    className={`rounded-xl border px-4 py-4 ${
                      me.today.onTime === 1
                        ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800"
                        : me.today.onTime === 0
                        ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800"
                        : "border-slate-300 bg-slate-50 dark:bg-slate-900/50 dark:border-slate-700"
                    }`}
                  >
                    <div className={`flex items-center gap-2 text-sm font-semibold ${
                      me.today.onTime === 1
                        ? "text-emerald-800 dark:text-emerald-300"
                        : me.today.onTime === 0
                        ? "text-amber-800 dark:text-amber-300"
                        : "text-slate-800 dark:text-slate-200"
                    }`}>
                      {me.today.onTime === 1 ? <CheckCircle2 className="w-5 h-5" /> : me.today.onTime === 0 ? <XCircle className="w-5 h-5" /> : <UserCheck className="w-5 h-5" />}
                      Checked in at {fmtTime(me.today.checkedInAt, timeZone)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 pl-7">
                      {me.today.onTime === 1
                        ? `On time for your ${fmtHm(me.today.expectedStart)} start`
                        : me.today.onTime === 0
                        ? `${me.today.minutesLate ?? 0} min after your ${fmtHm(me.today.expectedStart)} start`
                        : "Recorded, not scored — no scheduled start was on file"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      {me.working && me.expectedStart ? (
                        <>
                          <p className="text-sm text-muted-foreground">Scheduled start</p>
                          <p className="text-2xl font-bold mt-0.5">{fmtHm(me.expectedStart)}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {me.graceMin > 0 ? `On time through ${fmtHm(addMinutes(me.expectedStart, me.graceMin))} · ${timeZoneLabel}` : timeZoneLabel}
                          </p>
                        </>
                      ) : me.schedule && !me.working ? (
                        <>
                          <p className="text-lg font-semibold">You're scheduled off today</p>
                          <p className="text-sm text-muted-foreground mt-1">If you're working anyway, you can still record a check-in. It won't be scored late.</p>
                        </>
                      ) : (
                        <>
                          <p className="text-lg font-semibold">No schedule on file</p>
                          <p className="text-sm text-muted-foreground mt-1">You can check in now. It will be recorded without an on-time or late score.</p>
                        </>
                      )}
                    </div>
                    <Button
                      className="w-full gap-2 h-12 text-base"
                      disabled={!me.enabled || checkIn.isPending}
                      onClick={() => checkIn.mutate()}
                      data-testid="portal-check-in"
                    >
                      <UserCheck className="w-5 h-5" />
                      {checkIn.isPending ? "Checking in…" : me.working ? "Check in for today" : "Check in anyway"}
                    </Button>
                    {checkIn.isError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-xs text-red-800 dark:text-red-300" role="alert">
                        {(checkIn.error as Error)?.message || "The check-in did not go through. Please try again."}
                      </div>
                    )}
                  </>
                )}

                {me?.lateStats && (
                  <div className="border-t pt-3 flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Late standing · last {me.lateStats.windowDays} days</span>
                    <Badge
                      variant="outline"
                      className={me.lateStats.count >= me.lateStats.allowance
                        ? "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
                        : me.lateStats.count > 0
                        ? "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                        : "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"}
                    >
                      {me.lateStats.count} of {me.lateStats.allowance}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {me && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Weekly schedule</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{me.schedule ? scheduleSummary(days) : "No schedule saved yet"}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingSchedule((open) => !open)}
                      className="h-9 gap-1 shrink-0"
                      aria-expanded={editingSchedule}
                      aria-controls="portal-weekly-schedule-editor"
                    >
                      {editingSchedule ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {editingSchedule ? "Close" : "Edit"}
                    </Button>
                  </div>
                </CardHeader>
                {editingSchedule && (
                  <CardContent id="portal-weekly-schedule-editor" className="space-y-3">
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Set your normal recurring hours.</p>
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1" onClick={copyMondayToWeekdays}>
                        <Copy className="w-3.5 h-3.5" /> Copy Monday
                      </Button>
                    </div>
                    {DAYS.map((dayDef) => {
                      const day = days[dayDef.key];
                      return (
                        <fieldset key={dayDef.key} className="rounded-lg border p-3">
                          <legend className="sr-only">{dayDef.label}</legend>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium" aria-hidden="true">{dayDef.label}</span>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground min-h-8">
                              <input
                                type="checkbox"
                                checked={day.working}
                                onChange={(e) => setDay(dayDef.key, { working: e.target.checked })}
                                className="h-4 w-4"
                              />
                              {day.working ? "Working" : "Off"}
                            </label>
                          </div>
                          {day.working && (
                            <div className="grid grid-cols-2 gap-3 mt-3">
                              <label className="text-[11px] font-medium text-muted-foreground">
                                Start
                                <Input
                                  type="time"
                                  value={day.start}
                                  onChange={(e) => setDay(dayDef.key, { start: e.target.value })}
                                  className="h-10 mt-1 text-sm"
                                />
                              </label>
                              <label className="text-[11px] font-medium text-muted-foreground">
                                End
                                <Input
                                  type="time"
                                  value={day.end}
                                  onChange={(e) => setDay(dayDef.key, { end: e.target.value })}
                                  className="h-10 mt-1 text-sm"
                                />
                              </label>
                            </div>
                          )}
                        </fieldset>
                      );
                    })}
                    {scheduleError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-xs text-red-800 dark:text-red-300" role="alert">
                        {scheduleError}
                      </div>
                    )}
                    {saveSched.isError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 text-xs text-red-800 dark:text-red-300" role="alert">
                        {(saveSched.error as Error)?.message || "The schedule did not save. Please try again."}
                      </div>
                    )}
                    <Button
                      className="w-full gap-2 h-11"
                      disabled={(!!me.schedule && !dirty) || !!scheduleError || saveSched.isPending}
                      onClick={() => saveSched.mutate()}
                      data-testid="portal-save-schedule"
                    >
                      <Save className="w-4 h-4" /> {saveSched.isPending ? "Saving…" : dirty || !me.schedule ? "Save schedule" : "Schedule saved"}
                    </Button>
                  </CardContent>
                )}
              </Card>
            )}

            {priorCheckins.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Recent check-ins</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {priorCheckins.map((row) => (
                      <div key={row.date} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{fmtDay(row.date)}</p>
                          <p className="text-xs text-muted-foreground">In at {fmtTime(row.checkedInAt, timeZone)}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={row.onTime === 1
                            ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                            : row.onTime === 0
                            ? "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
                            : "text-muted-foreground"}
                        >
                          {row.onTime === 1 ? "On time" : row.onTime === 0 ? `${row.minutesLate ?? 0} min late` : "Not scored"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <footer className="pb-4 text-center text-[11px] text-muted-foreground">
          One arrival check-in per day · Times are scored in {timeZoneLabel}
        </footer>
      </main>
    </div>
  );
}
