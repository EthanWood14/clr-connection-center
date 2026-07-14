/**
 * PushNudge — biweekly in-app prompt to enable push notifications.
 *
 * Logic:
 * - Never shows if push is already enabled OR browser permission is denied.
 * - Never shows if the user has clicked "Don't ask again" (permanent dismiss).
 * - After a temporary dismiss ("Later"), re-appears after 14 days.
 * - Appears as a toast-style banner anchored above the bottom nav.
 *
 * The Enable button now runs the full subscribe flow inline (request
 * permission → fetch VAPID key → subscribe → save to server). Previously it
 * routed users to /settings, which was 3 clicks deep and meant most users
 * never actually finished subscribing.
 */

import { useState, useEffect } from "react";
import { Bell, X, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Bumped key suffix (v3) — re-surface the (now stronger) prompt once for
// everyone, including users who previously clicked "Don't ask again". Old keys
// are left in localStorage harmlessly.
const PERM_DISMISS_KEY  = "clr_push_nudge_perm_dismissed_v3";
const SNOOZE_KEY        = "clr_push_nudge_snoozed_until_v3";
const FIRST_SHOWN_KEY   = "clr_push_first_shown_v3";
// Re-nudge every 3 days after a "Later" — notifications are how leads, grab-it
// posts, and reminders reach the team, so we prompt persistently until on.
const SNOOZE_MS         = 3 * 24 * 60 * 60 * 1000;

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

export function PushNudge() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Unsupported browser
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

      // Browser-level permission already denied — no point nudging
      if (Notification.permission === "denied") return;

      // User permanently dismissed
      try {
        if (localStorage.getItem(PERM_DISMISS_KEY) === "1") return;
      } catch {}

      // Already enabled
      if (await isPushEnabled()) return;

      // Check snooze
      try {
        const until = parseInt(localStorage.getItem(SNOOZE_KEY) ?? "0", 10);
        if (Date.now() < until) return;
      } catch {}

      if (!cancelled) {
        // First ever load — show immediately, no delay
        let firstTime = false;
        try {
          if (localStorage.getItem(FIRST_SHOWN_KEY) === null) {
            localStorage.setItem(FIRST_SHOWN_KEY, "1");
            firstTime = true;
          }
        } catch {}
        // Show right away — a delayed nudge is easy to miss.
        void firstTime;
        setVisible(true);
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch {}
    setVisible(false);
  }

  function permDismiss() {
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
        if (perm === "denied") setVisible(false);
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
    >
      <div className="w-full pointer-events-auto rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-2xl overflow-hidden">
        {/* Accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-primary to-blue-500" />

        <div className="p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5 animate-pulse">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">🔔 Turn on notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                <strong className="text-foreground">Don't miss a lead.</strong> Notifications are how grab-it leads, appointment reminders, and team alerts reach you — even when C3 is closed. It takes one tap.
              </p>
            </div>
            <button
              onClick={snooze}
              aria-label="Remind me later"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded flex-shrink-0 -mt-0.5 -mr-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-0.5">
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
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={snooze}
              data-testid="button-push-nudge-later"
            >
              Later
            </Button>
            <button
              onClick={permDismiss}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap underline underline-offset-2"
              data-testid="button-push-nudge-never"
            >
              Don't ask again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
