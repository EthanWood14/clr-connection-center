import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight, Clock3, X } from "lucide-react";
import { DailyReportGateActive } from "@/components/daily-report-gate";
import { EodLockGateActive } from "@/components/eod-lock-gate";
import { Button } from "@/components/ui/button";

type PopupTask = {
  id: number;
  title: string;
  assignedUserName: string;
  dueAt: string;
  status: string;
};

type PopupPayload = {
  tasks: PopupTask[];
  canManage: boolean;
};

const SNOOZE_MS = 30 * 60_000;

function dueLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** A persistent, global reminder that does not compete with blocking dialogs. */
export function TaskOverduePopup() {
  const [location, navigate] = useLocation();
  const blocked = useContext(DailyReportGateActive) || useContext(EodLockGateActive);
  const { data } = useQuery<PopupPayload>({
    queryKey: ["/api/clr-tasks"],
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const overdue = useMemo(() => (data?.tasks ?? [])
    .filter((task) => task.status === "active" && new Date(task.dueAt).getTime() < now)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt)), [data?.tasks, now]);
  const overdueKey = overdue.map((task) => `${task.id}:${task.dueAt}`).join("|");
  const previousKey = useRef("");
  const [snoozedUntil, setSnoozedUntil] = useState(0);

  useEffect(() => {
    if (overdueKey && overdueKey !== previousKey.current) setSnoozedUntil(0);
    previousKey.current = overdueKey;
  }, [overdueKey]);

  useEffect(() => {
    if (!snoozedUntil) return;
    const wait = Math.max(0, snoozedUntil - Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 50);
    return () => window.clearTimeout(timer);
  }, [snoozedUntil]);

  if (!overdue.length || blocked || location === "/tasks" || now < snoozedUntil) return null;

  return (
    <aside className="fixed bottom-4 right-4 z-[45] w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-2xl border-2 border-red-500 bg-background shadow-2xl shadow-red-500/25" role="alert" aria-live="assertive" data-testid="task-overdue-popup">
      <div className="flex items-start gap-3 bg-red-600 px-4 py-3 text-white">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15"><AlertTriangle className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-black">{overdue.length === 1 ? "A C3 task is overdue" : `${overdue.length} C3 tasks are overdue`}</p>
          <p className="text-xs text-red-100">This reminder returns every 30 minutes until the work is handled.</p>
        </div>
        <button type="button" className="rounded-md p-1 text-red-100 hover:bg-white/15 hover:text-white" aria-label="Remind me in 30 minutes" onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-2 p-4">
        {overdue.slice(0, 3).map((task) => (
          <div key={task.id} className="rounded-xl border bg-red-50/70 px-3 py-2 dark:bg-red-950/25">
            <p className="truncate text-sm font-bold">{task.title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-red-700 dark:text-red-300"><Clock3 className="h-3 w-3" /> Due {dueLabel(task.dueAt)}{data?.canManage ? ` · ${task.assignedUserName}` : ""}</p>
          </div>
        ))}
        {overdue.length > 3 && <p className="text-center text-xs text-muted-foreground">+{overdue.length - 3} more overdue</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => setSnoozedUntil(Date.now() + SNOOZE_MS)}>Remind me in 30m</Button>
          <Button className="flex-1 gap-2 bg-red-600 hover:bg-red-700" onClick={() => navigate("/tasks")}>Open Tasks <ArrowRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </aside>
  );
}
