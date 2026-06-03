import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { CalendarOff, Check, X, Clock, Trash2, Plane, Construction, CalendarDays } from "lucide-react";

interface TimeOffRequest {
  id: number;
  userId: number;
  userName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  reviewedBy: number | null;
  reviewerName: string | null;
  reviewerNote: string;
  createdAt: string | null;
  reviewedAt: string | null;
}

function fmtDate(d: string) {
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}

function dayCount(start: string, end: string) {
  try {
    const a = new Date(start + "T12:00:00").getTime();
    const b = new Date(end + "T12:00:00").getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  } catch { return 1; }
}

function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}
function ymdToDate(s: string) {
  return new Date(s + "T12:00:00");
}
// Quick presets that return a [start, end] YMD pair.
const DATE_PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Today", range: () => { const d = new Date(); const s = toYmd(d); return [s, s]; } },
  { label: "Tomorrow", range: () => { const d = new Date(); d.setDate(d.getDate() + 1); const s = toYmd(d); return [s, s]; } },
  { label: "This Friday", range: () => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); const s = toYmd(d); return [s, s]; } },
  { label: "Next Mon–Fri", range: () => { const d = new Date(); const mon = new Date(d); mon.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); const fri = new Date(mon); fri.setDate(mon.getDate() + 4); return [toYmd(mon), toYmd(fri)]; } },
];

function StatusBadge({ status }: { status: TimeOffRequest["status"] }) {
  const map: Record<TimeOffRequest["status"], { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
    denied: { label: "Denied", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
  };
  const cfg = map[status] ?? map.pending;
  return <Badge className={"text-xs px-2 py-0.5 " + cfg.cls}>{cfg.label}</Badge>;
}

const REASON_CHIPS: { label: string; emoji: string }[] = [
  { label: "Vacation", emoji: "🏖️" },
  { label: "Appointment", emoji: "🩺" },
  { label: "Personal day", emoji: "🌿" },
  { label: "Family time", emoji: "👨‍👩‍👧" },
  { label: "Feeling sick", emoji: "🤒" },
  { label: "Travel", emoji: "✈️" },
];

function vibe(days: number): string {
  if (days <= 0) return "";
  if (days === 1) return "A quick breather 😎";
  if (days <= 3) return "Nice little break! 🌿";
  if (days <= 7) return "Now this is a real recharge 🏖️";
  if (days <= 14) return "Big adventure incoming ✈️";
  return "Epic escape mode — go enjoy it! 🌴🚀";
}

function Confetti({ show }: { show: boolean }) {
  if (!show) return null;
  const pieces = ["🎉", "🎊", "🌴", "🏖️", "✈️", "😎", "🥳", "⛱️", "🍹", "🌞"];
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      <style>{`@keyframes toff-fall{0%{transform:translateY(-12vh) rotate(0deg);opacity:1}100%{transform:translateY(112vh) rotate(680deg);opacity:0}}`}</style>
      {Array.from({ length: 40 }).map((_, i) => {
        const left = (i * 2.5) % 100;
        const delay = (i % 12) * 0.1;
        const dur = 2.4 + (i % 6) * 0.35;
        const size = 16 + (i % 4) * 7;
        return (
          <span
            key={i}
            style={{ position: "absolute", left: left + "%", top: 0, fontSize: size + "px", animation: `toff-fall ${dur}s ${delay}s ease-in forwards` }}
          >
            {pieces[i % pieces.length]}
          </span>
        );
      })}
    </div>
  );
}

export default function TimeOff() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = !!(user && (user.role === "admin" || (user as any).isManager));

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [showConfetti, setShowConfetti] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const { data: myRequests = [], isLoading: myLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off", "mine"],
    queryFn: () => apiRequest("GET", "/api/time-off?scope=mine"),
  });

  const { data: teamRequests = [], isLoading: teamLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off", "team"],
    queryFn: () => apiRequest("GET", "/api/time-off"),
    enabled: isManager,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
  }

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/time-off", { startDate, endDate, reason }),
    onSuccess: () => {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3500);
      toast({ title: "Request sent! 🎉", description: "Sit tight — your manager will review it shortly." });
      setStartDate(""); setEndDate(""); setReason("");
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not submit", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "denied"; reviewerNote: string }) =>
      apiRequest("PATCH", "/api/time-off/" + v.id, { status: v.status, reviewerNote: v.reviewerNote }),
    onSuccess: (_d, v) => {
      toast({ title: "Request " + v.status });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", "/api/time-off/" + id),
    onSuccess: () => { toast({ title: "Request removed" }); refresh(); },
    onError: (e: any) => toast({ title: "Could not remove", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const canSubmit = !!startDate && !!endDate && endDate >= startDate && !createMutation.isPending;
  const pendingCount = teamRequests.filter(r => r.status === "pending").length;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1100px] mx-auto">
      <Confetti show={showConfetti} />

      {/* Fun gradient header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0ea5e9] via-[#2563eb] to-[#1A2B4A] px-6 py-6 shadow-lg">
        <div className="absolute -right-6 -top-8 opacity-15 select-none text-[120px] leading-none rotate-12">🏝️</div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-white/15">
            <Plane className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Time Off</h1>
            <p className="text-sm text-white/70">You earned it — book your break and track approvals. 🌴</p>
          </div>
        </div>
      </div>

      {/* Beta / under construction banner */}
      <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 flex items-center gap-2.5">
        <Construction className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Under construction — Beta</p>
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80">This feature is still being built. Things may change and may not work perfectly yet.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarOff className="w-4 h-4" /> Request Time Off
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">When are you taking off?</label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start gap-2 mt-1 h-11 font-normal" data-testid="button-timeoff-dates">
                  <CalendarDays className="w-4 h-4 text-primary shrink-0" />
                  {startDate ? (
                    <span className="font-medium">
                      {fmtDate(startDate)}{endDate && endDate !== startDate ? "  →  " + fmtDate(endDate) : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Tap to pick your dates</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="flex flex-wrap gap-1.5 p-3 pb-1 border-b">
                  {DATE_PRESETS.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => { const [s, e] = p.range(); setStartDate(s); setEndDate(e); }}
                      className="rounded-full border px-2.5 py-1 text-xs hover:bg-primary/10 hover:border-primary/40 transition-colors"
                      data-testid={"preset-" + p.label.toLowerCase().replace(/[^a-z]+/g, "-")}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <Calendar
                  mode="range"
                  numberOfMonths={1}
                  selected={startDate ? { from: ymdToDate(startDate), to: endDate ? ymdToDate(endDate) : undefined } : undefined}
                  onSelect={(range: any) => {
                    const from = range?.from ? toYmd(range.from) : "";
                    const to = range?.to ? toYmd(range.to) : from;
                    setStartDate(from);
                    setEndDate(to);
                  }}
                  defaultMonth={startDate ? ymdToDate(startDate) : new Date()}
                  disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                />
                <div className="flex items-center justify-between p-3 pt-1 border-t">
                  <button
                    type="button"
                    onClick={() => { setStartDate(""); setEndDate(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                  <Button size="sm" onClick={() => setDateOpen(false)} data-testid="button-dates-done">Done</Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
              {REASON_CHIPS.map(c => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setReason(c.emoji + " " + c.label)}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs hover:bg-primary/10 hover:border-primary/40 transition-colors"
                  data-testid={"chip-reason-" + c.label.toLowerCase().replace(/ /g, "-")}
                >
                  <span>{c.emoji}</span><span>{c.label}</span>
                </button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Tap a chip above or tell us what is up…"
              data-testid="textarea-timeoff-reason"
            />
          </div>
          {startDate && endDate && endDate < startDate && (
            <p className="text-xs text-red-600">End date cannot be before the start date.</p>
          )}
          {startDate && endDate && endDate >= startDate && (
            <div className="rounded-lg bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/30 dark:to-emerald-950/30 border border-sky-200/60 dark:border-sky-800/60 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-semibold text-sky-800 dark:text-sky-200">{dayCount(startDate, endDate)} day{dayCount(startDate, endDate) === 1 ? "" : "s"} off</span>
              <span className="text-sm text-emerald-700 dark:text-emerald-300">{vibe(dayCount(startDate, endDate))}</span>
            </div>
          )}
          <div className="flex items-center justify-end">
            <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} className="gap-1.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white shadow-sm" data-testid="button-submit-timeoff">
              <Plane className="w-4 h-4" /> {createMutation.isPending ? "Sending…" : "Request My Time Off"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isManager && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Team Requests
              {pendingCount > 0 && (
                <Badge className="ml-1 bg-amber-500 text-white text-[10px] px-1.5">{pendingCount} pending</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : teamRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No time-off requests yet.</p>
            ) : (
              teamRequests.map(r => (
                <div key={r.id} className="rounded-lg border px-4 py-3" data-testid={"team-request-" + r.id}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{r.userName}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-sm text-foreground mt-0.5">
                        {fmtDate(r.startDate)} &rarr; {fmtDate(r.endDate)}
                        <span className="text-muted-foreground"> &middot; {dayCount(r.startDate, r.endDate)} day(s)</span>
                      </p>
                      {r.reason && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{r.reason}</p>}
                      {r.status !== "pending" && r.reviewerName && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {r.status === "approved" ? "Approved" : "Denied"} by {r.reviewerName}
                          {r.reviewerNote ? " — " + r.reviewerNote : ""}
                        </p>
                      )}
                    </div>
                    {r.status === "pending" && (
                      <div className="flex flex-col gap-2 w-full sm:w-64">
                        <Input
                          placeholder="Note (optional)"
                          value={reviewNotes[r.id] ?? ""}
                          onChange={e => setReviewNotes(p => ({ ...p, [r.id]: e.target.value }))}
                          className="h-8 text-xs"
                          data-testid={"input-review-note-" + r.id}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                            onClick={() => decideMutation.mutate({ id: r.id, status: "approved", reviewerNote: reviewNotes[r.id] ?? "" })}
                            disabled={decideMutation.isPending}
                            data-testid={"button-approve-" + r.id}
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 border-red-300 text-red-700 hover:bg-red-50 gap-1"
                            onClick={() => decideMutation.mutate({ id: r.id, status: "denied", reviewerNote: reviewNotes[r.id] ?? "" })}
                            disabled={decideMutation.isPending}
                            data-testid={"button-deny-" + r.id}
                          >
                            <X className="w-3.5 h-3.5" /> Deny
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">My Requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {myLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">You have not requested any time off yet.</p>
          ) : (
            myRequests.map(r => (
              <div key={r.id} className="rounded-lg border px-4 py-3 flex items-start justify-between gap-3" data-testid={"my-request-" + r.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{fmtDate(r.startDate)} &rarr; {fmtDate(r.endDate)}</span>
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-muted-foreground">{dayCount(r.startDate, r.endDate)} day(s)</span>
                  </div>
                  {r.reason && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{r.reason}</p>}
                  {r.status !== "pending" && r.reviewerName && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {r.status === "approved" ? "Approved" : "Denied"} by {r.reviewerName}
                      {r.reviewerNote ? " — " + r.reviewerNote : ""}
                    </p>
                  )}
                </div>
                {r.status !== "cancelled" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-muted-foreground hover:text-red-600 gap-1 shrink-0"
                    onClick={() => cancelMutation.mutate(r.id)}
                    disabled={cancelMutation.isPending}
                    data-testid={"button-cancel-" + r.id}
                    title={r.status === "approved" ? "Withdraw this approved time off" : undefined}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> {r.status === "denied" ? "Remove" : "Cancel"}
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
