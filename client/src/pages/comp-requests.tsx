import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  Wallet, Plus, Check, X, Trash2, Clock, CheckCircle2, Send, Receipt,
  CreditCard, Hourglass, Megaphone, Plane, Laptop, Building2, Users, Tag, BadgeDollarSign, Paperclip, Construction,
} from "lucide-react";

interface CompItem {
  id: number;
  userId: number;
  userName: string;
  description: string;
  category: string;
  amountCents: number;
  expenseDate: string | null;
  note: string;
  status: "draft" | "pending" | "approved" | "denied";
  isPaid: boolean;
  isReceived: boolean;
  receivedAt: string | null;
  reviewedBy: number | null;
  reviewerName: string | null;
  reviewerNote: string;
  requestedAt: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string | null;
  attachmentCount?: number;
}

const CATEGORIES: Record<string, { label: string; icon: any; cls: string }> = {
  leads: { label: "Leads", icon: Users, cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  software: { label: "Software", icon: Laptop, cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  travel: { label: "Travel", icon: Plane, cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  marketing: { label: "Marketing", icon: Megaphone, cls: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300" },
  equipment: { label: "Equipment", icon: CreditCard, cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  office: { label: "Office", icon: Building2, cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  other: { label: "Other", icon: Tag, cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function money(cents: number) {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null) {
  if (!d) return "";
  try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return d; }
}

function CatChip({ category }: { category: string }) {
  const c = CATEGORIES[category] ?? CATEGORIES.other;
  const Icon = c.icon;
  return (
    <span className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " + c.cls}>
      <Icon className="w-3 h-3" /> {c.label}
    </span>
  );
}

function StatusBadge({ status, isPaid, isReceived }: { status: CompItem["status"]; isPaid?: boolean; isReceived?: boolean }) {
  if (status === "approved" && isReceived) return <Badge className="text-xs px-2 py-0.5 bg-emerald-600 text-white">Received</Badge>;
  if (status === "approved" && isPaid) return <Badge className="text-xs px-2 py-0.5 bg-sky-600 text-white">Paid</Badge>;
  const map: Record<CompItem["status"], { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
    denied: { label: "Denied", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  };
  const cfg = map[status] ?? map.draft;
  return <Badge className={"text-xs px-2 py-0.5 " + cfg.cls}>{cfg.label}</Badge>;
}

function Attachments({ compId, count, canEdit }: { compId: number; count: number; canEdit: boolean }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const enabled = canEdit || count > 0;
  const { data } = useQuery<{ canEdit: boolean; attachments: any[] }>({
    queryKey: ["/api/comp", compId, "attachments"],
    queryFn: () => apiRequest("GET", "/api/comp/" + compId + "/attachments"),
    enabled,
  });
  const list = data?.attachments ?? [];

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const dataBase64: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.onerror = () => reject(new Error("read failed"));
        fr.readAsDataURL(file);
      });
      return apiRequest("POST", "/api/comp/" + compId + "/attachments", { filename: file.name, mime: file.type, dataBase64 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comp", compId, "attachments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/comp"] });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const removeMut = useMutation({
    mutationFn: (attId: number) => apiRequest("DELETE", "/api/comp-attachments/" + attId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/comp", compId, "attachments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/comp"] });
    },
    onError: (e: any) => toast({ title: "Could not remove", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  async function onPick(e: any) {
    const files = Array.from((e.target.files ?? []) as FileList) as File[];
    for (const f of files) { await uploadMut.mutateAsync(f).catch(() => {}); }
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!enabled) return null;

  return (
    <div className="mt-2 pl-1">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {list.map((a: any) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 pl-2 pr-1 py-0.5 text-[11px]">
              <a href={"/api/comp-attachments/" + a.id} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline max-w-[170px] truncate">
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate">{a.filename}</span>
              </a>
              {canEdit && (
                <button type="button" onClick={() => removeMut.mutate(a.id)} className="rounded hover:bg-destructive/20 p-0.5 text-muted-foreground hover:text-destructive" aria-label="Remove attachment">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {canEdit && (
        <>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={onPick} data-testid={"attach-input-" + compId} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" data-testid={"attach-btn-" + compId}>
            <Paperclip className="w-3 h-3" /> {uploadMut.isPending ? "Uploading…" : "Attach receipt"}
          </button>
        </>
      )}
    </div>
  );
}

export default function CompRequests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = !!(user && (user.role === "admin" || (user as any).isManager));

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("leads");
  const [expenseDate, setExpenseDate] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  const { data: mine = [], isLoading: mineLoading } = useQuery<CompItem[]>({
    queryKey: ["/api/comp", "mine"],
    queryFn: () => apiRequest("GET", "/api/comp?scope=mine"),
  });

  const { data: team = [], isLoading: teamLoading } = useQuery<CompItem[]>({
    queryKey: ["/api/comp", "team"],
    queryFn: () => apiRequest("GET", "/api/comp"),
    enabled: isManager,
  });

  function refresh() { queryClient.invalidateQueries({ queryKey: ["/api/comp"] }); }

  const drafts = useMemo(() => mine.filter(r => r.status === "draft"), [mine]);
  const myRequests = useMemo(() => mine.filter(r => r.status !== "draft"), [mine]);

  const stats = useMemo(() => {
    const sum = (list: CompItem[]) => list.reduce((a, r) => a + (r.amountCents || 0), 0);
    return {
      draft: sum(drafts),
      pending: sum(myRequests.filter(r => r.status === "pending")),
      approved: sum(myRequests.filter(r => r.status === "approved")),
      received: sum(myRequests.filter(r => r.status === "approved" && r.isReceived)),
    };
  }, [drafts, myRequests]);

  const selectedTotal = useMemo(
    () => drafts.filter(d => selected.has(d.id)).reduce((a, r) => a + r.amountCents, 0),
    [drafts, selected]
  );

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/comp", {
      description, category, expenseDate: expenseDate || undefined, note,
      amountCents: Math.round(parseFloat(amount || "0") * 100),
    }),
    onSuccess: () => {
      toast({ title: "Expense saved", description: "Added to your saved expenses." });
      setDescription(""); setAmount(""); setNote(""); setExpenseDate("");
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const requestMutation = useMutation({
    mutationFn: (ids: number[]) => apiRequest("POST", "/api/comp/request", { ids }),
    onSuccess: (d: any) => {
      toast({ title: "Comp requested", description: (d?.requested ?? 0) + " item(s) sent for approval" + (d?.emailedTo ? " — emailed to " + d.emailedTo : "") + "." });
      setSelected(new Set());
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not request", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "denied"; reviewerNote: string }) =>
      apiRequest("POST", "/api/comp/" + v.id + "/decision", { status: v.status, reviewerNote: v.reviewerNote }),
    onSuccess: (_d, v) => { toast({ title: "Comp " + v.status }); refresh(); },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const fulfillMutation = useMutation({
    mutationFn: (v: { id: number; paid?: boolean; received?: boolean }) =>
      apiRequest("POST", "/api/comp/" + v.id + "/paid", v.paid !== undefined ? { paid: v.paid } : { received: v.received }),
    onSuccess: () => refresh(),
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", "/api/comp/" + id),
    onSuccess: () => { toast({ title: "Removed" }); refresh(); },
    onError: (e: any) => toast({ title: "Could not remove", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  function toggleSel(id: number) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(prev => prev.size === drafts.length ? new Set() : new Set(drafts.map(d => d.id)));
  }

  const amountValid = parseFloat(amount || "0") > 0;
  const canSubmit = !!description.trim() && amountValid && !createMutation.isPending;
  const pendingCount = team.filter(r => r.status === "pending").length;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1100px] mx-auto">
      {/* Fancy gradient header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10">
          <Wallet className="w-40 h-40" />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <BadgeDollarSign className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Comp Requests</h1>
            <p className="text-sm text-white/60">Log expenses as you go, request reimbursement, and track every payout.</p>
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Saved (unsent)", value: stats.draft, icon: Receipt, ring: "ring-slate-200 dark:ring-slate-700", fg: "text-slate-600 dark:text-slate-300" },
          { label: "Pending", value: stats.pending, icon: Hourglass, ring: "ring-amber-200 dark:ring-amber-800", fg: "text-amber-600 dark:text-amber-400" },
          { label: "Approved", value: stats.approved, icon: CheckCircle2, ring: "ring-emerald-200 dark:ring-emerald-800", fg: "text-emerald-600 dark:text-emerald-400" },
          { label: "Received", value: stats.received, icon: CreditCard, ring: "ring-emerald-200 dark:ring-emerald-800", fg: "text-emerald-600 dark:text-emerald-400" },
        ].map(s => (
          <div key={s.label} className={"rounded-xl border bg-card px-4 py-3 ring-1 " + s.ring}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
              <s.icon className={"w-4 h-4 " + s.fg} />
            </div>
            <p className="text-xl font-bold mt-1 tabular-nums">{money(s.value)}</p>
          </div>
        ))}
      </div>

      {/* Log an expense */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" /> Log an Expense
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Amount (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="0.00" className="pl-6" data-testid="input-comp-amount"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-comp-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORIES).map(([key, c]) => (
                    <SelectItem key={key} value={key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Date spent</label>
              <Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} data-testid="input-comp-date" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Input
              value={description} onChange={e => setDescription(e.target.value)}
              maxLength={300} placeholder="What did you spend on?" data-testid="input-comp-description"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
            <Textarea
              value={note} onChange={e => setNote(e.target.value)}
              rows={2} maxLength={1000} placeholder="Receipt link, context, etc." data-testid="textarea-comp-note"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} className="gap-1.5" data-testid="button-save-expense">
              <Plus className="w-4 h-4" /> {createMutation.isPending ? "Saving…" : "Save Expense"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Saved expenses (drafts) */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="w-4 h-4" /> Saved Expenses
            {drafts.length > 0 && <span className="text-xs font-normal text-muted-foreground">({drafts.length})</span>}
          </CardTitle>
          {drafts.length > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={toggleAll} data-testid="button-select-all-drafts">
                {selected.size === drafts.length ? "Clear" : "Select all"}
              </Button>
              <Button
                size="sm" className="h-8 gap-1.5"
                disabled={selected.size === 0 || requestMutation.isPending}
                onClick={() => requestMutation.mutate(Array.from(selected))}
                data-testid="button-request-comp"
              >
                <Send className="w-3.5 h-3.5" />
                Request Comp{selected.size > 0 ? " (" + money(selectedTotal) + ")" : ""}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {mineLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No saved expenses. Log one above and it will appear here until you request comp.</p>
          ) : (
            drafts.map(d => (
              <div
                key={d.id}
                className={"rounded-lg border px-3 py-2.5 transition-colors " + (selected.has(d.id) ? "bg-primary/5 border-primary/40" : "")}
                data-testid={"draft-" + d.id}
              >
                <div className="flex items-center gap-3">
                <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggleSel(d.id)} data-testid={"check-draft-" + d.id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{d.description}</span>
                    <CatChip category={d.category} />
                  </div>
                  {(d.expenseDate || d.note) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {d.expenseDate ? fmtDate(d.expenseDate) : ""}{d.expenseDate && d.note ? " · " : ""}{d.note}
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">{money(d.amountCents)}</span>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-600 shrink-0"
                  onClick={() => deleteMutation.mutate(d.id)} disabled={deleteMutation.isPending}
                  data-testid={"button-delete-draft-" + d.id}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                </div>
                <Attachments compId={d.id} count={d.attachmentCount ?? 0} canEdit={true} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Manager: team comp requests */}
      {isManager && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Team Comp Requests
              {pendingCount > 0 && <Badge className="ml-1 bg-amber-500 text-white text-[10px] px-1.5">{pendingCount} pending</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : team.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No comp requests submitted yet.</p>
            ) : (
              team.map(r => (
                <div key={r.id} className="rounded-lg border px-4 py-3" data-testid={"team-comp-" + r.id}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{r.userName}</span>
                        <CatChip category={r.category} />
                        <StatusBadge status={r.status} isPaid={r.isPaid} isReceived={r.isReceived} />
                      </div>
                      <p className="text-sm text-foreground mt-0.5">
                        <span className="font-semibold tabular-nums">{money(r.amountCents)}</span>
                        <span className="text-muted-foreground"> · {r.description}</span>
                      </p>
                      {(r.expenseDate || r.note) && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {r.expenseDate ? fmtDate(r.expenseDate) : ""}{r.expenseDate && r.note ? " · " : ""}{r.note}
                        </p>
                      )}
                      {r.status !== "pending" && r.reviewerName && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {r.status === "approved" ? "Approved" : "Denied"} by {r.reviewerName}
                          {r.reviewerNote ? " — " + r.reviewerNote : ""}
                          {r.status === "approved" ? (r.isReceived ? " · received" : (r.isPaid ? " · paid, awaiting receipt" : " · awaiting payout")) : ""}
                        </p>
                      )}
                    </div>
                    {r.status === "pending" && (
                      <div className="flex flex-col gap-2 w-full sm:w-64">
                        <Input
                          placeholder="Note (optional)" value={reviewNotes[r.id] ?? ""}
                          onChange={e => setReviewNotes(p => ({ ...p, [r.id]: e.target.value }))}
                          className="h-8 text-xs" data-testid={"input-comp-note-" + r.id}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm" className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                            onClick={() => decideMutation.mutate({ id: r.id, status: "approved", reviewerNote: reviewNotes[r.id] ?? "" })}
                            disabled={decideMutation.isPending} data-testid={"button-approve-comp-" + r.id}
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm" variant="outline" className="h-8 flex-1 border-red-300 text-red-700 hover:bg-red-50 gap-1"
                            onClick={() => decideMutation.mutate({ id: r.id, status: "denied", reviewerNote: reviewNotes[r.id] ?? "" })}
                            disabled={decideMutation.isPending} data-testid={"button-deny-comp-" + r.id}
                          >
                            <X className="w-3.5 h-3.5" /> Deny
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <Attachments compId={r.id} count={r.attachmentCount ?? 0} canEdit={false} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* My comp requests */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> My Comp Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {mineLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No comp requests yet. Select saved expenses above and click Request Comp.</p>
          ) : (
            myRequests.map(r => (
              <div key={r.id} className="rounded-lg border px-4 py-3" data-testid={"my-comp-" + r.id}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold tabular-nums">{money(r.amountCents)}</span>
                      <CatChip category={r.category} />
                      <StatusBadge status={r.status} isPaid={r.isPaid} isReceived={r.isReceived} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 truncate">{r.description}</p>
                    {r.status !== "pending" && r.reviewerName && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {r.status === "approved" ? "Approved" : "Denied"} by {r.reviewerName}
                        {r.reviewerNote ? " — " + r.reviewerNote : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {r.status === "approved" && (
                      <>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Mark when the reimbursement has been paid out">
                          <span className={r.isPaid ? "text-sky-600 font-medium" : ""}>Paid</span>
                          <Switch
                            checked={r.isPaid}
                            onCheckedChange={(v) => fulfillMutation.mutate({ id: r.id, paid: v })}
                            data-testid={"switch-paid-" + r.id}
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Mark when you have received the money">
                          <span className={r.isReceived ? "text-emerald-600 font-medium" : ""}>Received</span>
                          <Switch
                            checked={r.isReceived}
                            onCheckedChange={(v) => fulfillMutation.mutate({ id: r.id, received: v })}
                            data-testid={"switch-received-" + r.id}
                          />
                        </label>
                      </>
                    )}
                    {r.status === "pending" && (
                      <Button
                        variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-red-600 gap-1"
                        onClick={() => deleteMutation.mutate(r.id)} disabled={deleteMutation.isPending}
                        data-testid={"button-cancel-comp-" + r.id}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
                <Attachments compId={r.id} count={r.attachmentCount ?? 0} canEdit={r.status === "pending"} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
