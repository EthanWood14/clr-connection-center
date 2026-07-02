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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  Wallet, Plus, Check, X, Trash2, Clock, CheckCircle2, Send, Receipt,
  CreditCard, Hourglass, Megaphone, Plane, Laptop, Building2, Tag, BadgeDollarSign, Paperclip, Info, FileText, ArrowLeftRight, Star, Shield, UserCog, Search, ChevronDown, CalendarDays, Pencil, HelpCircle,
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
  isProcessing: boolean;
  isReceived: boolean;
  receivedAt: string | null;
  processingAt: string | null;
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
  transfers: { label: "Transfers", icon: ArrowLeftRight, cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  equipment: { label: "Equipment", icon: CreditCard, cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" },
  software: { label: "Software", icon: Laptop, cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" },
  marketing: { label: "Marketing", icon: Megaphone, cls: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300" },
  travel: { label: "Travel", icon: Plane, cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  office: { label: "Office", icon: Building2, cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  other: { label: "Other", icon: Tag, cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  // Legacy alias: older requests were filed under "leads" before the rename to "transfers".
  leads: { label: "Transfers", icon: ArrowLeftRight, cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
};
// Keys shown in the category dropdown (excludes the legacy "leads" alias).
const CATEGORY_KEYS = ["transfers", "equipment", "software", "marketing", "travel", "office", "other"];

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

function StatusBadge({ status, isPaid, isProcessing, isReceived }: { status: CompItem["status"]; isPaid?: boolean; isProcessing?: boolean; isReceived?: boolean }) {
  if (status === "approved" && isReceived) return <Badge className="text-xs px-2 py-0.5 bg-emerald-600 text-white">Received</Badge>;
  if (status === "approved" && isPaid) return <Badge className="text-xs px-2 py-0.5 bg-sky-600 text-white">Paid</Badge>;
  if (status === "approved" && isProcessing) return <Badge className="text-xs px-2 py-0.5 bg-indigo-600 text-white">Processing</Badge>;
  const map: Record<CompItem["status"], { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
    denied: { label: "Denied", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  };
  const cfg = map[status] ?? map.draft;
  return <Badge className={"text-xs px-2 py-0.5 " + cfg.cls}>{cfg.label}</Badge>;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(file);
  });
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

// Shows the CLR how many transfers they logged last month (the basis for the
// monthly transfer comp request), so they don't have to dig through reporting.
function TransferStatsHint({ forUserId, onUse }: { forUserId?: number; onUse?: (text: string) => void }) {
  const qs = forUserId ? "?userId=" + forUserId : "";
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/comp/transfer-stats", forUserId ?? "me"],
    queryFn: () => apiRequest("GET", "/api/comp/transfer-stats" + qs),
  });
  const prev = data?.previous;
  const cur = data?.current;
  const plural = (n: number) => (n === 1 ? "" : "s");
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <ArrowLeftRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Your transfers — for the monthly transfer request</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300" data-testid="prev-transfer-count">{prev?.transfers ?? 0}</span>
              <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">in {prev?.month ?? "last month"}</span>
            </div>
            <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
              {prev?.direct ?? 0} direct · {prev?.appointment ?? 0} appointment
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="tabular-nums font-semibold text-foreground">{cur?.transfers ?? 0}</span> so far in {cur?.month ?? "this month"}
          </div>
        </div>
      )}
      {onUse && (prev || cur) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {prev && (
            <button
              type="button"
              onClick={() => onUse("Monthly transfer request — " + prev.month + " (" + prev.transfers + " transfer" + plural(prev.transfers) + ")")}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
              data-testid="button-use-transfers"
            >
              <Plus className="w-3 h-3" /> Use last month ({prev.month})
            </button>
          )}
          {cur && (
            <button
              type="button"
              onClick={() => onUse("Monthly transfer request — " + cur.month + " (" + cur.transfers + " transfer" + plural(cur.transfers) + ")")}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
              data-testid="button-use-transfers-current"
            >
              <Plus className="w-3 h-3" /> Use this month ({cur.month})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Visual pipeline so you can see at a glance where a request sits:
// Waiting Approval → Approved → Processing → Paid. Denied requests show a denied state.
function CompStageTracker({ status, isPaid, isProcessing, isReceived }: { status: CompItem["status"]; isPaid?: boolean; isProcessing?: boolean; isReceived?: boolean }) {
  if (status === "draft") return null;
  if (status === "denied") {
    return (
      <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
        <X className="w-3.5 h-3.5" /> Denied
      </div>
    );
  }
  const stages = ["Waiting Approval", "Approved", "Processing", "Paid"];
  const current = status === "pending" ? 0 : (isPaid || isReceived) ? 3 : isProcessing ? 2 : 1;
  return (
    <div className="mt-3 flex items-start" aria-label={`Status: ${stages[current]}`}>
      {stages.map((label, i) => {
        const done = i <= current;
        return (
          <div key={label} className="relative flex flex-1 flex-col items-center">
            {i > 0 && (
              <span className={`absolute top-2 left-[-50%] right-1/2 h-0.5 ${i <= current ? "bg-primary" : "bg-border"}`} />
            )}
            <div className={`relative z-10 flex h-4 w-4 items-center justify-center rounded-full border ${done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-transparent"}`}>
              {done && <Check className="h-2.5 w-2.5" />}
            </div>
            <span className={`mt-1 text-[10px] leading-tight text-center ${i === current ? "font-semibold text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Reusable help note about payout timing — shown to requesters and managers so
// everyone has the same expectation for when approved comp actually pays out.
function PayoutTimingNote() {
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-800 px-3 py-2 flex items-start gap-2">
      <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
      <p className="text-[12px] text-indigo-900 dark:text-indigo-200 leading-relaxed">
        Approved requests are paid out on the <strong>15th</strong> and the <strong>1st</strong> of every month.
      </p>
    </div>
  );
}

// Payout schedule: Chris pays out on the 1st and the 15th of every month. A
// request's pay date is the next 1st-or-15th on/after it was approved (falling
// back to when it was filed). Used to group the Payout Center into pay runs.
function compPayDate(r: CompItem): Date {
  const base = r.reviewedAt ?? r.requestedAt ?? r.createdAt;
  const d = base ? new Date(base) : new Date();
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (day <= 1) return new Date(y, m, 1);    // the 1st
  if (day <= 15) return new Date(y, m, 15);  // the 15th
  return new Date(y, m + 1, 1);              // past the 15th → the 1st next month
}
function payKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function payLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
// Label a pay run by the span of dates its requests were submitted (filed).
function submittedRangeLabel(items: CompItem[]): string {
  const times = items
    .map(r => r.requestedAt ?? r.createdAt)
    .filter(Boolean)
    .map(s => new Date(s as string).getTime())
    .filter(t => !Number.isNaN(t));
  if (times.length === 0) return "—";
  const min = new Date(Math.min(...times));
  const max = new Date(Math.max(...times));
  const md = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const mdy = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return payKey(min) === payKey(max) ? mdy(min) : `${md(min)} – ${mdy(max)}`;
}

// Admin-only panel to see who can approve comp requests and mark people as
// managers inline (managers are the approvers in the comp pipeline).
function ManagersPanel() {
  const { toast } = useToast();
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const staff = useMemo(
    () =>
      (users ?? [])
        .filter((u: any) => u.isActive && (u.role === "assistant" || u.role === "admin"))
        .sort((a: any, b: any) => {
          const am = a.role === "admin" || (a.isManager ?? a.is_manager) ? 0 : 1;
          const bm = b.role === "admin" || (b.isManager ?? b.is_manager) ? 0 : 1;
          if (am !== bm) return am - bm;
          return String(a.name ?? "").localeCompare(String(b.name ?? ""));
        }),
    [users]
  );
  const toggle = useMutation({
    mutationFn: ({ id, is_manager }: { id: number; is_manager: boolean }) =>
      apiRequest("PATCH", `/api/users/${id}/manager`, { is_manager }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: vars.is_manager ? "Marked as manager" : "Removed as manager" });
    },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });
  const approverCount = staff.filter((u: any) => u.role === "admin" || (u.isManager ?? u.is_manager)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserCog className="w-4 h-4" /> Managers / Approvers
          <Badge variant="outline" className="ml-1 text-[10px]">{approverCount} can approve</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Tap a name to mark them as a manager. Managers can approve, deny, mark comp as paid, and file requests on behalf of CLRs. Admins can always approve.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {staff.map((u: any) => {
            const isAdminUser = u.role === "admin";
            const isMgr = !!(u.isManager ?? u.is_manager);
            const canApprove = isAdminUser || isMgr;
            return (
              <button
                key={u.id}
                type="button"
                disabled={isAdminUser || toggle.isPending}
                title={isAdminUser ? "Admins can always approve" : isMgr ? "Click to remove manager" : "Click to make manager"}
                onClick={() => { if (!isAdminUser) toggle.mutate({ id: u.id, is_manager: !isMgr }); }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  canApprove
                    ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
                    : "bg-background text-foreground border-border hover:bg-muted"
                } ${isAdminUser ? "cursor-default opacity-90" : ""}`}
                data-testid={`manager-toggle-${u.id}`}
              >
                {isAdminUser ? <Shield className="w-3.5 h-3.5" /> : <Star className={`w-3.5 h-3.5 ${isMgr ? "fill-current" : ""}`} />}
                {u.name}
                {isAdminUser && <span className="text-[10px] opacity-80">admin</span>}
              </button>
            );
          })}
          {staff.length === 0 && <p className="text-sm text-muted-foreground">No active team members.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function CompSheetButton({ compId, label = "Comp PDF" }: { compId: number; label?: string }) {
  // A real <a target="_blank"> rather than window.open() — Chrome's popup
  // blocker silently blocks scripted window.open, but genuine link clicks open.
  return (
    <a
      href={"/api/comp/" + compId + "/sheet?print=1"}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
      data-testid={"comp-pdf-" + compId}
      title="Open a full printable comp request (with receipts) to save as PDF"
    >
      <FileText className="w-3 h-3" /> {label}
    </a>
  );
}

// ── Filtering / search / sort helpers ─────────────────────────────────────────
// All client-side over the full list so the stat cards and Payout Center keep
// working off complete data; only the rendered rows are filtered + windowed.
type StageFilter = "all" | "pending" | "approved" | "processing" | "paid" | "denied";

function matchesStage(r: CompItem, f: StageFilter): boolean {
  switch (f) {
    case "pending": return r.status === "pending";
    case "approved": return r.status === "approved" && !r.isProcessing && !r.isPaid && !r.isReceived;
    case "processing": return r.status === "approved" && r.isProcessing && !r.isPaid && !r.isReceived;
    case "paid": return r.status === "approved" && (r.isPaid || r.isReceived);
    case "denied": return r.status === "denied";
    default: return true;
  }
}

function matchesCat(r: CompItem, cat: string): boolean {
  if (cat === "all") return true;
  if (cat === "transfers") return r.category === "transfers" || r.category === "leads";
  return r.category === cat;
}

function matchesText(r: CompItem, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (r.userName || "").toLowerCase().includes(s)
    || (r.description || "").toLowerCase().includes(s)
    || (r.note || "").toLowerCase().includes(s);
}

// Lower rank = more urgent: needs approval, then needs payout, then settled.
function actionRank(r: CompItem): number {
  if (r.status === "pending") return 0;
  if (r.status === "approved" && !r.isPaid && !r.isReceived) return 1;
  return 2;
}

function compareComps(a: CompItem, b: CompItem, sort: string): number {
  if (sort === "amount") return (b.amountCents || 0) - (a.amountCents || 0);
  if (sort === "name") return (a.userName || "").localeCompare(b.userName || "");
  const dateDesc = String(b.requestedAt ?? b.createdAt ?? "").localeCompare(String(a.requestedAt ?? a.createdAt ?? ""));
  if (sort === "newest") return dateDesc;
  const ra = actionRank(a), rb = actionRank(b);
  if (ra !== rb) return ra - rb;
  return dateDesc;
}

function stageCounts(list: CompItem[]): Record<StageFilter, number> {
  const c: Record<StageFilter, number> = { all: list.length, pending: 0, approved: 0, processing: 0, paid: 0, denied: 0 };
  for (const r of list) {
    if (matchesStage(r, "pending")) c.pending++;
    else if (matchesStage(r, "paid")) c.paid++;
    else if (matchesStage(r, "processing")) c.processing++;
    else if (matchesStage(r, "approved")) c.approved++;
    else if (matchesStage(r, "denied")) c.denied++;
  }
  return c;
}

const STAGE_TABS: { key: StageFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "processing", label: "Processing" },
  { key: "paid", label: "Paid" },
  { key: "denied", label: "Denied" },
];

function CompToolbar({
  search, onSearch, stage, onStage, counts, cat, onCat, sort, onSort, showCategory = true, showNameSort = false,
}: {
  search: string; onSearch: (v: string) => void;
  stage: StageFilter; onStage: (v: StageFilter) => void;
  counts: Record<StageFilter, number>;
  cat: string; onCat: (v: string) => void;
  sort: string; onSort: (v: string) => void;
  showCategory?: boolean; showNameSort?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search name, description, note…"
            className="h-9 pl-8"
            data-testid="comp-search"
          />
          {search && (
            <button type="button" onClick={() => onSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {showCategory && (
          <Select value={cat} onValueChange={onCat}>
            <SelectTrigger className="h-9 w-[150px]" data-testid="comp-cat-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORY_KEYS.map(k => <SelectItem key={k} value={k}>{CATEGORIES[k].label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={onSort}>
          <SelectTrigger className="h-9 w-[170px]" data-testid="comp-sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="action">Needs action first</SelectItem>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="amount">Amount (high → low)</SelectItem>
            {showNameSort && <SelectItem value="name">Name (A → Z)</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STAGE_TABS.map(t => {
          const active = stage === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onStage(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground hover:bg-muted"}`}
              data-testid={"comp-stage-" + t.key}
            >
              {t.label}
              <span className={`tabular-nums ${active ? "text-primary-foreground/80" : "text-muted-foreground/70"}`}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total === 0) return null;
  if (shown >= total) {
    return <p className="text-[11px] text-muted-foreground text-center pt-1">Showing all {total}</p>;
  }
  return (
    <div className="flex flex-col items-center gap-1 pt-1">
      <Button variant="outline" size="sm" className="gap-1" onClick={onMore} data-testid="comp-show-more">
        <ChevronDown className="w-3.5 h-3.5" /> Show more
      </Button>
      <span className="text-[11px] text-muted-foreground">Showing {shown} of {total}</span>
    </div>
  );
}

const PAGE_SIZE = 25;

export default function CompRequests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = !!(user && (user.role === "admin" || (user as any).superAdmin));
  const isManager = !!(user && (user.role === "admin" || (user as any).isManager || (user as any).superAdmin));

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("transfers");
  const [expenseDate, setExpenseDate] = useState("");
  const [note, setNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [compForUserId, setCompForUserId] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const newFileRef = useRef<HTMLInputElement | null>(null);
  const { data: allUsers = [] } = useQuery<any[]>({ queryKey: ["/api/users"], enabled: isManager });
  const clrOptions = (allUsers ?? []).filter((u: any) => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)));

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

  const myRequests = useMemo(() => mine.filter(r => r.status !== "draft"), [mine]);

  const stats = useMemo(() => {
    const sum = (list: CompItem[]) => list.reduce((a, r) => a + (r.amountCents || 0), 0);
    return {
      total: sum(myRequests),
      pending: sum(myRequests.filter(r => r.status === "pending")),
      approved: sum(myRequests.filter(r => r.status === "approved")),
      received: sum(myRequests.filter(r => r.status === "approved" && r.isReceived)),
    };
  }, [myRequests]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const created: any = await apiRequest("POST", "/api/comp", {
        description, category, expenseDate: expenseDate || undefined, note,
        amountCents: Math.round(parseFloat(amount || "0") * 100),
        onBehalfOf: compForUserId ? Number(compForUserId) : undefined,
      });
      // Upload any receipts attached on the form to the new item.
      const newId = created?.id;
      if (newId && pendingFiles.length) {
        for (const f of pendingFiles) {
          try {
            const dataBase64 = await fileToDataUrl(f);
            await apiRequest("POST", "/api/comp/" + newId + "/attachments", { filename: f.name, mime: f.type, dataBase64 });
          } catch {}
        }
      }
      return created;
    },
    onSuccess: (d: any) => {
      const who = compForUserId ? (clrOptions.find((u: any) => String(u.id) === compForUserId)?.name ?? "the CLR") : null;
      toast({
        title: "Submitted for approval",
        description: (who ? "Filed for " + who : "Your comp request is in")
          + (pendingFiles.length ? " with " + pendingFiles.length + " receipt(s)" : "")
          + (d?.emailedTo ? " — emailed to " + d.emailedTo : "") + ".",
      });
      setDescription(""); setAmount(""); setNote(""); setExpenseDate(""); setCompForUserId(""); setPendingFiles([]);
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "denied"; reviewerNote: string }) =>
      apiRequest("POST", "/api/comp/" + v.id + "/decision", { status: v.status, reviewerNote: v.reviewerNote }),
    onSuccess: (_d, v) => { toast({ title: "Comp " + v.status }); refresh(); },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const fulfillMutation = useMutation({
    mutationFn: (v: { id: number; paid?: boolean; processing?: boolean; received?: boolean }) => {
      const body: Record<string, boolean> = {};
      if (v.paid !== undefined) body.paid = v.paid;
      if (v.processing !== undefined) body.processing = v.processing;
      if (v.received !== undefined) body.received = v.received;
      return apiRequest("POST", "/api/comp/" + v.id + "/paid", body);
    },
    onSuccess: () => refresh(),
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", "/api/comp/" + id),
    onSuccess: () => { toast({ title: "Removed" }); refresh(); },
    onError: (e: any) => toast({ title: "Could not remove", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  // ── Edit a request (resubmits it for approval) ─────────────────────────────
  const [editTarget, setEditTarget] = useState<CompItem | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("transfers");
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  function openEdit(r: CompItem) {
    setEditTarget(r);
    setEditDesc(r.description ?? "");
    setEditAmount(((r.amountCents ?? 0) / 100).toString());
    setEditCategory(r.category === "leads" ? "transfers" : (r.category || "transfers"));
    setEditDate(r.expenseDate ?? "");
    setEditNote(r.note ?? "");
  }
  const editMutation = useMutation({
    mutationFn: (v: { id: number; body: any }) => apiRequest("PATCH", "/api/comp/" + v.id, v.body),
    onSuccess: (d: any) => {
      const resubmitted = d?.status === "pending";
      toast({
        title: resubmitted ? "Edited & resubmitted" : "Saved",
        description: resubmitted ? "Your changes were saved and the request was sent back for approval." : "Changes saved.",
      });
      setEditTarget(null);
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message ?? "Try again.", variant: "destructive" }),
  });
  function saveEdit() {
    if (!editTarget) return;
    const amountCents = Math.round(parseFloat(editAmount || "0") * 100);
    if (!editDesc.trim()) { toast({ title: "Description required", variant: "destructive" }); return; }
    if (!(amountCents > 0)) { toast({ title: "Enter an amount greater than 0", variant: "destructive" }); return; }
    editMutation.mutate({ id: editTarget.id, body: { description: editDesc.trim(), category: editCategory, amountCents, expenseDate: editDate || undefined, note: editNote } });
  }

  // ── Deny an already-approved request (reverse approval) ────────────────────
  const [denyTarget, setDenyTarget] = useState<CompItem | null>(null);
  const [denyNote, setDenyNote] = useState("");

  // ── "Ask manager": client-side prompt pointing the CLR to their manager ────
  function askManager(r: CompItem) {
    toast({
      title: "Questions about this request?",
      description: "Reach out to " + (r.reviewerName || "your manager") + " for more information on this comp request.",
    });
  }

  // ── Payout Center: approved-but-unpaid requests, batch payout ──────────────
  // Tracks explicit DE-selections so newly approved items auto-join the run.
  const [payoutExcluded, setPayoutExcluded] = useState<Set<number>>(new Set());
  const approvedUnpaid = useMemo(() => team.filter(r => r.status === "approved" && !r.isPaid), [team]);
  // Group the payout run by BATCH/STAGE rather than by pay date: everything
  // starts in "Awaiting", and when a selection is moved to Processing it
  // physically relocates into the Processing batch (and out of Awaiting).
  const payoutBatches = useMemo(() => {
    const awaiting = approvedUnpaid.filter(r => !r.isProcessing);
    const processing = approvedUnpaid.filter(r => r.isProcessing);
    return [
      { key: "awaiting", title: "Awaiting Processing", stage: "awaiting" as const, items: awaiting },
      { key: "processing", title: "Processing", stage: "processing" as const, items: processing },
    ].filter(b => b.items.length > 0);
  }, [approvedUnpaid]);
  const batchPaidMutation = useMutation({
    mutationFn: (ids: number[]) => apiRequest("POST", "/api/comp/payout/mark-paid", { ids }),
    onSuccess: (d: any) => {
      toast({ title: "Payout recorded 💸", description: (d?.paid ?? 0) + " request(s) marked paid — " + money(d?.totalCents ?? 0) + "." });
      setPayoutExcluded(new Set());
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not mark paid", description: e?.message ?? "Try again.", variant: "destructive" }),
  });
  // Move a batch of requests between the Awaiting and Processing groups.
  const batchProcessingMutation = useMutation({
    mutationFn: async (v: { ids: number[]; processing: boolean }) => {
      for (const id of v.ids) await apiRequest("POST", "/api/comp/" + id + "/paid", { processing: v.processing });
      return v;
    },
    onSuccess: (v: any) => {
      toast({ title: v.processing ? "Moved to Processing" : "Moved back to Awaiting", description: v.ids.length + " request(s) updated." });
      setPayoutExcluded(new Set());
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const amountValid = parseFloat(amount || "0") > 0;
  const canSubmit = !!description.trim() && amountValid && !createMutation.isPending;
  const pendingCount = team.filter(r => r.status === "pending").length;

  // ── Filter / search / sort / windowing (keeps hundreds of rows manageable) ──
  const [teamSearch, setTeamSearch] = useState("");
  const [teamStage, setTeamStage] = useState<StageFilter>("all");
  const [teamCat, setTeamCat] = useState("all");
  const [teamSort, setTeamSort] = useState("action");
  const [teamVisible, setTeamVisible] = useState(PAGE_SIZE);

  const [mySearch, setMySearch] = useState("");
  const [myStage, setMyStage] = useState<StageFilter>("all");
  const [myCat, setMyCat] = useState("all");
  const [mySort, setMySort] = useState("newest");
  const [myVisible, setMyVisible] = useState(PAGE_SIZE);

  const teamCounts = useMemo(() => stageCounts(team), [team]);
  const teamFiltered = useMemo(
    () => team.filter(r => matchesStage(r, teamStage) && matchesCat(r, teamCat) && matchesText(r, teamSearch)).sort((a, b) => compareComps(a, b, teamSort)),
    [team, teamStage, teamCat, teamSearch, teamSort]
  );

  const myCounts = useMemo(() => stageCounts(myRequests), [myRequests]);
  const myFiltered = useMemo(
    () => myRequests.filter(r => matchesStage(r, myStage) && matchesCat(r, myCat) && matchesText(r, mySearch)).sort((a, b) => compareComps(a, b, mySort)),
    [myRequests, myStage, myCat, mySearch, mySort]
  );

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


      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Requested", value: stats.total, icon: Receipt, ring: "ring-slate-200 dark:ring-slate-700", fg: "text-slate-600 dark:text-slate-300" },
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
          {/* What to use comp requests for */}
          <div className="rounded-lg border border-sky-200 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800 px-4 py-3 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 mt-0.5 shrink-0" />
            <p className="text-[13px] text-sky-900 dark:text-sky-200 leading-relaxed">
              Use this for your <strong>monthly transfer request</strong> and anything else that has been <strong>approved to be compensated</strong>.
            </p>
          </div>
          <TransferStatsHint
            forUserId={compForUserId ? Number(compForUserId) : undefined}
            onUse={(text) => { setDescription(text); setCategory("transfers"); }}
          />
          {isManager && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Submit for</label>
              <select
                value={compForUserId}
                onChange={e => setCompForUserId(e.target.value)}
                className="h-9 mt-1 rounded-md border bg-background px-2 text-sm w-full"
                data-testid="select-comp-for"
              >
                <option value="">Myself ({user?.name ?? "me"}) — saves a draft</option>
                {clrOptions.filter((u: any) => u.id !== user?.id).map((u: any) => (
                  <option key={u.id} value={String(u.id)}>{u.name} — submit a request</option>
                ))}
              </select>
              {compForUserId && <p className="text-[11px] text-muted-foreground mt-1">Files a comp request directly for that CLR and emails the approver.</p>}
            </div>
          )}
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
                  {CATEGORY_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>{CATEGORIES[key].label}</SelectItem>
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
          <div>
            <label className="text-xs font-medium text-muted-foreground">Receipts</label>
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 mb-1">
              Please attach a receipt for any requests over $10.
            </p>
            <input
              ref={newFileRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={e => {
                const fs = Array.from(e.target.files ?? []) as File[];
                if (fs.length) setPendingFiles(prev => [...prev, ...fs]);
                if (newFileRef.current) newFileRef.current.value = "";
              }}
              data-testid="input-comp-new-files"
            />
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <button
                type="button"
                onClick={() => newFileRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-primary/5 transition-colors"
                data-testid="button-attach-new"
              >
                <Paperclip className="w-3.5 h-3.5" /> Attach receipt
              </button>
              {pendingFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 pl-2 pr-1 py-0.5 text-[11px]">
                  <Paperclip className="w-3 h-3 shrink-0" />
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="rounded hover:bg-destructive/20 p-0.5 text-muted-foreground hover:text-destructive" aria-label="Remove file">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Images or PDF, up to 8 MB each. Kept for ~1 year.</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} className="gap-1.5" data-testid="button-save-expense">
              <Plus className="w-4 h-4" /> {createMutation.isPending ? (compForUserId ? "Submitting…" : "Saving…") : (compForUserId ? ("Submit for " + (clrOptions.find((u: any) => String(u.id) === compForUserId)?.name ?? "CLR")) : "Save Expense")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Manager management — see + mark who can approve (admins only) */}
      {isAdmin && <ManagersPanel />}

      {/* Payout Center — everything approved & awaiting payout, in one place */}
      {isManager && approvedUnpaid.length > 0 && (
        <Card className="border-emerald-300/60 dark:border-emerald-700/60">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <BadgeDollarSign className="w-4 h-4 text-emerald-600" /> Payout Center
                <Badge className="ml-1 bg-emerald-600 text-white text-[10px] px-1.5">{approvedUnpaid.length} awaiting payout</Badge>
              </CardTitle>
              <Button asChild variant="outline" size="sm" className="gap-1.5" data-testid="button-payout-export-all">
                <a href="/api/comp/payout-sheet?print=1" target="_blank" rel="noopener">
                  <FileText className="w-3.5 h-3.5" /> Export all (PDF)
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Approved &amp; unpaid requests, grouped by batch. Select requests and <strong>Move to Processing</strong> to start a payout batch — they move into the Processing group. Mark a batch <strong>Paid</strong> when it's sent, or use <strong>Export all</strong> for one PDF of everything.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {payoutBatches.map(g => {
              const included = g.items.filter(r => !payoutExcluded.has(r.id));
              const groupTotal = included.reduce((s, r) => s + (r.amountCents || 0), 0);
              const isProcessing = g.stage === "processing";
              const busy = batchPaidMutation.isPending || batchProcessingMutation.isPending;
              return (
                <div key={g.key} className="rounded-lg border border-border overflow-hidden" data-testid={"payout-group-" + g.key}>
                  <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {isProcessing
                        ? <Hourglass className="w-4 h-4 text-indigo-600" />
                        : <Clock className="w-4 h-4 text-emerald-600" />}
                      <span className="text-sm font-semibold">{g.title}</span>
                      <Badge className={`text-[10px] px-1.5 ${isProcessing ? "bg-indigo-600 text-white" : ""}`} variant={isProcessing ? "default" : "outline"}>
                        {g.items.length} request{g.items.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(groupTotal)}</span>
                  </div>
                  <div className="divide-y divide-border">
                    {g.items.map(r => {
                      const inc = !payoutExcluded.has(r.id);
                      return (
                        <label key={r.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${inc ? "" : "opacity-50 bg-muted/30"}`} data-testid={"payout-row-" + r.id}>
                          <Checkbox
                            checked={inc}
                            onCheckedChange={(v) => setPayoutExcluded(prev => { const n = new Set(prev); if (v) n.delete(r.id); else n.add(r.id); return n; })}
                            data-testid={"payout-check-" + r.id}
                          />
                          <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold">{r.userName}</span>
                            <CatChip category={r.category} />
                            <span className="text-sm text-muted-foreground truncate">{r.description}</span>
                            {(r.attachmentCount ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"><Paperclip className="w-3 h-3" />{r.attachmentCount}</span>
                            )}
                          </div>
                          <span className="text-sm font-semibold tabular-nums shrink-0">{money(r.amountCents)}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border px-3 py-2">
                    <span className="text-xs text-muted-foreground">{included.length} of {g.items.length} selected</span>
                    <div className="flex items-center gap-2">
                      {included.length === 0 ? (
                        <Button variant="outline" size="sm" className="gap-1.5" disabled>
                          <FileText className="w-3.5 h-3.5" /> PDF
                        </Button>
                      ) : (
                        <Button asChild variant="outline" size="sm" className="gap-1.5">
                          <a href={`/api/comp/payout-sheet?ids=${included.map(r => r.id).join(",")}&print=1`} target="_blank" rel="noopener">
                            <FileText className="w-3.5 h-3.5" /> PDF
                          </a>
                        </Button>
                      )}
                      {isProcessing ? (
                        <Button
                          variant="outline" size="sm" className="gap-1.5"
                          onClick={() => batchProcessingMutation.mutate({ ids: included.map(r => r.id), processing: false })}
                          disabled={included.length === 0 || busy}
                          data-testid={"button-payout-unprocess-" + g.key}
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" /> Back to Awaiting
                        </Button>
                      ) : (
                        <Button
                          size="sm" className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                          onClick={() => batchProcessingMutation.mutate({ ids: included.map(r => r.id), processing: true })}
                          disabled={included.length === 0 || busy}
                          data-testid={"button-payout-process-" + g.key}
                        >
                          <Hourglass className="w-3.5 h-3.5" />
                          {batchProcessingMutation.isPending ? "Moving…" : "Move to Processing"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => batchPaidMutation.mutate(included.map(r => r.id))}
                        disabled={included.length === 0 || busy}
                        data-testid={"button-payout-mark-paid-" + g.key}
                      >
                        <Check className="w-3.5 h-3.5" />
                        {batchPaidMutation.isPending ? "Marking…" : "Mark paid"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Manager: team comp requests */}
      {isManager && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Team Comp Requests
              {pendingCount > 0 && <Badge className="ml-1 bg-amber-500 text-white text-[10px] px-1.5">{pendingCount} pending</Badge>}
            </CardTitle>
            <div className="mt-2"><PayoutTimingNote /></div>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : team.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No comp requests submitted yet.</p>
            ) : (
              <>
                <CompToolbar
                  search={teamSearch} onSearch={(v) => { setTeamSearch(v); setTeamVisible(PAGE_SIZE); }}
                  stage={teamStage} onStage={(v) => { setTeamStage(v); setTeamVisible(PAGE_SIZE); }}
                  counts={teamCounts}
                  cat={teamCat} onCat={(v) => { setTeamCat(v); setTeamVisible(PAGE_SIZE); }}
                  sort={teamSort} onSort={(v) => { setTeamSort(v); setTeamVisible(PAGE_SIZE); }}
                  showCategory showNameSort
                />
                {teamFiltered.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No requests match your filters.</p>
                ) : (
                  teamFiltered.slice(0, teamVisible).map(r => (
                <div key={r.id} className="rounded-lg border px-4 py-3" data-testid={"team-comp-" + r.id}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{r.userName}</span>
                        <CatChip category={r.category} />
                        <StatusBadge status={r.status} isPaid={r.isPaid} isProcessing={r.isProcessing} isReceived={r.isReceived} />
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
                    {r.status === "approved" && (
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <label className="flex items-center gap-2 text-xs cursor-pointer" title="Flip on while this request is being processed for payout">
                          <span className={r.isProcessing ? "text-indigo-600 font-medium" : "text-muted-foreground"}>
                            {r.isProcessing ? "Processing" : "Mark processing"}
                          </span>
                          <Switch
                            checked={r.isProcessing}
                            onCheckedChange={(v) => fulfillMutation.mutate({ id: r.id, processing: v })}
                            disabled={fulfillMutation.isPending || r.isPaid}
                            data-testid={"team-switch-processing-" + r.id}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer" title="Mark when this reimbursement has been paid out">
                          <span className={r.isPaid ? "text-sky-600 font-medium" : "text-muted-foreground"}>
                            {r.isPaid ? "Paid out" : "Mark paid out"}
                          </span>
                          <Switch
                            checked={r.isPaid}
                            onCheckedChange={(v) => fulfillMutation.mutate({ id: r.id, paid: v })}
                            disabled={fulfillMutation.isPending}
                            data-testid={"team-switch-paid-" + r.id}
                          />
                        </label>
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                          onClick={() => { setDenyTarget(r); setDenyNote(""); }}
                          disabled={decideMutation.isPending || r.isPaid || r.isReceived}
                          title={r.isPaid || r.isReceived ? "Already paid — can't deny" : "Reverse this approval"}
                          data-testid={"team-deny-approved-" + r.id}
                        >
                          <X className="w-3.5 h-3.5" /> Deny
                        </Button>
                      </div>
                    )}
                  </div>
                  <CompStageTracker status={r.status} isPaid={r.isPaid} isProcessing={r.isProcessing} isReceived={r.isReceived} />
                  <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                    <Attachments compId={r.id} count={r.attachmentCount ?? 0} canEdit={false} />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => askManager(r)}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
                        title="Have a question? Reach out to your manager."
                        data-testid={"team-ask-manager-" + r.id}
                      >
                        <HelpCircle className="w-3 h-3" /> Ask manager
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
                        title="Edit this request (resubmits it for approval)"
                        data-testid={"team-edit-comp-" + r.id}
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      <CompSheetButton compId={r.id} label="Full PDF for payout" />
                    </div>
                  </div>
                </div>
                  ))
                )}
                <ShowMore shown={Math.min(teamVisible, teamFiltered.length)} total={teamFiltered.length} onMore={() => setTeamVisible(v => v + PAGE_SIZE)} />
              </>
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
          <div className="mt-2"><PayoutTimingNote /></div>
        </CardHeader>
        <CardContent className="space-y-2">
          {mineLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No comp requests yet. Submit an expense above and it goes straight to your approver.</p>
          ) : (
            <>
              <CompToolbar
                search={mySearch} onSearch={(v) => { setMySearch(v); setMyVisible(PAGE_SIZE); }}
                stage={myStage} onStage={(v) => { setMyStage(v); setMyVisible(PAGE_SIZE); }}
                counts={myCounts}
                cat={myCat} onCat={(v) => { setMyCat(v); setMyVisible(PAGE_SIZE); }}
                sort={mySort} onSort={(v) => { setMySort(v); setMyVisible(PAGE_SIZE); }}
                showCategory
              />
              {myFiltered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No requests match your filters.</p>
              ) : (
                myFiltered.slice(0, myVisible).map(r => (
              <div key={r.id} className="rounded-lg border px-4 py-3" data-testid={"my-comp-" + r.id}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold tabular-nums">{money(r.amountCents)}</span>
                      <CatChip category={r.category} />
                      <StatusBadge status={r.status} isPaid={r.isPaid} isProcessing={r.isProcessing} isReceived={r.isReceived} />
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
                <CompStageTracker status={r.status} isPaid={r.isPaid} isProcessing={r.isProcessing} isReceived={r.isReceived} />
                <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                  <Attachments compId={r.id} count={r.attachmentCount ?? 0} canEdit={r.status === "pending"} />
                  <div className="flex items-center gap-2">
                    {r.status !== "pending" && (
                      <button
                        type="button"
                        onClick={() => askManager(r)}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
                        title="Have a question? Reach out to your manager."
                        data-testid={"ask-manager-" + r.id}
                      >
                        <HelpCircle className="w-3 h-3" /> Ask manager
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
                      title="Edit this request (resubmits it for approval)"
                      data-testid={"edit-comp-" + r.id}
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <CompSheetButton compId={r.id} />
                  </div>
                </div>
              </div>
                ))
              )}
              <ShowMore shown={Math.min(myVisible, myFiltered.length)} total={myFiltered.length} onMore={() => setMyVisible(v => v + PAGE_SIZE)} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog — saving resubmits the request for approval */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Edit comp request</DialogTitle>
            <DialogDescription>
              {editTarget && editTarget.status !== "draft"
                ? "Saving your changes resubmits this request for approval (it goes back to pending)."
                : "Update the details of this request."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Amount (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" min="0" step="0.01" inputMode="decimal" value={editAmount} onChange={e => setEditAmount(e.target.value)} placeholder="0.00" className="pl-6" data-testid="edit-comp-amount" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger data-testid="edit-comp-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_KEYS.map((key) => <SelectItem key={key} value={key}>{CATEGORIES[key].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Date spent</label>
                <Input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} data-testid="edit-comp-date" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} maxLength={300} placeholder="What did you spend on?" data-testid="edit-comp-description" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
              <Textarea value={editNote} onChange={e => setEditNote(e.target.value)} rows={2} maxLength={1000} placeholder="Receipt link, context, etc." data-testid="edit-comp-note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)} disabled={editMutation.isPending}>Cancel</Button>
            <Button size="sm" className="gap-1.5" onClick={saveEdit} disabled={editMutation.isPending}>
              <Send className="w-3.5 h-3.5" />
              {editMutation.isPending ? "Saving…" : (editTarget && editTarget.status !== "draft" ? "Save & resubmit" : "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deny confirmation — reverses an approval */}
      <AlertDialog open={!!denyTarget} onOpenChange={(o) => { if (!o) { setDenyTarget(null); setDenyNote(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deny this approved request?</AlertDialogTitle>
            <AlertDialogDescription>
              {denyTarget ? `${denyTarget.userName} · ${money(denyTarget.amountCents)} — ${denyTarget.description}. ` : ""}
              This reverses the approval and marks the request denied. The requester is notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="Reason (optional)"
            value={denyNote}
            onChange={e => setDenyNote(e.target.value)}
            className="h-9 text-sm"
            data-testid="deny-approved-note"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decideMutation.isPending}>Keep approved</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (denyTarget) decideMutation.mutate({ id: denyTarget.id, status: "denied", reviewerNote: denyNote }); }}
              disabled={decideMutation.isPending}
            >
              {decideMutation.isPending ? "Denying…" : "Deny request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
