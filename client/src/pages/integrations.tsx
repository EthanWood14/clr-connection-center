import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Copy, Eye, EyeOff, Save, CheckCircle2, Circle, Plug, RefreshCw, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MOJO_URL = "https://www.wlc.it.com/api/webhook/mojo";
const BONZO_URL = "https://www.wlc.it.com/api/webhook/bonzo";

type Settings = {
  mojoSecret: string;
  bonzoSecret: string;
  bonzoApiToken: string;
  mojoApiKey: string;
};

type WebhookEvent = {
  id: number;
  source: string;
  event_type: string | null;
  payload: string;
  matched_user_id: number | null;
  matched_user_name: string | null;
  processed: number;
  created_at: string;
};

type Status = "connected" | "partial" | "not_connected";

function StatusBadge({ status }: { status: Status }) {
  if (status === "connected") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800">
        Connected
      </Badge>
    );
  }
  if (status === "partial") {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800">
        Partial
      </Badge>
    );
  }
  return (
    <Badge className="bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
      Not Connected
    </Badge>
  );
}

function CopyBtn({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast({ title: "Copied!", description: value });
      }}
    >
      <Copy className="w-3.5 h-3.5 mr-1" /> Copy
    </Button>
  );
}

function SecretInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
      <Button type="button" variant="outline" size="sm" onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}

function IntegrationCard({
  logoBg, logoLetter, name, status, description, webhookUrl,
  secret, onSecretChange, apiToken, onApiTokenChange,
  apiTokenLabel, features, onSave, saving,
  hasToken, onSync, syncing, lastSync, syncTooltip,
}: {
  logoBg: string;
  logoLetter: string;
  name: string;
  status: Status;
  description: string;
  webhookUrl: string;
  secret: string;
  onSecretChange: (v: string) => void;
  apiToken: string;
  onApiTokenChange: (v: string) => void;
  apiTokenLabel: string;
  features: { label: string; active: boolean }[];
  onSave: () => void;
  saving: boolean;
  hasToken: boolean;
  onSync: () => void;
  syncing: boolean;
  lastSync: { started_at: string; status: string; records_synced: number; error_message: string | null } | null;
  syncTooltip: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-md flex items-center justify-center text-white font-bold text-lg shrink-0 ${logoBg}`}>
            {logoLetter}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">{name}</CardTitle>
              <StatusBadge status={status} />
            </div>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Webhook URL
          </label>
          <div className="flex gap-2 mt-1.5">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <CopyBtn value={webhookUrl} />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Webhook Secret (optional)
          </label>
          <div className="mt-1.5">
            <SecretInput
              value={secret}
              onChange={onSecretChange}
              placeholder="(leave blank to disable verification)"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {apiTokenLabel}
          </label>
          <div className="mt-1.5">
            <SecretInput
              value={apiToken}
              onChange={onApiTokenChange}
              placeholder="(not yet configured)"
            />
          </div>
        </div>

        <div className="pt-2 border-t">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            What's connected
          </div>
          <ul className="space-y-1.5 text-sm">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                {f.active ? (
                  <span className="text-green-600 dark:text-green-400 shrink-0">✅</span>
                ) : (
                  <span className="shrink-0">⏳</span>
                )}
                <span className={f.active ? "" : "text-muted-foreground"}>{f.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-2 border-t space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-muted-foreground">
              {lastSync ? (
                <>
                  <span className="font-semibold">Last synced:</span>{" "}
                  {new Date(lastSync.started_at).toLocaleString()} —{" "}
                  <span className={lastSync.status === "error" ? "text-destructive" : lastSync.status === "running" ? "text-blue-600" : "text-green-600"}>
                    {lastSync.status}
                  </span>
                  {" · "}{lastSync.records_synced ?? 0} records
                </>
              ) : (
                <span>No syncs yet</span>
              )}
            </div>
            {hasToken ? (
              <Button size="sm" variant="outline" onClick={onSync} disabled={syncing}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Now"}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button size="sm" variant="outline" disabled>
                      <Lock className="w-3.5 h-3.5 mr-1.5" />
                      Sync Now
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{syncTooltip}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {lastSync?.error_message && (
            <div className="text-xs text-destructive">{lastSync.error_message}</div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onSave} disabled={saving}>
            <Save className="w-3.5 h-3.5 mr-1.5" />
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Integrations · WCLCC";
  }, []);

  useEffect(() => {
    if (user && user.role !== "admin") navigate("/");
  }, [user, navigate]);

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/webhook/settings"],
    enabled: user?.role === "admin",
  });

  const { data: events = [] } = useQuery<WebhookEvent[]>({
    queryKey: ["/api/webhook/events"],
    enabled: user?.role === "admin",
    refetchInterval: 15000,
  });

  const [local, setLocal] = useState<Settings>({
    mojoSecret: "", bonzoSecret: "", bonzoApiToken: "", mojoApiKey: "",
  });
  useEffect(() => {
    if (settings) {
      setLocal({
        mojoSecret: settings.mojoSecret ?? "",
        bonzoSecret: settings.bonzoSecret ?? "",
        bonzoApiToken: settings.bonzoApiToken ?? "",
        mojoApiKey: settings.mojoApiKey ?? "",
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (next: Partial<Settings>) => apiRequest("PUT", "/api/webhook/settings", next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhook/settings"] });
      toast({ title: "Saved", description: "Integration settings updated." });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const { data: bonzoSyncStatus } = useQuery<{ log: any[]; last: any; running: any }>({
    queryKey: ["/api/bonzo/sync-log"],
    enabled: user?.role === "admin",
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 15000),
  });

  const { data: mojoSyncStatus } = useQuery<{ log: any[]; last: any; running: any }>({
    queryKey: ["/api/mojo/sync-log"],
    enabled: user?.role === "admin",
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 15000),
  });

  const bonzoSyncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bonzo/sync/full"),
    onSuccess: (r: any) => {
      toast({ title: "Bonzo sync complete", description: `${r.records_synced ?? 0} records synced.` });
      queryClient.invalidateQueries({ queryKey: ["/api/bonzo/sync-log"] });
    },
    onError: (e: any) => toast({ title: "Bonzo sync failed", description: e.message, variant: "destructive" }),
  });

  const mojoSyncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mojo/sync/sessions"),
    onSuccess: (r: any) => {
      toast({ title: r?.note ? "Sync triggered" : "Mojo sync complete", description: r?.note ?? `${r.records_synced ?? 0} records synced.` });
      queryClient.invalidateQueries({ queryKey: ["/api/mojo/sync-log"] });
    },
    onError: (e: any) => toast({ title: "Mojo sync failed", description: e.message, variant: "destructive" }),
  });

  const bonzoStatus: Status = useMemo(() => {
    const hasToken = !!(settings?.bonzoApiToken?.trim());
    const hasSecret = !!(settings?.bonzoSecret?.trim());
    if (hasToken) return "connected";
    if (hasSecret) return "partial";
    return "partial";
  }, [settings]);

  const mojoStatus: Status = useMemo(() => {
    const hasKey = !!(settings?.mojoApiKey?.trim());
    const hasSecret = !!(settings?.mojoSecret?.trim());
    if (hasKey) return "connected";
    if (hasSecret) return "partial";
    return "partial";
  }, [settings]);

  const [sourceFilter, setSourceFilter] = useState<"all" | "bonzo" | "mojo">("all");
  const filteredEvents = useMemo(() => {
    const filtered = sourceFilter === "all"
      ? events
      : events.filter((e) => e.source === sourceFilter);
    return filtered.slice(0, 30);
  }, [events, sourceFilter]);

  if (user && user.role !== "admin") return null;

  const bonzoFeatures = [
    { label: "Real-time stage change notifications", active: true },
    { label: "New prospect alerts", active: true },
    { label: "Conversation tracking", active: true },
    { label: "Historical prospect import (requires API token)", active: !!(local.bonzoApiToken?.trim()) },
    { label: "Full pipeline sync (requires API token)", active: !!(local.bonzoApiToken?.trim()) },
    { label: "Contact list import (requires API token)", active: !!(local.bonzoApiToken?.trim()) },
  ];

  const mojoFeatures = [
    { label: "Auto call count tracking", active: true },
    { label: "Contacts reached tracking", active: true },
    { label: "DNC hit tracking", active: true },
    { label: "Auto outcome logging for transfers/appointments", active: true },
    { label: "Historical call log import (requires Mojo API — not yet available)", active: !!(local.mojoApiKey?.trim()) },
    { label: "Session data sync (requires Mojo API — not yet available)", active: !!(local.mojoApiKey?.trim()) },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-2">
        <Plug className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Connect external software to the CLR Connection Center. CLRs are matched by phone number (primary) then name (fallback). Make sure each CLR has their phone number set in their profile.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <IntegrationCard
          logoBg="bg-violet-600"
          logoLetter="B"
          name="Bonzo CRM"
          status={bonzoStatus}
          description="Syncs prospect pipeline stages, conversations, and messages. Stage changes trigger CLR notifications in real time via webhook. When a valid API token is provided, historical prospects and pipeline data can be imported."
          webhookUrl={BONZO_URL}
          secret={local.bonzoSecret}
          onSecretChange={(v) => setLocal((p) => ({ ...p, bonzoSecret: v }))}
          apiToken={local.bonzoApiToken}
          onApiTokenChange={(v) => setLocal((p) => ({ ...p, bonzoApiToken: v }))}
          apiTokenLabel="Personal Access Token — available when Bonzo enables external API access"
          features={bonzoFeatures}
          onSave={() => saveMutation.mutate({
            bonzoSecret: local.bonzoSecret,
            bonzoApiToken: local.bonzoApiToken,
          })}
          saving={isLoading || saveMutation.isPending}
          hasToken={!!(settings?.bonzoApiToken?.trim())}
          onSync={() => bonzoSyncMutation.mutate()}
          syncing={bonzoSyncMutation.isPending || !!bonzoSyncStatus?.running}
          lastSync={bonzoSyncStatus?.last ?? null}
          syncTooltip="Configure Bonzo API token to enable this"
        />

        <IntegrationCard
          logoBg="bg-orange-500"
          logoLetter="M"
          name="Mojo Dialer"
          status={mojoStatus}
          description="Tracks call activity per CLR — calls made, contacts reached, and DNC hits update automatically when a disposition is logged in Mojo. When Mojo releases an API, historical call logs and session data can be imported."
          webhookUrl={MOJO_URL}
          secret={local.mojoSecret}
          onSecretChange={(v) => setLocal((p) => ({ ...p, mojoSecret: v }))}
          apiToken={local.mojoApiKey}
          onApiTokenChange={(v) => setLocal((p) => ({ ...p, mojoApiKey: v }))}
          apiTokenLabel="API Key — for future use when Mojo releases external API access"
          features={mojoFeatures}
          onSave={() => saveMutation.mutate({
            mojoSecret: local.mojoSecret,
            mojoApiKey: local.mojoApiKey,
          })}
          saving={isLoading || saveMutation.isPending}
          hasToken={!!(settings?.mojoApiKey?.trim())}
          onSync={() => mojoSyncMutation.mutate()}
          syncing={mojoSyncMutation.isPending || !!mojoSyncStatus?.running}
          lastSync={mojoSyncStatus?.last ?? null}
          syncTooltip="Configure Mojo API key to enable this"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Webhook Event Log</CardTitle>
              <CardDescription>Last 30 inbound webhook events (auto-refreshes every 15s).</CardDescription>
            </div>
            <div className="flex gap-1">
              {(["all", "bonzo", "mojo"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={sourceFilter === s ? "default" : "outline"}
                  onClick={() => setSourceFilter(s)}
                >
                  {s === "all" ? "All" : s === "bonzo" ? "Bonzo" : "Mojo"}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Event Type</th>
                  <th className="px-3 py-2">Matched CLR</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs uppercase">{e.source}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.event_type ?? "—"}</td>
                    <td className="px-3 py-2">
                      {e.matched_user_name ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {e.processed ? (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="text-xs">Processed</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Circle className="w-4 h-4" />
                          <span className="text-xs">Skipped</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {filteredEvents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No webhook events received yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
