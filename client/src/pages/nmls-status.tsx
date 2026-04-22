import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, RefreshCw, ExternalLink, Search, CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { parseDbTimestamp } from "@/lib/utils";

interface NmlsItem {
  id: number;
  fullName: string;
  nmlsId: string | null;
  nmlsStatus: string | null;
  nmlsStates: string[];
  nmlsLastChecked: string | null;
  nmlsLicenseExpiration: string | null;
  profileUrl: string | null;
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "Unknown").toLowerCase();
  if (s === "active") {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1"><ShieldCheck className="w-3 h-3" />Active</Badge>;
  }
  if (s === "expired" || s === "inactive") {
    return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 gap-1"><ShieldAlert className="w-3 h-3" />{status}</Badge>;
  }
  return <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 gap-1"><ShieldQuestion className="w-3 h-3" />Unknown</Badge>;
}

export default function NmlsStatus() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ items: NmlsItem[] }>({
    queryKey: ["/api/nmls/status"],
    refetchInterval: 60000,
  });

  const checkAll = useMutation({
    mutationFn: () => apiRequest("POST", "/api/nmls/check-all", {}),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/nmls/status"] });
      toast({
        title: "NMLS verification complete",
        description: `Checked ${r.checked ?? 0}. Blocked: ${r.blocked ?? 0}. Flagged: ${r.flagged ?? 0}.`,
      });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  const checkOne = useMutation({
    mutationFn: (loId: number) => apiRequest("POST", `/api/nmls/check/${loId}`, {}),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/nmls/status"] });
      if (r.blocked) {
        toast({ title: "NMLS blocked automated check", description: "Use the direct link to verify manually." });
      } else {
        toast({ title: "Check complete", description: `Status: ${r.status}` });
      }
    },
    onError: () => toast({ title: "Check failed", variant: "destructive" }),
  });

  const markVerified = useMutation({
    mutationFn: (loId: number) =>
      apiRequest("POST", `/api/nmls/mark-verified/${loId}`, { status: "Active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nmls/status"] });
      toast({ title: "Marked as verified" });
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const filtered = items.filter(i =>
    !search ||
    i.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (i.nmlsId ?? "").includes(search)
  );

  const counts = {
    active: items.filter(i => i.nmlsStatus === "Active").length,
    flagged: items.filter(i => i.nmlsStatus === "Inactive" || i.nmlsStatus === "Expired").length,
    unknown: items.filter(i => !i.nmlsStatus || i.nmlsStatus === "Unknown").length,
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1200px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            NMLS License Status
          </h1>
          <p className="text-sm text-muted-foreground">
            Auto-verified nightly. Use Refresh All to check now.
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => checkAll.mutate()}
            disabled={checkAll.isPending}
            data-testid="button-nmls-refresh-all"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${checkAll.isPending ? "animate-spin" : ""}`} />
            {checkAll.isPending ? "Checking…" : "Refresh All"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Active</div><div className="text-2xl font-semibold text-green-700 dark:text-green-400">{counts.active}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Flagged</div><div className="text-2xl font-semibold text-red-700 dark:text-red-400">{counts.flagged}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Unknown / Unchecked</div><div className="text-2xl font-semibold text-gray-600">{counts.unknown}</div></CardContent></Card>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Note:</strong> NMLS Consumer Access frequently blocks automated requests with a Cloudflare challenge. When blocked, we cannot read the license status — click the direct link and use <em>Mark Verified</em> to record confirmation manually.
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder="Search by name or NMLS ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-nmls-search"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No LOs match your filters.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => (
            <Card key={item.id} data-testid={`card-nmls-${item.id}`}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{item.fullName}</span>
                      <StatusBadge status={item.nmlsStatus} />
                      {item.nmlsId && item.profileUrl && (
                        <a
                          href={item.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400 hover:underline"
                        >
                          NMLS #{item.nmlsId} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {!item.nmlsId && <span className="text-xs text-orange-600">No NMLS ID on file</span>}
                    </div>
                    {item.nmlsStates.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {item.nmlsStates.map(s => (
                          <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">{s}</Badge>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1.5">
                      {item.nmlsLastChecked
                        ? `Last checked ${formatDistanceToNow(parseDbTimestamp(item.nmlsLastChecked) ?? new Date(), { addSuffix: true })}`
                        : "Never checked"}
                      {item.nmlsLicenseExpiration && ` · Expires ${item.nmlsLicenseExpiration}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {item.nmlsId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => checkOne.mutate(item.id)}
                        disabled={checkOne.isPending}
                        data-testid={`button-nmls-check-${item.id}`}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 mr-1 ${checkOne.isPending && checkOne.variables === item.id ? "animate-spin" : ""}`} />
                        Check
                      </Button>
                    )}
                    {item.nmlsId && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => markVerified.mutate(item.id)}
                        disabled={markVerified.isPending}
                        data-testid={`button-nmls-mark-${item.id}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Mark Verified
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
