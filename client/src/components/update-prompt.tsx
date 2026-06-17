/**
 * UpdatePrompt — pops up a modal for everyone when a new version of C3 deploys.
 *
 * The running bundle carries the version it was built with (APP_VERSION). We
 * poll GET /api/version (the currently-deployed version) every 90s and whenever
 * the tab regains focus/visibility; when it differs from the baked-in version a
 * new build is live, so we show a centered "Update available" popup. Refresh
 * reloads the page (the service worker is network-first for navigation, so the
 * new bundle loads). Dismissing ("Later") snoozes only the current version — a
 * subsequent deploy pops it again.
 */

import { useEffect, useState } from "react";
import { APP_VERSION } from "@shared/version";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { RefreshCw, Sparkles } from "lucide-react";

export function UpdatePrompt() {
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store", credentials: "include" });
        if (!r.ok) return;
        const data = await r.json();
        const v = data && typeof data.version === "string" ? data.version : "";
        if (active && v) setLatest(v);
      } catch { /* offline / transient — try again next tick */ }
    };
    check();
    const id = setInterval(check, 90 * 1000); // poll every 90s
    const onFocus = () => check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const updateAvailable = !!latest && latest !== APP_VERSION && latest !== dismissed;

  return (
    <Dialog open={updateAvailable} onOpenChange={(open) => { if (!open) setDismissed(latest); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Update available
          </DialogTitle>
          <DialogDescription>
            A new version of C3{latest ? ` (v${latest})` : ""} is ready. Refresh to get the latest
            features and fixes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => setDismissed(latest)}>Later</Button>
          <Button className="gap-1.5" onClick={() => window.location.reload()}>
            <RefreshCw className="w-4 h-4" /> Refresh now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
