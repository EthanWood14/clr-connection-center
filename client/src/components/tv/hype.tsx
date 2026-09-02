/**
 * The hype screen — "the ACME floor show".
 *
 * Ethan: "make the animation more outlanding and funny." So every moment is a
 * Looney Tunes gag, and the WORD is the character rather than a label. Four
 * rules keep six gags feeling like one show:
 *
 *  1. THE FLOOR IS REAL. One ground line at 72% of the screen, the same in all
 *     six. Everything lands on it, cracks it, is pushed up through it, or falls
 *     through it, and every landing throws the same dust.
 *  2. THE WORD IS THE CHARACTER. It stretches as it falls, squashes when it
 *     lands, rebounds past its own size, and then REACTS — pushes back, gets
 *     dizzy, climbs out of a hole, brushes itself off.
 *  3. ACME SUPPLIES THE PROPS. Anvil, portable hole, coil spring, stepladder,
 *     alarm clock, crate, rocket, vaudeville hook — all inline SVG. Emoji are
 *     bit players only; emoji cannot squash.
 *  4. THE LAUGH IS IN THE HOLD. Every kind gets one dead-still beat before its
 *     punchline. The room thinks it is over, and then one more thing happens.
 *     Across a noisy floor, the stillness is what makes heads come up.
 *
 * Under the giant type sits a small flat footnote in the smallest possible
 * voice. The biggest reaction the screen can make, annotated like a shipping
 * notification — the gap between the two registers is the joke.
 *
 * THE LOSSES. Both loss screens play to the whole floor, including whoever
 * just lost the deal, so the antagonist is always a dumb physical object:
 * gravity, a hole, a walking alarm clock, an empty chair. The word takes the
 * hit and visibly recovers before the scene ends. The person's name sits in
 * the caption bar and is never the subject of the slapstick.
 *
 * SAFETY. It is a wall the whole floor faces all day. Nothing flashes: every
 * repeat is positional (a shake, a wobble, a bell hammer), never a full-screen
 * luminance change, and the only loop is a 24-second ray spin. Reduced motion
 * collapses every scene to its final frame.
 *
 * MECHANICS. One mount, delays and keyframes only. Nothing mounts on a timer:
 * a motion element that mounts while its parent is already exiting registers
 * with presence after the exit was dispatched and never reports done, which
 * once left a scene stuck on screen at opacity 0. Props mount at t=0 invisible
 * and are revealed by delay.
 */
import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Transition } from "framer-motion";

export type HypeKind = "transfer" | "appointment" | "rescheduled" | "fell_through" | "missed_appointment" | "milestone";

/** When the big word lands, in ms from mount. The crash in tv.tsx keys off this. */
export const HYPE_IMPACT_MS: Record<HypeKind, number> = {
  transfer: 700, appointment: 720, rescheduled: 620, fell_through: 500, missed_appointment: 700, milestone: 1300,
};

/** The one ground line every scene shares, as a percentage of screen height. */
const FLOOR = 62;

const WORD: Record<HypeKind, string> = {
  transfer: "TRANSFER!", appointment: "BOOKED!", rescheduled: "MOVED!",
  fell_through: "FELL THROUGH", missed_appointment: "NO-SHOW", milestone: "MILESTONE!",
};

const KICKER: Record<HypeKind, string> = {
  transfer: "LIVE TRANSFER", appointment: "MEETING SET", rescheduled: "MEETING MOVED",
  fell_through: "IT HAPPENS", missed_appointment: "MISSED APPOINTMENT", milestone: "TEAM MILESTONE",
};

/** The smallest possible voice, under the biggest possible type. */
const FOOTNOTE: Record<HypeKind, string> = {
  transfer: "no notes. flawless. please do it again immediately.",
  appointment: "it is in the calendar. it is real now.",
  rescheduled: "same borrower. different Tuesday. everything is fine.",
  fell_through: "gravity remains undefeated. on to the next call.",
  missed_appointment: "the chair waited. the chair always waits.",
  milestone: "the floor is on fire. figuratively. please do not test this.",
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

/** The ground everything shares. Faint — it reads as a horizon, not a rule. */
function Ground({ look, cracked = 0, at = 0, reduced }: { look: Look; cracked?: number; at?: number; reduced: boolean }) {
  return (
    <div className="absolute inset-x-0" style={{ top: `${FLOOR}%` }}>
      <div className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${look.ink}, ${look.deep}, ${look.ink}, transparent)`, opacity: 0.85 }} />
      {cracked > 0 && !reduced && (
        <svg viewBox="0 0 1920 120" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-[9vh] w-full">
          {Array.from({ length: cracked }, (_, i) => (
            <motion.path
              key={i}
              d={`M${820 + i * 140} 0 L${790 + i * 150} 46 L${840 + i * 150} 74 L${800 + i * 150} 120`}
              fill="none" stroke={look.ink} strokeWidth="7" strokeLinejoin="round" opacity={0.75}
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ delay: at, duration: 0.18, ease: "circOut" }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

/** The puff every landing throws, flung sideways along the floor. */
function Dust({ look, at, x = 50, count = 8, reduced, seed = 1 }: {
  look: Look; at: number; x?: number; count?: number; reduced: boolean; seed?: number;
}) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const dir = i % 2 ? 1 : -1;
        const dist = (60 + rnd(seed + i) * 260) * dir;
        const size = 14 + rnd(seed + i + 40) * 34;
        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{ left: `${x}%`, top: `${FLOOR}%`, width: size, height: size, background: look.ink, opacity: 0.5 }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 0.55 }}
            animate={{ x: dist, y: -20 - rnd(seed + i + 80) * 60, scale: [0, 1.6, 2.2], opacity: [0.55, 0.3, 0] }}
            transition={{ delay: at, duration: 0.35 + rnd(seed + i + 120) * 0.25, ease: "circOut" }}
          />
        );
      })}
    </>
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

/** A storm of bits thrown from a point. */
function Burst({ look, at, reduced, x = 50, y = FLOOR, count = 56, spread = 900, seed = 1, up = false }: {
  look: Look; at: number; reduced: boolean; x?: number; y?: number; count?: number; spread?: number; seed?: number; up?: boolean;
}) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        // `up` fires a fountain from the floor instead of a sphere.
        const a = up ? -Math.PI / 2 + (rnd(seed + i) - 0.5) * 2.1 : rnd(seed + i) * Math.PI * 2;
        const r = (0.35 + rnd(seed + i + 1000) * 0.65) * spread;
        const size = 8 + rnd(seed + i + 2000) * 18;
        return (
          <motion.div
            key={i}
            className="absolute"
            style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, background: look.bits[i % look.bits.length], borderRadius: rnd(seed + i + 3000) > 0.5 ? "50%" : 2 }}
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

function Captions({ headline, who, detail, footnote, look, at, reduced, big }: {
  headline: string; who: string; detail: string | null; footnote: string; look: Look; at: number; reduced: boolean; big?: boolean;
}) {
  return (
    <motion.div
      className="absolute inset-x-0 bottom-[4%] px-[6vw] text-center"
      initial={reduced ? false : { y: 140, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={reduced ? STILL : { delay: at + 0.35, type: "spring", stiffness: 240, damping: 22 }}
    >
      <div className="truncate font-black leading-none text-white" style={{ fontSize: big ? "6vw" : "4.8vw", textShadow: "0 0.12em 0 rgba(0,0,0,.45)" }}>{headline}</div>
      <div className="mt-[1vw] text-[2.4vw] font-bold uppercase tracking-[0.2em]" style={{ color: look.main }}>{who}</div>
      {detail && <div className="mt-[0.5vw] text-[2vw] font-semibold text-white/75">{detail}</div>}
      {/* The smallest possible voice. Arrives late, once the dust has settled. */}
      <motion.div
        className="mt-[1.1vw] text-[1.15vw] font-normal lowercase tracking-[0.02em] text-white/40"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduced ? STILL : { delay: at + 2.4, duration: 0.5 }}
      >
        {footnote}
      </motion.div>
    </motion.div>
  );
}

// ── the word, as a character ────────────────────────────────────────────────

/**
 * The word falls, stretches with the speed, squashes flat on the floor, and
 * rebounds past its own size before settling. `after` lets a scene keep
 * animating it once it has landed (pushing an anvil off, sagging, sliding).
 */
/**
 * The word falls, stretches with the speed, squashes flat on the floor and
 * rebounds past its own size before settling. Nothing else: a scene that wants
 * the word to keep acting afterwards wraps this in its own motion element
 * rather than extending the timeline. Passing a longer set of keyframes in
 * left it frozen on its first frame, off the top of the screen.
 */
function Slam({ word, look, reduced, at, className = "" }: {
  word: string; look: Look; reduced: boolean; at: number; className?: string;
}) {
  if (reduced) {
    return <div className={`whitespace-nowrap font-black italic uppercase ${className}`} style={wordStyle(word, look)}>{word}</div>;
  }
  // The bounce has to be faster than the fall or it reads as floating.
  const total = at + 0.45;
  return (
    <motion.div
      className={`whitespace-nowrap font-black italic uppercase ${className}`}
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

/** Speed strokes behind something moving fast. */
function Speed({ look, at, reduced, vertical = true, x = 50 }: { look: Look; at: number; reduced: boolean; vertical?: boolean; x?: number }) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={vertical
            ? { left: `${x + (i - 2.5) * 5}%`, top: 0, width: 5, height: "40vh", background: look.main, opacity: 0.5, borderRadius: 4 }
            : { top: `${40 + i * 4}%`, left: 0, height: 5, width: "40vw", background: look.main, opacity: 0.5, borderRadius: 4 }}
          initial={{ opacity: 0, scaleY: vertical ? 0 : 1, scaleX: vertical ? 1 : 0 }}
          animate={{ opacity: [0, 0.55, 0], scaleY: vertical ? [0, 1, 0] : 1, scaleX: vertical ? 1 : [0, 1, 0] }}
          transition={{ delay: at - 0.2 + i * 0.02, duration: 0.35 }}
        />
      ))}
    </>
  );
}

// ── ACME props ──────────────────────────────────────────────────────────────

/** The anvil. Stencilled, because of course it is. */
function Anvil({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute left-1/2 z-20"
      style={{ top: `${FLOOR - 30}%`, width: "20vh", height: "16vh", marginLeft: "-10vh" }}
      initial={{ y: "-160vh", rotate: -8, opacity: 1 }}
      animate={{ y: ["-160vh", "0vh", "0vh", "0vh", "26vh"], rotate: [-8, 0, 0, 6, 64], x: [0, 0, 0, 30, 420], opacity: [1, 1, 1, 1, 0] }}
      transition={{ delay: at, duration: 2.6, times: [0, 0.13, 0.42, 0.62, 1], ease: ["circIn", "linear", "easeIn", "circIn"] }}
    >
      <svg viewBox="0 0 200 160" className="h-full w-full">
        <path d="M20 44 L180 44 L166 74 L52 74 L52 96 L150 96 L150 120 L44 120 L44 140 L156 140 L156 156 L34 156 L34 120 Z" fill="#171717" stroke="#000" strokeWidth="4" />
        <path d="M180 44 L198 58 L166 74 Z" fill="#171717" stroke="#000" strokeWidth="4" />
        <text x="96" y="66" textAnchor="middle" fill="#fafafa" fontSize="20" fontWeight="800" fontFamily="system-ui" letterSpacing="2">ACME</text>
      </svg>
    </motion.div>
  );
}

/** The portable hole: a flat black ellipse that is, regrettably, load-bearing. */
function Hole({ at, reduced }: { at: number; reduced: boolean }) {
  return (
    <motion.div
      className="absolute left-1/2"
      style={{ top: `${FLOOR - 2}%`, width: "46vw", height: "7vh", marginLeft: "-23vw", background: "#000", borderRadius: "50%" }}
      initial={reduced ? false : { scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={reduced ? STILL : { delay: at, duration: 0.5, ease: "easeOut" }}
    />
  );
}

/** The stepladder that comes back up out of the hole. */
function Ladder({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute left-1/2"
      style={{ top: `${FLOOR - 26}%`, width: "16vh", height: "26vh", marginLeft: "-8vh" }}
      initial={{ y: "30vh", opacity: 0, rotate: -14 }}
      animate={{ y: "0vh", opacity: [0, 1, 1, 0], rotate: 0 }}
      transition={{ delay: at, duration: 2.2, times: [0, 0.25, 0.75, 1], ease: "backOut" }}
    >
      <svg viewBox="0 0 120 200" className="h-full w-full">
        <path d="M30 200 L46 10 M90 200 L74 10" stroke={look.ink} strokeWidth="9" strokeLinecap="round" fill="none" />
        {[60, 105, 150].map((y) => <path key={y} d={`M${34 + (200 - y) * 0.06} ${y} L${86 - (200 - y) * 0.06} ${y}`} stroke={look.ink} strokeWidth="7" strokeLinecap="round" />)}
      </svg>
    </motion.div>
  );
}

/** A tumbleweed. Nothing says "well, that happened" like one of these. */
function Tumbleweed({ at, look, reduced, duration = 3 }: { at: number; look: Look; reduced: boolean; duration?: number }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute"
      style={{ top: `${FLOOR - 7}%`, width: "7vh", height: "7vh", left: 0 }}
      initial={{ x: "-12vw", rotate: 0, opacity: 0 }}
      animate={{ x: "112vw", rotate: 1080, opacity: [0, 0.75, 0.75, 0] }}
      transition={{ delay: at, duration, ease: "linear", times: [0, 0.08, 0.9, 1] }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2;
          return <path key={i} d={`M50 50 L${50 + Math.cos(a) * 44} ${50 + Math.sin(a) * 44} M${50 + Math.cos(a) * 22} ${50 + Math.sin(a) * 22} L${50 + Math.cos(a + 0.8) * 40} ${50 + Math.sin(a + 0.8) * 40}`} stroke={look.ink} strokeWidth="4" fill="none" opacity="0.9" />;
        })}
        <circle cx="50" cy="50" r="44" fill="none" stroke={look.ink} strokeWidth="3" opacity="0.5" />
      </svg>
    </motion.div>
  );
}

/** The office chair nobody sat in. Deliberately generic: no desk, no nameplate. */
function Chair({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute"
      style={{ left: "14%", top: `${FLOOR - 26}%`, width: "22vh", height: "26vh" }}
      initial={{ x: "-60vw", rotate: 0, opacity: 1 }}
      animate={{ x: [`-60vw`, "0vw", "0vw", "0vw"], rotate: [0, 720, 760, 862], y: [0, 0, 0, 30] }}
      transition={{ delay: at, duration: 2.4, times: [0, 0.22, 0.5, 0.72], ease: ["circOut", "linear", "backIn"] }}
    >
      <svg viewBox="0 0 140 180" className="h-full w-full">
        <rect x="34" y="8" width="72" height="72" rx="12" fill={look.deep} stroke={look.ink} strokeWidth="5" />
        <rect x="26" y="84" width="88" height="20" rx="9" fill={look.main} stroke={look.ink} strokeWidth="5" />
        <path d="M70 104 L70 140" stroke={look.ink} strokeWidth="8" />
        <path d="M70 140 L26 166 M70 140 L114 166 M70 140 L70 172" stroke={look.ink} strokeWidth="7" strokeLinecap="round" />
      </svg>
    </motion.div>
  );
}

/**
 * The alarm clock that walks in and knocks the chair over. The bell hammer is
 * the only fast repeat in the file: a small element moving side to side at
 * about 2.5 per second. Positional, never a luminance flash.
 */
function AlarmClock({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute"
      style={{ left: "4%", top: `${FLOOR - 22}%`, width: "22vh", height: "22vh" }}
      initial={{ y: "-70vh", opacity: 1, rotate: 0 }}
      animate={{ y: ["-70vh", "0vh", "0vh", "0vh", "2vh"], x: [0, 0, "6vw", "16vw", "16vw"], rotate: [0, 0, -10, 10, 96] }}
      transition={{ delay: at, duration: 1.9, times: [0, 0.2, 0.5, 0.78, 1], ease: ["circIn", "easeInOut", "easeInOut", "backIn"] }}
    >
      <svg viewBox="-60 -60 120 120" className="h-full w-full">
        <path d="M-46 -34 L-28 -50 M46 -34 L28 -50" stroke={look.main} strokeWidth="9" strokeLinecap="round" />
        <path d="M-14 46 L-26 56 M14 46 L26 56" stroke={look.main} strokeWidth="7" strokeLinecap="round" />
        <circle r="42" fill="#0B1220" stroke={look.main} strokeWidth="7" />
        <line x1="0" y1="0" x2="0" y2="-26" stroke="#fff" strokeWidth="6" strokeLinecap="round" transform="rotate(300)" />
        <line x1="0" y1="0" x2="0" y2="-32" stroke={look.main} strokeWidth="5" strokeLinecap="round" transform="rotate(75)" />
        <circle r="4" fill={look.main} />
        {/* the hammer: 2.5 shakes a second, positional only */}
        {/* Moved as a transform, not by animating the cx attribute: framer
            cannot read an SVG attribute's starting value off the DOM and the
            console filled with "cx: Expected length, undefined". */}
        <motion.g
          animate={{ x: [-8, 8, -8] }}
          transition={{ delay: at + 0.4, duration: 0.4, repeat: 3, ease: "easeInOut" }}
        >
          <circle cx="0" cy="-52" r="7" fill={look.main} />
        </motion.g>
      </svg>
    </motion.div>
  );
}

/** The banana peel. It does not need to do anything. It just needs to be there. */
function Peel({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute text-[9vh]"
      style={{ top: `${FLOOR - 9}%` }}
      initial={{ x: "-14vw", rotate: 0, opacity: 1 }}
      animate={{ x: ["-14vw", "46vw", "46vw", "128vw"], rotate: [0, 380, 380, 1400], y: [0, 0, 0, -140] }}
      transition={{ delay: at, duration: 1.5, times: [0, 0.2, 0.42, 1], ease: ["circOut", "linear", "circOut"] }}
    >
      🍌
    </motion.div>
  );
}

/** The vaudeville hook. The only honest way to end a bit. */
function Hook({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute z-20"
      style={{ right: 0, top: `${FLOOR - 34}%`, width: "60vw", height: "22vh" }}
      initial={{ x: "70vw" }}
      animate={{ x: ["70vw", "-6vw", "-6vw", "70vw"] }}
      transition={{ delay: at, duration: 1.5, times: [0, 0.35, 0.6, 1], ease: "easeInOut" }}
    >
      <svg viewBox="0 0 600 200" className="h-full w-full" preserveAspectRatio="none">
        <path d="M600 60 L120 60" stroke={look.main} strokeWidth="16" strokeLinecap="round" />
        <path d="M120 60 a54 54 0 1 0 -54 54" fill="none" stroke={look.main} strokeWidth="16" strokeLinecap="round" />
        {Array.from({ length: 9 }, (_, i) => <rect key={i} x={140 + i * 50} y="52" width="24" height="16" fill={look.ink} opacity="0.55" />)}
      </svg>
    </motion.div>
  );
}

/** The calendar page that is about to get stamped. */
function CalendarPage({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute left-1/2 top-[26%]"
      style={{ width: "34vh", height: "30vh", marginLeft: "-17vh" }}
      initial={{ x: "70vw", rotate: 240, opacity: 1 }}
      animate={{ x: 0, rotate: 0, scaleX: [1, 1, 1.2, 1], scaleY: [1, 1, 0.86, 1] }}
      transition={{ delay: at, duration: 0.9, ease: "circOut", scaleX: { delay: at + 0.5, duration: 0.4 }, scaleY: { delay: at + 0.5, duration: 0.4 } }}
    >
      <svg viewBox="0 0 200 180" className="h-full w-full">
        <rect x="8" y="16" width="184" height="156" rx="10" fill="#fafaf9" stroke={look.ink} strokeWidth="5" />
        <rect x="8" y="16" width="184" height="34" rx="10" fill={look.deep} />
        <path d="M52 8 L52 30 M148 8 L148 30" stroke={look.ink} strokeWidth="9" strokeLinecap="round" />
        {Array.from({ length: 4 }, (_, r) => Array.from({ length: 5 }, (_, c) => (
          <rect key={`${r}-${c}`} x={26 + c * 32} y={62 + r * 26} width="20" height="16" rx="3" fill={look.ink} opacity="0.16" />
        )))}
        <circle cx="122" cy="114" r="17" fill="none" stroke="#dc2626" strokeWidth="5" />
      </svg>
    </motion.div>
  );
}

/** The rubber stamp on its ACME coil. Comes down hard, leaves, comes back. */
function StampRig({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute left-1/2 z-20"
      style={{ top: "-34vh", width: "26vh", height: "44vh", marginLeft: "-13vh" }}
      initial={{ y: "0vh", opacity: 1 }}
      animate={{
        // down hard, rocket back up, a beat of nothing, then it remembers gravity
        y: ["0vh", "56vh", "56vh", "-40vh", "-40vh", "44vh", "46vh"],
        x: ["0vw", "0vw", "0vw", "0vw", "-18vw", "-18vw", "-18vw"],
        rotate: [0, 0, 0, 0, 0, 0, 84],
      }}
      transition={{ delay: at - 0.35, duration: 3.1, times: [0, 0.11, 0.16, 0.3, 0.52, 0.66, 0.86], ease: ["circIn", "linear", "circOut", "linear", "circIn", "backIn"] }}
    >
      <svg viewBox="0 0 130 220" className="h-full w-full">
        <rect x="46" y="0" width="38" height="52" rx="14" fill={look.ink} />
        <path d="M65 52 L65 84" stroke={look.ink} strokeWidth="10" />
        {/* coil */}
        <path d="M65 84 l-24 12 l48 14 l-48 14 l48 14 l-48 14 l24 12" fill="none" stroke={look.main} strokeWidth="7" strokeLinecap="round" />
        <rect x="18" y="166" width="94" height="26" rx="7" fill={look.ink} />
        <rect x="26" y="192" width="78" height="16" rx="5" fill={look.deep} />
      </svg>
    </motion.div>
  );
}

/** The rocket that carries the milestone off, and then loses control. */
function Rocket({ at, reduced, corkscrew = false }: { at: number; reduced: boolean; corkscrew?: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute text-[16vh]"
      style={corkscrew ? { left: "-14vw", top: "8%" } : { left: "44%", top: `${FLOOR - 10}%` }}
      initial={corkscrew ? { x: 0, y: 0, rotate: 20, opacity: 1 } : { y: "0vh", rotate: -20, opacity: 1 }}
      animate={corkscrew
        ? { x: "128vw", y: ["0vh", "36vh", "8vh", "58vh"], rotate: [20, 380, 700, 1080] }
        : { y: ["0vh", "-6vh", "-130vh"], rotate: [-20, -14, -8] }}
      transition={{ delay: at, duration: corkscrew ? 1.5 : 0.9, ease: corkscrew ? "linear" : "circIn" }}
    >
      🚀
    </motion.div>
  );
}

/** The crate that lands on the word and turns out to be a confetti bomb. */
function Crate({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute left-1/2 z-20"
      style={{ top: `${FLOOR - 34}%`, width: "20vh", height: "17vh", marginLeft: "-10vh" }}
      initial={{ y: "-140vh", rotate: -10, opacity: 1 }}
      animate={{ y: ["-140vh", "0vh", "0vh", "0vh"], rotate: [-10, 0, 0, 0], scaleY: [1, 1, 0.8, 1] }}
      transition={{ delay: at, duration: 1.3, times: [0, 0.55, 0.62, 0.72], ease: ["circIn", "easeOut", "backOut"] }}
    >
      <svg viewBox="0 0 200 170" className="h-full w-full">
        <motion.g
          initial={{ rotate: 0 }} animate={{ rotate: -104 }}
          transition={{ delay: at + 1.1, duration: 0.32, ease: "backOut" }}
          style={{ transformOrigin: "14px 34px" }}
        >
          <rect x="6" y="14" width="188" height="26" rx="5" fill={look.deep} stroke={look.ink} strokeWidth="5" />
        </motion.g>
        <rect x="14" y="40" width="172" height="120" rx="6" fill="#a16207" stroke={look.ink} strokeWidth="5" />
        <path d="M14 70 L186 70 M14 130 L186 130" stroke={look.ink} strokeWidth="5" opacity="0.6" />
        <text x="100" y="112" textAnchor="middle" fill="#fef3c7" fontSize="30" fontWeight="800" fontFamily="system-ui" letterSpacing="3">ACME</text>
      </svg>
    </motion.div>
  );
}

/** The shadow of something enormous, arriving before the thing does. */
function Shadow({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="absolute left-1/2"
      style={{ top: `${FLOOR - 2}%`, width: "50vw", height: "6vh", marginLeft: "-25vw", background: "#000", borderRadius: "50%", filter: "blur(10px)" }}
      initial={{ scale: 0.02, opacity: 0 }}
      animate={{ scale: [0.02, 1, 0], opacity: [0, 0.5, 0] }}
      transition={{ delay: 0, duration: at + 0.15, times: [0, 0.92, 1], ease: "circIn" }}
    />
  );
}

/** Dizzy stars, orbiting whatever just got hit. */
function Stars({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-[36%] text-[6vh]"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, 1, 1, 0],
            x: [0, 130, 0, -130, 0].map((v) => v + i * 20),
            y: [0, -30, -60, -30, 0],
          }}
          transition={{ delay: at + i * 0.18, duration: 2.6, ease: "linear", times: [0, 0.15, 0.5, 1] }}
        >
          💫
        </motion.div>
      ))}
    </>
  );
}

/** Question marks drifting down like snow. Not rain — snow is funnier. */
function Drift({ look, at, reduced, count = 12 }: { look: Look; at: number; reduced: boolean; count?: number }) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={i}
          className="absolute top-0 font-black"
          style={{ left: `${5 + rnd(i + 300) * 90}%`, fontSize: `${3 + rnd(i + 400) * 4}vw`, color: i % 3 === 0 ? "#fff" : look.main, opacity: 0.8 }}
          initial={{ y: "-20vh", opacity: 0, rotate: -10 }}
          animate={{ y: "110vh", opacity: [0, 0.8, 0.8, 0], rotate: [-10, 10, -10], x: [0, 30, -30, 0] }}
          transition={{ delay: at + rnd(i + 600) * 1.8, duration: 4.5 + rnd(i + 700) * 2, ease: "linear" }}
        >
          ?
        </motion.div>
      ))}
    </>
  );
}

// ── the six gags ────────────────────────────────────────────────────────────

/**
 * Puts the word's feet on the floor line. Height, not bottom padding: a
 * percentage padding resolves against the container's WIDTH, so on a 16:9 TV
 * the word floated halfway up the screen and nothing looked like it landed.
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="absolute inset-x-0 top-0 flex items-end justify-center" style={{ height: `${FLOOR}%` }}>{children}</div>;
}

function Bit({ kind, look, at, reduced, headline, who, detail }: {
  kind: HypeKind; look: Look; at: number; reduced: boolean; headline: string; who: string; detail: string | null;
}) {
  const word = WORD[kind];
  const foot = FOOTNOTE[kind];
  const caption = (big?: boolean) => (
    <Captions headline={headline} who={who} detail={detail} footnote={foot} look={look} at={at} reduced={reduced} big={big} />
  );

  switch (kind) {
    // Shadow, drop, IMPACT, boing — then a dead 0.3s hold, and an anvil lands
    // on it. The word bench-presses the anvil off. TRANSFER is the strongest
    // thing on the floor, which is the emotional truth of a live transfer.
    case "transfer":
      return (
        <>
          <Shadow at={at} reduced={reduced} />
          <Speed look={look} at={at} reduced={reduced} />
          <Ground look={look} cracked={2} at={at} reduced={reduced} />
          <Rings look={look} at={at} reduced={reduced} />
          <Dust look={look} at={at} reduced={reduced} count={10} seed={7} />
          <Burst look={look} at={at + 0.05} reduced={reduced} count={70} spread={1000} seed={11} up />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Anvil at={at + 0.65} reduced={reduced} />
          <Stage>
            {/* The word lands on its own; this wrapper is the anvil pressing
                it down at 2.0s and losing the argument by 3.9s. */}
            <motion.div
              style={{ transformOrigin: "50% 100%" }}
              animate={reduced ? undefined : { scaleY: [1, 1, 0.84, 0.88, 1.06, 1], scaleX: [1, 1, 1.12, 1.07, 0.97, 1] }}
              transition={{ duration: 4.4, times: [0, 0.42, 0.5, 0.72, 0.9, 1], ease: "easeInOut" }}
            >
              <Slam word={word} look={look} reduced={reduced} at={at} />
            </motion.div>
          </Stage>
          <Dust look={look} at={at + 0.78} reduced={reduced} count={6} seed={31} />
          {caption()}
        </>
      );

    // A calendar page flutters in and sits there, unaware. A stamp on a coil
    // slams it. The stamp rockets away — beat — and comes back down, because
    // what goes up must come back down and bonk something.
    case "appointment":
      return (
        <>
          <Ground look={look} cracked={1} at={at} reduced={reduced} />
          <Rings look={look} at={at} reduced={reduced} count={2} />
          <CalendarPage at={0.05} look={look} reduced={reduced} />
          <StampRig at={at} look={look} reduced={reduced} />
          <Dust look={look} at={at} reduced={reduced} count={8} seed={23} />
          <Burst look={look} at={at} reduced={reduced} count={44} spread={800} seed={23} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Stage>
            <motion.div
              className="whitespace-nowrap font-black uppercase"
              style={{ ...wordStyle(word, look), WebkitTextStroke: undefined, border: `0.1em solid ${look.main}`, borderRadius: "0.22em", padding: "0.02em 0.22em", boxShadow: `0 0 0 0.04em ${look.ink}, 0 0 60px ${look.ray}`, transformOrigin: "50% 100%" }}
              initial={reduced ? false : { scale: 4.2, opacity: 0, rotate: -22 }}
              animate={reduced ? { scale: 1, opacity: 1, rotate: -12 } : { scale: [4.2, 0.94, 1.06, 1], opacity: [0, 1, 1, 1], rotate: [-22, -12, -12, -12], scaleY: [1, 0.6, 1.1, 1] }}
              transition={reduced ? STILL : { delay: at - 0.12, duration: 0.55, ease: "circIn" }}
            >
              {word}
            </motion.div>
          </Stage>
          <motion.div
            className="absolute left-1/2 top-[30%] text-[9vh]"
            initial={reduced ? false : { scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={reduced ? STILL : { delay: at + 1.7, type: "spring", stiffness: 320, damping: 12 }}
          >
            ✅
          </motion.div>
          {caption()}
        </>
      );

    // A banana peel skitters in and stops. Everyone already knows. The word
    // arrives at speed, loses its legs, slides clean off the screen — then an
    // empty stage, and a vaudeville hook drags it back.
    case "rescheduled":
      return (
        <>
          <Ground look={look} reduced={reduced} />
          <Peel at={0.05} reduced={reduced} />
          <Speed look={look} at={at} reduced={reduced} vertical={false} />
          <Dust look={look} at={at} reduced={reduced} count={5} seed={37} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Hook at={at + 1.05} look={look} reduced={reduced} />
          <Stage>
            <motion.div
              className="whitespace-nowrap font-black italic uppercase"
              style={{ ...wordStyle(word, look), transformOrigin: "50% 100%" }}
              initial={reduced ? false : { x: "-120vw", skewX: -22, opacity: 1, rotate: 0 }}
              animate={reduced
                ? { x: 0, skewX: 0 }
                : {
                    // in fast, legs out, slides off right, then hauled back
                    x: ["-120vw", "0vw", "46vw", "132vw", "132vw", "0vw", "0vw"],
                    skewX: [-22, 0, 26, 30, 30, 6, 0],
                    y: ["0vh", "0vh", "-10vh", "-4vh", "-4vh", "0vh", "0vh"],
                    rotate: [0, 0, 12, 18, 18, 4, 0],
                    scaleX: [1, 1, 1, 1, 1, 1.3, 1],
                  }}
              transition={reduced ? STILL : { delay: at - 0.32, duration: 3.0, times: [0, 0.11, 0.2, 0.36, 0.5, 0.78, 0.9], ease: ["circOut", "easeOut", "circIn", "linear", "circOut", "backOut"] }}
            >
              {word}
            </motion.div>
          </Stage>
          <Stars at={at + 2.5} reduced={reduced} />
          {caption()}
        </>
      );

    // It swaggers in exactly like a win — same entrance, same dust. Then the
    // long hold while a portable hole opens underneath, and gravity clears its
    // throat. It falls, and it climbs back out with a hat on.
    case "fell_through":
      return (
        <>
          <Ground look={look} reduced={reduced} />
          <Dust look={look} at={at} reduced={reduced} count={8} seed={53} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Hole at={at + 0.5} reduced={reduced} />
          <Ladder at={2.9} look={look} reduced={reduced} />
          <Stage>
            <motion.div
              className="whitespace-nowrap font-black italic uppercase"
              style={{ ...wordStyle(word, look), transformOrigin: "50% 100%" }}
              initial={reduced ? false : { y: "-140vh", scaleY: 1.55, scaleX: 0.72 }}
              animate={reduced
                ? { y: 0, scaleY: 1, scaleX: 1 }
                : {
                    // land, hold, wobble, drop through, climb back out
                    y: ["-140vh", "0vh", "0vh", "0vh", "0vh", "60vh", "60vh", "6vh", "0vh"],
                    scaleY: [1.55, 0.42, 1.15, 1, 1, 0.35, 0.35, 0.8, 1],
                    scaleX: [0.72, 1.4, 0.94, 1, 1, 0.35, 0.35, 0.8, 1],
                    rotate: [0, 0, 0, 0, -4, -8, -8, 2, 0],
                    opacity: [1, 1, 1, 1, 1, 0, 0, 1, 1],
                  }}
              transition={reduced ? STILL : { delay: 0, duration: 4.4, times: [0, 0.11, 0.16, 0.2, 0.29, 0.42, 0.63, 0.86, 0.95], ease: ["circIn", "circOut", "easeOut", "linear", "circIn", "linear", "circOut", "backOut"] }}
            >
              {word}
            </motion.div>
          </Stage>
          {/* the small distant puff, once it is well and truly gone */}
          <motion.div
            className="absolute left-1/2 top-[71%] h-[2vh] w-[2vh] -ml-[1vh] rounded-full"
            style={{ background: "#fff" }}
            initial={reduced ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: [0, 2.4, 3.2], opacity: [0, 0.55, 0] }}
            transition={reduced ? STILL : { delay: 2.35, duration: 0.6 }}
          />
          <Tumbleweed at={4.4} look={look} reduced={reduced} />
          {caption()}
        </>
      );

    // The biggest wind-up in the set produces the smallest bump: the word
    // arrives pale and passes straight through the chair. Then an alarm clock
    // walks in and knocks the chair over anyway.
    case "missed_appointment":
      return (
        <>
          <Ground look={look} reduced={reduced} />
          <Chair at={0.05} look={look} reduced={reduced} />
          <AlarmClock at={at + 0.35} look={look} reduced={reduced} />
          <Speed look={look} at={at} reduced={reduced} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Stage>
            <motion.div
              className="whitespace-nowrap font-black italic uppercase"
              style={{ ...wordStyle(word, look), transformOrigin: "50% 100%" }}
              initial={reduced ? false : { y: "-140vh", scaleY: 1.55, scaleX: 0.72, opacity: 0.55 }}
              animate={reduced
                ? { y: 0, scaleY: 1, scaleX: 1, opacity: 0.85 }
                : {
                    // no squash: it passes through the floor's business end
                    y: ["-140vh", "-2vh", "0vh", "0vh", "0vh", "0vh"],
                    scaleY: [1.55, 1.02, 1, 1.08, 1, 1],
                    scaleX: [0.72, 0.98, 1, 1.02, 1, 1],
                    opacity: [0.55, 0.5, 0.5, 0.92, 0.5, 0.5],
                    rotate: [0, 0, 0, 0, 0, -4],
                  }}
              transition={reduced ? STILL : { delay: 0, duration: 5.2, times: [0, 0.1, 0.16, 0.42, 0.62, 1], ease: "easeInOut" }}
            >
              {word}
            </motion.div>
          </Stage>
          <Dust look={look} at={at + 1.5} reduced={reduced} count={6} x={26} seed={71} />
          <Drift look={look} at={at + 1.5} reduced={reduced} />
          <Tumbleweed at={at + 2.4} look={look} reduced={reduced} duration={3.4} />
          {caption()}
        </>
      );

    // The floor bulges, a rocket bursts out carrying the word off the top of
    // the screen, and the stage is empty — then it comes back down harder than
    // anything else in the set. And then it does not stop.
    case "milestone":
      return (
        <>
          <Ground look={look} cracked={3} at={at} reduced={reduced} />
          <Rings look={look} at={at} reduced={reduced} count={4} />
          <Rocket at={0.35} reduced={reduced} />
          <Rocket at={at + 0.7} reduced={reduced} corkscrew />
          <Dust look={look} at={0.35} reduced={reduced} count={10} seed={83} />
          <Dust look={look} at={at} reduced={reduced} count={12} seed={97} />
          <Burst look={look} at={at} reduced={reduced} count={70} spread={1100} seed={71} up />
          <Burst look={look} at={at + 1.4} reduced={reduced} x={22} y={30} count={40} spread={600} seed={83} />
          <Burst look={look} at={at + 1.9} reduced={reduced} x={78} y={26} count={40} spread={600} seed={97} />
          <Kicker kind={kind} look={look} reduced={reduced} />
          <Crate at={at + 1.9} look={look} reduced={reduced} />
          <Burst look={look} at={at + 3.15} reduced={reduced} x={50} y={44} count={70} spread={900} seed={113} up />
          <Stage>
            <motion.div
              className="whitespace-nowrap font-black italic uppercase"
              style={{ ...wordStyle(word, look), transformOrigin: "50% 100%" }}
              initial={reduced ? false : { y: "6vh", scaleY: 1, scaleX: 1, opacity: 0 }}
              animate={reduced
                ? { y: 0, opacity: 1 }
                : {
                    // ride the rocket up, gone, then re-entry: the hardest hit
                    y: ["6vh", "-8vh", "-150vh", "-150vh", "0vh", "0vh", "0vh"],
                    scaleY: [1, 1.1, 1.5, 1.5, 0.32, 1.18, 1],
                    scaleX: [1, 0.95, 0.8, 0.8, 1.45, 0.94, 1],
                    rotate: [0, -6, -14, -14, 0, 0, 0],
                    opacity: [0, 1, 1, 0, 1, 1, 1],
                  }}
              transition={reduced ? STILL : { delay: 0.3, duration: 1.6, times: [0, 0.12, 0.34, 0.5, 0.63, 0.78, 0.9], ease: ["easeOut", "circIn", "linear", "circIn", "circOut", "easeOut"] }}
            >
              {word}
            </motion.div>
          </Stage>
          {caption(true)}
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
  // Only the ones that actually hit the floor shake the room.
  const shakes = kind !== "missed_appointment" && kind !== "rescheduled";
  return (
    <div className="absolute inset-0 overflow-hidden select-none" data-testid={`hype-${kind}`}>
      <style>{`
        @keyframes hype-spin { to { transform: rotate(360deg); } }
      `}</style>
      <Rays look={look} reduced={reduced} />
      {/* The impact shake: motion, never a flash. */}
      <motion.div
        className="absolute inset-0"
        animate={reduced || !shakes ? undefined : { x: [0, -20, 16, -12, 8, -4, 0], y: [0, 10, -9, 7, -3, 1, 0] }}
        transition={{ delay: at, duration: 0.6, ease: "linear" }}
      >
        <Bit kind={kind} look={look} at={at} reduced={reduced} headline={headline} who={who} detail={detail} />
      </motion.div>
    </div>
  );
}
