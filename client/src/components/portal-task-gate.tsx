import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { rescueDrafts, type RescuedDraft } from "@/lib/draft-rescue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PortalTaskLock } from "@shared/portal-task-lock";

const FrozenRoute = createContext<string | null>(null);
function usePortalLocation(): ReturnType<typeof useHashLocation> {
  const frozen = useContext(FrozenRoute);
  const [location, navigate] = useHashLocation();
  return [frozen ?? location, (to, options) => { if (frozen === null) navigate(to, options); }];
}

/** A top-layer dialog makes existing forms inert without unmounting their state. */
export function PortalTaskGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <PortalTaskGateForUser key={`${user?.orgId}:${user?.id}`} children={children} />;
}

function PortalTaskGateForUser({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const enabled = !!user && (!user.portal || user.portal === "c3");
  const identity = `${user?.orgId}:${user?.id}`;
  const key = ["/api/portal-task-locks/me", identity];
  const { data, refetch } = useQuery<{ lock: PortalTaskLock | null }>({
    queryKey: key, queryFn: () => apiRequest("GET", "/api/portal-task-locks/me"),
    enabled, refetchInterval: 3000, refetchIntervalInBackground: true,
    staleTime: 0, retry: false,
  });
  const lock = enabled ? data?.lock ?? null : null;
  const dialog = useRef<HTMLDialogElement>(null);
  const heldRoute = useRef<string | null>(null);
  const previousLock = useRef<number | null>(null);
  const [draft, setDraft] = useState<RescuedDraft | null>(null);
  const [note, setNote] = useState("");
  const [calls, setCalls] = useState("");
  const [backupSaved, setBackupSaved] = useState(false);
  const [, resume] = useState(0);
  const [location] = useHashLocation();
  if (lock && heldRoute.current === null) heldRoute.current = location;
  const frozenRoute = heldRoute.current;
  const prefix = `c3:portal-task-draft:${identity}:`;

  useEffect(() => {
    if (!enabled) return;
    const received = (event: Event) => {
      const value = (event as CustomEvent<PortalTaskLock>).detail;
      if (value?.userId === user?.id) queryClient.setQueryData(key, { lock: value });
    };
    window.addEventListener("c3-portal-task-lock", received);
    return () => window.removeEventListener("c3-portal-task-lock", received);
  }, [enabled, identity]);

  useLayoutEffect(() => {
    if (lock) {
      // Capture BEFORE opening the dialog: showModal makes underlying inputs inert.
      if (previousLock.current !== lock.id) {
        let rescued: RescuedDraft | null = null;
        try {
          // On reload, prefer the checkpoint rather than overwriting it with an empty page.
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k?.startsWith(prefix)) {
              const candidate = JSON.parse(sessionStorage.getItem(k) || "null");
              if (candidate?.lockId === lock.id) { rescued = candidate; break; }
            }
          }
          if (!rescued) rescued = rescueDrafts(`Portal paused for ${lock.title}`, sessionStorage, prefix);
          if (rescued) sessionStorage.setItem(prefix + rescued.route, JSON.stringify({ ...rescued, lockId: lock.id }));
          setBackupSaved(!!rescued && !!sessionStorage.getItem(prefix + rescued.route));
        } catch { setBackupSaved(false); }
        setDraft(rescued);
        previousLock.current = lock.id;
      }
      document.documentElement.dataset.portalTaskLocked = "true";
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
    } else {
      delete document.documentElement.dataset.portalTaskLocked;
      dialog.current?.close();
      if (heldRoute.current !== null) {
        // Back/forward or a manually edited URL during the lock must not discard the held page.
        window.history.replaceState(null, "", `#${heldRoute.current}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        heldRoute.current = null;
        previousLock.current = null;
        queryClient.invalidateQueries();
        resume(n => n + 1);
      }
    }
  }, [lock?.id, prefix]);

  useEffect(() => {
    if (!lock) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [lock?.id]);

  const complete = useMutation({
    mutationFn: () => apiRequest("POST", `/api/clr-tasks/${lock!.taskId}/complete`, {
      note, ...(/^call\b/i.test(lock!.title.trim()) ? { callsMade: Number(calls) } : {}),
    }),
    onSuccess: async () => { setNote(""); setCalls(""); await refetch(); },
  });
  const needsCalls = !!lock && /^call\b/i.test(lock.title.trim());
  return <FrozenRoute.Provider value={frozenRoute}>
    <Router hook={usePortalLocation}>{children}</Router>
    <dialog ref={dialog} onCancel={event => event.preventDefault()} aria-labelledby="portal-task-title"
      className="m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-slate-950 p-5 text-slate-100 backdrop:bg-slate-950 sm:p-10" data-testid="portal-task-gate">
      {lock && <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-6 py-6">
        <div className="flex items-center gap-3 text-cyan-300"><LockKeyhole className="h-7 w-7" /><span className="text-sm font-semibold uppercase tracking-widest">Required task</span></div>
        <div><h1 id="portal-task-title" className="text-3xl font-bold">Complete this task to reopen C3</h1><p className="mt-3 text-slate-300">{lock.managerName} paused your portal. Your open page stays in place while you finish.</p></div>
        <section className="space-y-3 rounded-2xl border border-cyan-400/30 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">{lock.title}</h2>
          <p className="whitespace-pre-wrap text-slate-300">{lock.description || "Complete the task assigned by your manager."}</p>
          <p className="text-sm text-slate-400">Due {new Date(lock.dueAt).toLocaleString()}</p>
          {!!lock.compAmountCents && <p className="text-sm text-emerald-300">Completion files a ${(lock.compAmountCents / 100).toFixed(2)} comp request for manager approval.</p>}
        </section>
        <div className="space-y-3">
          {needsCalls && <label className="block space-y-2 text-sm">Calls made<Input type="number" min={0} max={5000} value={calls} onChange={e => setCalls(e.target.value)} className="bg-slate-900" /></label>}
          <label className="block space-y-2 text-sm">What did you complete?<Textarea autoFocus rows={4} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} className="bg-slate-900" placeholder="Describe the work and the result (at least 10 characters)." /></label>
          {complete.error && <p role="alert" className="text-sm text-red-300">{complete.error.message}</p>}
          <Button className="w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" disabled={complete.isPending || note.trim().length < 10 || (needsCalls && (!calls.trim() || !Number.isFinite(Number(calls)) || Number(calls) < 0 || Number(calls) > 5000))} onClick={() => complete.mutate()}><CheckCircle2 className="mr-2 h-4 w-4" />{complete.isPending ? "Saving completion…" : "Complete task & reopen portal"}</Button>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">{backupSaved ? "A backup of your typed work is saved in this tab. " : "Your open work is being held in this tab. "}Keep this tab open to preserve attachments and unsaved changes. If this task requires another C3 page, ask your manager to unlock the portal.</p>
        <Button variant="ghost" className="self-start text-slate-400" onClick={() => logout()}>Sign out</Button>
      </div>}
    </dialog>
    {!lock && draft && <aside className="fixed bottom-4 right-4 z-[100] max-h-[60vh] w-[min(90vw,26rem)] overflow-auto rounded-xl border bg-background p-4 shadow-xl" data-testid="portal-task-draft">
      <h2 className="font-semibold">Your work is ready to resume</h2><p className="mt-1 text-sm text-muted-foreground">Your page was kept open. This backup has the text captured before the portal paused.</p>
      <details className="my-3 text-sm"><summary className="cursor-pointer">View saved text</summary>{Object.entries(draft.fields).map(([label, value]) => <div key={label} className="mt-3"><strong>{label}</strong><pre className="whitespace-pre-wrap break-words rounded bg-muted p-2 font-sans select-text">{value}</pre></div>)}</details>
      <Button size="sm" variant="outline" onClick={() => { try { sessionStorage.removeItem(prefix + draft.route); } catch {} setDraft(null); }}>Dismiss backup</Button>
    </aside>}
  </FrozenRoute.Provider>;
}
