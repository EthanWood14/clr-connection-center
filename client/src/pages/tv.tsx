/**
 * The office TV.
 *
 * A signage loop, not a dashboard. Full-screen pages come in and go out on a
 * timer the way ads rotate on a screen in a lobby — scorecard, team, latest,
 * a training tip — and each one re-enters fresh so its bars grow and its
 * numbers count up again every time it comes around. The moments (a transfer
 * lands, a meeting is set or moved, an appointment is missed, a call falls
 * through, a milestone) cut in over whatever page is up, then the loop resumes.
 *
 * Rules that shape it:
 *
 *  - Nothing flashes faster than twice a second. It is a wall the whole floor
 *    faces all day, and above three per second full-screen flashing is a
 *    seizure risk. Same constraint as the alarms, for the same reason.
 *  - Moments queue; they never overlap, and the page loop pauses under them.
 *  - A moment is remembered as played when it STARTS, not when it is queued.
 *    Marking on enqueue meant a reload mid-queue lost everything behind the
 *    one on screen, permanently. Seen live.
 *  - It reloads itself when C3 deploys, so it is never a week behind the app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRightLeft, CalendarCheck2, CalendarClock, CalendarX2, Flame, GraduationCap, Trophy, Users,
} from "lucide-react";
import { Confetti } from "@/components/goal-celebration";
import { HypeScene, HYPE_IMPACT_MS } from "@/components/tv/hype";
import { RaceScene } from "@/components/tv/race";
import { detectOvertakes, type Overtake, type RankRow } from "@shared/tv-overtake";
import { APP_VERSION } from "@shared/version";

// ── types (mirror server/tv-board.ts) ───────────────────────────────────────
type Kind = "transfer" | "appointment" | "rescheduled" | "fell_through" | "missed_appointment";
interface TvEvent { id: string; kind: Kind; at: string; borrower: string; who: string; lo: string | null; detail: string | null }
interface Person {
  id: number; name: string; transfersToday: number; transfersWeek: number;
  appointmentsToday: number; appointmentsWeek: number; goalTransfersWeekly: number; goalAppointmentsWeekly: number;
  lastTransferAt?: string | null; lastCallAt?: string | null;
}
interface Milestone { id: string; kind: string; headline: string; detail: string; weight: 1 | 2 | 3 }
interface Tip { day: number; half: "morning" | "afternoon" | "eod"; text: string; author: string }
interface Feed {
  version: string; now: string; today: string; weekStart: string; cursor: string;
  scorecard: {
    people: Person[];
    team: { transfersToday: number; transfersWeek: number; appointmentsToday: number; fellThroughToday: number; missedToday: number };
  };
  events: TvEvent[]; recent: TvEvent[]; milestones: Milestone[]; tip: Tip | null;
}

type Moment =
  | { type: "event"; key: string; event: TvEvent }
  | { type: "milestone"; key: string; milestone: Milestone }
  | { type: "overtake"; key: string; overtake: Overtake };

const POLL_MS = 10_000;

/**
 * "2h 14m", "6m", "just now" — how long since something last happened.
 *
 * Deliberately plain. It is a wall the whole floor reads, so a quiet stretch
 * says so without shouting: the number goes dim-amber once someone has been
 * quiet a while rather than red, because this is information, not a telling-off.
 */
function since(iso: string | null | undefined, now: number): { label: string; quiet: boolean } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return { label: "just now", quiet: false };
  if (mins < 60) return { label: `${mins}m`, quiet: mins >= 45 };
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return { label: m ? `${h}h ${m}m` : `${h}h`, quiet: true };
  const d = Math.floor(h / 24);
  return { label: d === 1 ? "1 day" : `${d} days`, quiet: true };
}
const TIP_MS = 45_000;
const PLAYED_KEY = "c3:tv:played";

/** How long each kind holds the screen. A transfer earns the longest beat. */
const HOLD_MS: Record<Kind | "milestone" | "overtake", number> = {
  transfer: 9500, appointment: 8000, rescheduled: 8000, fell_through: 8500, missed_appointment: 7500, milestone: 10500,
  // The race runs its own ~7s beat and settles by 6.6s.
  overtake: 8500,
};

const KIND: Record<Kind, { label: string; hue: string; ring: string; Icon: typeof ArrowRightLeft; confetti: boolean }> = {
  transfer:           { label: "Transfer",            hue: "from-amber-400 via-yellow-300 to-amber-500",   ring: "ring-amber-300/60",   Icon: ArrowRightLeft, confetti: true },
  appointment:        { label: "Meeting set",         hue: "from-sky-400 via-cyan-300 to-blue-500",        ring: "ring-sky-300/60",     Icon: CalendarCheck2, confetti: false },
  rescheduled:        { label: "Meeting moved",       hue: "from-teal-400 via-emerald-300 to-teal-500",    ring: "ring-teal-300/60",    Icon: CalendarClock,  confetti: false },
  fell_through:       { label: "Fell through",        hue: "from-rose-500 via-red-400 to-rose-700",        ring: "ring-rose-300/50",    Icon: Flame,          confetti: false },
  missed_appointment: { label: "Missed appointment",  hue: "from-orange-500 via-amber-400 to-orange-600",  ring: "ring-orange-300/50",  Icon: CalendarX2,     confetti: false },
};

// ── the deck ────────────────────────────────────────────────────────────────
// Order and dwell. The scorecard is what people look up for, so it stays
// longest and comes round most often.
type PageId = "scorecard" | "team" | "latest" | "tip";
const DECK: Array<{ id: PageId; dwellMs: number }> = [
  { id: "scorecard", dwellMs: 14_000 },
  { id: "team",      dwellMs: 10_000 },
  { id: "latest",    dwellMs: 11_000 },
  { id: "scorecard", dwellMs: 14_000 },
  { id: "tip",       dwellMs: 12_000 },
];

// ── sound ───────────────────────────────────────────────────────────────────
// Synthesised so nothing has to download. A kiosk browser lets audio autoplay;
// an ordinary one blocks it until someone clicks, and then this simply does
// nothing — the screen carries the moment either way.
let audio: AudioContext | null = null;
function tone(notes: number[], opts: { type?: OscillatorType; gap?: number; level?: number; len?: number } = {}) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audio) audio = new Ctx();
    void audio.resume();
    const start = audio.currentTime;
    const master = audio.createGain();
    master.gain.value = opts.level ?? 0.14;
    master.connect(audio.destination);
    notes.forEach((f, i) => {
      const o = audio!.createOscillator(); const g = audio!.createGain();
      const at = start + i * (opts.gap ?? 0.09);
      o.type = opts.type ?? "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, at + (opts.len ?? 0.55));
      o.connect(g).connect(master); o.start(at); o.stop(at + (opts.len ?? 0.55) + 0.05);
    });
  } catch { /* audio is a bonus */ }
}
/** A burst of shaped noise — the pins, or the ball hitting the gutter. */
function crash(opts: { delayMs: number; level: number; len: number; low?: boolean }) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audio) audio = new Ctx();
    void audio.resume();
    const at = audio.currentTime + opts.delayMs / 1000;
    const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * opts.len), audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = audio.createBufferSource(); src.buffer = buf;
    const f = audio.createBiquadFilter(); f.type = opts.low ? "lowpass" : "bandpass"; f.frequency.value = opts.low ? 220 : 1800; f.Q.value = 0.7;
    const g = audio.createGain(); g.gain.value = opts.level;
    src.connect(f).connect(g).connect(audio.destination);
    src.start(at);
  } catch { /* audio is a bonus */ }
}

const SOUND: Record<Kind | "milestone" | "overtake", () => void> = {
  // Timed to the choreography in tv/hype.tsx: the crash lands when the word
  // does, and the fanfare follows it.
  transfer:           () => { crash({ delayMs: HYPE_IMPACT_MS.transfer, level: 0.5, len: 0.45 }); setTimeout(() => tone([523.25, 659.25, 783.99, 1046.5]), HYPE_IMPACT_MS.transfer + 120); },
  appointment:        () => { crash({ delayMs: HYPE_IMPACT_MS.appointment, level: 0.4, len: 0.3, low: true }); setTimeout(() => tone([440, 554.37, 659.25], { gap: 0.11 }), HYPE_IMPACT_MS.appointment + 150); },
  rescheduled:        () => { crash({ delayMs: HYPE_IMPACT_MS.rescheduled, level: 0.25, len: 0.25 }); setTimeout(() => tone([494, 587.33], { gap: 0.14, level: 0.1 }), HYPE_IMPACT_MS.rescheduled + 200); },
  fell_through:       () => { crash({ delayMs: HYPE_IMPACT_MS.fell_through, level: 0.3, len: 0.35 }); setTimeout(() => tone([330, 262], { type: "sine", gap: 0.18, level: 0.09, len: 0.5 }), 2400); crash({ delayMs: 2900, level: 0.35, len: 0.6, low: true }); },
  missed_appointment: () => { crash({ delayMs: HYPE_IMPACT_MS.missed_appointment, level: 0.35, len: 0.4 }); setTimeout(() => tone([392, 311], { type: "sine", gap: 0.16, level: 0.1, len: 0.5 }), HYPE_IMPACT_MS.missed_appointment + 400); },
  milestone:          () => { crash({ delayMs: HYPE_IMPACT_MS.milestone, level: 0.55, len: 0.5 }); setTimeout(() => tone([523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98], { gap: 0.08, level: 0.16, len: 0.7 }), HYPE_IMPACT_MS.milestone + 150); },
  // An engine going past, then the flag: noise swelling as the car closes,
  // and a two-note horn as it crosses at about 4.8s.
  overtake:           () => { crash({ delayMs: 600, level: 0.16, len: 1.9, low: true }); crash({ delayMs: 3000, level: 0.3, len: 1.6, low: true }); setTimeout(() => tone([659.25, 880], { gap: 0.13, level: 0.13, len: 0.5 }), 4800); },
};

// ── small pieces ────────────────────────────────────────────────────────────
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return now;
}

/** A number that rolls up from zero when it appears, and to its new value after. */
function CountUp({ value, className, from = 0 }: { value: number; className?: string; from?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : from);
  const cur = useRef(reduced ? value : from);
  useEffect(() => {
    if (reduced) { setShown(value); cur.current = value; return; }
    const start = cur.current, delta = value - start;
    if (!delta) return;
    const t0 = performance.now(), dur = Math.min(1600, 500 + Math.abs(delta) * 50);
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + delta * eased);
      setShown(v); cur.current = v;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <span className={className}>{shown}</span>;
}

function timeAgo(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : "earlier";
}

/** Staggered entrance for a list — each row a beat after the last. */
const stagger = { show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } } };
const rise = (reduced: boolean) => ({
  hidden: { opacity: 0, y: reduced ? 0 : 22 },
  show:   { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
});

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[clamp(1rem,1.5vw,1.6rem)] font-semibold uppercase tracking-[0.3em] text-white/55">{children}</p>;
}

// ── pages ───────────────────────────────────────────────────────────────────
/** "transfer 2h 14m" — dim once it has been quiet a while, never alarming. */
function SinceLabel({ what, at, now }: { what: string; at: string | null | undefined; now: number }) {
  const s = since(at, now);
  if (!s) return <span className="text-white/25">no {what} yet</span>;
  return (
    <span className={s.quiet ? "text-amber-300/70" : "text-white/45"}>
      {what} <span className="font-semibold">{s.label}</span>
    </span>
  );
}

function ScorecardPage({ people, reduced, now }: { people: Person[]; reduced: boolean; now: number }) {
  const leader = people[0];
  const max = Math.max(1, leader?.transfersToday ?? 1);
  return (
    <div className="flex h-full flex-col px-16 py-10" data-testid="tv-page-scorecard">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <Eyebrow>Transfers today</Eyebrow>
          <h2 className="mt-1 text-[clamp(2.4rem,4.4vw,4.6rem)] font-black leading-none tracking-tight">Scorecard</h2>
        </div>
        {leader && leader.transfersToday > 0 && (
          <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
            className="flex items-center gap-3 rounded-full border border-amber-300/40 bg-amber-400/10 px-6 py-3 text-[clamp(1.2rem,2vw,2rem)] text-amber-300">
            <Trophy className="h-8 w-8" /> {leader.name} leads
          </motion.div>
        )}
      </div>
      <motion.ul variants={stagger} initial="hidden" animate="show" className="flex min-h-0 flex-1 flex-col justify-start gap-4 overflow-hidden">
        {people.slice(0, 8).map((p, i) => {
          const pct = Math.round((p.transfersToday / max) * 100);
          const gold = i === 0 && p.transfersToday > 0;
          return (
            <motion.li key={p.id} variants={rise(reduced)} className="grid grid-cols-[4rem_1fr_9rem_10rem] items-center gap-6" data-testid="tv-row">
              <span className={`text-[clamp(1.6rem,2.6vw,2.8rem)] font-black ${gold ? "text-amber-300" : "text-white/35"}`}>{i + 1}</span>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="truncate text-[clamp(1.8rem,3vw,3.2rem)] font-bold leading-tight">{p.name}</span>
                  <span className="shrink-0 text-[clamp(1rem,1.4vw,1.4rem)] text-white/45">{p.transfersWeek} this week</span>
                </div>
                <div className="mt-2 h-5 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className={`h-full rounded-full ${gold ? "bg-gradient-to-r from-amber-400 to-yellow-300" : "bg-gradient-to-r from-sky-500 to-cyan-400"}`}
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    transition={{ type: "spring", stiffness: 90, damping: 20, delay: 0.25 + i * 0.07 }}
                  />
                </div>
                {/* How long since each of them last happened. Under the bar so
                    it reads as a footnote to the row, not as a score. */}
                <div className="mt-1.5 flex gap-5 text-[clamp(0.85rem,1.15vw,1.15rem)] leading-none" data-testid={`tv-since-${p.id}`}>
                  <SinceLabel what="transfer" at={p.lastTransferAt} now={now} />
                  <SinceLabel what="call" at={p.lastCallAt} now={now} />
                </div>
              </div>
              <CountUp value={p.transfersToday} className="text-right text-[clamp(2.6rem,4.4vw,4.8rem)] font-black leading-none" />
              <div className="text-right text-[clamp(1rem,1.4vw,1.4rem)] text-white/50">
                {p.goalTransfersWeekly ? `${Math.min(100, Math.round((p.transfersWeek / p.goalTransfersWeekly) * 100))}% of goal` : "no goal"}
              </div>
            </motion.li>
          );
        })}
        {!people.length && <li className="text-white/50">No CLRs on the board.</li>}
      </motion.ul>
    </div>
  );
}

function TeamPage({ team, teamGoal, reduced }: { team: Feed["scorecard"]["team"]; teamGoal: number; reduced: boolean }) {
  const weekPct = teamGoal ? Math.min(100, Math.round((team.transfersWeek / teamGoal) * 100)) : null;
  return (
    <div className="grid h-full grid-cols-[3fr_2fr] gap-10 px-16 py-10" data-testid="tv-page-team">
      <motion.div
        initial={{ opacity: 0, scale: reduced ? 1 : 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 140, damping: 18 }}
        className="flex flex-col justify-center rounded-[2.5rem] border border-amber-300/25 bg-gradient-to-br from-amber-400/15 via-transparent to-transparent p-14"
      >
        <Eyebrow>Team · today</Eyebrow>
        <div className="mt-2 flex items-end gap-8">
          <CountUp value={team.transfersToday} className="text-[clamp(8rem,17vw,17rem)] font-black leading-[0.85] text-amber-300" />
          <div className="pb-6 text-[clamp(1.4rem,2.4vw,2.6rem)] text-white/75">
            transfers
            <div className="flex items-center gap-2 text-white/45"><Users className="h-6 w-6" /> {team.appointmentsToday} meetings set</div>
          </div>
        </div>
      </motion.div>
      <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-col gap-6">
        <motion.div variants={rise(reduced)} className="rounded-3xl border border-white/10 bg-white/[0.05] p-8">
          <Eyebrow>This week</Eyebrow>
          <p className="mt-1 text-[clamp(3rem,6vw,6rem)] font-black leading-none"><CountUp value={team.transfersWeek} /></p>
          {weekPct !== null && (
            <div className="mt-4">
              <div className="h-4 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-lime-300"
                  initial={{ width: 0 }} animate={{ width: `${weekPct}%` }} transition={{ type: "spring", stiffness: 90, damping: 20, delay: 0.4 }} />
              </div>
              <p className="mt-2 text-[clamp(1rem,1.4vw,1.4rem)] text-white/50">{weekPct}% of the team goal of {teamGoal}</p>
            </div>
          )}
        </motion.div>
        <motion.div variants={rise(reduced)} className="rounded-3xl border border-white/10 bg-white/[0.05] p-8">
          <Eyebrow>Didn't stick</Eyebrow>
          <div className="mt-2 flex items-baseline gap-5">
            <span className="text-[clamp(3rem,6vw,6rem)] font-black leading-none text-rose-300"><CountUp value={team.fellThroughToday} /></span>
            <span className="text-[clamp(1rem,1.5vw,1.5rem)] text-white/55">fell through</span>
          </div>
          <div className="mt-3 flex items-baseline gap-5">
            <span className="text-[clamp(2rem,3.6vw,3.6rem)] font-bold leading-none text-orange-300"><CountUp value={team.missedToday} /></span>
            <span className="text-[clamp(1rem,1.5vw,1.5rem)] text-white/55">missed appointments</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function LatestPage({ recent, now, reduced }: { recent: TvEvent[]; now: Date; reduced: boolean }) {
  return (
    <div className="flex h-full flex-col px-16 py-10" data-testid="tv-page-latest">
      <Eyebrow>What just happened</Eyebrow>
      <h2 className="mt-1 mb-8 text-[clamp(2.4rem,4.4vw,4.6rem)] font-black leading-none tracking-tight">Latest</h2>
      <motion.ul variants={stagger} initial="hidden" animate="show" className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        {recent.slice(0, 7).map((e) => {
          const k = KIND[e.kind]; const Icon = k.Icon;
          return (
            <motion.li key={e.id} variants={rise(reduced)} className="flex items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4">
              <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${k.hue}`}><Icon className="h-8 w-8 text-[#0B1220]" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[clamp(1.5rem,2.4vw,2.5rem)] font-bold leading-tight">{e.borrower}</p>
                <p className="truncate text-[clamp(1rem,1.5vw,1.5rem)] text-white/55">{k.label} · {e.who}{e.detail ? ` · ${e.detail}` : ""}</p>
              </div>
              <span className="shrink-0 text-[clamp(1rem,1.4vw,1.4rem)] text-white/40">{timeAgo(e.at, now)}</span>
            </motion.li>
          );
        })}
        {!recent.length && <li className="text-white/50">Nothing yet this week.</li>}
      </motion.ul>
    </div>
  );
}

function TipPage({ tip, reduced }: { tip: Tip | null; reduced: boolean }) {
  return (
    <div className="flex h-full items-center justify-center px-24" data-testid="tv-page-tip">
      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}
        className="max-w-[1500px] rounded-[2.5rem] border border-violet-300/25 bg-gradient-to-br from-violet-500/15 via-transparent to-transparent p-16"
      >
        <div className="mb-6 flex items-center gap-3 text-[clamp(1rem,1.5vw,1.6rem)] font-semibold uppercase tracking-[0.3em] text-violet-200/80">
          <GraduationCap className="h-8 w-8" /> From the training plan
        </div>
        {tip ? (
          <>
            <blockquote className="text-[clamp(1.8rem,3.1vw,3.4rem)] font-medium leading-snug text-white [text-wrap:balance]">“{tip.text}”</blockquote>
            <p className="mt-8 text-[clamp(1.1rem,1.7vw,1.7rem)] text-white/50">
              {tip.day > 0 ? `Day ${tip.day} · ${tip.half === "eod" ? "by end of day" : tip.half} · ` : ""}{tip.author}
            </p>
          </>
        ) : <p className="text-white/50">No training plan yet.</p>}
      </motion.div>
    </div>
  );
}

// ── the moment overlay ──────────────────────────────────────────────────────
// Every moment is a hype screen. See components/tv/hype.tsx for what each
// kind does with the word and the screen; this only decides the words under it.
function MomentOverlay({ moment, reduced }: { moment: Moment; reduced: boolean }) {
  // The race is its own scene rather than a hype screen: it is about two
  // people on the board, not one thing that happened.
  if (moment.type === "overtake") {
    const o = moment.overtake;
    return (
      <motion.div
        key={moment.key}
        className="absolute inset-0 z-30"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}
        data-testid="tv-moment-overtake"
      >
        <div className="absolute inset-0 bg-[#0B1220]/90" />
        <RaceScene passerName={o.passerName} passedName={o.passedName} count={o.count} reduced={reduced} />
      </motion.div>
    );
  }
  const isMilestone = moment.type === "milestone";
  const kind = isMilestone ? "milestone" : moment.event.kind;
  const strikeLike = kind === "transfer" || kind === "milestone";
  const hue = isMilestone ? KIND.transfer.hue : KIND[moment.event.kind].hue;
  const headline = isMilestone ? moment.milestone.headline : moment.event.borrower;
  const who = isMilestone ? "Milestone" : moment.event.who;
  const detail = isMilestone ? moment.milestone.detail : moment.event.detail;
  return (
    <motion.div
      key={moment.key}
      className="absolute inset-0 z-30"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}
      data-testid={`tv-moment-${kind}`}
    >
      <motion.div className={`absolute inset-0 bg-gradient-to-br ${hue}`} initial={{ opacity: 0 }} animate={{ opacity: 0.14 }} />
      <div className="absolute inset-0 bg-[#0B1220]/90" />
      {strikeLike && !reduced && <Confetti running dramatic />}
      <HypeScene kind={kind} headline={headline} who={who} detail={detail} reduced={reduced} />
    </motion.div>
  );
}

// ── the page ────────────────────────────────────────────────────────────────
/** Pages slide in from the right and out to the left, like a deck being dealt. */
const slide = (reduced: boolean) => ({
  enter:  { x: reduced ? 0 : "6%", opacity: 0, scale: reduced ? 1 : 0.985 },
  center: { x: 0, opacity: 1, scale: 1, transition: { type: "spring", stiffness: 120, damping: 22 } },
  exit:   { x: reduced ? 0 : "-6%", opacity: 0, scale: reduced ? 1 : 0.985, transition: { duration: 0.45, ease: "easeIn" } },
});

export default function TvBoard() {
  const [, params] = useRoute("/tv/:token");
  const token = params?.token ?? "";
  const reduced = !!useReducedMotion();
  const now = useNow();

  const cursorRef = useRef<string | null>(null);
  const [tipSeed, setTipSeed] = useState(() => Math.floor(Date.now() / TIP_MS));
  useEffect(() => { const id = setInterval(() => setTipSeed((s) => s + 1), TIP_MS); return () => clearInterval(id); }, []);

  const { data, isError } = useQuery<Feed>({
    queryKey: ["/api/tv", token, "feed", tipSeed],
    queryFn: async () => {
      const q = new URLSearchParams({ tip: String(tipSeed) });
      if (cursorRef.current) q.set("since", cursorRef.current);
      const r = await fetch(`/api/tv/${encodeURIComponent(token)}/feed?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    enabled: !!token,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  // Deploy → reload once. Guarded so a bad build cannot loop the screen.
  useEffect(() => {
    if (!data?.version || data.version === APP_VERSION) return;
    try {
      const k = `c3:tv:reloaded:${data.version}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch { /* fine */ }
    window.location.reload();
  }, [data?.version]);

  // ── moments ───────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<Moment[]>([]);
  const [current, setCurrent] = useState<Moment | null>(null);
  /** Last poll's standings, for spotting one CLR passing another. */
  const prevStandings = useRef<RankRow[] | null>(null);
  const played = useRef<Set<string>>(new Set());
  useEffect(() => {
    try { const raw = localStorage.getItem(PLAYED_KEY); if (raw) played.current = new Set(JSON.parse(raw)); } catch { /* fresh TV */ }
  }, []);
  const remember = useCallback((id: string) => {
    played.current.add(id);
    try { localStorage.setItem(PLAYED_KEY, JSON.stringify(Array.from(played.current).slice(-500))); } catch { /* fine */ }
  }, []);

  // Enqueue what is new. NOT remembered yet — that happens when it plays, or a
  // reload mid-queue silently loses everything behind the one on screen.
  useEffect(() => {
    if (!data) return;
    cursorRef.current = data.cursor;
    const next: Moment[] = [];
    for (const ev of data.events) if (!played.current.has(ev.id)) next.push({ type: "event", key: ev.id, event: ev });
    for (const m of data.milestones) if (!played.current.has(m.id)) next.push({ type: "milestone", key: m.id, milestone: m });
    // Someone climbing past someone else on the scorecard. Worked out here
    // rather than on the server because it is a change BETWEEN two polls, and
    // the feed is stateless. The first poll after a load has no previous
    // standing to compare against and stays quiet, like events do.
    const standings: RankRow[] = data.scorecard.people.map((p) => ({ id: p.id, name: p.name, transfersToday: p.transfersToday }));
    for (const o of detectOvertakes(prevStandings.current, standings, data.today)) {
      if (!played.current.has(o.key)) next.push({ type: "overtake", key: o.key, overtake: o });
    }
    prevStandings.current = standings;
    if (next.length) setQueue((q) => {
      const have = new Set(q.map((x) => x.key));
      return [...q, ...next.filter((x) => !have.has(x.key))];
    });
  }, [data]);

  // ?demo=1 plays one of every moment with sample names, so a screen can be
  // checked without waiting for the floor to make something happen. Keys are
  // unique per load, so it replays every time the page opens.
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (!demo) return;
    const stamp = Date.now();
    const at = new Date().toISOString();
    const ev = (kind: Kind, borrower: string, detail: string | null): Moment =>
      ({ type: "event", key: `demo-${stamp}-${kind}`, event: { id: `demo-${kind}`, kind, at, borrower, who: "Demo", lo: "Alex Thompson", detail } });
    const reel: Moment[] = [
      ev("transfer", "Maria Delgado", "to Alex Thompson"),
      ev("appointment", "Dana Whitfield", "Today 2:30 PM"),
      ev("rescheduled", "Tomas Reyes", "Moved to Tue 4:15 PM"),
      ev("fell_through", "Kevin Ostrowski", null),
      ev("missed_appointment", "Priya Natarajan", "No answer"),
      { type: "milestone", key: `demo-${stamp}-milestone`, milestone: { id: "demo", kind: "team-day", headline: "25 transfers today", detail: "The whole floor. Keep going.", weight: 3 } },
      { type: "overtake", key: `demo-${stamp}-overtake`, overtake: { key: "demo", passerId: 0, passerName: "Jordon Chang", passedName: "Cristopher Bermudez", count: 8, rank: 2 } },
    ];
    // ?demo=1 plays the whole reel; ?demo=transfer plays that one on repeat,
    // which is the only sane way to build or judge a single animation.
    const one = reel.filter((m) => (m.type === "event" ? m.event.kind : m.type) === demo);
    if (!one.length) { setQueue(reel); return; }
    const loop = Array.from({ length: 40 }, (_, i) => {
      const m = one[0];
      return m.type === "milestone"
        ? { ...m, key: `${m.key}-${i}` }
        : { ...m, key: `${m.key}-${i}` };
    });
    setQueue(loop);
  }, []);

  // Two effects on purpose. Dequeuing changes both `current` and `queue`,
  // which re-runs whatever effect depends on them -- and if that same effect
  // owned the hold timer, its cleanup would cancel the timer the instant it
  // was set, and the first moment would sit on screen forever. Seen live.
  useEffect(() => {
    if (current || !queue.length) return;
    const [head, ...rest] = queue;
    setQueue(rest);
    setCurrent(head);
    remember(head.key);
    SOUND[head.type === "milestone" ? "milestone" : head.type === "overtake" ? "overtake" : head.event.kind]();
  }, [current, queue, remember]);

  // A moment holds, then unmounts. One timer, one piece of state, no exit
  // animation of any kind — because both fancier versions wedged.
  //
  // Under AnimatePresence the overlay was left in the DOM at opacity 0 after
  // its exit, twice, because some descendant never reported its exit done.
  // Replacing that with a hand-run fade (a `leaving` flag driving opacity,
  // then an unmount 300ms later) moved the bug rather than fixing it: a moment
  // could mount while the flag was still set from the previous one and play
  // its entire scene invisibly, at opacity 0, with the deck paused behind it.
  // Seen live on the rescheduled scene. A hard cut cannot do either.
  useEffect(() => {
    if (!current) return;
    const hold = current.type === "milestone" ? HOLD_MS.milestone
      : current.type === "overtake" ? HOLD_MS.overtake
      : HOLD_MS[current.event.kind];
    const done = setTimeout(() => setCurrent(null), hold);
    return () => clearTimeout(done);
  }, [current]);

  // ── the deck ──────────────────────────────────────────────────────────
  // Advances on its own clock; pauses while a moment is up so the page under
  // it does not change out from beneath the card.
  const [slot, setSlot] = useState(0);
  const [dealt, setDealt] = useState(0); // bumps on every advance so a repeated page re-enters fresh
  useEffect(() => {
    if (current) return;
    const id = setTimeout(() => { setSlot((s) => (s + 1) % DECK.length); setDealt((d) => d + 1); }, DECK[slot].dwellMs);
    return () => clearTimeout(id);
  }, [slot, current]);
  const page = DECK[slot].id;

  const people = data?.scorecard.people ?? [];
  const team = data?.scorecard.team ?? { transfersToday: 0, transfersWeek: 0, appointmentsToday: 0, fellThroughToday: 0, missedToday: 0 };
  const teamGoal = useMemo(() => people.reduce((n, p) => n + p.goalTransfersWeekly, 0), [people]);

  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (!token) return <div className="flex h-screen items-center justify-center bg-[#0B1220] text-white/70">No display link.</div>;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0B1220] text-white [font-variant-numeric:tabular-nums]" data-testid="tv-board">
      {/* Ambient glow. Slow, not a flash. */}
      {!reduced && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <motion.div className="absolute -left-40 -top-40 h-[60vh] w-[60vh] rounded-full bg-amber-400/10 blur-3xl"
            animate={{ x: [0, 60, 0], y: [0, 40, 0] }} transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div className="absolute -bottom-40 -right-40 h-[70vh] w-[70vh] rounded-full bg-sky-500/10 blur-3xl"
            animate={{ x: [0, -50, 0], y: [0, -30, 0] }} transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }} />
        </div>
      )}

      {/* ── header: the one thing that never leaves ── */}
      <header className="relative z-10 flex h-24 items-center justify-between px-16">
        <div className="flex items-baseline gap-5">
          <span className="text-[clamp(1.2rem,1.8vw,1.8rem)] font-black tracking-[0.22em] text-amber-300">WEST CAPITAL</span>
          <span className="text-[clamp(.9rem,1.3vw,1.3rem)] font-medium uppercase tracking-[0.3em] text-white/45">CLR Connection Center</span>
        </div>
        <div className="flex items-center gap-8">
          <span className="text-[clamp(1rem,1.6vw,1.6rem)] text-white/60">{dateLabel}</span>
          <span className="text-[clamp(1.8rem,3vw,3rem)] font-bold tabular-nums">{clock}</span>
          <span className="flex items-center gap-2 text-[clamp(.85rem,1.1vw,1.1rem)] uppercase tracking-widest text-white/50" data-testid="tv-live">
            <span className={`h-3 w-3 rounded-full ${isError ? "bg-rose-400" : "bg-emerald-400"} ${!reduced && !isError ? "animate-pulse" : ""}`} />
            {isError ? "Reconnecting" : "Live"}
          </span>
        </div>
      </header>

      {/* ── the deck ── */}
      <main className="relative z-10 h-[calc(100vh-6rem-2.5rem)]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${page}-${dealt}`}
            className="absolute inset-0"
            variants={slide(reduced)} initial="enter" animate="center" exit="exit"
            data-testid="tv-page" data-page={page}
          >
            {page === "scorecard" && <ScorecardPage people={people} reduced={reduced} now={now.getTime()} />}
            {page === "team"      && <TeamPage team={team} teamGoal={teamGoal} reduced={reduced} />}
            {page === "latest"    && <LatestPage recent={data?.recent ?? []} now={now} reduced={reduced} />}
            {page === "tip"       && <TipPage tip={data?.tip ?? null} reduced={reduced} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── progress dots: which page, and how long until the next ── */}
      <footer className="relative z-10 flex h-10 items-center justify-center gap-3" aria-hidden="true">
        {DECK.map((d, i) => (
          <span key={i} className="relative h-2 w-10 overflow-hidden rounded-full bg-white/15">
            {i === slot && !current && (
              <motion.span
                key={dealt}
                className="absolute inset-y-0 left-0 rounded-full bg-amber-300"
                initial={{ width: 0 }} animate={{ width: "100%" }}
                transition={{ duration: d.dwellMs / 1000, ease: "linear" }}
              />
            )}
          </span>
        ))}
      </footer>

      {current && <MomentOverlay moment={current} reduced={reduced} />}
    </div>
  );
}
