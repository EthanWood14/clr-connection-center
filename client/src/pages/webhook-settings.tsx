import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseDbTimestamp, copyToClipboard } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Copy, Eye, EyeOff, Save, Webhook, CheckCircle2, Circle } from "lucide-react";
import { useLocation } from "wouter";
import { formatLocalTime } from "@/lib/dates";

const MOJO_URL = "https://www.westcapitallending.center/api/webhook/mojo";
const BONZO_URL = "https://www.westcapitallending.center/api/webhook/bonzo";

type Settings = { mojoSecret: string; bonzoSecret: string };
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

function CopyBtn({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        copyToClipboard(value);
        toast({ title: "Copied!", description: value });
      }}
    >
      <Copy className="w-3.5 h-3.5 mr-1" /> Copy
    </Button>
  );
}

function WebhookPanel({
  label, url, secretKey, secretValue, onChange,
}: {
  label: string;
  url: string;
  secretKey: "mojoSecret" | "bonzoSecret";
  secretValue: string;
  onChange: (k: "mojoSecret" | "bonzoSecret", v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {label} Webhook URL
        </label>
        <div className="flex gap-2 mt-1.5">
          <Input readOnly value={url} className="font-mono text-xs" />
          <CopyBtn value={url} />
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Paste this URL into {label}'s outbound webhook configuration.
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Optional Secret (sent as <code className="text-xs bg-muted px-1 py-0.5 rounded">X-{label}-Secret</code> header)
        </label>
        <div className="flex gap-2 mt-1.5">
          <Input
            type={show ? "text" : "password"}
            value={secretValue}
            onChange={(e) => onChange(secretKey, e.target.value)}
            placeholder="(leave blank to disable verification)"
            className="font-mono text-xs"
          />
          <Button variant="outline" size="sm" onClick={() => setShow(s => !s)}>
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function WebhookSettingsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Webhooks · WCLCC";
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

  const [local, setLocal] = useState<Settings>({ mojoSecret: "", bonzoSecret: "" });
  useEffect(() => {
    if (settings) setLocal({ mojoSecret: settings.mojoSecret, bonzoSecret: settings.bonzoSecret });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (next: Settings) => apiRequest("PUT", "/api/webhook/settings", next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhook/settings"] });
      toast({ title: "Saved", description: "Webhook secrets updated." });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (user && user.role !== "admin") return null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-2">
        <Webhook className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Configure inbound webhooks from Mojo Dialer and Bonzo CRM. CLRs are matched by phone number (primary) then name (fallback). Make sure each CLR has their phone number set in their profile.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integration Endpoints</CardTitle>
          <CardDescription>These URLs accept POST requests from external services. No authentication cookies required — use the optional secret header to verify requests.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="mojo">
            <TabsList>
              <TabsTrigger value="mojo">Mojo Dialer</TabsTrigger>
              <TabsTrigger value="bonzo">Bonzo CRM</TabsTrigger>
            </TabsList>
            <TabsContent value="mojo" className="pt-4">
              <WebhookPanel
                label="Mojo"
                url={MOJO_URL}
                secretKey="mojoSecret"
                secretValue={local.mojoSecret}
                onChange={(k, v) => setLocal(prev => ({ ...prev, [k]: v }))}
              />
            </TabsContent>
            <TabsContent value="bonzo" className="pt-4">
              <WebhookPanel
                label="Bonzo"
                url={BONZO_URL}
                secretKey="bonzoSecret"
                secretValue={local.bonzoSecret}
                onChange={(k, v) => setLocal(prev => ({ ...prev, [k]: v }))}
              />
            </TabsContent>
          </Tabs>
          <div className="flex justify-end mt-4">
            <Button
              onClick={() => saveMutation.mutate(local)}
              disabled={isLoading || saveMutation.isPending}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" /> Save Secrets
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Events</CardTitle>
          <CardDescription>Last 20 inbound webhook events (auto-refreshes every 15s).</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Event Type</th>
                  <th className="px-3 py-2">Matched CLR</th>
                  <th className="px-3 py-2">Processed</th>
                  <th className="px-3 py-2">Received</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 20).map((e) => {
                  const matched = !!e.matched_user_id;
                  return (
                    <tr key={e.id} className="border-t">
                      <td className="px-3 py-2">
                        {matched ? (
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="matched" />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="unmatched" />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs uppercase">{e.source}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.event_type ?? "—"}</td>
                      <td className="px-3 py-2">{e.matched_user_name ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2">
                        {e.processed ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <Circle className="w-4 h-4 text-muted-foreground" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {parseDbTimestamp(e.created_at)?.toLocaleString() ?? "—"}
                      </td>
                    </tr>
                  );
                })}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
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
