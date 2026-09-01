import { createContext, useContext, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { DailyReportGateActive } from "@/components/daily-report-gate";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { EodSiren } from "@/components/eod-siren";

type EodNagStage = "none" | "due" | "siren";

interface LockStatus {
  locked: boolean;
  missingDates: string[];
  today?: {
    date: string;
    submitted: boolean;
    stage: EodNagStage;
    chime: boolean;
    chimeIntervalMs: number;
  };
}

/**
 * A short two-tone chime, synthesised rather than shipped as an audio file so
 * there is nothing extra to download and nothing to 404. Deliberately not
 * pleasant: it exists to be noticed. Silently does nothing if the browser has
 * not yet been interacted with, which is the correct behaviour rather than an
 * error — the banner is still on screen either way.
 */
function playNagChime() {
  try {
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") { void ctx.resume?.(); }
    const now = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const at = now + i * 0.22;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(at); osc.stop(at + 0.22);
    });
    setTimeout(() => { try { void ctx.close(); } catch { /* already closed */ } }, 1200);
  } catch { /* audio is a bonus, never a requirement */ }
}

// One rung before the alarm, and it says exactly how long is left. A warning
// that does not name the deadline is just a colour.
const STAGE_STYLE: Record<"due", { cls: string; text: string }> = {
  due: {
    cls: "bg-amber-500/15 border-amber-500/50 text-amber-900 dark:text-amber-100",
    text: "Your EOD report for today is due. At 4:15 the app locks and an alarm sounds.",
  },
};

/** Pinned, undismissable, and it gets louder. */
function EodNagBanner({ stage, chime, chimeIntervalMs, onGo }: {
  stage: "due";
  chime: boolean;
  chimeIntervalMs: number;
  onGo: () => void;
}) {
  const style = STAGE_STYLE[stage];
  const fired = useRef(false);

  useEffect(() => {
    if (!chime) return;
    // One immediately on reaching the rung, then on an interval.
    if (!fired.current) { fired.current = true; playNagChime(); }
    const id = setInterval(playNagChime, Math.max(60_000, chimeIntervalMs));
    return () => clearInterval(id);
  }, [chime, chimeIntervalMs]);

  return (
    <div
      className={"sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b-2 px-4 py-2.5 " + style.cls}
      data-testid={"eod-nag-" + stage}
      role="alert"
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {style.text}
      </span>
      <Button size="sm" onClick={onGo} className="gap-1.5">
        Fill it out now <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// Shotgun uses this to suspend offers while a CLR is completing a mandatory
// report. Keeping the children mounted lets the alert immediately release an
// already-open offer instead of waiting for its heartbeat to go stale.
export const EodLockGateActive = createContext(false);

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function EodLockGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [location, navigate] = useLocation();
  const outerGateActive = useContext(DailyReportGateActive);

  const isClr = !!(user && (user.role === "assistant" || (user.role === "admin" && (user as any).isClr)));

  const { data, isLoading } = useQuery<LockStatus>({
    queryKey: ["/api/auth/eod-lock-status"],
    enabled: !!user && !authLoading && isClr,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
  });

  // Only one visible gate may hold the screen. While the daily report gate is
  // up, this one stands down; that outer gate already suspends Shotgun.
  const lockActive = !outerGateActive && !authLoading && !isLoading && !!user && isClr && !!data?.locked;
  // Always allow the EOD Report tab through so the user can unlock themselves,
  // but keep Shotgun suspended until the missing report is actually complete.
  const showOverlay = lockActive && location !== "/eod-report";
  const oldestMissing = data?.missingDates?.[0] ?? "";
  const today = data?.today;
  // The banner covers the rungs before the lock; past that the overlay takes
  // over and a banner behind it would be pointless.
  const nagStage = today?.stage ?? "none";
  const showBanner = !authLoading && !isLoading && !!user && isClr && !outerGateActive
    && !showOverlay && location !== "/eod-report" && nagStage === "due";
  // TODAY's report being the thing missing is what the siren is for. Older
  // missing reports keep the calm overlay — somebody catching up on last
  // Tuesday does not need a siren, and would rightly ignore one that fired
  // every time they opened the app.
  const showSiren = showOverlay && nagStage === "siren" && !today?.submitted;

  return (
    <EodLockGateActive.Provider value={lockActive}>
      {showBanner && (
        <EodNagBanner
          stage="due"
          chime={!!today?.chime}
          chimeIntervalMs={today?.chimeIntervalMs ?? 600000}
          onGo={() => navigate(`/eod-report?date=${today?.date ?? ""}`)}
        />
      )}
      <div className={showOverlay ? "pointer-events-none select-none blur-sm opacity-40 overflow-hidden h-screen" : "contents"}>{children}</div>
      {showSiren && (
        <EodSiren
          date={today?.date ?? ""}
          onGo={() => navigate(`/eod-report?date=${today?.date ?? ""}`)}
        />
      )}
      {showOverlay && !showSiren && <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/95 backdrop-blur-sm">
      <div className="max-w-md w-full rounded-xl border-2 border-amber-500/60 bg-card shadow-2xl">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold">App Access Locked</h2>
          </div>

          <p className="text-sm text-muted-foreground">
            {data!.missingDates.length === 0
              ? "Today's EOD report was due at 4:00 PM. The app stays locked until it's in."
              : `You haven't submitted your EOD report for the following day${data!.missingDates.length === 1 ? "" : "s"}:`}
          </p>

          <ul className="rounded-lg border bg-muted/40 divide-y overflow-hidden">
            {(data!.missingDates.length ? data!.missingDates : [today?.date ?? ""]).filter(Boolean).map((d) => (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => navigate(`/eod-report?date=${d}`)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium tabular-nums hover:bg-muted/70 transition-colors"
                >
                  <span>{formatDate(d)}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>

          <p className="text-sm text-muted-foreground">
            {data!.missingDates.length > 1
              ? "Click any date above to jump to that day. Start with the oldest."
              : "Click the date above to fill out that day's report."}
          </p>

          <Button
            onClick={() => navigate(`/eod-report?date=${oldestMissing || today?.date || ""}`)}
            className="w-full gap-2"
            size="lg"
          >
            Go to {data!.missingDates.length === 1 ? "EOD Report" : "Oldest Missing Report"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
      </div>}
    </EodLockGateActive.Provider>
  );
}
