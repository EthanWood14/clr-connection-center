import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, CheckCircle2, Phone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { stateCallStatus } from "@/lib/state-call-window";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ShotgunLead } from "@/pages/shotgun";

type LoanOfficer = {
  id: number;
  fullName?: string;
  full_name?: string;
  internalStatus?: string;
  internal_status?: string;
};

export function ShotgunCallLeadButton({ lead }: { lead: ShotgunLead }) {
  const { toast } = useToast();
  const callStatus = stateCallStatus(lead.stateCode);
  const prohibited = callStatus.status === "prohibited";
  const openPhone = useMutation({
    mutationFn: () => apiRequest("POST", `/api/shotgun/${lead.id}/open-phone`, {}),
    onSuccess: () => { window.location.href = `tel:${lead.phone}`; },
    onError: (error: any) => toast({ title: "Could not open phone", description: error.message, variant: "destructive" }),
  });
  if (!lead.phone) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant={prohibited ? "destructive" : "outline"} disabled={prohibited} className="gap-1.5" data-testid={`shotgun-call-${lead.id}`}>
            <Phone className="h-4 w-4" />
            {prohibited ? "Outside calling hours" : callStatus.status === "allowed" ? "Verify & open phone" : "Verify before calling"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verify before contacting {lead.leadName}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-medium text-foreground">
                {lead.stateCode || "State unknown"} · {callStatus.localTime} · {callStatus.reason}
                {callStatus.approximate ? " (primary state timezone; verify the borrower's exact location)" : ""}
              </span>
              <span className="block">
                Continuing confirms you checked the borrower&apos;s actual local time, internal and federal/state Do Not Call requirements, consent, and West Capital policy. C3 cannot perform those checks automatically.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction disabled={openPhone.isPending} onClick={() => openPhone.mutate()}>{openPhone.isPending ? "Opening…" : "Verified — open phone"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span className={prohibited ? "text-xs font-semibold text-red-600" : "text-xs text-muted-foreground"}>
        {callStatus.localTime}{callStatus.approximate ? " approx." : ""}
      </span>
      <a className="text-xs text-blue-600 hover:underline" href="#/call-hours">Call-hours details</a>
    </div>
  );
}

export function ShotgunResultCard({ lead, onCompleted }: { lead: ShotgunLead; onCompleted?: () => void }) {
  const { toast } = useToast();
  const [called, setCalled] = useState(lead.called);
  const [texted, setTexted] = useState(lead.texted);
  const [notes, setNotes] = useState(lead.resultNotes);
  const [resultType, setResultType] = useState<"complete" | "transfer">("complete");
  const [loId, setLoId] = useState("");
  const [transferType, setTransferType] = useState<"direct" | "appointment" | "">("");
  const [bulkTexter, setBulkTexter] = useState(false);
  const [helperAssisted, setHelperAssisted] = useState(false);
  const { data: loanOfficers = [], isLoading: loanOfficersLoading } = useQuery<LoanOfficer[]>({
    queryKey: ["/api/loan-officers"],
    enabled: resultType === "transfer",
  });
  const { data: bulkTexterCfg } = useQuery<{ askBulkTexter: boolean }>({ queryKey: ["/api/settings/bulk-texter"], enabled: resultType === "transfer" });
  const { data: helperCfg } = useQuery<{ askHelper: boolean; helperName: string }>({ queryKey: ["/api/settings/helper"], enabled: resultType === "transfer" });
  const askBulkTexter = !!bulkTexterCfg?.askBulkTexter;
  const askHelper = !!helperCfg?.askHelper;
  const helperName = helperCfg?.helperName || "Elleine";
  const activeLoanOfficers = useMemo(() => loanOfficers
    .filter((lo) => (lo.internalStatus ?? lo.internal_status ?? "active") === "active")
    .sort((a, b) => String(a.fullName ?? a.full_name ?? "").localeCompare(String(b.fullName ?? b.full_name ?? ""))), [loanOfficers]);
  const save = useMutation({
    mutationFn: (done: boolean) => apiRequest("PATCH", `/api/shotgun/${lead.id}/result`, {
      called,
      texted,
      notes,
      done,
      transfer: done && resultType === "transfer",
      loId: done && resultType === "transfer" ? Number(loId) : null,
      transferType: done && resultType === "transfer" ? transferType : null,
      bulkTexter: done && resultType === "transfer" && askBulkTexter ? bulkTexter : null,
      helperAssisted: done && resultType === "transfer" && askHelper ? helperAssisted : null,
    }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] });
      if (result.done) onCompleted?.();
      toast({
        title: result.transferOutcomeId ? "Transfer logged" : result.done ? "Lead completed" : "Progress saved",
        description: result.transferOutcomeId
          ? "It now counts in C3 transfer analytics and reporting."
          : result.done ? "Your manager can see the final result." : "You can return and finish this lead later.",
      });
    },
    onError: (error: any) => toast({ title: "Could not save", description: error.message, variant: "destructive" }),
  });
  const canComplete = (called || texted) && notes.trim().length >= 2
    && (resultType !== "transfer" || (called && !!loId && (transferType === "direct" || transferType === "appointment")));

  return (
    <div className="mt-5 rounded-2xl border bg-muted/25 p-4" data-testid={`shotgun-result-${lead.id}`}>
      <p className="mb-3 text-sm font-bold">What happened?</p>
      <ShotgunCallLeadButton lead={lead} />
      <div className="mt-4 flex flex-wrap gap-5">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Checkbox checked={called} onCheckedChange={(value) => setCalled(value === true)} /> Called this lead</label>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Checkbox checked={texted} onCheckedChange={(value) => setTexted(value === true)} /> Sent a text</label>
      </div>
      <Textarea className="mt-3" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Write clear notes about the conversation, voicemail, text, next step, or outcome…" />

      <div className="mt-4 space-y-3 rounded-xl border bg-background p-3">
        <Label>Final result</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant={resultType === "complete" ? "default" : "outline"} onClick={() => setResultType("complete")}>Completed — no transfer</Button>
          <Button type="button" variant={resultType === "transfer" ? "default" : "outline"} className={resultType === "transfer" ? "gap-2 bg-emerald-600 hover:bg-emerald-700" : "gap-2"} onClick={() => setResultType("transfer")}>
            <ArrowRightLeft className="h-4 w-4" /> Log as a transfer
          </Button>
        </div>
        {resultType === "transfer" && (
          <div className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">This creates a real C3 transfer for analytics, reporting, and transfer credit.</p>
            <div className="space-y-1.5">
              <Label>Loan officer who received it</Label>
              <Select value={loId} onValueChange={setLoId}>
                <SelectTrigger data-testid="shotgun-transfer-lo"><SelectValue placeholder={loanOfficersLoading ? "Loading loan officers…" : "Select loan officer"} /></SelectTrigger>
                <SelectContent>{activeLoanOfficers.map((lo) => <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName ?? lo.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Transfer type</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={transferType === "direct" ? "default" : "outline"} onClick={() => setTransferType("direct")}>Direct</Button>
                <Button type="button" variant={transferType === "appointment" ? "default" : "outline"} onClick={() => setTransferType("appointment")}>Appointment</Button>
              </div>
            </div>
            {askBulkTexter && (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
                <div><p className="text-sm font-medium">Was Bulk Texter part of this transfer?</p><p className="text-xs text-muted-foreground">Tracked in stats and dashboards.</p></div>
                <Switch checked={bulkTexter} onCheckedChange={setBulkTexter} data-testid="shotgun-bulk-texter" />
              </div>
            )}
            {askHelper && (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
                <div><p className="text-sm font-medium">Was {helperName} part of this transfer?</p><p className="text-xs text-muted-foreground">Counted toward {helperName}&apos;s per-transfer total.</p></div>
                <Switch checked={helperAssisted} onCheckedChange={setHelperAssisted} data-testid="shotgun-helper-assisted" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>Save progress</Button>
        <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700" disabled={save.isPending || !canComplete} onClick={() => save.mutate(true)}>
          {resultType === "transfer" ? <ArrowRightLeft className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {resultType === "transfer" ? "Log transfer & complete" : "Complete without transfer"}
        </Button>
      </div>
    </div>
  );
}
