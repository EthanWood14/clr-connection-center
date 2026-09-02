/**
 * The hype screen.
 *
 * Ethan: "unhinged animated stuff" — the style of the screen a bowling alley
 * throws up when someone strikes. A word the size of the wall slamming in,
 * rays spinning behind it, shockwaves, a shake, a storm of particles. Not a
 * lane; the energy. Each kind of moment gets its own bit:
 *
 *   transfer            TRANSFER!     letters crash down one by one, rays, rings, gold storm
 *   appointment         BOOKED!       an ink stamp thuds onto the screen, a check draws itself
 *   rescheduled         MOVED!        the word skids in from the left, a clock spins to the new time
 *   fell_through        FELL THROUGH  the word lands, wobbles, then collapses letter by letter
 *   missed_appointment  NO-SHOW       the word shudders with split colour, an alarm rings, ? rain
 *   milestone           MILESTONE!    fireworks, four of them, and the headline underneath
 *
 * Every bit is one fixed timeline scripted with delays and keyframes from a
 * single mount. Nothing mounts on a timer. That is not style: the overlay
 * this sits in is an AnimatePresence child, and a motion element that mounts
 * while its parent is already exiting registers with presence after the exit
 * was dispatched, so it never reports done and the overlay is never removed.
 * The first cut of this screen did exactly that — a scene stuck in the DOM at
 * opacity 0 twenty seconds after its hold ended, with the pages rotating
 * underneath it. Keyframes and delays cannot do that.
 *
 * Safety: this is a wall the whole floor faces all day. Nothing flashes
 * faster than twice a second. The shudder on a no-show is position, not
 * luminance, and only on the word. The only loop is a 24-second ray spin.
 * Reduced motion collapses every bit to its final frame.
 */
import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Transition } from "framer-motion";

export type HypeKind = "transfer" | "appointment" | "rescheduled" | "fell_through" | "missed_appointment" | "milestone";

/** When the big word lands, in ms from mount. The crash in tv.tsx keys off this. */
export const HYPE_IMPACT_MS: Record<HypeKind, number> = {
  transfer: 700, appointment: 720, rescheduled: 650, fell_through: 650, missed_appointment: 560, milestone: 800,
};

const WORD: Record<HypeKind, string> = {
  transfer: "TRANSFER!", appointment: "BOOKED!", rescheduled: "MOVED!",
  fell_through: "FELL THROUGH", missed_appointment: "NO-SHOW", milestone: "MILESTONE!",
};

const KICKER: Record<HypeKind, string> = {
  transfer: "LIVE TRANSFER", appointment: "MEETING SET", rescheduled: "MEETING MOVED",
  fell_through: "IT HAPPENS", missed_appointment: "MISSED APPOINTMENT", milestone: "TEAM MILESTONE",
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

/** Deterministic noise so a scene looks the same every time it plays. */
function rnd(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function wordStyle(word: string, look: Look): CSSProperties {
  return {
    fontSize: `min(14vw, ${(130 / word.length).toFixed(1)}vw)`,
    lineHeight: 0.9,
    letterSpacing: "-0.03em",
    color: look.main,
    WebkitTextStroke: `0.04em ${look.ink}`,
    textShadow: `0.05em 0.05em 0 ${look.deep}, 0.1em 0.1em 0 ${look.ink}, 0 0 0.5em ${look.ray}`,
  };
}

// ── primitives ──────────────────────────────────────────────────────────────

/** A sunburst behind everything, spinning slowly. */
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
      animate={{ opacity: 0.45, scale: 1 }}
      transition={reduced ? STILL : { delay: 0.05, duration: 0.5, ease: "circOut" }}
    >
      <svg viewBox="-1000 -1000 2000 2000" className="h-full w-full" style={{ animation: reduced ? "none" : "hype-spin 24s linear infinite" }}>
        {rays.map((p, i) => <polygon key={i} points={p} fill={look.ray} opacity={0.35} />)}
      </svg>
    </motion.div>
  );
}

/** Shockwave rings from the centre. */
function Rings({ look, at, reduced, count = 3 }: { look: Look; at: number; reduced: boolean; count?: number }) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{ width: 240, height: 240, marginLeft: -120, marginTop: -120, border: `6px solid ${look.main}` }}
          initial={{ scale: 0, opacity: 0.9 }}
          animate={{ scale: 9, opacity: 0 }}
          transition={{ delay: at + i * 0.16, duration: 1.2, ease: "easeOut" }}
        />
      ))}
    </>
  );
}

/** A storm of bits thrown out from a point. */
function Burst({ look, at, reduced, x = 50, y = 50, count = 56, spread = 900, seed = 1 }: {
  look: Look; at: number; reduced: boolean; x?: number; y?: number; count?: number; spread?: number; seed?: number;
}) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = rnd(seed + i) * Math.PI * 2;
        const r = (0.35 + rnd(seed + i + 1000) * 0.65) * spread;
        const size = 8 + rnd(seed + i + 2000) * 18;
        return (
          <motion.div
            key={i}
            className="absolute"
            style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, background: look.bits[i % look.bits.length], borderRadius: rnd(seed + i + 3000) > 0.5 ? "50%" : 2 }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
            animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r + 140, scale: [0, 1.4, 1, 0.5], rotate: rnd(seed + i + 4000) * 720 - 360, opacity: [1, 1, 1, 0] }}
            transition={{ delay: at + rnd(seed + i + 5000) * 0.12, duration: 1.1 + rnd(seed + i + 6000) * 0.8, ease: "circOut" }}
          />
        );
      })}
    </>
  );
}

function Kicker({ kind, look, reduced }: { kind: HypeKind; look: Look; reduced: boolean }) {
  return (
    <motion.div
      className="absolute left-0 right-0 top-[7%] mx-auto w-max rounded-full px-[2.2vw] py-[0.7vw] text-[2vw] font-black tracking-[0.35em] text-white"
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
      className="absolute inset-x-0 bottom-[8%] px-[6vw] text-center"
      initial={reduced ? false : { y: 140, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={reduced ? STILL : { delay: at + 0.35, type: "spring", stiffness: 240, damping: 22 }}
    >
      <div className="truncate font-black leading-none text-white" style={{ fontSize: big ? "6.5vw" : "5.2vw", textShadow: "0 0.12em 0 rgba(0,0,0,.45)" }}>{headline}</div>
      <div className="mt-[1.2vw] text-[2.6vw] font-bold uppercase tracking-[0.2em]" style={{ color: look.main }}>{who}</div>
      {detail && <div className="mt-[0.6vw] text-[2.2vw] font-semibold text-white/75">{detail}</div>}
    </motion.div>
  );
}

/** Letters crash down one at a time; with `tumble`, they later fall apart. */
function Drop({ word, look, reduced, tumble = false }: { word: string; look: Look; reduced: boolean; tumble?: boolean }) {
  return (
    <div className="flex items-end justify-center whitespace-nowrap font-black italic uppercase" style={wordStyle(word, look)}>
      {word.split("").map((ch, i) => {
        const glyph = ch === " " ? " " : ch;
        const gap = ch === " " ? { width: "0.3em" } : undefined;
        const r0 = rnd(i + 1) * 50 - 25;
        if (reduced) return <span key={i} className="inline-block" style={gap}>{glyph}</span>;
        if (tumble) {
          return (
            <motion.span
              key={i}
              className="inline-block"
              style={gap}
              initial={{ y: -1400, x: 0, rotate: r0, opacity: 0 }}
              animate={{
                y: [-1400, 0, 0, 12, 1600],
                x: [0, 0, 0, (rnd(i + 50) - 0.5) * 90, (rnd(i + 90) - 0.5) * 900],
                rotate: [r0, 0, 0, (rnd(i + 70) - 0.5) * 24, (rnd(i + 110) - 0.5) * 520],
                opacity: [0, 1, 1, 1, 1],
              }}
              transition={{ delay: 0.1 + i * 0.05, duration: 4.6, times: [0, 0.12, 0.5, 0.62, 1], ease: ["circOut", "linear", "easeIn", "circIn"] }}
            >
              {glyph}
            </motion.span>
          );
        }
        return (
          <motion.span
            key={i}
            className="inline-block"
            style={gap}
            initial={{ y: -1400, rotate: r0, scale: 2.4, opacity: 0 }}
            animate={{ y: 0, rotate: 0, scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 + i * 0.06, type: "spring", stiffness: 480, damping: 20, mass: 1.1 }}
          >
            {glyph}
          </motion.span>
        );
      })}
    </div>
  );
}

/** An ink stamp thudding onto the screen. */
function Stamp({ word, look, reduced, at }: { word: string; look: Look; reduced: boolean; at: number }) {
  return (
    <motion.div
      className="inline-block whitespace-nowrap font-black uppercase"
      style={{ ...wordStyle(word, look), WebkitTextStroke: undefined, border: `0.1em solid ${look.main}`, borderRadius: "0.22em", padding: "0.02em 0.22em", boxShadow: `0 0 0 0.04em ${look.ink}, 0 0 60px ${look.ray}` }}
      initial={reduced ? false : { scale: 4.2, opacity: 0, rotate: -20 }}
      animate={{ scale: 1, opacity: 1, rotate: -7 }}
      transition={reduced ? STILL : { delay: at - 0.2, duration: 0.2, ease: "circIn" }}
    >
      {word}
    </motion.div>
  );
}

/** The word skids in from the left. */
function Skid({ word, look, reduced, at }: { word: string; look: Look; reduced: boolean; at: number }) {
  return (
    <motion.div
      className="whitespace-nowrap font-black italic uppercase"
      style={wordStyle(word, look)}
      initial={reduced ? false : { x: -2400, skewX: -22, opacity: 0 }}
      animate={{ x: 0, skewX: 0, opacity: 1 }}
      transition={reduced ? STILL : { delay: at - 0.5, duration: 0.5, ease: "circOut" }}
    >
      {word}
    </motion.div>
  );
}

/** A check that draws itself. */
function Check({ look, at, reduced }: { look: Look; at: number; reduced: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className="absolute left-[7%] top-[16%] h-[30vh] w-[30vh]">
      <motion.path
        d="M14 54 L40 80 L88 22"
        fill="none" stroke={look.main} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={reduced ? STILL : { delay: at + 0.25, duration: 0.45, ease: "circOut" }}
      />
    </svg>
  );
}

/** A clock whose hands whip round to the new time. The hands spin with CSS
 *  so the pivot is the SVG origin, which is the clock's centre. */
function Clock({ look, at, reduced }: { look: Look; at: number; reduced: boolean }) {
  return (
    <motion.div
      className="absolute left-[7%] top-[15%] h-[32vh] w-[32vh]"
      initial={reduced ? false : { scale: 0, rotate: -90 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={reduced ? STILL : { delay: 0.1, type: "spring", stiffness: 260, damping: 16 }}
    >
      <svg viewBox="-50 -50 100 100" className="h-full w-full">
        <circle r="44" fill="#0B1220" stroke={look.main} strokeWidth="6" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="0" y1="-36" x2="0" y2={i % 3 === 0 ? "-28" : "-32"} stroke={look.main} strokeWidth={i % 3 === 0 ? 4 : 2} transform={`rotate(${i * 30})`} />
        ))}
        <line x1="0" y1="4" x2="0" y2="-22" stroke="#fff" strokeWidth="6" strokeLinecap="round"
          style={{ animation: reduced ? "none" : `hype-hand-hour 1.9s cubic-bezier(.1,.8,.2,1) ${at}s both` }} />
        <line x1="0" y1="4" x2="0" y2="-31" stroke={look.main} strokeWidth="4" strokeLinecap="round"
          style={{ animation: reduced ? "none" : `hype-hand-minute 1.9s cubic-bezier(.1,.8,.2,1) ${at}s both` }} />
        <circle r="4" fill={look.main} />
      </svg>
    </motion.div>
  );
}

/** An alarm clock going off. */
function Alarm({ look, at, reduced }: { look: Look; at: number; reduced: boolean }) {
  return (
    <motion.div
      className="absolute left-[7%] top-[14%] h-[32vh] w-[32vh]"
      initial={reduced ? false : { scale: 0, y: -300 }}
      animate={reduced ? { scale: 1, y: 0 } : { scale: 1, y: 0, rotate: [0, 0, -12, 12, -12, 12, -8, 8, -4, 4, 0] }}
      transition={reduced ? STILL : { scale: { delay: 0.05, type: "spring", stiffness: 260, damping: 14 }, y: { delay: 0.05, type: "spring", stiffness: 260, damping: 14 }, rotate: { delay: at, duration: 1.6, ease: "linear" } }}
    >
      <svg viewBox="-50 -50 100 100" className="h-full w-full">
        <path d="M-40 -28 L-24 -42 M40 -28 L24 -42" stroke={look.main} strokeWidth="8" strokeLinecap="round" />
        <path d="M-12 40 L-22 48 M12 40 L22 48" stroke={look.main} strokeWidth="6" strokeLinecap="round" />
        <circle r="36" fill="#0B1220" stroke={look.main} strokeWidth="6" />
        <line x1="0" y1="0" x2="0" y2="-22" stroke="#fff" strokeWidth="5" strokeLinecap="round" transform="rotate(300)" />
        <line x1="0" y1="0" x2="0" y2="-28" stroke={look.main} strokeWidth="4" strokeLinecap="round" transform="rotate(75)" />
        <circle r="3.5" fill={look.main} />
      </svg>
    </motion.div>
  );
}

/** Question marks raining down. */
function Rain({ look, at, reduced, count = 14 }: { look: Look; at: number; reduced: boolean; count?: number }) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          className="absolute top-0 font-black"
          style={{ left: `${4 + rnd(i + 300) * 92}%`, fontSize: `${3 + rnd(i + 400) * 5}vw`, color: i % 3 === 0 ? "#fff" : look.main, opacity: 0.85 }}
          initial={{ y: -260, opacity: 0, rotate: 0 }}
          animate={{ y: 1500, opacity: [0, 1, 1, 0], rotate: rnd(i + 500) * 360 - 180 }}
          transition={{ delay: at + rnd(i + 600) * 1.4, duration: 2.4 + rnd(i + 700), ease: "easeIn" }}
        >
          ?
        </motion.div>
      ))}
    </>
  );
}

/** A crack across the screen, drawn when the word gives way. */
function Crack({ look, at, reduced }: { look: Look; at: number; reduced: boolean }) {
  return (
    <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <motion.path
        d="M0 610 L230 560 L410 640 L640 520 L860 600 L1010 470 L1200 590 L1440 500 L1650 610 L1920 540"
        fill="none" stroke={look.main} strokeWidth="6" strokeLinejoin="round" opacity={0.8}
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={reduced ? STILL : { delay: at, duration: 0.35, ease: "circOut" }}
      />
    </svg>
  );
}

// ── the bits ────────────────────────────────────────────────────────────────

function Bit({ kind, look, at, reduced, headline, who, detail }: {
  kind: HypeKind; look: Look; at: number; reduced: boolean; headline: string; who: string; detail: string | null;
}) {
  const word = WORD[kind];
  switch (kind) {
    case "transfer":
      return (
        <>
          <Rings look={look} at={at} reduced={reduced} />
          <Burst look={look} at={at} reduced={reduced} count={70} spread={1000} seed={11} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <div className="absolute inset-0 flex items-center justify-center"><Drop word={word} look={look} reduced={reduced} /></div>
          <Captions headline={headline} who={who} detail={detail} look={look} at={at} reduced={reduced} />
        </>
      );
    case "appointment":
      return (
        <>
          <Rings look={look} at={at} reduced={reduced} count={2} />
          <Burst look={look} at={at} reduced={reduced} count={44} spread={800} seed={23} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Check look={look} at={at} reduced={reduced} />
          <div className="absolute inset-0 flex items-center justify-center"><Stamp word={word} look={look} reduced={reduced} at={at} /></div>
          <Captions headline={headline} who={who} detail={detail} look={look} at={at} reduced={reduced} />
        </>
      );
    case "rescheduled":
      return (
        <>
          <Rings look={look} at={at} reduced={reduced} count={2} />
          <Burst look={look} at={at} reduced={reduced} count={30} spread={700} seed={37} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Clock look={look} at={at} reduced={reduced} />
          <div className="absolute inset-0 flex items-center justify-center"><Skid word={word} look={look} reduced={reduced} at={at} /></div>
          <Captions headline={headline} who={who} detail={detail} look={look} at={at} reduced={reduced} />
        </>
      );
    case "fell_through":
      // The word lands, holds, wobbles at 2.4s, then gives way. The crack draws
      // as it goes; the tilt comes on an inner wrapper so it does not fight
      // the impact shake on the outer one.
      return (
        <>
          <Rings look={look} at={at} reduced={reduced} count={1} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Crack look={look} at={2.55} reduced={reduced} />
          <Burst look={look} at={2.7} reduced={reduced} count={36} spread={700} seed={53} y={58} />
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            animate={reduced ? undefined : { rotate: [0, 0, 0, -2.5, -2.5], y: [0, 0, 0, 24, 24] }}
            transition={{ duration: 6.5, times: [0, 0.37, 0.4, 0.5, 1], ease: "circIn" }}
          >
            <Drop word={word} look={look} reduced={reduced} tumble />
          </motion.div>
          <Captions headline={headline} who={who} detail={detail ?? "Next call."} look={look} at={at} reduced={reduced} />
        </>
      );
    case "missed_appointment":
      return (
        <>
          <Rings look={look} at={at} reduced={reduced} count={2} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Alarm look={look} at={at} reduced={reduced} />
          <Rain look={look} at={at} reduced={reduced} />
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            animate={reduced ? undefined : { x: [0, -22, 18, -14, 10, -6, 0] }}
            transition={{ delay: at + 0.15, duration: 2.2, ease: "linear" }}
          >
            <div className="relative">
              {/* split-colour ghosts: static offsets that fade in, never flash */}
              {[["#22D3EE", -1], ["#F43F5E", 1]].map(([c, dir]) => (
                <motion.div
                  key={String(c)}
                  aria-hidden
                  className="absolute inset-0 flex items-end justify-center whitespace-nowrap font-black italic uppercase"
                  style={{ ...wordStyle(word, look), color: String(c), WebkitTextStroke: undefined, textShadow: "none", mixBlendMode: "screen" }}
                  initial={{ opacity: 0, x: 0 }}
                  animate={reduced ? { opacity: 0.4, x: 8 * Number(dir) } : { opacity: [0, 0, 0.6, 0.45], x: [0, 0, 16 * Number(dir), 9 * Number(dir)] }}
                  transition={reduced ? STILL : { delay: at, duration: 0.6, times: [0, 0.1, 0.5, 1] }}
                >
                  {word}
                </motion.div>
              ))}
              <Drop word={word} look={look} reduced={reduced} />
            </div>
          </motion.div>
          <Captions headline={headline} who={who} detail={detail} look={look} at={at} reduced={reduced} />
        </>
      );
    case "milestone":
      return (
        <>
          <Rings look={look} at={at} reduced={reduced} count={4} />
          <Burst look={look} at={at} reduced={reduced} count={70} spread={1100} seed={71} />
          <Burst look={look} at={at + 0.9} reduced={reduced} x={22} y={30} count={40} spread={600} seed={83} />
          <Burst look={look} at={at + 1.5} reduced={reduced} x={78} y={26} count={40} spread={600} seed={97} />
          <Burst look={look} at={at + 2.2} reduced={reduced} x={50} y={22} count={48} spread={700} seed={113} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <div className="absolute inset-0 flex items-center justify-center pb-[10vh]"><Drop word={word} look={look} reduced={reduced} /></div>
          <Captions headline={headline} who={who} detail={detail} look={look} at={at} reduced={reduced} big />
        </>
      );
  }
}

// ── the scene ───────────────────────────────────────────────────────────────

export function HypeScene({ kind, headline, who, detail, reduced: reducedProp }: {
  kind: HypeKind; headline: string; who: string; detail: string | null; reduced?: boolean;
}) {
  const system = useReducedMotion();
  const reduced = reducedProp ?? !!system;
  const look = LOOK[kind];
  const at = HYPE_IMPACT_MS[kind] / 1000;
  return (
    <div className="absolute inset-0 overflow-hidden select-none" data-testid={`hype-${kind}`}>
      <style>{`
        @keyframes hype-spin { to { transform: rotate(360deg); } }
        @keyframes hype-hand-hour { to { transform: rotate(1500deg); } }
        @keyframes hype-hand-minute { to { transform: rotate(3240deg); } }
      `}</style>
      <Rays look={look} reduced={reduced} />
      {/* the impact shake: motion, not a flash */}
      <motion.div
        className="absolute inset-0"
        animate={reduced ? undefined : { x: [0, -18, 15, -11, 8, -4, 0], y: [0, 9, -8, 6, -3, 1, 0] }}
        transition={{ delay: at, duration: 0.6, ease: "linear" }}
      >
        <Bit kind={kind} look={look} at={at} reduced={reduced} headline={headline} who={who} detail={detail} />
      </motion.div>
    </div>
  );
}
