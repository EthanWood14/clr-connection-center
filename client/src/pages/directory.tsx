import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Plus, Copy, Eye, EyeOff, Edit2, Trash2, RotateCcw,
  ChevronDown, ChevronUp, BedDouble, AlertCircle, CalendarDays,
  Upload, CheckCheck, BarChart2, ExternalLink, ShieldCheck, ShieldAlert, Clock,
  Heart, Save, X as XIcon,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoAvailabilityEditor } from "@/components/lo-availability-editor";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { LoCsvImport } from "@/components/lo-csv-import";
import { LoStatusBadge } from "@/components/lo-status-badge";
import { copyToClipboard } from "@/lib/utils";

// ── Tier / Status display maps ────────────────────────────────────────────────
const TIER_LABELS: Record<number, string> = { 1: "VIP", 2: "Standard", 3: "Low" };
const TIER_COLORS: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

// ── Algorithm score helper ────────────────────────────────────────────────────
interface Weights {
  weightDaysSinceWorked: number;
  weightFrequency: number;
  weightAvailability: number;
  weightBoost: number;
  weightPriorityTier: number;
}
function computeScore(lo: any, weights: Weights): number {
  const daysSince = lo.lastWorkedDate
    ? Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86400000)
    : 999;
  const daysSinceNorm = Math.min(daysSince / 30, 1);
  const freqScore = 1 - Math.min((lo.totalTimesWorked ?? 0) / 100, 1);
  const boostNorm = (lo.boostScore ?? 0) / 10;
  const tierScore = lo.priorityTier === 1 ? 1 : lo.priorityTier === 2 ? 0.5 : 0.1;
  return (
    weights.weightDaysSinceWorked * daysSinceNorm +
    weights.weightFrequency * freqScore +
    weights.weightAvailability * 1 +
    weights.weightBoost * boostNorm +
    weights.weightPriorityTier * tierScore
  );
}

// ── Score badge ───────────────────────────────────────────────────────────────
function ScorePip({ score }: { score: number }) {
  // score is 0-1 scale; colour it green / amber / red
  const pct = Math.round(score * 100);
  const color =
    pct >= 70 ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-800"
    : pct >= 40 ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800"
    : "text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-900/20 dark:border-rose-800";
  return (
    <div title="Algorithm priority score" className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${color}`}>
      <BarChart2 className="w-3 h-3" />
      <span>{pct}</span>
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const copy = () => {
    copyToClipboard(value).then(() => {
      setDone(true);
      toast({ title: `${label} copied` });
      setTimeout(() => setDone(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label}`}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-all
        text-muted-foreground border-border hover:border-primary hover:text-primary bg-background hover:bg-primary/5"
    >
      {done ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? "Copied" : label}
    </button>
  );
}

// ── Inline credential block ───────────────────────────────────────────────────
// Fetches plaintext credentials on demand from /api/loan-officers/:id/credentials
function CredBlock({
  loId,
  system,
  username,
  hasPassword,
}: {
  loId: number;
  system: string;
  username?: string | null;
  hasPassword: boolean;
}) {
  const { toast } = useToast();
  const [showPass, setShowPass] = useState(false);
  const [plainPass, setPlainPass] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPlaintext = async (): Promise<string | null> => {
    if (plainPass) return plainPass;
    setLoading(true);
    try {
      const res = await fetch(`/api/loan-officers/${loId}/credentials`, { credentials: "include" });
      if (!res.ok) {
        toast({
          title: res.status === 401 ? "Please log in again" : "Failed to load credentials",
          description: `Server returned ${res.status}`,
          variant: "destructive",
        });
        return null;
      }
      const data = await res.json();
      const pass = system === "Bonzo" ? data.bonzoPassword : data.leadMailboxPassword;
      if (!pass) {
        toast({
          title: "No password saved",
          description: `No ${system} password is stored for this LO.`,
          variant: "destructive",
        });
      }
      setPlainPass(pass ?? null);
      return pass ?? null;
    } catch (e: any) {
      toast({ title: "Failed to load credentials", description: e?.message, variant: "destructive" });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleShow = async () => {
    if (!showPass && !plainPass) await fetchPlaintext();
    setShowPass(s => !s);
  };

  const handleCopy = async () => {
    const pass = await fetchPlaintext();
    if (pass) {
      copyToClipboard(pass).then(() => {
        toast({ title: "password copied" });
      });
    }
  };

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{system}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {username ? (
          <span className="font-mono text-xs text-foreground truncate max-w-[140px]" title={username}>{username}</span>
        ) : (
          <span className="text-xs text-muted-foreground italic">no username</span>
        )}
        {username && <CopyBtn value={username} label="username" />}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {hasPassword ? (
          <>
            <span className="font-mono text-xs text-foreground">
              {showPass && plainPass ? plainPass : "••••••••"}
            </span>
            <button
              type="button"
              onClick={handleShow}
              disabled={loading}
              title={showPass ? "Hide password" : "Show password"}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {showPass ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={loading}
              title="Copy password"
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-all
                text-muted-foreground border-border hover:border-primary hover:text-primary bg-background hover:bg-primary/5 disabled:opacity-50"
            >
              <Copy className="w-3 h-3" />
              password
            </button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground italic">no password</span>
        )}
      </div>
    </div>
  );
}

// ── LO Card ───────────────────────────────────────────────────────────────────
// ── Personal Preferences inline editor ────────────────────────────────────────
// Anyone authed can edit — collaborative "how this LO likes to work" notes.
function PreferencesEditor({ loId, value }: { loId: number; value: string | null | undefined }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value ?? "");

  // Re-sync draft when the saved value changes (e.g., another user edited it)
  useEffect(() => { if (!editing) setDraft(value ?? ""); }, [value, editing]);

  const saveMutation = useMutation({
    mutationFn: (next: string) =>
      apiRequest("PATCH", `/api/loan-officers/${loId}/preferences`, { personalPreferences: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      setEditing(false);
      toast({ title: "Preferences saved" });
    },
    onError: () => toast({ title: "Couldn’t save preferences", variant: "destructive" }),
  });

  const hasValue = !!(value && value.trim());

  if (!editing) {
    return (
      <div className="sm:col-span-2">
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Heart className="w-3 h-3" /> Personal Preferences
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => { setDraft(value ?? ""); setEditing(true); }}
            data-testid={`button-edit-prefs-${loId}`}
          >
            <Edit2 className="w-3 h-3 mr-1" />
            {hasValue ? "Edit" : "Add"}
          </Button>
        </div>
        {hasValue ? (
          <p className="text-foreground whitespace-pre-wrap">{value}</p>
        ) : (
          <p className="text-muted-foreground italic">No preferences recorded yet. Click “Add” to share what you’ve learned about this LO.</p>
        )}
      </div>
    );
  }

  return (
    <div className="sm:col-span-2">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
        <Heart className="w-3 h-3" /> Personal Preferences
      </div>
      <Textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="How they like to work — preferred contact times, communication style, lead handoff quirks, etc."
        className="text-xs"
        data-testid={`textarea-prefs-inline-${loId}`}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">{draft.length}/4000</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => { setDraft(value ?? ""); setEditing(false); }}
            disabled={saveMutation.isPending}
          >
            <XIcon className="w-3 h-3 mr-1" /> Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => saveMutation.mutate(draft.trim())}
            disabled={saveMutation.isPending || draft === (value ?? "")}
            data-testid={`button-save-prefs-${loId}`}
          >
            <Save className="w-3 h-3 mr-1" />
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LOCard({
  lo,
  score,
  onEdit,
  onDelete,
  onRestore,
  nmlsCheck,
  onConfirmNmls,
}: {
  lo: any;
  score: number | null;
  onEdit: (lo: any) => void;
  onDelete: (id: number) => void;
  onRestore: (id: number) => void;
  nmlsCheck?: any;
  onConfirmNmls?: (loId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();
  const tierLabel = TIER_LABELS[lo.priorityTier] ?? "—";
  const statusLabel = lo.internalStatus ?? "active";
  const handleCopy = () => {
    const text = `${lo.fullName ?? "(unnamed)"} | NMLS: ${lo.nmlsId ?? "n/a"} | Tier: ${tierLabel} | Status: ${statusLabel}`;
    copyToClipboard(text).then(() => {
      toast({ title: "Copied to clipboard", description: text });
    });
  };
  const states: string[] = (() => {
    try { return JSON.parse(lo.licensedStates || "[]"); } catch { return []; }
  })();
  const hasCredentials = true; // always show credential section
  const daysSince = lo.lastWorkedDate
    ? Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86400000)
    : null;

  const isInactive = lo.internalStatus === "inactive" || lo.internalStatus === "vacation" || lo.internalStatus === "archived";

  return (
    <Card className={`overflow-hidden ${isInactive ? "opacity-70 bg-muted/30" : ""}`} data-testid={`card-lo-${lo.id}`}>
      <CardContent className="p-0">

        {/* ── Main row ──────────────────────────────────────────────────── */}
        <div className="p-4 flex items-start gap-3">
          {/* Avatar */}
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary">
            {(lo.fullName ?? "").split(" ").map((n: string) => n?.[0] ?? "").join("").slice(0, 2).toUpperCase() || "?"}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Name + badges row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm" data-testid={`text-lo-name-${lo.id}`}>
                {lo.fullName ?? "(unnamed)"}
              </span>
              <Badge className={`text-xs px-1.5 py-0 ${TIER_COLORS[lo.priorityTier]}`}>
                {TIER_LABELS[lo.priorityTier]}
              </Badge>
              <LoStatusBadge status={lo.internalStatus} className="text-xs" />
              {lo.snoozeUntil && new Date(lo.snoozeUntil) > new Date() && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 text-orange-600 border-orange-300">
                  <BedDouble className="w-3 h-3 mr-1" />Snoozed
                </Badge>
              )}
              {lo.personalPreferences && lo.personalPreferences.trim() && (
                <Badge
                  variant="outline"
                  className="text-xs px-1.5 py-0 text-rose-600 border-rose-300 cursor-pointer"
                  title="Personal preferences recorded — expand for details"
                  onClick={() => setExpanded(true)}
                  data-testid={`badge-prefs-${lo.id}`}
                >
                  <Heart className="w-3 h-3 mr-1" />Preferences
                </Badge>
              )}
            </div>

            {/* Sub-info */}
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
              {lo.nmlsId && (
                <span className="inline-flex items-center gap-1">
                  NMLS:
                  <a
                    href={`https://www.nmlsconsumeraccess.org/TuringTestPage.aspx?ReturnUrl=/EntityDetails.aspx/INDIVIDUAL/${lo.nmlsId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline inline-flex items-center gap-0.5"
                    onClick={e => e.stopPropagation()}
                  >
                    {lo.nmlsId} <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  {nmlsCheck && (
                    nmlsCheck.status === "confirmed"
                      ? <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400"><ShieldCheck className="w-3 h-3" /> Verified</span>
                      : nmlsCheck.status === "escalated"
                      ? <span className="inline-flex items-center gap-0.5 text-red-500"><ShieldAlert className="w-3 h-3" /> Overdue</span>
                      : <span className="inline-flex items-center gap-0.5 text-yellow-600 dark:text-yellow-400"><Clock className="w-3 h-3" /> Pending</span>
                  )}
                </span>
              )}
              {lo.phone && <span>{lo.phone}</span>}
              {lo.email && <span className="truncate max-w-[200px]">{lo.email}</span>}
              {daysSince !== null && (
                <span className={daysSince > 14 ? "text-orange-500" : ""}>
                  Last worked: {daysSince}d ago
                </span>
              )}
            </div>

            {/* State pills */}
            {states.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1.5">
                {states.slice(0, 10).map((s: string) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    {s}
                  </span>
                ))}
                {states.length > 10 && (
                  <span className="text-[10px] text-muted-foreground">+{states.length - 10} more</span>
                )}
              </div>
            )}

            {/* ── Credentials (always visible if they exist) ─────────── */}
            {hasCredentials && (
              <div className="mt-2.5 pt-2.5 border-t flex flex-wrap gap-x-6 gap-y-2">
                <CredBlock
                  loId={lo.id}
                  system="Bonzo"
                  username={lo.bonzoUsername}
                  hasPassword={!!lo.bonzoPassword}
                />
                <CredBlock
                  loId={lo.id}
                  system="Lead Mailbox"
                  username={lo.leadMailboxUsername}
                  hasPassword={!!lo.leadMailboxPassword}
                />
              </div>
            )}
          </div>

          {/* Right side: score + action buttons */}
          <div className="flex items-start gap-1 flex-shrink-0 ml-1">
            {score !== null && <ScorePip score={score} />}
            {lo.nmlsId && nmlsCheck && nmlsCheck.status !== "confirmed" && onConfirmNmls && (
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 hover:text-green-600"
                title="Mark NMLS as verified for this period"
                onClick={() => onConfirmNmls(lo.id)}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => onEdit(lo)}
              title="Edit"
              data-testid={`button-edit-lo-${lo.id}`}>
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="w-7 h-7"
              onClick={handleCopy}
              title="Copy LO info to clipboard"
              data-testid={`button-copy-lo-${lo.id}`}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
            {lo.nmlsId && (
              <Button variant="ghost" size="icon" className="w-7 h-7" asChild
                title="Open NMLS Consumer Access"
                data-testid={`button-nmls-lo-${lo.id}`}>
                <a
                  href={`https://www.nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/${lo.nmlsId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
            )}
            {lo.internalStatus === "archived" ? (
              <Button variant="ghost" size="icon" className="w-7 h-7 hover:text-emerald-600"
                onClick={() => onRestore(lo.id)} title="Restore to active"
                data-testid={`button-restore-lo-${lo.id}`}>
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="w-7 h-7 hover:text-destructive"
                onClick={() => onDelete(lo.id)} title="Delete"
                data-testid={`button-delete-lo-${lo.id}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
              onClick={() => setExpanded(e => !e)}
              data-testid={`button-expand-lo-${lo.id}`}>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>{expanded ? "Hide" : "View"}</span>
            </Button>
          </div>
        </div>

        {/* ── Expanded section: notes, special requests, preferences ────── */}
        {expanded && (
          <div className="px-4 pb-4 pt-0 border-t bg-muted/30">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 text-xs">
              {lo.notes && (
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Notes</div>
                  <p className="text-foreground">{lo.notes}</p>
                </div>
              )}
              {lo.specialRequests && (
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Special Requests</div>
                  <p className="text-foreground flex items-start gap-1">
                    <AlertCircle className="w-3 h-3 text-orange-500 mt-0.5 flex-shrink-0" />
                    {lo.specialRequests}
                  </p>
                </div>
              )}
              {lo.snoozeUntil && (
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Snoozed Until</div>
                  <p className="text-foreground">{lo.snoozeUntil}{lo.snoozeReason ? ` — ${lo.snoozeReason}` : ""}</p>
                </div>
              )}
              {/* Personal preferences — always visible (anyone can add) */}
              <PreferencesEditor loId={lo.id} value={lo.personalPreferences} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── US States for checkbox grid ─────────────────────────────────────────────
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

function StateCheckboxGrid({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (states: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (st: string) =>
    onChange(selected.includes(st) ? selected.filter(s => s !== st) : [...selected, st].sort());
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Licensed States
          {selected.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {selected.length} selected
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {open ? <><ChevronUp className="h-3.5 w-3.5" /> Hide</> : <><ChevronDown className="h-3.5 w-3.5" /> {selected.length > 0 ? selected.join(", ") : "Choose states"}</>}
        </button>
      </div>
      {!open && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {selected.map(s => (
            <span key={s} className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              {s}
              <button type="button" onClick={() => toggle(s)} className="hover:text-destructive leading-none">×</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => onChange([...US_STATES])} className="text-xs text-primary hover:underline">Select All</button>
            <span className="text-muted-foreground text-xs">·</span>
            <button type="button" onClick={() => onChange([])} className="text-xs text-muted-foreground hover:underline">Clear All</button>
          </div>
          <div className="grid grid-cols-5 gap-x-4 gap-y-2">
            {US_STATES.map(st => (
              <label key={st} className="flex items-center gap-1.5 cursor-pointer select-none">
                <Checkbox
                  checked={selected.includes(st)}
                  onCheckedChange={() => toggle(st)}
                  className="h-3.5 w-3.5"
                />
                <span className="text-xs font-mono">{st}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LO Form Dialog ────────────────────────────────────────────────────────────
const loFormSchema = z.object({
  fullName: z.string().min(2, "Name required"),
  nmlsId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  licensedStates: z.string().optional(),
  bonzoUsername: z.string().optional(),
  bonzoPassword: z.string().optional(),
  leadMailboxUsername: z.string().optional(),
  leadMailboxPassword: z.string().optional(),
  notes: z.string().optional(),
  specialRequests: z.string().optional(),
  personalPreferences: z.string().optional(),
  boostScore: z.coerce.number().min(0).max(10).default(0),
  priorityTier: z.coerce.number().min(1).max(3).default(2),
  internalStatus: z.string().default("active"),
  snoozeUntil: z.string().optional(),
  snoozeReason: z.string().optional(),
});
type LoFormValues = z.infer<typeof loFormSchema>;

function LOFormDialog({
  open,
  onClose,
  initialValues,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  initialValues?: Partial<LoFormValues> | null;
  onSubmit: (values: LoFormValues) => void;
  isPending: boolean;
}) {
  // Parse initial states from JSON string or array
  const parseStates = (raw: string | string[] | undefined | null): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as string[];
    try { const p = JSON.parse(raw as string); return Array.isArray(p) ? p : []; }
    catch { return (raw as string).split(",").map(s => s.trim().toUpperCase()).filter(Boolean); }
  };

  const [statesSelected, setStatesSelected] = useState<string[]>(
    () => parseStates(initialValues?.licensedStates as string | string[] | undefined)
  );

  const form = useForm<LoFormValues>({
    resolver: zodResolver(loFormSchema),
    defaultValues: {
      fullName: initialValues?.fullName ?? "",
      nmlsId: initialValues?.nmlsId ?? "",
      phone: initialValues?.phone ?? "",
      email: initialValues?.email ?? "",
      licensedStates: "", // managed separately via statesSelected
      bonzoUsername: initialValues?.bonzoUsername ?? "",
      bonzoPassword: initialValues?.bonzoPassword ?? "",
      leadMailboxUsername: initialValues?.leadMailboxUsername ?? "",
      leadMailboxPassword: initialValues?.leadMailboxPassword ?? "",
      notes: initialValues?.notes ?? "",
      specialRequests: initialValues?.specialRequests ?? "",
      personalPreferences: (initialValues as any)?.personalPreferences ?? "",
      boostScore: initialValues?.boostScore ?? 0,
      priorityTier: initialValues?.priorityTier ?? 2,
      internalStatus: initialValues?.internalStatus ?? "active",
      snoozeUntil: initialValues?.snoozeUntil ?? "",
      snoozeReason: initialValues?.snoozeReason ?? "",
    },
  });

  // Reset form + states whenever the dialog opens with new data
  useEffect(() => {
    if (open) {
      setStatesSelected(parseStates(initialValues?.licensedStates as string | string[] | undefined));
      form.reset({
        fullName: initialValues?.fullName ?? "",
        nmlsId: initialValues?.nmlsId ?? "",
        phone: initialValues?.phone ?? "",
        email: initialValues?.email ?? "",
        licensedStates: "",
        bonzoUsername: initialValues?.bonzoUsername ?? "",
        bonzoPassword: initialValues?.bonzoPassword ?? "",
        leadMailboxUsername: initialValues?.leadMailboxUsername ?? "",
        leadMailboxPassword: initialValues?.leadMailboxPassword ?? "",
        notes: initialValues?.notes ?? "",
        specialRequests: initialValues?.specialRequests ?? "",
        personalPreferences: (initialValues as any)?.personalPreferences ?? "",
        boostScore: initialValues?.boostScore ?? 0,
        priorityTier: initialValues?.priorityTier ?? 2,
        internalStatus: initialValues?.internalStatus ?? "active",
        snoozeUntil: initialValues?.snoozeUntil ?? "",
        snoozeReason: initialValues?.snoozeReason ?? "",
      });
    }
  }, [open, initialValues]);

  const handleSubmit = (values: LoFormValues) => {
    onSubmit({ ...values, licensedStates: JSON.stringify(statesSelected) as unknown as string });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialValues ? "Edit Loan Officer" : "Add Loan Officer"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-lo-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="nmlsId" render={({ field }) => (
                <FormItem>
                  <FormLabel>NMLS ID</FormLabel>
                  <FormControl><Input {...field} data-testid="input-lo-nmls" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input {...field} data-testid="input-lo-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} data-testid="input-lo-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <StateCheckboxGrid selected={statesSelected} onChange={setStatesSelected} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bonzo Credentials</div>
                <FormField control={form.control} name="bonzoUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Username</FormLabel>
                    <FormControl><Input {...field} data-testid="input-bonzo-username" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="bonzoPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Password</FormLabel>
                    <FormControl><Input type="text" {...field} data-testid="input-bonzo-password" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lead Mailbox Credentials</div>
                <FormField control={form.control} name="leadMailboxUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Username</FormLabel>
                    <FormControl><Input {...field} data-testid="input-mailbox-username" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="leadMailboxPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Password</FormLabel>
                    <FormControl><Input type="text" {...field} data-testid="input-mailbox-password" /></FormControl>
                  </FormItem>
                )} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="priorityTier" render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority Tier</FormLabel>
                  <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))}>
                    <FormControl><SelectTrigger data-testid="select-priority-tier"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="1">Tier 1 — VIP</SelectItem>
                      <SelectItem value="2">Tier 2 — Standard</SelectItem>
                      <SelectItem value="3">Tier 3 — Low</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="boostScore" render={({ field }) => (
                <FormItem>
                  <FormLabel>Boost Score (0–10)</FormLabel>
                  <FormControl><Input type="number" min={0} max={10} step={0.5} {...field} data-testid="input-boost-score" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="internalStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="vacation">🏖 On Vacation</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="snoozeUntil" render={({ field }) => (
                <FormItem>
                  <FormLabel>Snooze Until (date)</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-snooze-until" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="snoozeReason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Snooze Reason</FormLabel>
                  <FormControl><Input {...field} placeholder="On vacation, etc." data-testid="input-snooze-reason" /></FormControl>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} rows={2} data-testid="textarea-notes" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="specialRequests" render={({ field }) => (
              <FormItem>
                <FormLabel>Special Requests</FormLabel>
                <FormControl><Textarea {...field} rows={2} data-testid="textarea-special-requests" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="personalPreferences" render={({ field }) => (
              <FormItem>
                <FormLabel>Personal Preferences</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={3}
                    placeholder="How they like to work — preferred contact times, communication style, file format preferences, lead handoff quirks, etc."
                    data-testid="textarea-personal-preferences"
                  />
                </FormControl>
              </FormItem>
            )} />
            {/* Availability — only when editing existing LO */}
            {initialValues && (initialValues as any).id && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Weekly Availability</span>
                  </div>
                  <LoAvailabilityEditor
                    loId={(initialValues as any).id}
                    loName={(initialValues as any).fullName ?? ""}
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-lo">
                {isPending ? "Saving…" : "Save LO"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Directory page ────────────────────────────────────────────────────────────
export default function Directory() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [tierFilter, setTierFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [confirmDeleteLO, setConfirmDeleteLO] = useState<any | null>(null);

  const { data: los = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });
  const { data: algoSettings } = useQuery<any>({ queryKey: ["/api/settings/algorithm"] });
  const { data: nmlsData } = useQuery<any>({ queryKey: ["/api/nmls-checks"], refetchInterval: 60000 });

  // Build a map of loId -> check for quick lookup
  const nmlsCheckMap: Record<number, any> = {};
  (nmlsData?.checks ?? []).forEach((c: any) => { nmlsCheckMap[c.lo_id] = c; });

  const confirmNmlsMutation = useMutation({
    mutationFn: (loId: number) => apiRequest("POST", `/api/nmls-checks/${loId}/confirm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nmls-checks"] });
      toast({ title: "NMLS verified", description: "License marked as confirmed for this period." });
    },
    onError: () => toast({ title: "Failed to confirm NMLS check", variant: "destructive" }),
  });

  const weights: Weights = algoSettings ?? {
    weightDaysSinceWorked: 0.35,
    weightFrequency: 0.25,
    weightAvailability: 0.20,
    weightBoost: 0.15,
    weightPriorityTier: 0.05,
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/loan-officers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      setDialogOpen(false);
      toast({ title: "Loan officer added" });
    },
    onError: () => toast({ title: "Error saving LO", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/loan-officers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      setDialogOpen(false);
      setEditTarget(null);
      toast({ title: "Loan officer updated" });
    },
    onError: () => toast({ title: "Error updating LO", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/loan-officers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      setConfirmDeleteLO(null);
      toast({ title: "Loan officer archived" });
    },
    onError: () => toast({ title: "Error removing LO", variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/loan-officers/${id}`, { internalStatus: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      toast({ title: "Loan officer restored to active" });
    },
    onError: () => toast({ title: "Error restoring LO", variant: "destructive" }),
  });

  const activeCount = los.filter((lo: any) => lo.internalStatus === "active").length;

  const filtered = los.filter((lo: any) => {
    const matchSearch =
      !search ||
      (lo.fullName ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (lo.nmlsId ?? "").includes(search);
    const matchStatus = statusFilter === "all" || lo.internalStatus === statusFilter;
    const matchTier = tierFilter === "all" || String(lo.priorityTier) === tierFilter;
    return matchSearch && matchStatus && matchTier;
  });

  const handleEdit = (lo: any) => {
    setEditTarget(lo);
    setDialogOpen(true);
  };

  const handleSubmit = (values: any) => {
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">LO Directory</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount} active · {los.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportDialogOpen(true)} data-testid="button-import-csv">
            <Upload className="w-4 h-4 mr-2" />Import CSV
          </Button>
          <Button onClick={() => { setEditTarget(null); setDialogOpen(true); }} data-testid="button-add-lo">
            <Plus className="w-4 h-4 mr-2" />Add LO
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search by name or NMLS…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-lo"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="vacation">🏖 On Vacation</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-36" data-testid="select-filter-tier"><SelectValue placeholder="Tier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="1">Tier 1 — VIP</SelectItem>
            <SelectItem value="2">Tier 2 — Standard</SelectItem>
            <SelectItem value="3">Tier 3 — Low</SelectItem>
          </SelectContent>
        </Select>
        {(search || statusFilter !== "all" || tierFilter !== "all") && (
          <Button variant="ghost" size="sm"
            onClick={() => { setSearch(""); setStatusFilter("active"); setTierFilter("all"); }}>
            Clear filters
          </Button>
        )}
      </div>

      {(search || statusFilter !== "all" || tierFilter !== "all") && (
        <p className="text-sm text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</p>
      )}

      {/* LO list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          {search ? "No loan officers match your search." : "No loan officers yet. Click \"Add LO\" to get started."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((lo: any) => (
            <LOCard
              key={lo.id}
              lo={lo}
              score={lo.internalStatus === "active" ? computeScore(lo, weights) : null}
              onEdit={handleEdit}
              onDelete={id => setConfirmDeleteLO(los.find((l: any) => l.id === id) ?? { id })}
              onRestore={id => restoreMutation.mutate(id)}
              nmlsCheck={nmlsCheckMap[lo.id]}
              onConfirmNmls={loId => confirmNmlsMutation.mutate(loId)}
            />
          ))}
        </div>
      )}

      <LOFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        initialValues={editTarget}
        onSubmit={handleSubmit}
        isPending={isPending}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!confirmDeleteLO} onOpenChange={open => !open && setConfirmDeleteLO(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmDeleteLO?.fullName ?? "this LO"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the loan officer and remove them from active assignments and the leaderboard.
              You can still find them by filtering for "Archived" status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDeleteLO && deleteMutation.mutate(confirmDeleteLO.id)}
            >
              {deleteMutation.isPending ? "Removing…" : "Yes, remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CSV Import */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Loan Officers from CSV</DialogTitle>
          </DialogHeader>
          <LoCsvImport
            onImportComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
