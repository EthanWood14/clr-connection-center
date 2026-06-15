/**
 * TransferCelebration — org-wide hype for every transfer. 🎉
 *
 * The server records every transfer in an ephemeral in-memory feed (NOT the
 * notifications table — those clog the bell). This component polls that feed
 * (/api/transfer-celebrations), and when a new celebration appears it plays a
 * happy chime and pops a festive toast — on every open client.
 *
 * Sound notes:
 * - The chime is synthesized with WebAudio (no audio file to load).
 * - Browsers block audio until the user has interacted with the page, so we
 *   unlock an AudioContext on the first pointer/key interaction. If a
 *   celebration lands before any interaction, the toast still shows silently.
 * - Last-processed notification id is persisted per user in localStorage so
 *   reloading doesn't replay old celebrations.
 */

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

const lastKey = (uid: number) => `clr_transfer_celebrate_last_v2_${uid}`;

// ── WebAudio chime ────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
let unlocked = false;

function ensureUnlockListeners() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") void audioCtx.resume();
      unlocked = true;
    } catch {}
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

// Bright ascending arpeggio (C5 E5 G5 C6) with a sparkle on top.
function playChime() {
  try {
    if (!audioCtx || !unlocked) return;
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.16;
    master.connect(audioCtx.destination);
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = t0 + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(1, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + 0.6);
    });
    // sparkle
    const spark = audioCtx.createOscillator();
    const sparkGain = audioCtx.createGain();
    spark.type = "sine";
    spark.frequency.setValueAtTime(2093, t0 + 0.36);
    sparkGain.gain.setValueAtTime(0, t0 + 0.36);
    sparkGain.gain.linearRampToValueAtTime(0.5, t0 + 0.38);
    sparkGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    spark.connect(sparkGain).connect(master);
    spark.start(t0 + 0.36);
    spark.stop(t0 + 0.95);
  } catch {}
}

// ── Component ────────────────────────────────────────────────────────────────
export function TransferCelebration() {
  const { user } = useAuth();
  const { toast } = useToast();
  const uid = user?.id ?? 0;
  const initializedRef = useRef(false);

  useEffect(() => { ensureUnlockListeners(); }, []);

  const { data } = useQuery<{ items: any[]; latestId: number }>({
    queryKey: ["/api/transfer-celebrations"],
    enabled: uid > 0,
    refetchInterval: 20000, // org-wide celebrations land within ~20s
  });

  useEffect(() => {
    if (!uid || !data) return;
    const items = Array.isArray(data.items) ? data.items : [];
    const latest = Number(data.latestId) || 0;

    let last = 0;
    try { last = parseInt(localStorage.getItem(lastKey(uid)) ?? "", 10) || 0; } catch {}

    // First load of this browser: baseline to latest without replaying history.
    if (!initializedRef.current && last === 0) {
      initializedRef.current = true;
      try { localStorage.setItem(lastKey(uid), String(latest)); } catch {}
      return;
    }
    initializedRef.current = true;

    const fresh = items
      .filter((c: any) => (Number(c.id) || 0) > last)
      .sort((a: any, b: any) => (Number(a.id) || 0) - (Number(b.id) || 0))
      .slice(-3); // never spam more than 3 at once

    if (fresh.length === 0) {
      // Keep the cursor moving even when the new celebrations were for other orgs.
      if (latest > last) { try { localStorage.setItem(lastKey(uid), String(latest)); } catch {} }
      return;
    }

    const newLast = Math.max(latest, ...fresh.map((c: any) => Number(c.id) || 0));
    try { localStorage.setItem(lastKey(uid), String(newLast)); } catch {}

    playChime();
    fresh.forEach((c: any, i: number) => {
      setTimeout(() => {
        toast({ title: c.title ?? "🎉 Transfer!", description: (c.message ?? "") + " 🎊", duration: 6000 });
      }, i * 700);
    });
  }, [data, uid, toast]);

  return null;
}
