/**
 * PushNudge — biweekly in-app prompt to enable push notifications.
 *
 * Logic:
 * - Never shows if push is already enabled OR browser permission is denied.
 * - Never shows if the user has clicked "Don't ask again" (permanent dismiss).
 * - After a temporary dismiss ("Later"), re-appears after 14 days.
 * - Appears as a toast-style banner anchored above the bottom nav.
 */

import { useState, useEffect } from "react";
import { Bell, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

const PERM_DISMISS_KEY  = "clr_push_nudge_perm_dismissed";
const SNOOZE_KEY        = "clr_push_nudge_snoozed_until";
const FIRST_SHOWN_KEY   = "clr_push_first_shown";
const BIWEEKLY_MS       = 14 * 24 * 60 * 60 * 1000; // 14 days

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
  const [, navigate] = useLocation();

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
        if (firstTime) {
          setVisible(true);
        } else {
          // Small delay so the app settles before nudging
          setTimeout(() => { if (!cancelled) setVisible(true); }, 3000);
        }
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + BIWEEKLY_MS)); } catch {}
    setVisible(false);
  }

  function permDismiss() {
    try { localStorage.setItem(PERM_DISMISS_KEY, "1"); } catch {}
    setVisible(false);
  }

  function goToSettings() {
    snooze(); // reset snooze timer — they're going to try; re-nudge in 2w if they don't finish
    navigate("/settings");
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
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bell className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">Enable Push Notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Get instant alerts for goal hits, appointment reminders, and team announcements — even when the app is closed.
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
              className="h-8 text-xs gap-1.5 flex-1"
              onClick={goToSettings}
              data-testid="button-push-nudge-enable"
            >
              Go to Settings <ArrowRight className="w-3 h-3" />
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
