import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Gates chatty shell polls (chat badge, shotgun, LO-newest, summons) until
 * the first critical Home query has settled — or a short post-auth fallback
 * fires — so they stop contending with first paint after login reload.
 *
 * Critical keys:
 *  - /api/manager-dashboard… (admin Home, including ?phase=fast)
 *  - /api/dashboard/stats…   (CLR Home)
 */
const FALLBACK_MS = 4_000;

function isCriticalHomeKey(key: unknown): boolean {
  if (typeof key !== "string") return false;
  return (
    key === "/api/manager-dashboard" ||
    key.startsWith("/api/manager-dashboard?") ||
    key.startsWith("/api/dashboard/stats")
  );
}

export function useShellPollsEnabled(userPresent: boolean): boolean {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userPresent) {
      setReady(false);
      return;
    }
    if (ready) return;

    const check = () => {
      const hit = qc.getQueryCache().getAll().some((q) => {
        if (q.state.status !== "success") return false;
        const k0 = q.queryKey[0];
        return isCriticalHomeKey(k0);
      });
      if (hit) setReady(true);
    };

    check();
    const unsub = qc.getQueryCache().subscribe(() => check());
    const t = window.setTimeout(() => setReady(true), FALLBACK_MS);
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, [qc, userPresent, ready]);

  return userPresent && ready;
}
