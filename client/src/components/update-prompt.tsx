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
import { notesBetween, itemsForAudience, type ReleaseNote } from "@shared/release-notes";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { RefreshCw, Sparkles } from "lucide-react";

type UpdatePromptProps = {
  portal?: "c3" | "lap";
};

export function UpdatePrompt({ portal = "c3" }: UpdatePromptProps) {
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [serverSections, setServerSections] = useState<ReleaseNote[]>([]);
  const productName = portal === "lap" ? "LAP" : "C3";
  const { user } = useAuth();
  const isManager = user?.role === "admin" || !!(user as any)?.isManager || !!user?.superAdmin;

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        // Ask what changed since the build this tab is running. The server is
        // the only side that knows — a bundle cannot contain notes for releases
        // that happened after it was built.
        const r = await fetch(`/api/version?from=${encodeURIComponent(APP_VERSION)}`, { cache: "no-store", credentials: "include" });
        if (!r.ok) return;
        const data = await r.json();
        const v = data && typeof data.version === "string" ? data.version : "";
        if (active && v) {
          setLatest(v);
          setServerSections(Array.isArray(data?.sections) ? data.sections : []);
        }
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

  // Everything missed since the build this tab is running — someone who skipped
  // three deploys should see all three, not just the newest. Prefer the
  // server's list; fall back to the bundled copy only if an older server does
  // not send one.
  const missed = serverSections.length
    ? serverSections
    : (latest ? notesBetween(APP_VERSION, latest) : []);
  const sections = missed
    .map((n) => ({ version: n.version, headline: n.headline, items: itemsForAudience(n, portal, isManager) }))
    .filter((n) => n.items.length > 0);

  return (
    <Dialog open={updateAvailable} onOpenChange={(open) => { if (!open) setDismissed(latest); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Update available
          </DialogTitle>
          <DialogDescription>
            {sections[0]?.headline
              // Lead with what actually changed; the version number is the
              // least interesting thing on this popup.
              ? sections[0].headline
              : `A new version of ${productName}${latest ? ` (v${latest})` : ""} is ready. Refresh to get the latest features and fixes.`}
          </DialogDescription>
        </DialogHeader>

        {sections.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-3 text-sm" data-testid="update-release-notes">
            {sections.map((n) => (
              <div key={n.version}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  v{n.version}
                  {n.version !== latest && " · you also missed this one"}
                </p>
                <ul className="mt-1 space-y-1">
                  {n.items.map((text, i) => (
                    <li key={i} className="flex gap-2 leading-snug">
                      <span className="text-primary mt-[3px]">•</span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
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
