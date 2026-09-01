/**
 * The parts of an alarm that must only exist once.
 *
 * Two alarms now take the screen over — a manager calling someone in, and an
 * unfiled EOD report at 4:15. The flash rate is a safety property, not a
 * styling choice: above three flashes per second, full-screen flashing content
 * is a seizure risk for photosensitive epilepsy, and these fire on a whole
 * floor's screens with no warning. Two copies of that number is one copy too
 * many, so both alarms import this.
 */
import { useEffect, useState } from "react";

/** Comfortably under the three-per-second seizure threshold. */
export const ALARM_FLASH_MS = 500;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A 2Hz on/off flag for a full-screen colour slam.
 *
 * Returns a steady `false` for anyone who has asked their system for reduced
 * motion — they still get the takeover, it just does not pulse.
 */
export function useAlarmFlash(active: boolean): boolean {
  const reduced = prefersReducedMotion();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active || reduced) { setOn(false); return; }
    const id = setInterval(() => setOn((v) => !v), ALARM_FLASH_MS);
    return () => clearInterval(id);
  }, [active, reduced]);
  return on;
}

/**
 * A two-tone siren that keeps wailing until it is told to stop.
 *
 * `level` lets it drop right back when something else is carrying the noise —
 * the point is to be impossible to ignore, not to drown out the thing the
 * alarm is showing you.
 */
export function startSiren(level: number): () => void {
  let ctx: AudioContext | null = null;
  let stopped = false;
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return () => {};
    ctx = new Ctx();
    void ctx.resume?.();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    gain.gain.value = level;
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Sweep between two pitches forever — the shape of an actual siren.
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(620, now);
    for (let i = 0; i < 600; i += 1) {
      const at = now + i * 0.9;
      osc.frequency.linearRampToValueAtTime(i % 2 === 0 ? 980 : 620, at + 0.45);
      osc.frequency.linearRampToValueAtTime(i % 2 === 0 ? 620 : 980, at + 0.9);
    }
    osc.start();
    return () => {
      if (stopped) return;
      stopped = true;
      try { osc.stop(); } catch { /* already stopped */ }
      try { void ctx?.close(); } catch { /* already closed */ }
    };
  } catch {
    return () => { try { void ctx?.close(); } catch { /* nothing to close */ } };
  }
}

/**
 * Run a siren for as long as `active` says so, at `level`, and always stop it
 * on unmount. Both alarms got this wrong independently at first: a siren whose
 * stop function is lost keeps playing after the component is gone.
 */
export function useSiren(active: boolean, level: number): void {
  useEffect(() => {
    if (!active) return;
    const stop = startSiren(level);
    return () => stop();
  }, [active, level]);
}
