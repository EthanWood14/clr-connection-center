import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Clock, Play, Square, Plus, Pencil, Trash2, DollarSign, ChevronLeft, ChevronRight, Settings2, Wallet } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useLocation } from "wouter";

type Entry = {
  id: number; userId: number; userName: string;
  clockIn: string; clockOut: string | null; note: string;
  hours: number; rateCents: number; seRate: number;
  baseCents: number; seCents: number; totalCents: number; open: boolean;
};
type TCResp = { scope: string; isManager: boolean; entries: Entry[]; open: Entry | null; rate: { rateCents: number; seRate: number } };

function money(cents: number) {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// ISO datetime → value for <input type="datetime-local"> in the browser's local
// tz. Includes seconds (step="1") so short/same-minute shifts round-trip exactly
// and don't fail the "clock-out after clock-in" check on edit.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// Local datetime-local value → full ISO (UTC) using the browser's tz.
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function fmtRange(inIso: string, outIso: string | null) {
  const i = parseISO(inIso);
  const o = outIso ? parseISO(outIso) : null;
  const day = format(i, "EEE MMM d");
  const t = (d: Date) => format(d, "h:mm a");
  return { day, span: o ? `${t(i)} – ${t(o)}` : `${t(i)} – …` };
}
function humanElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}
function monthBounds(anchor: Date) {
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const p = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${p(m + 1)}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const end = `${y}-${p(m + 1)}-${p(last)}`;
  return { start, end, label: format(anchor, "MMMM yyyy") };
}

export default function TimeClock() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const isAdmin = !!(user && (user.role === "admin" || (user as any).superAdmin));

  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const { start, end, label } = useMemo(() => monthBounds(monthAnchor), [monthAnchor]);

  const { data, isLoading } = useQuery<TCResp>({
    queryKey: ["/api/timeclock", scope, start, end],
    queryFn: () => apiRequest("GET", `/api/timeclock?scope=${scope}&startDate=${start}&endDate=${end}`),
    refetchInterval: 30000,
  });
  const entries = data?.entries ?? [];
  const open = data?.open ?? null;
  const rate = data?.rate ?? { rateCents: 1690, seRate: 0.0765 };
  const isManager = !!data?.isManager;

  function refresh() { qc.invalidateQueries({ queryKey: ["/api/timeclock"] }); }

  // Live elapsed timer while clocked in.
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open?.id]);

  const clockInMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/timeclock/clock-in", {}),
    onSuccess: () => { toast({ title: "Clocked in ⏱️" }); refresh(); },
    onError: (e: any) => toast({ title: "Couldn't clock in", description: e?.message, variant: "destructive" }),
  });
  const clockOutMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/timeclock/clock-out", {}),
    onSuccess: () => { toast({ title: "Clocked out ✅" }); refresh(); },
    onError: (e: any) => toast({ title: "Couldn't clock out", description: e?.message, variant: "destructive" }),
  });

  // ── Add / edit entry dialog ──
  const [editTarget, setEditTarget] = useState<Entry | "new" | null>(null);
  const [fIn, setFIn] = useState("");
  const [fOut, setFOut] = useState("");
  const [fNote, setFNote] = useState("");
  function openNew() {
    setEditTarget("new");
    const now = new Date();
    const nine = new Date(now); nine.setHours(9, 0, 0, 0);
    setFIn(isoToLocalInput(nine.toISOString()));
    setFOut(isoToLocalInput(now.toISOString()));
    setFNote("");
  }
  function openEdit(e: Entry) {
    setEditTarget(e);
    setFIn(isoToLocalInput(e.clockIn));
    setFOut(e.clockOut ? isoToLocalInput(e.clockOut) : "");
    setFNote(e.note ?? "");
  }
  const saveMut = useMutation({
    mutationFn: (v: { id?: number; body: any }) =>
      v.id ? apiRequest("PATCH", `/api/timeclock/${v.id}`, v.body) : apiRequest("POST", "/api/timeclock", v.body),
    onSuccess: () => { toast({ title: "Saved" }); setEditTarget(null); refresh(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  function save() {
    const inIso = localInputToIso(fIn);
    if (!inIso) { toast({ title: "Clock-in time required", variant: "destructive" }); return; }
    const outIso = fOut ? localInputToIso(fOut) : null;
    if (fOut && !outIso) { toast({ title: "Invalid clock-out time", variant: "destructive" }); return; }
    if (outIso && new Date(outIso) <= new Date(inIso)) { toast({ title: "Clock-out must be after clock-in", variant: "destructive" }); return; }
    const body: any = { clockIn: inIso, clockOut: outIso, note: fNote };
    saveMut.mutate({ id: editTarget !== "new" && editTarget ? editTarget.id : undefined, body });
  }

  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null);
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/timeclock/${id}`),
    onSuccess: () => { toast({ title: "Removed" }); setDeleteTarget(null); refresh(); },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e?.message, variant: "destructive" }),
  });

  // ── Totals for the loaded range (completed shifts only) ──
  const totals = useMemo(() => {
    let hours = 0, base = 0, se = 0, total = 0;
    for (const e of entries) { if (!e.open) { hours += e.hours; base += e.baseCents; se += e.seCents; total += e.totalCents; } }
    return { hours, base, se, total };
  }, [entries]);

  // ── Admin pay-rate settings ──
  // Rates are per-user: each person uses the org default unless they have an
  // override. Changing a rate here only ever affects that one person.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [seInput, setSeInput] = useState("");
  const [rateDrafts, setRateDrafts] = useState<Record<number, string>>({});
  const settingsMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/timeclock/settings", body),
    onSuccess: () => { toast({ title: "Pay settings saved" }); setSettingsOpen(false); refresh(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  type RateRow = { userId: number; name: string; role: string; overrideCents: number | null; effectiveCents: number };
  const { data: ratesData } = useQuery<{ defaultRateCents: number; users: RateRow[] }>({
    queryKey: ["/api/timeclock/rates"],
    queryFn: () => apiRequest("GET", "/api/timeclock/rates"),
    enabled: settingsOpen && isAdmin,
  });
  const rateMut = useMutation({
    mutationFn: (v: { userId: number; rateCents: number | null }) =>
      apiRequest("POST", `/api/timeclock/rates/${v.userId}`, { rateCents: v.rateCents }),
    onSuccess: (_d: any, v) => {
      toast({ title: v.rateCents != null ? "Rate updated" : "Rate reset to default" });
      setRateDrafts(d => { const n = { ...d }; delete n[v.userId]; return n; });
      qc.invalidateQueries({ queryKey: ["/api/timeclock/rates"] });
      refresh();
    },
    onError: (e: any) => toast({ title: "Couldn't update rate", description: e?.message, variant: "destructive" }),
  });
  function saveUserRate(row: RateRow) {
    const draft = (rateDrafts[row.userId] ?? "").trim();
    if (!draft) { rateMut.mutate({ userId: row.userId, rateCents: null }); return; }
    const cents = Math.round(parseFloat(draft) * 100);
    if (!Number.isFinite(cents) || cents <= 0) { toast({ title: "Enter a valid rate", variant: "destructive" }); return; }
    rateMut.mutate({ userId: row.userId, rateCents: cents });
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><Clock className="w-40 h-40" /></div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <Clock className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Time Clock</h1>
            <p className="text-sm text-white/60">Clock in & out. Hours roll into the end-of-month payroll summary.</p>
          </div>
        </div>
      </div>

      {/* Clock in/out */}
      <Card>
        <CardContent className="p-5">
          {open ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Clocked in
                </div>
                <div className="text-3xl font-bold tabular-nums mt-1">{humanElapsed(nowMs - new Date(open.clockIn).getTime())}</div>
                <div className="text-xs text-muted-foreground mt-0.5">since {format(parseISO(open.clockIn), "h:mm a")}</div>
              </div>
              <Button size="lg" className="gap-2 bg-rose-600 hover:bg-rose-700 text-white" onClick={() => clockOutMut.mutate()} disabled={clockOutMut.isPending} data-testid="clock-out">
                <Square className="w-5 h-5" /> Clock Out
              </Button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-muted-foreground">You're clocked out</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Rate {money(rate.rateCents)}/hr + {(rate.seRate * 100).toFixed(2)}% self-employment reimbursement
                </div>
              </div>
              <Button size="lg" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => clockInMut.mutate()} disabled={clockInMut.isPending} data-testid="clock-in">
                <Play className="w-5 h-5" /> Clock In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Month nav + totals */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthAnchor(a => new Date(a.getFullYear(), a.getMonth() - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-semibold w-36 text-center">{label}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthAnchor(a => new Date(a.getFullYear(), a.getMonth() + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <div className="inline-flex rounded-md border overflow-hidden text-xs">
              <button className={`px-2.5 py-1 ${scope === "mine" ? "bg-primary text-primary-foreground" : "bg-background"}`} onClick={() => setScope("mine")}>Mine</button>
              <button className={`px-2.5 py-1 ${scope === "team" ? "bg-primary text-primary-foreground" : "bg-background"}`} onClick={() => setScope("team")}>Team</button>
            </div>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setSeInput((rate.seRate * 100).toFixed(2)); setRateDrafts({}); setSettingsOpen(true); }}>
              <Settings2 className="w-3.5 h-3.5" /> Pay rates
            </Button>
          )}
          <Button size="sm" className="gap-1.5" onClick={openNew} data-testid="add-entry"><Plus className="w-3.5 h-3.5" /> Add entry</Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Hours", value: totals.hours.toFixed(2), icon: Clock },
          { label: "Base Pay", value: money(totals.base), icon: DollarSign },
          { label: "SE Reimb.", value: money(totals.se), icon: DollarSign },
          { label: "Total", value: money(totals.total), icon: DollarSign },
        ].map(s => (
          <div key={s.label} className="rounded-xl border bg-card px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
              <s.icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold mt-1 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Hand these hours to Comp Requests with the form prefilled */}
      {scope === "mine" && totals.hours > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-amber-900 dark:text-amber-200">
            <strong>{totals.hours.toFixed(2)} hrs in {label}</strong> ≈ {money(totals.total)} incl. SE reimbursement.
          </p>
          <Button
            size="sm" variant="outline" className="gap-1.5"
            data-testid="tc-file-comp"
            onClick={() => {
              try {
                sessionStorage.setItem("comp.prefill", JSON.stringify({
                  description: `Hours worked — ${label} (${totals.hours.toFixed(2)} hrs @ ${money(rate.rateCents)}/hr + ${(rate.seRate * 100).toFixed(2)}% SE)`,
                  category: "time",
                  amountCents: totals.total,
                }));
              } catch {}
              navigate("/comp-requests");
            }}
          >
            <Wallet className="w-3.5 h-3.5" /> File a comp request
          </Button>
        </div>
      )}

      {/* Entries */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Shifts — {label}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No shifts this month. Clock in above, or add one manually.</p>
          ) : (
            entries.map(e => {
              const r = fmtRange(e.clockIn, e.clockOut);
              const mine = e.userId === user?.id;
              const canEdit = mine || isManager;
              return (
                <div key={e.id} className="rounded-lg border px-3 py-2 flex items-center justify-between gap-3 flex-wrap" data-testid={"tc-entry-" + e.id}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{r.day}</span>
                      {scope === "team" && <Badge variant="outline" className="text-[10px] px-1.5">{e.userName}</Badge>}
                      {e.open && <Badge className="bg-emerald-600 text-white text-[10px] px-1.5">open</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.span}{e.note ? ` · ${e.note}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums">{e.open ? "—" : `${e.hours.toFixed(2)} h`}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{e.open ? "in progress" : money(e.totalCents)}</div>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Edit" onClick={() => openEdit(e)} data-testid={"tc-edit-" + e.id}><Pencil className="w-3.5 h-3.5" /></button>
                        <button className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => setDeleteTarget(e)} data-testid={"tc-delete-" + e.id}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <p className="text-[11px] text-muted-foreground pt-1">Pay is an estimate at {money(rate.rateCents)}/hr + {(rate.seRate * 100).toFixed(2)}% SE reimbursement. Finalized in the month-end payroll summary.</p>
        </CardContent>
      </Card>

      {/* Add / edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={o => { if (!o) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editTarget === "new" ? "Add shift" : "Edit shift"}</DialogTitle>
            <DialogDescription>Times are in your local timezone. Leave clock-out blank for an in-progress shift.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Clock in</label>
              <Input type="datetime-local" step="1" value={fIn} onChange={e => setFIn(e.target.value)} data-testid="tc-in" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Clock out <span className="font-normal">(optional)</span></label>
              <Input type="datetime-local" step="1" value={fOut} onChange={e => setFOut(e.target.value)} data-testid="tc-out" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
              <Textarea value={fNote} onChange={e => setFNote(e.target.value)} rows={2} maxLength={500} placeholder="Optional note…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)} disabled={saveMut.isPending}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saveMut.isPending}>{saveMut.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `${fmtRange(deleteTarget.clockIn, deleteTarget.clockOut).day} · ${fmtRange(deleteTarget.clockIn, deleteTarget.clockOut).span}. ` : ""}
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Admin pay-rate settings — per-user overrides on top of the fixed default */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay rates</DialogTitle>
            <DialogDescription>
              Everyone earns the default rate of {money(ratesData?.defaultRateCents ?? 1690)}/hr unless you set a
              personal rate below. Changing a rate only affects that person.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Self-employment reimbursement (%) — applies to everyone</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input type="number" step="0.01" min="0" value={seInput} onChange={e => setSeInput(e.target.value)} className="pr-6" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => settingsMut.mutate({ seRate: parseFloat(seInput || "0") / 100 })} disabled={settingsMut.isPending}>
                  {settingsMut.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Per-user hourly rate (USD)</label>
              <div className="mt-1 max-h-64 overflow-y-auto rounded-md border divide-y">
                {(ratesData?.users ?? []).map((row) => {
                  const draft = rateDrafts[row.userId];
                  const shown = draft !== undefined ? draft : (row.overrideCents != null ? (row.overrideCents / 100).toFixed(2) : "");
                  const dirty = draft !== undefined;
                  return (
                    <div key={row.userId} className="flex items-center gap-2 px-2.5 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{row.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.overrideCents != null ? `Override — earns ${money(row.effectiveCents)}/hr` : `Default — earns ${money(row.effectiveCents)}/hr`}
                        </p>
                      </div>
                      <div className="relative w-24">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                        <Input
                          type="number" step="0.01" min="0"
                          className="pl-5 h-8 text-sm"
                          placeholder={((ratesData?.defaultRateCents ?? 1690) / 100).toFixed(2)}
                          value={shown}
                          onChange={e => setRateDrafts(d => ({ ...d, [row.userId]: e.target.value }))}
                          data-testid={`rate-input-${row.userId}`}
                        />
                      </div>
                      <Button size="sm" variant={dirty ? "default" : "outline"} className="h-8"
                        onClick={() => saveUserRate(row)} disabled={!dirty || rateMut.isPending}>
                        Save
                      </Button>
                    </div>
                  );
                })}
                {!ratesData && <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">Clear a rate and save to put that person back on the default.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
