import { Suspense, lazy, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, CheckCircle2, Phone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { stateCallStatus } from "@/lib/state-call-window";
import { businessTodayClient } from "@/lib/business-day";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ShotgunLead } from "@/pages/shotgun";
import type { OutcomeFormValues } from "@/pages/outcomes";

/**
 * The full Outcomes form — loan officer, Direct or Appointment, lead source,
 * the qualification checklist, borrower details, appointment time, the Bonzo
 * write-up — opened from the result card. Loaded on demand: the result
 * prompt is on every page and the Outcomes page is the biggest one in C3.
 */
const OutcomeFormDialog = lazy(() => import("@/pages/outcomes").then((m) => ({ default: m.OutcomeFormDialog })));

/** The same shaping the Outcomes page does before it posts the form. */
export function shotgunOutcomeBody(values: OutcomeFormValues) {
  return {
    ...values,
    // For appointments the scheduled time IS the follow-up date, so the
    // record appears in Upcoming Appointments.
    followUpDate: values.followUpDate || values.appointmentDatetime || "",
    // "other" is a UI value; what gets stored is what the CLR typed.
    leadSource: values.leadSource === "other"
      ? (values.leadSourceOther || "").trim() || null
      : values.leadSource || null,
  };
}

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
  const [formOpen, setFormOpen] = useState(false);
  // Only fetched once the full form is asked for.
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"], enabled: formOpen });
  const { data: los = [] } = useQuery<any[]>({ queryKey: ["/api/loan-officers"], enabled: formOpen });
  const save = useMutation({
    // `true` finishes the lead with no transfer; `{ outcome }` finishes it
    // with the full transfer or appointment write-up; `false` saves progress.
    mutationFn: (input: boolean | { outcome: OutcomeFormValues }) => {
      const outcome = typeof input === "object" ? input.outcome : null;
      const done = input === true || !!outcome;
      return apiRequest("PATCH", `/api/shotgun/${lead.id}/result`, {
        called,
        texted,
        notes,
        done,
        transfer: !!outcome && outcome.outcomeType === "transfer",
        outcome: outcome ? shotgunOutcomeBody(outcome) : undefined,
      });
    },
    onSuccess: (result: any) => {
      if (result.done) {
        setFormOpen(false);
        queryClient.setQueryData(["/api/shotgun"], (old: any) => old ? {
          ...old, leads: old.leads.map((item: ShotgunLead) => item.id === lead.id ? { ...item, status: "done" } : item),
        } : old);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] });
      if (result.transferOutcomeId) {
        queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      }
      if (result.done) onCompleted?.();
      const appointment = result.outcomeType === "appointment";
      toast({
        title: result.transferOutcomeId ? (appointment ? "Appointment logged" : "Transfer logged") : result.done ? "Lead completed" : "Progress saved",
        description: result.transferOutcomeId
          ? (appointment ? "It is on Upcoming Appointments and in C3 reporting." : "It now counts in C3 transfer analytics and reporting.")
          : result.done ? "Your manager can see the final result." : "You can return and finish this lead later.",
      });
    },
    onError: (error: any) => toast({ title: "Could not save", description: error.message, variant: "destructive" }),
  });
  const canComplete = (called || texted) && notes.trim().length >= 2;

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
        <Label>Did this lead become a transfer or an appointment?</Label>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Transfer result">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" name={`shotgun-result-type-${lead.id}`} checked={resultType === "complete"} onChange={() => setResultType("complete")} /> No transfer</label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" name={`shotgun-result-type-${lead.id}`} checked={resultType === "transfer"} onChange={() => setResultType("transfer")} /> Yes — log a transfer or appointment</label>
        </div>
        {resultType === "transfer" && (
          <div className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-950/20" data-testid="shotgun-transfer-lo">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
              Everything the Outcomes page asks — loan officer, Direct or Appointment, lead source, the qualification checklist, borrower details, appointment time and the Bonzo write-up — right here. It creates the real C3 transfer or appointment and finishes this lead in one go.
            </p>
            {!canComplete && <p className="text-xs text-muted-foreground">Tick Called or Sent a text and add a short note first.</p>}
            <Button type="button" className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700" disabled={!canComplete || save.isPending} onClick={() => setFormOpen(true)} data-testid="shotgun-open-full-form">
              <ArrowRightLeft className="h-4 w-4" /> Log transfer & finish lead
            </Button>
          </div>
        )}
      </div>

      {save.isError && <p role="alert" className="mt-3 rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">Could not save: {save.error.message}. Your entries are still here; please try again.</p>}
      {!canComplete && <p className="mt-3 text-sm text-muted-foreground">{!called && !texted ? "Select Called or Sent a text. " : ""}{notes.trim().length < 2 ? "Add a short note about what happened. " : ""}</p>}
      <p className="mt-3 text-xs text-muted-foreground">Save for later keeps this lead assigned and reminders active. Finish lead saves the final result and clears this reminder.</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)}>Save for later</Button>
        {resultType === "complete" && (
          <Button type="button" className="gap-2 bg-emerald-600 hover:bg-emerald-700" disabled={save.isPending || !canComplete} onClick={() => save.mutate(true)}>
            <CheckCircle2 className="h-4 w-4" />
            {save.isPending ? "Saving…" : "Finish lead"}
          </Button>
        )}
      </div>

      {formOpen && (
        <Suspense fallback={null}>
          <OutcomeFormDialog
            open={formOpen}
            onClose={() => setFormOpen(false)}
            onSubmit={(values) => save.mutate({ outcome: values })}
            isPending={save.isPending}
            users={users}
            los={los}
            title={`${lead.leadName} — transfer or appointment`}
            submitLabel="Log it & finish lead"
            initialValues={{
              date: businessTodayClient(),
              outcomeType: "transfer",
              transferType: "direct",
              borrowerName: lead.leadName,
              phoneNumber: lead.phone,
              notes,
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
