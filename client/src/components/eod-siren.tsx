import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAlarmFlash, prefersReducedMotion, startSiren } from "@/lib/alarm";
import { rescueDrafts, type RescuedDraft } from "@/lib/draft-rescue";

/**
 * 4:15pm, and today's EOD report is not in.
 *
 * This takes the whole screen and does not give it back. There is one button
 * and it goes to the EOD report; there is no dismiss, no "later", and no
 * escape key, because every one of those turns a wall into a speed bump.
 * The gate around it lets exactly one route through, so closing this by
 * navigating elsewhere is not possible either.
 *
 * What it deliberately DOES allow:
 *
 *  - Silencing the noise for two minutes at a time. A CLR on a live call with
 *    a borrower needs to stop the wailing without abandoning the call. The
 *    screen keeps flashing and the report is still required; only the sound
 *    stops, and it comes back.
 *  - A steady screen instead of a flashing one for anyone whose system asks
 *    for reduced motion. Still a takeover, just not a strobe.
 *
 * Before any of it appears, whatever was on screen is snapshotted — see
 * draft-rescue. Blanking someone's half-finished transfer as a punishment for
 * a late report is how a tool earns real resentment.
 */

const SILENCE_MS = 2 * 60 * 1000;

export function EodSiren({ date, onGo }: { date: string; onGo: () => void }) {
  const [silencedUntil, setSilencedUntil] = useState(0);
  const [, forceTick] = useState(0);
  const flashOn = useAlarmFlash(true);
  const reduced = prefersReducedMotion();
  const stopRef = useRef<(() => void) | null>(null);

  // Snapshot before anything else. Runs once: a second sweep after the
  // takeover has rendered would only ever capture this screen's own controls.
  const rescued = useMemo<RescuedDraft | null>(
    () => rescueDrafts("EOD report alarm at 4:15pm"),
    [],
  );

  const silenced = silencedUntil > Date.now();

  // Re-render when the silence lapses, or the button would still read
  // "silenced" long after the noise came back.
  useEffect(() => {
    if (!silenced) return;
    const id = setTimeout(() => forceTick((n) => n + 1), Math.max(250, silencedUntil - Date.now()));
    return () => clearTimeout(id);
  }, [silenced, silencedUntil]);

  useEffect(() => {
    if (silenced) {
      if (stopRef.current) { stopRef.current(); stopRef.current = null; }
      return;
    }
    stopRef.current = startSiren(0.13);
    return () => { if (stopRef.current) { stopRef.current(); stopRef.current = null; } };
  }, [silenced]);

  // Keyboard cannot be the way out. Escape, in particular, is the reflex.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const bg = reduced
    ? "bg-red-700"
    : flashOn ? "bg-red-600" : "bg-red-900";

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-colors duration-150 ${bg}`}
      role="alertdialog"
      aria-modal="true"
      aria-label="Your EOD report is required now"
      data-testid="eod-siren"
    >
      <div className="w-full max-w-lg rounded-xl border-2 border-white/70 bg-black/45 p-6 text-white shadow-2xl">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 shrink-0" />
          <div>
            <h2 className="text-xl font-bold leading-tight">Your EOD report is not in.</h2>
            <p className="text-sm text-white/80">It was due at 4:00pm. It is now past 4:15.</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-white/90">
          C3 is closed until the report is filed. There is nothing else to do here.
        </p>

        {/* Say so plainly, or the takeover reads as "your work is gone". */}
        {rescued && (
          <div className="mt-4 flex items-start gap-2 rounded-md bg-white/15 px-3 py-2 text-xs"
            data-testid="eod-siren-rescued">
            <Save className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{Object.keys(rescued.fields).length} field
              {Object.keys(rescued.fields).length === 1 ? "" : "s"} saved.</strong>{" "}
              What you were typing on {rescued.route} is kept and will be offered back
              once the report is in.
            </span>
          </div>
        )}

        <Button
          onClick={onGo}
          size="lg"
          className="mt-5 w-full gap-2 bg-white text-red-700 hover:bg-white/90"
          data-testid="eod-siren-go"
        >
          Fill out my EOD report <ArrowRight className="h-4 w-4" />
        </Button>

        <button
          type="button"
          onClick={() => setSilencedUntil(Date.now() + SILENCE_MS)}
          disabled={silenced}
          data-testid="eod-siren-silence"
          className="mt-3 w-full rounded-md border border-white/40 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10 disabled:opacity-60"
        >
          {silenced ? "Silenced — the noise comes back in two minutes" : "Silence the noise for two minutes"}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-white/70">
          Silencing stops the sound only. The report is still required.
        </p>
      </div>
    </div>
  );
}
