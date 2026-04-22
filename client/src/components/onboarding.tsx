import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CheckCircle2, Circle, HelpCircle, Sparkles, X, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

// ── Storage helpers ──────────────────────────────────────────────────────────
function lsKey(userId: number | null | undefined, k: string) {
  return `wclcc_${k}_${userId ?? "anon"}`;
}
function lsGetBool(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
function lsSetBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? "1" : "0"); } catch {}
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86_400_000);
}

// ────────────────────────────────────────────────────────────────────────────
// 1. HelpIcon — "?" button + popover for every page
// ────────────────────────────────────────────────────────────────────────────
export function HelpIcon({ title, children }: { title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Help"
          title="What is this page?"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="relative z-[60] max-w-sm w-80 text-sm leading-relaxed p-4 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-lg backdrop-blur-none !opacity-100"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute top-2 right-2 p-1 rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {title && <p className="font-semibold mb-1 pr-4">{title}</p>}
        <div className="text-gray-600 dark:text-gray-400">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. PageTooltip — shows once per page per user, dismissible
// ────────────────────────────────────────────────────────────────────────────
export function PageTooltip({ pageKey, title, body }: { pageKey: string; title?: string; body: string }) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;
    const key = lsKey(user.id, `tooltip_shown_${pageKey}`);
    if (lsGetBool(key)) return;
    const t = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(t);
  }, [user, pageKey]);

  if (!visible || !user) return null;

  function dismiss() {
    lsSetBool(lsKey(user!.id, `tooltip_shown_${pageKey}`), true);
    setVisible(false);
  }

  return (
    <div
      className="fixed bottom-20 right-4 z-50 max-w-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl rounded-lg p-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="status"
    >
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 p-1 rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-2 pr-5">
        <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          {title && <p className="text-sm font-semibold mb-1 text-gray-900 dark:text-gray-100">{title}</p>}
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3. OnboardingChecklist — for accounts < 14 days old, until dismissed
// ────────────────────────────────────────────────────────────────────────────
type CheckItem = {
  id: string;
  label: string;
  href?: string;
  autoDetect?: () => boolean;
};

const CHECKLIST: CheckItem[] = [
  { id: "log_outcome",   label: "Log your first call outcome",    href: "/outcomes" },
  { id: "submit_eod",    label: "Submit your first EOD report",   href: "/eod-report" },
  { id: "view_assignments", label: "Check your daily LO assignments", href: "/assignments" },
  { id: "set_availability", label: "Set your availability (morning/afternoon)", href: "/settings" },
  { id: "read_glossary", label: "Read the Glossary",              href: "/glossary" },
  { id: "view_script",   label: "Explore the Call Script",        href: "/call-script" },
];

export function markOnboardingItem(userId: number | null | undefined, itemId: string) {
  if (!userId) return;
  lsSetBool(lsKey(userId, `onboarding_${itemId}`), true);
}

export function OnboardingChecklist() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 4000);
    return () => clearInterval(i);
  }, []);

  if (!user) return null;
  const dismissKey = lsKey(user.id, "onboarding_dismissed");
  if (lsGetBool(dismissKey)) return null;

  const age = daysSince(user.createdAt);
  if (age > 14) return null;

  // Do not show on the very first visit — mark "seen once" now; return null the first time.
  const seenOnceKey = lsKey(user.id, "onboarding_seen_once");
  if (!lsGetBool(seenOnceKey)) {
    lsSetBool(seenOnceKey, true);
    return null;
  }

  const completed = CHECKLIST.filter(i => lsGetBool(lsKey(user.id, `onboarding_${i.id}`)));
  const pct = Math.round((completed.length / CHECKLIST.length) * 100);
  const allDone = completed.length === CHECKLIST.length;

  function dismiss() {
    lsSetBool(dismissKey, true);
    setTick(t => t + 1);
  }

  // Force-rerender every ~4s pulls in localStorage changes from other pages (mark handlers)
  void tick;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Getting Started ({completed.length}/{CHECKLIST.length})</p>
              <p className="text-xs text-muted-foreground">
                {allDone ? "Nice work — you're ready to go." : "Finish these steps to get familiar with the app."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCollapsed(c => !c)}
              aria-label={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={dismiss}
              aria-label="Dismiss checklist"
              title="Dismiss — won't show again"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-3">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>

        {!collapsed && (
          <ul className="space-y-1.5">
            {CHECKLIST.map(item => {
              const done = lsGetBool(lsKey(user.id, `onboarding_${item.id}`));
              const Icon = done ? CheckCircle2 : Circle;
              const content = (
                <span className={`flex items-center gap-2 text-sm ${done ? "line-through text-muted-foreground" : ""}`}>
                  <Icon className={`h-4 w-4 flex-shrink-0 ${done ? "text-green-600" : "text-muted-foreground"}`} />
                  {item.label}
                </span>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      onClick={() => markOnboardingItem(user.id, item.id)}
                      className="block hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="px-2 py-1 -mx-2">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {allDone && !collapsed && (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={dismiss}>
            Dismiss — I'm all set
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4. SampleDataBanner + shouldShowSampleData
// ────────────────────────────────────────────────────────────────────────────
export const SAMPLE_STATS = {
  calls: 8,
  transfers: 2,
  appointments: 1,
  fellThrough: 1,
  callbacks: 1,
};

export function useSampleDataMode(realOutcomeCount: number): boolean {
  const { user, markSampleDismissed } = useAuth();

  // When real data appears, permanently mark dismissed on the server.
  useEffect(() => {
    if (!user) return;
    if (user.hasDismissedSample) return;
    if (realOutcomeCount <= 0) return;
    (async () => {
      try {
        await apiRequest("PATCH", `/api/users/${user.id}`, { hasDismissedSample: true });
        markSampleDismissed();
      } catch {}
    })();
  }, [user?.id, user?.hasDismissedSample, realOutcomeCount]);

  if (!user) return false;
  if (user.hasDismissedSample) return false;
  const age = daysSince(user.createdAt);
  if (age > 7) return false;
  if (realOutcomeCount > 0) return false;
  const dismissKey = lsKey(user.id, "sample_data_dismissed");
  if (lsGetBool(dismissKey)) return false;
  return true;
}

export function SampleDataBanner({ onDismiss }: { onDismiss?: () => void }) {
  const { user, markSampleDismissed } = useAuth();
  if (!user) return null;

  async function dismiss() {
    lsSetBool(lsKey(user!.id, "sample_data_dismissed"), true);
    try {
      await apiRequest("PATCH", `/api/users/${user!.id}`, { hasDismissedSample: true });
      markSampleDismissed();
    } catch {}
    onDismiss?.();
  }

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-3">
      <span className="text-amber-700 dark:text-amber-400 text-lg leading-none">⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Sample Data</p>
        <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
          These numbers are examples to help you get familiar. They'll disappear once you log your first real call.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
        onClick={dismiss}
      >
        Hide sample data
      </Button>
    </div>
  );
}

// Expose for pages that need to mark a step complete at action time
export function markStep(userId: number | null | undefined, step: "log_outcome" | "submit_eod" | "view_assignments" | "set_availability" | "read_glossary" | "view_script") {
  markOnboardingItem(userId, step);
}
