import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, RefreshCw, CheckCircle2, XCircle,
  PhoneOutgoing, AlertCircle, Users, Calendar, Phone, Save,
  Check, ArrowRight, X, MinusCircle, Lock
} from "lucide-react";

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
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
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
            <p className="font-medium">{assignment.lo?.fullName}</p>
            <p className="text-muted-foreground text-xs">NMLS {assignment.lo?.nmlsId} · Assigned to {assignment.assistant?.name}</p>
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

interface AssignmentRowProps {
  assignment: any;
  onLogStatus: (a: any) => void;
  isSelected: boolean;
  onToggle: (id: number) => void;
}

function AssignmentRow({ assignment, onLogStatus, isSelected, onToggle }: AssignmentRowProps) {
  const cfg = STATUS_CONFIG[assignment.status] ?? STATUS_CONFIG.recommended;
  const Icon = cfg.icon;

  return (
    <div
      className={`flex items-center gap-3 py-3 px-4 border-b last:border-0 hover:bg-muted/30 transition-colors group ${isSelected ? "bg-teal-50/60 dark:bg-teal-900/10" : ""}`}
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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" data-testid={`text-assignment-lo-${assignment.id}`}>{assignment.lo?.fullName}</span>
          {assignment.lo?.priorityTier === 1 && (
            <span className="text-[10px] px-1 py-0 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 font-medium">VIP</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          NMLS {assignment.lo?.nmlsId}
          {assignment.lo?.phone && ` · ${assignment.lo.phone}`}
          {assignment.notes && <span className="ml-2 italic">"{assignment.notes}"</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Badge className={`text-xs px-2 py-0.5 ${cfg.color} flex items-center gap-1`}>
          <Icon className="w-3 h-3" />{cfg.label}
        </Badge>
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
}

function AssistantGroup({
  name,
  assignments,
  onLogStatus,
  selectedIds,
  onToggleSelect,
  onSelectGroup,
  onDeselectGroup,
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
        {assignments.map(a => (
          <AssignmentRow
            key={a.id}
            assignment={a}
            onLogStatus={onLogStatus}
            isSelected={selectedIds.has(a.id)}
            onToggle={onToggleSelect}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface BulkActionBarProps {
  selectedCount: number;
  onMarkStatus: (status: string) => void;
  onDeselectAll: () => void;
  isBusy: boolean;
}

function BulkActionBar({ selectedCount, onMarkStatus, onDeselectAll, isBusy }: BulkActionBarProps) {
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

export default function Assignments() {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(formatDate(new Date()));
  const [statusDialog, setStatusDialog] = useState<any>(null);
  const [callInputs, setCallInputs] = useState<Record<number, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkPending, setIsBulkPending] = useState(false);
  const [generateLocked, setGenerateLocked] = useState(false);

  const { data: assignments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/assignments", currentDate],
    queryFn: () => apiRequest("GET", `/api/assignments?date=${currentDate}`),
  });

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const { data: callLogs = [] } = useQuery<any[]>({
    queryKey: ["/api/call-logs", currentDate],
    queryFn: () => apiRequest("GET", `/api/call-logs?date=${currentDate}`),
  });

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
  const isToday = currentDate === today;
  const alreadyGenerated = isToday && (assignments as any[]).length > 0;

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/assignments/generate", { date: currentDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments", currentDate] });
      toast({ title: "Assignments generated" });
    },
    onError: (err: any) => {
      const msg: string = err?.message ?? "";
      if (msg.includes("locked") || msg.includes("already been generated")) {
        setGenerateLocked(true);
        toast({ title: "Already generated today", description: "Assignments are locked until tomorrow.", variant: "destructive" });
      } else {
        toast({ title: "Error generating assignments", variant: "destructive" });
      }
    },
  });

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

  const handleDateChange = (delta: number) => {
    const d = new Date(currentDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setCurrentDate(formatDate(d));
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

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Daily Assignments</h1>
          <p className="text-sm text-muted-foreground">
            {assignments.length} LOs assigned · {totalWorked} worked · {totalAttempted} attempted
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDateChange(-1)} data-testid="button-prev-day">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium px-2 min-w-[120px] text-center" data-testid="text-current-date">
              {dateLabel(currentDate)}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDateChange(1)} data-testid="button-next-day">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          {(alreadyGenerated || generateLocked) ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm font-medium select-none">
              <Lock className="w-3.5 h-3.5" />
              Locked until tomorrow
            </div>
          ) : (
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

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : assignments.length === 0 ? (
        <div className="py-20 text-center">
          <Calendar className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">No assignments for {dateLabel(currentDate)}.</p>
          {currentDate === formatDate(new Date()) && (
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="button-generate-empty">
              <RefreshCw className={`w-4 h-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
              Generate Today's Assignments
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {assistants.map((user: any) => {
            const group = byAssistant[user.id] ?? [];
            if (group.length === 0) return null;
            return (
              <AssistantGroup
                key={user.id}
                name={user.name}
                assignments={group.sort((a: any, b: any) => a.assistantRank - b.assistantRank)}
                onLogStatus={setStatusDialog}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectGroup={handleSelectGroup}
                onDeselectGroup={handleDeselectGroup}
              />
            );
          })}
          {/* Unassigned catch-all */}
          {Object.entries(byAssistant).map(([aid, group]) => {
            if (assistants.find((u: any) => u.id === Number(aid))) return null;
            return (
              <AssistantGroup
                key={aid}
                name={`Assistant #${aid}`}
                assignments={group}
                onLogStatus={setStatusDialog}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onSelectGroup={handleSelectGroup}
                onDeselectGroup={handleDeselectGroup}
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
        isBusy={isBulkPending}
      />
    </div>
  );
}
