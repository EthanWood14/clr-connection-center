import { useMutation, useQuery } from "@tanstack/react-query";
import { LockKeyhole, Unlock } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { PortalTaskLock } from "@shared/portal-task-lock";

export function PortalTaskLockControls({ taskId, active, employeeName }: { taskId: number; active: boolean; employeeName: string }) {
  const { toast } = useToast();
  const { data } = useQuery<{ locks: PortalTaskLock[] }>({ queryKey: ["/api/portal-task-locks"], refetchInterval: 5000 });
  const lock = data?.locks.find(l => l.taskId === taskId);
  const save = useMutation({
    mutationFn: () => lock
      ? apiRequest("DELETE", `/api/portal-task-locks/${lock.id}`)
      : apiRequest("POST", "/api/portal-task-locks", { taskId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-task-locks"] });
      toast({ title: lock ? "Portal reopened" : "Portal locked for this task", description: lock ? "The task stays open." : `${employeeName} can reopen C3 by completing this task.` });
    },
    onError: (error: Error) => toast({ title: "Could not change portal lock", description: error.message, variant: "destructive" }),
  });
  if (!active && !lock) return null;
  return <div className="space-y-1.5">
    <Button variant={lock ? "default" : "outline"} className="w-full gap-2 whitespace-normal h-auto py-2" disabled={save.isPending || !data}
      data-testid={`task-portal-lock-${taskId}`} onClick={() => save.mutate()}>
      {lock ? <Unlock className="h-4 w-4 shrink-0" /> : <LockKeyhole className="h-4 w-4 shrink-0" />}
      {save.isPending ? "Saving…" : lock ? "Unlock portal" : "Lock portal for this task"}
    </Button>
    {lock && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Portal paused until this task is complete.</p>}
  </div>;
}
