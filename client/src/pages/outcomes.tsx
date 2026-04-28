import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Filter, ClipboardList, Pencil, Zap, CalendarCheck,
  ChevronLeft, ChevronRight, Check,
  ArrowRightLeft, CalendarPlus, PhoneCall, Hourglass, AlertTriangle,
  PhoneOff, ThumbsDown, PhoneMissed, HelpCircle, ArrowLeft,
} from "lucide-react";
import { HelpIcon, PageTooltip, markStep } from "@/components/onboarding";
import { useAuth } from "@/lib/auth";

const OUTCOME_TYPES = [
  "transfer", "appointment", "callback_requested", "deferral", "fell_through",
  "no_answer", "not_interested", "wrong_number", "other"
] as const;

// Includes legacy future_contact for backward compatibility (displayed as Deferral)
const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer", appointment: "Appointment", fell_through: "Fell Through",
  no_answer: "No Answer", callback_requested: "Callback",
  deferral: "Deferral", future_contact: "Deferral",
  not_interested: "Not Interested", wrong_number: "Wrong Number", other: "Other",
};

const OUTCOME_HELPERS: Record<string, string> = {
  appointment: "Specific date & time confirmed",
  callback_requested: "Call back soon — within days/weeks, no exact time",
  deferral: "Month+ away — open to future contact, no date set",
};

// ── Result picker tiles — the first screen of the log-contact flow ────────────
const OUTCOME_TILES: Array<{
  type: typeof OUTCOME_TYPES[number];
  icon: any;
  helper?: string;
  tone: string; // tailwind classes for the active state
}> = [
  { type: "transfer",           icon: ArrowRightLeft, helper: "Sent to LO — live or scheduled", tone: "border-green-500 bg-green-50 hover:bg-green-100 text-green-900 dark:bg-green-900/20 dark:hover:bg-green-900/30 dark:text-green-200 dark:border-green-700" },
  { type: "appointment",        icon: CalendarPlus,   helper: "Specific date & time confirmed",  tone: "border-blue-500 bg-blue-50 hover:bg-blue-100 text-blue-900 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700" },
  { type: "callback_requested", icon: PhoneCall,      helper: "Call back within days/weeks",     tone: "border-purple-500 bg-purple-50 hover:bg-purple-100 text-purple-900 dark:bg-purple-900/20 dark:hover:bg-purple-900/30 dark:text-purple-200 dark:border-purple-700" },
  { type: "deferral",           icon: Hourglass,      helper: "Month+ away — no date set",        tone: "border-amber-500 bg-amber-50 hover:bg-amber-100 text-amber-900 dark:bg-amber-900/20 dark:hover:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700" },
  { type: "fell_through",       icon: AlertTriangle,  helper: "Conversation ended without progress", tone: "border-orange-500 bg-orange-50 hover:bg-orange-100 text-orange-900 dark:bg-orange-900/20 dark:hover:bg-orange-900/30 dark:text-orange-200 dark:border-orange-700" },
  { type: "no_answer",          icon: PhoneMissed,    helper: "Didn’t reach the lead",            tone: "border-gray-400 bg-gray-50 hover:bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:hover:bg-gray-700/40 dark:text-gray-200 dark:border-gray-600" },
  { type: "not_interested",     icon: ThumbsDown,     helper: "Lead declined — don’t pursue",      tone: "border-red-500 bg-red-50 hover:bg-red-100 text-red-900 dark:bg-red-900/20 dark:hover:bg-red-900/30 dark:text-red-200 dark:border-red-700" },
  { type: "wrong_number",       icon: PhoneOff,       helper: "Number not associated with lead",  tone: "border-zinc-400 bg-zinc-50 hover:bg-zinc-100 text-zinc-800 dark:bg-zinc-800/40 dark:hover:bg-zinc-700/40 dark:text-zinc-200 dark:border-zinc-600" },
  { type: "other",              icon: HelpCircle,     helper: "Anything else — add notes below",  tone: "border-slate-400 bg-slate-50 hover:bg-slate-100 text-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-700/40 dark:text-slate-200 dark:border-slate-600" },
];

const OUTCOME_COLORS: Record<string, string> = {
  transfer: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  appointment: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  fell_through: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  no_answer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  callback_requested: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  deferral: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  future_contact: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  not_interested: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  wrong_number: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const TRANSFER_TYPES = ["direct", "appointment"] as const;
type TransferType = typeof TRANSFER_TYPES[number];

// Format an ISO-ish follow-up value (either "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM")
// for compact display, showing time only when present.
function formatFollowUp(value: string): string {
  if (!value) return "";
  if (!value.includes("T")) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

const TIMEFRAME_OPTIONS = [
  { value: "ready_now", label: "Ready now" },
  { value: "1_2_weeks", label: "1-2 weeks" },
  { value: "1_3_months", label: "1-3 months" },
  { value: "3_6_months", label: "3-6 months" },
  { value: "6_plus_months", label: "6+ months" },
] as const;

const LEAD_TYPE_OPTIONS = [
  { value: "appointment_transfer", label: "Appointment Transfer" },
  { value: "missed_appointment", label: "Missed Appointment" },
] as const;

const outcomeFormSchema = z.object({
  date: z.string().min(1, "Date required"),
  assistantId: z.coerce.number().min(1, "Select an assistant"),
  loId: z.coerce.number().min(1, "Select a loan officer"),
  outcomeType: z.enum(OUTCOME_TYPES),
  transferType: z.enum(TRANSFER_TYPES).optional().nullable(),
  borrowerName: z.string().optional(),
  journeyId: z.string().optional(),
  notes: z.string().optional(),
  followUpDate: z.string().optional(),
  // Wizard fields (all optional — filled for transfers if not skipped)
  conversationNotes: z.string().optional(),
  loActionPlan: z.string().optional(),
  leadTimeframe: z.string().optional(),
  requiresFollowup: z.boolean().optional(),
  followupReason: z.string().optional(),
  followupDate: z.string().optional(),
  leadType: z.string().optional(),
  appointmentDatetime: z.string().optional(),
  leadGoal: z.string().optional(),
  prequalificationNotes: z.string().optional(),
  missedReason: z.string().optional(),
  rescheduled: z.boolean().optional(),
  rescheduleDatetime: z.string().optional(),
  nextSteps: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.outcomeType === "transfer" && val.transferType !== "direct" && val.transferType !== "appointment") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferType"],
      message: "Select Direct or Appointment/Callback",
    });
  }
});
type OutcomeFormValues = z.infer<typeof outcomeFormSchema>;

// Inline date editor for the Outcomes list. Click the date to edit it,
// blur or press Enter to save, Escape to cancel.
function InlineDateEditor({
  value,
  onSave,
  saving,
}: {
  value: string;
  onSave: (date: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [editing, value]);

  const commit = () => {
    if (draft && draft !== value) onSave(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="text-xs font-mono bg-background border rounded px-1.5 py-0.5 w-[120px] focus:outline-none focus:ring-1 focus:ring-primary"
        data-testid="inline-date-input"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-xs text-muted-foreground font-mono hover:text-foreground hover:underline decoration-dotted underline-offset-2 text-left disabled:opacity-60"
      disabled={saving}
      title="Click to change date"
      data-testid="inline-date-value"
    >
      {saving ? "Saving…" : value}
    </button>
  );
}

function TransferTypeOption({
  active,
  onClick,
  icon: Icon,
  label,
  sub,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
  sub: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      className={`flex items-start gap-2 rounded-md border p-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-primary/40 hover:bg-muted/40"
      }`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
      <div className="min-w-0">
        <p className={`text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}>{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </button>
  );
}

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold border ${
                done
                  ? "bg-primary text-primary-foreground border-primary"
                  : active
                  ? "bg-primary/10 text-primary border-primary"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {done ? <Check className="w-3 h-3" /> : n}
            </div>
            {i < total - 1 && <div className={`w-8 h-px ${done ? "bg-primary" : "bg-border"}`} />}
          </div>
        );
      })}
      <span className="ml-2 text-xs text-muted-foreground">Step {step} of {total}</span>
    </div>
  );
}

function OutcomeFormDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  users,
  los,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: OutcomeFormValues) => void;
  isPending: boolean;
  users: any[];
  los: any[];
}) {
  const form = useForm<OutcomeFormValues>({
    resolver: zodResolver(outcomeFormSchema),
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      assistantId: 1, // default to Ethan
      loId: 0,
      outcomeType: "transfer",
      transferType: null,
      borrowerName: "",
      journeyId: "",
      notes: "",
      followUpDate: "",
      conversationNotes: "",
      loActionPlan: "",
      leadTimeframe: "",
      requiresFollowup: false,
      followupReason: "",
      followupDate: "",
      leadType: "",
      appointmentDatetime: "",
      leadGoal: "",
      prequalificationNotes: "",
      missedReason: "",
      rescheduled: false,
      rescheduleDatetime: "",
      nextSteps: "",
    },
  });

  const [bonzoLogged, setBonzoLogged] = useState(false);
  // Step 0 = result picker (always shown first), step 1 = details, step 2/3 = transfer wizard
  const [step, setStep] = useState(0);
  const watchedType = form.watch("outcomeType");
  const watchedTransferType = form.watch("transferType");
  const watchedRequiresFollowup = form.watch("requiresFollowup");
  const watchedLeadType = form.watch("leadType");
  const watchedRescheduled = form.watch("rescheduled");
  const isTransfer = watchedType === "transfer";
  const totalSteps = isTransfer ? 3 : 1;

  // Clear transferType whenever outcome moves away from "transfer" so stale
  // values don't trip the superRefine on a later transfer selection.
  useEffect(() => {
    if (watchedType !== "transfer" && form.getValues("transferType") != null) {
      form.setValue("transferType", null, { shouldValidate: false });
    }
    // If outcome changed away from transfer mid-wizard (steps 2/3), drop back to step 1.
    if (watchedType !== "transfer" && step > 1) setStep(1);
  }, [watchedType, form, step]);

  useEffect(() => {
    if (open) { setBonzoLogged(false); setStep(0); }
  }, [open]);

  const canAdvanceFromStep1 = !isTransfer || (
    form.getValues("loId") > 0 &&
    (watchedTransferType === "direct" || watchedTransferType === "appointment")
  );

  const handleNext = async () => {
    if (step === 1) {
      // Validate step 1 fields before advancing
      const ok = await form.trigger(["date", "assistantId", "loId", "outcomeType", "transferType"]);
      if (!ok) return;
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleBack = () => { if (step > 0) setStep(step - 1); };

  const pickOutcome = (type: typeof OUTCOME_TYPES[number]) => {
    form.setValue("outcomeType", type, { shouldValidate: false });
    // Clear stale transferType when re-picking a non-transfer outcome
    if (type !== "transfer") {
      form.setValue("transferType", null, { shouldValidate: false });
    }
    setStep(1);
  };

  const handleSkip = () => {
    // Clear the fields on the current step then advance (or submit from step 3)
    if (step === 2) {
      form.setValue("conversationNotes", "");
      form.setValue("loActionPlan", "");
      form.setValue("leadTimeframe", "");
      form.setValue("requiresFollowup", false);
      form.setValue("followupReason", "");
      form.setValue("followupDate", "");
      setStep(3);
    } else if (step === 3) {
      form.setValue("leadType", "");
      form.setValue("appointmentDatetime", "");
      form.setValue("leadGoal", "");
      form.setValue("prequalificationNotes", "");
      form.setValue("missedReason", "");
      form.setValue("rescheduled", false);
      form.setValue("rescheduleDatetime", "");
      form.setValue("nextSteps", "");
      form.handleSubmit(onSubmit)();
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === 0 ? "What was the result?" : "Log Outcome"}</DialogTitle>
        </DialogHeader>
        {step > 0 && isTransfer && <StepIndicator step={step} total={totalSteps} />}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

          {/* ── Step 0: Result Picker ──────────────────────────── */}
          {step === 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {OUTCOME_TILES.map(tile => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.type}
                    type="button"
                    onClick={() => pickOutcome(tile.type)}
                    data-testid={`tile-outcome-${tile.type}`}
                    className={`flex flex-col items-center justify-start gap-1.5 rounded-lg border-2 p-3 text-center transition-colors ${tile.tone}`}
                  >
                    <Icon className="w-6 h-6" />
                    <span className="text-sm font-semibold leading-tight">{OUTCOME_LABELS[tile.type]}</span>
                    {tile.helper && (
                      <span className="text-[11px] opacity-80 leading-tight">{tile.helper}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && (
          <>
            {/* Selected outcome chip with Change link */}
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Outcome:</span>
                <Badge className={OUTCOME_COLORS[watchedType] || ""} data-testid="badge-selected-outcome">
                  {OUTCOME_LABELS[watchedType] || watchedType}
                </Badge>
                {OUTCOME_HELPERS[watchedType] && (
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">{OUTCOME_HELPERS[watchedType]}</span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setStep(0)}
                data-testid="button-change-outcome"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Change
              </Button>
            </div>
            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-outcome-date" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {isTransfer && (
              <FormField control={form.control} name="transferType" render={({ field }) => (
                <FormItem>
                  <FormLabel>How was this transfer made? <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup">
                      <TransferTypeOption
                        active={field.value === "direct"}
                        onClick={() => field.onChange("direct")}
                        icon={Zap}
                        label="Direct Transfer"
                        sub="Live transfer on the call"
                        testId="radio-transfer-direct"
                      />
                      <TransferTypeOption
                        active={field.value === "appointment"}
                        onClick={() => field.onChange("appointment")}
                        icon={CalendarCheck}
                        label="Appointment / Callback"
                        sub="Scheduled follow-up"
                        testId="radio-transfer-appointment"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="assistantId" render={({ field }) => (
              <FormItem>
                <FormLabel>CLR Assistant</FormLabel>
                <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-assistant"><SelectValue placeholder="Select assistant" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {users.map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="loId" render={({ field }) => (
              <FormItem>
                <FormLabel>Loan Officer</FormLabel>
                <Select value={String(field.value || "")} onValueChange={v => field.onChange(Number(v))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-lo"><SelectValue placeholder="Select LO" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {los.filter((lo: any) => lo.internalStatus === "active").map((lo: any) => (
                      <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="borrowerName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Borrower Name</FormLabel>
                  <FormControl><Input {...field} placeholder="Optional" data-testid="input-borrower-name" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="journeyId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Journey ID</FormLabel>
                  <FormControl><Input {...field} placeholder="Optional" data-testid="input-journey-id" /></FormControl>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="followUpDate" render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Follow-up Date &amp; Time (optional){" "}
                  <span className="text-[11px] font-normal text-muted-foreground">
                    ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </span>
                </FormLabel>
                <FormControl><Input type="datetime-local" {...field} data-testid="input-appointment-date" /></FormControl>
              </FormItem>
            )} />
            {!isTransfer && (
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Textarea {...field} rows={2} placeholder="Any notes…" data-testid="textarea-outcome-notes" /></FormControl>
                </FormItem>
              )} />
            )}
          </>
          )}

          {/* ── Step 2: Conversation Notes ───────────────────────── */}
          {isTransfer && step === 2 && (
            <>
              <p className="text-sm font-semibold text-foreground">Conversation Notes</p>
              <FormField control={form.control} name="conversationNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Summary of conversation with lead</FormLabel>
                  <FormControl><Textarea {...field} rows={3} placeholder="What did the lead say? Main questions or concerns?" /></FormControl>
                  <p className="text-xs text-muted-foreground">What did the lead say? What were their main questions or concerns?</p>
                </FormItem>
              )} />
              <FormField control={form.control} name="loActionPlan" render={({ field }) => (
                <FormItem>
                  <FormLabel>LO's action plan with this lead</FormLabel>
                  <FormControl><Textarea {...field} rows={3} placeholder="e.g. send rate quote, schedule call, run credit" /></FormControl>
                  <p className="text-xs text-muted-foreground">What will the LO do next? (e.g. send rate quote, schedule call, run credit)</p>
                </FormItem>
              )} />
              <FormField control={form.control} name="leadTimeframe" render={({ field }) => (
                <FormItem>
                  <FormLabel>Timeframe</FormLabel>
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select timeframe" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIMEFRAME_OPTIONS.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="requiresFollowup" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-3">
                    <FormLabel className="mb-0">Requires follow-up?</FormLabel>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => field.onChange(true)}
                        className={`text-xs px-3 py-1.5 rounded-md border font-medium ${field.value === true ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                      >Yes</button>
                      <button
                        type="button"
                        onClick={() => field.onChange(false)}
                        className={`text-xs px-3 py-1.5 rounded-md border font-medium ${field.value === false ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                      >No</button>
                    </div>
                  </div>
                </FormItem>
              )} />
              {watchedRequiresFollowup === true && (
                <div className="grid grid-cols-1 gap-3 pl-2 border-l-2 border-primary/30">
                  <FormField control={form.control} name="followupReason" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Why follow-up needed</FormLabel>
                      <FormControl><Textarea {...field} rows={2} placeholder="Reason for follow-up" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="followupDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Follow-up date &amp; time{" "}
                        <span className="text-[11px] font-normal text-muted-foreground">
                          ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                        </span>
                      </FormLabel>
                      <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              )}
            </>
          )}

          {/* ── Step 3: Lead Information ────────────────────────── */}
          {isTransfer && step === 3 && (
            <>
              <p className="text-sm font-semibold text-foreground">Lead Information</p>
              <FormField control={form.control} name="leadType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead type</FormLabel>
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select lead type" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LEAD_TYPE_OPTIONS.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              {watchedLeadType === "appointment_transfer" && (
                <>
                  <FormField control={form.control} name="appointmentDatetime" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Appointment date & time</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="leadGoal" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead's stated goal</FormLabel>
                      <FormControl><Input {...field} placeholder="e.g. Buy first home, Refinance" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="prequalificationNotes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Any pre-qualification info?</FormLabel>
                      <FormControl><Textarea {...field} rows={2} placeholder="Income range, credit score range, etc." /></FormControl>
                    </FormItem>
                  )} />
                </>
              )}

              {watchedLeadType === "missed_appointment" && (
                <>
                  <FormField control={form.control} name="missedReason" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Why was the appointment missed?</FormLabel>
                      <FormControl><Textarea {...field} rows={2} placeholder="Reason" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="rescheduled" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-3">
                        <FormLabel className="mb-0">Rescheduled?</FormLabel>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => field.onChange(true)}
                            className={`text-xs px-3 py-1.5 rounded-md border font-medium ${field.value === true ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                          >Yes</button>
                          <button
                            type="button"
                            onClick={() => field.onChange(false)}
                            className={`text-xs px-3 py-1.5 rounded-md border font-medium ${field.value === false ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                          >No</button>
                        </div>
                      </div>
                    </FormItem>
                  )} />
                  {watchedRescheduled === true && (
                    <FormField control={form.control} name="rescheduleDatetime" render={({ field }) => (
                      <FormItem>
                        <FormLabel>New appointment date & time</FormLabel>
                        <FormControl><Input type="datetime-local" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  )}
                  <FormField control={form.control} name="nextSteps" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Next steps</FormLabel>
                      <FormControl><Textarea {...field} rows={2} placeholder="What happens next?" /></FormControl>
                    </FormItem>
                  )} />
                </>
              )}

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional notes</FormLabel>
                  <FormControl><Textarea {...field} rows={2} placeholder="Any other notes…" /></FormControl>
                </FormItem>
              )} />

              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                <Checkbox
                  id="bonzo-logged"
                  checked={bonzoLogged}
                  onCheckedChange={v => setBonzoLogged(v === true)}
                  data-testid="checkbox-bonzo-logged"
                />
                <label htmlFor="bonzo-logged" className="text-sm leading-snug cursor-pointer select-none">
                  I have recorded this transfer in Bonzo using the appropriate notation.
                </label>
              </div>
            </>
          )}

          {/* Footer */}
          <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
            <div className="flex gap-2">
              {isTransfer && step > 1 && (
                <Button type="button" variant="outline" size="sm" onClick={handleBack}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            </div>
            <div className="flex gap-2">
              {isTransfer && (step === 2 || step === 3) && (
                <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
                  Skip for now
                </Button>
              )}
              {isTransfer && step >= 1 && step < totalSteps && (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleNext}
                  disabled={step === 1 && !canAdvanceFromStep1}
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
              {step >= 1 && (!isTransfer || step === totalSteps) && (
                <Button
                  type="submit"
                  disabled={
                    isPending ||
                    (isTransfer && !bonzoLogged) ||
                    (isTransfer && watchedTransferType !== "direct" && watchedTransferType !== "appointment")
                  }
                  data-testid="button-save-outcome"
                >
                  {isPending ? "Saving…" : "Log Outcome"}
                </Button>
              )}
            </div>
          </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const editOutcomeSchema = z.object({
  outcomeType: z.enum(OUTCOME_TYPES),
  transferType: z.enum(TRANSFER_TYPES).optional().nullable(),
  loId: z.coerce.number().min(1, "Select a loan officer"),
  borrowerName: z.string().optional(),
  followUpDate: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.outcomeType === "transfer" && val.transferType !== "direct" && val.transferType !== "appointment") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferType"],
      message: "Select Direct or Appointment/Callback",
    });
  }
});
type EditOutcomeValues = z.infer<typeof editOutcomeSchema>;

const FOLLOWUP_TYPES = new Set(["appointment", "callback_requested", "deferral", "future_contact"]);

function EditOutcomeDialog({
  outcome,
  open,
  onClose,
  onSubmit,
  isPending,
  los,
  currentUserId,
}: {
  outcome: any | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (values: EditOutcomeValues) => void;
  isPending: boolean;
  los: any[];
  currentUserId?: number;
}) {
  const form = useForm<EditOutcomeValues>({
    resolver: zodResolver(editOutcomeSchema),
    defaultValues: {
      outcomeType: "transfer",
      transferType: null,
      loId: 0,
      borrowerName: "",
      followUpDate: "",
      notes: "",
    },
  });

  const [bonzoLogged, setBonzoLogged] = useState(false);
  const watchedType = form.watch("outcomeType");
  const watchedTransferType = form.watch("transferType");
  const isTransfer = watchedType === "transfer";
  const showFollowUp = FOLLOWUP_TYPES.has(watchedType) || !!(outcome?.followUpDate);

  useEffect(() => {
    if (watchedType !== "transfer" && form.getValues("transferType") != null) {
      form.setValue("transferType", null, { shouldValidate: false });
    }
  }, [watchedType, form]);

  useEffect(() => {
    if (open && outcome) {
      const existingTT = outcome.transferType ?? outcome.transfer_type ?? null;
      form.reset({
        outcomeType: outcome.outcomeType,
        transferType: existingTT === "direct" || existingTT === "appointment" ? existingTT : null,
        loId: outcome.loId,
        borrowerName: outcome.borrowerName ?? "",
        followUpDate: outcome.followUpDate ?? "",
        notes: outcome.notes ?? "",
      });
      setBonzoLogged(false);
    }
  }, [open, outcome, form]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Outcome</DialogTitle>
        </DialogHeader>
        {outcome && currentUserId != null && outcome.assistantId !== currentUserId && (
          <div className="text-xs px-3 py-2 rounded-md border border-amber-300 bg-amber-50 text-amber-900">
            Editing another CLR's record ({outcome.assistant?.name ?? `Assistant #${outcome.assistantId}`}).
          </div>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="outcomeType" render={({ field }) => (
              <FormItem>
                <FormLabel>Outcome</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-edit-outcome-type"><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {OUTCOME_TYPES.map(t => (
                      <SelectItem key={t} value={t}>
                        <div className="flex flex-col">
                          <span>{OUTCOME_LABELS[t] ?? t}</span>
                          {OUTCOME_HELPERS[t] && (
                            <span className="text-[11px] text-muted-foreground">{OUTCOME_HELPERS[t]}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {OUTCOME_HELPERS[field.value] && (
                  <p className="text-xs text-muted-foreground mt-1">ℹ️ {OUTCOME_HELPERS[field.value]}</p>
                )}
                <FormMessage />
              </FormItem>
            )} />
            {isTransfer && (
              <FormField control={form.control} name="transferType" render={({ field }) => (
                <FormItem>
                  <FormLabel>How was this transfer made? <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup">
                      <TransferTypeOption
                        active={field.value === "direct"}
                        onClick={() => field.onChange("direct")}
                        icon={Zap}
                        label="Direct Transfer"
                        sub="Live transfer on the call"
                        testId="radio-edit-transfer-direct"
                      />
                      <TransferTypeOption
                        active={field.value === "appointment"}
                        onClick={() => field.onChange("appointment")}
                        icon={CalendarCheck}
                        label="Appointment / Callback"
                        sub="Scheduled follow-up"
                        testId="radio-edit-transfer-appointment"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="loId" render={({ field }) => (
              <FormItem>
                <FormLabel>Loan Officer</FormLabel>
                <Select value={String(field.value || "")} onValueChange={v => field.onChange(Number(v))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-edit-lo"><SelectValue placeholder="Select LO" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {los.filter((lo: any) => lo.internalStatus === "active").map((lo: any) => (
                      <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="borrowerName" render={({ field }) => (
              <FormItem>
                <FormLabel>Borrower Name</FormLabel>
                <FormControl><Input {...field} placeholder="Optional" data-testid="input-edit-borrower-name" /></FormControl>
              </FormItem>
            )} />
            {showFollowUp && (
              <FormField control={form.control} name="followUpDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Follow-up Date &amp; Time{" "}
                    <span className="text-[11px] font-normal text-muted-foreground">
                      ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                    </span>
                  </FormLabel>
                  <FormControl><Input type="datetime-local" {...field} data-testid="input-edit-followup-date" /></FormControl>
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} rows={2} placeholder="Any notes…" data-testid="textarea-edit-notes" /></FormControl>
              </FormItem>
            )} />
            {isTransfer && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                <Checkbox
                  id="edit-bonzo-logged"
                  checked={bonzoLogged}
                  onCheckedChange={v => setBonzoLogged(v === true)}
                  data-testid="checkbox-edit-bonzo-logged"
                />
                <label htmlFor="edit-bonzo-logged" className="text-sm leading-snug cursor-pointer select-none">
                  I have recorded this transfer in Bonzo using the appropriate notation.
                </label>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  (isTransfer && !bonzoLogged) ||
                  (isTransfer && watchedTransferType !== "direct" && watchedTransferType !== "appointment")
                }
                data-testid="button-save-edit-outcome"
              >
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Outcomes() {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [filterType, setFilterType] = useState("all");

  const [filterAssistant, setFilterAssistant] = useState<string>(
    authUser?.id ? String(authUser.id) : "all",
  );
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (authUser?.id && filterAssistant === "all") {
      setFilterAssistant(String(authUser.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  const { data: outcomes = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/outcomes"] });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const { data: los = [] } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/outcomes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      setDialogOpen(false);
      markStep(authUser?.id, "log_outcome");
      toast({ title: "Outcome logged" });
    },
    onError: () => toast({ title: "Error logging outcome", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditOutcomeValues }) => {
      const payload: Record<string, unknown> = {
        outcomeType: data.outcomeType,
        transferType: data.outcomeType === "transfer" ? data.transferType : null,
        loId: data.loId,
        borrowerName: data.borrowerName ?? "",
        notes: data.notes ?? "",
        followUpDate: data.followUpDate || null,
      };
      return apiRequest("PATCH", `/api/outcomes/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      setEditTarget(null);
      toast({ title: "Outcome updated" });
    },
    onError: () => toast({ title: "Error updating outcome", variant: "destructive" }),
  });

  const updateDateMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) =>
      apiRequest("PATCH", `/api/outcomes/${id}`, { date }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      toast({ title: "Date updated" });
    },
    onError: () => toast({ title: "Error updating date", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/outcomes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      toast({ title: "Outcome deleted" });
    },
    onError: () => toast({ title: "Error deleting outcome", variant: "destructive" }),
  });

  const filtered = outcomes.filter((o: any) => {
    const matchType = filterType === "all" || o.outcomeType === filterType;
    const matchAssistant = filterAssistant === "all" || String(o.assistantId) === filterAssistant;
    const matchSearch = !search || (o.borrowerName?.toLowerCase().includes(search.toLowerCase())) || o.lo?.fullName?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchAssistant && matchSearch;
  });

  // Quick-count summary
  const countByType: Record<string, number> = {};
  filtered.forEach((o: any) => { countByType[o.outcomeType] = (countByType[o.outcomeType] || 0) + 1; });

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <PageTooltip
        pageKey="outcomes"
        title="Log every call here"
        body="Select the outcome, borrower name, and LO. Transfers require you to note if it was Direct or Appointment."
      />
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Lead Outcomes</h1>
          <p className="text-sm text-muted-foreground">{outcomes.length} outcomes logged</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setDialogOpen(true)} data-testid="button-log-outcome">
            <Plus className="w-4 h-4 mr-2" />Log Outcome
          </Button>
          <HelpIcon title="Lead Outcomes">
            Log every call you make here. Each outcome (Transfer, Appointment, Fell Through, etc.) is recorded and feeds into your EOD report and team stats automatically.
          </HelpIcon>
        </div>
      </div>

      {/* Summary badges */}
      {filtered.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(countByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <button
              key={type}
              onClick={() => setFilterType(filterType === type ? "all" : type)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium ${filterType === type ? "border-primary bg-primary/10 text-primary" : "border-border"} ${OUTCOME_COLORS[type]}`}
              data-testid={`badge-outcome-${type}`}
            >
              {OUTCOME_LABELS[type]}: {count}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search borrower or LO…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-outcomes"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44" data-testid="select-filter-type">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Outcomes</SelectItem>
            {OUTCOME_TYPES.map(t => (
              <SelectItem key={t} value={t}>{OUTCOME_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterAssistant} onValueChange={setFilterAssistant}>
          <SelectTrigger className="w-40" data-testid="select-filter-assistant">
            <SelectValue placeholder="My Calls" />
          </SelectTrigger>
          <SelectContent>
            {authUser?.id && (
              <SelectItem value={String(authUser.id)}>My Calls</SelectItem>
            )}
            {users
              .filter((u: any) => u.id !== authUser?.id)
              .map((u: any) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            {authUser?.role === "admin" && (
              <SelectItem value="all">All Users</SelectItem>
            )}
          </SelectContent>
        </Select>
        {(search || filterType !== "all" || filterAssistant !== (authUser?.id ? String(authUser.id) : "all")) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setFilterType("all");
              setFilterAssistant(authUser?.id ? String(authUser.id) : "all");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <ClipboardList className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {outcomes.length === 0 ? "No outcomes logged yet. Click \"Log Outcome\" to start." : "No results match your filters."}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[80px_1fr_1fr_1fr_120px_80px] gap-3 px-4 py-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>Date</span><span>Outcome</span><span>LO</span><span>Assistant</span><span>Borrower</span><span></span>
            </div>
            {filtered.map((o: any) => (
              <div
                key={o.id}
                className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_1fr_120px_80px] gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/20 transition-colors items-center group"
                data-testid={`row-outcome-${o.id}`}
              >
                <InlineDateEditor
                  value={o.date}
                  onSave={(date) => updateDateMutation.mutate({ id: o.id, date })}
                  saving={updateDateMutation.isPending && updateDateMutation.variables?.id === o.id}
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className={`text-xs w-fit px-2 py-0.5 ${OUTCOME_COLORS[o.outcomeType]}`}>
                    {OUTCOME_LABELS[o.outcomeType]}
                  </Badge>
                  {o.outcomeType === "transfer" && (o.transferType === "direct" || o.transferType === "appointment") && (
                    <Badge
                      className={`text-[10px] w-fit px-1.5 py-0 ${
                        o.transferType === "direct"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                      }`}
                      data-testid={`badge-transfer-type-${o.id}`}
                    >
                      {o.transferType === "direct" ? "Direct" : "Appt/Callback"}
                    </Badge>
                  )}
                </div>
                <span className="text-sm text-muted-foreground truncate" data-testid={`text-outcome-lo-${o.id}`}>
                  {o.lo?.fullName ?? `LO #${o.loId}`}
                </span>
                <span className="text-sm text-muted-foreground truncate">
                  {o.assistant?.name ?? `Assistant #${o.assistantId}`}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-semibold truncate min-w-0">
                    {o.borrowerName || <span className="text-muted-foreground/50 font-normal">—</span>}
                  </span>
                  {o.followUpDate && (
                    <Badge variant="outline" className="w-fit text-[10px] px-1 py-0 text-purple-600 border-purple-300">
                      Follow-up {formatFollowUp(o.followUpDate)}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 justify-end min-w-0">
                  {(() => {
                    const isOwner = authUser?.id != null && o.assistantId === authUser.id;
                    const isAdmin = authUser?.role === "admin";
                    if (!isOwner && !isAdmin) return null;
                    return (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                          onClick={() => setEditTarget(o)}
                          title={!isOwner && isAdmin ? "Editing another CLR's record" : undefined}
                          data-testid={`button-edit-outcome-${o.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                          onClick={() => deleteMutation.mutate(o.id)}
                          data-testid={`button-delete-outcome-${o.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Showing {filtered.length} of {outcomes.length} outcomes
        </p>
      )}

      <OutcomeFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={values => createMutation.mutate(values)}
        isPending={createMutation.isPending}
        users={users}
        los={los}
      />

      <EditOutcomeDialog
        outcome={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={values => editTarget && updateMutation.mutate({ id: editTarget.id, data: values })}
        isPending={updateMutation.isPending}
        los={los}
        currentUserId={authUser?.id}
      />
    </div>
  );
}
