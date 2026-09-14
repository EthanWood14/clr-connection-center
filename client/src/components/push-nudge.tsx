/**
 * PushNudge — the in-app prompt to enable push notifications.
 *
 * For CLRs it is REQUIRED (14 Sep 2026): new leads for their LOs and Shotgun
 * offers reach them by notification when C3 is not the front tab — which is
 * most of the day, since the work happens in Bonzo and Dialpad. The floor
 * test that day found 7 of 11 CLRs with no subscription at all. So for a CLR:
 *   - the prompt stays until notifications are on;
 *   - "Later" puts it off for four hours, not three days;
 *   - there is no "Don't ask again";
 *   - a browser-level block shows how to unblock instead of hiding.
 * Managers and everyone else keep the gentler version (3-day snooze, opt out).
 *
 * The Enable button runs the full subscribe flow inline (request permission →
 * fetch VAPID key → subscribe → save to server). Routing to /settings was three
 * clicks deep and most people never finished it.
 */

import { useState, useEffect } from "react";
import { Bell, X, ArrowRight, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

// Bumped key suffix (v4) — re-surface the prompt once for everyone, including
// anyone who clicked "Don't ask again" on v3. Old keys stay in localStorage
// harmlessly.
const PERM_DISMISS_KEY  = "clr_push_nudge_perm_dismissed_v4";
const SNOOZE_KEY        = "clr_push_nudge_snoozed_until_v4";
/** Non-CLRs: re-nudge every 3 days after "Later". */
const SNOOZE_MS         = 3 * 24 * 60 * 60 * 1000;
/** CLRs: notifications are required, so "Later" means later today. */
export const CLR_SNOOZE_MS = 4 * 60 * 60 * 1000;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function isPushEnabled(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

/** Whether this person must have notifications on: CLRs and anyone doing CLR work. */
export function pushRequiredFor(user: { isClr?: boolean; role?: string } | null | undefined): boolean {
  return !!user && (!!user.isClr || String(user.role ?? "") === "assistant");
}

export function PushNudge() {
  const { user } = useAuth();
  const required = pushRequiredFor(user);
  const [visible, setVisible] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Unsupported browser
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

      // Browser-level block. A CLR is told how to lift it; anyone else is
      // left alone, as before.
      if (Notification.permission === "denied") {
        if (required && !cancelled) { setBlocked(true); setVisible(true); }
        return;
      }

      // Permanent dismiss — only ever possible for non-CLRs.
      if (!required) {
        try {
          if (localStorage.getItem(PERM_DISMISS_KEY) === "1") return;
        } catch {}
      }

      // Already enabled
      if (await isPushEnabled()) return;

      // Check snooze
      try {
        const until = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
        if (Date.now() < until) return;
      } catch {}

      // Show right away — a delayed nudge is easy to miss.
      if (!cancelled) setVisible(true);
    }

    check();
    return () => { cancelled = true; };
  }, [required]);

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + (required ? CLR_SNOOZE_MS : SNOOZE_MS))); } catch {}
    setVisible(false);
  }

  function permDismiss() {
    if (required) return; // not offered to CLRs — the button is not rendered either
    try { localStorage.setItem(PERM_DISMISS_KEY, "1"); } catch {}
    setVisible(false);
  }

  async function enableNow() {
    if (busy) return;
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        toast({ title: "Not supported", description: "This browser doesn't support push notifications.", variant: "destructive" });
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast({
          title: perm === "denied" ? "Permission denied" : "Permission required",
          description: "Allow notifications in your browser to continue.",
          variant: perm === "denied" ? "destructive" : undefined,
        });
        if (perm === "denied") { if (required) setBlocked(true); else setVisible(false); }
        return;
      }
      const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
      if (!keyRes.ok) throw new Error("VAPID key unavailable");
      const { publicKey } = await keyRes.json();
      const reg = await navigator.serviceWorker.ready;
      // If a stale subscription exists (e.g. from a prior VAPID key), clear it
      // first so the new subscribe call doesn't fail with InvalidStateError.
      const existing = await reg.pushManager.getSubscription();
      if (existing) { try { await existing.unsubscribe(); } catch {} }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await apiRequest("POST", "/api/push/subscribe", { subscription: sub.toJSON() });
      toast({ title: "Notifications enabled", description: "You'll get push alerts on this device." });
      setVisible(false);
    } catch (e: any) {
      toast({ title: "Couldn't enable notifications", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-20 left-0 right-0 z-[9998] flex justify-center px-4 pointer-events-none
                 md:bottom-6 md:left-auto md:right-6 md:max-w-sm"
      data-testid="push-nudge"
      data-required={required ? "1" : "0"}
    >
      <div className="w-full pointer-events-auto rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-2xl overflow-hidden">
        {/* Accent bar */}
        <div className={`h-1 w-full bg-gradient-to-r ${required ? "from-orange-500 to-red-500" : "from-primary to-blue-500"}`} />

        <div className="p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5 animate-pulse">
              {blocked ? <Lock className="w-5 h-5 text-primary" /> : <Bell className="w-5 h-5 text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              {blocked ? (
                <>
                  <p className="text-sm font-bold text-foreground leading-tight">🔒 Notifications are blocked in this browser</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed" data-testid="push-nudge-unblock">
                    Click the <strong className="text-foreground">lock icon</strong> next to the address bar → <strong className="text-foreground">Notifications</strong> → <strong className="text-foreground">Allow</strong>, then reload this page. New leads and Shotgun offers can't reach you until it's on.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-foreground leading-tight">🔔 Turn on notifications{required ? " — required" : ""}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {required
                      ? <><strong className="text-foreground">New leads for your LOs and Shotgun offers</strong> reach you this way when C3 isn't the tab in front — which is most of the day. One click, then Allow.</>
                      : <><strong className="text-foreground">Don't miss a lead.</strong> Notifications are how grab-it leads, appointment reminders, and team alerts reach you — even when C3 isn't open.</>}
                  </p>
                </>
              )}
            </div>
            {!required && (
              <button
                onClick={snooze}
                aria-label="Remind me later"
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded flex-shrink-0 -mt-0.5 -mr-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-0.5">
            {!blocked && (
              <Button
                size="sm"
                className="h-9 text-sm font-semibold gap-1.5 flex-1"
                onClick={enableNow}
                disabled={busy}
                data-testid="button-push-nudge-enable"
              >
                {busy ? (
                  <>Enabling… <Loader2 className="w-3.5 h-3.5 animate-spin" /></>
                ) : (
                  <>Turn on notifications <ArrowRight className="w-3.5 h-3.5" /></>
                )}
              </Button>
            )}
            {blocked && (
              <Button size="sm" className="h-9 text-sm font-semibold gap-1.5 flex-1" onClick={() => window.location.reload()} data-testid="button-push-nudge-reload">
                I've allowed it — reload
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={snooze}
              data-testid="button-push-nudge-later"
            >
              {required ? "Later today" : "Later"}
            </Button>
            {!required && (
              <button
                onClick={permDismiss}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap underline underline-offset-2"
                data-testid="button-push-nudge-never"
              >
                Don't ask again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
