/**
 * CookieNotice — California CCPA-aware cookie disclosure banner.
 *
 * Context: CLR Connection Center is an internal workforce tool for West Capital
 * Lending employees. Under CCPA, employee/HR data collected in the course of
 * employment is exempt from the consumer-facing opt-out and deletion rights
 * (Cal. Civ. Code §1798.145(m)). No third-party tracking or advertising cookies
 * are used — only strictly necessary functional cookies and localStorage.
 *
 * Because all storage is "strictly necessary" (authentication + UI state), no
 * opt-in consent is required. This banner is a transparency notice only,
 * satisfying CCPA §1798.100's "right to know" disclosure requirement and
 * general best-practice for internal tools.
 *
 * Shown once per browser until dismissed. Stored in localStorage so it
 * survives session reloads without re-appearing.
 */

import { useState, useEffect } from "react";
import { Cookie, X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const STORAGE_KEY = "clr_cookie_notice_v1";

export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Small delay so it doesn't flash in before the app loads
        const t = setTimeout(() => setVisible(true), 800);
        return () => clearTimeout(t);
      }
    } catch {
      // localStorage blocked (private mode etc) — skip silently
    }
  }, []);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie and storage notice"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-[9999] p-3 sm:p-4 md:bottom-4 md:left-4 md:right-auto md:max-w-sm"
    >
      <div className="rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-xl p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Cookie className="w-3.5 h-3.5 text-primary" />
            </div>
            <p className="text-sm font-semibold text-foreground">Cookie &amp; Storage Notice</p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss cookie notice"
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          CLR Connection Center uses <strong className="text-foreground">strictly necessary</strong> cookies
          and browser storage to keep you logged in and save your UI preferences (e.g. timezone, active tab).
          No tracking, advertising, or third-party cookies are used.
        </p>

        {/* CA disclosure callout */}
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 border border-border/60 px-3 py-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground">California Residents (CCPA):</strong> As an internal workforce
            tool, your data rights are governed by your employment relationship with West Capital Lending.
            Contact your manager or{" "}
            <a
              href="mailto:reports@westcapitallending.center"
              className="underline hover:text-foreground"
            >
              reports@westcapitallending.center
            </a>{" "}
            for data requests.
          </p>
        </div>

        {/* Storage breakdown */}
        <div className="space-y-1.5 border-t border-border/50 pt-2.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">What&apos;s stored</p>
          <div className="grid gap-1">
            {[
              { name: "clr_session",        type: "Cookie",       purpose: "Keeps you authenticated (httpOnly, signed)" },
              { name: "UI preferences",     type: "localStorage", purpose: "Timezone, active tab, dashboard settings" },
              { name: "Chat read state",    type: "localStorage", purpose: "Which messages you've already seen" },
              { name: "Session UI state",   type: "sessionStorage", purpose: "Splash screen, dismissed banners (cleared on tab close)" },
            ].map(item => (
              <div key={item.name} className="flex items-start gap-2 text-[11px]">
                <span className={`mt-0.5 px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wide flex-shrink-0 ${
                  item.type === "Cookie"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    : item.type === "localStorage"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                }`}>
                  {item.type === "localStorage" ? "local" : item.type === "sessionStorage" ? "session" : item.type}
                </span>
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{item.name}</span>
                  <span className="text-muted-foreground"> — {item.purpose}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Link href="/privacy-policy">
            <a className="text-[11px] text-muted-foreground underline hover:text-foreground transition-colors">
              Privacy Policy
            </a>
          </Link>
          <Button
            size="sm"
            className="h-7 text-xs px-4"
            onClick={dismiss}
            data-testid="button-cookie-accept"
          >
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
