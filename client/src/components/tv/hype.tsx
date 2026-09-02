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

/**
 * Props are drawn in these, never in the palette's ink.
 *
 * The first cut used `look.ink` — the darkest brown or red in each palette —
 * for anvils, dust, ladders and tumbleweeds, on a near-black backdrop. Every
 * one of them was invisible on screen while looking perfectly correct in the
 * code. A prop has to be a light shape with a dark outline to read from
 * across a room, which is the opposite of the way the type is built.
 */
const PROP = {
  body: "#D6D3D1",   // the mass of a thing
  dark: "#44403C",   // its shaded face
  line: "#0C0A09",   // the outline that separates it from the glow
  dust: "#E7E5E4",   // dust and smoke, always lighter than the floor
} as const;

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
      <div className="h-[4px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${look.deep}, ${look.main}, ${look.deep}, transparent)`, opacity: 0.9 }} />
      {cracked > 0 && !reduced && (
        <svg viewBox="0 0 1920 120" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-[9vh] w-full">
          {Array.from({ length: cracked }, (_, i) => (
            <motion.path
              key={i}
              d={`M${820 + i * 140} 0 L${790 + i * 150} 46 L${840 + i * 150} 74 L${800 + i * 150} 120`}
              fill="none" stroke={look.main} strokeWidth="8" strokeLinejoin="round" opacity={0.9}
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
            style={{ left: `${x}%`, top: `${FLOOR}%`, width: size, height: size, background: PROP.dust }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 0.6 }}
            animate={{ x: dist, y: -20 - rnd(seed + i + 80) * 60, scale: [0, 1.6, 2.2], opacity: [0.6, 0.3, 0] }}
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
/**
 * Props run on CSS animations, not on framer.
 *
 * Framer kept setting a prop's opening transform and then never running its
 * keyframes: the anvil, the stamp, the chair and the alarm clock all sat
 * frozen on frame one while the code read as correct, and single easings,
 * plain pixel units and restructured keyframes all changed nothing. CSS
 * animations are declarative and always run, the ray spin in this file has
 * used one from the start, and on a wall display that runs unattended for
 * months, "always runs" is the property that matters most.
 */
const anim = (name: string, seconds: number, delay: number, ease = "linear"): CSSProperties =>
  ({ animation: `${name} ${seconds}s ${ease} ${delay}s both` });

/** The anvil. Falls on the word, sits there, then loses and tips away. */
function Anvil({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute left-1/2 z-20"
      style={{ top: `${FLOOR - 34}%`, width: "34vh", height: "27vh", marginLeft: "-17vh", ...anim("hype-anvil", 2.8, at) }}
    >
      <svg viewBox="0 0 200 160" className="h-full w-full">
        <path d="M20 44 L180 44 L166 74 L52 74 L52 96 L150 96 L150 120 L44 120 L44 140 L156 140 L156 156 L34 156 L34 120 Z" fill={PROP.body} stroke={PROP.line} strokeWidth="6" strokeLinejoin="round" />
        <path d="M180 44 L198 58 L166 74 Z" fill={PROP.body} stroke={PROP.line} strokeWidth="6" strokeLinejoin="round" />
        <path d="M20 44 L180 44 L166 74 L52 74 Z" fill={PROP.dark} opacity="0.35" />
        <text x="100" y="66" textAnchor="middle" fill={PROP.line} fontSize="24" fontWeight="900" fontFamily="system-ui" letterSpacing="3">ACME</text>
      </svg>
    </div>
  );
}

/** The portable hole: flat black, with a rim so it reads against a dark room. */
function Hole({ at, reduced }: { at: number; reduced: boolean }) {
  return (
    <div
      className="absolute left-1/2"
      style={{
        top: `${FLOOR - 2}%`, width: "46vw", height: "8vh", marginLeft: "-23vw",
        background: "#000", borderRadius: "50%", border: `4px solid ${PROP.body}`, boxShadow: `0 0 26px ${PROP.line}`,
        ...(reduced ? {} : anim("hype-hole", 0.5, at, "ease-out")),
      }}
    />
  );
}

/** The stepladder that comes up out of the hole so the word can climb out. */
function Ladder({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute left-1/2"
      style={{ top: `${FLOOR - 26}%`, width: "16vh", height: "26vh", marginLeft: "-8vh", ...anim("hype-ladder", 2.4, at, "ease-out") }}
    >
      <svg viewBox="0 0 120 200" className="h-full w-full">
        <path d="M30 200 L46 10 M90 200 L74 10" stroke={PROP.body} strokeWidth="11" strokeLinecap="round" fill="none" />
        {[60, 105, 150].map((y) => <path key={y} d={`M${34 + (200 - y) * 0.06} ${y} L${86 - (200 - y) * 0.06} ${y}`} stroke={PROP.body} strokeWidth="9" strokeLinecap="round" />)}
      </svg>
    </div>
  );
}

/** A tumbleweed. Nothing says "well, that happened" like one of these. */
function Tumbleweed({ at, reduced, duration = 3.4 }: { at: number; reduced: boolean; duration?: number }) {
  if (reduced) return null;
  return (
    <div
      className="absolute"
      style={{ top: `${FLOOR - 7}%`, left: 0, width: "8vh", height: "8vh", ...anim("hype-tumble", duration, at) }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full">
        {Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2;
          return <path key={i} d={`M50 50 L${50 + Math.cos(a) * 44} ${50 + Math.sin(a) * 44} M${50 + Math.cos(a) * 22} ${50 + Math.sin(a) * 22} L${50 + Math.cos(a + 0.8) * 40} ${50 + Math.sin(a + 0.8) * 40}`} stroke="#A8A29E" strokeWidth="5" fill="none" opacity="0.95" />;
        })}
        <circle cx="50" cy="50" r="44" fill="none" stroke="#A8A29E" strokeWidth="4" opacity="0.6" />
      </svg>
    </div>
  );
}

/** The chair nobody sat in. Deliberately generic: no desk, no nameplate. */
function Chair({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute"
      style={{ left: "12%", top: `${FLOOR - 26}%`, width: "24vh", height: "26vh", transformOrigin: "50% 100%", ...anim("hype-chair", 2.6, at) }}
    >
      <svg viewBox="0 0 140 180" className="h-full w-full">
        <rect x="34" y="8" width="72" height="72" rx="12" fill={PROP.dark} stroke={PROP.body} strokeWidth="6" />
        <rect x="26" y="84" width="88" height="20" rx="9" fill={PROP.body} stroke={PROP.line} strokeWidth="4" />
        <path d="M70 104 L70 140" stroke={PROP.body} strokeWidth="9" />
        <path d="M70 140 L26 166 M70 140 L114 166 M70 140 L70 172" stroke={PROP.body} strokeWidth="8" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/**
 * The alarm clock that walks in and knocks the chair over. The bell hammer is
 * the only fast repeat in the file: a small shape moving side to side about
 * two and a half times a second. Positional, never a luminance flash.
 */
function AlarmClock({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute z-10"
      style={{ left: "2%", top: `${FLOOR - 24}%`, width: "24vh", height: "24vh", transformOrigin: "50% 100%", ...anim("hype-clock", 2.2, at, "ease-in-out") }}
    >
      <svg viewBox="-60 -60 120 120" className="h-full w-full">
        <path d="M-46 -34 L-28 -50 M46 -34 L28 -50" stroke={look.main} strokeWidth="9" strokeLinecap="round" />
        <path d="M-14 46 L-26 56 M14 46 L26 56" stroke={look.main} strokeWidth="7" strokeLinecap="round" />
        <circle r="42" fill="#0B1220" stroke={look.main} strokeWidth="7" />
        <line x1="0" y1="0" x2="0" y2="-26" stroke="#fff" strokeWidth="6" strokeLinecap="round" transform="rotate(300)" />
        <line x1="0" y1="0" x2="0" y2="-32" stroke={look.main} strokeWidth="5" strokeLinecap="round" transform="rotate(75)" />
        <circle r="4" fill={look.main} />
        <g style={anim("hype-hammer", 0.4, at + 0.35, "ease-in-out")}>
          <circle cx="0" cy="-52" r="8" fill={look.main} />
        </g>
      </svg>
    </div>
  );
}

/** The banana peel. It does not need to do anything. It needs to be there. */
function Peel({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute text-[10vh] leading-none"
      style={{ top: `${FLOOR - 10}%`, left: 0, ...anim("hype-peel", 1.6, at) }}
    >
      🍌
    </div>
  );
}

/** The vaudeville hook. The only honest way to end a bit. */
function Hook({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute z-20"
      style={{ right: 0, top: `${FLOOR - 30}%`, width: "62vw", height: "22vh", ...anim("hype-hook", 1.6, at, "ease-in-out") }}
    >
      <svg viewBox="0 0 600 200" className="h-full w-full" preserveAspectRatio="none">
        <path d="M600 60 L120 60" stroke={PROP.body} strokeWidth="18" strokeLinecap="round" />
        <path d="M120 60 a54 54 0 1 0 -54 54" fill="none" stroke={PROP.body} strokeWidth="18" strokeLinecap="round" />
        {Array.from({ length: 9 }, (_, i) => <rect key={i} x={140 + i * 50} y="51" width="26" height="18" fill={look.deep} opacity="0.8" />)}
      </svg>
    </div>
  );
}

/** The calendar page that is about to get stamped. It has no idea. */
function CalendarPage({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute left-1/2"
      style={{ top: `${FLOOR - 40}%`, width: "36vh", height: "32vh", marginLeft: "-18vh", ...anim("hype-calendar", 1.1, at, "cubic-bezier(.1,.8,.3,1)") }}
    >
      <svg viewBox="0 0 200 180" className="h-full w-full">
        <rect x="8" y="16" width="184" height="156" rx="10" fill="#FAFAF9" stroke={PROP.line} strokeWidth="6" />
        <rect x="8" y="16" width="184" height="34" rx="10" fill={look.deep} />
        <path d="M52 8 L52 30 M148 8 L148 30" stroke={PROP.line} strokeWidth="9" strokeLinecap="round" />
        {Array.from({ length: 4 }, (_, r) => Array.from({ length: 5 }, (_, c) => (
          <rect key={`${r}-${c}`} x={26 + c * 32} y={62 + r * 26} width="20" height="16" rx="3" fill={PROP.line} opacity="0.16" />
        )))}
        <circle cx="122" cy="114" r="17" fill="none" stroke="#DC2626" strokeWidth="5" />
      </svg>
    </div>
  );
}

/** The stamp on its ACME coil: down hard, gone — then it remembers gravity. */
function StampRig({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute left-1/2 z-20"
      style={{ top: "-46vh", width: "28vh", height: "46vh", marginLeft: "-14vh", transformOrigin: "50% 100%", ...anim("hype-stamp", 3.2, at - 0.35) }}
    >
      <svg viewBox="0 0 130 220" className="h-full w-full">
        <rect x="46" y="0" width="38" height="52" rx="14" fill={PROP.body} stroke={PROP.line} strokeWidth="4" />
        <path d="M65 52 L65 84" stroke={PROP.body} strokeWidth="11" />
        <path d="M65 84 l-24 12 l48 14 l-48 14 l48 14 l-48 14 l24 12" fill="none" stroke={PROP.body} strokeWidth="8" strokeLinecap="round" />
        <rect x="18" y="166" width="94" height="26" rx="7" fill={PROP.body} stroke={PROP.line} strokeWidth="4" />
        <rect x="26" y="192" width="78" height="16" rx="5" fill={look.main} stroke={PROP.line} strokeWidth="3" />
      </svg>
    </div>
  );
}

/** The rocket that carries the milestone off, and later loses control. */
function Rocket({ at, reduced, corkscrew = false }: { at: number; reduced: boolean; corkscrew?: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute text-[18vh] leading-none"
      style={corkscrew
        ? { left: 0, top: "6%", ...anim("hype-rocket-cork", 1.6, at) }
        : { left: "42%", top: `${FLOOR - 14}%`, ...anim("hype-rocket-up", 1.0, at, "cubic-bezier(.6,0,1,.4)") }}
    >
      🚀
    </div>
  );
}

/** The crate that lands on the word and turns out to be a confetti bomb. */
function Crate({ at, look, reduced }: { at: number; look: Look; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute left-1/2 z-20"
      style={{ top: `${FLOOR - 32}%`, width: "22vh", height: "19vh", marginLeft: "-11vh", ...anim("hype-crate", 1.4, at) }}
    >
      <svg viewBox="0 0 200 170" className="h-full w-full">
        <g style={{ transformOrigin: "14px 34px", ...anim("hype-lid", 0.34, at + 1.15, "cubic-bezier(.2,1.4,.4,1)") }}>
          <rect x="6" y="14" width="188" height="26" rx="5" fill="#B45309" stroke={PROP.line} strokeWidth="5" />
        </g>
        <rect x="14" y="40" width="172" height="120" rx="6" fill="#D97706" stroke={PROP.line} strokeWidth="5" />
        <path d="M14 70 L186 70 M14 130 L186 130" stroke={PROP.line} strokeWidth="5" opacity="0.5" />
        <text x="100" y="112" textAnchor="middle" fill="#FEF3C7" fontSize="30" fontWeight="800" fontFamily="system-ui" letterSpacing="3">ACME</text>
      </svg>
    </div>
  );
}

/** The shadow of something enormous, arriving before the thing does. */
function Shadow({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <div
      className="absolute left-1/2"
      style={{
        top: `${FLOOR - 3}%`, width: "52vw", height: "7vh", marginLeft: "-26vw",
        background: "#000", borderRadius: "50%", filter: "blur(10px)", outline: `3px solid ${PROP.line}`,
        ...anim("hype-shadow", at + 0.15, 0, "cubic-bezier(.6,0,1,.4)"),
      }}
    />
  );
}

/** Dizzy stars, orbiting whatever just got hit. */
function Stars({ at, reduced }: { at: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute left-1/2 text-[7vh] leading-none"
          style={{ top: "30%", marginLeft: `${(i - 1) * 3}vh`, ...anim("hype-star", 2.8, at + i * 0.18) }}
        >
          💫
        </div>
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
        <div
          key={i}
          className="absolute top-0 font-black leading-none"
          style={{
            left: `${5 + rnd(i + 300) * 90}%`, fontSize: `${3 + rnd(i + 400) * 4}vw`,
            color: i % 3 === 0 ? "#fff" : look.main,
            ...anim("hype-drift", 4.5 + rnd(i + 700) * 2, at + rnd(i + 600) * 1.8),
          }}
        >
          ?
        </div>
      ))}
    </>
  );
}

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
          <Ladder at={2.9} reduced={reduced} />
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
          <Tumbleweed at={4.4} reduced={reduced} />
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
          <Chair at={0.05} reduced={reduced} />
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
          <Tumbleweed at={at + 2.4} reduced={reduced} duration={3.4} />
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
        @keyframes hype-anvil {
          0%   { transform: translate(0, -140vh) rotate(-8deg); opacity: 1; }
          14%  { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          46%  { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          66%  { transform: translate(3vw, 0) rotate(8deg); opacity: 1; }
          100% { transform: translate(42vw, 26vh) rotate(70deg); opacity: 0; }
        }
        @keyframes hype-hole {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes hype-ladder {
          0%   { transform: translateY(30vh) rotate(-14deg); opacity: 0; }
          22%  { transform: translateY(0) rotate(0deg); opacity: 1; }
          78%  { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(26vh) rotate(6deg); opacity: 0; }
        }
        @keyframes hype-tumble {
          0%   { transform: translateX(-14vw) rotate(0deg); opacity: 0; }
          8%   { opacity: 0.85; }
          90%  { opacity: 0.85; }
          100% { transform: translateX(112vw) rotate(1080deg); opacity: 0; }
        }
        @keyframes hype-chair {
          0%   { transform: translateX(-70vw) rotate(0deg); }
          24%  { transform: translateX(0) rotate(720deg); }
          52%  { transform: translateX(0) rotate(742deg); }
          70%  { transform: translateX(6vw) rotate(760deg); }
          100% { transform: translateX(9vw) translateY(4vh) rotate(838deg); }
        }
        @keyframes hype-clock {
          0%   { transform: translate(0, -80vh) rotate(0deg); }
          22%  { transform: translate(0, 0) rotate(0deg); }
          46%  { transform: translate(7vw, 0) rotate(-12deg); }
          72%  { transform: translate(15vw, 0) rotate(12deg); }
          86%  { transform: translate(16vw, 0) rotate(0deg); }
          100% { transform: translate(16vw, 3vh) rotate(96deg); }
        }
        @keyframes hype-hammer {
          0%   { transform: translateX(-9px); }
          50%  { transform: translateX(9px); }
          100% { transform: translateX(-9px); }
        }
        @keyframes hype-peel {
          0%   { transform: translate(-14vw, 0) rotate(0deg); }
          20%  { transform: translate(44vw, 0) rotate(380deg); }
          44%  { transform: translate(44vw, 0) rotate(380deg); }
          100% { transform: translate(126vw, -18vh) rotate(1400deg); }
        }
        @keyframes hype-hook {
          0%   { transform: translateX(72vw); }
          34%  { transform: translateX(-6vw); }
          58%  { transform: translateX(-6vw); }
          100% { transform: translateX(72vw); }
        }
        @keyframes hype-calendar {
          0%   { transform: translateX(72vw) rotate(240deg); }
          70%  { transform: translateX(0) rotate(0deg) scale(1, 1); }
          82%  { transform: translateX(0) rotate(0deg) scale(1.18, 0.86); }
          100% { transform: translateX(0) rotate(0deg) scale(1, 1); }
        }
        @keyframes hype-stamp {
          0%   { transform: translate(0, 0) rotate(0deg); }
          11%  { transform: translate(0, 58vh) rotate(0deg); }
          17%  { transform: translate(0, 58vh) rotate(0deg); }
          30%  { transform: translate(0, -46vh) rotate(0deg); }
          52%  { transform: translate(-20vw, -46vh) rotate(0deg); }
          66%  { transform: translate(-20vw, 44vh) rotate(0deg); }
          78%  { transform: translate(-20vw, 46vh) rotate(28deg); }
          100% { transform: translate(-20vw, 47vh) rotate(88deg); }
        }
        @keyframes hype-rocket-up {
          0%   { transform: translateY(0) rotate(-20deg); }
          18%  { transform: translateY(-7vh) rotate(-14deg); }
          100% { transform: translateY(-135vh) rotate(-8deg); }
        }
        @keyframes hype-rocket-cork {
          0%   { transform: translate(-16vw, 0) rotate(20deg); }
          100% { transform: translate(130vw, 52vh) rotate(1080deg); }
        }
        @keyframes hype-crate {
          0%   { transform: translateY(-140vh) rotate(-10deg) scaleY(1); }
          56%  { transform: translateY(0) rotate(0deg) scaleY(1); }
          64%  { transform: translateY(0) rotate(0deg) scaleY(0.78); }
          74%  { transform: translateY(0) rotate(0deg) scaleY(1.04); }
          100% { transform: translateY(0) rotate(0deg) scaleY(1); }
        }
        @keyframes hype-lid {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-104deg); }
        }
        @keyframes hype-shadow {
          0%   { transform: scale(0.02); opacity: 0; }
          92%  { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.1); opacity: 0; }
        }
        @keyframes hype-star {
          0%   { transform: translate(0, 0); opacity: 0; }
          15%  { transform: translate(13vw, -3vh); opacity: 1; }
          50%  { transform: translate(0, -6vh); opacity: 1; }
          75%  { transform: translate(-13vw, -3vh); opacity: 1; }
          100% { transform: translate(0, 0); opacity: 0; }
        }
        @keyframes hype-drift {
          0%   { transform: translate(0, -20vh) rotate(-10deg); opacity: 0; }
          10%  { opacity: 0.8; }
          88%  { opacity: 0.8; }
          100% { transform: translate(2vw, 112vh) rotate(10deg); opacity: 0; }
        }
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
