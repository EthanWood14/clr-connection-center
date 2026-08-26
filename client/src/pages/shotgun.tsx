import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Clock3, Mail, Phone, Radio, RefreshCw, Send, ShieldCheck, Trash2, Users, Zap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { STATE_CALL_RULES } from "@/data/state-call-hours";
import { ShotgunResultCard } from "@/components/shotgun-result-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type ShotgunLead = {
  id: number;
  leadName: string;
  phone: string;
  email: string;
  stateCode: string;
  source: string;
  managerNotes: string;
  status: "queued" | "offered" | "claimed" | "done" | "cancelled";
  createdByName: string;
  currentAssigneeId: number | null;
  currentAssigneeName: string | null;
  offerExpiresAt: string | null;
  claimedAt: string | null;
  called: boolean;
  texted: boolean;
  resultNotes: string;
  transferOutcomeId: number | null;
  transferType: "direct" | "appointment" | null;
  transferLoName: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShotgunPayload = {
  canManage: boolean; canPublish?: boolean;
  isClr: boolean;
  isReady: boolean;
  offerSeconds: number;
  serverNow: string;
  leads: ShotgunLead[];
  readyUsers: Array<{ id: number; name: string; heartbeat_at: string }>;
};

function statusStyle(status: ShotgunLead["status"]) {
  if (status === "done") return "bg-emerald-600";
  if (status === "claimed") return "bg-blue-600";
  if (status === "offered") return "bg-amber-500";
  if (status === "cancelled") return "bg-red-700";
  return "bg-slate-500";
}

function ManagerLeadActions({ lead, requeue, cancel }: { lead: ShotgunLead; requeue: (id: number) => void; cancel: (id: number) => void }) {
  const canRequeue = lead.status === "offered" || lead.status === "claimed";
  const canCancel = lead.status === "queued" || lead.status === "offered" || lead.status === "claimed";
  if (!canRequeue && !canCancel) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {canRequeue && (
        <AlertDialog>
          <AlertDialogTrigger asChild><Button size="sm" variant="outline">Requeue</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Requeue {lead.leadName}?</AlertDialogTitle><AlertDialogDescription>This returns the lead to the rotation, clears the prior CLR&apos;s call/text progress, and keeps the offer history for accountability.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Keep assigned</AlertDialogCancel><AlertDialogAction onClick={() => requeue(lead.id)}>Requeue lead</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {canCancel && (
        <AlertDialog>
          <AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="gap-1 text-red-700 hover:bg-red-50 hover:text-red-800"><Trash2 className="h-3.5 w-3.5" /> Cancel</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Cancel {lead.leadName}?</AlertDialogTitle><AlertDialogDescription>The lead will leave the active rotation immediately. Its history remains available on the board.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Keep active</AlertDialogCancel><AlertDialogAction className="bg-red-700 hover:bg-red-800" onClick={() => cancel(lead.id)}>Cancel lead</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function LeadHeader({ lead }: { lead: ShotgunLead }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-black">{lead.leadName}</h3>
          <Badge className={statusStyle(lead.status)}>{lead.status.toUpperCase()}</Badge>
          {lead.stateCode && <Badge variant="secondary">{lead.stateCode}</Badge>}
          {lead.source && <Badge variant="outline">{lead.source}</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          {lead.phone && <span className="flex items-center gap-1.5 font-semibold"><Phone className="h-4 w-4" />{lead.phone}</span>}
          {lead.email && <a className="flex items-center gap-1.5 text-blue-600 hover:underline" href={`mailto:${lead.email}`}><Mail className="h-4 w-4" />{lead.email}</a>}
        </div>
        {lead.managerNotes && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{lead.managerNotes}</p>}
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        {lead.currentAssigneeName && <p><strong className="text-foreground">{lead.currentAssigneeName}</strong></p>}
        {lead.status === "offered" && <p className="mt-1 flex items-center justify-end gap-1 text-amber-600"><Clock3 className="h-3.5 w-3.5" /> Awaiting confirmation</p>}
      </div>
    </div>
  );
}

export default function Shotgun() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [leadName, setLeadName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [source, setSource] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const { data, isLoading } = useQuery<ShotgunPayload>({ queryKey: ["/api/shotgun"], refetchInterval: 5_000, staleTime: 0 });
  const payload = data ?? { canManage: false, canPublish: false, isClr: false, isReady: false, offerSeconds: 20, serverNow: new Date().toISOString(), leads: [], readyUsers: [] };
  const readiness = useMutation({
    mutationFn: (ready: boolean) => apiRequest("POST", "/api/shotgun/readiness", { ready }),
    onSuccess: (result: any) => { queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }); toast({ title: result.isReady ? "You are READY" : "You are no longer in the rotation", description: result.isReady ? "Keep C3 open. New leads can now come directly to you." : "No new Shotgun leads will be offered to you." }); },
    onError: (error: any) => toast({ title: "Could not change readiness", description: error.message, variant: "destructive" }),
  });
  const publish = useMutation({
    mutationFn: () => apiRequest("POST", "/api/shotgun/publish", { leadName, phone, email, stateCode, source, managerNotes }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] });
      setLeadName(""); setPhone(""); setEmail(""); setStateCode(""); setSource(""); setManagerNotes("");
      toast({ title: result.assigned ? "Lead fired into the rotation" : "Lead queued", description: result.assigned ? `A ready CLR has ${payload.offerSeconds} seconds to confirm it.` : "It will launch as soon as a CLR is online." });
    },
    onError: (error: any) => toast({ title: "Could not publish lead", description: error.message, variant: "destructive" }),
  });
  const requeue = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/shotgun/${id}/requeue`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }); toast({ title: "Lead requeued", description: "Prior progress was cleared and the assignment history was preserved." }); },
    onError: (error: any) => toast({ title: "Could not requeue lead", description: error.message, variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/shotgun/${id}/cancel`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }); toast({ title: "Lead cancelled", description: "It is out of the active rotation; its history was retained." }); },
    onError: (error: any) => toast({ title: "Could not cancel lead", description: error.message, variant: "destructive" }),
  });
  const myActive = useMemo(() => payload.leads.filter((lead) => lead.currentAssigneeId === user?.id && lead.status === "claimed"), [payload.leads, user?.id]);

  if (isLoading) return <div className="mx-auto max-w-7xl p-6"><div className="h-72 animate-pulse rounded-3xl bg-muted" /></div>;
  return (
    <div className="min-h-full bg-gradient-to-b from-orange-50/70 via-background to-rose-50/50 p-4 dark:from-orange-950/15 dark:to-rose-950/10 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-rose-950 to-orange-600 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div><Badge className="mb-3 border-white/20 bg-white/10 text-white"><Zap className="mr-1 h-3 w-3" /> 20-second lead routing</Badge><h1 className="flex items-center gap-3 text-3xl font-black sm:text-4xl"><Radio className="h-9 w-9 text-orange-300" /> Shotgun</h1><p className="mt-2 max-w-2xl text-sm text-white/70">One lead. One ready CLR. Twenty seconds to confirm—then C3 automatically moves it to the next person.</p></div>
            {payload.isClr && <Button size="lg" disabled={readiness.isPending} onClick={() => readiness.mutate(!payload.isReady)} className={payload.isReady ? "gap-2 border border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600" : "gap-2 bg-white text-slate-950 hover:bg-orange-100"}>{payload.isReady ? <><ShieldCheck className="h-5 w-5" /> READY — receiving leads</> : <><Radio className="h-5 w-5" /> Press Ready</>}</Button>}
          </div>
        </header>

        {(payload.canManage || payload.canPublish) && (
          <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-orange-600" /> Publish a lead</CardTitle></CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>Lead name</Label><Input value={leadName} onChange={(event) => setLeadName(event.target.value)} placeholder="First and last name" /></div>
                  <div className="space-y-1.5"><Label>Lead source</Label><Input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Meta, referral, website…" /></div>
                  <div className="space-y-1.5"><Label>Phone</Label><Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(555) 555-5555" /></div>
                  <div className="space-y-1.5"><Label>Email</Label><Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="lead@example.com" /></div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Lead state {phone.trim() ? "(required for calls)" : "(optional)"}</Label>
                    <Select value={stateCode} onValueChange={setStateCode}><SelectTrigger data-testid="shotgun-state"><SelectValue placeholder="Select state for calling-hours protection" /></SelectTrigger><SelectContent>{STATE_CALL_RULES.map((rule) => <SelectItem key={rule.state} value={rule.state}>{rule.state} — {rule.name}</SelectItem>)}</SelectContent></Select>
                  </div>
                </div>
                <div className="space-y-1.5"><Label>What should the CLR know?</Label><Textarea rows={3} value={managerNotes} onChange={(event) => setManagerNotes(event.target.value)} placeholder="Context, urgency, product, preferred callback…" /></div>
                <Button size="lg" className="gap-2 bg-orange-600 hover:bg-orange-700" disabled={publish.isPending || leadName.trim().length < 2 || (!phone.trim() && !email.trim()) || (!!phone.trim() && !stateCode)} onClick={() => publish.mutate()}><Zap className="h-5 w-5" /> Publish to Shotgun</Button>
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-emerald-600" /> Ready right now <Badge variant="secondary">{payload.readyUsers.length}</Badge></CardTitle></CardHeader><CardContent>{payload.readyUsers.length ? <div className="space-y-2">{payload.readyUsers.map((person) => <div key={person.id} className="flex items-center gap-3 rounded-xl border bg-emerald-50/60 p-3 dark:bg-emerald-950/20"><span className="h-3 w-3 animate-pulse rounded-full bg-emerald-500" /><span className="font-semibold">{person.name}</span><span className="ml-auto text-xs text-emerald-700">Ready</span></div>)}</div> : <div className="py-10 text-center text-sm text-muted-foreground"><Users className="mx-auto mb-3 h-10 w-10 opacity-30" />No CLRs are ready. Published leads will wait safely in queue.</div>}</CardContent></Card>
          </div>
        )}

        {myActive.length > 0 && <section className="space-y-3"><h2 className="text-xl font-black">Your active leads</h2>{myActive.map((lead) => <Card key={lead.id} className="border-2 border-blue-400 shadow-lg shadow-blue-500/10"><CardContent className="p-5"><LeadHeader lead={lead} /><ShotgunResultCard lead={lead} /></CardContent></Card>)}</section>}

        <section className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-xl font-black">{payload.canManage ? "Live board" : "Your Shotgun history"}</h2><span className="flex items-center gap-1 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3" /> Live</span></div>
          {payload.leads.length === 0 ? <Card className="border-dashed"><CardContent className="py-14 text-center text-muted-foreground"><Zap className="mx-auto mb-3 h-12 w-12 opacity-20" />No Shotgun leads yet.</CardContent></Card> : payload.leads.map((lead) => (
            <Card key={lead.id}><CardContent className="p-5"><LeadHeader lead={lead} />{payload.canManage && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>Published by {lead.createdByName}</span><ManagerLeadActions lead={lead} requeue={(id) => requeue.mutate(id)} cancel={(id) => cancel.mutate(id)} /></div>}{lead.status === "done" && lead.resultNotes && <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">{lead.transferOutcomeId && <p className="mb-1 flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-200"><ArrowRightLeft className="h-4 w-4" /> Transfer logged · {lead.transferLoName ?? "Loan officer"} · {lead.transferType === "appointment" ? "Appointment" : "Direct"}</p>}<strong>Result:</strong> {lead.called ? "Called · " : ""}{lead.texted ? "Texted · " : ""}{lead.resultNotes}</div>}</CardContent></Card>
          ))}
        </section>
      </div>
    </div>
  );
}
