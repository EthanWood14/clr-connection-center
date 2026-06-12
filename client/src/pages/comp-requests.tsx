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
  CreditCard, Hourglass, Megaphone, Plane, Laptop, Building2, Tag, BadgeDollarSign, Paperclip, Info, FileText, ArrowLeftRight, Star, Shield, UserCog,
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
      {onUse && prev && (
        <button
          type="button"
          onClick={() => onUse("Monthly transfer request — " + prev.month + " (" + prev.transfers + " transfer" + plural(prev.transfers) + ")")}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-300 hover:underline"
          data-testid="button-use-transfers"
        >
          <Plus className="w-3 h-3" /> Use last month for this request
        </button>
      )}
    </div>
  );
}

// Visual pipeline so you can see at a glance where a request sits:
// Waiting Approval → Approved → Paid. Denied requests show a denied state.
function CompStageTracker({ status, isPaid, isReceived }: { status: CompItem["status"]; isPaid?: boolean; isReceived?: boolean }) {
  if (status === "draft") return null;
  if (status === "denied") {
    return (
      <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
        <X className="w-3.5 h-3.5" /> Denied
      </div>
    );
  }
  const stages = ["Waiting Approval", "Approved", "Paid"];
  const current = status === "pending" ? 0 : (isPaid || isReceived) ? 2 : 1;
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
  return (
    <button
      type="button"
      onClick={() => window.open("/api/comp/" + compId + "/sheet?print=1", "_blank", "noopener")}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
      data-testid={"comp-pdf-" + compId}
      title="Open a full printable comp request (with receipts) to save as PDF"
    >
      <FileText className="w-3 h-3" /> {label}
    </button>
  );
}

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

  // ── Payout Center: approved-but-unpaid requests, batch payout ──────────────
  // Tracks explicit DE-selections so newly approved items auto-join the run.
  const [payoutExcluded, setPayoutExcluded] = useState<Set<number>>(new Set());
  const approvedUnpaid = useMemo(() => team.filter(r => r.status === "approved" && !r.isPaid), [team]);
  const payoutItems = useMemo(() => approvedUnpaid.filter(r => !payoutExcluded.has(r.id)), [approvedUnpaid, payoutExcluded]);
  const payoutTotal = useMemo(() => payoutItems.reduce((s, r) => s + (r.amountCents || 0), 0), [payoutItems]);
  const batchPaidMutation = useMutation({
    mutationFn: (ids: number[]) => apiRequest("POST", "/api/comp/payout/mark-paid", { ids }),
    onSuccess: (d: any) => {
      toast({ title: "Payout recorded 💸", description: (d?.paid ?? 0) + " request(s) marked paid — " + money(d?.totalCents ?? 0) + "." });
      setPayoutExcluded(new Set());
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not mark paid", description: e?.message ?? "Try again.", variant: "destructive" }),
  });
  function openPayoutSheet() {
    const ids = payoutItems.map(r => r.id).join(",");
    window.open("/api/comp/payout-sheet?ids=" + ids + "&print=1", "_blank", "noopener");
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
            <CardTitle className="text-base flex items-center gap-2">
              <BadgeDollarSign className="w-4 h-4 text-emerald-600" /> Payout Center
              <Badge className="ml-1 bg-emerald-600 text-white text-[10px] px-1.5">{approvedUnpaid.length} awaiting payout</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Everything approved and not yet paid. Open one combined PDF (all requests + receipts) to send to whoever pays out, then mark the whole run paid in one click.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              {approvedUnpaid.map(r => {
                const included = !payoutExcluded.has(r.id);
                return (
                  <label key={r.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${included ? "" : "opacity-50 bg-muted/30"}`} data-testid={"payout-row-" + r.id}>
                    <Checkbox
                      checked={included}
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
            <div className="flex items-center justify-between gap-3 flex-wrap border-t pt-3">
              <div className="text-sm">
                <span className="text-muted-foreground">{payoutItems.length} selected · total</span>{" "}
                <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{money(payoutTotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="gap-1.5" onClick={openPayoutSheet} disabled={payoutItems.length === 0} data-testid="button-payout-pdf">
                  <FileText className="w-4 h-4" /> Payout PDF
                </Button>
                <Button
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => batchPaidMutation.mutate(payoutItems.map(r => r.id))}
                  disabled={payoutItems.length === 0 || batchPaidMutation.isPending}
                  data-testid="button-payout-mark-paid"
                >
                  <Check className="w-4 h-4" />
                  {batchPaidMutation.isPending ? "Marking…" : `Mark ${payoutItems.length} paid`}
                </Button>
              </div>
            </div>
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
                    {r.status === "approved" && (
                      <label className="flex items-center gap-2 text-xs cursor-pointer shrink-0" title="Mark when this reimbursement has been paid out">
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
                    )}
                  </div>
                  <CompStageTracker status={r.status} isPaid={r.isPaid} isReceived={r.isReceived} />
                  <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                    <Attachments compId={r.id} count={r.attachmentCount ?? 0} canEdit={false} />
                    <CompSheetButton compId={r.id} label="Full PDF for payout" />
                  </div>
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
            <p className="text-sm text-muted-foreground py-4 text-center">No comp requests yet. Submit an expense above and it goes straight to your approver.</p>
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
                <CompStageTracker status={r.status} isPaid={r.isPaid} isReceived={r.isReceived} />
                <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                  <Attachments compId={r.id} count={r.attachmentCount ?? 0} canEdit={r.status === "pending"} />
                  <CompSheetButton compId={r.id} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
