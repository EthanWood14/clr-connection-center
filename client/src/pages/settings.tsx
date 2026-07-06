import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Settings2, Save, RotateCcw, Info, Users, Megaphone, Activity, Lock, Mail, Shuffle, RepeatIcon, Calendar, ShieldCheck, PlayCircle, RefreshCw, Send, User, Sliders, LayoutGrid, Target, PhoneCall, Download, FileText, Shield, MessageSquare } from "lucide-react";
import AuditLog from "@/pages/audit-log";
import { TeamManagement } from "@/components/team-management";
import { BroadcastNotifications } from "@/components/broadcast-notifications";
import { PushNotificationsCard } from "@/components/push-notifications-card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

const DEFAULT_WEIGHTS = {
  weightDaysSinceWorked: 0.30,
  weightFrequency: 0.25,
  weightAvailability: 0.20,
  weightBoost: 0.10,
  weightPriorityTier: 0.05,
  weightRecentTransfers: 0.10,
  maxLosPerAssistant: 5,
  roundRobinEnabled: true,
};

const WEIGHT_FIELDS = [
  {
    key: "weightDaysSinceWorked" as const,
    label: "Days Since Last Worked",
    description: "Prioritizes LOs who haven't been worked in longer. Higher = older LOs rank higher.",
  },
  {
    key: "weightFrequency" as const,
    label: "Inverse Frequency",
    description: "Favors LOs who are worked less often overall.",
  },
  {
    key: "weightAvailability" as const,
    label: "Day Availability",
    description: "Boosts LOs who are scheduled available on the current day.",
  },
  {
    key: "weightBoost" as const,
    label: "Boost Score",
    description: "Manual boost (0–10) set per LO in the directory to bump them up.",
  },
  {
    key: "weightPriorityTier" as const,
    label: "Priority Tier",
    description: "Tier 1 (VIP) LOs get a slight automatic bump.",
  },
  {
    key: "weightRecentTransfers" as const,
    label: "90-Day Transfer Volume",
    description: "Boosts LOs with more transfers in the last 90 days — rewards recent production momentum.",
  },
];

type WeightKey = typeof WEIGHT_FIELDS[number]["key"];


// Tier labels and colors (mirrored from directory.tsx)
const TIER_LABELS: Record<number, string> = { 1: "VIP", 2: "Standard", 3: "Low" };
const TIER_COLORS: Record<number, string> = {
  1: "bg-amber-100 text-amber-700 border-amber-300",
  2: "bg-blue-50 text-blue-600 border-blue-200",
  3: "bg-gray-100 text-gray-500 border-gray-300",
};

type ScoreWeights = {
  weightDaysSinceWorked: number;
  weightFrequency: number;
  weightAvailability: number;
  weightBoost: number;
  weightPriorityTier: number;
  weightRecentTransfers: number;
};

function computeScore(
  lo: any,
  weights: ScoreWeights,
  opts: { maxXfers: number; transferPreference: "fewer" | "more" | "none" }
) {
  const daysSince = lo.lastWorkedDate
    ? Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86_400_000)
    : 999;
  const daysSinceNorm = Math.min(daysSince / 30, 1);
  const freqScore = 1 - Math.min((lo.totalTimesWorked ?? 0) / 100, 1);
  const availScore = 1;
  const boostNorm = (lo.boostScore ?? 0) / 10;
  const tierScore = lo.priorityTier === 1 ? 1 : lo.priorityTier === 2 ? 0.5 : 0.1;
  const recentXfers = lo.recentTransfers ?? lo.transfers90d ?? 0;
  const maxXfers = Math.max(opts.maxXfers, 1);
  let transferScore: number;
  if (opts.transferPreference === "more") {
    transferScore = recentXfers / maxXfers;
  } else if (opts.transferPreference === "none") {
    transferScore = 0.5;
  } else {
    transferScore = 1 - (recentXfers / maxXfers);
  }

  const score =
    weights.weightDaysSinceWorked * daysSinceNorm +
    weights.weightFrequency * freqScore +
    weights.weightAvailability * availScore +
    weights.weightBoost * boostNorm +
    weights.weightPriorityTier * tierScore +
    weights.weightRecentTransfers * transferScore;

  return {
    score,
    components: {
      recency: weights.weightDaysSinceWorked * daysSinceNorm,
      freq: weights.weightFrequency * freqScore,
      avail: weights.weightAvailability * availScore,
      boost: weights.weightBoost * boostNorm,
      tier: weights.weightPriorityTier * tierScore,
      transfers: weights.weightRecentTransfers * transferScore,
    },
  };
}

const COMPONENT_COLORS = [
  "bg-teal-100 text-teal-700",
  "bg-purple-100 text-purple-700",
  "bg-green-100 text-green-700",
  "bg-orange-100 text-orange-700",
  "bg-indigo-100 text-indigo-700",
  "bg-rose-100 text-rose-700",
];

function ScorePreview({
  weights,
  transferPreference,
}: {
  weights: ScoreWeights;
  transferPreference: "fewer" | "more" | "none";
}) {
  const { data: los = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const activeLos = los.filter(
    (lo) => lo.internalStatus === "active" && !lo.snoozeUntil
  );

  const maxXfers = activeLos.reduce(
    (m, lo) => Math.max(m, lo.recentTransfers ?? lo.transfers90d ?? 0),
    0
  );

  const ranked = activeLos
    .map((lo) => ({ lo, ...computeScore(lo, weights, { maxXfers, transferPreference }) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const transferDirLabel =
    transferPreference === "more"
      ? "more = higher"
      : transferPreference === "none"
      ? "neutral"
      : "fewer = higher";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-teal-600" />
            Score Preview
          </CardTitle>
          <span className="text-xs text-muted-foreground italic">
            Preview updates as you drag sliders. Save to apply.
          </span>
        </div>
        <div className="flex items-start gap-2 mt-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
          <span>
            Top 10 active loan officers ranked by the current (unsaved) weights. Hover a row to see the score breakdown.
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 px-4 pb-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="w-6 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 rounded bg-muted animate-pulse w-1/3" />
                <div className="h-2 rounded bg-muted animate-pulse w-full" />
              </div>
            </div>
          ))
        ) : ranked.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No active loan officers found.</p>
        ) : (
          ranked.map(({ lo, score, components }, idx) => (
            <div
              key={lo.id}
              className="group rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors"
            >
              {/* Main row */}
              <div className="flex items-center gap-3">
                {/* Rank */}
                <span className="w-7 shrink-0 text-xs font-bold text-muted-foreground text-right">
                  #{idx + 1}
                </span>

                {/* Name + tier badge */}
                <div className="flex items-center gap-1.5 min-w-0 w-36 shrink-0">
                  <span className="text-sm font-medium truncate">{lo.fullName}</span>
                </div>

                {/* Tier + boost */}
                <div className="flex items-center gap-1 shrink-0">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 leading-4 ${TIER_COLORS[lo.priorityTier as number] ?? TIER_COLORS[2]}`}
                  >
                    {TIER_LABELS[lo.priorityTier as number] ?? "Standard"}
                  </Badge>
                  {lo.boostScore > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 leading-4 bg-orange-50 text-orange-600 border-orange-200"
                    >
                      +{lo.boostScore}
                    </Badge>
                  )}
                </div>

                {/* Progress bar */}
                <div className="flex-1 min-w-0">
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-all duration-300"
                      style={{ width: `${Math.min(score * 100, 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>

                {/* Numeric score */}
                <span className="w-10 shrink-0 text-right text-xs font-mono font-semibold text-teal-700">
                  {score.toFixed(2)}
                </span>
              </div>

              {/* Breakdown chips — shown on hover */}
              <div className="mt-1.5 ml-10 flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {([
                  ["Recency", components.recency],
                  ["Freq", components.freq],
                  ["Avail", components.avail],
                  ["Boost", components.boost],
                  ["Tier", components.tier],
                  [`Transfers (${transferDirLabel}, wt ${(weights.weightRecentTransfers * 100).toFixed(0)}%)`, components.transfers],
                ] as [string, number][]).map(([label, val], ci) => (
                  <span
                    key={label}
                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${COMPONENT_COLORS[ci]}`}
                  >
                    {label} {val.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function WeightSliderRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="text-sm font-mono font-semibold text-primary w-12 text-right">
          {(value * 100).toFixed(0)}%
        </span>
      </div>
      <Slider
        min={0}
        max={100}
        step={5}
        value={[Math.round(value * 100)]}
        onValueChange={([v]) => onChange(v / 100)}
        data-testid={`slider-${label.toLowerCase().replace(/ /g, "-")}`}
        className="w-full"
      />
    </div>
  );
}

// ── Bulk Texter Card ──────────────────────────────────────────────────────────
// Org toggle: when on, the transfer-logging form asks whether Bulk Texter was
// part of the transfer.
function BulkTexterCard() {
  const { toast } = useToast();
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings/email"] });
  const askOn = !!(settings?.ask_bulk_texter);
  const save = useMutation({
    mutationFn: (on: boolean) => apiRequest("PATCH", "/api/settings/email", { askBulkTexter: on ? 1 : 0 }),
    onSuccess: (_d, on) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/email"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/bulk-texter"] });
      toast({ title: on ? "Bulk Texter question on" : "Bulk Texter question off" });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e?.message, variant: "destructive" }),
  });
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          Bulk Texter
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Ask on transfers</p>
            <p className="text-xs text-muted-foreground">
              When on, logging a transfer asks "Was Bulk Texter part of this transfer?" so it can be tracked in stats and dashboards.
            </p>
          </div>
          <Switch checked={askOn} onCheckedChange={(v) => save.mutate(v)} disabled={save.isPending} data-testid="toggle-ask-bulk-texter" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Email Reports Card ────────────────────────────────────────────────────────
// ── NMLS Schedule Card ───────────────────────────────────────────────────────
function NmlsScheduleCard() {
  const { toast } = useToast();
  const { data: schedule, isLoading } = useQuery<any>({ queryKey: ["/api/nmls-schedule"] });
  const [intervalDays, setIntervalDays] = useState("45");
  const [escalationDays, setEscalationDays] = useState("7");

  useEffect(() => {
    if (!schedule) return;
    setIntervalDays(String(schedule.interval_days ?? 45));
    setEscalationDays(String(schedule.escalation_days ?? 7));
  }, [schedule]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/nmls-schedule", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nmls-schedule"] });
      toast({ title: "NMLS schedule saved" });
    },
    onError: () => toast({ title: "Failed to save schedule", variant: "destructive" }),
  });

  const triggerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/nmls-checks/trigger", {}),
    onSuccess: () => toast({ title: "NMLS checks triggered", description: "Notifications sent to assigned CLRs." }),
    onError: () => toast({ title: "Failed to trigger checks", variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          NMLS License Check Schedule
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every 45 days (or your configured interval), a random CLR is assigned to verify each active LO's NMLS license on Consumer Access.
          If not confirmed within the escalation window, all CLRs are notified.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Check interval (days)</label>
                <Input
                  type="number" min={1} max={365} value={intervalDays}
                  onChange={e => setIntervalDays(e.target.value)}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">How often checks run (default: every 45 days). Saving restarts the countdown from today.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Escalation after (days)</label>
                <Input
                  type="number" min={1} max={30} value={escalationDays}
                  onChange={e => setEscalationDays(e.target.value)}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">Notify everyone if not confirmed</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate({ intervalDays: parseInt(intervalDays), escalationDays: parseInt(escalationDays) })}
                disabled={saveMutation.isPending}
                className="gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {saveMutation.isPending ? "Saving…" : "Save Schedule"}
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => triggerMutation.mutate()}
                disabled={triggerMutation.isPending}
                className="gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {triggerMutation.isPending ? "Triggering…" : "Trigger Checks Now"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EmailReportsCard() {
  const { toast } = useToast();
  const { data: emailSettings, isLoading: emailLoading } = useQuery<any>({
    queryKey: ["/api/settings/email"],
  });
  // CLR list for the All-Time "send for a single CLR" filter.
  const { data: allUsers = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const clrOptions = (allUsers ?? []).filter(
    (u: any) => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr))
  );
  // undefined / "all" → whole team; a numeric id → that CLR only (All-Time send).
  const [alltimeClrId, setAlltimeClrId] = useState<string>("all");
  const [dailySendDay, setDailySendDay] = useState<"yesterday" | "today">("yesterday");
  // Manager who receives comp/reimbursement requests for email approval.
  const [approvalRecipientId, setApprovalRecipientId] = useState<string>("");
  // Anyone active with an email can be the approver (managers/admins listed first).
  const managerOptions = (allUsers ?? [])
    .filter((u: any) => u.isActive && u.email && String(u.email).includes("@"))
    .sort((a: any, b: any) => {
      const am = a.role === "admin" || a.isManager ? 0 : 1;
      const bm = b.role === "admin" || b.isManager ? 0 : 1;
      return am - bm || String(a.name).localeCompare(String(b.name));
    });

  const [resendApiKey, setResendApiKey] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [ttsProvider, setTtsProvider] = useState("browser");
  const [ttsApiKey, setTtsApiKey] = useState("");
  const [ttsVoice, setTtsVoice] = useState("");
  const [managerEmails, setManagerEmails] = useState<string[]>([]);
  const [newManagerEmail, setNewManagerEmail] = useState("");
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [weeklyEnabled, setWeeklyEnabled] = useState(false);
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [mtdEnabled, setMtdEnabled] = useState(false);
  const [alltimeEnabled, setAlltimeEnabled] = useState(false);
  const [welcomeEmailEnabled, setWelcomeEmailEnabled] = useState(false);
  const [dailyTime, setDailyTime] = useState("07:45");
  const [weeklyTime, setWeeklyTime] = useState("08:00");
  const [monthlyTime, setMonthlyTime] = useState("07:00");
  const [mtdTime, setMtdTime] = useState("08:00");
  const [alltimeTime, setAlltimeTime] = useState("07:10");
  // Per-report-type section visibility ("what's in the email"). Keyed by report
  // type → { sectionKey: boolean }. Missing keys default to shown.
  const [reportSections, setReportSections] = useState<Record<string, Record<string, boolean>>>({});
  // "Send to all managers": when on, every active manager (is_manager) receives
  // all scheduled reports, on top of the manual Report Recipients list.
  const [sendToAllManagers, setSendToAllManagers] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);

  // Populate form from fetched settings
  useEffect(() => {
    if (!emailSettings) return;
    setResendApiKey(emailSettings.resend_api_key ?? emailSettings.resendApiKey ?? "");
    setAiApiKey(emailSettings.ai_api_key ?? emailSettings.aiApiKey ?? "");
    setAiModel(emailSettings.ai_model ?? emailSettings.aiModel ?? "");
    setTtsProvider(emailSettings.tts_provider ?? emailSettings.ttsProvider ?? "browser");
    setTtsApiKey(emailSettings.tts_api_key ?? emailSettings.ttsApiKey ?? "");
    setTtsVoice(emailSettings.tts_voice ?? emailSettings.ttsVoice ?? "");
    try { setManagerEmails(JSON.parse(emailSettings.manager_emails ?? emailSettings.managerEmails ?? "[]")); } catch { setManagerEmails([]); }
    setDailyEnabled(!!(emailSettings.daily_enabled ?? emailSettings.dailyEnabled));
    setWeeklyEnabled(!!(emailSettings.weekly_enabled ?? emailSettings.weeklyEnabled));
    setMonthlyEnabled(!!(emailSettings.monthly_enabled ?? emailSettings.monthlyEnabled));
    setMtdEnabled(!!(emailSettings.mtd_enabled ?? emailSettings.mtdEnabled));
    setAlltimeEnabled(!!(emailSettings.alltime_enabled ?? emailSettings.alltimeEnabled));
    setWelcomeEmailEnabled(!!(emailSettings.welcome_email_enabled ?? emailSettings.welcomeEmailEnabled));
    setDailyTime(emailSettings.daily_time ?? emailSettings.dailyTime ?? "07:45");
    setWeeklyTime(emailSettings.weekly_time ?? emailSettings.weeklyTime ?? "08:00");
    setMonthlyTime(emailSettings.monthly_time ?? emailSettings.monthlyTime ?? "07:00");
    setMtdTime(emailSettings.mtd_time ?? emailSettings.mtdTime ?? "08:00");
    setAlltimeTime(emailSettings.alltime_time ?? emailSettings.alltimeTime ?? "07:10");
    {
      const _ap = emailSettings.approval_recipient_id ?? emailSettings.approvalRecipientId ?? emailSettings.comp_approver_id ?? emailSettings.timeoff_approver_id;
      setApprovalRecipientId(_ap ? String(_ap) : "");
    }
    try {
      const rs = JSON.parse(emailSettings.report_sections ?? emailSettings.reportSections ?? "{}");
      setReportSections(rs && typeof rs === "object" ? rs : {});
    } catch { setReportSections({}); }
    try {
      const raw = emailSettings.report_to_all_managers ?? emailSettings.reportToAllManagers;
      // Unset / empty → default ON (historically all managers received reports).
      // Explicit object → ON if any report type is enabled, else OFF.
      if (raw === undefined || raw === null || raw === "" || raw === "{}") {
        setSendToAllManagers(true);
      } else {
        const tam = JSON.parse(raw);
        setSendToAllManagers(!!tam && typeof tam === "object" && Object.values(tam).some(v => v === true));
      }
    } catch { setSendToAllManagers(true); }
  }, [emailSettings]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/settings/email", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/email"] });
      toast({ title: "Email settings saved" });
    },
    onError: () => toast({ title: "Failed to save email settings", variant: "destructive" }),
  });

  function handleSave() {
    const payload: any = {
      managerEmails: JSON.stringify(managerEmails),
      dailyEnabled: dailyEnabled ? 1 : 0,
      weeklyEnabled: weeklyEnabled ? 1 : 0,
      monthlyEnabled: monthlyEnabled ? 1 : 0,
      mtdEnabled: mtdEnabled ? 1 : 0,
      alltimeEnabled: alltimeEnabled ? 1 : 0,
      welcomeEmailEnabled: welcomeEmailEnabled ? 1 : 0,
      dailyTime,
      weeklyTime,
      monthlyTime,
      mtdTime,
      alltimeTime,
      reportSections: JSON.stringify(reportSections),
      reportToAllManagers: JSON.stringify(sendToAllManagers ? { daily: true, weekly: true, monthly: true, mtd: true, alltime: true } : {}),
      approvalRecipientId: approvalRecipientId ? Number(approvalRecipientId) : null,
      compApproverId: approvalRecipientId ? Number(approvalRecipientId) : null,
      timeoffApproverId: approvalRecipientId ? Number(approvalRecipientId) : null,
    };
    if (resendApiKey && !resendApiKey.includes("•")) payload.resendApiKey = resendApiKey;
    if (aiApiKey && !aiApiKey.includes("•")) payload.aiApiKey = aiApiKey;
    payload.aiModel = aiModel;
    payload.ttsProvider = ttsProvider;
    if (ttsApiKey && !ttsApiKey.includes("•")) payload.ttsApiKey = ttsApiKey;
    payload.ttsVoice = ttsVoice;
    saveMutation.mutate(payload);
  }

  async function handleTest() {
    setTestLoading(true);
    try {
      const res = await fetch("/api/settings/email/test", { method: "POST", credentials: "include" });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (res.ok) {
        toast({
          title: "SMTP connection verified",
          description: "A test email was sent to your account inbox.",
        });
      } else {
        toast({
          title: "SMTP test failed",
          description: data.error ?? `Server responded with status ${res.status}. Check your host, port, and credentials.`,
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: "Test failed",
        description: "Could not reach the server.",
        variant: "destructive",
      });
    } finally {
      setTestLoading(false);
    }
  }

  async function handleSendNow(type: "daily" | "weekly" | "monthly" | "mtd" | "alltime", clrId?: string, day?: "today" | "yesterday") {
    const labelMap: Record<typeof type, string> = {
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      mtd: "Month-to-Date",
      alltime: "All-Time",
    } as any;
    const label = labelMap[type] ?? type;
    const persisted: string[] = (() => {
      try { return JSON.parse(emailSettings?.manager_emails ?? emailSettings?.managerEmails ?? "[]"); }
      catch { return []; }
    })();
    if (!persisted.length) {
      toast({
        title: `No saved recipients`,
        description: `Add recipients under Report Recipients and click Save Email Settings, then try again.`,
        variant: "destructive",
      });
      return;
    }
    setSendLoading(true);
    try {
      const res = await fetch("/api/settings/email/send-now", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, clrId: clrId && clrId !== "all" ? clrId : undefined, day: type === "daily" ? (day ?? "yesterday") : undefined }),
      });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (res.ok) {
        const serverRecipients: string[] = Array.isArray(data?.recipients) ? data.recipients : [];
        const recipients = serverRecipients.length
          ? serverRecipients.join(", ")
          : (managerEmails.length ? managerEmails.join(", ") : "configured recipients");
        const idSuffix = data?.id ? ` (id: ${String(data.id).slice(0, 8)}…)` : "";
        toast({
          title: `${label} report sent${idSuffix}`,
          description: `Delivered to: ${recipients}`,
        });
      } else {
        const reason = data.error ?? `Server responded with status ${res.status}.`;
        toast({
          title: `Failed to send ${label.toLowerCase()} report`,
          description: reason,
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({
        title: `Failed to send ${label.toLowerCase()} report`,
        description: "Could not reach the server. Check your network connection.",
        variant: "destructive",
      });
    } finally {
      setSendLoading(false);
    }
  }

  function addManagerEmail() {
    const em = newManagerEmail.trim().toLowerCase();
    if (!em || managerEmails.includes(em)) return;
    setManagerEmails(prev => [...prev, em]);
    setNewManagerEmail("");
  }

  function removeManagerEmail(em: string) {
    setManagerEmails(prev => prev.filter(e => e !== em));
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue-600" />
          Email Reports
        </CardTitle>
        <div className="flex items-start gap-2 mt-1 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
          <span>Emails are sent via <strong>Resend</strong> from <span className="font-mono text-xs">reports@westcapitallending.center</span>. The default API key is pre-configured — no setup needed.</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {emailLoading ? (
          <div className="space-y-3">{Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <>
            {/* Resend Config */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Resend Configuration</p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">API Key <span className="font-normal">(optional — default key pre-configured)</span></label>
                <Input
                  type="password"
                  placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                  value={resendApiKey}
                  onChange={e => setResendApiKey(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground">Emails send from <span className="font-mono">reports@westcapitallending.center</span>. To use a different API key, get one at <a href="https://resend.com/api-keys" target="_blank" className="underline">resend.com/api-keys</a>.</p>
              </div>
            </div>

            {/* AI Script Coach */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">AI Script Coach</p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Anthropic API Key</label>
                <Input
                  type="password"
                  placeholder="sk-ant-xxxxxxxxxxxx"
                  value={aiApiKey}
                  onChange={e => setAiApiKey(e.target.value)}
                  autoComplete="off"
                  data-testid="input-ai-key"
                />
                <p className="text-[10px] text-muted-foreground">Powers the voice "Build with Coach" tool on the Call Script page. Get a key at <a href="https://console.anthropic.com" target="_blank" className="underline">console.anthropic.com</a>. Can also be set via the ANTHROPIC_API_KEY env var.</p>
                <label className="text-xs font-medium text-muted-foreground mt-2 block">Model <span className="font-normal">(optional)</span></label>
                <Input
                  placeholder="claude-sonnet-4-6"
                  value={aiModel}
                  onChange={e => setAiModel(e.target.value)}
                  autoComplete="off"
                  data-testid="input-ai-model"
                />

                {/* Natural voice (TTS) for the coach phone call */}
                <label className="text-xs font-medium text-muted-foreground mt-3 block">Coach Voice</label>
                <select
                  value={ttsProvider}
                  onChange={e => setTtsProvider(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm w-full max-w-sm"
                  data-testid="select-tts-provider"
                >
                  <option value="browser">Browser voice (free, robotic)</option>
                  <option value="elevenlabs">ElevenLabs (most natural)</option>
                  <option value="openai">OpenAI (natural)</option>
                </select>
                {ttsProvider !== "browser" && (
                  <>
                    <label className="text-xs font-medium text-muted-foreground mt-2 block">{ttsProvider === "elevenlabs" ? "ElevenLabs" : "OpenAI"} API Key</label>
                    <Input
                      type="password"
                      placeholder={ttsProvider === "elevenlabs" ? "ElevenLabs API key" : "sk-..."}
                      value={ttsApiKey}
                      onChange={e => setTtsApiKey(e.target.value)}
                      autoComplete="off"
                      data-testid="input-tts-key"
                    />
                    <label className="text-xs font-medium text-muted-foreground mt-2 block">Voice <span className="font-normal">(optional)</span></label>
                    <Input
                      placeholder={ttsProvider === "elevenlabs" ? "Voice ID (default: Sarah)" : "alloy / nova / shimmer (default: nova)"}
                      value={ttsVoice}
                      onChange={e => setTtsVoice(e.target.value)}
                      autoComplete="off"
                      data-testid="input-tts-voice"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">{ttsProvider === "elevenlabs" ? "Get a key at elevenlabs.io. Paste a Voice ID from your ElevenLabs voice library to pick the voice." : "Uses your OpenAI key (gpt-4o-mini-tts). Voices: alloy, echo, fable, nova, onyx, shimmer."}</p>
                  </>
                )}
              </div>
            </div>

            {/* Unified recipient list — EOD + daily + weekly + monthly all send here */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Report Recipients</p>
              <p className="text-[11px] text-muted-foreground mb-2">These recipients receive <strong>all</strong> reports — EOD submissions plus daily, weekly, and monthly scheduled reports. Click <em>Save Email Settings</em> below after editing.</p>
              {/* Quick-add WCL managers */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {[
                  { name: "Chris Redoble", email: "chris.redoble@westcapitallending.com" },
                  { name: "Scott Petrie",  email: "scott.petrie@westcapitallending.com" },
                ].map(({ name, email }) => {
                  const already = managerEmails.includes(email);
                  return (
                    <button
                      key={email}
                      type="button"
                      disabled={already}
                      onClick={() => !already && setManagerEmails(prev => [...prev, email])}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors
                        ${already
                          ? "bg-muted text-muted-foreground border-border cursor-default opacity-60"
                          : "bg-primary/5 text-primary border-primary/30 hover:bg-primary/10 cursor-pointer"}`}
                    >
                      <span className="font-medium">{name}</span>
                      {already ? <span className="opacity-60">✓</span> : <span>+</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="manager@westcapital.com"
                  value={newManagerEmail}
                  onChange={e => setNewManagerEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addManagerEmail()}
                  className="flex-1"
                />
                <Button size="sm" variant="outline" onClick={addManagerEmail} type="button">Add</Button>
              </div>
              {managerEmails.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No recipients added yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {managerEmails.map(em => (
                    <Badge key={em} variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs">
                      {em}
                      <button
                        type="button"
                        onClick={() => removeManagerEmail(em)}
                        className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${em}`}
                      >×</button>
                    </Badge>
                  ))}
                </div>
              )}
              {/* Send to all managers */}
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t">
                <div>
                  <p className="text-sm font-medium">Send to all managers</p>
                  <p className="text-[11px] text-muted-foreground">When on, every scheduled report also goes to all users marked as managers — in addition to the recipients listed above. The recipients above always receive reports regardless of this setting.</p>
                </div>
                <Switch checked={sendToAllManagers} onCheckedChange={setSendToAllManagers} />
              </div>
            </div>

            {/* Approval recipient — one person for everyone */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Approval Emails Go To</p>
              <p className="text-[11px] text-muted-foreground mb-2">This person receives the approval email for <strong>everyone</strong> — both comp (reimbursement) requests and time-off requests — with one-click <strong>Approve</strong> / <strong>Deny</strong> buttons. They can still approve in-app too.</p>
              <select
                value={approvalRecipientId}
                onChange={e => setApprovalRecipientId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm w-full max-w-sm"
                data-testid="select-approval-recipient"
              >
                <option value="">— None (no approval emails sent) —</option>
                {managerOptions.map((u: any) => (
                  <option key={u.id} value={String(u.id)}>{u.name}{u.email ? " (" + u.email + ")" : ""}</option>
                ))}
              </select>
            </div>

            {/* Schedule toggles */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Schedule</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Daily Report</p>
                    <p className="text-xs text-muted-foreground">Sent every morning at the configured Pacific time (06:00–22:00) — covers the previous day</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {dailyEnabled && (
                      <Input
                        type="time"
                        min="06:00"
                        max="22:00"
                        value={dailyTime}
                        onChange={e => setDailyTime(e.target.value)}
                        className="w-28 text-xs h-8"
                      />
                    )}
                    <Switch checked={dailyEnabled} onCheckedChange={setDailyEnabled} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Weekly Report</p>
                    <p className="text-xs text-muted-foreground">Sent every Monday at the configured time (06:00–22:00)</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {weeklyEnabled && (
                      <Input
                        type="time"
                        min="06:00"
                        max="22:00"
                        value={weeklyTime}
                        onChange={e => setWeeklyTime(e.target.value)}
                        className="w-28 text-xs h-8"
                      />
                    )}
                    <Switch checked={weeklyEnabled} onCheckedChange={setWeeklyEnabled} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Monthly Report</p>
                    <p className="text-xs text-muted-foreground">Sent on the 1st of each month at the configured time (06:00–22:00) — covers the previous full calendar month</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {monthlyEnabled && (
                      <Input
                        type="time"
                        min="06:00"
                        max="22:00"
                        value={monthlyTime}
                        onChange={e => setMonthlyTime(e.target.value)}
                        className="w-28 text-xs h-8"
                      />
                    )}
                    <Switch checked={monthlyEnabled} onCheckedChange={setMonthlyEnabled} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Month-to-Date Report</p>
                    <p className="text-xs text-muted-foreground">Sent daily at the configured time — covers the 1st of this month through today</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {mtdEnabled && (
                      <Input
                        type="time"
                        min="06:00"
                        max="22:00"
                        value={mtdTime}
                        onChange={e => setMtdTime(e.target.value)}
                        className="w-28 text-xs h-8"
                      />
                    )}
                    <Switch checked={mtdEnabled} onCheckedChange={setMtdEnabled} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">All-Time Report</p>
                    <p className="text-xs text-muted-foreground">Sent on the 1st of each month at the configured time — covers all activity since inception</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {alltimeEnabled && (
                      <Input
                        type="time"
                        min="06:00"
                        max="22:00"
                        value={alltimeTime}
                        onChange={e => setAlltimeTime(e.target.value)}
                        className="w-28 text-xs h-8"
                      />
                    )}
                    <Switch checked={alltimeEnabled} onCheckedChange={setAlltimeEnabled} />
                  </div>
                </div>
              </div>
            </div>

            {/* What's in the email — per-report-type section toggles */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">What's in the Email</p>
              <p className="text-[11px] text-muted-foreground mb-3">Choose which sections appear in each scheduled report. Turning a section off removes it from that report's email.</p>
              <div className="space-y-4">
                {(["daily", "weekly", "monthly"] as const).map(rt => {
                  const SECTIONS: { key: string; label: string }[] = [
                    { key: "summary", label: "Team summary stat cards" },
                    { key: "outcomeBreakdown", label: "Team outcome breakdown" },
                    { key: "clrBreakdown", label: "CLR breakdown / daily activity" },
                    { key: "transferDetails", label: "Transfer details" },
                    { key: "activeLos", label: "Active LOs callout" },
                    { key: "eodNotes", label: "CLR EOD notes & activity log" },
                    { key: "callNotes", label: "Call notes by CLR" },
                  ];
                  const cfg = reportSections[rt] ?? {};
                  const setSec = (key: string, val: boolean) =>
                    setReportSections(prev => ({ ...prev, [rt]: { ...(prev[rt] ?? {}), [key]: val } }));
                  return (
                    <div key={rt} className="rounded-lg border p-3">
                      <p className="text-sm font-medium mb-2 capitalize">{rt} Report</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                        {SECTIONS.map(s => (
                          <label key={s.key} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">{s.label}</span>
                            <Switch checked={cfg[s.key] !== false} onCheckedChange={v => setSec(s.key, v)} />
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={handleTest} disabled={testLoading} className="gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                {testLoading ? "Testing…" : "Test Connection"}
              </Button>
              {([
                { type: "daily" as const, label: "Daily" },
                { type: "weekly" as const, label: "Weekly" },
                { type: "monthly" as const, label: "Monthly" },
                { type: "mtd" as const, label: "MTD" },
                { type: "alltime" as const, label: "All-Time" },
              ]).map(({ type, label }) => {
                const persistedCount: number = (() => {
                  try { return JSON.parse(emailSettings?.manager_emails ?? emailSettings?.managerEmails ?? "[]").length; }
                  catch { return 0; }
                })();
                if (type === "daily") {
                  return (
                    <div key={type} className="inline-flex items-center gap-1.5">
                      <select
                        value={dailySendDay}
                        onChange={e => setDailySendDay(e.target.value as "yesterday" | "today")}
                        disabled={sendLoading}
                        title="Choose which day the daily report covers"
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="yesterday">Yesterday</option>
                        <option value="today">Today</option>
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendNow(type, undefined, dailySendDay)}
                        disabled={sendLoading || persistedCount === 0}
                        title={persistedCount === 0 ? `Add and save recipients in Report Recipients` : `Sends the daily report for ${dailySendDay} to ${persistedCount} recipient${persistedCount === 1 ? "" : "s"}`}
                        className="gap-1.5"
                      >
                        {sendLoading ? "Sending…" : `Send ${label} Now (${persistedCount})`}
                      </Button>
                    </div>
                  );
                }
                if (type === "alltime") {
                  const selected = clrOptions.find((u: any) => String(u.id) === alltimeClrId);
                  return (
                    <div key={type} className="inline-flex items-center gap-1.5">
                      <select
                        value={alltimeClrId}
                        onChange={e => setAlltimeClrId(e.target.value)}
                        disabled={sendLoading}
                        title="Choose which CLR the All-Time report covers"
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="all">All CLRs</option>
                        {clrOptions.map((u: any) => (
                          <option key={u.id} value={String(u.id)}>{u.name}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendNow(type, alltimeClrId)}
                        disabled={sendLoading || persistedCount === 0}
                        title={persistedCount === 0 ? `Add and save recipients in Report Recipients` : `Sends ${selected ? selected.name + "'s" : "the full team's"} All-Time report to ${persistedCount} recipient${persistedCount === 1 ? "" : "s"}`}
                        className="gap-1.5"
                      >
                        {sendLoading ? "Sending…" : `Send ${label} Now (${persistedCount})`}
                      </Button>
                    </div>
                  );
                }
                return (
                  <Button
                    key={type}
                    size="sm"
                    variant="outline"
                    onClick={() => handleSendNow(type)}
                    disabled={sendLoading || persistedCount === 0}
                    title={persistedCount === 0 ? `Add and save recipients in Report Recipients` : `Sends to ${persistedCount} recipient${persistedCount === 1 ? "" : "s"}`}
                    className="gap-1.5"
                  >
                    {sendLoading ? "Sending…" : `Send ${label} Now (${persistedCount})`}
                  </Button>
                );
              })}
              <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} className="ml-auto gap-1.5">
                <Save className="w-3.5 h-3.5" />
                {saveMutation.isPending ? "Saving…" : "Save Email Settings"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Weekly Goals card (own-profile only) ──────────────────────────────────
function WeeklyGoalsCard() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({
    queryKey: ["/api/me"],
    queryFn: () => fetch("/api/me", { credentials: "include" }).then(r => r.json()),
  });

  const [calls, setCalls] = useState("");
  const [transfers, setTransfers] = useState("");
  const [appointments, setAppointments] = useState("");

  useEffect(() => {
    if (me) {
      setCalls(String(me.goalCallsWeekly ?? me.goal_calls_weekly ?? 0));
      setTransfers(String(me.goalTransfersWeekly ?? me.goal_transfers_weekly ?? 0));
      setAppointments(String(me.goalAppointmentsWeekly ?? me.goal_appointments_weekly ?? 0));
    }
  }, [me?.goalCallsWeekly, me?.goal_calls_weekly, me?.goalTransfersWeekly, me?.goal_transfers_weekly, me?.goalAppointmentsWeekly, me?.goal_appointments_weekly]);

  const saveMut = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/my-goals", {
        goalCallsWeekly: parseInt(calls) || 0,
        goalTransfersWeekly: parseInt(transfers) || 0,
        goalAppointmentsWeekly: parseInt(appointments) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-report"] });
      toast({ title: "Weekly goals saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-muted-foreground" />
          Weekly Goals
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Set personal weekly targets. Progress bars will appear on My Report and your dashboard. Enter 0 to disable a goal.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Weekly Calls</label>
            <Input type="number" min={0} value={calls} onChange={e => setCalls(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Weekly Transfers</label>
            <Input type="number" min={0} value={transfers} onChange={e => setTransfers(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Weekly Appointments</label>
            <Input type="number" min={0} value={appointments} onChange={e => setAppointments(e.target.value)} placeholder="0" />
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="gap-1.5"
        >
          <Save className="w-3.5 h-3.5" />
          {saveMut.isPending ? "Saving…" : "Save Goals"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Timezone Preference Card (per-user IANA timezone for all date/time display) ──
const TIMEZONE_GROUPS: Array<{ label: string; options: Array<{ value: string; label: string }> }> = [
  {
    label: "US (Quick Access)",
    options: [
      { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
      { value: "America/Denver", label: "Mountain Time (US & Canada)" },
      { value: "America/Phoenix", label: "Mountain Time (Arizona, no DST)" },
      { value: "America/Chicago", label: "Central Time (US & Canada)" },
      { value: "America/New_York", label: "Eastern Time (US & Canada)" },
      { value: "America/Anchorage", label: "Alaska Time" },
      { value: "Pacific/Honolulu", label: "Hawaii Time" },
    ],
  },
  {
    label: "Americas",
    options: [
      { value: "America/Toronto", label: "Toronto" },
      { value: "America/Mexico_City", label: "Mexico City" },
      { value: "America/Sao_Paulo", label: "São Paulo" },
      { value: "America/Buenos_Aires", label: "Buenos Aires" },
      { value: "America/Bogota", label: "Bogotá" },
    ],
  },
  {
    label: "Europe",
    options: [
      { value: "Europe/London", label: "London" },
      { value: "Europe/Dublin", label: "Dublin" },
      { value: "Europe/Paris", label: "Paris" },
      { value: "Europe/Berlin", label: "Berlin" },
      { value: "Europe/Madrid", label: "Madrid" },
      { value: "Europe/Rome", label: "Rome" },
      { value: "Europe/Amsterdam", label: "Amsterdam" },
      { value: "Europe/Stockholm", label: "Stockholm" },
      { value: "Europe/Moscow", label: "Moscow" },
    ],
  },
  {
    label: "Asia / Pacific",
    options: [
      { value: "Asia/Dubai", label: "Dubai" },
      { value: "Asia/Kolkata", label: "India (Kolkata)" },
      { value: "Asia/Bangkok", label: "Bangkok" },
      { value: "Asia/Singapore", label: "Singapore" },
      { value: "Asia/Hong_Kong", label: "Hong Kong" },
      { value: "Asia/Shanghai", label: "Shanghai" },
      { value: "Asia/Tokyo", label: "Tokyo" },
      { value: "Asia/Seoul", label: "Seoul" },
      { value: "Australia/Sydney", label: "Sydney" },
      { value: "Australia/Melbourne", label: "Melbourne" },
      { value: "Pacific/Auckland", label: "Auckland" },
    ],
  },
  {
    label: "Africa",
    options: [
      { value: "Africa/Cairo", label: "Cairo" },
      { value: "Africa/Johannesburg", label: "Johannesburg" },
      { value: "Africa/Nairobi", label: "Nairobi" },
      { value: "Africa/Lagos", label: "Lagos" },
    ],
  },
  {
    label: "UTC",
    options: [{ value: "UTC", label: "Coordinated Universal Time" }],
  },
];

function utcOffsetLabel(tz: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
    const tzPart = parts.find(p => p.type === "timeZoneName");
    if (tzPart?.value) return tzPart.value.replace(/^GMT/, "UTC");
  } catch {}
  return "";
}

function detectBrowserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"; }
  catch { return "America/Los_Angeles"; }
}

function TimezonePreferenceCard() {
  const { toast } = useToast();
  const { user: authUser, refetchUser } = useAuth();
  const saved = authUser?.timezone ?? "America/Los_Angeles";
  const [selected, setSelected] = useState<string>(saved);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const browserTz = detectBrowserTimezone();

  useEffect(() => { setSelected(saved); }, [saved]);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const isDirty = selected !== saved;
  const offsetForSelected = utcOffsetLabel(selected, now);
  const preview = (() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: selected,
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      }).format(now);
    } catch { return ""; }
  })();

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Failed to save timezone", description: data?.error ?? `Status ${res.status}`, variant: "destructive" });
      } else {
        toast({ title: "Timezone saved", description: `All dates and times will now display in ${selected}.` });
        try { localStorage.setItem("clr_script_timezone", selected); } catch {}
        await refetchUser();
      }
    } catch {
      toast({ title: "Failed to save timezone", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          Timezone
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">Controls how dates and times are displayed across the app — outcomes, appointments, followups, and the call script clock.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Your timezone</label>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            data-testid="settings-timezone-select"
          >
            {TIMEZONE_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map(opt => {
                  const off = utcOffsetLabel(opt.value, now);
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}{off ? ` — ${off}` : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="rounded-md border px-3 py-2 text-xs space-y-1 bg-muted/40">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current time in your timezone</span>
            <span className="font-medium tabular-nums">{preview || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">UTC offset</span>
            <span className="font-mono">{offsetForSelected || "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Detected from your browser</span>
            <span className="font-mono">{browserTz}</span>
          </div>
          {browserTz && browserTz !== selected && (
            <button
              type="button"
              onClick={() => setSelected(browserTz)}
              className="text-[11px] underline text-primary"
            >
              Use browser timezone ({browserTz})
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving || !isDirty} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save Timezone"}
          </Button>
          {isDirty && <span className="text-[11px] text-amber-700">Unsaved change</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Notifications Card (per-user email reminders + admin org toggle) ────────
function NotificationsCard() {
  const { toast } = useToast();
  const { user: authUser, refetchUser } = useAuth();
  const isAdmin = authUser?.role === "admin";

  const [userEnabled, setUserEnabled] = useState<boolean>(true);
  const [smsEnabled, setSmsEnabled] = useState<boolean>(false);
  const [smsConfigured, setSmsConfigured] = useState<boolean>(false);
  const [orgEnabled, setOrgEnabled] = useState<boolean>(true);
  const [runningNow, setRunningNow] = useState(false);
  const [chatOn, setChatOn] = useState<boolean>(true);
  const [forumOn, setForumOn] = useState<boolean>(true);

  useEffect(() => {
    if (authUser) {
      setUserEnabled(authUser.reminderEmailEnabled ?? true);
      setSmsEnabled(!!authUser.smsRemindersEnabled);
      setChatOn(!authUser.muteChatNotifications);
      setForumOn(!authUser.muteForumNotifications);
    }
  }, [authUser?.reminderEmailEnabled, authUser?.smsRemindersEnabled, authUser?.muteChatNotifications, authUser?.muteForumNotifications]);

  useEffect(() => {
    fetch("/api/settings/reminders", { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (typeof d?.remindersEnabled === "boolean") setOrgEnabled(d.remindersEnabled); })
      .catch(() => {});
    fetch("/api/sms/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setSmsConfigured(!!d?.configured))
      .catch(() => {});
  }, []);

  async function saveSms(enabled: boolean) {
    setSmsEnabled(enabled);
    try {
      const r = await fetch("/api/users/me/sms-reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: enabled ? "SMS reminders on" : "SMS reminders off" });
      await refetchUser();
    } catch (e: any) {
      setSmsEnabled(!enabled);
      toast({ title: "Failed to update", description: e?.message, variant: "destructive" });
    }
  }

  async function saveUser(enabled: boolean) {
    setUserEnabled(enabled);
    try {
      const r = await fetch("/api/users/me/reminder-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: enabled ? "Email reminders on" : "Email reminders off" });
      await refetchUser();
    } catch (e: any) {
      setUserEnabled(!enabled);
      toast({ title: "Failed to update", description: e?.message, variant: "destructive" });
    }
  }

  async function saveMute(kind: "chat" | "forum", on: boolean) {
    const setter = kind === "chat" ? setChatOn : setForumOn;
    setter(on);
    try {
      const r = await fetch("/api/users/me/mute-" + kind, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ muted: !on }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: (kind === "chat" ? "Chat" : "Forum") + (on ? " notifications on" : " notifications muted") });
      await refetchUser();
    } catch (e: any) {
      setter(!on);
      toast({ title: "Failed to update", description: e?.message, variant: "destructive" });
    }
  }

  async function saveOrg(enabled: boolean) {
    setOrgEnabled(enabled);
    try {
      const r = await fetch("/api/settings/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ remindersEnabled: enabled }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      toast({ title: enabled ? "Org-wide reminders enabled" : "Org-wide reminders disabled" });
    } catch (e: any) {
      setOrgEnabled(!enabled);
      toast({ title: "Failed to update", description: e?.message, variant: "destructive" });
    }
  }

  async function runNow() {
    setRunningNow(true);
    try {
      const r = await fetch("/api/settings/reminders/run-now", { method: "POST", credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed");
      toast({ title: "Reminders dispatched", description: `sent=${d.sent} skipped=${d.skipped} errors=${d.errors}` });
    } catch (e: any) {
      toast({ title: "Run failed", description: e?.message, variant: "destructive" });
    } finally {
      setRunningNow(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-muted-foreground" />
          Notifications
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Get an email before your appointments and callbacks.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Email Reminders</p>
            <p className="text-xs text-muted-foreground">
              We'll email you up to 24 hours before each upcoming appointment or callback.
            </p>
          </div>
          <Switch checked={userEnabled} onCheckedChange={saveUser} data-testid="toggle-reminder-email" />
        </div>

        {smsConfigured && (
          <>
            <Separator />
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">SMS Reminders</p>
                <p className="text-xs text-muted-foreground">
                  Get a text message reminder 24 hours before appointments and callbacks.
                  Requires your phone number to be set in your profile.
                </p>
              </div>
              <Switch checked={smsEnabled} onCheckedChange={saveSms} data-testid="toggle-reminder-sms" />
            </div>
          </>
        )}

        <Separator />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Chat Notifications</p>
            <p className="text-xs text-muted-foreground">Alerts for new team chat messages — in-app, push, and email. Turn off to mute all of them. (You can also mute this right from the Chat page.)</p>
          </div>
          <Switch checked={chatOn} onCheckedChange={(v) => saveMute("chat", v)} data-testid="toggle-chat-notifications" />
        </div>

        <Separator />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Forum Notifications</p>
            <p className="text-xs text-muted-foreground">Alerts for new forum questions and answers. Turn off to mute forum notifications.</p>
          </div>
          <Switch checked={forumOn} onCheckedChange={(v) => saveMute("forum", v)} data-testid="toggle-forum-notifications" />
        </div>

        {isAdmin && (
          <>
            <Separator />
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Org-Wide Reminders</p>
                <p className="text-xs text-muted-foreground">
                  Master switch for the whole organization. When off, no reminder emails are sent to anyone.
                </p>
              </div>
              <Switch checked={orgEnabled} onCheckedChange={saveOrg} data-testid="toggle-reminder-org" />
            </div>
            <div>
              <Button size="sm" variant="outline" onClick={runNow} disabled={runningNow} className="gap-1.5">
                <Send className="w-3.5 h-3.5" />
                {runningNow ? "Running…" : "Run reminder check now"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Script Defaults Card (per-user placeholder overrides) ───────────────────
function ExportDataCard() {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const [outcomesFrom, setOutcomesFrom] = useState(thirtyDaysAgo);
  const [outcomesTo, setOutcomesTo] = useState(today);
  const [logsFrom, setLogsFrom] = useState(thirtyDaysAgo);
  const [logsTo, setLogsTo] = useState(today);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function downloadCsv(url: string, filename: string, key: string) {
    setDownloading(key);
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      toast({ title: "Download started", description: filename });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4" /> Call Outcomes
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            All logged call outcomes (transfers, follow-ups, etc.) with CLR and LO names.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={outcomesFrom} onChange={(e) => setOutcomesFrom(e.target.value)} data-testid="input-outcomes-from" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={outcomesTo} onChange={(e) => setOutcomesTo(e.target.value)} data-testid="input-outcomes-to" />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            size="sm"
            onClick={() => downloadCsv(`/api/export/outcomes?from=${outcomesFrom}&to=${outcomesTo}`, `outcomes_${outcomesFrom}_to_${outcomesTo}.csv`, "outcomes")}
            disabled={downloading === "outcomes"}
            data-testid="button-export-outcomes"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloading === "outcomes" ? "Downloading…" : "Download CSV"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" /> Users
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            All users in your organization (name, email, role, status).
          </p>
        </CardHeader>
        <CardFooter>
          <Button
            size="sm"
            onClick={() => downloadCsv(`/api/export/users`, `users_${today}.csv`, "users")}
            disabled={downloading === "users"}
            data-testid="button-export-users"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloading === "users" ? "Downloading…" : "Download CSV"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Target className="w-4 h-4" /> Loan Officers
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            All LOs with NMLS IDs, contact info, licensed states, and status.
          </p>
        </CardHeader>
        <CardFooter>
          <Button
            size="sm"
            onClick={() => downloadCsv(`/api/export/loan-officers`, `loan_officers_${today}.csv`, "los")}
            disabled={downloading === "los"}
            data-testid="button-export-los"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloading === "los" ? "Downloading…" : "Download CSV"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <PhoneCall className="w-4 h-4" /> Daily Call Logs
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Daily call totals per CLR within the date range.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={logsFrom} onChange={(e) => setLogsFrom(e.target.value)} data-testid="input-logs-from" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={logsTo} onChange={(e) => setLogsTo(e.target.value)} data-testid="input-logs-to" />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            size="sm"
            onClick={() => downloadCsv(`/api/export/daily-logs?from=${logsFrom}&to=${logsTo}`, `daily_call_logs_${logsFrom}_to_${logsTo}.csv`, "logs")}
            disabled={downloading === "logs"}
            data-testid="button-export-logs"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {downloading === "logs" ? "Downloading…" : "Download CSV"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function ScriptDefaultsCard() {
  const { toast } = useToast();
  const { user, refetchUser } = useAuth();
  const [company, setCompany] = useState("");
  const [nameOverride, setNameOverride] = useState("");
  const [loOverride, setLoOverride] = useState("");

  useEffect(() => {
    const u = user as any;
    if (u) {
      setCompany(u.scriptCompanyName ?? "");
      setNameOverride(u.scriptNameOverride ?? "");
      setLoOverride(u.scriptLoOverride ?? "");
    }
  }, [(user as any)?.scriptCompanyName, (user as any)?.scriptNameOverride, (user as any)?.scriptLoOverride]);

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/users/${(user as any)?.id}`, {
      scriptCompanyName: company.trim() || null,
      scriptNameOverride: nameOverride.trim() || null,
      scriptLoOverride: loOverride.trim() || null,
    }),
    onSuccess: async () => {
      await refetchUser();
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Script defaults saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <PhoneCall className="w-4 h-4 text-muted-foreground" />
          Script Defaults
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          These values fill in the <span className="text-teal-500 font-medium">[placeholders]</span> in your call script automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Company Name</label>
          <Input
            value={company}
            onChange={e => setCompany(e.target.value)}
            placeholder="West Capital Lending"
            data-testid="settings-script-company"
          />
          <p className="text-[11px] text-muted-foreground">Used for <code>[company]</code>. Blank = "West Capital Lending".</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Display Name Override</label>
          <Input
            value={nameOverride}
            onChange={e => setNameOverride(e.target.value)}
            placeholder="Leave blank to use your account name"
            data-testid="settings-script-name"
          />
          <p className="text-[11px] text-muted-foreground">Used for <code>[your name]</code>. Blank = your account name.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">LO Name Override</label>
          <Input
            value={loOverride}
            onChange={e => setLoOverride(e.target.value)}
            placeholder="Leave blank to use today's assigned LO"
            data-testid="settings-script-lo"
          />
          <p className="text-[11px] text-muted-foreground">Used for <code>[lo name]</code> if no LO is assigned today.</p>
        </div>
        <Button
          size="sm"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="gap-1.5"
        >
          <Save className="w-3.5 h-3.5" />
          {saveMut.isPending ? "Saving…" : "Save Script Defaults"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Manager toggle button (admin-only, shown inline on each user row) ──────
function ManagerToggleButton({ user }: { user: any }) {
  const { toast } = useToast();
  const isManager = !!(user.isManager ?? user.is_manager);
  const mut = useMutation({
    mutationFn: (next: boolean) =>
      apiRequest("PATCH", `/api/users/${user.id}/manager`, { is_manager: next }),
    onSuccess: async (updated: any, next) => {
      queryClient.setQueryData<any[]>(["/api/users"], (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map(u =>
          u.id === user.id
            ? { ...u, ...(updated ?? {}), isManager: next }
            : u,
        );
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/users"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/report-schedules"] }),
      ]);
      toast({
        title: next ? `${user.name} is now a manager` : `${user.name} is no longer a manager`,
        description: next
          ? "Added to daily, weekly, and monthly report recipients."
          : "Removed from scheduled report recipients.",
      });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to update manager flag", description: err.message, variant: "destructive" }),
  });
  return (
    <Button
      size="sm"
      variant={isManager ? "default" : "outline"}
      className={`text-xs h-7 px-2 ${isManager ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500" : ""}`}
      onClick={() => mut.mutate(!isManager)}
      disabled={mut.isPending}
      data-testid={`button-manager-${user.id}`}
    >
      {isManager ? "★ Manager" : "Make Manager"}
    </Button>
  );
}

// ── Per-CLR Weekly Goals button + modal (admin only) ───────────────────────
type GoalModel = 'manual' | 'adjustable' | 'staircase';

const GOAL_MODEL_INFO: Record<GoalModel, { label: string; icon: string; desc: string; color: string }> = {
  manual:     { label: 'Manual',     icon: '✏️', desc: 'Goals are set by an admin and stay fixed until changed manually.', color: 'border-slate-400 bg-slate-50 dark:bg-slate-900' },
  adjustable: { label: 'Adjustable', icon: '📊', desc: 'Goals auto-update each Monday to a set % above last week’s actual performance.', color: 'border-blue-400 bg-blue-50 dark:bg-blue-950' },
  staircase:  { label: 'Staircase',  icon: '🏆', desc: 'Goals step up by a set % each time they’re hit — they never decrease.', color: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950' },
};

function SetGoalsButton({ user }: { user: any }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState("0");
  const [transfers, setTransfers] = useState("0");
  const [appointments, setAppointments] = useState("0");
  const [goalModel, setGoalModel] = useState<GoalModel>('manual');
  const [adjustmentPct, setAdjustmentPct] = useState("5");

  const { data: goalData, isLoading } = useQuery<any>({
    queryKey: ["/api/goals", user.id],
    queryFn: () => fetch(`/api/goals/${user.id}`, { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  useEffect(() => {
    if (goalData?.goals) {
      setCalls(String(goalData.goals.calls ?? 0));
      setTransfers(String(goalData.goals.transfers ?? 0));
      setAppointments(String(goalData.goals.appointments ?? 0));
      const m = goalData.goalModel ?? 'manual';
      setGoalModel(['manual','adjustable','staircase'].includes(m) ? m : 'manual');
      setAdjustmentPct(String(goalData.adjustmentPct ?? 5));
    }
  }, [goalData?.goals?.calls, goalData?.goals?.transfers, goalData?.goals?.appointments, goalData?.goalModel, goalData?.adjustmentPct]);

  const saveMut = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/goals/${user.id}`, {
        callsGoal: parseInt(calls) || 0,
        transfersGoal: parseInt(transfers) || 0,
        appointmentsGoal: parseInt(appointments) || 0,
        goalModel,
        adjustmentPct: parseFloat(adjustmentPct) || 5,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/goals", user.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/my-report", "week"] });
      toast({ title: `Goals saved for ${user.name}` });
      setOpen(false);
    },
    onError: (err: Error) =>
      toast({ title: "Failed to save goals", description: err.message, variant: "destructive" }),
  });

  const isAutoModel = goalModel === 'adjustable' || goalModel === 'staircase';

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="text-xs h-7 px-2"
        onClick={() => setOpen(true)}
        data-testid={`button-set-goals-${user.id}`}
      >
        <Target className="w-3 h-3 mr-1" /> Set Goals
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Weekly Goals — {user.name}</DialogTitle>
            <DialogDescription>
              {goalData?.source === "individual"
                ? "Individual goals configured for this CLR."
                : "No individual goals set — showing defaults."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* ── Goal Model selector ── */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Goal Model</Label>
              <div className="grid grid-cols-1 gap-2">
                {(Object.keys(GOAL_MODEL_INFO) as GoalModel[]).map(m => {
                  const info = GOAL_MODEL_INFO[m];
                  const selected = goalModel === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setGoalModel(m)}
                      className={`text-left rounded-lg border-2 px-3 py-2.5 transition-all ${
                        selected
                          ? info.color + ' border-opacity-100 ring-2 ring-primary/20'
                          : 'border-border bg-background hover:border-muted-foreground/40'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{info.icon}</span>
                        <span className={`text-sm font-semibold ${selected ? '' : 'text-foreground'}`}>{info.label}</span>
                        {selected && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-primary">Selected</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 pl-6">{info.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Adjustment % (only for adjustable/staircase) ── */}
            {isAutoModel && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <Label className="text-sm font-medium">
                  {goalModel === 'staircase' ? 'Step-up %' : 'Adjustment %'}
                  <span className="ml-1 text-muted-foreground font-normal text-xs">
                    {goalModel === 'staircase' ? '(increase when goal is hit)' : '(increase above last week’s actual)'}
                  </span>
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number" min={1} max={100} step={0.5}
                    className="w-24 h-8 text-sm"
                    value={adjustmentPct}
                    onChange={e => setAdjustmentPct(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">% per week</span>
                </div>
                {goalModel === 'adjustable' && (
                  <p className="text-xs text-muted-foreground">
                    Example: if last week’s calls = 200 and % = 5, next week’s goal = 210.
                  </p>
                )}
                {goalModel === 'staircase' && (
                  <p className="text-xs text-muted-foreground">
                    Goals only increase — they step up the moment this CLR hits them during the week.
                  </p>
                )}
              </div>
            )}

            {/* ── Goal numbers ── */}
            <div className="border-t pt-3 space-y-3">
              <Label className="text-sm font-semibold">
                {goalModel === 'manual' ? 'Weekly Goal Targets' : 'Starting Targets'}
              </Label>
              {goalModel !== 'manual' && (
                <p className="text-xs text-muted-foreground -mt-1">
                  These are the initial goals. The model will adjust them automatically going forward.
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`calls-${user.id}`} className="text-xs">Calls</Label>
                  <Input id={`calls-${user.id}`} type="number" min={0} value={calls} onChange={e => setCalls(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`transfers-${user.id}`} className="text-xs">Transfers</Label>
                  <Input id={`transfers-${user.id}`} type="number" min={0} value={transfers} onChange={e => setTransfers(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`appointments-${user.id}`} className="text-xs">Appointments</Label>
                  <Input id={`appointments-${user.id}`} type="number" min={0} value={appointments} onChange={e => setAppointments(e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── Goal-hit notifications callout ── */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2.5">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <strong>🔔 Goal notifications are on:</strong> when a goal is hit, everyone in your org gets a push notification instantly.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saveMut.isPending}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || isLoading}>
              {saveMut.isPending ? "Saving…" : "Save Goals"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Team Goals Card (managers/admins set per-CLR goals from Settings) ───────
function TeamGoalsCard({ users }: { users: any[] }) {
  const clrs = (users ?? []).filter((u: any) => u.isActive && (u.role === "assistant" || u.role === "admin"));
  const { data: allGoals = [] } = useQuery<any[]>({
    queryKey: ["/api/goals"],
    queryFn: () => fetch("/api/goals", { credentials: "include" }).then(r => (r.ok ? r.json() : [])),
  });
  const goalsByUser = new Map<number, any>((allGoals ?? []).map((g: any) => [g.userId, g]));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-muted-foreground" />
          Team Goals
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Set weekly goals for each CLR. These override the CLR's own targets and drive their dashboard progress bars.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {clrs.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 py-6 text-center">No active CLRs.</p>
        ) : (
          clrs.map((u: any) => {
            const g = goalsByUser.get(u.id);
            return (
              <div key={u.id} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0" data-testid={`team-goal-row-${u.id}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {g
                      ? `${g.callsGoal ?? 0} calls · ${g.transfersGoal ?? 0} transfers · ${g.appointmentsGoal ?? 0} appts / wk`
                      : "No admin-set goal — using their personal targets"}
                  </p>
                </div>
                <SetGoalsButton user={u} />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ── Profile Goals Card (own-profile, inline, with model selector) ──────────
function ProfileGoalsCard({ authUser }: { authUser: any }) {
  const { toast } = useToast();
  const userId = authUser?.id;
  const isAdmin = authUser?.role === "admin";
  const callsRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const [calls, setCalls] = useState("0");
  const [transfers, setTransfers] = useState("0");
  const [appointments, setAppointments] = useState("0");
  const [goalModel, setGoalModel] = useState<GoalModel>('manual');
  const [adjustmentPct, setAdjustmentPct] = useState("5");
  const [bannerDismissed, setBannerDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('goals.setup.dismissed') === '1'
  );

  const { data: goalData } = useQuery<any>({
    queryKey: ["/api/goals", userId],
    queryFn: () => fetch(`/api/goals/${userId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!userId,
  });

  useEffect(() => {
    if (goalData?.goals) {
      setCalls(String(goalData.goals.calls ?? 0));
      setTransfers(String(goalData.goals.transfers ?? 0));
      setAppointments(String(goalData.goals.appointments ?? 0));
      const m = goalData.goalModel ?? 'manual';
      setGoalModel(['manual','adjustable','staircase'].includes(m) ? m : 'manual');
      setAdjustmentPct(String(goalData.adjustmentPct ?? 5));
    }
  }, [goalData?.goals?.calls, goalData?.goals?.transfers, goalData?.goals?.appointments, goalData?.goalModel, goalData?.adjustmentPct]);

  const saveMut = useMutation({
    mutationFn: () => {
      if (isAdmin) {
        return apiRequest("PATCH", `/api/goals/${userId}`, {
          callsGoal: parseInt(calls) || 0,
          transfersGoal: parseInt(transfers) || 0,
          appointmentsGoal: parseInt(appointments) || 0,
          goalModel,
          adjustmentPct: parseFloat(adjustmentPct) || 5,
        });
      }
      return apiRequest("PUT", "/api/my-goals", {
        goalCallsWeekly: parseInt(calls) || 0,
        goalTransfersWeekly: parseInt(transfers) || 0,
        goalAppointmentsWeekly: parseInt(appointments) || 0,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/goals", userId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/my-report"] });
      toast({ title: "Weekly goals saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e?.message, variant: "destructive" }),
  });

  const isAutoModel = goalModel === 'adjustable' || goalModel === 'staircase';
  const allZero = (parseInt(calls) || 0) === 0 && (parseInt(transfers) || 0) === 0 && (parseInt(appointments) || 0) === 0;
  const showSetupBanner = allZero && !bannerDismissed;

  const dismissBanner = () => {
    localStorage.setItem('goals.setup.dismissed', '1');
    setBannerDismissed(true);
  };

  const scrollToGoals = () => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => callsRef.current?.focus(), 400);
  };

  return (
    <>
      {showSetupBanner && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 flex items-start gap-3">
          <span className="text-2xl leading-none">🎯</span>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Set up your weekly goals</p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              You haven't configured your weekly call targets yet. Scroll down to set your goals so your progress bars and reports show meaningful data.
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={scrollToGoals} className="h-7 text-xs">
                Set Goals Now →
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissBanner} className="h-7 text-xs">
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card ref={cardRef}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            Weekly Goals
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Set personal weekly targets. Progress bars will appear on My Report and your dashboard. Enter 0 to disable a goal.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Goal Model</Label>
              <div className="grid grid-cols-1 gap-2">
                {(Object.keys(GOAL_MODEL_INFO) as GoalModel[]).map(m => {
                  const info = GOAL_MODEL_INFO[m];
                  const selected = goalModel === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setGoalModel(m)}
                      className={`text-left rounded-lg border-2 px-3 py-2.5 transition-all ${
                        selected
                          ? info.color + ' border-opacity-100 ring-2 ring-primary/20'
                          : 'border-border bg-background hover:border-muted-foreground/40'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{info.icon}</span>
                        <span className={`text-sm font-semibold ${selected ? '' : 'text-foreground'}`}>{info.label}</span>
                        {selected && <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-primary">Selected</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 pl-6">{info.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isAdmin && isAutoModel && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <Label className="text-sm font-medium">
                {goalModel === 'staircase' ? 'Step-up %' : 'Adjustment %'}
                <span className="ml-1 text-muted-foreground font-normal text-xs">
                  {goalModel === 'staircase' ? '(increase when goal is hit)' : '(increase above last week’s actual)'}
                </span>
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number" min={1} max={100} step={0.5}
                  className="w-24 h-8 text-sm"
                  value={adjustmentPct}
                  onChange={e => setAdjustmentPct(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">% per week</span>
              </div>
              {goalModel === 'adjustable' && (
                <p className="text-xs text-muted-foreground">
                  Example: if last week’s calls = 200 and % = 5, next week’s goal = 210.
                </p>
              )}
              {goalModel === 'staircase' && (
                <p className="text-xs text-muted-foreground">
                  Goals only increase — they step up the moment you hit them during the week.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Weekly Calls</label>
              <Input ref={callsRef} type="number" min={0} value={calls} onChange={e => setCalls(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Weekly Transfers</label>
              <Input type="number" min={0} value={transfers} onChange={e => setTransfers(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Weekly Appointments</label>
              <Input type="number" min={0} value={appointments} onChange={e => setAppointments(e.target.value)} placeholder="0" />
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saveMut.isPending ? "Saving…" : "Save Goals"}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

// ── Resend Intro Emails component ───────────────────────────────────────────
function ResendIntroEmails({ users }: { users: any[] }) {
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [sentIds, setSentIds] = useState<Set<number>>(new Set());

  const resendMut = useMutation({
    mutationFn: async (userId: number) => {
      setPendingId(userId);
      const res = await fetch(`/api/users/${userId}/resend-welcome`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      return data;
    },
    onSuccess: (_data, userId) => {
      setPendingId(null);
      setSentIds(prev => new Set([...prev, userId]));
      toast({ title: "Intro email sent", description: "A fresh login email with a new temp password was sent." });
    },
    onError: (e: any, userId) => {
      setPendingId(null);
      toast({ title: "Failed to send email", description: e?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const activeUsers = users.filter(u => u.isActive);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Send className="w-5 h-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Resend Intro Emails</h2>
          <p className="text-sm text-muted-foreground">Send a fresh welcome email with a new temporary password to any team member.</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {activeUsers.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No active users.</div>
          ) : (
            activeUsers.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {u.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={sentIds.has(u.id) ? "outline" : "default"}
                  className="gap-1.5 h-8 text-xs"
                  disabled={pendingId === u.id}
                  onClick={() => resendMut.mutate(u.id)}
                >
                  {pendingId === u.id ? (
                    <><RefreshCw className="w-3 h-3 animate-spin" /> Sending…</>
                  ) : sentIds.has(u.id) ? (
                    <><Send className="w-3 h-3" /> Sent ✓</>
                  ) : (
                    <><Send className="w-3 h-3" /> Send Email</>
                  )}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const { data: settings, isLoading } = useQuery<any>({ queryKey: ["/api/settings/algorithm"] });

  const [weights, setWeights] = useState<Record<WeightKey, number> | null>(null);
  const [maxLOs, setMaxLOs] = useState<number | null>(null);
  const [transferPreference, setTransferPreference] = useState<"fewer" | "more" | "none" | null>(null);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const currentWeights = weights ?? (settings ? {
    weightDaysSinceWorked: settings.weightDaysSinceWorked,
    weightFrequency: settings.weightFrequency,
    weightAvailability: settings.weightAvailability,
    weightBoost: settings.weightBoost,
    weightPriorityTier: settings.weightPriorityTier,
    weightRecentTransfers: settings.weightRecentTransfers ?? 0.10,
  } : {
    weightDaysSinceWorked: 0.30,
    weightFrequency: 0.25,
    weightAvailability: 0.20,
    weightBoost: 0.10,
    weightPriorityTier: 0.05,
    weightRecentTransfers: 0.10,
  });

  const currentMax = maxLOs ?? settings?.maxLosPerAssistant ?? 5;
  const currentTransferPreference: "fewer" | "more" | "none" =
    transferPreference ?? (settings?.transferPreference === "more" || settings?.transferPreference === "none" ? settings.transferPreference : "fewer");
  const totalWeight = Object.values(currentWeights).reduce((a, b) => a + b, 0);
  const isWeightValid = Math.abs(totalWeight - 1.0) < 0.01;

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/settings/algorithm", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/algorithm"] });
      setWeights(null);
      setMaxLOs(null);
      setTransferPreference(null);
      toast({ title: "Settings saved" });
    },
    onError: () => toast({ title: "Error saving settings", variant: "destructive" }),
  });

  const handleSave = () => {
    if (!isWeightValid) {
      toast({ title: "Weights must total 100%", description: `Currently: ${(totalWeight * 100).toFixed(0)}%`, variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      ...currentWeights,
      maxLosPerAssistant: currentMax,
      transferPreference: currentTransferPreference,
    });
  };

  const handleReset = () => {
    setWeights({
      weightDaysSinceWorked: DEFAULT_WEIGHTS.weightDaysSinceWorked,
      weightFrequency: DEFAULT_WEIGHTS.weightFrequency,
      weightAvailability: DEFAULT_WEIGHTS.weightAvailability,
      weightBoost: DEFAULT_WEIGHTS.weightBoost,
      weightPriorityTier: DEFAULT_WEIGHTS.weightPriorityTier,
      weightRecentTransfers: DEFAULT_WEIGHTS.weightRecentTransfers,
    });
    setMaxLOs(DEFAULT_WEIGHTS.maxLosPerAssistant);
  };

  const setWeight = (key: WeightKey, value: number) => {
    setWeights(prev => ({ ...(prev ?? currentWeights), [key]: value }));
  };

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const isAdmin = authUser?.role === "admin";
  // Managers (is_manager) may also access the Reports tab to configure
  // report cadence, recipients, and email section visibility.
  const isManager = !!((authUser as any)?.isManager ?? (authUser as any)?.is_manager);
  const canReports = isAdmin || isManager;

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "profile";
    const saved = localStorage.getItem("settings.activeTab");
    const allowed = ["profile", "reports", "team", "algorithm", "export", "app", "audit"];
    if (saved && allowed.includes(saved)) {
      if ((saved === "team" || saved === "algorithm" || saved === "export" || saved === "audit") && authUser && authUser.role !== "admin") {
        return "profile";
      }
      if (saved === "reports" && authUser && authUser.role !== "admin" && !((authUser as any).isManager ?? (authUser as any).is_manager)) {
        return "profile";
      }
      return saved;
    }
    return "profile";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("settings.activeTab", activeTab);
    }
  }, [activeTab]);

  // If non-admin somehow lands on an admin tab (e.g. role changed), fall back.
  useEffect(() => {
    if (!isAdmin && (activeTab === "team" || activeTab === "algorithm" || activeTab === "export" || activeTab === "audit")) {
      setActiveTab("profile");
    }
    if (activeTab === "reports" && !canReports) {
      setActiveTab("profile");
    }
  }, [isAdmin, canReports, activeTab]);

  useEffect(() => {
    document.title = "Settings · WCLCC";
  }, []);

  const algorithmTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Ranking Algorithm Weights</CardTitle>
          <div className="flex items-start gap-2 mt-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
            <span>
              Weights determine how the daily assignment algorithm ranks loan officers. Higher weight = stronger influence on ranking.
              All weights must sum to 100%.
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)
          ) : (
            WEIGHT_FIELDS.map(({ key, label, description }) => (
              <WeightSliderRow
                key={key}
                label={label}
                description={description}
                value={currentWeights[key]}
                onChange={v => setWeight(key, v)}
              />
            ))
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between border-t pt-4">
          <div className="flex items-center gap-2">
            <Badge
              variant={isWeightValid ? "outline" : "destructive"}
              className="text-xs"
            >
              Total: {(totalWeight * 100).toFixed(0)}%
              {!isWeightValid && " ⚠ must = 100%"}
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs h-7 gap-1.5 text-muted-foreground">
              <RotateCcw className="w-3 h-3" />Reset
            </Button>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending || !isWeightValid}
            data-testid="button-save-weights"
            className="gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {updateMutation.isPending ? "Saving…" : "Save Weights"}
          </Button>
        </CardFooter>
      </Card>

      {/* Transfer Preference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Transfer Preference</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Controls how an LO's recent transfer count (last 90 days) affects their assignment priority.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Transfer preference">
            {([
              { value: "fewer", label: "Favor fewer transfers", desc: "LOs with fewer recent transfers get priority." },
              { value: "more", label: "Favor more transfers", desc: "LOs with more recent transfers get priority." },
              { value: "none", label: "No preference", desc: "Transfer count has no effect on scoring." },
            ] as const).map(opt => {
              const selected = currentTransferPreference === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTransferPreference(opt.value)}
                  data-testid={`button-transfer-pref-${opt.value}`}
                  className={`flex flex-col gap-1 p-3 rounded-lg border-2 text-left transition-all ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {selected && <Badge className="text-[10px] px-1.5 py-0 bg-primary text-white ml-auto">Active</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Applied with the <span className="font-medium">90-Day Transfer Volume</span> weight above. Click <span className="font-medium">Save Weights</span> to apply.
          </p>
        </CardContent>
      </Card>

      {/* Score Preview */}
      <ScorePreview weights={currentWeights} transferPreference={currentTransferPreference} />

      {/* Distribution Settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Distribution Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Max LOs per Assistant per Day</p>
              <p className="text-xs text-muted-foreground">Maximum number of loan officers assigned to each CLR daily</p>
            </div>
            <Input
              type="number"
              min={1}
              max={20}
              value={currentMax}
              onChange={e => setMaxLOs(Number(e.target.value))}
              className="w-20 text-center"
              data-testid="input-max-los"
            />
          </div>

          {/* Algorithm Mode */}
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-sm font-semibold">Assignment Mode</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Round Robin */}
              <button
                type="button"
                onClick={() => updateMutation.mutate({ ...currentWeights, maxLosPerAssistant: currentMax, roundRobinEnabled: true })}
                className={`flex flex-col gap-1.5 p-3 rounded-lg border-2 text-left transition-all ${
                  settings?.roundRobinEnabled !== false
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <RepeatIcon className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Round Robin</span>
                  {settings?.roundRobinEnabled !== false && <Badge className="text-[10px] px-1.5 py-0 bg-primary text-white ml-auto">Active</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">CLRs take turns getting LOs in a snake pattern — no CLR gets back-to-back calls. Assignments regenerate daily based on algorithm scores.</p>
              </button>
              {/* Fixed Monthly */}
              <button
                type="button"
                onClick={() => updateMutation.mutate({ ...currentWeights, maxLosPerAssistant: currentMax, roundRobinEnabled: false })}
                className={`flex flex-col gap-1.5 p-3 rounded-lg border-2 text-left transition-all ${
                  settings?.roundRobinEnabled === false
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-900/10"
                    : "border-border hover:border-amber-400/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-semibold">Fixed Monthly</span>
                  {settings?.roundRobinEnabled === false && <Badge className="text-[10px] px-1.5 py-0 bg-amber-500 text-white ml-auto">Active</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">Each CLR keeps the same LOs for the entire month. Admin clicks Shuffle to randomize at the start of a new month.</p>
              </button>
            </div>
            {settings?.roundRobinEnabled === false && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">Current month: <span className="font-mono font-medium">{new Date().toISOString().slice(0,7)}</span></p>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 gap-1.5"
                  onClick={async () => {
                    await apiRequest("POST", "/api/monthly-assignments/shuffle", { month: new Date().toISOString().slice(0,7) });
                    toast({ title: "Monthly assignments shuffled" });
                  }}
                >
                  <Shuffle className="w-3 h-3" />
                  Shuffle Now
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={handleReset} data-testid="button-reset-settings">
          <RotateCcw className="w-4 h-4 mr-2" />Reset to Defaults
        </Button>
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending || !isWeightValid}
          data-testid="button-save-settings"
        >
          <Save className="w-4 h-4 mr-2" />
          {updateMutation.isPending ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );

  const profileTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Your Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {authUser ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  {(authUser.name ?? authUser.email ?? "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-medium">{authUser.name}</p>
                  <p className="text-xs text-muted-foreground">{authUser.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wide">Role</p>
                  <p className="font-medium capitalize">{authUser.role}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wide">Status</p>
                  <p className="font-medium text-green-600">Active</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Loading profile…</p>
          )}
        </CardContent>
      </Card>

      {authUser && (authUser.role === 'assistant' || authUser.role === 'admin') && (
        <ProfileGoalsCard authUser={authUser} />
      )}

      {/* Managers/admins: set weekly goals for any CLR right from Settings */}
      {canReports && <TeamGoalsCard users={users} />}

      <TimezonePreferenceCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            Change Password
          </CardTitle>
          {authUser && (
            <p className="text-xs text-muted-foreground mt-1">
              Changing password for: {authUser.email}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Current Password</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={e => { setCurrentPassword(e.target.value); setPasswordError(null); }}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">New Password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setPasswordError(null); }}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Confirm New Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                placeholder="Repeat new password"
                autoComplete="new-password"
              />
            </div>
          </div>

          {passwordError && (
            <p className="text-xs text-destructive">{passwordError}</p>
          )}

          <Button
            className="w-full sm:w-auto"
            disabled={passwordLoading}
            onClick={async () => {
              setPasswordError(null);
              if (!currentPassword || !newPassword || !confirmPassword) {
                setPasswordError("All fields are required.");
                return;
              }
              if (newPassword.length < 8) {
                setPasswordError("New password must be at least 8 characters.");
                return;
              }
              if (newPassword !== confirmPassword) {
                setPasswordError("New password and confirm password do not match.");
                return;
              }
              setPasswordLoading(true);
              try {
                const res = await fetch("/api/users/me/password", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
                });
                const data = await res.json();
                if (!res.ok) {
                  setPasswordError(data.error ?? "Failed to change password.");
                } else {
                  toast({ title: "Password updated" });
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }
              } catch {
                setPasswordError("An unexpected error occurred. Please try again.");
              } finally {
                setPasswordLoading(false);
              }
            }}
          >
            {passwordLoading ? "Updating…" : "Update Password"}
          </Button>
        </CardContent>
      </Card>

      <NotificationsCard />
    </div>
  );

  const reportsTab = (
    <div className="space-y-6">
      <EmailReportsCard />
    </div>
  );

  const teamTab = (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" />
            Team Members
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No users found.</div>
          ) : (
            users.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0" data-testid={`row-user-${u.id}`}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {u.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={`text-xs px-2 ${u.role === "admin" ? "bg-primary/10 text-primary border-primary/30" : "bg-muted text-muted-foreground"}`}
                    variant="outline"
                  >
                    {u.role}
                  </Badge>
                  <Badge
                    className={`text-xs px-2 ${u.isActive ? "text-green-600 border-green-300" : "text-red-500 border-red-300"}`}
                    variant="outline"
                  >
                    {u.isActive ? "Active" : "Inactive"}
                  </Badge>
                  {(u.role === 'assistant' || u.role === 'admin') && <SetGoalsButton user={u} />}
                  <ManagerToggleButton user={u} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <TeamManagement />

      <ResendIntroEmails users={users} />
    </div>
  );

  const appTab = (
    <div className="space-y-6">
      <PushNotificationsCard />
      {isAdmin && <BulkTexterCard />}
      {isAdmin && <NmlsScheduleCard />}
      {isAdmin && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-muted-foreground" />
            <div>
              <h2 className="text-lg font-semibold">Send Notification</h2>
              <p className="text-sm text-muted-foreground">Broadcast announcements and reminders to the team.</p>
            </div>
          </div>
          <BroadcastNotifications />
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-[900px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">Manage your profile and workspace configuration</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="profile" className="gap-1.5" data-testid="tab-profile">
            <User className="w-3.5 h-3.5" /> Profile
          </TabsTrigger>
          {canReports && (
            <TabsTrigger value="reports" className="gap-1.5" data-testid="tab-reports">
              <Mail className="w-3.5 h-3.5" /> Reports
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="team" className="gap-1.5" data-testid="tab-team">
              <Users className="w-3.5 h-3.5" /> Team
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="algorithm" className="gap-1.5" data-testid="tab-algorithm">
              <Sliders className="w-3.5 h-3.5" /> Algorithm
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="export" className="gap-1.5" data-testid="tab-export">
              <Download className="w-3.5 h-3.5" /> Export
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="audit" className="gap-1.5" data-testid="tab-audit">
              <Shield className="w-3.5 h-3.5" /> Audit Log
            </TabsTrigger>
          )}
          <TabsTrigger value="script" className="gap-1.5" data-testid="tab-script">
            <PhoneCall className="w-3.5 h-3.5" /> Script
          </TabsTrigger>
          <TabsTrigger value="app" className="gap-1.5" data-testid="tab-app">
            <LayoutGrid className="w-3.5 h-3.5" /> App
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">{profileTab}</TabsContent>
        {canReports && <TabsContent value="reports" className="mt-6">{reportsTab}</TabsContent>}
        {isAdmin && <TabsContent value="team" className="mt-6">{teamTab}</TabsContent>}
        {isAdmin && <TabsContent value="algorithm" className="mt-6">{algorithmTab}</TabsContent>}
        {isAdmin && <TabsContent value="export" className="mt-6"><ExportDataCard /></TabsContent>}
        {isAdmin && <TabsContent value="audit" className="mt-6"><AuditLog /></TabsContent>}
        <TabsContent value="script" className="mt-6"><ScriptDefaultsCard /></TabsContent>
        <TabsContent value="app" className="mt-6">{appTab}</TabsContent>
      </Tabs>
    </div>
  );
}
