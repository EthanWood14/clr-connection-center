/**
 * UpdatePrompt — shows a banner when a newer version of C3 has been deployed.
 *
 * The running bundle carries the version it was built with (APP_VERSION). We
 * poll GET /api/version (the currently-deployed version) periodically and on
 * window focus; when it differs from the baked-in version, a new build is live,
 * so we surface a "refresh to update" prompt. Refresh reloads the page (the
 * service worker is network-first for navigation, so the new bundle loads).
 */

import { useEffect, useState } from "react";
import { APP_VERSION } from "@shared/version";
import { Button } from "@/components/ui/button";
import { RefreshCw, Sparkles, X } from "lucide-react";

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
    const id = setInterval(check, 2 * 60 * 1000); // every 2 minutes
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { active = false; clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, []);

  const updateAvailable = !!latest && latest !== APP_VERSION && latest !== dismissed;
  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-md px-4">
      <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-background/95 backdrop-blur px-4 py-3 shadow-lg">
        <Sparkles className="w-5 h-5 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">A new version of C3 is available</p>
          <p className="text-xs text-muted-foreground">v{APP_VERSION} → v{latest} · refresh to update</p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 shrink-0" onClick={() => window.location.reload()}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
        <Button
          size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0 text-muted-foreground"
          onClick={() => setDismissed(latest)}
          aria-label="Dismiss update prompt"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
