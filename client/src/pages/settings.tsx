import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Settings2, Save, RotateCcw, Info, Users, Megaphone, Activity, Lock, Mail, Shuffle, RepeatIcon, Calendar, ShieldCheck } from "lucide-react";
import { TeamManagement } from "@/components/team-management";
import { BroadcastNotifications } from "@/components/broadcast-notifications";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth";

const DEFAULT_WEIGHTS = {
  weightDaysSinceWorked: 0.35,
  weightFrequency: 0.25,
  weightAvailability: 0.20,
  weightBoost: 0.15,
  weightPriorityTier: 0.05,
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
};

function computeScore(lo: any, weights: ScoreWeights) {
  const daysSince = lo.lastWorkedDate
    ? Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86_400_000)
    : 999;
  const daysSinceNorm = Math.min(daysSince / 30, 1);
  const freqScore = 1 - Math.min((lo.totalTimesWorked ?? 0) / 100, 1);
  const availScore = 1;
  const boostNorm = (lo.boostScore ?? 0) / 10;
  const tierScore = lo.priorityTier === 1 ? 1 : lo.priorityTier === 2 ? 0.5 : 0.1;

  const score =
    weights.weightDaysSinceWorked * daysSinceNorm +
    weights.weightFrequency * freqScore +
    weights.weightAvailability * availScore +
    weights.weightBoost * boostNorm +
    weights.weightPriorityTier * tierScore;

  return {
    score,
    components: {
      recency: weights.weightDaysSinceWorked * daysSinceNorm,
      freq: weights.weightFrequency * freqScore,
      avail: weights.weightAvailability * availScore,
      boost: weights.weightBoost * boostNorm,
      tier: weights.weightPriorityTier * tierScore,
    },
  };
}

const COMPONENT_COLORS = [
  "bg-teal-100 text-teal-700",
  "bg-purple-100 text-purple-700",
  "bg-green-100 text-green-700",
  "bg-orange-100 text-orange-700",
  "bg-indigo-100 text-indigo-700",
];

function ScorePreview({ weights }: { weights: ScoreWeights }) {
  const { data: los = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const activeLos = los.filter(
    (lo) => lo.internalStatus === "active" && !lo.snoozeUntil
  );

  const ranked = activeLos
    .map((lo) => ({ lo, ...computeScore(lo, weights) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

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

// ── Email Reports Card ────────────────────────────────────────────────────────
// ── NMLS Schedule Card ───────────────────────────────────────────────────────
function NmlsScheduleCard() {
  const { toast } = useToast();
  const { data: schedule, isLoading } = useQuery<any>({ queryKey: ["/api/nmls-schedule"] });
  const [checkDay1, setCheckDay1] = useState("1");
  const [checkDay2, setCheckDay2] = useState("16");
  const [escalationDays, setEscalationDays] = useState("7");

  useEffect(() => {
    if (!schedule) return;
    setCheckDay1(String(schedule.check_day_1 ?? 1));
    setCheckDay2(String(schedule.check_day_2 ?? 16));
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
          On check days, a random CLR is assigned to verify each active LO's NMLS license on Consumer Access.
          If not confirmed within the escalation window, all CLRs are notified.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">First check day</label>
                <Input
                  type="number" min={1} max={14} value={checkDay1}
                  onChange={e => setCheckDay1(e.target.value)}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">Day 1–14 (default: 1st)</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Second check day</label>
                <Input
                  type="number" min={15} max={28} value={checkDay2}
                  onChange={e => setCheckDay2(e.target.value)}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground">Day 15–28 (default: 16th)</p>
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
                onClick={() => saveMutation.mutate({ checkDay1: parseInt(checkDay1), checkDay2: parseInt(checkDay2), escalationDays: parseInt(escalationDays) })}
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

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [managerEmails, setManagerEmails] = useState<string[]>([]);
  const [newManagerEmail, setNewManagerEmail] = useState("");
  const [dailyEnabled, setDailyEnabled] = useState(false);
  const [weeklyEnabled, setWeeklyEnabled] = useState(false);
  const [monthlyEnabled, setMonthlyEnabled] = useState(false);
  const [dailyTime, setDailyTime] = useState("08:00");
  const [testLoading, setTestLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);

  // Populate form from fetched settings
  useEffect(() => {
    if (!emailSettings) return;
    setSmtpHost(emailSettings.smtp_host ?? emailSettings.smtpHost ?? "");
    setSmtpPort(String(emailSettings.smtp_port ?? emailSettings.smtpPort ?? 587));
    setSmtpUser(emailSettings.smtp_user ?? emailSettings.smtpUser ?? "");
    setSmtpPass(""); // never pre-fill password
    setFromAddress(emailSettings.from_address ?? emailSettings.fromAddress ?? "");
    try { setManagerEmails(JSON.parse(emailSettings.manager_emails ?? emailSettings.managerEmails ?? "[]")); } catch { setManagerEmails([]); }
    setDailyEnabled(!!(emailSettings.daily_enabled ?? emailSettings.dailyEnabled));
    setWeeklyEnabled(!!(emailSettings.weekly_enabled ?? emailSettings.weeklyEnabled));
    setMonthlyEnabled(!!(emailSettings.monthly_enabled ?? emailSettings.monthlyEnabled));
    setDailyTime(emailSettings.daily_time ?? emailSettings.dailyTime ?? "08:00");
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
      smtpHost,
      smtpPort: parseInt(smtpPort),
      smtpUser,
      fromAddress,
      managerEmails: JSON.stringify(managerEmails),
      dailyEnabled: dailyEnabled ? 1 : 0,
      weeklyEnabled: weeklyEnabled ? 1 : 0,
      monthlyEnabled: monthlyEnabled ? 1 : 0,
      dailyTime,
    };
    if (smtpPass && smtpPass !== "••••••••") payload.smtpPass = smtpPass;
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
          description: `Successfully connected to ${smtpHost || "SMTP server"}.`,
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
        title: "SMTP test failed",
        description: "Could not reach the server. Check your network connection.",
        variant: "destructive",
      });
    } finally {
      setTestLoading(false);
    }
  }

  async function handleSendNow(type: "daily" | "weekly" | "monthly") {
    setSendLoading(true);
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    try {
      const res = await fetch("/api/settings/email/send-now", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (res.ok) {
        const recipients = managerEmails.length
          ? managerEmails.join(", ")
          : "configured recipients";
        toast({
          title: `${label} report sent`,
          description: `Delivered to: ${recipients}`,
        });
      } else {
        const reason = data.error ?? `Server responded with status ${res.status}.`;
        toast({
          title: `Failed to send ${label.toLowerCase()} report`,
          description: reason.includes("SMTP not configured")
            ? "SMTP is not configured. Save your email settings first."
            : reason.includes("No manager")
            ? "No recipient emails have been added. Add a manager email and save."
            : reason,
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
          <span>Configure SMTP and schedule daily, weekly, or monthly reports to managers. Reports include leaderboard, transfer counts, and key stats.</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {emailLoading ? (
          <div className="space-y-3">{Array.from({length:4}).map((_,i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <>
            {/* SMTP Config */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">SMTP Configuration</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">SMTP Host</label>
                  <Input placeholder="smtp.gmail.com" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Port</label>
                  <Input placeholder="587" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Username / Email</label>
                  <Input placeholder="noreply@westcapital.com" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Password</label>
                  <Input type="password" placeholder="Leave blank to keep current" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">From Address</label>
                  <Input placeholder="CLR Connection Center <noreply@westcapital.com>" value={fromAddress} onChange={e => setFromAddress(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Manager emails */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Manager Recipients</p>
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
            </div>

            {/* Schedule toggles */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Schedule</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Daily Report</p>
                    <p className="text-xs text-muted-foreground">Sent each morning at the configured time</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {dailyEnabled && (
                      <Input
                        type="time"
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
                    <p className="text-xs text-muted-foreground">Sent every Monday morning</p>
                  </div>
                  <Switch checked={weeklyEnabled} onCheckedChange={setWeeklyEnabled} />
                </div>
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Monthly Report</p>
                    <p className="text-xs text-muted-foreground">Sent on the 16th of each month</p>
                  </div>
                  <Switch checked={monthlyEnabled} onCheckedChange={setMonthlyEnabled} />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={handleTest} disabled={testLoading} className="gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                {testLoading ? "Testing…" : "Test Connection"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleSendNow("daily")} disabled={sendLoading} className="gap-1.5">
                {sendLoading ? "Sending…" : "Send Daily Now"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleSendNow("weekly")} disabled={sendLoading} className="gap-1.5">
                {sendLoading ? "Sending…" : "Send Weekly Now"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleSendNow("monthly")} disabled={sendLoading} className="gap-1.5">
                {sendLoading ? "Sending…" : "Send Monthly Now"}
              </Button>
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

export default function Settings() {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const { data: settings, isLoading } = useQuery<any>({ queryKey: ["/api/settings/algorithm"] });

  const [weights, setWeights] = useState<Record<WeightKey, number> | null>(null);
  const [maxLOs, setMaxLOs] = useState<number | null>(null);

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
  } : {
    weightDaysSinceWorked: 0.35,
    weightFrequency: 0.25,
    weightAvailability: 0.20,
    weightBoost: 0.15,
    weightPriorityTier: 0.05,
  });

  const currentMax = maxLOs ?? settings?.maxLosPerAssistant ?? 5;
  const totalWeight = Object.values(currentWeights).reduce((a, b) => a + b, 0);
  const isWeightValid = Math.abs(totalWeight - 1.0) < 0.01;

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", "/api/settings/algorithm", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/algorithm"] });
      setWeights(null);
      setMaxLOs(null);
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
    });
  };

  const handleReset = () => {
    setWeights({
      weightDaysSinceWorked: DEFAULT_WEIGHTS.weightDaysSinceWorked,
      weightFrequency: DEFAULT_WEIGHTS.weightFrequency,
      weightAvailability: DEFAULT_WEIGHTS.weightAvailability,
      weightBoost: DEFAULT_WEIGHTS.weightBoost,
      weightPriorityTier: DEFAULT_WEIGHTS.weightPriorityTier,
    });
    setMaxLOs(DEFAULT_WEIGHTS.maxLosPerAssistant);
  };

  const setWeight = (key: WeightKey, value: number) => {
    setWeights(prev => ({ ...(prev ?? currentWeights), [key]: value }));
  };

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  return (
    <div className="p-6 space-y-6 max-w-[800px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">Configure the assignment ranking algorithm</p>
        </div>
      </div>

      {/* Algorithm Weights */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Ranking Algorithm Weights</CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant={isWeightValid ? "outline" : "destructive"}
                className="text-xs"
                data-testid="badge-weight-total"
              >
                Total: {(totalWeight * 100).toFixed(0)}%
                {!isWeightValid && " ⚠ must = 100%"}
              </Badge>
            </div>
          </div>
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
      </Card>

      {/* Score Preview */}
      <ScorePreview weights={currentWeights} />

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

      {/* Email Reports */}
      <EmailReportsCard />

      {/* NMLS License Check Schedule */}
      <NmlsScheduleCard />

      {/* Team Members */}
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
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Save / Reset */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={handleReset} data-testid="button-reset-settings">
          <RotateCcw className="w-4 h-4 mr-2" />Reset to Defaults
        </Button>
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending || (!weights && maxLOs === null)}
          data-testid="button-save-settings"
        >
          <Save className="w-4 h-4 mr-2" />
          {updateMutation.isPending ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      <Separator />

      {/* Team Management */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Team Management</h2>
            <p className="text-sm text-muted-foreground">Add and manage CLR assistant accounts.</p>
          </div>
        </div>
        <TeamManagement />
      </div>

      <Separator />

      {/* Broadcast Notifications */}
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

      <Separator />

      {/* Change Password */}
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
                const res = await fetch("/api/auth/change-password", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ currentPassword, newPassword }),
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
    </div>
  );
}
