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
import { Phone, Lock, RefreshCw } from "lucide-react";
import { InfoBanner } from "@/components/info-banner";

type Session = {
  id: number;
  session_date: string;
  clr_user_id: number | null;
  clr_name: string | null;
  clr_user_name: string | null;
  total_calls: number;
  contacts_reached: number;
  dnc_hits: number;
  transfers: number;
  appointments: number;
  voicemails: number;
  no_answers: number;
  source: string;
  updated_at: string;
};

type Settings = {
  mojoSecret: string;
  bonzoSecret: string;
  bonzoApiToken: string;
  mojoApiKey: string;
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

export default function MojoSessionsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    document.title = "Mojo Sessions · WCLCC";
  }, []);

  const isAdmin = user?.role === "admin";
  const [clrId, setClrId] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/webhook/settings"], enabled: isAdmin });
  const hasKey = !!settings?.mojoApiKey?.trim();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (clrId !== "all") p.set("clrUserId", clrId);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    return p.toString();
  }, [clrId, startDate, endDate]);

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: [`/api/mojo/sessions${qs ? `?${qs}` : ""}`],
  });

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const { data: syncStatus } = useQuery<SyncLogResp>({
    queryKey: ["/api/mojo/sync-log"],
    enabled: isAdmin,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 15000),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/mojo/sync/sessions"),
    onSuccess: (r: any) => {
      if (r?.note) {
        toast({ title: "Sync triggered", description: r.note });
      } else {
        toast({ title: "Sync complete", description: `Synced ${r.records_synced ?? 0} sessions.` });
      }
      queryClient.invalidateQueries({ queryKey: [`/api/mojo/sessions${qs ? `?${qs}` : ""}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/mojo/sync-log"] });
    },
    onError: (e: any) => {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    },
  });

  const clrUsers = useMemo(
    () => users.filter((u: any) => u.role === "assistant" || u.role === "admin"),
    [users]
  );

  const totalStats = useMemo(() => {
    return sessions.reduce(
      (acc, s) => ({
        calls: acc.calls + (s.total_calls ?? 0),
        contacts: acc.contacts + (s.contacts_reached ?? 0),
        transfers: acc.transfers + (s.transfers ?? 0),
        appointments: acc.appointments + (s.appointments ?? 0),
      }),
      { calls: 0, contacts: 0, transfers: 0, appointments: 0 }
    );
  }, [sessions]);

  const running = !!syncStatus?.running || syncMutation.isPending;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl">
      <InfoBanner storageKey="mojo_sessions_status" variant="info" title="Mojo Session Tracking">
        Call data flows in automatically via webhook whenever a disposition is logged in Mojo. To backfill historical call data, use the <strong>Mojo CSV Import</strong> tool. Full API sync will be available when Mojo releases their public API.
      </InfoBanner>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Mojo Sessions</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Daily dialer session summaries per CLR. Webhook data flows in automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            hasKey ? (
              <Button onClick={() => syncMutation.mutate()} disabled={running}>
                <RefreshCw className={`w-4 h-4 mr-1.5 ${running ? "animate-spin" : ""}`} />
                {running ? "Syncing..." : "Import from Mojo"}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button disabled>
                      <Lock className="w-4 h-4 mr-1.5" />
                      Import from Mojo
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Configure Mojo API key in Integrations to enable this.
                </TooltipContent>
              </Tooltip>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Calls</div>
          <div className="text-2xl font-bold">{totalStats.calls.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Contacts</div>
          <div className="text-2xl font-bold">{totalStats.contacts.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Transfers</div>
          <div className="text-2xl font-bold">{totalStats.transfers.toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Appointments</div>
          <div className="text-2xl font-bold">{totalStats.appointments.toLocaleString()}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <Select value={clrId} onValueChange={setClrId}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="CLR" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All CLRs</SelectItem>
              {clrUsers.map((u: any) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[160px]" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[160px]" />
          </div>
          {(startDate || endDate || clrId !== "all") && (
            <Button variant="ghost" size="sm" onClick={() => { setStartDate(""); setEndDate(""); setClrId("all"); }}>
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">CLR</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Contacts</th>
                  <th className="px-3 py-2 text-right">DNC</th>
                  <th className="px-3 py-2 text-right">Transfers</th>
                  <th className="px-3 py-2 text-right">Appts</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">Loading...</td></tr>
                ) : sessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Phone className="w-8 h-8 text-muted-foreground/40" />
                        <div className="text-sm font-medium">No sessions recorded yet</div>
                        <div className="text-xs text-muted-foreground max-w-md">
                          {hasKey
                            ? "Webhook data flows in automatically as calls happen. You can also trigger a manual import above."
                            : "Session data will appear automatically as Mojo webhook events arrive. Add your Mojo API key in Integrations to import historical sessions."}
                        </div>
                        {isAdmin && !hasKey && (
                          <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate("/integrations")}>
                            Go to Integrations
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.id} className="border-t hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs">{s.session_date}</td>
                      <td className="px-3 py-2">{s.clr_user_name ?? s.clr_name ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.total_calls}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.contacts_reached}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.dnc_hits}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.transfers}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.appointments}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{s.source}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {isAdmin && syncStatus?.last && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sync Status</CardTitle>
            <CardDescription>
              Last sync: {new Date(syncStatus.last.started_at).toLocaleString()} —{" "}
              {syncStatus.last.status} ({syncStatus.last.records_synced ?? 0} records)
              {syncStatus.last.error_message && (
                <span className="text-muted-foreground"> — {syncStatus.last.error_message}</span>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
