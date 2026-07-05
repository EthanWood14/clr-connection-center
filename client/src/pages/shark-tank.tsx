import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Fish, Search, Download, RefreshCw, PhoneCall, Flame, Snowflake } from "lucide-react";

type SharkLead = {
  id: number;
  externalId: string;
  borrowerName: string | null;
  phone: string | null;
  state: string | null;
  city: string | null;
  loanPurpose: string | null;
  ownerName: string | null;
  stage: string | null;
  bucket: string | null;
  sourceCreatedAt: string | null;
  lastSyncedAt: string | null;
  lastContactedAt: string | null;
};
type LeadsResp = { rows: SharkLead[]; total: number };
type MetaResp = {
  configured: boolean;
  sync: { lastRunAt: string | null; lastStatus: string | null; lastError: string | null; syncedCount: number; prunedCount: number; durationMs: number } | null;
};

const PAGE_SIZE = 50;

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}

// "3 mo ago" style age used for the last-contact column — the whole point of
// the priority sort is seeing at a glance who has gone the longest untouched.
function ago(iso: string | null) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function fmtPhone(p: string | null) {
  if (!p) return "—";
  const d = p.replace(/\D+/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  return p;
}

export default function SharkTank() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = !!(user && (user.role === "admin" || (user as any).isManager || (user as any).superAdmin));

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sort, setSort] = useState("priority");
  const [page, setPage] = useState(0);

  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (stateFilter.trim()) params.set("state", stateFilter.trim());
  params.set("sort", sort);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading } = useQuery<LeadsResp>({
    queryKey: ["/api/shark-tank/leads", search, stateFilter, sort, page],
    queryFn: () => apiRequest("GET", `/api/shark-tank/leads?${params.toString()}`),
  });
  const { data: meta } = useQuery<MetaResp>({
    queryKey: ["/api/shark-tank/meta"],
    queryFn: () => apiRequest("GET", "/api/shark-tank/meta"),
  });

  const syncMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/shark-tank/sync", {}),
    onSuccess: (d: any) => {
      toast(d?.ok
        ? { title: "Pool refreshed", description: `${d.synced} synced, ${d.pruned} pruned.` }
        : { title: "Sync failed", description: d?.error ?? "Try again.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/shark-tank/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shark-tank/meta"] });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e?.message, variant: "destructive" }),
  });

  function exportCsv() {
    const p = new URLSearchParams();
    if (search.trim()) p.set("search", search.trim());
    if (stateFilter.trim()) p.set("state", stateFilter.trim());
    p.set("sort", sort);
    window.open(`/api/shark-tank/export?${p.toString()}`, "_blank");
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><Fish className="w-40 h-40" /></div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <Fish className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Shark Tank</h1>
            <p className="text-sm text-white/60">
              Cold, re-workable leads synced daily from LeadVault. Coldest first — the top of the list has gone the longest without a touch.
            </p>
          </div>
        </div>
      </div>

      {!meta?.configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          The LeadVault feed token isn't configured (CLR_SHARK_FEED_TOKEN), so the pool can't sync.
        </div>
      )}

      {/* Filters + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-8" placeholder="Search name, phone, city…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            data-testid="shark-search"
          />
        </div>
        <Input
          className="w-20 uppercase" placeholder="State" maxLength={2}
          value={stateFilter}
          onChange={e => { setStateFilter(e.target.value); setPage(0); }}
          data-testid="shark-state"
        />
        <Select value={sort} onValueChange={v => { setSort(v); setPage(0); }}>
          <SelectTrigger className="w-44" data-testid="shark-sort"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Coldest first</SelectItem>
            <SelectItem value="oldest">Oldest lead</SelectItem>
            <SelectItem value="newest">Newest lead</SelectItem>
          </SelectContent>
        </Select>
        {isManager && (
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} data-testid="shark-export">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => syncMut.mutate()} disabled={syncMut.isPending} data-testid="shark-sync">
              <RefreshCw className={"w-3.5 h-3.5" + (syncMut.isPending ? " animate-spin" : "")} /> {syncMut.isPending ? "Syncing…" : "Refresh pool"}
            </Button>
          </>
        )}
      </div>

      {/* Pool */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No leads match. {total === 0 && !search && !stateFilter ? "The pool is empty — run a refresh or check the feed token." : ""}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Borrower</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                    <th className="px-3 py-2 font-medium">Purpose</th>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">Lead Created</th>
                    <th className="px-3 py-2 font-medium">Last Contacted</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{r.borrowerName || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {r.phone ? (
                          <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                            <PhoneCall className="w-3 h-3" /> {fmtPhone(r.phone)}
                          </a>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.loanPurpose || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.stage || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.sourceCreatedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.lastContactedAt ? (
                          <Badge variant="outline" className="gap-1 font-normal">
                            <Flame className="w-3 h-3 text-amber-500" /> {ago(r.lastContactedAt)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 font-normal text-sky-600 dark:text-sky-400 border-sky-300 dark:border-sky-800">
                            <Snowflake className="w-3 h-3" /> Never
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer: paging + sync meta */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {total.toLocaleString()} lead{total === 1 ? "" : "s"}
          {meta?.sync?.lastRunAt ? ` · pool synced ${fmtDate(meta.sync.lastRunAt)}${meta.sync.lastStatus && meta.sync.lastStatus !== "ok" ? ` (${meta.sync.lastStatus})` : ""}` : ""}
        </span>
        {pageCount > 1 && (
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
            Page {page + 1} of {pageCount}
            <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
          </span>
        )}
      </div>
    </div>
  );
}
