/**
 * The hype screen.
 *
 * A moment lands on the wall as one enormous word: it falls, hits, squashes,
 * rebounds, and the names arrive under it. Rays turn behind it, a shockwave
 * goes out from the impact, and the wins throw confetti.
 *
 * It was briefly a cartoon — an ACME anvil dropping on the word, a banana
 * peel, a portable hole, an alarm clock walking on and knocking a chair over.
 * Ethan asked for that, saw it, and asked for it gone, so the props and their
 * choreography are out. What is left is the part that reads from across a
 * noisy floor in one glance: type, colour, and a single clean hit.
 *
 * SAFETY. It is a wall the whole floor faces all day. Nothing flashes: the
 * impact is a positional shake, never a full-screen luminance change, and the
 * only loop is a 24-second ray spin. Reduced motion collapses every scene to
 * a still frame.
 *
 * MECHANICS. One mount, delays and keyframes only. Nothing mounts on a timer:
 * a motion element that mounts while its parent is already exiting registers
 * with presence after the exit was dispatched and never reports done, which
 * once left a scene stuck on screen at opacity 0.
 */
import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Transition } from "framer-motion";

export type HypeKind = "transfer" | "appointment" | "rescheduled" | "fell_through" | "missed_appointment" | "milestone";

/** When the big word lands, in ms from mount. The crash in tv.tsx keys off this. */
export const HYPE_IMPACT_MS: Record<HypeKind, number> = {
  transfer: 700, appointment: 700, rescheduled: 620, fell_through: 650, missed_appointment: 700, milestone: 750,
};

/** Where the word's feet sit, as a percentage of screen height. */
const FLOOR = 62;

const WORD: Record<HypeKind, string> = {
  transfer: "TRANSFER!", appointment: "BOOKED!", rescheduled: "REBOOKED",
  fell_through: "FELL THROUGH", missed_appointment: "NO-SHOW", milestone: "MILESTONE!",
};

const KICKER: Record<HypeKind, string> = {
  transfer: "LIVE TRANSFER", appointment: "MEETING SET", rescheduled: "MEETING REBOOKED",
  fell_through: "IT HAPPENS", missed_appointment: "MISSED APPOINTMENT", milestone: "TEAM MILESTONE",
};

/** The wins throw confetti; the rest get the word and the colour. */
const CONFETTI: Record<HypeKind, boolean> = {
  transfer: true, appointment: true, rescheduled: false,
  fell_through: false, missed_appointment: false, milestone: true,
};

interface Look { main: string; deep: string; ray: string; ink: string; bits: string[] }
const LOOK: Record<HypeKind, Look> = {
  transfer:           { main: "#FDE047", deep: "#B45309", ray: "#F59E0B", ink: "#451A03", bits: ["#FDE047", "#F59E0B", "#FFFFFF", "#FB923C"] },
  appointment:        { main: "#7DD3FC", deep: "#0369A1", ray: "#0EA5E9", ink: "#082F49", bits: ["#7DD3FC", "#38BDF8", "#FFFFFF", "#A5F3FC"] },
  rescheduled:        { main: "#5EEAD4", deep: "#0F766E", ray: "#14B8A6", ink: "#042F2E", bits: ["#5EEAD4", "#2DD4BF", "#FFFFFF"] },
  fell_through:       { main: "#FDA4AF", deep: "#9F1239", ray: "#E11D48", ink: "#4C0519", bits: ["#FB7185", "#E11D48", "#9F1239"] },
  missed_appointment: { main: "#FDBA74", deep: "#C2410C", ray: "#F97316", ink: "#431407", bits: ["#FDBA74", "#F97316", "#FFFFFF"] },
  milestone:          { main: "#FEF3C7", deep: "#B45309", ray: "#FBBF24", ink: "#451A03", bits: ["#FDE047", "#F59E0B", "#FFFFFF", "#F472B6", "#60A5FA", "#4ADE80"] },
};

const STILL: Transition = { duration: 0.3 };

/** Deterministic noise, so a scene looks the same every time it plays. */
function rnd(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function wordStyle(word: string, look: Look): CSSProperties {
  return {
    fontSize: `min(13vw, ${(118 / word.length).toFixed(1)}vw)`,
    lineHeight: 0.9,
    letterSpacing: "-0.03em",
    color: look.main,
    WebkitTextStroke: `0.045em ${look.ink}`,
    textShadow: `0.05em 0.05em 0 ${look.deep}, 0.1em 0.1em 0 ${look.ink}, 0 0 0.5em ${look.ray}`,
  };
}

// ── the stage ───────────────────────────────────────────────────────────────

/** A sunburst behind everything, turning slowly. The only loop in the file. */
function Rays({ look, reduced }: { look: Look; reduced: boolean }) {
  const n = 22;
  const rays = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2;
    return `0,0 ${(Math.cos(a0) * 1400).toFixed(0)},${(Math.sin(a0) * 1400).toFixed(0)} ${(Math.cos(a1) * 1400).toFixed(0)},${(Math.sin(a1) * 1400).toFixed(0)}`;
  });
  return (
    <motion.div
      className="absolute left-1/2 top-1/2"
      style={{ width: "170vmax", height: "170vmax", marginLeft: "-85vmax", marginTop: "-85vmax" }}
      initial={reduced ? false : { opacity: 0, scale: 0.3 }}
      animate={{ opacity: 0.4, scale: 1 }}
      transition={reduced ? STILL : { delay: 0.05, duration: 0.5, ease: "circOut" }}
    >
      <svg viewBox="-1000 -1000 2000 2000" className="h-full w-full" style={{ animation: reduced ? "none" : "hype-spin 24s linear infinite" }}>
        {rays.map((p, i) => <polygon key={i} points={p} fill={look.ray} opacity={0.35} />)}
      </svg>
    </motion.div>
  );
}

/** Shockwave rings from the point of impact. */
function Rings({ look, at, reduced, count = 3 }: { look: Look; at: number; reduced: boolean; count?: number }) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 rounded-full"
          style={{ top: `${FLOOR}%`, width: 240, height: 240, marginLeft: -120, marginTop: -120, border: `6px solid ${look.main}` }}
          initial={{ scale: 0, opacity: 0.9 }}
          animate={{ scale: 9, opacity: 0 }}
          transition={{ delay: at + i * 0.16, duration: 1.2, ease: "easeOut" }}
        />
      ))}
    </>
  );
}

/** A fountain of bits thrown up out of the impact. */
function Burst({ look, at, reduced, count = 56, spread = 900, seed = 1 }: {
  look: Look; at: number; reduced: boolean; count?: number; spread?: number; seed?: number;
}) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = -Math.PI / 2 + (rnd(seed + i) - 0.5) * 2.1;
        const r = (0.35 + rnd(seed + i + 1000) * 0.65) * spread;
        const size = 8 + rnd(seed + i + 2000) * 18;
        return (
          <motion.div
            key={i}
            className="absolute"
            style={{ left: "50%", top: `${FLOOR}%`, width: size, height: size, background: look.bits[i % look.bits.length], borderRadius: rnd(seed + i + 3000) > 0.5 ? "50%" : 2 }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
            animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r + 190, scale: [0, 1.4, 1, 0.5], rotate: rnd(seed + i + 4000) * 720 - 360, opacity: [1, 1, 1, 0] }}
            transition={{ delay: at + rnd(seed + i + 5000) * 0.12, duration: 1.2 + rnd(seed + i + 6000) * 0.9, ease: "circOut" }}
          />
        );
      })}
    </>
  );
}

function Kicker({ kind, look, reduced }: { kind: HypeKind; look: Look; reduced: boolean }) {
  return (
    <motion.div
      className="absolute left-0 right-0 top-[6%] mx-auto w-max rounded-full px-[2.2vw] py-[0.7vw] text-[2vw] font-black tracking-[0.35em] text-white"
      style={{ background: look.deep, boxShadow: `0 0 40px ${look.ray}` }}
      initial={reduced ? false : { y: -220, opacity: 0, rotate: -6 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={reduced ? STILL : { delay: 0.05, type: "spring", stiffness: 300, damping: 18 }}
    >
      ✦ {KICKER[kind]} ✦
    </motion.div>
  );
}

function Captions({ headline, who, detail, look, at, reduced, big }: {
  headline: string; who: string; detail: string | null; look: Look; at: number; reduced: boolean; big?: boolean;
}) {
  return (
    <motion.div
      className="absolute inset-x-0 bottom-[6%] px-[6vw] text-center"
      initial={reduced ? false : { y: 140, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={reduced ? STILL : { delay: at + 0.35, type: "spring", stiffness: 240, damping: 22 }}
    >
      <div className="truncate font-black leading-none text-white" style={{ fontSize: big ? "6vw" : "4.8vw", textShadow: "0 0.12em 0 rgba(0,0,0,.45)" }}>{headline}</div>
      <div className="mt-[1vw] text-[2.4vw] font-bold uppercase tracking-[0.2em]" style={{ color: look.main }}>{who}</div>
      {detail && <div className="mt-[0.5vw] text-[2vw] font-semibold text-white/75">{detail}</div>}
    </motion.div>
  );
}

/**
 * The word falls, stretches with the speed, squashes on landing and rebounds
 * past its own size before settling. The bounce has to be faster than the fall
 * or it reads as floating rather than as weight.
 */
function Slam({ word, look, reduced, at }: { word: string; look: Look; reduced: boolean; at: number }) {
  if (reduced) {
    return <div className="whitespace-nowrap font-black italic uppercase" style={wordStyle(word, look)}>{word}</div>;
  }
  const total = at + 0.45;
  return (
    <motion.div
      className="whitespace-nowrap font-black italic uppercase"
      style={{ ...wordStyle(word, look), transformOrigin: "50% 100%" }}
      initial={{ y: "-140vh", scaleY: 1.55, scaleX: 0.72 }}
      animate={{
        y: ["-140vh", "0vh", "0vh", "0vh", "0vh"],
        scaleY: [1.55, 0.42, 1.25, 0.94, 1],
        scaleX: [0.72, 1.4, 0.9, 1.04, 1],
      }}
      transition={{
        duration: total,
        times: [0, at / total, (at + 0.16) / total, (at + 0.31) / total, 1],
        ease: "easeOut",
      }}
    >
      {word}
    </motion.div>
  );
}

/**
 * Puts the word's feet on the floor line. Height, not bottom padding: a
 * percentage padding resolves against the container's WIDTH, so on a 16:9 TV
 * the word floated halfway up and nothing looked like it landed.
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="absolute inset-x-0 top-0 flex items-end justify-center" style={{ height: `${FLOOR}%` }}>{children}</div>;
}

// ── the scene ───────────────────────────────────────────────────────────────

export function HypeScene({ kind, headline, who, detail, reduced: reducedProp }: {
  kind: HypeKind; headline: string; who: string; detail: string | null; reduced?: boolean;
}) {
  const system = useReducedMotion();
  const reduced = reducedProp ?? !!system;
  const look = LOOK[kind];
  const at = HYPE_IMPACT_MS[kind] / 1000;
  const big = kind === "milestone";
  return (
    <div className="absolute inset-0 overflow-hidden select-none" data-testid={`hype-${kind}`}>
      <style>{`@keyframes hype-spin { to { transform: rotate(360deg); } }`}</style>
      <Rays look={look} reduced={reduced} />
      {/* The impact shake: motion, never a flash. */}
      <motion.div
        className="absolute inset-0"
        animate={reduced ? undefined : { x: [0, -20, 16, -12, 8, -4, 0], y: [0, 10, -9, 7, -3, 1, 0] }}
        transition={{ delay: at, duration: 0.6, ease: "linear" }}
      >
        <Rings look={look} at={at} reduced={reduced} count={big ? 4 : 3} />
        {CONFETTI[kind] && <Burst look={look} at={at} reduced={reduced} count={big ? 80 : 64} spread={big ? 1100 : 950} seed={kind.length * 7} />}
        <Kicker kind={kind} look={look} reduced={reduced} />
        <Stage><Slam word={WORD[kind]} look={look} reduced={reduced} at={at} /></Stage>
        <Captions headline={headline} who={who} detail={detail} look={look} at={at} reduced={reduced} big={big} />
      </motion.div>
    </div>
  );
}
