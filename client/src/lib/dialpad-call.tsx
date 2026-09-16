import { useCallback, useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { reserveDialpadLaunch } from "./dialpad-launch";

/** Call on a user click; complete only AFTER C3 confirms the lead is theirs. */
function prepareDialpadCall(phone: string) {
  try {
    const launch = reserveDialpadLaunch(phone);
    return {
      cancel: launch.cancel,
      complete() {
        const opened = launch.open();
        const feedback = toast({
          title: opened ? "Opening Dialpad" : "Your lead is secured — open Dialpad",
          duration: opened ? 15_000 : 60_000,
          description: <span>
            {opened ? "If Dialpad doesn't open, use this link. " : "Your browser blocked or closed the launch tab. "}
            <a className="font-semibold underline" href={launch.url} target="_blank" rel="noopener noreferrer" data-testid="dialpad-launch-retry">Open Dialpad</a>
            <span className="mt-1 block">Allow the browser's Open Dialpad prompt if asked. Log the actual result back in C3.</span>
          </span>,
        });
        return () => feedback.dismiss();
      },
    };
  } catch (error) {
    toast({ title: "Could not open Dialpad", description: error instanceof Error ? error.message : "Check this lead's phone number.", variant: "destructive" });
    return null;
  }
}

type PreparedCall = { complete(): void; cancel(): void };

/** Keep refetch-safe promises, but cancel them when their user's dock unmounts. */
export function useDialpadCall() {
  const alive = useRef(true);
  const pending = useRef(new Set<PreparedCall>());
  const dismissFeedback = useRef<(() => void) | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current.forEach(call => call.cancel());
      pending.current.clear();
      dismissFeedback.current?.();
      dismissFeedback.current = null;
    };
  }, []);
  return useCallback((phone: string): PreparedCall | null => {
    if (!alive.current) return null;
    const call = prepareDialpadCall(phone);
    if (!call) return null;
    let settled = false;
    const guarded: PreparedCall = {
      complete() {
        if (settled) return;
        settled = true;
        pending.current.delete(guarded);
        if (!alive.current) { call.cancel(); return; }
        dismissFeedback.current?.();
        dismissFeedback.current = call.complete();
      },
      cancel() {
        if (settled) return;
        settled = true;
        pending.current.delete(guarded);
        call.cancel();
      },
    };
    pending.current.add(guarded);
    return guarded;
  }, []);
}
