import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, RefreshCw, CheckCircle2, XCircle,
  PhoneOutgoing, AlertCircle, Users, Calendar, Phone, Save,
  Check, ArrowRight, X, MinusCircle, Lock, ShieldAlert, TriangleAlert, Sparkles,
  Star, StickyNote, Sunrise, Sun, Sunset, Clock, GitBranch, ArrowRightLeft,
  TrendingDown, ChevronDown
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { HelpIcon, markStep } from "@/components/onboarding";
import { LoStatusBadge } from "@/components/lo-status-badge";
import { PipelineSopModal } from "@/components/pipeline-sop-modal";

interface LoPref {
  loId: number;
  notes: string;
  preferredTime: "" | "morning" | "afternoon" | "evening";
  isPinned: boolean;
}

type LoPrefMap = Record<number, LoPref>;

interface LoAvailabilityRow {
  loId: number;
  dayOfWeek: number;
  isAvailable: boolean;
  timeSlot: string;
}

const AVAILABILITY_LABEL: Record<string, string> = {
  all: "all day",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

const PREFERRED_TIME_LABEL: Record<string, { label: string; icon: any }> = {
  morning: { label: "Morning", icon: Sunrise },
  afternoon: { label: "Afternoon", icon: Sun },
  evening: { label: "Evening", icon: Sunset },
};

function LoPrefsButton({
  loId,
  pref,
  onSave,
}: {
  loId: number;
  pref: LoPref | undefined;
  onSave: (p: { notes: string; preferredTime: LoPref["preferredTime"]; isPinned: boolean }) => void;
}) {
  const [notes, setNotes] = useState(pref?.notes ?? "");
  const [preferredTime, setPreferredTime] = useState<LoPref["preferredTime"]>(pref?.preferredTime ?? "");
  const [isPinned, setIsPinned] = useState(!!pref?.isPinned);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<string>(JSON.stringify({ n: pref?.notes ?? "", t: pref?.preferredTime ?? "", p: !!pref?.isPinned }));

  // Sync local state when the upstream pref changes (e.g. another tab updates it)
  useEffect(() => {
    const sig = JSON.stringify({ n: pref?.notes ?? "", t: pref?.preferredTime ?? "", p: !!pref?.isPinned });
    if (sig !== lastSentRef.current) {
      setNotes(pref?.notes ?? "");
      setPreferredTime(pref?.preferredTime ?? "");
      setIsPinned(!!pref?.isPinned);
      lastSentRef.current = sig;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pref?.notes, pref?.preferredTime, pref?.isPinned]);

  const scheduleSave = (next: { notes?: string; preferredTime?: LoPref["preferredTime"]; isPinned?: boolean }) => {
    const merged = {
      notes: next.notes !== undefined ? next.notes : notes,
      preferredTime: next.preferredTime !== undefined ? next.preferredTime : preferredTime,
      isPinned: next.isPinned !== undefined ? next.isPinned : isPinned,
    };
    const sig = JSON.stringify({ n: merged.notes, t: merged.preferredTime, p: merged.isPinned });
    if (sig === lastSentRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastSentRef.current = sig;
      onSave(merged);
    }, 500);
  };

  const hasAny = !!(pref?.notes || pref?.preferredTime || pref?.isPinned);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Edit LO preferences"
          className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
            pref?.isPinned
              ? "text-yellow-500 hover:bg-yellow-100/40"
              : hasAny
              ? "text-teal-600 hover:bg-teal-100/40"
              : "text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          }`}
          data-testid={`button-prefs-${loId}`}
          onClick={e => e.stopPropagation()}
        >
          {pref?.isPinned ? <Star className="w-4 h-4 fill-current" /> : <StickyNote className="w-4 h-4" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-3" align="end" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">LO Preferences</p>
          <button
            type="button"
            onClick={() => {
              const next = !isPinned;
              setIsPinned(next);
              scheduleSave({ isPinned: next });
            }}
            className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
              isPinned ? "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/30" : "text-muted-foreground hover:bg-muted"
            }`}
            data-testid={`toggle-pin-${loId}`}
          >
            <Star className={`w-3.5 h-3.5 ${isPinned ? "fill-current" : ""}`} />
            {isPinned ? "Pinned" : "Pin"}
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Notes</label>
          <Textarea
            value={notes}
            onChange={e => {
              setNotes(e.target.value);
              scheduleSave({ notes: e.target.value });
            }}
            placeholder="e.g. call before 10am, ask for Lisa"
            rows={3}
            className="text-xs"
            data-testid={`textarea-prefs-notes-${loId}`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Preferred time</label>
          <Select
            value={preferredTime || "any"}
            onValueChange={v => {
              const next = (v === "any" ? "" : v) as LoPref["preferredTime"];
              setPreferredTime(next);
              scheduleSave({ preferredTime: next });
            }}
          >
            <SelectTrigger className="h-8 text-xs" data-testid={`select-prefs-time-${loId}`}>
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="morning">Morning</SelectItem>
              <SelectItem value="afternoon">Afternoon</SelectItem>
              <SelectItem value="evening">Evening</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-[10px] text-muted-foreground italic">Saved automatically.</p>
      </PopoverContent>
    </Popover>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  recommended: { label: "Recommended", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", icon: AlertCircle },
  worked: { label: "Worked", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", icon: CheckCircle2 },
  skipped: { label: "Skipped", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", icon: XCircle },
  attempted: { label: "Attempted", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300", icon: PhoneOutgoing },
  manual: { label: "Manual", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300", icon: AlertCircle },
};

function formatDate(d: Date) {
  return d.toISOString().split("T")[0];
}

function dateLabel(dateStr: string) {
  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 86400000));
  const tomorrow = formatDate(new Date(Date.now() + 86400000));
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  if (dateStr === tomorrow) return "Tomorrow";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

interface StatusDialogProps {
  open: boolean;
  assignment: any;
  onClose: () => void;
  onConfirm: (status: string, notes: string) => void;
  isPending: boolean;
}

function StatusDialog({ open, assignment, onClose, onConfirm, isPending }: StatusDialogProps) {
  const [notes, setNotes] = useState("");
  if (!assignment) return null;

  const actions = [
    { status: "worked", label: "Worked", icon: CheckCircle2, color: "default" as const, description: "Successfully worked this LO today" },
    { status: "attempted", label: "Attempted", icon: PhoneOutgoing, color: "outline" as const, description: "Tried but didn't reach / complete" },
    { status: "skipped", label: "Skip", icon: XCircle, color: "destructive" as const, description: "Skipping this LO today" },
  ];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log EOD Status</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <p className="font-medium flex items-center gap-2">
              {assignment.lo?.fullName}
              <LoStatusBadge status={assignment.lo?.internalStatus} hideWhenActive />
            </p>
            <p className="text-muted-foreground text-xs">{assignment.lo?.nmlsId ? `NMLS ${assignment.lo.nmlsId} · ` : ""}Assigned to {assignment.assistant?.name}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {actions.map(({ status, label, icon: Icon, description }) => (
              <button
                key={status}
                onClick={() => onConfirm(status, notes)}
                disabled={isPending}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-sm font-medium transition-colors hover:bg-muted
                  ${assignment.status === status ? "border-primary bg-primary/5" : "border-border"}`}
                data-testid={`button-status-${status}-${assignment.id}`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this LO today…"
              rows={2}
              data-testid="textarea-assignment-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReassignTarget {
  id: number;
  name: string;
}

interface AssignmentRowProps {
  assignment: any;
  onLogStatus: (a: any) => void;
  isSelected: boolean;
  onToggle: (id: number) => void;
  isTopUnworked?: boolean;
  pref?: LoPref;
  onSavePref?: (loId: number, p: { notes: string; preferredTime: LoPref["preferredTime"]; isPinned: boolean }) => void;
  todayAvailabilitySlot?: string;
  reassignTargets?: ReassignTarget[];
  onReassign?: (assignmentId: number, assistantId: number) => void;
  nextLoa?: { fullName: string; daysSinceLastTransfer: number | null } | null;
}

function AssignmentRow({ assignment, onLogStatus, isSelected, onToggle, isTopUnworked, pref, onSavePref, todayAvailabilitySlot, reassignTargets, onReassign, nextLoa }: AssignmentRowProps) {
  const cfg = STATUS_CONFIG[assignment.status] ?? STATUS_CONFIG.recommended;
  const Icon = cfg.icon;
  const timeBadge = pref?.preferredTime ? PREFERRED_TIME_LABEL[pref.preferredTime] : null;
  const notesText = pref?.notes?.trim() ?? "";
  const hasNotes = !!notesText;
  // Unified "Notes & Requests" recorded on the LO (shared across all CLRs).
  // A big chunk of text — multiple lines or a long paragraph — surfaces a loud
  // red warning so callers do not miss important handling instructions.
  const loNotes = (assignment.lo?.notes ?? "").trim();
  const hasLoNotes = !!loNotes;
  const loNotesLineCount = hasLoNotes ? loNotes.split(/\r?\n/).filter((l: string) => l.trim().length > 0).length : 0;
  const loNotesIsBig = hasLoNotes && (loNotesLineCount > 1 || loNotes.length > 180);
  const availabilityLabel = todayAvailabilitySlot ? (AVAILABILITY_LABEL[todayAvailabilitySlot] ?? todayAvailabilitySlot) : "";

  return (
    <div
      className={`flex items-center gap-3 py-3 px-4 border-b last:border-0 hover:bg-muted/30 transition-colors group ${isSelected ? "bg-teal-50/60 dark:bg-teal-900/10" : isTopUnworked ? "bg-amber-50/50 dark:bg-amber-900/10 border-l-4 border-l-amber-400" : ""}`}
      data-testid={`row-assignment-${assignment.id}`}
    >
      <div className="flex-shrink-0 flex items-center">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggle(assignment.id)}
          data-testid={`checkbox-assignment-${assignment.id}`}
          aria-label={`Select ${assignment.lo?.fullName}`}
        />
      </div>
      <div className="text-xs font-mono text-muted-foreground w-6 text-right flex-shrink-0">
        #{assignment.assistantRank}
      </div>
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-primary">
        {(assignment.lo?.fullName ?? "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" data-testid={`text-assignment-lo-${assignment.id}`}>{assignment.lo?.fullName}</span>
          {isTopUnworked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-semibold flex items-center gap-1" title="Start your day with #1 — work the list top to bottom">
              <Sparkles className="w-3 h-3" />Start here
            </span>
          )}
          {assignment.lo?.priorityTier === 1 && (
            <span className="text-[10px] px-1 py-0 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 font-medium">VIP</span>
          )}
          {assignment.leadSource && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300 font-medium"
              title={assignment.leadSource.notes || `Lead source: ${assignment.leadSource.name}`}
              data-testid={`lead-source-${assignment.id}`}
            >
              {assignment.leadSource.name}
            </span>
          )}
          {pref?.isPinned && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 font-semibold flex items-center gap-1" title="Pinned to top of your list">
              <Star className="w-3 h-3 fill-current" />Pinned
            </span>
          )}
          {timeBadge && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300 font-medium flex items-center gap-1"
              title={`Preferred contact time: ${timeBadge.label}`}
            >
              <timeBadge.icon className="w-3 h-3" />{timeBadge.label}
            </span>
          )}
          <LoStatusBadge status={assignment.lo?.internalStatus} hideWhenActive />
          {nextLoa && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300 font-semibold flex items-center gap-1"
              title={`This LO has assistants — ${nextLoa.fullName} is next in line for a transfer${nextLoa.daysSinceLastTransfer == null ? " (no transfers yet)" : ` (last ${nextLoa.daysSinceLastTransfer}d ago)`}. Updates automatically as transfers are logged.`}
              data-testid={`next-loa-${assignment.id}`}
            >
              <ArrowRightLeft className="w-3 h-3" />LOA up: {nextLoa.fullName}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>
            {assignment.lo?.nmlsId ? `NMLS ${assignment.lo.nmlsId}` : ""}
            {assignment.lo?.phone && `${assignment.lo?.nmlsId ? " · " : ""}${assignment.lo.phone}`}
          </span>
          {availabilityLabel && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
              title={`Today's availability: ${availabilityLabel}`}
              data-testid={`text-availability-${assignment.id}`}
            >
              <Clock className="w-3 h-3" />Today: {availabilityLabel}
            </span>
          )}
          {assignment.notes && <span className="italic">"{assignment.notes}"</span>}
        </div>
        {hasNotes && (
          <div
            className="text-xs text-muted-foreground italic flex items-start gap-1 mt-0.5 line-clamp-2"
            title={notesText}
            data-testid={`text-prefs-notes-${assignment.id}`}
          >
            <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span className="line-clamp-2">{notesText}</span>
          </div>
        )}
        {/* Lead-source notes: per-source calling context set on the Lead Sources page */}
        {assignment.leadSource?.notes && (
          <div
            className="text-xs text-violet-700 dark:text-violet-300 flex items-start gap-1 mt-0.5"
            title={assignment.leadSource.notes}
            data-testid={`text-lead-source-notes-${assignment.id}`}
          >
            <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span className="line-clamp-2">{assignment.leadSource.name}: {assignment.leadSource.notes}</span>
          </div>
        )}
        {/* Shared LO Notes & Requests. Short ones show inline; big chunks of
            text get a loud red warning so callers read them before dialing. */}
        {hasLoNotes && !loNotesIsBig && (
          <div
            className="text-xs text-foreground flex items-start gap-1 mt-0.5"
            title={loNotes}
            data-testid={`text-lo-notes-${assignment.id}`}
          >
            <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-600" />
            <span className="whitespace-pre-wrap">{loNotes}</span>
          </div>
        )}
        {hasLoNotes && loNotesIsBig && (
          <div
            className="mt-1 rounded-md border-2 border-red-500 bg-red-50 dark:bg-red-950/40 px-2.5 py-1.5"
            data-testid={`warn-lo-notes-${assignment.id}`}
          >
            <div className="flex items-center gap-1.5 text-red-700 dark:text-red-300 font-bold text-xs uppercase tracking-wide">
              <TriangleAlert className="w-4 h-4 flex-shrink-0" />
              Read notes before calling
            </div>
            <p className="text-xs text-red-900 dark:text-red-100 whitespace-pre-wrap mt-1">{loNotes}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {onSavePref && (
          <LoPrefsButton
            loId={assignment.lo?.id ?? assignment.loId}
            pref={pref}
            onSave={p => onSavePref(assignment.lo?.id ?? assignment.loId, p)}
          />
        )}
        <Badge className={`text-xs px-2 py-0.5 ${cfg.color} flex items-center gap-1`}>
          <Icon className="w-3 h-3" />{cfg.label}
        </Badge>
        {onReassign && reassignTargets && reassignTargets.length > 0 && (
          <Select value="" onValueChange={v => onReassign(assignment.id, Number(v))}>
            <SelectTrigger
              className="h-7 w-auto gap-1 px-2 text-xs opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity"
              title="Move this lead to another CLR"
              data-testid={`select-reassign-${assignment.id}`}
            >
              <ArrowRightLeft className="w-3 h-3" />
              <span className="hidden sm:inline">Move</span>
            </SelectTrigger>
            <SelectContent align="end">
              {reassignTargets.map(t => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onLogStatus(assignment)}
          data-testid={`button-log-assignment-${assignment.id}`}
        >
          Log
        </Button>
      </div>
    </div>
  );
}

interface AssistantGroupProps {
  name: string;
  assignments: any[];
  onLogStatus: (a: any) => void;
  selectedIds: Set<number>;
  onToggleSelect: (id: number) => void;
  onSelectGroup: (ids: number[]) => void;
  onDeselectGroup: (ids: number[]) => void;
  loPrefs?: LoPrefMap;
  onSavePref?: (loId: number, p: { notes: string; preferredTime: LoPref["preferredTime"]; isPinned: boolean }) => void;
  todayAvailability?: Record<number, string>;
  reassignTargets?: ReassignTarget[];
  onReassign?: (assignmentId: number, assistantId: number) => void;
  nextLoaByLo?: Record<number, { fullName: string; daysSinceLastTransfer: number | null }>;
  leadSources?: { id: number; name: string; notes: string; ownerId?: number | null }[];
}

function AssistantGroup({
  name,
  assignments,
  onLogStatus,
  selectedIds,
  onToggleSelect,
  onSelectGroup,
  onDeselectGroup,
  loPrefs,
  onSavePref,
  todayAvailability,
  reassignTargets,
  onReassign,
  nextLoaByLo,
  leadSources,
}: AssistantGroupProps) {
  const worked = assignments.filter(a => a.status === "worked").length;
  const total = assignments.length;
  const groupIds = assignments.map(a => a.id);
  const allSelected = groupIds.length > 0 && groupIds.every(id => selectedIds.has(id));
  const someSelected = groupIds.some(id => selectedIds.has(id));

  const handleGroupCheckbox = () => {
    if (allSelected) {
      onDeselectGroup(groupIds);
    } else {
      onSelectGroup(groupIds);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-0 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={handleGroupCheckbox}
              data-testid={`checkbox-group-${name}`}
              aria-label={`Select all assignments for ${name}`}
            />
            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
              {name.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
            </div>
            {name}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{worked}/{total} logged</span>
            <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${total ? (worked / total) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 mt-2">
        {/* Lead sources this CLR owns today — prioritized above their LO list;
            a standing instruction they work and log in Input Results. */}
        {(leadSources?.length ?? 0) > 0 && (
          <div className="border-b bg-violet-50/60 dark:bg-violet-950/20 px-4 py-2.5 space-y-1.5">
            {leadSources!.map((s) => (
              <div key={s.id} className="flex items-start gap-2" data-testid={`group-source-${s.id}`}>
                <ArrowRightLeft className="w-3.5 h-3.5 mt-0.5 text-violet-600 dark:text-violet-400 shrink-0" />
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-violet-900 dark:text-violet-200">{s.name}</span>
                  {s.notes && <span className="text-xs text-violet-800/90 dark:text-violet-300/90"> — {s.notes}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {(() => {
          // First unworked row gets the "Start here" highlight
          const firstUnworkedId = assignments.find(a => a.status === "recommended")?.id;
          return assignments.map(a => {
            const loId = a.lo?.id ?? a.loId;
            return (
              <AssignmentRow
                key={a.id}
                assignment={a}
                onLogStatus={onLogStatus}
                isSelected={selectedIds.has(a.id)}
                onToggle={onToggleSelect}
                isTopUnworked={a.id === firstUnworkedId}
                pref={loPrefs?.[loId]}
                onSavePref={onSavePref}
                todayAvailabilitySlot={todayAvailability?.[loId]}
                reassignTargets={reassignTargets?.filter(t => t.id !== (a.assistantId ?? a.assistant_id))}
                onReassign={onReassign}
                nextLoa={nextLoaByLo?.[loId]}
              />
            );
          });
        })()}
      </CardContent>
    </Card>
  );
}

interface BulkActionBarProps {
  selectedCount: number;
  onMarkStatus: (status: string) => void;
  onDeselectAll: () => void;
  isBusy: boolean;
  reassignTargets?: ReassignTarget[];
  onReassign?: (assistantId: number) => void;
}

function BulkActionBar({ selectedCount, onMarkStatus, onDeselectAll, isBusy, reassignTargets, onReassign }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-2xl border border-white/10"
      style={{ background: "linear-gradient(135deg, #134e4a 0%, #0f766e 100%)" }}
      data-testid="bulk-action-bar"
    >
      <span className="text-white text-sm font-semibold pr-2 border-r border-white/20 mr-1">
        {selectedCount} selected
      </span>

      {/* Mark Worked */}
      <button
        onClick={() => onMarkStatus("worked")}
        disabled={isBusy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors disabled:opacity-50"
        data-testid="bulk-action-worked"
        title="Mark Worked"
      >
        <Check className="w-3.5 h-3.5" />
        <span>Worked</span>
      </button>

      {/* Mark Attempted */}
      <button
        onClick={() => onMarkStatus("attempted")}
        disabled={isBusy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors disabled:opacity-50"
        data-testid="bulk-action-attempted"
        title="Mark Attempted"
      >
        <MinusCircle className="w-3.5 h-3.5" />
        <span>Attempted</span>
      </button>

      {/* Mark Skipped */}
      <button
        onClick={() => onMarkStatus("skipped")}
        disabled={isBusy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors disabled:opacity-50"
        data-testid="bulk-action-skipped"
        title="Mark Skipped"
      >
        <ArrowRight className="w-3.5 h-3.5" />
        <span>Skipped</span>
      </button>

      {/* Reassign to another CLR (admins + managers only) */}
      {onReassign && reassignTargets && reassignTargets.length > 0 && (
        <>
          <div className="w-px h-5 bg-white/20 mx-0.5" />
          <Select value="" onValueChange={v => onReassign(Number(v))} disabled={isBusy}>
            <SelectTrigger
              className="h-8 w-auto rounded-full bg-white/10 hover:bg-white/20 border-white/20 text-white text-xs font-medium px-3 gap-1.5 focus:ring-0 focus:ring-offset-0 disabled:opacity-50"
              data-testid="bulk-action-reassign"
              title="Reassign selected leads to another CLR"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Reassign to…</span>
            </SelectTrigger>
            <SelectContent>
              {reassignTargets.map(t => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      <div className="w-px h-5 bg-white/20 mx-0.5" />

      {/* Deselect All */}
      <button
        onClick={onDeselectAll}
        disabled={isBusy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-red-500/60 text-white text-xs font-medium transition-colors disabled:opacity-50"
        data-testid="bulk-action-deselect"
        title="Deselect All"
      >
        <X className="w-3.5 h-3.5" />
        <span>Deselect All</span>
      </button>
    </div>
  );
}

// ── Admin Override Dialog ────────────────────────────────────────────────────────
// Three steps: 1) Reason entry  2) "I understand" confirm  3) Final type-to-confirm
const CONFIRM_PHRASE = "REGENERATE";

function AdminRegenerateDialog({
  open, onClose, onSuccess
}: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState("");
  const [typeConfirm, setTypeConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  function reset() {
    setStep(1);
    setReason("");
    setTypeConfirm("");
    setLoading(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (typeConfirm.trim().toUpperCase() !== CONFIRM_PHRASE) return;
    setLoading(true);
    try {
      await apiRequest("POST", "/api/assignments/regenerate-override", { reason });
      toast({ title: "Assignments regenerated", description: `Override logged. Reason: ${reason}` });
      reset();
      onSuccess();
    } catch (e: any) {
      toast({ title: "Override failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const today = formatDate(new Date());

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="w-5 h-5" />
            Admin Override — Regenerate Assignments
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-1">
          {[1, 2, 3].map(s => (
            <div key={s} className={`flex items-center gap-2 ${ s < 3 ? "flex-1" : "" }`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                step > s ? "bg-destructive text-white" :
                step === s ? "bg-destructive/10 text-destructive border-2 border-destructive" :
                "bg-muted text-muted-foreground"
              }`}>{step > s ? <Check className="w-3 h-3" /> : s}</div>
              {s < 3 && <div className={`h-px flex-1 transition-colors ${step > s ? "bg-destructive" : "bg-border"}`} />}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mb-4 px-0">
          <span>Reason</span>
          <span className="ml-6">Acknowledge</span>
          <span>Confirm</span>
        </div>

        {/* Step 1: Reason */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300 flex gap-2">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>This will <strong>wipe and regenerate</strong> all of today's ({today}) assignments. This action is permanent and will be recorded in the audit log.</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason for override <span className="text-destructive">*</span></label>
              <Textarea
                ref={reasonRef}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Describe why today's assignments need to be regenerated..."
                className="min-h-[90px] resize-none"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">{reason.trim().length}/10 characters minimum</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={reason.trim().length < 10}
                onClick={() => setStep(2)}
              >Next</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Acknowledge consequences */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-destructive">By proceeding, you confirm:</p>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-none">
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-destructive shrink-0 mt-0.5" />All existing assignments for today will be permanently deleted</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-destructive shrink-0 mt-0.5" />A new set will be generated fresh from the algorithm</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-destructive shrink-0 mt-0.5" />Your name, reason, and timestamp will be recorded in the audit log</li>
                <li className="flex items-start gap-2"><Check className="w-4 h-4 text-destructive shrink-0 mt-0.5" />All team members will be notified</li>
              </ul>
            </div>
            <div className="rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium">Logged reason:</span> {reason}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button variant="destructive" onClick={() => setStep(3)}>I Understand, Continue</Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Type-to-confirm */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm">Type <span className="font-mono font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">{CONFIRM_PHRASE}</span> to confirm the override:</p>
              <Input
                value={typeConfirm}
                onChange={e => setTypeConfirm(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                className={`font-mono ${
                  typeConfirm.length > 0 && typeConfirm.toUpperCase() !== CONFIRM_PHRASE
                    ? "border-destructive focus-visible:ring-destructive"
                    : typeConfirm.toUpperCase() === CONFIRM_PHRASE
                    ? "border-green-500 focus-visible:ring-green-500"
                    : ""
                }`}
                autoFocus
                onKeyDown={e => e.key === "Enter" && typeConfirm.toUpperCase() === CONFIRM_PHRASE && !loading && handleSubmit()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)} disabled={loading}>Back</Button>
              <Button
                variant="destructive"
                disabled={typeConfirm.trim().toUpperCase() !== CONFIRM_PHRASE || loading}
                onClick={handleSubmit}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Regenerating..." : "Regenerate Now"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PreConfigureDialogProps {
  open: boolean;
  date: string;
  existing: any[];
  assistants: any[];
  onClose: () => void;
  onSuccess: () => void;
}

function PreConfigureDialog({ open, date, existing, assistants, onClose, onSuccess }: PreConfigureDialogProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<Array<{ loId: number; assistantId: number }>>([]);
  const [selectedLoId, setSelectedLoId] = useState<string>("");
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: los = [] } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setItems(
      existing.map((a: any) => ({ loId: a.loId, assistantId: a.assistantId }))
    );
    setSelectedLoId("");
    setSelectedAssistantId(assistants[0]?.id ? String(assistants[0].id) : "");
  }, [open, existing, assistants]);

  const loById = new Map<number, any>();
  for (const lo of los as any[]) loById.set(lo.id, lo);
  const userById = new Map<number, any>();
  for (const u of assistants) userById.set(u.id, u);

  const addItem = () => {
    const lid = Number(selectedLoId);
    const aid = Number(selectedAssistantId);
    if (!lid || !aid) return;
    if (items.some(it => it.loId === lid)) {
      toast({ title: "LO already added", variant: "destructive" });
      return;
    }
    setItems(prev => [...prev, { loId: lid, assistantId: aid }]);
    setSelectedLoId("");
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const moveItem = (idx: number, delta: number) => {
    setItems(prev => {
      const next = [...prev];
      const newIdx = idx + delta;
      if (newIdx < 0 || newIdx >= next.length) return prev;
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    if (items.length === 0) {
      toast({ title: "Add at least one LO before saving", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiRequest("POST", "/api/assignments/pre-configure", { date, items });
      toast({ title: "Pre-configured assignments saved" });
      onSuccess();
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message ?? "Error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <ShieldAlert className="w-5 h-5" />
            Pre-configure Assignments — {date}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
            Saving will mark this date as <strong>manually configured</strong> and the auto-generation cron will skip it.
          </div>

          {/* Add row */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <select
              value={selectedLoId}
              onChange={e => setSelectedLoId(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm bg-background"
            >
              <option value="">Pick a Loan Officer…</option>
              {(los as any[])
                .filter((lo: any) => !items.some(it => it.loId === lo.id))
                .map((lo: any) => (
                  <option key={lo.id} value={lo.id}>
                    {lo.fullName ?? lo.full_name}
                  </option>
                ))}
            </select>
            <select
              value={selectedAssistantId}
              onChange={e => setSelectedAssistantId(e.target.value)}
              className="border rounded px-2 py-1.5 text-sm bg-background"
            >
              <option value="">Pick a CLR…</option>
              {assistants.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={addItem} disabled={!selectedLoId || !selectedAssistantId}>
              Add
            </Button>
          </div>

          {/* Items list */}
          <div className="border rounded-lg max-h-80 overflow-auto">
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No LOs added yet</p>
            ) : (
              items.map((it, idx) => {
                const lo = loById.get(it.loId);
                const assistant = userById.get(it.assistantId);
                return (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2 border-b last:border-0">
                    <span className="text-xs font-mono text-muted-foreground w-6">#{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {lo?.fullName ?? lo?.full_name ?? `LO #${it.loId}`}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        → {assistant?.name ?? `CLR #${it.assistantId}`}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveItem(idx, -1)} disabled={idx === 0}>
                      <ChevronLeft className="w-3.5 h-3.5 rotate-90" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1}>
                      <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || items.length === 0}>
            {saving ? "Saving…" : `Save ${items.length} Assignment${items.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One-line strip: active LOs with the FEWEST transfers over the last 5
// working days (least first). Collapsed it's a single row with the coldest
// names inline; clicking expands the full chip grid.
function TransferLullsCard() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<{ days: number; window: string[]; los: { id: number; name: string; transfers: number; priorityTier: number | null }[] }>({
    queryKey: ["/api/assignments/transfer-lulls"],
    queryFn: () => apiRequest("GET", "/api/assignments/transfer-lulls?days=5"),
  });
  const los = data?.los ?? [];
  if (los.length === 0) return null;
  const inline = los.slice(0, 6);

  return (
    <Card className="border-sky-200 dark:border-sky-800">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left overflow-hidden"
        data-testid="transfer-lulls-toggle"
        aria-expanded={open}
        title="Fewest transfers over the last 5 working days — push transfers toward these LOs"
      >
        <TrendingDown className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
        <span className="text-sm font-semibold shrink-0">Cold LOs (5d):</span>
        <span className="text-sm text-muted-foreground truncate min-w-0">
          {inline.map((lo, i) => (
            <span key={lo.id}>
              {i > 0 && " · "}
              {lo.name} <span className={`tabular-nums font-medium ${lo.transfers === 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>{lo.transfers}</span>
            </span>
          ))}
          {los.length > inline.length && ` · +${los.length - inline.length} more`}
        </span>
        <ChevronDown className={`w-4 h-4 ml-auto shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <CardContent className="pt-0 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {los.map((lo) => (
              <div key={lo.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" data-testid={`lull-lo-${lo.id}`}>
                <span className="text-sm truncate flex-1">{lo.name}</span>
                {lo.priorityTier === 1 && <span className="text-[9px] px-1 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 font-medium">VIP</span>}
                <Badge variant="outline" className={`font-normal tabular-nums ${lo.transfers === 0 ? "text-red-600 dark:text-red-400 border-red-300 dark:border-red-800" : ""}`}>
                  {lo.transfers} transfer{lo.transfers === 1 ? "" : "s"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function Assignments() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [currentDate, setCurrentDate] = useState(formatDate(new Date()));
  const [statusDialog, setStatusDialog] = useState<any>(null);
  const [callInputs, setCallInputs] = useState<Record<number, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkPending, setIsBulkPending] = useState(false);
  const [generateLocked, setGenerateLocked] = useState(false);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [showPreConfigureDialog, setShowPreConfigureDialog] = useState(false);
  const [showPipelineGuide, setShowPipelineGuide] = useState(false);

  const { data: assignments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/assignments", currentDate],
    queryFn: () => apiRequest("GET", `/api/assignments?date=${currentDate}`),
  });

  // Lead-source instruction cards for the selected date (deterministic per
  // day — a 33% source shows on the same ~1/3 of days for everyone).
  const { data: sourceCards } = useQuery<{ date: string; sources: { id: number; name: string; notes: string; ownerId: number | null }[] }>({
    queryKey: ["/api/lead-sources/today", currentDate],
    queryFn: () => apiRequest("GET", `/api/lead-sources/today?date=${currentDate}`),
  });

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  // LOA transfer queue — for LOs that have assistants, which one is next in line.
  // Polls every 60s so it stays current as transfers are logged through the day.
  const { data: loaQueue = [] } = useQuery<any[]>({
    queryKey: ["/api/loan-officer-assistants/queue"],
    queryFn: () => apiRequest("GET", "/api/loan-officer-assistants/queue"),
    refetchInterval: 60000,
  });
  // The queue is sorted most-needy-first, so the first entry per LO is the
  // assistant currently "due" a transfer for that LO.
  const nextLoaByLo = useMemo(() => {
    const map: Record<number, { fullName: string; daysSinceLastTransfer: number | null }> = {};
    for (const e of loaQueue as any[]) {
      if (e?.loId != null && !map[e.loId]) map[e.loId] = { fullName: e.fullName, daysSinceLastTransfer: e.daysSinceLastTransfer ?? null };
    }
    return map;
  }, [loaQueue]);

  const { data: callLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/call-logs", currentDate],
    queryFn: () => apiRequest("GET", `/api/call-logs?date=${currentDate}`),
  });

  // ── LO preferences (per CLR-user) — pinned LOs float to top, plus notes/time
  const { data: loPrefsList = [] } = useQuery<LoPref[]>({
    queryKey: ["/api/lo-preferences"],
    queryFn: () => apiRequest("GET", "/api/lo-preferences"),
  });

  const loPrefs: LoPrefMap = useMemo(() => {
    const map: LoPrefMap = {};
    for (const p of loPrefsList) {
      if (p && typeof p.loId === "number") map[p.loId] = p;
    }
    return map;
  }, [loPrefsList]);

  // ── LO availability (weekly schedule) — used to show today's slot inline
  const { data: loAvailabilityList = [] } = useQuery<LoAvailabilityRow[]>({
    queryKey: ["/api/lo-availability"],
    queryFn: () => apiRequest("GET", "/api/lo-availability"),
  });

  const todayAvailability: Record<number, string> = useMemo(() => {
    const map: Record<number, string> = {};
    const today = new Date(currentDate + "T00:00:00").getDay();
    for (const r of loAvailabilityList) {
      if (!r || typeof r.loId !== "number") continue;
      if (r.dayOfWeek !== today) continue;
      if (!r.isAvailable) continue;
      map[r.loId] = r.timeSlot || "all";
    }
    return map;
  }, [loAvailabilityList, currentDate]);

  const savePrefMutation = useMutation({
    mutationFn: ({ loId, body }: { loId: number; body: { notes: string; preferredTime: LoPref["preferredTime"]; isPinned: boolean } }) =>
      apiRequest("PUT", `/api/lo-preferences/${loId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lo-preferences"] });
    },
    onError: () => toast({ title: "Couldn't save preference", variant: "destructive" }),
  });

  const handleSavePref = (loId: number, body: { notes: string; preferredTime: LoPref["preferredTime"]; isPinned: boolean }) => {
    if (!loId) return;
    savePrefMutation.mutate({ loId, body });
  };

  const saveCallLogMutation = useMutation({
    mutationFn: ({ assistantId, callsMade }: { assistantId: number; callsMade: number }) =>
      apiRequest("POST", "/api/call-logs", { logDate: currentDate, assistantId, callsMade }),
    onSuccess: (_, { assistantId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs", currentDate] });
      const name = (users as any[]).find(u => u.id === assistantId)?.name ?? "CLR";
      toast({ title: `Calls logged for ${name}` });
    },
    onError: () => toast({ title: "Error saving call count", variant: "destructive" }),
  });

  // When assignments are loaded for today, auto-lock the generate button
  const today = formatDate(new Date());
  const isAdmin = user?.role === "admin";
  const isPastDate = currentDate < today;
  const isToday = currentDate === today;
  const isFutureDate = currentDate > today;
  const alreadyGenerated = isToday && (assignments as any[]).length > 0;
  const isManuallyConfigured = (assignments as any[]).some((a: any) => a.manuallyConfigured);

  const [clrsMissingEod, setClrsMissingEod] = useState<string[]>([]);

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/assignments/generate", { date: currentDate }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments", currentDate] });
      const missing: string[] = data?.clrsMissingEod ?? [];
      setClrsMissingEod(missing);
      if (missing.length > 0) {
        toast({
          title: "Assignments generated",
          description: `Note: ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} not submitted their EOD report for ${prevWeekdayStr(currentDate)}.`,
          variant: "default",
        });
      } else {
        toast({ title: "Assignments generated" });
      }
    },
    onError: (err: any) => {
      const msg: string = err?.message ?? "";
      if (msg.toLowerCase().includes("eod report")) {
        toast({
          title: "EOD report required",
          description: msg,
          variant: "destructive",
        });
      } else if (msg.includes("locked") || msg.includes("already been generated")) {
        setGenerateLocked(true);
        toast({ title: "Already generated today", description: "Assignments are locked until tomorrow.", variant: "destructive" });
      } else {
        toast({ title: "Error generating assignments", description: msg, variant: "destructive" });
      }
    },
  });

  // Helper: previous weekday string from a YYYY-MM-DD date
  function prevWeekdayStr(fromDate: string): string {
    const d = new Date(fromDate + "T12:00:00Z");
    do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().split("T")[0];
  }

  const updateMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes: string }) =>
      apiRequest("PATCH", `/api/assignments/${id}`, { status, notes: notes || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments", currentDate] });
      setStatusDialog(null);
      toast({ title: "Assignment updated" });
    },
    onError: () => toast({ title: "Error updating assignment", variant: "destructive" }),
  });

  // ── Reassign leads to another CLR (admins + managers) ──────────────────────
  const canReassign = !!(user && (user.role === "admin" || (user as any).isManager || (user as any).superAdmin));

  const reassignTargets: { id: number; name: string }[] = useMemo(() => {
    if (!canReassign) return [];
    return (users as any[])
      .filter(u =>
        (u.isActive ?? u.is_active) &&
        (u.role === "assistant" || (u.role === "admin" && (u.isClr ?? u.is_clr)))
      )
      .map(u => ({ id: u.id, name: u.name }));
  }, [users, canReassign]);

  const reassignMutation = useMutation({
    mutationFn: ({ ids, assistantId }: { ids: number[]; assistantId: number }) =>
      apiRequest("POST", "/api/assignments/reassign", { ids, assistantId }),
    onSuccess: (data: any, { ids, assistantId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments", currentDate] });
      setSelectedIds(new Set());
      const moved = data?.moved ?? ids.length;
      const name = (users as any[]).find(u => u.id === assistantId)?.name ?? "CLR";
      toast({ title: `${moved} lead${moved === 1 ? "" : "s"} moved to ${name}` });
    },
    onError: (e: any) =>
      toast({ title: "Reassign failed", description: e?.message ?? "Unknown error", variant: "destructive" }),
  });

  const handleRowReassign = (assignmentId: number, assistantId: number) =>
    reassignMutation.mutate({ ids: [assignmentId], assistantId });

  const handleBulkReassign = (assistantId: number) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    reassignMutation.mutate({ ids, assistantId });
  };

  const handleDateChange = (delta: number) => {
    const d = new Date(currentDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    const next = formatDate(d);
    if (!isAdmin && next !== today) {
      toast({ title: "Only admins can navigate to other dates", variant: "destructive" });
      return;
    }
    setCurrentDate(next);
    setSelectedIds(new Set());
  };

  // Checkbox selection handlers
  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectGroup = (ids: number[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });
  };

  const handleDeselectGroup = (ids: number[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set((assignments as any[]).map((a: any) => a.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  // Bulk status update
  const handleBulkMarkStatus = async (status: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsBulkPending(true);
    try {
      await Promise.all(
        ids.map(id => apiRequest("PATCH", `/api/assignments/${id}`, { status }))
      );
      queryClient.invalidateQueries({ queryKey: ["/api/assignments", currentDate] });
      setSelectedIds(new Set());
      toast({ title: `${ids.length} assignment${ids.length !== 1 ? "s" : ""} marked as ${status}` });
    } catch {
      toast({ title: "Error updating assignments", variant: "destructive" });
    } finally {
      setIsBulkPending(false);
    }
  };

  // Group by assistant
  const assistants = users.filter((u: any) => u.role === "assistant" || u.role === "admin");
  const byAssistant: Record<number, any[]> = {};
  assignments.forEach((a: any) => {
    if (!byAssistant[a.assistantId]) byAssistant[a.assistantId] = [];
    byAssistant[a.assistantId].push(a);
  });

  const totalWorked = assignments.filter((a: any) => a.status === "worked").length;
  const totalAttempted = assignments.filter((a: any) => a.status === "attempted").length;

  useEffect(() => { markStep(user?.id, "view_assignments"); }, [user?.id]);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 max-w-[1400px] mx-auto">
      {showPipelineGuide && <PipelineSopModal onClose={() => setShowPipelineGuide(false)} />}
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            Daily Assignments
            <HelpIcon title="Daily Assignments">
              View your daily LO assignments. Generated once per day — contact an admin if there's an error.
            </HelpIcon>
          </h1>
          <p className="text-sm text-muted-foreground">
            {assignments.length} LOs assigned · {totalWorked} worked · {totalAttempted} attempted
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Pipeline stage guide */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setShowPipelineGuide(true)}
            data-testid="button-pipeline-guide"
            title="Pipeline stage reference"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pipeline Guide</span>
          </Button>
          {/* Select all (shown when assignments exist) */}
          {assignments.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleSelectAll}
              data-testid="button-select-all"
            >
              Select All
            </Button>
          )}
          {/* Date nav */}
          <div className="flex items-center gap-1 border rounded-lg px-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!isAdmin}
              onClick={() => handleDateChange(-1)}
              data-testid="button-prev-day"
              title={!isAdmin ? "Only admins can navigate dates" : ""}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium px-2 min-w-[120px] text-center" data-testid="text-current-date">
              {dateLabel(currentDate)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!isAdmin}
              onClick={() => handleDateChange(1)}
              data-testid="button-next-day"
              title={!isAdmin ? "Only admins can navigate dates" : ""}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          {isPastDate ? (
            // Past date — no generate button at all, just a read-only label
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-muted-foreground/20 bg-muted/50 text-muted-foreground text-sm font-medium select-none">
              <Lock className="w-3.5 h-3.5" />
              Past date
            </div>
          ) : isFutureDate && isAdmin ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-amber-400 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-xs"
                onClick={() => setShowPreConfigureDialog(true)}
                data-testid="button-pre-configure"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                {assignments.length > 0 ? "Edit Pre-config" : "Pre-configure"}
              </Button>
            </div>
          ) : (alreadyGenerated || generateLocked) ? (
            // Today — already generated, show lock + optional admin override
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm font-medium select-none">
                <Lock className="w-3.5 h-3.5" />
                Locked until tomorrow
              </div>
              {user?.role === "admin" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/5 hover:border-destructive text-xs"
                  onClick={() => setShowOverrideDialog(true)}
                  data-testid="button-admin-override"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Override
                </Button>
              )}
            </div>
          ) : (
            // Today — not yet generated
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              Generate
            </Button>
          )}
        </div>
      </div>

      {/* Missing EOD Warning Banner */}
      {clrsMissingEod.length > 0 && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              ⚠️ Missing EOD Reports — Assignments May Be Off
            </p>
            <p className="text-amber-800 dark:text-amber-300 text-xs mt-1 leading-relaxed">
              <strong>{clrsMissingEod.join(", ")}</strong> {clrsMissingEod.length === 1 ? "has" : "have"} not submitted {clrsMissingEod.length === 1 ? "their" : "their"} EOD report for {prevWeekdayStr(currentDate)}.
              Without that data, the algorithm doesn't know which LOs they already worked — so those LOs could be assigned again today,
              causing duplicate outreach or two CLRs calling the same LO.
            </p>
          </div>
          <button onClick={() => setClrsMissingEod([])} className="text-amber-600 dark:text-amber-400 hover:opacity-70 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Admin Override Banner — Editing Future Dates */}
      {isFutureDate && isAdmin && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Admin Override — Editing {dateLabel(currentDate)}'s Assignments
            </p>
            <p className="text-amber-800 dark:text-amber-300 text-xs mt-0.5">
              {isManuallyConfigured
                ? "These assignments are pre-configured. Auto-generation will be skipped for this date."
                : "Pre-configure tomorrow's assignments before the auto-generation cron runs."}
            </p>
          </div>
        </div>
      )}

      {/* Start-at-#1 nudge — shown when there are assignments and at least one is still unworked */}
      {assignments.length > 0 && (assignments as any[]).some(a => a.status === "recommended") && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/70 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-2.5 flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-200">
            <span className="font-semibold">Start at #1</span>
            <span className="text-amber-800/80 dark:text-amber-300/80"> — work the list top to bottom. The order is calibrated by recency, frequency, and priority tier.</span>
          </p>
        </div>
      )}

      {/* Fewest transfers over the last 5 working days */}
      <TransferLullsCard />

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : assignments.length === 0 ? (
        <div className="py-20 text-center">
          <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">No assignments for {dateLabel(currentDate)}.</p>
          {isToday && (
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-generate-empty">
              <RefreshCw className={`w-4 h-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              Generate Today's Assignments
            </Button>
          )}
          {isFutureDate && isAdmin && (
            <Button onClick={() => setShowPreConfigureDialog(true)} data-testid="button-pre-configure-empty">
              <ShieldAlert className="w-4 h-4 mr-2" />
              Pre-configure {dateLabel(currentDate)}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {assistants.map((user: any) => {
            const group = byAssistant[user.id] ?? [];
            if (group.length === 0) return null;
            const sorted = [...group].sort((a: any, b: any) => {
              const aPin = loPrefs[a.lo?.id ?? a.loId]?.isPinned ? 1 : 0;
              const bPin = loPrefs[b.lo?.id ?? b.loId]?.isPinned ? 1 : 0;
              if (aPin !== bPin) return bPin - aPin;
              return a.assistantRank - b.assistantRank;
            });
            return (
              <AssistantGroup
                key={user.id}
                name={user.name}
                assignments={sorted}
                onLogStatus={setStatusDialog}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectGroup={handleSelectGroup}
                onDeselectGroup={handleDeselectGroup}
                loPrefs={loPrefs}
                onSavePref={handleSavePref}
                todayAvailability={todayAvailability}
                reassignTargets={canReassign ? reassignTargets : undefined}
                onReassign={canReassign ? handleRowReassign : undefined}
                nextLoaByLo={nextLoaByLo}
                leadSources={sourceCards?.sources?.filter((s: any) => s.ownerId === user.id)}
              />
            );
          })}
          {/* Unassigned catch-all */}
          {Object.entries(byAssistant).map(([aid, group]) => {
            if (assistants.find((u: any) => u.id === Number(aid))) return null;
            const sorted = [...group].sort((a: any, b: any) => {
              const aPin = loPrefs[a.lo?.id ?? a.loId]?.isPinned ? 1 : 0;
              const bPin = loPrefs[b.lo?.id ?? b.loId]?.isPinned ? 1 : 0;
              if (aPin !== bPin) return bPin - aPin;
              return (a.assistantRank ?? 0) - (b.assistantRank ?? 0);
            });
            return (
              <AssistantGroup
                key={aid}
                name={`Assistant #${aid}`}
                assignments={sorted}
                onLogStatus={setStatusDialog}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectGroup={handleSelectGroup}
                onDeselectGroup={handleDeselectGroup}
                loPrefs={loPrefs}
                onSavePref={handleSavePref}
                todayAvailability={todayAvailability}
                reassignTargets={canReassign ? reassignTargets : undefined}
                onReassign={canReassign ? handleRowReassign : undefined}
                nextLoaByLo={nextLoaByLo}
              />
            );
          })}
        </div>
      )}

      {/* ── EOD Call Count Panel ── */}
      {assignments.length > 0 && (
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              EOD Call Count
              <span className="text-xs font-normal text-muted-foreground ml-1">— log total calls made for {dateLabel(currentDate)}</span>
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {assistants.map((user: any) => {
                const saved = (callLogs as any[]).find(l => l.assistantId === user.id);
                const inputVal = callInputs[user.id] ?? (saved ? String(saved.callsMade) : "");
                return (
                  <div key={user.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
                      {saved && callInputs[user.id] === undefined && (
                        <p className="text-[10px] text-muted-foreground">Saved: {saved.callsMade} calls</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={inputVal}
                        onChange={e => setCallInputs(prev => ({ ...prev, [user.id]: e.target.value }))}
                        className="w-20 h-8 text-sm text-center"
                        data-testid={`input-calls-${user.id}`}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 shrink-0"
                        disabled={saveCallLogMutation.isPending || inputVal === ""}
                        onClick={() => {
                          const count = parseInt(inputVal, 10);
                          if (!isNaN(count)) {
                            saveCallLogMutation.mutate({ assistantId: user.id, callsMade: count });
                            setCallInputs(prev => { const n = { ...prev }; delete n[user.id]; return n; });
                          }
                        }}
                        data-testid={`button-save-calls-${user.id}`}
                        title="Save call count"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <StatusDialog
        open={!!statusDialog}
        assignment={statusDialog}
        onClose={() => setStatusDialog(null)}
        onConfirm={(status, notes) => updateMutation.mutate({ id: statusDialog.id, status, notes })}
        isPending={updateMutation.isPending}
      />

      {/* Floating Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onMarkStatus={handleBulkMarkStatus}
        onDeselectAll={handleDeselectAll}
        isBusy={isBulkPending || reassignMutation.isPending}
        reassignTargets={canReassign ? reassignTargets : undefined}
        onReassign={canReassign ? handleBulkReassign : undefined}
      />

      {/* Admin Regenerate Override Dialog */}
      <AdminRegenerateDialog
        open={showOverrideDialog}
        onClose={() => setShowOverrideDialog(false)}
        onSuccess={() => {
          setShowOverrideDialog(false);
          setGenerateLocked(false);
          queryClient.invalidateQueries({ queryKey: ["/api/assignments", currentDate] });
        }}
      />

      {/* Pre-configure Tomorrow Dialog */}
      <PreConfigureDialog
        open={showPreConfigureDialog}
        date={currentDate}
        existing={assignments as any[]}
        assistants={assistants as any[]}
        onClose={() => setShowPreConfigureDialog(false)}
        onSuccess={() => {
          setShowPreConfigureDialog(false);
          queryClient.invalidateQueries({ queryKey: ["/api/assignments", currentDate] });
        }}
      />
    </div>
  );
}
