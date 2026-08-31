import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LoaPicker } from "@/components/loa-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Filter, ClipboardList, Pencil, Zap, CalendarCheck,
  ChevronLeft, ChevronRight, Check, Copy,
  ArrowRightLeft, CalendarPlus, PhoneCall, ArrowLeft, Info,
} from "lucide-react";
import { HelpIcon, markStep } from "@/components/onboarding";
import { useAuth } from "@/lib/auth";
import { businessTodayClient } from "@/lib/business-day";
import { type LeadCapture, emptyLeadCapture, LEAD_SOURCE_OPTIONS, QUAL_QUESTIONS, INFO_FIELDS, INVESTMENT_ROUTING_HINT, composeLeadCaptureNotes } from "@/lib/lead-capture";
import { copyToClipboard } from "@/lib/utils";

// Compliance reminder displayed above every CLR-facing notes textarea.
// CLRs should describe the conversation (rapport, objections, lead's vibe),
// NOT loan-level facts (rates, balances, income, SSN, etc.). Loan data
// belongs in the LO's system once the lead is handed off.
function NotesPolicyNote() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        <strong>Summarize the conversation only.</strong>{" "}
        Do not enter loan details (rate, balance, income, SSN, property value, etc.) —
        just capture what the lead said, their vibe, and any objections.
      </span>
    </div>
  );
}

const OUTCOME_TYPES = [
  "transfer", "appointment", "deferral", "fell_through",
  "no_answer", "not_interested", "wrong_number", "other"
] as const;

// Includes legacy future_contact for backward compatibility (displayed as Deferral)
const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer", appointment: "Appointment", fell_through: "Fell Through",
  no_answer: "No Answer",
  deferral: "Deferral", future_contact: "Deferral",
  not_interested: "Not Interested", wrong_number: "Wrong Number", other: "Other",
};

const OUTCOME_HELPERS: Record<string, string> = {
  appointment: "Specific date & time confirmed",
  deferral: "Month+ away — open to future contact, no date set",
};

// ── Result picker tiles — the first screen of the log-contact flow ────────────
// The CLR logs transfers and scheduled appointments here. Follow-Up from
// CallTools also arrives as an appointment, so C3 has one calendar concept.
// Each tile leads with the ONE thing that sets it apart from the other two,
// so picking the right result is obvious at a glance.
const OUTCOME_TILES: Array<{
  type: typeof OUTCOME_TYPES[number];
  icon: any;
  diff: string;   // the key differentiator — rendered bold
  detail: string; // supporting explanation
  tone: string;   // tailwind classes for the tile
}> = [
  {
    type: "transfer",
    icon: ArrowRightLeft,
    diff: "Lead was handed to an LO",
    detail: "Live on the line right now, or sent over as a scheduled transfer. The LO has the lead.",
    tone: "border-green-500 bg-green-50 hover:bg-green-100 text-green-900 dark:bg-green-900/20 dark:hover:bg-green-900/30 dark:text-green-200 dark:border-green-700",
  },
  {
    type: "appointment",
    icon: CalendarPlus,
    diff: "Exact date & time confirmed — no handoff yet",
    detail: "A specific slot is on the books. The lead was NOT connected to an LO on this call.",
    tone: "border-blue-500 bg-blue-50 hover:bg-blue-100 text-blue-900 dark:bg-blue-900/20 dark:hover:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700",
  },
];

// One-click copy for call notes — lives next to the notes fields and inside
// the Bonzo confirmation step so notes can be pasted straight into Bonzo.
function CopyNotesButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs shrink-0"
      disabled={!text.trim()}
      onClick={async () => {
        const ok = await copyToClipboard(text.trim());
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
      data-testid="button-copy-notes"
    >
      {copied ? <Check className="w-3.5 h-3.5 mr-1 text-green-600" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

const OUTCOME_COLORS: Record<string, string> = {
  transfer: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  appointment: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  fell_through: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  no_answer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  deferral: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  future_contact: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  not_interested: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  wrong_number: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const TRANSFER_TYPES = ["direct", "appointment"] as const;
type TransferType = typeof TRANSFER_TYPES[number];

// Chris Redoble transfers are expected to be attributed to one of his LOAs (that
// drives the Bonzo "(LOA l CLR)" name suffix + LOA credit). A transfer logged for
// him with no LOA is flagged "(LOA missing)" so it can be caught and fixed.
const CHRIS_REDOBLE_RE = /chris\s+redoble/i;
const isChrisRedoble = (name?: string | null) => CHRIS_REDOBLE_RE.test(String(name ?? ""));

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



// Radix Select rejects "" as an item value, so the "no LO" choice needs a
// non-empty sentinel. It never leaves the form — it maps to null on change.
const UNASSIGNED_LO = "__none__";

const outcomeFormSchema = z.object({
  loaId: z.coerce.number().optional().nullable(),
  date: z.string().min(1, "Date required"),
  assistantId: z.coerce.number().min(1, "Select an assistant"),
  // Optional here; the refine below requires it for transfers only. An
  // appointment can be booked before the LO is known.
  loId: z.coerce.number().optional().nullable(),
  outcomeType: z.enum(OUTCOME_TYPES),
  transferType: z.enum(TRANSFER_TYPES).optional().nullable(),
  bulkTexter: z.boolean().optional().nullable(),
  helperAssisted: z.boolean().optional().nullable(),
  borrowerName: z.string().optional(),
  journeyId: z.string().optional(),
  phoneNumber: z.string().optional(),
  notes: z.string().optional(),
  followUpDate: z.string().optional(),
  // Wizard fields (all optional — filled for transfers if not skipped)
  conversationNotes: z.string().optional(),
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
  // Which lead source this came in from. "other" pairs with the free-text field
  // so a CLR can always answer even when the list doesn't fit.
  leadSource: z.string().optional(),
  leadSourceOther: z.string().optional(),
  // Qualification checklist ("yes" | "no" | "") + info-gathering fields — these
  // compose into conversationNotes on submit so everything downstream (Bonzo
  // paste, LO handoff, reports) still sees one text block.
  qualOwnHome: z.string().optional(),
  qualBankruptcy: z.string().optional(),
  qualInvestment: z.string().optional(),

  infoAddress: z.string().optional(),
  infoBorrowerEmail: z.string().email("Enter a valid email").or(z.literal("")).optional(),
  infoBorrowerDob: z.string().optional(),
  infoCreditScoreExact: z.string().refine(v => !v || (/^\d{3}$/.test(v) && Number(v) >= 300 && Number(v) <= 850), "Enter a score from 300 to 850").optional(),
  infoCoborrowerName: z.string().optional(),
  infoCoborrowerDob: z.string().optional(),
  infoCoborrowerCreditScore: z.string().refine(v => !v || (/^\d{3}$/.test(v) && Number(v) >= 300 && Number(v) <= 850), "Enter a score from 300 to 850").optional(),
  infoGoal: z.string().optional(),
  infoTakeOut: z.string().optional(),
  infoValue: z.string().optional(),
  infoBalance: z.string().optional(),
  infoRate: z.string().optional(),
  infoPayment: z.string().optional(),
  infoHelocBalance: z.string().optional(),
  infoHelocRate: z.string().optional(),
  infoHelocPayment: z.string().optional(),
  infoIncome: z.string().optional(),
  infoEmployment: z.string().optional(),
  infoCreditScore: z.string().optional(),
  infoMilitary: z.string().optional(),
  infoEmploymentNotes: z.string().optional(),
  infoMilitaryNotes: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.outcomeType === "transfer" && val.transferType !== "direct" && val.transferType !== "appointment") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transferType"],
      message: "Select Direct or Appointment/Callback",
    });
  }
  if (val.outcomeType === "appointment" && !val.appointmentDatetime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["appointmentDatetime"],
      message: "Scheduled date & time is required for appointments",
    });
  }
  // A transfer goes TO someone, so it still needs an LO. An appointment does
  // not: it can be booked before anyone knows who will take it, and assigned
  // later from Upcoming Appointments.
  if (val.outcomeType !== "appointment" && !val.loId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["loId"],
      message: "Select a loan officer",
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

function OutcomeFormDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  users,
  los,
  todayCount = 0,
  todayRecent = [],
  resetSignal = 0,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: OutcomeFormValues, keepOpen?: boolean) => void;
  isPending: boolean;
  /** Logged so far today, so burst entry can see itself accumulate. */
  todayCount?: number;
  todayRecent?: Array<{ id: number; borrowerName?: string | null; outcomeType: string }>;
  /** Bumped by the page after a successful "Log & next", to clear the form. */
  resetSignal?: number;
  users: any[];
  los: any[];
}) {
  const { user: meUser } = useAuth();
  const meId = Number((meUser as any)?.id) || 0;
  const meIsAdmin = !!(meUser && ((meUser as any).role === "admin" || (meUser as any).superAdmin || (meUser as any).isManager));
  const form = useForm<OutcomeFormValues>({
    resolver: zodResolver(outcomeFormSchema),
    defaultValues: {
      date: businessTodayClient(),
      assistantId: meId || 1, // default to the logged-in CLR (not hardcoded)
      loId: 0,
      loaId: null,
      outcomeType: "transfer",
      // 2,759 of the last 3,085 outcomes were transfers, and Direct is the
      // common shape — so the form opens on the answer, not the question.
      transferType: "direct",
      bulkTexter: null,
      helperAssisted: null,
      borrowerName: "",
      journeyId: "",
      phoneNumber: "",
      notes: "",
      followUpDate: "",
      conversationNotes: "",
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
      leadSource: "",
      leadSourceOther: "",
      qualOwnHome: "",
      qualBankruptcy: "",
      qualInvestment: "",

      infoAddress: "",
      infoBorrowerEmail: "",
      infoBorrowerDob: "",
      infoCreditScoreExact: "",
      infoCoborrowerName: "",
      infoCoborrowerDob: "",
      infoCoborrowerCreditScore: "",
      infoGoal: "",
      infoTakeOut: "",
      infoValue: "",
      infoBalance: "",
      infoRate: "",
      infoPayment: "",
      infoHelocBalance: "",
      infoHelocRate: "",
      infoHelocPayment: "",
      infoIncome: "",
      infoEmployment: "",
      infoCreditScore: "",
      infoMilitary: "",
      infoEmploymentNotes: "",
      infoMilitaryNotes: "",
    },
  });

  // Final gate before anything is logged: a confirmation step that asks
  // whether the call has been put into Bonzo (with one-click notes copy).
  const [confirmBonzo, setConfirmBonzo] = useState(false);
  // The long tail is collapsed by default. Nothing is hidden silently — the
  // header keeps a count of what is filled inside it.
  const [showInfo, setShowInfo] = useState(false);

  // After a "Log & next", clear the call-specific answers and keep only the
  // routing context. Carrying the borrower, phone, notes, qualification
  // answers or lead source would silently attribute one call's details to the
  // next one — the failure mode is a wrong record, not a slow one.
  useEffect(() => {
    if (!resetSignal) return;
    const keep = form.getValues();
    form.reset({
      ...form.formState.defaultValues as OutcomeFormValues,
      date: keep.date,
      assistantId: keep.assistantId,
      outcomeType: keep.outcomeType,
      transferType: keep.transferType,
      loId: keep.loId,
      loaId: keep.loaId,
    });
    setConfirmBonzo(false);
    setShowInfo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);
  // Org toggle: ask whether Bulk Texter was part of the transfer.
  const { data: bulkTexterCfg } = useQuery<{ askBulkTexter: boolean }>({ queryKey: ["/api/settings/bulk-texter"] });
  const askBulkTexter = !!bulkTexterCfg?.askBulkTexter;
  // Org toggle: ask whether the named helper (Elleine) was part of the transfer.
  const { data: helperCfg } = useQuery<{ askHelper: boolean; helperName: string }>({ queryKey: ["/api/settings/helper"] });
  const askHelper = !!helperCfg?.askHelper;
  const helperName = helperCfg?.helperName || "Elleine";

  const watchedType = form.watch("outcomeType");
  const infoValues = form.watch(INFO_FIELDS.map((f) => f.name) as any);
  const infoFilledCount = (infoValues as any[]).filter((v) => String(v ?? "").trim()).length;
  const watchedTransferType = form.watch("transferType");
  const watchedBulkTexter = form.watch("bulkTexter");
  const watchedHelper = form.watch("helperAssisted");
  const isTransfer = watchedType === "transfer";

  // Clear transferType whenever outcome moves away from "transfer" so stale
  // values don't trip the superRefine on a later transfer selection.
  useEffect(() => {
    if (watchedType !== "transfer" && form.getValues("transferType") != null) {
      form.setValue("transferType", null, { shouldValidate: false });
    }
  }, [watchedType, form]);

  useEffect(() => {
    if (open) { setConfirmBonzo(false); if (meId) form.setValue("assistantId", meId, { shouldValidate: false }); }
  }, [open]);



  const pickOutcome = (type: typeof OUTCOME_TYPES[number]) => {
    form.setValue("outcomeType", type, { shouldValidate: false });
    // Clear stale transferType when re-picking a non-transfer outcome
    if (type !== "transfer") {
      form.setValue("transferType", null, { shouldValidate: false });
    }
  };

  const handleSkip = () => {
    // Clear the qualification answers, then go straight to the Bonzo
    // confirmation — the escape hatch for a transfer logged in a hurry.
    {
      form.setValue("conversationNotes", "");
      for (const k of ["qualOwnHome", "qualBankruptcy", "qualInvestment",
        "infoBorrowerEmail", "infoBorrowerDob", "infoCreditScoreExact",
        "infoCoborrowerName", "infoCoborrowerDob", "infoCoborrowerCreditScore",
        "infoAddress", "infoGoal", "infoTakeOut", "infoValue", "infoBalance", "infoRate",
        "infoPayment", "infoHelocBalance", "infoHelocRate", "infoHelocPayment",
        "infoIncome", "infoEmployment", "infoEmploymentNotes",
        "infoCreditScore", "infoMilitary", "infoMilitaryNotes"] as const) {
        form.setValue(k, "");
      }
      setConfirmBonzo(true);
    }
  };

  // The checklist and info fields serialize into conversationNotes, so
  // everything downstream — the Bonzo paste, the LO handoff, reports — still
  // sees one text block in the shape LOs already know from the call script.
  const composeConversationNotes = (): string => {
    const v = form.getValues();
    const c: LeadCapture = { ...emptyLeadCapture() };
    for (const k of Object.keys(c) as (keyof LeadCapture)[]) {
      const raw = (v as any)[k];
      if (typeof raw === "string") c[k] = raw as any;
    }
    return composeLeadCaptureNotes(c);
  };

  // Validate the form, then show the Bonzo question instead of logging
  // immediately. Actual submit only happens from the confirmation step.
  const handleAttemptSubmit = async () => {
    if (isTransfer) form.setValue("conversationNotes", composeConversationNotes());
    const ok = await form.trigger();
    if (!ok) return;
    setConfirmBonzo(true);
  };

  // The call notes a CLR pastes into Bonzo — conversation summary + notes.
  const notesForBonzo = [form.watch("conversationNotes"), form.watch("notes")]
    .map(s => (s || "").trim())
    .filter(Boolean)
    .join("\n\n");

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0 max-h-[92vh] flex flex-col overflow-hidden">
        <DialogHeader className="space-y-1 px-4 sm:px-5 pt-4 sm:pt-5 pb-2 shrink-0">
          <DialogTitle className="text-base">
            {confirmBonzo ? "One last thing — Bonzo" : "Log Outcome"}
            {todayCount > 0 && (
              <span className="ml-2 align-middle text-[11px] font-normal text-muted-foreground" data-testid="text-today-count">
                {todayCount} logged today
                {todayRecent.length > 0 && (
                  <> · last: {todayRecent.map((o) => o.borrowerName || OUTCOME_LABELS[o.outcomeType] || "—").join(", ")}</>
                )}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => onSubmit(v))} className="flex flex-col min-h-0 flex-1">
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-3 space-y-3">

          {/* Outcome type — the first thing on the page, always visible and
              always changeable. It used to be a separate full-screen step that
              had to be cleared before any field appeared. */}
          {!confirmBonzo && (
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What was the result?">
              {OUTCOME_TILES.map(tile => {
                const Icon = tile.icon;
                const active = watchedType === tile.type;
                return (
                  <button
                    key={tile.type}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickOutcome(tile.type)}
                    data-testid={`tile-outcome-${tile.type}`}
                    className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-center transition-colors ${
                      active ? tile.tone : "border-border bg-background hover:bg-muted/60"
                    }`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="text-xs font-bold leading-tight">{OUTCOME_LABELS[tile.type]}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!confirmBonzo && OUTCOME_HELPERS[watchedType] && (
            <p className="text-[11px] text-muted-foreground -mt-1">{OUTCOME_HELPERS[watchedType]}</p>
          )}

          {!confirmBonzo && (
          <>
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
            {isTransfer && askBulkTexter && (
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Was Bulk Texter part of this transfer?</p>
                  <p className="text-xs text-muted-foreground">Tracked in stats and dashboards.</p>
                </div>
                <Switch
                  checked={!!watchedBulkTexter}
                  onCheckedChange={(v) => form.setValue("bulkTexter", v, { shouldDirty: true })}
                  data-testid="toggle-bulk-texter"
                />
              </div>
            )}
            {isTransfer && askHelper && (
              <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Was {helperName} part of this transfer?</p>
                  <p className="text-xs text-muted-foreground">Counted toward {helperName}'s per-transfer total.</p>
                </div>
                <Switch
                  checked={!!watchedHelper}
                  onCheckedChange={(v) => form.setValue("helperAssisted", v, { shouldDirty: true })}
                  data-testid="toggle-helper-assisted"
                />
              </div>
            )}
            <FormField control={form.control} name="assistantId" render={({ field }) => (
              <FormItem>
                <FormLabel>CLR Assistant</FormLabel>
                {meIsAdmin ? (
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
                ) : (
                  <FormControl>
                    <Input value={(meUser as any)?.name ?? "You"} readOnly disabled data-testid="select-assistant" />
                  </FormControl>
                )}
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="loId" render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Loan Officer
                  {watchedType === "appointment" && (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">optional</span>
                  )}
                </FormLabel>
                <Select
                  value={field.value ? String(field.value) : UNASSIGNED_LO}
                  onValueChange={v => field.onChange(v === UNASSIGNED_LO ? null : Number(v))}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-lo"><SelectValue placeholder="Select LO" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {/* Booking without an LO has to be a deliberate choice, not
                        an empty field someone forgot — so it is a real option. */}
                    {watchedType === "appointment" && (
                      <SelectItem value={UNASSIGNED_LO} data-testid="select-lo-unassigned">
                        No LO yet — assign later
                      </SelectItem>
                    )}
                    {los.filter((lo: any) => lo.internalStatus === "active").map((lo: any) => (
                      <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="loaId" render={({ field }) => (
              <FormItem>
                <FormLabel>Loan Officer Assistant (optional)</FormLabel>
                <LoaPicker loId={form.watch("loId")} value={field.value ?? null} onChange={field.onChange} />
                {isTransfer && field.value == null && isChrisRedoble(los.find((lo: any) => lo.id === form.watch("loId"))?.fullName) && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-1" data-testid="loa-missing-hint">
                    (LOA missing) — pick which assistant took this transfer, or it'll be attributed to Chris directly.
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="leadSource" render={({ field }) => (
              <FormItem>
                <FormLabel>Which lead source did this come in from?</FormLabel>
                <Select value={field.value || ""} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-lead-source"><SelectValue placeholder="Select lead source" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LEAD_SOURCE_OPTIONS.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                    <SelectItem value="other">Other — type it in</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            {form.watch("leadSource") === "other" && (
              <FormField control={form.control} name="leadSourceOther" render={({ field }) => (
                <FormItem>
                  <FormControl><Input {...field} placeholder="Where did this lead come from?" data-testid="input-lead-source-other" /></FormControl>
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="borrowerName" render={({ field }) => (
              <FormItem>
                <FormLabel>Borrower Name</FormLabel>
                <FormControl><Input {...field} placeholder="Optional" data-testid="input-borrower-name" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="phoneNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone Number</FormLabel>
                <FormControl><Input type="tel" {...field} placeholder="Optional" data-testid="input-phone-number" /></FormControl>
              </FormItem>
            )} />
            {!isTransfer && watchedType === "appointment" && (
              <FormField control={form.control} name="appointmentDatetime" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Scheduled Date &amp; Time{watchedType === "appointment" ? <span className="text-destructive"> *</span> : " (optional)"}{" "}
                    <span className="text-[11px] font-normal text-muted-foreground">
                      ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                    </span>
                  </FormLabel>
                  <FormControl><Input type="datetime-local" {...field} data-testid="input-scheduled-datetime" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}
            {/* Only show the followUpDate field when appointmentDatetime is NOT already shown.
                For appointment/callback types, the appointmentDatetime IS the follow-up date.
                For other types, this one field feeds the Upcoming Appointments tab. */}
            {watchedType !== "appointment" && !isTransfer && (
              <FormField control={form.control} name="followUpDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Schedule for Upcoming Appointments{" "}
                    <span className="text-[11px] font-normal text-muted-foreground">
                      (optional — {Intl.DateTimeFormat().resolvedOptions().timeZone})
                    </span>
                  </FormLabel>
                  <FormControl><Input type="datetime-local" {...field} data-testid="input-appointment-date" /></FormControl>
                  <p className="text-[11px] text-muted-foreground">Sets a follow-up reminder visible on the Upcoming Appointments tab.</p>
                </FormItem>
              )} />
            )}
            {!isTransfer && (
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Notes</FormLabel>
                    <CopyNotesButton text={field.value || ""} />
                  </div>
                  <NotesPolicyNote />
                  <FormControl><Textarea {...field} rows={2} placeholder="Summary of the conversation — not loan details…" data-testid="textarea-outcome-notes" /></FormControl>
                </FormItem>
              )} />
            )}
          </>
          )}

          {/* Qualification + Info Gathering — same page, below the details. */}
          {!confirmBonzo && isTransfer && (
            <>
              <p className="text-sm font-semibold text-foreground">Qualification</p>
              {QUAL_QUESTIONS.map(q => (
                <FormField key={q.name} control={form.control} name={q.name as any} render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-3">
                      <FormLabel className="mb-0 text-[13px] leading-snug">
                        {q.label}
                        {q.cue && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">({q.cue})</span>}
                      </FormLabel>
                      <div className="flex gap-2 shrink-0">
                        {(["yes", "no"] as const).map(v => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => field.onChange(field.value === v ? "" : v)}
                            data-testid={`qual-${q.name}-${v}`}
                            className={`text-xs px-3 py-1.5 rounded-md border font-medium ${field.value === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                          >{v === "yes" ? "Yes" : "No"}</button>
                        ))}
                      </div>
                    </div>
                  </FormItem>
                )} />
              ))}
              {form.watch("qualInvestment") === "yes" && (
                <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400" data-testid="qual-investment-hint">
                  {INVESTMENT_ROUTING_HINT}
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowInfo((v) => !v)}
                className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm font-semibold hover:bg-muted"
                data-testid="toggle-info-gathering"
              >
                <span>Info Gathering</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {infoFilledCount > 0 ? `${infoFilledCount} filled` : "optional"} · {showInfo ? "hide" : "show"}
                </span>
              </button>
              {/* Kept in the DOM when hidden would mean 20 registered inputs on
                  every render; unmounting is fine because react-hook-form holds
                  the values, so reopening restores what was typed. */}
              {showInfo && INFO_FIELDS.map((f, index) => (
                <div key={f.name} className="space-y-1.5">
                  {(index === 0 || INFO_FIELDS[index - 1].section !== f.section) && (
                    <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{f.section}</p>
                  )}
                  <FormField control={form.control} name={f.name as any} render={({ field }) => (
                    <FormItem className="grid grid-cols-[9.5rem_1fr] items-start gap-2 space-y-0">
                      <FormLabel className="mb-0 pt-1.5 text-[12px] text-muted-foreground">{f.label}</FormLabel>
                      {f.options ? (
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap gap-1.5">
                            {f.options.map(opt => (
                              <button
                                key={opt}
                                type="button"
                                // Tapping the selected answer again clears it, so a
                                // mistake does not need the whole form reset.
                                onClick={() => field.onChange(field.value === opt ? "" : opt)}
                                className={`text-xs px-3 py-1.5 rounded-md border font-medium ${
                                  field.value === opt
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "border-border hover:bg-muted"
                                }`}
                                data-testid={`input-${f.name}-${opt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                              >{opt}</button>
                            ))}
                          </div>
                          {f.notes && (
                            <FormField control={form.control} name={f.notes as any} render={({ field: notesField }) => (
                              <FormItem className="space-y-0">
                                <FormControl>
                                  <Input {...notesField} className="h-8" placeholder={f.notesPlaceholder} data-testid={`input-${f.notes}`} />
                                </FormControl>
                              </FormItem>
                            )} />
                          )}
                        </div>
                      ) : (
                        <div>
                          <FormControl>
                            <Input
                              {...field}
                              type={f.type || "text"}
                              inputMode={f.inputMode}
                              maxLength={f.maxLength}
                              placeholder={f.placeholder}
                              onChange={e => field.onChange(f.digitsOnly ? e.target.value.replace(/\D/g, "").slice(0, f.maxLength) : e.target.value)}
                              className="h-8"
                              data-testid={`input-${f.name}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </div>
                      )}
                    </FormItem>
                  )} />
                </div>
              ))}
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Other Notes</FormLabel>
                    <CopyNotesButton text={field.value || ""} />
                  </div>
                  <NotesPolicyNote />
                  <FormControl><Textarea {...field} rows={2} placeholder="Anything else worth passing along…" data-testid="textarea-other-notes" /></FormControl>
                </FormItem>
              )} />
            </>
          )}

          {/* ── Bonzo gate — questions the CLR before anything is logged ── */}
          {confirmBonzo && (
            <div className="space-y-3">
              <div className="rounded-md border-2 border-amber-400/70 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Have you put this call into Bonzo?
                </p>
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1 leading-snug">
                  Copy the notes below, record them in Bonzo using the appropriate notation,
                  then confirm to log the {OUTCOME_LABELS[watchedType]?.toLowerCase() || "outcome"}.
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Call notes</p>
                  <CopyNotesButton text={notesForBonzo} label="Copy notes" />
                </div>
                {notesForBonzo ? (
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-bonzo-notes-preview">{notesForBonzo}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No notes entered for this call.</p>
                )}
              </div>
            </div>
          )}

            </div>
          {/* Footer */}
          <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between px-4 sm:px-5 py-3 border-t bg-background shrink-0">
            {confirmBonzo ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmBonzo(false)} disabled={isPending}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Not yet — go back
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={isPending} data-testid="button-confirm-bonzo">
                    {isPending ? "Saving…" : "Yes, it's in Bonzo — Log Outcome"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isPending}
                    onClick={() => form.handleSubmit((v) => onSubmit(v, true))()}
                    data-testid="button-log-and-next"
                  >
                    Log &amp; next
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                </div>
                <div className="flex gap-2">
                  {isTransfer && (
                    <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
                      Skip qualification
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={handleAttemptSubmit}
                    disabled={
                      isPending ||
                      (isTransfer && watchedTransferType !== "direct" && watchedTransferType !== "appointment")
                    }
                    data-testid="button-save-outcome"
                  >
                    Log Outcome
                  </Button>
                </div>
              </>
            )}
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
  phoneNumber: z.string().optional(),
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

const FOLLOWUP_TYPES = new Set(["appointment", "deferral", "future_contact"]);

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
      phoneNumber: "",
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
        phoneNumber: outcome.phoneNumber ?? "",
        followUpDate: outcome.followUpDate ?? "",
        notes: outcome.notes ?? "",
      });
      setBonzoLogged(false);
    }
  }, [open, outcome, form]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>Edit Outcome</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col min-h-0 flex-1">
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2 space-y-4">
            {outcome && currentUserId != null && outcome.assistantId !== currentUserId && (
              <div className="text-xs px-3 py-2 rounded-md border border-amber-300 bg-amber-50 text-amber-900">
                Editing another CLR's record ({outcome.assistant?.name ?? `Assistant #${outcome.assistantId}`}).
              </div>
            )}
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
            <FormField control={form.control} name="phoneNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone Number</FormLabel>
                <FormControl><Input type="tel" {...field} placeholder="Optional" data-testid="input-edit-phone-number" /></FormControl>
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
                <NotesPolicyNote />
                <FormControl><Textarea {...field} rows={2} placeholder="Summary of the conversation — not loan details…" data-testid="textarea-edit-notes" /></FormControl>
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
            </div>
            <DialogFooter className="px-6 py-3 border-t bg-background shrink-0">
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

// Log and review results a CLR got from working today's lead sources. Sits
// alongside LO outcomes — a lead source is a workable target you log against,
// just like an LO.
function LeadSourceResults() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [sourceId, setSourceId] = useState("");
  const [outcomeType, setOutcomeType] = useState("transfer");
  const [count, setCount] = useState("1");
  const [notes, setNotes] = useState("");

  const { data: today } = useQuery<{ sources: { id: number; name: string; notes: string; ownerId: number | null }[] }>({
    queryKey: ["/api/lead-sources/today"],
    queryFn: () => apiRequest("GET", "/api/lead-sources/today"),
  });
  const { data: logged = [] } = useQuery<any[]>({
    queryKey: ["/api/lead-source-outcomes"],
    queryFn: () => apiRequest("GET", "/api/lead-source-outcomes"),
  });
  // Only the source(s) assigned to this CLR today are theirs to log — sources
  // are distributed one owner per day, like LOs.
  const sources = (today?.sources ?? []).filter((s) => s.ownerId === user?.id);

  const logMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/lead-source-outcomes", {
      leadSourceId: Number(sourceId), outcomeType, count: Number(count) || 1, notes,
    }),
    onSuccess: () => {
      toast({ title: "Result logged" });
      setNotes(""); setCount("1");
      queryClient.invalidateQueries({ queryKey: ["/api/lead-source-outcomes"] });
    },
    onError: (e: any) => toast({ title: "Couldn't log", description: e?.message, variant: "destructive" }),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/lead-source-outcomes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/lead-source-outcomes"] }),
  });

  // Nothing to work today and nothing logged — stay out of the way.
  if (sources.length === 0 && logged.length === 0) return null;

  return (
    <Card className="border-violet-200 dark:border-violet-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          Lead Source Results
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">Log what you got from working today's lead sources.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sources.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[160px] flex-1">
              <label className="text-[11px] font-medium text-muted-foreground">Source</label>
              <Select value={sourceId || String(sources[0].id)} onValueChange={setSourceId}>
                <SelectTrigger data-testid="lso-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sources.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-36">
              <label className="text-[11px] font-medium text-muted-foreground">Result</label>
              <Select value={outcomeType} onValueChange={setOutcomeType}>
                <SelectTrigger data-testid="lso-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTCOME_TYPES.map((t) => <SelectItem key={t} value={t}>{OUTCOME_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-20">
              <label className="text-[11px] font-medium text-muted-foreground">Count</label>
              <Input type="number" min={1} max={999} value={count} onChange={e => setCount(e.target.value)} data-testid="lso-count" />
            </div>
            <div className="min-w-[140px] flex-1">
              <label className="text-[11px] font-medium text-muted-foreground">Notes (optional)</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} placeholder="Context…" data-testid="lso-notes" />
            </div>
            <Button
              onClick={() => logMut.mutate()}
              disabled={logMut.isPending}
              data-testid="lso-log"
            >
              <Plus className="w-4 h-4 mr-1" />Log
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No lead source is assigned to you today.</p>
        )}
        {logged.length > 0 && (
          <div className="divide-y rounded-lg border">
            {logged.map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid={`lso-row-${r.id}`}>
                <Badge variant="outline" className="font-normal">{r.sourceName}</Badge>
                <span className="font-medium">{r.count}× {OUTCOME_LABELS[r.outcomeType] ?? r.outcomeType}</span>
                {r.notes && <span className="text-muted-foreground truncate">· {r.notes}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{r.assistantName}</span>
                {(user?.id === r.assistantId || user?.role === "admin" || (user as any)?.isManager) && (
                  <button className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Remove" onClick={() => delMut.mutate(r.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Outcomes() {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formResetSignal, setFormResetSignal] = useState(0);
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

  // After any outcome submission — create / edit / reschedule / delete —
  // refresh ALL queries so every page (Dashboard, Appointments, Reports,
  // Leaderboard, EOD, Sidebar counters, etc.) reflects the change instantly
  // without the user needing to navigate away and back.
  const refreshAll = () => queryClient.invalidateQueries();

  const createMutation = useMutation({
    mutationFn: ({ data }: { data: any; keepOpen?: boolean }) =>
      apiRequest("POST", "/api/outcomes", data),
    onSuccess: (_res, vars) => {
      refreshAll();
      // "Log & next" leaves the form up for the next call. Closing and
      // reopening the dialog 20-40 times a day was the single most repeated
      // action on this page.
      if (vars?.keepOpen) setFormResetSignal((n) => n + 1);
      else setDialogOpen(false);
      markStep(authUser?.id, "log_outcome");
      toast({ title: vars?.keepOpen ? "Logged — next call" : "Outcome logged" });
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
      refreshAll();
      setEditTarget(null);
      toast({ title: "Outcome updated" });
    },
    onError: () => toast({ title: "Error updating outcome", variant: "destructive" }),
  });

  const updateDateMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) =>
      apiRequest("PATCH", `/api/outcomes/${id}`, { date }),
    onSuccess: () => {
      refreshAll();
      toast({ title: "Date updated" });
    },
    onError: () => toast({ title: "Error updating date", variant: "destructive" }),
  });

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/outcomes/${id}`),
    onSuccess: () => {
      refreshAll();
      setDeleteTarget(null);
      toast({ title: "Outcome deleted" });
    },
    onError: () => toast({ title: "Error deleting outcome", variant: "destructive" }),
  });

  // Today's own rows, for the burst-entry counter. Scoped to the logged-in
  // person even when a manager is filtering to someone else, because the
  // counter describes what YOU have just been entering.
  const todayStr = businessTodayClient();
  const loggedToday = outcomes
    .filter((o: any) => String(o.date).slice(0, 10) === todayStr
      && (!authUser?.id || Number(o.assistantId) === Number(authUser.id)))
    .sort((a: any, b: any) => Number(b.id) - Number(a.id));

  const filtered = outcomes.filter((o: any) => {
    const matchType = filterType === "all" || o.outcomeType === filterType;
    const matchAssistant = filterAssistant === "all" || String(o.assistantId) === filterAssistant;
    const matchSearch = !search || (o.borrowerName?.toLowerCase().includes(search.toLowerCase())) || o.lo?.fullName?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchAssistant && matchSearch;
  });

  // Quick-count summary — group by display label so legacy aliases
  // (e.g. future_contact -> "Deferral") merge into a single chip.
  const countByLabel: Record<string, { count: number; type: string }> = {};
  filtered.forEach((o: any) => {
    const rawType = o.outcomeType;
    const label = OUTCOME_LABELS[rawType] ?? rawType;
    if (!countByLabel[label]) {
      countByLabel[label] = { count: 0, type: rawType };
    }
    countByLabel[label].count += 1;
  });

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
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
            Log every call result here. Each outcome (Transfer, Appointment, Callback) is recorded and feeds into your EOD report and team stats automatically.
          </HelpIcon>
        </div>
      </div>

      {/* Lead source results — log outcomes for today's lead sources */}
      <LeadSourceResults />

      {/* Summary badges */}
      {filtered.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(countByLabel).sort((a, b) => b[1].count - a[1].count).map(([label, { count, type }]) => (
            <button
              key={label}
              onClick={() => setFilterType(filterType === type ? "all" : type)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium ${filterType === type ? "border-primary bg-primary/10 text-primary" : "border-border"} ${OUTCOME_COLORS[type]}`}
              data-testid={`badge-outcome-${type}`}
            >
              {label}: {count}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="glass-card flex gap-3 flex-wrap items-center p-3">
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
        <Card className="glass-strong overflow-hidden">
          <CardContent className="p-0">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[80px_1fr_1fr_1fr_120px_120px_80px] gap-3 px-4 py-2 border-b border-white/10 bg-gradient-to-b from-white/20 to-transparent dark:from-white/[0.04] text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>Date</span><span>Outcome</span><span>LO</span><span>Assistant</span><span>Borrower</span><span>Phone</span><span></span>
            </div>
            {filtered.map((o: any) => (
              <div
                key={o.id}
                className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_1fr_120px_120px_80px] gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/20 transition-colors items-center group"
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
                  {o.outcomeType === "transfer" && o.loaId == null && isChrisRedoble(o.lo?.fullName) && (
                    <Badge
                      className="text-[10px] w-fit px-1.5 py-0 bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
                      title="Logged for Chris Redoble without an LOA — attribution defaulted to (CLR …). Edit to tag the assistant."
                      data-testid={`badge-loa-missing-${o.id}`}
                    >
                      (LOA missing)
                    </Badge>
                  )}
                  {o.verificationStatus && (
                    <Badge
                      className={`text-[10px] w-fit px-1.5 py-0 ${
                        o.verificationStatus.includes("verified")
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400"
                          : o.verificationStatus === "suspect"
                          ? "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400"
                          : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                      title={o.verificationReason ?? ""}
                      data-testid={`badge-verify-${o.id}`}
                    >
                      {o.verificationStatus.includes("verified") ? "✓ Verified" : o.verificationStatus === "suspect" ? "⚠ Suspect" : "Unverified"}
                    </Badge>
                  )}
                </div>
                <span className="text-sm text-muted-foreground truncate" data-testid={`text-outcome-lo-${o.id}`}>
                  {o.lo?.fullName ?? (o.loId ? `LO #${o.loId}` : "No LO assigned")}
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
                <span className="text-sm text-muted-foreground truncate font-mono" data-testid={`text-outcome-phone-${o.id}`}>
                  {o.phoneNumber ? (
                    <a href={`tel:${o.phoneNumber}`} className="hover:text-foreground hover:underline">{o.phoneNumber}</a>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </span>
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
                          onClick={() => setDeleteTarget(o)}
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
        onSubmit={(values, keepOpen) => {
          // For appointment/callback types, appointmentDatetime IS the follow-up date.
          // Copy it into followUpDate so the record appears in Upcoming Appointments.
          const normalized = {
            ...values,
            followUpDate: values.followUpDate || values.appointmentDatetime || "",
            // "other" is a UI value; what gets stored is what the CLR typed.
            leadSource: values.leadSource === "other"
              ? (values.leadSourceOther || "").trim() || null
              : values.leadSource || null,
          };
          createMutation.mutate({ data: normalized, keepOpen });
        }}
        isPending={createMutation.isPending}
        users={users}
        los={los}
        todayCount={loggedToday.length}
        todayRecent={loggedToday.slice(0, 3)}
        resetSignal={formResetSignal}
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

      {/* Delete confirmation — outcomes (incl. transfers) are real records, so confirm first. */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this {OUTCOME_LABELS[deleteTarget?.outcomeType] ?? "outcome"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.borrowerName?.trim() ? `${deleteTarget.borrowerName.trim()} — ` : ""}
              this permanently removes the record and updates the stats. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
