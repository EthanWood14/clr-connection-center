/** Celebrate only in the browser that successfully logged the transfer. */
import { useCallback, useEffect, useRef, useState } from "react";
import { GoalCelebration } from "@/components/goal-celebration";

export const TRANSFER_CELEBRATION_EVENT = "c3-transfer-logged";

type TransferCelebrationDetail = { headline?: string; message?: string };
let audioCtx: AudioContext | null = null;

function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    void audioCtx.resume();
    const start = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.16;
    master.connect(audioCtx.destination);
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const oscillator = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      const at = start + index * 0.09;
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.55);
      oscillator.connect(gain).connect(master);
      oscillator.start(at);
      oscillator.stop(at + 0.6);
    });
  } catch {}
}

export function TransferCelebration() {
  const sequence = useRef(0);
  const [current, setCurrent] = useState<(TransferCelebrationDetail & { id: number }) | null>(null);

  useEffect(() => {
    const celebrate = (event: Event) => {
      const detail = (event as CustomEvent<TransferCelebrationDetail>).detail ?? {};
      setCurrent({ ...detail, id: ++sequence.current });
    };
    window.addEventListener(TRANSFER_CELEBRATION_EVENT, celebrate);
    return () => window.removeEventListener(TRANSFER_CELEBRATION_EVENT, celebrate);
  }, []);

  useEffect(() => { if (current) playChime(); }, [current?.id]);
  const dismiss = useCallback(() => setCurrent(null), []);

  return (
    <GoalCelebration
      show={!!current}
      onClose={dismiss}
      headline={current?.headline ?? "🎉 Transfer logged!"}
      subline={current?.message ?? "You landed a transfer. Keep the momentum going!"}
      buttonLabel="Keep it rolling"
      variant="transfer"
    />
  );
}
