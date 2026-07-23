import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link2, Copy, RefreshCw, ExternalLink, Search, CircleDot } from "lucide-react";

type Subject = {
  type: "lo" | "loa"; id: number; name: string; loName: string | null;
  status: string; token: string; url: string; onShift: boolean;
};

export default function ClockLinks() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");

  const { data, isLoading, isError } = useQuery<{ subjects: Subject[] }>({
    queryKey: ["/api/portal-links"],
    queryFn: () => apiRequest("GET", "/api/portal-links"),
    retry: false, // a 403 shouldn't spin — show the message
  });

  const rotate = useMutation({
    mutationFn: (v: { type: string; id: number }) => apiRequest("POST", `/api/portal-links/${v.type}/${v.id}/rotate`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/portal-links"] }); toast({ title: "Link rotated", description: "The old link no longer works." }); },
    onError: (e: any) => toast({ title: "Couldn't rotate", description: e?.message, variant: "destructive" }),
  });

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => toast({ title: "Link copied" }),
      () => toast({ title: "Copy failed", description: url, variant: "destructive" }),
    );
  };

  const subjects = (data?.subjects ?? []).filter((s) =>
    !q.trim() || s.name.toLowerCase().includes(q.toLowerCase()) || (s.loName ?? "").toLowerCase().includes(q.toLowerCase()));
  const los = subjects.filter((s) => s.type === "lo");
  const loas = subjects.filter((s) => s.type === "loa");
  const onShift = (data?.subjects ?? []).filter((s) => s.onShift).length;

  const Row = ({ s }: { s: Subject }) => (
    <div className="flex items-center gap-2 px-3 py-2.5" data-testid={`link-row-${s.type}-${s.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate flex items-center gap-1.5">
          {s.onShift && <CircleDot className="w-3 h-3 text-emerald-500 shrink-0" />}
          {s.name}
          {s.type === "loa" && s.loName && <span className="text-xs text-muted-foreground font-normal">· {s.loName}</span>}
          {s.status && s.status !== "active" && <Badge variant="outline" className="text-[9px] px-1 py-0">{s.status}</Badge>}
        </p>
        <p className="text-[11px] text-muted-foreground font-mono truncate">{s.url}</p>
      </div>
      <Button size="sm" variant="outline" className="h-8 gap-1 shrink-0" onClick={() => copy(s.url)} data-testid={`copy-${s.type}-${s.id}`}>
        <Copy className="w-3.5 h-3.5" /> Copy
      </Button>
      <a href={s.url} target="_blank" rel="noreferrer" title="Open link">
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><ExternalLink className="w-3.5 h-3.5" /></Button>
      </a>
      {isAdmin && (
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Rotate (invalidates the old link)"
          disabled={rotate.isPending} onClick={() => { if (confirm(`Rotate ${s.name}'s link? Their current bookmark will stop working.`)) rotate.mutate({ type: s.type, id: s.id }); }}
          data-testid={`rotate-${s.type}-${s.id}`}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><Link2 className="w-40 h-40" /></div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <Link2 className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Clock-In Links</h1>
            <p className="text-sm text-white/60">Personal links for LOs and LOAs to clock in and set their schedule — no login needed.</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800 px-4 py-3 text-[13px] text-sky-900 dark:text-sky-200">
        Each link is personal and secret — hand it to that one person (text/email) and have them bookmark it. Anyone with the link can clock in and edit the schedule as that person, so treat it like a password. Rotate a link if it's ever shared or lost.
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search LO or LOA…" className="h-9 pl-8" />
        </div>
        <p className="text-xs text-muted-foreground">{onShift} on shift now</p>
      </div>

      {isError ? (
        <Card><CardContent className="py-16 text-center space-y-1">
          <p className="font-medium text-sm">Can't load clock-in links</p>
          <p className="text-xs text-muted-foreground">This page is for admins only.</p>
        </CardContent></Card>
      ) : isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Loan Officers ({los.length})</p>
            <Card><CardContent className="p-0 divide-y">
              {los.length ? los.map((s) => <Row key={`lo-${s.id}`} s={s} />) : <p className="p-6 text-sm text-muted-foreground text-center">No loan officers.</p>}
            </CardContent></Card>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Loan Officer Assistants ({loas.length})</p>
            <Card><CardContent className="p-0 divide-y">
              {loas.length ? loas.map((s) => <Row key={`loa-${s.id}`} s={s} />) : <p className="p-6 text-sm text-muted-foreground text-center">No LOAs.</p>}
            </CardContent></Card>
          </div>
        </div>
      )}
    </div>
  );
}
