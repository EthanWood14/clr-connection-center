import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, CalendarClock, Check, CheckCircle2, ChevronRight, Clock3,
  History, ListChecks, Loader2, Pencil, Plus, Repeat2, Search, Sparkles,
  Target, Trash2, UserRound,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Completion = { id: number; dueAt: string; completedAt: string; completedByName: string; note: string };
type ClrTask = {
  id: number; title: string; description: string; assignedUserId: number; assignedUserName: string;
  createdByUserId: number; createdByName: string; priority: "low" | "normal" | "high" | "urgent";
  recurrence: "none" | "daily" | "weekdays" | "weekly" | "monthly";
  dueAt: string; status: "active" | "completed"; createdAt: string; updatedAt: string;
  completionCount: number; lastCompletedAt: string | null; overdueAlerted: boolean; history: Completion[];
};
type TaskPayload = {
  tasks: ClrTask[]; canManage: boolean; assignees: Array<{ id: number; name: string }>;
  summary: { active: number; overdue: number; dueSoon: number; completed: number };
};

const RECURRENCE_LABELS: Record<ClrTask["recurrence"], string> = {
  none: "One time", daily: "Every day", weekdays: "Every weekday", weekly: "Every week", monthly: "Every month",
};
const PRIORITY_STYLES: Record<ClrTask["priority"], string> = {
  low: "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300",
  normal: "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300",
  high: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-300",
  urgent: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/25 dark:text-red-300",
};

function defaultDeadline() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function localDateTime(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function dueState(task: ClrTask) {
  if (task.status === "completed") return "completed" as const;
  const remaining = new Date(task.dueAt).getTime() - Date.now();
  if (remaining < 0) return "overdue" as const;
  if (remaining <= 24 * 60 * 60 * 1000) return "soon" as const;
  return "upcoming" as const;
}

function TaskEditor({ open, onClose, task, payload }: {
  open: boolean; onClose: () => void; task: ClrTask | null; payload: TaskPayload;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [priority, setPriority] = useState<ClrTask["priority"]>("normal");
  const [recurrence, setRecurrence] = useState<ClrTask["recurrence"]>("none");
  const [dueAt, setDueAt] = useState(defaultDeadline());

  useEffect(() => {
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setAssignedUserId(String(task?.assignedUserId ?? payload.assignees[0]?.id ?? ""));
    setPriority(task?.priority ?? "normal");
    setRecurrence(task?.recurrence ?? "none");
    setDueAt(task ? localDateTime(task.dueAt) : defaultDeadline());
  }, [task, open, payload.assignees]);

  const save = useMutation({
    mutationFn: () => apiRequest(task ? "PATCH" : "POST", task ? `/api/clr-tasks/${task.id}` : "/api/clr-tasks", {
      title, description, assignedUserId: Number(assignedUserId), priority, recurrence,
      dueAt: new Date(dueAt).toISOString(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clr-tasks"] });
      toast({ title: task ? "Task updated" : "Task assigned", description: task ? "The new deadline and assignment are live." : "The CLR has been notified." });
      onClose();
    },
    onError: (error: any) => toast({ title: "Could not save task", description: error?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !save.isPending) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "Assign a CLR task"}</DialogTitle>
          <DialogDescription>Give the task a clear owner and deadline. Recurring tasks create their next deadline as soon as the current one is completed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5"><Label htmlFor="task-title">What needs to get done?</Label><Input id="task-title" maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Clean the unworked lead queue" /></div>
          <div className="space-y-1.5"><Label htmlFor="task-description">Instructions</Label><Textarea id="task-description" maxLength={3000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add the steps, expected result, links, or anything that removes ambiguity…" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Assign to</Label><Select value={assignedUserId} onValueChange={setAssignedUserId}><SelectTrigger data-testid="task-assignee"><SelectValue placeholder="Choose a CLR" /></SelectTrigger><SelectContent>{payload.assignees.map((person) => <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="task-due">Deadline</Label><Input id="task-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Repeats</Label><Select value={recurrence} onValueChange={(value) => setRecurrence(value as ClrTask["recurrence"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RECURRENCE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Priority</Label><Select value={priority} onValueChange={(value) => setPriority(value as ClrTask["priority"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent></Select></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button onClick={() => save.mutate()} disabled={!title.trim() || !assignedUserId || !dueAt || save.isPending}>{save.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : task ? "Save changes" : "Assign task"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClrTasks() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"open" | "overdue" | "completed" | "all">("open");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ClrTask | null>(null);
  const [completing, setCompleting] = useState<ClrTask | null>(null);
  const [completionNote, setCompletionNote] = useState("");

  const { data, isLoading } = useQuery<TaskPayload>({ queryKey: ["/api/clr-tasks"], refetchInterval: 30_000 });
  const payload = data ?? { tasks: [], canManage: false, assignees: [], summary: { active: 0, overdue: 0, dueSoon: 0, completed: 0 } };

  const complete = useMutation({
    mutationFn: () => apiRequest("POST", `/api/clr-tasks/${completing!.id}/complete`, { note: completionNote }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clr-tasks"] });
      toast({ title: result?.recurring ? "Done — next deadline is ready" : "Task complete", description: result?.recurring ? "Your completion was saved and the recurring task rolled forward." : "Nice work. Your manager can see the completion." });
      setCompleting(null); setCompletionNote("");
    },
    onError: (error: any) => toast({ title: "Could not complete task", description: error?.message, variant: "destructive" }),
  });

  const archive = useMutation({
    mutationFn: (task: ClrTask) => apiRequest("PATCH", `/api/clr-tasks/${task.id}`, { status: "archived" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/clr-tasks"] }); toast({ title: "Task archived" }); },
    onError: (error: any) => toast({ title: "Could not archive task", description: error?.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => payload.tasks.filter((task) => {
    const state = dueState(task);
    const matchesFilter = filter === "all" || (filter === "completed" ? state === "completed" : filter === "overdue" ? state === "overdue" : state !== "completed");
    const needle = search.trim().toLowerCase();
    return matchesFilter && (!needle || `${task.title} ${task.description} ${task.assignedUserName}`.toLowerCase().includes(needle));
  }), [payload.tasks, filter, search]);

  if (isLoading) return <div className="mx-auto max-w-6xl space-y-4 p-6"><div className="h-44 animate-pulse rounded-3xl bg-muted" /><div className="h-80 animate-pulse rounded-3xl bg-muted" /></div>;

  return (
    <div className="min-h-full bg-gradient-to-b from-indigo-50/70 via-background to-emerald-50/40 p-4 dark:from-indigo-950/15 dark:to-emerald-950/10 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-800 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div><Badge className="mb-3 border-white/20 bg-white/10 text-white hover:bg-white/15"><Sparkles className="mr-1 h-3 w-3" /> Team execution</Badge><h1 className="flex items-center gap-3 text-3xl font-black tracking-tight sm:text-4xl"><ListChecks className="h-9 w-9 text-violet-300" /> CLR Task Center</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/65">Clear owners, real deadlines, recurring accountability, and a completion history everyone can understand.</p></div>
            {payload.canManage && <Button size="lg" className="gap-2 bg-white text-indigo-950 hover:bg-violet-100" onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus className="h-4 w-4" /> Assign task</Button>}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Open", value: payload.summary.active, icon: Target, color: "text-indigo-600" },
            { label: "Due in 24h", value: payload.summary.dueSoon, icon: Clock3, color: "text-amber-600" },
            { label: "Overdue", value: payload.summary.overdue, icon: AlertTriangle, color: "text-red-600" },
            { label: "Completed", value: payload.summary.completed, icon: CheckCircle2, color: "text-emerald-600" },
          ].map((item) => <Card key={item.label} className="bg-background/80 shadow-sm backdrop-blur"><CardContent className="flex items-center gap-3 p-4"><item.icon className={`h-6 w-6 ${item.color}`} /><div><p className="text-2xl font-black tabular-nums">{item.value}</p><p className="text-xs text-muted-foreground">{item.label}</p></div></CardContent></Card>)}
        </section>

        <Card className="bg-background/85 shadow-sm backdrop-blur"><CardContent className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-2">{(["open", "overdue", "completed", "all"] as const).map((value) => <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)} className="capitalize">{value}{value === "overdue" && payload.summary.overdue ? ` (${payload.summary.overdue})` : ""}</Button>)}</div><div className="relative sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task, CLR, or details…" /></div></div></CardContent></Card>

        <section className="space-y-3" data-testid="clr-task-list">
          {filtered.length === 0 ? <Card className="border-dashed bg-background/60"><CardContent className="flex flex-col items-center p-12 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-500" /><h2 className="mt-4 text-lg font-bold">Nothing here needs attention</h2><p className="mt-1 text-sm text-muted-foreground">Try another filter, or enjoy the clean slate.</p></CardContent></Card> : filtered.map((task) => {
            const state = dueState(task);
            const due = new Date(task.dueAt);
            return <Card key={task.id} className={`overflow-hidden bg-background/90 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${state === "overdue" ? "border-red-400" : state === "soon" ? "border-amber-400" : state === "completed" ? "border-emerald-300 opacity-80" : ""}`}>
              <div className={`h-1 ${task.priority === "urgent" ? "bg-red-500" : task.priority === "high" ? "bg-amber-500" : task.priority === "normal" ? "bg-indigo-500" : "bg-slate-400"}`} />
              <CardContent className="p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={`capitalize ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</Badge>{task.recurrence !== "none" && <Badge variant="secondary" className="gap-1"><Repeat2 className="h-3 w-3" /> {RECURRENCE_LABELS[task.recurrence]}</Badge>}{state === "overdue" && <Badge className="bg-red-600">OVERDUE</Badge>}{state === "completed" && <Badge className="bg-emerald-600">COMPLETED</Badge>}</div><h2 className="mt-3 text-lg font-black">{task.title}</h2>{task.description && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{task.description}</p>}<div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /><strong className="text-foreground">{task.assignedUserName}</strong></span><span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> {state === "completed" ? "Was due" : "Due"} {format(due, "EEE, MMM d 'at' h:mm a")}</span>{state !== "completed" && <span className={`font-semibold ${state === "overdue" ? "text-red-600" : state === "soon" ? "text-amber-600" : ""}`}>{formatDistanceToNow(due, { addSuffix: true })}</span>}<span>Assigned by {task.createdByName}</span></div>
                {task.history.length > 0 && <details className="mt-4 rounded-xl border bg-muted/20"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold"><History className="h-3.5 w-3.5" /> {task.completionCount} completion{task.completionCount === 1 ? "" : "s"}<ChevronRight className="ml-auto h-3.5 w-3.5" /></summary><div className="space-y-2 border-t p-3">{task.history.map((entry) => <div key={entry.id} className="rounded-lg bg-background p-2 text-xs"><p><strong>{entry.completedByName}</strong> completed it {formatDistanceToNow(new Date(entry.completedAt), { addSuffix: true })}</p>{entry.note && <p className="mt-1 text-muted-foreground">“{entry.note}”</p>}</div>)}</div></details>}
                </div><div className="flex shrink-0 flex-wrap gap-2 md:w-48 md:flex-col">{task.status === "active" && <Button className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setCompleting(task); setCompletionNote(""); }}><Check className="h-4 w-4" /> Mark done</Button>}{payload.canManage && <Button variant="outline" className="flex-1 gap-2" onClick={() => { setEditing(task); setEditorOpen(true); }}><Pencil className="h-4 w-4" /> Edit</Button>}{payload.canManage && <Button variant="ghost" className="flex-1 gap-2 text-muted-foreground hover:text-red-600" disabled={archive.isPending} onClick={() => archive.mutate(task)}><Trash2 className="h-4 w-4" /> Archive</Button>}</div></div></CardContent>
            </Card>;
          })}
        </section>
      </div>

      <TaskEditor open={editorOpen} onClose={() => { setEditorOpen(false); setEditing(null); }} task={editing} payload={payload} />
      <Dialog open={!!completing} onOpenChange={(open) => { if (!open && !complete.isPending) setCompleting(null); }}><DialogContent><DialogHeader><DialogTitle>Complete “{completing?.title}”?</DialogTitle><DialogDescription>{completing?.recurrence === "none" ? "This closes the task and saves it in the completion history." : "This records the current cycle and automatically creates the next deadline."}</DialogDescription></DialogHeader><div className="space-y-1.5 py-2"><Label htmlFor="completion-note">Completion note <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="completion-note" rows={4} value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="What was completed, the result, or anything your manager should know…" /></div><DialogFooter><Button variant="outline" onClick={() => setCompleting(null)} disabled={complete.isPending}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => complete.mutate()} disabled={complete.isPending}>{complete.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><Check className="mr-2 h-4 w-4" />Complete task</>}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
