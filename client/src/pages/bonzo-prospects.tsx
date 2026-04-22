import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Users, Search, Lock, RefreshCw, Mail, Phone } from "lucide-react";
import { InfoBanner } from "@/components/info-banner";

type Prospect = {
  id: number;
  bonzo_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  pipeline_id: string | null;
  pipeline_name: string | null;
  stage_id: string | null;
  stage_name: string | null;
  assigned_user_id: number | null;
  assigned_user_name: string | null;
  bonzo_user_name: string | null;
  last_activity_at: string | null;
  updated_at: string;
};

type Settings = {
  mojoSecret: string;
  bonzoSecret: string;
  bonzoApiToken: string;
  mojoApiKey: string;
};

type Pipeline = {
  id: number;
  bonzo_id: string;
  name: string;
  stages: string;
};

type SyncLogResp = {
  log: Array<{
    id: number;
    sync_type: string;
    status: string;
    records_synced: number;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
  }>;
  last: any;
  running: any;
};

export default function BonzoProspectsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Bonzo Prospects · WCLCC";
  }, []);

  const [search, setSearch] = useState("");
  const [pipelineId, setPipelineId] = useState<string>("all");
  const [stageId, setStageId] = useState<string>("all");
  const [assignedId, setAssignedId] = useState<string>("all");

  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/webhook/settings"], enabled: user?.role === "admin" });
  const hasToken = !!settings?.bonzoApiToken?.trim();
  const isAdmin = user?.role === "admin";

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("search", search.trim());
    if (pipelineId !== "all") p.set("pipelineId", pipelineId);
    if (stageId !== "all") p.set("stageId", stageId);
    if (assignedId !== "all") p.set("assignedUserId", assignedId);
    p.set("limit", "200");
    return p.toString();
  }, [search, pipelineId, stageId, assignedId]);

  const { data: prospectsData, isLoading } = useQuery<{ rows: Prospect[]; total: number }>({
    queryKey: [`/api/bonzo/prospects?${qs}`],
  });

  const { data: pipelines = [] } = useQuery<Pipeline[]>({ queryKey: ["/api/bonzo/pipelines"] });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const { data: syncStatus } = useQuery<SyncLogResp>({
    queryKey: ["/api/bonzo/sync-log"],
    enabled: isAdmin,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 15000),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bonzo/sync/full"),
    onSuccess: (r: any) => {
      toast({ title: "Sync complete", description: `Synced ${r.records_synced ?? 0} records.` });
      queryClient.invalidateQueries({ queryKey: [`/api/bonzo/prospects?${qs}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/bonzo/pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bonzo/sync-log"] });
    },
    onError: (e: any) => {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    },
  });

  const prospects = prospectsData?.rows ?? [];
  const total = prospectsData?.total ?? 0;

  const stages = useMemo(() => {
    const found: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const p of prospects) {
      if (p.stage_id && !seen.has(p.stage_id)) {
        seen.add(p.stage_id);
        found.push({ id: p.stage_id, name: p.stage_name ?? p.stage_id });
      }
    }
    return found;
  }, [prospects]);

  const clrUsers = useMemo(
    () => users.filter((u: any) => u.role === "assistant" || u.role === "admin"),
    [users]
  );

  const running = !!syncStatus?.running || syncMutation.isPending;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl">
      {hasToken ? (
        <InfoBanner storageKey="bonzo_connected" variant="success" title="Bonzo Connected">
          API sync is active. Last synced: {syncStatus?.last ? new Date(syncStatus.last).toLocaleString() : "—"}. Click Sync Now to refresh.
        </InfoBanner>
      ) : (
        <InfoBanner storageKey="bonzo_no_token" variant="warning" title="Bonzo API Not Connected">
          Real-time webhook events are active (stage changes appear automatically). To import your full prospect history, go to <strong>Integrations → Bonzo</strong> and add your Personal Access Token, then click Sync Now.
        </InfoBanner>
      )}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Bonzo Prospects</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {total.toLocaleString()} prospect{total === 1 ? "" : "s"} imported from Bonzo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            hasToken ? (
              <Button onClick={() => syncMutation.mutate()} disabled={running}>
                <RefreshCw className={`w-4 h-4 mr-1.5 ${running ? "animate-spin" : ""}`} />
                {running ? "Syncing..." : "Import from Bonzo"}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button disabled>
                      <Lock className="w-4 h-4 mr-1.5" />
                      Import from Bonzo
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Configure Bonzo API token in Integrations to enable this.
                </TooltipContent>
              </Tooltip>
            )
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name, email, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={pipelineId} onValueChange={setPipelineId}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Pipeline" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Pipelines</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p.bonzo_id} value={p.bonzo_id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stageId} onValueChange={setStageId}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignedId} onValueChange={setAssignedId}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="CLR" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All CLRs</SelectItem>
              {clrUsers.map((u: any) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Pipeline</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Assigned CLR</th>
                  <th className="px-3 py-2">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      Loading...
                    </td>
                  </tr>
                ) : prospects.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Users className="w-8 h-8 text-muted-foreground/40" />
                        <div className="text-sm font-medium">No prospects imported yet</div>
                        <div className="text-xs text-muted-foreground max-w-md">
                          {hasToken
                            ? "Click \"Import from Bonzo\" to pull your prospects and pipelines."
                            : "Configure your Bonzo API token in Integrations to import prospects."}
                        </div>
                        {isAdmin && !hasToken && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => navigate("/integrations")}
                          >
                            Go to Integrations
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  prospects.map((p) => {
                    const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
                    return (
                      <tr key={p.id} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">{name}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-0.5 text-xs">
                            {p.email && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Mail className="w-3 h-3" />{p.email}
                              </span>
                            )}
                            {p.phone && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Phone className="w-3 h-3" />{p.phone}
                              </span>
                            )}
                            {!p.email && !p.phone && <span className="text-muted-foreground">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {p.pipeline_name ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {p.stage_name ? (
                            <Badge variant="outline" className="text-xs">{p.stage_name}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {p.assigned_user_name ?? p.bonzo_user_name ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {p.last_activity_at ? new Date(p.last_activity_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {syncStatus?.last && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sync Status</CardTitle>
            <CardDescription>
              Last sync: {new Date(syncStatus.last.started_at).toLocaleString()} —{" "}
              {syncStatus.last.status} ({syncStatus.last.records_synced ?? 0} records)
              {syncStatus.last.error_message && (
                <span className="text-destructive"> — {syncStatus.last.error_message}</span>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
