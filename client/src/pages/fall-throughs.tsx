// Fall-Throughs — a team-wide, all-time log of every appointment/lead that fell
// through. Pulls only fell_through outcomes (server-filtered) across all CLRs and
// dates, with search, a CLR filter, a date-range filter, and row windowing so it
// stays fast even with a long history. The server also drops any fall-through
// whose lead was later transferred again (matched by journey id / phone / name+LO),
// so a recovered lead disappears from the list once it converts.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { TrendingDown, Search, Phone, User as UserIcon, ArrowUpRight, RefreshCw } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { businessTodayClient, addIsoDays } from "@/lib/business-day";

type FT = {
  id: number;
  borrowerName?: string | null;
  notes?: string | null;
  phoneNumber?: string | null;
  date?: string | null;
  followUpDate?: string | null;
  lo?: { id: number; fullName?: string | null } | null;
  assistant?: { id: number; name?: string | null; email?: string | null } | null;
};

const PAGE_SIZE = 50;

const RANGE_OPTIONS = [
  { value: "all", label: "All time", days: null as number | null },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "365", label: "Last 12 months", days: 365 },
];

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const parsed = parseISO(String(d).slice(0, 10));
  return isValid(parsed) ? format(parsed, "MMM d, yyyy") : String(d);
}

export default function FallThroughs() {
  const [search, setSearch] = useState("");
  const [clrFilter, setClrFilter] = useState<string>("all");
  const [range, setRange] = useState<string>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const { data: rows = [], isLoading } = useQuery<FT[]>({
    queryKey: ["/api/outcomes", "fell_through"],
    queryFn: () => fetch("/api/outcomes?outcomeType=fell_through", { credentials: "include" }).then(r => r.json()),
  });

  // CLR options derived from the data itself.
  const clrOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of rows) {
      const id = r.assistant?.id;
      if (id != null) map.set(id, (r.assistant?.name && r.assistant.name.trim()) || r.assistant?.email || `CLR #${id}`);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const cutoff = useMemo(() => {
    const opt = RANGE_OPTIONS.find(o => o.value === range);
    if (!opt || opt.days == null) return null;
    return addIsoDays(businessTodayClient(), -opt.days);
  }, [range]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => {
        if (clrFilter !== "all" && String(r.assistant?.id) !== clrFilter) return false;
        if (cutoff && (String(r.date ?? "").slice(0, 10) < cutoff)) return false;
        if (q) {
          const hay = [
            r.borrowerName ?? "",
            r.lo?.fullName ?? "",
            r.assistant?.name ?? "",
            r.notes ?? "",
            r.phoneNumber ?? "",
          ].join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      // Already date-DESC from the server, but re-sort defensively.
      .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  }, [rows, search, clrFilter, cutoff]);

  // Reset the window whenever the filters change.
  useEffect(() => { setVisible(PAGE_SIZE); }, [search, clrFilter, range]);

  const windowed = filtered.slice(0, visible);

  // ── Resurrect: any CLR can revive a fall-through and record they got the transfer ──
  const { toast } = useToast();
  const [resTarget, setResTarget] = useState<FT | null>(null);
  const [resType, setResType] = useState<"direct" | "appointment">("direct");
  const [resNote, setResNote] = useState("");

  const resurrectMutation = useMutation({
    mutationFn: (v: { id: number; transferType: string; notes: string }) =>
      apiRequest("POST", `/api/outcomes/${v.id}/resurrect`, { transferType: v.transferType, notes: v.notes }),
    onSuccess: () => {
      // Refreshes this list (the row is now a transfer), plus appointments + stats.
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      setResTarget(null); setResNote(""); setResType("direct");
      toast({ title: "🎉 Transfer recorded", description: "The fall-through was resurrected and credited to you." });
    },
    onError: (e: any) => toast({ title: "Couldn't resurrect", description: e?.message ?? "Try again", variant: "destructive" }),
  });

  function openResurrect(r: FT) { setResTarget(r); setResType("direct"); setResNote(""); }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2">
        <TrendingDown className="w-5 h-5 text-rose-600 dark:text-rose-400" />
        <h1 className="text-lg font-semibold">Fall-Throughs</h1>
        <Badge variant="outline" className="ml-1 text-xs border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400">
          {isLoading ? "…" : filtered.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Every appointment or lead that fell through, across all CLRs and all time.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search borrower, LO, CLR, notes…"
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select value={clrFilter} onValueChange={setClrFilter}>
          <SelectTrigger className="w-44 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All CLRs</SelectItem>
            {clrOptions.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-40 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No fall-throughs found{search || clrFilter !== "all" || range !== "all" ? " for these filters" : " yet"}.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Borrower</th>
                    <th className="px-3 py-2 font-medium">Loan Officer</th>
                    <th className="px-3 py-2 font-medium">CLR</th>
                    <th className="px-3 py-2 font-medium">Notes</th>
                    <th className="px-3 py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {windowed.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(r.date)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.borrowerName?.trim() || "Unknown Borrower"}</div>
                        {r.phoneNumber && (
                          <a href={`tel:${r.phoneNumber}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <Phone className="w-3 h-3" />{r.phoneNumber}
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.lo?.fullName || (r.lo?.id ? `LO #${r.lo.id}` : "—")}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.assistant?.name || (r.assistant?.id ? `CLR #${r.assistant.id}` : "—")}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[28rem]">
                        <span className="whitespace-pre-wrap leading-relaxed">{r.notes?.trim() || "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs gap-1 whitespace-nowrap border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                          onClick={() => openResurrect(r)}
                        >
                          <ArrowUpRight className="w-3 h-3" /> Got transfer
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {windowed.map(r => (
              <Card key={r.id}>
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{r.borrowerName?.trim() || "Unknown Borrower"}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{fmtDate(r.date)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span><span className="font-medium text-foreground/70">LO:</span> {r.lo?.fullName || "—"}</span>
                    <span className="inline-flex items-center gap-1"><UserIcon className="w-3 h-3" />{r.assistant?.name || "—"}</span>
                    {r.phoneNumber && (
                      <a href={`tel:${r.phoneNumber}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Phone className="w-3 h-3" />{r.phoneNumber}
                      </a>
                    )}
                  </div>
                  {r.notes?.trim() && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{r.notes}</p>
                  )}
                  <Button
                    size="sm" variant="outline"
                    className="h-8 w-full text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                    onClick={() => openResurrect(r)}
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" /> I got the transfer
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {windowed.length < filtered.length && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={() => setVisible(v => v + PAGE_SIZE)}>
                Show more ({filtered.length - windowed.length} more)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Resurrect dialog — record that the current CLR landed the transfer */}
      <Dialog open={!!resTarget} onOpenChange={(o) => { if (!o) setResTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
              Got the transfer?
            </DialogTitle>
            <DialogDescription className="text-sm">
              <span className="font-medium text-foreground">{resTarget?.borrowerName?.trim() || "Unknown Borrower"}</span>
              {resTarget?.lo?.fullName ? ` · LO: ${resTarget.lo.fullName}` : ""}
              <br />
              This resurrects the fall-through as a transfer credited to you, dated today.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/70">Transfer type</label>
              <Select value={resType} onValueChange={(v) => setResType(v as "direct" | "appointment")}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct">Direct transfer</SelectItem>
                  <SelectItem value="appointment">Appointment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/70">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                value={resNote}
                onChange={(e) => setResNote(e.target.value)}
                rows={3}
                placeholder="How you revived it…"
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setResTarget(null)} disabled={resurrectMutation.isPending}>Cancel</Button>
            <Button
              size="sm" className="gap-1.5"
              onClick={() => resTarget && resurrectMutation.mutate({ id: resTarget.id, transferType: resType, notes: resNote })}
              disabled={resurrectMutation.isPending}
            >
              {resurrectMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
              Mark as my transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
