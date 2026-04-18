import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowUpRight, TrendingUp, Users, PhoneCall, Calendar, XCircle,
  RefreshCw, Trophy, MapPin, Search, Copy, Phone, Mail, User,
  ChevronRight, CalendarClock, Clock, CheckCircle2, Pencil,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line, CartesianGrid,
} from "recharts";
import { Link } from "wouter";
import { formatDistanceToNow, parseISO, isToday, isPast, format } from "date-fns";

// ── Constants ─────────────────────────────────────────────────────────────────
const COLORS = ["#01696f","#437a22","#964219","#a12c7b","#006494","#d19900","#7a39bb","#da7101","#a13544"];
const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer", appointment: "Appointment", fell_through: "Fell Through",
  no_answer: "No Answer", callback_requested: "Callback",
  not_interested: "Not Interested", wrong_number: "Wrong Number", other: "Other",
};
const OUTCOME_COLORS: Record<string, string> = {
  transfer: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  appointment: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  fell_through: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  callback_requested: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};
const TIER_LABELS: Record<number, string> = { 1: "VIP", 2: "Standard", 3: "Low" };
const TIER_COLORS: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};
const ALL_STATES: { abbr: string; name: string }[] = [
  { abbr:"AL", name:"Alabama" },{ abbr:"AK", name:"Alaska" },{ abbr:"AZ", name:"Arizona" },
  { abbr:"AR", name:"Arkansas" },{ abbr:"CA", name:"California" },{ abbr:"CO", name:"Colorado" },
  { abbr:"CT", name:"Connecticut" },{ abbr:"DE", name:"Delaware" },{ abbr:"FL", name:"Florida" },
  { abbr:"GA", name:"Georgia" },{ abbr:"HI", name:"Hawaii" },{ abbr:"ID", name:"Idaho" },
  { abbr:"IL", name:"Illinois" },{ abbr:"IN", name:"Indiana" },{ abbr:"IA", name:"Iowa" },
  { abbr:"KS", name:"Kansas" },{ abbr:"KY", name:"Kentucky" },{ abbr:"LA", name:"Louisiana" },
  { abbr:"ME", name:"Maine" },{ abbr:"MD", name:"Maryland" },{ abbr:"MA", name:"Massachusetts" },
  { abbr:"MI", name:"Michigan" },{ abbr:"MN", name:"Minnesota" },{ abbr:"MS", name:"Mississippi" },
  { abbr:"MO", name:"Missouri" },{ abbr:"MT", name:"Montana" },{ abbr:"NE", name:"Nebraska" },
  { abbr:"NV", name:"Nevada" },{ abbr:"NH", name:"New Hampshire" },{ abbr:"NJ", name:"New Jersey" },
  { abbr:"NM", name:"New Mexico" },{ abbr:"NY", name:"New York" },{ abbr:"NC", name:"North Carolina" },
  { abbr:"ND", name:"North Dakota" },{ abbr:"OH", name:"Ohio" },{ abbr:"OK", name:"Oklahoma" },
  { abbr:"OR", name:"Oregon" },{ abbr:"PA", name:"Pennsylvania" },{ abbr:"RI", name:"Rhode Island" },
  { abbr:"SC", name:"South Carolina" },{ abbr:"SD", name:"South Dakota" },{ abbr:"TN", name:"Tennessee" },
  { abbr:"TX", name:"Texas" },{ abbr:"UT", name:"Utah" },{ abbr:"VT", name:"Vermont" },
  { abbr:"VA", name:"Virginia" },{ abbr:"WA", name:"Washington" },{ abbr:"WV", name:"West Virginia" },
  { abbr:"WI", name:"Wisconsin" },{ abbr:"WY", name:"Wyoming" },{ abbr:"DC", name:"Washington D.C." },
];

// ── Shared helpers ────────────────────────────────────────────────────────────
function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
      onClick={() => { navigator.clipboard.writeText(value).then(() => { setCopied(true); toast({ title: `${label} copied` }); setTimeout(() => setCopied(false), 1500); }); }}>
      <Copy className={`w-3 h-3 ${copied ? "text-green-500" : ""}`} />
    </Button>
  );
}

// ── Call Entry Widget ────────────────────────────────────────────────────────
function CallEntryWidget() {
  const { user } = useAuth();
  const { toast } = useToast();
  const todayStr = new Date().toISOString().split("T")[0];
  const [editing, setEditing] = useState(false);
  const [callInput, setCallInput] = useState("");

  const { data: logsToday = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/call-logs", todayStr],
    queryFn: () => fetch(`/api/call-logs?date=${todayStr}`).then(r => r.json()),
  });

  const myLog = (logsToday as any[]).find((l: any) => l.assistantId === user?.id || l.assistant_id === user?.id);
  const myCallsToday = myLog?.callsMade ?? myLog?.calls_made ?? null;

  const logMutation = useMutation({
    mutationFn: (calls: number) =>
      apiRequest("POST", "/api/call-logs", { logDate: todayStr, assistantId: user?.id, callsMade: calls }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      refetch();
      setEditing(false);
      toast({ title: "Call count saved", description: `${callInput} calls logged for today.` });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  function handleSubmit() {
    const n = parseInt(callInput, 10);
    if (isNaN(n) || n < 0) { toast({ title: "Enter a valid number", variant: "destructive" }); return; }
    logMutation.mutate(n);
  }

  const isLogged = myCallsToday !== null;

  return (
    <Card className={`border-dashed ${isLogged ? "border-green-300 bg-green-50/40 dark:bg-green-900/10" : "border-orange-300 bg-orange-50/40 dark:bg-orange-900/10"}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isLogged ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"}`}>
              <PhoneCall className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">My Calls Today</p>
              <p className="text-xs text-muted-foreground">
                {isLogged ? (
                  <span className="font-medium text-green-700 dark:text-green-400">{myCallsToday} calls logged — update anytime before EOD</span>
                ) : (
                  <span className="font-medium text-orange-600 dark:text-orange-400">Log your total calls at the end of the day</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Input
                  type="number"
                  min={0}
                  placeholder="e.g. 42"
                  value={callInput}
                  onChange={e => setCallInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSubmit(); if (e.key === "Escape") setEditing(false); }}
                  className="w-28 h-8 text-sm"
                  autoFocus
                />
                <Button size="sm" className="h-8" onClick={handleSubmit} disabled={logMutation.isPending}>
                  {logMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)}>Cancel</Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => { setCallInput(myCallsToday !== null ? String(myCallsToday) : ""); setEditing(true); }}
              >
                <Pencil className="w-3.5 h-3.5" />
                {isLogged ? "Update" : "Log Calls"}
              </Button>
            )}
            <Link href="/eod-report">
              <Button size="sm" variant={isLogged ? "outline" : "default"} className="h-8 gap-1.5">
                <CalendarClock className="w-3.5 h-3.5" />
                EOD Reporting
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, icon: Icon, sub, color = "primary", href }: any) {
  const inner = (
    <Card className={`h-full ${href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}>
      <CardContent className="pt-5 pb-5 h-full">
        <div className="flex items-start justify-between h-full">
          <div className="flex flex-col justify-between h-full">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold text-foreground my-2">{value ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{sub ?? "\u00a0"}</p>
          </div>
          <div className={`p-2 rounded-lg shrink-0 ${color === "primary" ? "bg-primary/10 text-primary" : color === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400" : color === "warning" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400" : "bg-muted text-muted-foreground"}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href} className="block h-full">{inner}</Link>;
  return inner;
}

// ── Tab: Daily Assignments ────────────────────────────────────────────────────
function TabAssignments({ todayAssignments, generateAssignments, losData }: any) {
  const staleThreshold = 7;
  const staleLOs = (losData ?? []).filter((lo: any) => {
    if (!lo.lastWorkedDate || lo.internalStatus !== "active") return false;
    return Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86400000) >= staleThreshold;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Today's list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Today's Assignments</CardTitle>
            <Button size="sm" variant="outline" onClick={() => generateAssignments.mutate()} disabled={generateAssignments.isPending}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${generateAssignments.isPending ? "animate-spin" : ""}`} />
              Generate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {todayAssignments.length === 0 ? (
            <div className="text-sm text-muted-foreground py-10 text-center">
              No assignments yet — click Generate to create today's list.
            </div>
          ) : (
            <div className="space-y-1">
              {todayAssignments.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 border-b last:border-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-mono text-muted-foreground w-5 text-right">#{a.globalRank}</span>
                    <span className="text-sm font-medium">{a.lo?.fullName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:block">{a.assistant?.name}</span>
                    <Badge variant={a.status === "worked" ? "default" : a.status === "skipped" ? "destructive" : "secondary"} className="text-xs capitalize">
                      {a.status}
                    </Badge>
                  </div>
                </div>
              ))}
              <div className="pt-2">
                <Link href="/assignments" className="text-xs text-primary hover:underline">View full assignments page →</Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stale LOs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" /> LOs Not Worked Recently
            {staleLOs.length > 0 && <Badge variant="destructive" className="text-xs">{staleLOs.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {staleLOs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-10 text-center">All active LOs worked in the last 7 days 🎉</div>
          ) : (
            <div className="space-y-1">
              {staleLOs.map((lo: any) => {
                const days = lo.lastWorkedDate ? Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86400000) : null;
                return (
                  <div key={lo.id} className="flex items-center justify-between py-2.5 border-b last:border-0">
                    <span className="text-sm font-medium">{lo.fullName}</span>
                    <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                      {days !== null ? `${days}d ago` : "Never worked"}
                    </Badge>
                  </div>
                );
              })}
              <div className="pt-2">
                <Link href="/directory" className="text-xs text-primary hover:underline">View full directory →</Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Weekly Stats ─────────────────────────────────────────────────────────
function TabWeeklyStats({ stats, leaderboardData, losData }: any) {
  const { data: history } = useQuery<any>({ queryKey: ["/api/analytics/history?periods=6"] });
  const periods = history?.periods ?? [];
  const leaderboard = leaderboardData?.leaderboard ?? [];
  const pieData = stats?.outcomesByType
    ? Object.entries(stats.outcomesByType).map(([key, val]) => ({ name: OUTCOME_LABELS[key] || key, value: val as number }))
    : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outcome breakdown pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Outcome Breakdown — This Period</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Team leaderboard bar */}
        <Link href="/leaderboard">
          <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" /> Team Stats
                </CardTitle>
                <Badge variant="outline" className="text-xs">This Period</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">No activity logged yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={leaderboard.slice(0, 5)} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip />
                    <Bar dataKey="transfers" fill="#01696f" radius={[0, 4, 4, 0]} name="Transfers" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Historical trend */}
      {periods.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Transfer Volume — Last 6 Periods</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={periods} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#01696f" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#01696f" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="transfers" stroke="#01696f" fill="url(#tGrad)" strokeWidth={2} name="Transfers" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Conversion Rate Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={periods} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <Line type="monotone" dataKey="convRate" stroke="#1A2B4A" strokeWidth={2} dot={{ r: 3 }} name="Conv. Rate" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="text-right">
        <Link href="/leaderboard" className="text-xs text-primary hover:underline">Full analytics & individual CLR stats →</Link>
      </div>
    </div>
  );
}

// ── Tab: Upcoming Appointments ────────────────────────────────────────────────
function TabAppointments() {
  const { data: outcomes = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/outcomes"] });
  const { data: losData = [] } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });
  const [search, setSearch] = useState("");

  // Only keep future appointments: today OR not yet past
  const appointments = useMemo(() =>
    outcomes.filter((o: any) => {
      const d = o.followUpDate || o.follow_up_date;
      if (!d) return false;
      const parsed = parseISO(d);
      return isToday(parsed) || !isPast(parsed);
    }),
    [outcomes]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return appointments.filter((o: any) =>
      !q ||
      (o.borrowerName || o.borrower_name || "").toLowerCase().includes(q) ||
      (o.notes || "").toLowerCase().includes(q)
    );
  }, [appointments, search]);

  const getLoName = (loId: number) => losData.find((l: any) => l.id === loId)?.fullName ?? `LO #${loId}`;

  const today_ = filtered.filter((o: any) => isToday(parseISO(o.followUpDate || o.follow_up_date)));
  const upcoming = filtered.filter((o: any) => !isToday(parseISO(o.followUpDate || o.follow_up_date)));

  function ApptRow({ o }: { o: any }) {
    const fDate = o.followUpDate || o.follow_up_date;
    const label = fDate ? formatDistanceToNow(parseISO(fDate), { addSuffix: true }) : "";
    const exact = fDate ? format(parseISO(fDate), "MMM d, yyyy") : "";
    const isTd = fDate && isToday(parseISO(fDate));
    return (
      <div className="flex items-start justify-between py-2.5 border-b last:border-0 gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{o.borrowerName || o.borrower_name || "Unknown borrower"}</span>
            <Badge variant="outline" className={`text-xs ${OUTCOME_COLORS[o.outcomeType || o.outcome_type] ?? ""}`}>
              {OUTCOME_LABELS[o.outcomeType || o.outcome_type] ?? o.outcomeType ?? o.outcome_type}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{getLoName(o.loId || o.lo_id)}</p>
          {o.notes && <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{o.notes}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-xs font-medium ${isTd ? "text-green-600" : "text-muted-foreground"}`}>{label}</p>
          <p className="text-xs text-muted-foreground">{exact}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Upcoming Appointments</h2>
          <p className="text-xs text-muted-foreground">Showing today and future scheduled appointments only</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search appointments..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 w-64" />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground"><CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>No upcoming appointments scheduled.</p></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-green-200 dark:border-green-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4" /> Today
                <Badge className="text-xs bg-green-600">{today_.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {today_.length === 0
                ? <p className="text-xs text-muted-foreground py-4 text-center">Nothing scheduled today</p>
                : today_.map(o => <ApptRow key={o.id} o={o} />)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4" /> Coming Up
                <Badge variant="outline" className="text-xs">{upcoming.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0
                ? <p className="text-xs text-muted-foreground py-4 text-center">No future appointments yet</p>
                : upcoming.map(o => <ApptRow key={o.id} o={o} />)}
            </CardContent>
          </Card>
        </div>
      )}
      <div className="text-right">
        <Link href="/appointments" className="text-xs text-primary hover:underline">Manage all appointments →</Link>
      </div>
    </div>
  );
}

// ── Tab: State Lookups ────────────────────────────────────────────────────────
function TabStateLookup() {
  const [stateSearch, setStateSearch] = useState("");
  const [selectedState, setSelectedState] = useState<{ abbr: string; name: string } | null>(null);
  const { data: allLOs = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const filteredStates = useMemo(() => {
    const q = stateSearch.toLowerCase();
    return ALL_STATES.filter(s => s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q));
  }, [stateSearch]);

  const coverageMap = useMemo(() => {
    const map: Record<string, number> = {};
    allLOs.forEach((lo: any) => {
      try { JSON.parse(lo.licensedStates || "[]").forEach((s: string) => { const a = s.trim().toUpperCase(); map[a] = (map[a] || 0) + 1; }); } catch {}
    });
    return map;
  }, [allLOs]);

  const licensedLOs = useMemo(() => {
    if (!selectedState) return [];
    return allLOs.filter((lo: any) => {
      try { return JSON.parse(lo.licensedStates || "[]").some((s: string) => s.trim().toUpperCase() === selectedState.abbr); } catch { return false; }
    });
  }, [allLOs, selectedState]);

  function coverageColor(count: number) {
    if (count === 0) return "bg-muted text-muted-foreground border border-border";
    if (count === 1) return "bg-primary/10 text-primary border border-primary/20";
    if (count <= 3) return "bg-primary/25 text-primary border border-primary/30";
    return "bg-primary/50 text-primary-foreground border border-primary/60";
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
      {/* State list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search state..." value={stateSearch} onChange={e => setStateSearch(e.target.value)} className="pl-8" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[480px] overflow-y-auto">
            {filteredStates.map(state => {
              const count = coverageMap[state.abbr] || 0;
              const isSelected = selectedState?.abbr === state.abbr;
              return (
                <button key={state.abbr} onClick={() => setSelectedState(state)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 border-b last:border-0 ${isSelected ? "bg-primary/8 font-semibold" : ""}`}>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs text-muted-foreground w-6">{state.abbr}</span>
                    <span>{state.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {count > 0 && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${coverageColor(count)}`}>{count}</span>}
                    {isSelected && <ChevronRight className="w-3.5 h-3.5 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* LO results */}
      <div>
        {!selectedState ? (
          <Card><CardContent className="py-16 text-center"><MapPin className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" /><p className="text-sm text-muted-foreground">Select a state to see licensed LOs</p></CardContent></Card>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">{selectedState.name}</h2>
                <p className="text-sm text-muted-foreground">{isLoading ? "Loading..." : licensedLOs.length === 0 ? "No LOs licensed here" : `${licensedLOs.length} LO${licensedLOs.length !== 1 ? "s" : ""} licensed`}</p>
              </div>
              <Badge variant="outline" className="font-mono text-base px-3 py-1">{selectedState.abbr}</Badge>
            </div>
            {isLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
            ) : licensedLOs.length === 0 ? (
              <Card><CardContent className="py-10 text-center"><User className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" /><p className="text-sm text-muted-foreground">No LOs licensed in {selectedState.name}.</p><p className="text-xs text-muted-foreground/60 mt-1">Update an LO's states in the Directory.</p></CardContent></Card>
            ) : (
              licensedLOs.sort((a: any, b: any) => a.priorityTier - b.priorityTier).map((lo: any) => (
                <Card key={lo.id} className={lo.internalStatus !== "active" ? "opacity-60" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="font-semibold text-sm">{lo.fullName}</span>
                      <Badge className={`text-xs ${TIER_COLORS[lo.priorityTier]}`}>{TIER_LABELS[lo.priorityTier]}</Badge>
                      {lo.internalStatus !== "active" && <Badge variant="outline" className="text-xs capitalize text-muted-foreground">{lo.internalStatus}</Badge>}
                    </div>
                    {lo.nmlsId && <p className="text-xs text-muted-foreground mb-2">NMLS #{lo.nmlsId}</p>}
                    <div className="space-y-1">
                      {lo.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-muted-foreground" /><span className="font-mono text-xs">{lo.phone}</span><CopyButton value={lo.phone} label="Phone" /></div>}
                      {lo.email && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs truncate">{lo.email}</span><CopyButton value={lo.email} label="Email" /></div>}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
            <div className="text-right pt-1">
              <Link href="/state-lookup" className="text-xs text-primary hover:underline">Full state lookup page →</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: leaderboardData } = useQuery<any>({ queryKey: ["/api/leaderboard"] });
  const { data: losData } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const generateAssignments = useMutation({
    mutationFn: () => apiRequest("POST", "/api/assignments/generate", { date: new Date().toISOString().split("T")[0] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/assignments"] }),
  });

  const todayDate = new Date().toISOString().split("T")[0];
  const { data: todayAssignments = [] } = useQuery<any[]>({ queryKey: [`/api/assignments?date=${todayDate}`] });

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {stats?.startDate && stats?.endDate ? `${stats.startDate} — ${stats.endDate}` : "Current period"}
          </p>
        </div>
      </div>

      {/* KPI Row — always visible */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[100px]" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard title="Transfers" value={stats?.transfers} icon={ArrowUpRight} color="success" sub="this period" href="/outcomes" />
            <StatCard title="Upcoming Appts" value={stats?.upcomingAppointments ?? 0} icon={Calendar} color="primary" sub="scheduled ahead" href="/appointments" />
            <StatCard title="My Calls Today" value={stats?.myCallsToday ?? "—"} icon={PhoneCall} color="default" sub={stats?.myCallsToday != null ? "logged at EOD" : "log at end of day"} href="/eod-report" />
            <StatCard title="Fell Through" value={stats?.fellThrough} icon={XCircle} color="warning" sub="this period" href="/outcomes" />
            <StatCard title="Transfer/Call %" value={stats?.callTransferRatio != null ? `${stats.callTransferRatio}%` : "—"} icon={TrendingUp} color="success" sub={stats?.callTransferRatio != null ? `${stats.transfers} xfers / ${stats.totalCallsToday} calls (team)` : "log calls to see ratio"} />
            <StatCard title="Active LOs" value={(losData ?? []).filter((l: any) => l.internalStatus === "active").length} icon={Users} color="primary" sub="available to assign" href="/directory" />
          </div>
          <CallEntryWidget />
        </>
      )}

      {/* Tabs */}
      <Tabs defaultValue="assignments">
        <TabsList className="w-full sm:w-auto grid grid-cols-4 sm:inline-flex">
          <TabsTrigger value="assignments" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Daily </span>Assignments
          </TabsTrigger>
          <TabsTrigger value="stats" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Weekly </span>Stats
          </TabsTrigger>
          <TabsTrigger value="appointments" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Calendar className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Upcoming </span>Appts
          </TabsTrigger>
          <TabsTrigger value="states" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <MapPin className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">State </span>Lookup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="mt-4">
          <TabAssignments todayAssignments={todayAssignments} generateAssignments={generateAssignments} losData={losData} />
        </TabsContent>
        <TabsContent value="stats" className="mt-4">
          <TabWeeklyStats stats={stats} leaderboardData={leaderboardData} losData={losData} />
        </TabsContent>
        <TabsContent value="appointments" className="mt-4">
          <TabAppointments />
        </TabsContent>
        <TabsContent value="states" className="mt-4">
          <TabStateLookup />
        </TabsContent>
      </Tabs>
    </div>
  );
}
