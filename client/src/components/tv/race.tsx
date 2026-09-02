/**
 * The race — the scene the wall plays when one CLR moves past another on
 * today's transfer board.
 *
 * It is a sibling of hype.tsx and obeys the same four rules that stopped that
 * file fighting itself. Read hype.tsx before changing anything here.
 *
 *  1. THE GROUND IS REAL. One track, two lanes: a far lane whose wheels sit at
 *     58% of the screen and a near lane at 66%. Cars hold station and the
 *     WORLD scrolls — kerb, lane dashes, hoardings and crowd, each a little
 *     slower the further back it sits. That parallax is the whole sense of
 *     speed; without it two cars just hover.
 *  2. NOBODY LOSES. The passed car never crashes, spins, smokes or wobbles.
 *     It stays on the track, in the race, and it is the one that gets the
 *     last word — a "Nice one 👏" bubble after the flag. Both drivers are in
 *     the room watching this, so the only thing that happens to the passed car
 *     is that someone else gets in front of it, which is what a race is.
 *  3. LIGHT SHAPES, DARK OUTLINES. The backdrop is near-black (#0B1220 in
 *     tv.tsx). hype.tsx lost a day to props drawn in a palette's darkest ink,
 *     which were perfectly correct in the code and invisible on the wall.
 *     Every panel, wheel rim, kerb and flag strip here is a LIGHT fill with an
 *     INK outline. If you add a shape and it vanishes, this is why.
 *  4. THE PASS IS A SENTENCE. Catch, draft, hold, swing out, go. The 0.35s
 *     dead hold in the draft at ~3.0s is the beat that makes heads come up —
 *     the same trick as the hold before every hype punchline.
 *
 * MECHANICS. Every moving part is a CSS @keyframes prefixed `race-`, applied
 * with an inline `animation` shorthand and `both` fill. framer-motion is used
 * for exactly one thing — reading the OS reduced-motion preference. On this
 * screen framer repeatedly set an element's opening transform and then never
 * ran the keyframes, and props sat frozen on frame one; CSS animations are
 * declarative and always run, which is the property that matters on a display
 * that runs unattended for months. One mount, delays only: nothing here
 * mounts on a timer.
 *
 * SAFETY. It is a wall the whole floor faces all day. Nothing flashes. Every
 * repeat is positional and local — a scrolling band, a turning wheel arc, a
 * waving flag strip — never a full-screen luminance change. The chequered
 * flag WAVES (a transform on five cloth strips) and does not blink. The
 * fastest repeat in the file is a wheel arc at 1.7 Hz.
 *
 * The whole thing runs ~7s and is over by 6.6s.
 */
import type { CSSProperties } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * A local copy of hype.tsx's helper, deliberately not imported: the two scenes
 * are free to drift apart, and one changing must never silently restyle the
 * other. `repeat` carries the iteration count the loops here need.
 */
const anim = (name: string, seconds: number, delay: number, ease = "linear", repeat = "1"): CSSProperties =>
  ({ animation: `${name} ${seconds}s ${ease} ${delay}s ${repeat} both` });

/** Deterministic noise, so the scene looks the same every time it plays. */
function rnd(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** The outline that separates every shape from the near-black backdrop. */
const INK = "#0C0A09";
/** The light neutral everything mechanical is built from. */
const BODY = "#E7E5E4";

/** Where each lane's wheels touch down, as a percentage of screen height. */
const FAR_LANE = 58;
const NEAR_LANE = 66;

interface CarLook { main: string; deep: string; glass: string }
/** Gold moves up; sky holds the line. Both bright — neither reads as a loser. */
const PASSER: CarLook = { main: "#FDE047", deep: "#B45309", glass: "#94A3B8" };
const PASSED: CarLook = { main: "#7DD3FC", deep: "#0369A1", glass: "#94A3B8" };

/**
 * The decal on a car door. SVG text cannot ellipsis itself, so the cap has to
 * happen here: first name only, uppercased, nine characters. Tested against
 * "Jonjairo Mercado-Nuñez" (→ JONJAIRO) and "Christina" (→ CHRISTIN…).
 */
function carLabel(name: string) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const up = first.toUpperCase();
  if (!up) return "CLR";
  return up.length > 9 ? `${up.slice(0, 8)}…` : up;
}

// ── the cars ────────────────────────────────────────────────────────────────

/**
 * One wheel. The spinning part is a single half-circle arc, not spokes: an arc
 * passes the eye once per turn (1.7 Hz here) where three spokes would pass it
 * five times, and it reads as motion blur rather than a strobing pattern.
 * `transform-box: fill-box` is load-bearing — a circle's fill box is centred
 * on the hub, so `transform-origin: center` turns about the axle. An arc would
 * not be symmetric and would wobble.
 */
function Wheel({ cx, cy, delay, reduced }: { cx: number; cy: number; delay: number; reduced: boolean }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r="26" fill="#1C1917" stroke={BODY} strokeWidth="5" />
      <circle r="12" fill={BODY} stroke={INK} strokeWidth="3" />
      <circle
        r="19" fill="none" stroke="#A8A29E" strokeWidth="5" strokeLinecap="round"
        strokeDasharray="60 60"
        style={reduced ? undefined : { transformBox: "fill-box", transformOrigin: "center", ...anim("race-wheel", 0.6, delay, "linear", "infinite") }}
      />
    </g>
  );
}

/**
 * A car: body, glass, wheels, and the driver's name on the door. Drawn facing
 * right in a 300×138 box, wheels touching at y≈130. Strokes are painted twice —
 * a fat INK pass then a thinner colour pass — which is the cheapest way to get
 * an outlined line that survives a dark room.
 */
function Car({ look, label, reduced }: { look: CarLook; label: string; reduced: boolean }) {
  const fs = label.length <= 5 ? 26 : label.length <= 7 ? 23 : 20;
  return (
    <svg viewBox="0 0 300 138" className="h-full w-full">
      <ellipse cx="152" cy="132" rx="132" ry="6" fill="#000" opacity="0.55" />

      {/* rear wing */}
      <path d="M10 50 L88 50" stroke={INK} strokeWidth="17" strokeLinecap="round" />
      <path d="M10 50 L88 50" stroke={look.main} strokeWidth="9" strokeLinecap="round" />
      <path d="M28 52 L32 74 M66 52 L70 74" stroke={INK} strokeWidth="11" strokeLinecap="round" />
      <path d="M28 52 L32 74 M66 52 L70 74" stroke={look.main} strokeWidth="5" strokeLinecap="round" />

      {/* the underbody shadow, so the wheels sit in something */}
      <rect x="56" y="94" width="196" height="14" rx="5" fill={INK} />

      {/* body */}
      <path
        d="M16 102 L14 76 L74 70 L104 42 L190 42 L228 72 L280 78 L292 90 L288 102 Z"
        fill={look.main} stroke={INK} strokeWidth="6" strokeLinejoin="round"
      />
      {/* the shaded flank — a light body still needs some form */}
      <path d="M18 100 L286 100 L291 90 L280 78 L18 86 Z" fill={look.deep} opacity="0.5" />

      {/* glass, with a pillar and a highlight so it is not a flat hole */}
      <path d="M112 52 L184 52 L210 74 L112 74 Z" fill={look.glass} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M164 52 L164 74" stroke={INK} strokeWidth="5" />
      <path d="M120 56 L150 56 L136 70 L120 70 Z" fill="#FFFFFF" opacity="0.35" />

      <path d="M266 82 L288 88 L286 95 L264 90 Z" fill="#FEF9C3" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <rect x="15" y="80" width="15" height="10" rx="3" fill="#FCA5A5" stroke={INK} strokeWidth="3" />

      {/* the name rides on the door — sized so nine characters still fit */}
      <rect x="100" y="76" width="106" height="26" rx="7" fill="#FAFAF9" stroke={INK} strokeWidth="4" />
      <text
        x="153" y="95" textAnchor="middle" fill={INK}
        fontSize={fs} fontWeight="900" fontFamily="system-ui, sans-serif" letterSpacing="-0.5"
      >
        {label}
      </text>

      <Wheel cx={68} cy={102} delay={0} reduced={reduced} />
      <Wheel cx={238} cy={102} delay={0.11} reduced={reduced} />
    </svg>
  );
}

// ── the world ───────────────────────────────────────────────────────────────

/**
 * One scrolling band. Each is 130% wide and starts 15% left of the screen so
 * that translating it by exactly one tile never exposes an edge, and the loop
 * is seamless because the shift equals the gradient's repeat. `roll` names a
 * keyframe whose distance matches this band's tile width — they must agree.
 */
function Band({ top, height, image, size, roll, seconds, reduced, opacity = 1 }: {
  top: string; height: string; image: string; size?: string; roll: string; seconds: number; reduced: boolean; opacity?: number;
}) {
  return (
    <div
      className="absolute"
      style={{
        top, height, left: "-15%", width: "130%", opacity,
        backgroundImage: image, backgroundSize: size, backgroundRepeat: "repeat",
        ...(reduced ? {} : anim(roll, seconds, 0, "linear", "infinite")),
      }}
    />
  );
}

/** The track, from the grandstand down to the kerb. */
function Track({ reduced }: { reduced: boolean }) {
  return (
    <div className="absolute inset-0" style={reduced ? undefined : anim("race-fade", 0.5, 0, "ease-out")}>
      {/* the crowd, furthest back and slowest */}
      <Band
        top="33%" height="9%" roll="race-roll-8" seconds={0.7} reduced={reduced} opacity={0.32}
        image={`radial-gradient(circle at 50% 50%, ${BODY} 0 30%, transparent 32%)`} size="1.6vw 1.6vw"
      />
      {/* hoardings along the wall */}
      <Band
        top="42%" height="5%" roll="race-roll-14" seconds={0.62} reduced={reduced}
        image={`repeating-linear-gradient(90deg, rgba(231,229,228,0.5) 0 6.5vw, rgba(168,162,158,0.24) 6.5vw 14vw)`}
      />
      <div className="absolute inset-x-0" style={{ top: "46.8%", height: "3px", background: BODY, opacity: 0.5 }} />

      {/* asphalt */}
      <div className="absolute inset-x-0" style={{ top: "47%", height: "25%", background: "linear-gradient(180deg,#2A2A31,#3F3F46 42%,#25252A)" }} />
      {/* the far lane's dashes run slower than the near lane's — that gap is depth */}
      <Band
        top="55.4%" height="4px" roll="race-roll-20" seconds={0.72} reduced={reduced} opacity={0.4}
        image={`repeating-linear-gradient(90deg, ${BODY} 0 8vw, transparent 8vw 20vw)`}
      />
      <Band
        top="62%" height="6px" roll="race-roll-20" seconds={0.5} reduced={reduced} opacity={0.85}
        image={`repeating-linear-gradient(90deg, ${BODY} 0 8vw, transparent 8vw 20vw)`}
      />
      {/* kerb: the fastest thing on screen, because it is the closest */}
      <Band
        top="71.6%" height="2.6%" roll="race-roll-12" seconds={0.3} reduced={reduced} opacity={0.9}
        image={`repeating-linear-gradient(90deg, #FAFAF9 0 6vw, #FCA5A5 6vw 12vw)`}
      />
    </div>
  );
}

/** Air tearing past. Thin, low-contrast, and behind the cars. */
function Streaks({ reduced }: { reduced: boolean }) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="absolute z-10"
          style={{
            left: 0, top: `${51 + i * 2.7}%`, height: 4, borderRadius: 3,
            width: `${10 + rnd(i + 5) * 16}vw`,
            background: `linear-gradient(90deg, transparent, ${BODY}, transparent)`,
            opacity: 0.4,
            ...anim("race-streak", 0.55 + rnd(i + 90) * 0.5, 0.3 + rnd(i + 40) * 0.9, "linear", "infinite"),
          }}
        />
      ))}
    </>
  );
}

/** Dust off the rear wheel. Lives inside the car, so it follows the car. */
function Dust({ reduced }: { reduced: boolean }) {
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => {
        const size = 1.2 + rnd(i + 200) * 1.8;
        return (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: "1vw", bottom: `${0.2 + rnd(i + 300) * 1.4}vw`,
              width: `${size}vw`, height: `${size}vw`, background: BODY,
              ...anim("race-dust", 0.8 + rnd(i + 400) * 0.5, 0.7 + i * 0.13, "ease-out", "infinite"),
            }}
          />
        );
      })}
    </>
  );
}

/**
 * The chequered flag. It waves rather than blinks: the pole swings ±2.5°, and
 * five cloth strips ripple on staggered delays so the wave travels away from
 * the pole. Every strip carries its own light outline, which is what keeps the
 * black squares legible against a black room.
 */
function Flag({ reduced }: { reduced: boolean }) {
  const waves = ["race-wave-a", "race-wave-b", "race-wave-b", "race-wave-c", "race-wave-c"];
  return (
    <div
      className="absolute z-40"
      style={{ right: "2vw", top: "11%", width: "26vw", height: "24vh", ...(reduced ? {} : anim("race-flagin", 0.6, 4.25, "cubic-bezier(.2,1.2,.35,1)")) }}
    >
      <div className="h-full w-full" style={reduced ? undefined : anim("race-flagswing", 1.6, 4.85, "ease-in-out", "infinite")}>
        <svg viewBox="0 0 320 220" className="h-full w-full">
          <path d="M296 214 L266 12" stroke={INK} strokeWidth="16" strokeLinecap="round" />
          <path d="M296 214 L266 12" stroke={BODY} strokeWidth="9" strokeLinecap="round" />
          <circle cx="266" cy="12" r="10" fill={BODY} stroke={INK} strokeWidth="4" />
          {waves.map((wave, i) => {
            const x = 262 - (i + 1) * 44;
            return (
              <g key={i} style={reduced ? undefined : anim(wave, 1.0, 4.85 + i * 0.09, "ease-in-out", "infinite")}>
                {[0, 1, 2, 3].map((r) => (
                  <rect key={r} x={x} y={22 + r * 29} width="44" height="29" fill={(i + r) % 2 === 0 ? "#FAFAF9" : "#1C1917"} />
                ))}
                <rect x={x} y="22" width="44" height="116" fill="none" stroke={BODY} strokeWidth="2.5" opacity="0.9" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Light bits over the line. Light only — anything dark would not be there. */
function Bits({ reduced }: { reduced: boolean }) {
  if (reduced) return null;
  const colours = ["#FDE047", "#FAFAF9", "#7DD3FC", "#FB923C"];
  return (
    <>
      {Array.from({ length: 18 }, (_, i) => (
        <div
          key={i}
          className="absolute z-30"
          style={{
            left: `${40 + rnd(i + 600) * 55}%`, top: 0,
            width: `${0.6 + rnd(i + 700) * 0.9}vw`, height: `${0.9 + rnd(i + 800) * 1.2}vw`,
            background: colours[i % colours.length], borderRadius: rnd(i + 900) > 0.5 ? "50%" : 2,
            ...anim(i % 2 ? "race-bit-a" : "race-bit-b", 1.6 + rnd(i + 1000) * 0.9, 4.8 + rnd(i + 1100) * 0.7, "linear"),
          }}
        />
      ))}
    </>
  );
}

// ── the scene ───────────────────────────────────────────────────────────────

export function RaceScene({ passerName, passedName, count, reduced: reducedProp }: {
  passerName: string; passedName: string; count: number; reduced?: boolean;
}) {
  const system = useReducedMotion();
  const reduced = reducedProp ?? !!system;

  // Car geometry. 34vw wide at a 300×138 box, bottom edge parked just under the
  // near lane; the far lane is the same car lifted 8vh. Everything else in the
  // choreography is expressed as translate(Xvw, -8vh | 0) against this.
  const car: CSSProperties = { position: "absolute", left: 0, bottom: `${100 - NEAR_LANE - 0.7}%`, width: "34vw", height: "15.6vw" };
  const lift = `${FAR_LANE - NEAR_LANE}vh`;

  const passerPos: CSSProperties = reduced
    ? { ...car, zIndex: 30, transform: `translate(51vw, ${lift})` }
    : { ...car, zIndex: 30, ...anim("race-passer", 6.0, 0.6, "linear") };
  const passedPos: CSSProperties = reduced
    ? { ...car, zIndex: 20, transform: `translate(12vw, ${lift})` }
    : { ...car, zIndex: 20, ...anim("race-passed", 6.45, 0.15, "linear") };

  const plural = count === 1 ? "transfer" : "transfers";

  return (
    <div className="absolute inset-0 overflow-hidden select-none" data-testid="race-scene">
      <style>{`
        @keyframes race-fade { from { opacity: 0; } to { opacity: 1; } }

        /* the world scrolling. each shift equals one tile of its gradient. */
        @keyframes race-roll-8  { to { transform: translateX(-8vw); } }
        @keyframes race-roll-12 { to { transform: translateX(-12vw); } }
        @keyframes race-roll-14 { to { transform: translateX(-14vw); } }
        @keyframes race-roll-20 { to { transform: translateX(-20vw); } }

        @keyframes race-streak { from { transform: translateX(118vw); } to { transform: translateX(-34vw); } }
        @keyframes race-wheel  { to { transform: rotate(360deg); } }

        /* catch (0.6-2.3s) → close up (2.3-3.0) → HOLD in the draft (3.0-3.35)
           → swing into the near lane (3.65) → go (4.65) → tuck back in ahead. */
        @keyframes race-passer {
          0%     { transform: translate(-46vw, -8vh) scale(1); }
          28.3%  { transform: translate(-4vw, -8vh) scale(1); }
          40%    { transform: translate(3vw, -8vh) scale(1); }
          45.8%  { transform: translate(4vw, -8vh) scale(1); }
          50.8%  { transform: translate(7vw, 0vh) scale(1.07); }
          67.5%  { transform: translate(46vw, 0vh) scale(1.07); }
          75%    { transform: translate(52vw, -8vh) scale(1); }
          85%    { transform: translate(51vw, -8vh) scale(1); }
          100%   { transform: translate(51vw, -8vh) scale(1); }
        }
        /* never mocked: it holds a clean line and simply ends up behind. */
        @keyframes race-passed {
          0%     { transform: translate(118vw, -8vh); }
          8.1%   { transform: translate(52vw, -8vh); }
          12.4%  { transform: translate(38vw, -8vh); }
          59.7%  { transform: translate(38vw, -8vh); }
          78.3%  { transform: translate(16vw, -8vh); }
          89.1%  { transform: translate(12vw, -8vh); }
          100%   { transform: translate(12vw, -8vh); }
        }
        @keyframes race-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-0.35vh); } }
        /* buffeting in the draft, then the nose lifts under power */
        @keyframes race-tilt {
          0%   { transform: rotate(0deg); }
          7%   { transform: rotate(0.9deg); }
          14%  { transform: rotate(-0.9deg); }
          21%  { transform: rotate(0.3deg); }
          30%  { transform: rotate(-2.4deg); }
          58%  { transform: rotate(-1.5deg); }
          78%  { transform: rotate(0.7deg); }
          100% { transform: rotate(0deg); }
        }

        @keyframes race-dust {
          0%   { transform: translate(0, 0) scale(0.25); opacity: 0.5; }
          100% { transform: translate(-11vw, -3.5vh) scale(2.4); opacity: 0; }
        }
        @keyframes race-line { from { transform: translateX(118vw); } to { transform: translateX(-14vw); } }

        /* the flag WAVES. a transform, never a blink. */
        @keyframes race-flagin    { 0% { transform: translateX(54vw) rotate(10deg); opacity: 0; } 100% { transform: translateX(0) rotate(0deg); opacity: 1; } }
        @keyframes race-flagswing { 0%, 100% { transform: rotate(-2.5deg); } 50% { transform: rotate(2.5deg); } }
        @keyframes race-wave-a { 0%, 100% { transform: translateY(-4px); } 50% { transform: translateY(4px); } }
        @keyframes race-wave-b { 0%, 100% { transform: translateY(-9px); } 50% { transform: translateY(9px); } }
        @keyframes race-wave-c { 0%, 100% { transform: translateY(-15px); } 50% { transform: translateY(15px); } }

        @keyframes race-bit-a { 0% { transform: translate(0, -12vh) rotate(0deg); opacity: 0; } 8% { opacity: 1; } 100% { transform: translate(-7vw, 96vh) rotate(680deg); opacity: 0; } }
        @keyframes race-bit-b { 0% { transform: translate(0, -12vh) rotate(0deg); opacity: 0; } 8% { opacity: 1; } 100% { transform: translate(5vw, 96vh) rotate(-540deg); opacity: 0; } }

        @keyframes race-kicker  { 0% { transform: translateY(-46vh) rotate(-7deg); opacity: 0; } 100% { transform: translateY(0) rotate(0deg); opacity: 1; } }
        @keyframes race-caption { 0% { transform: translateY(26vh); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        @keyframes race-pop     { 0% { transform: scale(0.2) rotate(-9deg); opacity: 0; } 62% { transform: scale(1.12) rotate(2deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
      `}</style>

      {/* a little warmth under the track so the cars are not floating in ink */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 80% at 50% 62%, rgba(253,224,71,0.10), transparent 62%)" }} />

      <Track reduced={reduced} />
      <Streaks reduced={reduced} />

      {/* the finish line, sweeping under both cars — the passer reaches it first */}
      <div
        className="absolute z-10"
        style={{
          left: 0, top: "47%", height: "25%", width: "5vw",
          backgroundColor: "#1C1917",
          backgroundImage:
            "linear-gradient(45deg,#FAFAF9 25%,transparent 25%,transparent 75%,#FAFAF9 75%)," +
            "linear-gradient(45deg,#FAFAF9 25%,transparent 25%,transparent 75%,#FAFAF9 75%)",
          backgroundSize: "2.4vw 2.4vw",
          backgroundPosition: "0 0, 1.2vw 1.2vw",
          ...(reduced ? { transform: "translateX(-14vw)" } : anim("race-line", 1.8, 4.3, "linear")),
        }}
      />

      {/* the car being passed */}
      <div style={passedPos}>
        <div className="h-full w-full" style={reduced ? undefined : anim("race-bob", 0.62, 0.15, "ease-in-out", "infinite")}>
          <Car look={PASSED} label={carLabel(passedName)} reduced={reduced} />
        </div>
      </div>

      {/* the car doing the passing */}
      <div style={passerPos}>
        <div className="h-full w-full" style={reduced ? undefined : anim("race-bob", 0.55, 0.6, "ease-in-out", "infinite")}>
          <div className="relative h-full w-full" style={reduced ? undefined : anim("race-tilt", 2.6, 2.95, "ease-in-out")}>
            <Dust reduced={reduced} />
            <Car look={PASSER} label={carLabel(passerName)} reduced={reduced} />
          </div>
        </div>
      </div>

      <Flag reduced={reduced} />
      <Bits reduced={reduced} />

      {/* the last word belongs to the driver who got passed */}
      <div
        className="absolute z-40 rounded-2xl px-[1.6vw] py-[0.7vw] text-[1.7vw] font-black leading-none"
        style={{
          left: "16vw", top: "27%", background: "#FAFAF9", color: INK, border: `4px solid ${INK}`,
          ...(reduced ? {} : anim("race-pop", 0.5, 5.45, "cubic-bezier(.2,1.4,.4,1)")),
        }}
      >
        Nice one 👏
        <div
          className="absolute -bottom-[1vw] left-[2.4vw] h-[1.7vw] w-[1.7vw] rotate-45"
          style={{ background: "#FAFAF9", borderRight: `4px solid ${INK}`, borderBottom: `4px solid ${INK}` }}
        />
      </div>

      <div
        className="absolute left-0 right-0 top-[6%] z-50 mx-auto w-max rounded-full px-[2.2vw] py-[0.7vw] text-[2vw] font-black tracking-[0.35em] text-white"
        style={{ background: PASSER.deep, boxShadow: `0 0 40px ${PASSER.main}55`, ...(reduced ? {} : anim("race-kicker", 0.55, 0.1, "cubic-bezier(.2,1.5,.4,1)")) }}
      >
        ✦ TAKING THE LEAD ✦
      </div>

      {/* Names live here at full length and truncate in CSS, so the caption
          survives "Jonjairo Mercado-Nuñez" where the door decal cannot. */}
      <div
        className="absolute inset-x-0 bottom-[4%] z-50 px-[6vw] text-center"
        style={reduced ? undefined : anim("race-caption", 0.55, 4.95, "cubic-bezier(.2,1.3,.4,1)")}
      >
        <div className="truncate font-black leading-none text-white" style={{ fontSize: "5.4vw", textShadow: "0 0.12em 0 rgba(0,0,0,.45)" }}>
          {passerName}
        </div>
        <div className="mt-[1vw] text-[2.4vw] font-bold uppercase tracking-[0.2em]" style={{ color: PASSER.main }}>
          {count} {plural} today
        </div>
        <div className="mt-[0.5vw] truncate text-[2vw] font-semibold text-white/75">
          just moved ahead of {passedName}
        </div>
        <div
          className="mt-[1.1vw] text-[1.15vw] font-normal lowercase tracking-[0.02em] text-white/40"
          style={reduced ? undefined : anim("race-fade", 0.5, 5.9, "ease-out")}
        >
          nobody crashed. everybody keeps driving. mirrors on.
        </div>
      </div>
    </div>
  );
}
