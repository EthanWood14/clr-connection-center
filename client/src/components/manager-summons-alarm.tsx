import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { AlertTriangle } from "lucide-react";
import { startSiren, ALARM_FLASH_MS, prefersReducedMotion } from "@/lib/alarm";

/**
 * "Go see your manager."
 *
 * When a manager calls someone in, that person's C3 becomes impossible to
 * ignore until a MANAGER clears it. The person being summoned cannot dismiss
 * it — that is the entire point; a dismissable one is just a notification.
 *
 * Two deliberate limits on how far the "crazy" goes:
 *
 *  - The flash is capped at 2Hz. Anything above three flashes per second is a
 *    seizure risk for photosensitive epilepsy, and this fires on a whole
 *    floor's screens without warning. It is a slow, full-screen colour slam
 *    rather than a fast strobe, which is at least as hard to ignore.
 *  - Anyone who has asked their system for reduced motion gets a steady
 *    high-contrast screen instead of a flashing one. It still takes the app
 *    over completely; it just does not pulse.
 *
 * The siren can be silenced for two minutes at a time. That does NOT clear the
 * alarm — the screen keeps going and a manager still has to stand it down —
 * but a CLR mid-call with a borrower needs a way to stop the noise without
 * abandoning the call. Silencing mutes the video too, or "silence" would be a
 * lie.
 *
 * A video plays as the centrepiece. Browsers refuse to autoplay audio before
 * the page has been interacted with, so it asks for sound and falls back to
 * muted playback rather than to no video at all — and the siren stays loud in
 * that case, because something has to make the noise. Once the video IS
 * audible the siren drops to a background growl so it does not talk over it.
 */

interface Summons {
  id: number;
  reason: string;
  raised_by_name: string;
  raised_at: string;
}

const SILENCE_MS = 2 * 60 * 1000;

export function ManagerSummonsAlarm() {
  const { user } = useAuth();
  const [silencedUntil, setSilencedUntil] = useState(0);
  const [flashOn, setFlashOn] = useState(false);
  // Browsers refuse to autoplay audio until the page has been interacted with.
  // If the video ends up muted we still need noise, so the siren stays loud;
  // once the video is actually audible the siren drops to a background growl.
  const [videoAudible, setVideoAudible] = useState(false);
  const stopSirenRef = useRef<(() => void) | null>(null);
  const sirenLevelRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { data } = useQuery<{ active: boolean; summons: Summons | null }>({
    queryKey: ["/api/summons/mine"],
    enabled: !!user,
    // Short poll: being called in is urgent, and this is one tiny row.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const active = !!data?.active && !!data.summons;
  const reducedMotion = prefersReducedMotion();
  const silenced = silencedUntil > Date.now();

  // The flash. Rate lives in lib/alarm so both alarms share one number —
  // it is a seizure-safety property, not a styling choice.
  useEffect(() => {
    if (!active || reducedMotion) { setFlashOn(false); return; }
    const id = setInterval(() => setFlashOn((v) => !v), ALARM_FLASH_MS);
    return () => clearInterval(id);
  }, [active, reducedMotion]);

  // The siren, and stopping it the moment the alarm clears or is silenced.
  useEffect(() => {
    const shouldSound = active && !silenced;
    // Quiet enough to sit under the video, loud enough to carry a room alone.
    const level = videoAudible ? 0.03 : 0.13;
    if (shouldSound && (!stopSirenRef.current || sirenLevelRef.current !== level)) {
      if (stopSirenRef.current) stopSirenRef.current();
      sirenLevelRef.current = level;
      stopSirenRef.current = startSiren(level);
    } else if (!shouldSound && stopSirenRef.current) {
      stopSirenRef.current();
      stopSirenRef.current = null;
      sirenLevelRef.current = 0;
    }
    return () => {
      if (stopSirenRef.current) { stopSirenRef.current(); stopSirenRef.current = null; sirenLevelRef.current = 0; }
    };
  }, [active, silenced, videoAudible]);

  // Try for sound; fall back to muted playback rather than no video at all.
  useEffect(() => {
    const v = videoRef.current;
    if (!active || !v) { setVideoAudible(false); return; }
    let cancelled = false;
    (async () => {
      try {
        v.muted = false;
        v.volume = 1;
        await v.play();
        if (!cancelled) setVideoAudible(true);
      } catch {
        try {
          v.muted = true;
          await v.play();
        } catch { /* the flashing and the siren still do the job */ }
        if (!cancelled) setVideoAudible(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active]);

  // Silencing has to mute the video too, or "silence" would be a lie.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (silenced) { v.muted = true; setVideoAudible(false); }
  }, [silenced]);

  // Re-render when a silence window runs out so the siren picks back up.
  useEffect(() => {
    if (!silenced) return;
    const id = setTimeout(() => setSilencedUntil(0), Math.max(0, silencedUntil - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [silenced, silencedUntil]);

  if (!active || !data?.summons) return null;
  const s = data.summons;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{
        backgroundColor: reducedMotion ? "#7f1d1d" : (flashOn ? "#dc2626" : "#450a0a"),
        transition: reducedMotion ? undefined : "background-color 220ms linear",
      }}
      role="alertdialog"
      aria-live="assertive"
      aria-label="Go see your manager"
      data-testid="manager-summons-alarm"
    >
      <div className="w-full max-w-2xl rounded-2xl border-4 border-white/80 bg-black/70 p-6 text-center shadow-2xl">
        {/* The video is the loud part. The flashing is pulled back to the frame
            around it so the two are not fighting for the same pixels. */}
        <video
          ref={videoRef}
          src="/summons.mp4"
          loop
          playsInline
          controls={false}
          // Sized to its own aspect ratio — a portrait clip stretched across a
          // landscape box is mostly black bars.
          className="mx-auto max-h-[48vh] w-auto max-w-full rounded-lg bg-black"
          data-testid="summons-video"
        />
        <div className="mt-4 flex items-center justify-center gap-3">
          <AlertTriangle
            className="h-10 w-10 shrink-0 text-white"
            style={{ opacity: reducedMotion ? 1 : (flashOn ? 1 : 0.45) }}
          />
          <h1 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
            Go see your manager
          </h1>
        </div>
        <p className="mt-2 text-lg font-semibold text-white/90" data-testid="summons-who">
          {s.raised_by_name || "A manager"} is asking for you — now.
        </p>
        {s.reason && (
          <p className="mt-2 rounded-lg bg-white/15 px-3 py-2 text-base text-white" data-testid="summons-reason">
            {s.reason}
          </p>
        )}
        <p className="mt-4 text-sm text-white/80">
          This clears when a manager marks you as checked in. You cannot close it yourself.
        </p>
        <button
          type="button"
          onClick={() => setSilencedUntil(Date.now() + SILENCE_MS)}
          disabled={silenced}
          className="mt-4 rounded-lg border-2 border-white/70 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50"
          data-testid="summons-silence"
        >
          {silenced ? "Sound off for 2 minutes" : "Silence the sound for 2 minutes"}
        </button>
        <p className="mt-2 text-xs text-white/70">
          Silencing stops the noise only — if you are on a call, finish it and go.
        </p>
      </div>
    </div>
  );
}
