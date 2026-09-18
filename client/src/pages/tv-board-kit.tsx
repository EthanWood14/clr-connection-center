/**
 * The office TV.
 *
 * A signage loop, not a dashboard. Full-screen pages come in and go out on a
 * timer the way ads rotate on a screen in a lobby — scorecard, team, latest,
 * a training tip — and each one re-enters fresh so its bars grow and its
 * numbers count up again every time it comes around. The moments (a transfer
 * lands, a meeting is set or rebooked, an appointment is missed, a call falls
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
 *  - The bottom tenth of the screen is a STRIP, not an overlay. The deck is
 *    given the box above it and nothing floats on top of a page. See the
 *    block comment above NewLeadZone for why, and for how it is laid out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRightLeft, CalendarCheck2, CalendarClock, CalendarX2, Flame, GraduationCap, Play, Quote, Trophy, UserPlus, Users,
} from "lucide-react";
import { Confetti } from "@/components/goal-celebration";
import { HypeScene, HYPE_IMPACT_MS } from "@/components/tv/hype";
import { RaceScene } from "@/components/tv/race";
import { FieldRace, RACE_MOMENT_MS, preloadFieldRace } from "@/components/tv/field-race";
import { appendTvMoments, createTvRacePreview, createTvDayRacePreview, planTransferRaces, racePreviewStatus } from "@shared/tv-field-race";
import { dueHourlyRaceKey } from "@shared/tv-hourly-race";
import { dayRaceMomentMs, type DayRaceFrame, type DayRaceHourCredit } from "@shared/tv-day-race";
import { CornerRace } from "@/components/tv/corner-race";
import {
  PAN_BOX, usePan,
  TransfersPage, WriteUpPage, AssignmentsPage, EodPage, PhoneTimePage, LeadSourcePage, OnPhoneNowPage,
  StarvedPage, UpcomingPage, LoSplitPage, WeeklyPacePage,
} from "@/components/tv/pages";
import { type Overtake, type RankRow } from "@shared/tv-overtake";
import { APP_VERSION } from "@shared/version";
import { formatTransferCount } from "@shared/transfer-credit";
import type { TvCarAppearance } from "@shared/tv-car";

// ── types (mirror server/tv-board.ts) ───────────────────────────────────────
export type Kind = "transfer" | "appointment" | "rescheduled" | "fell_through" | "missed_appointment";
export interface TvEvent { id: string; kind: Kind; at: string; borrower: string; who: string; lo: string | null; detail: string | null; assistantId?: number | null; raceCredits?: { userId: number; credit: number }[] }
export interface Person {
  // Transfer CREDIT, in halves — see shared/transfer-credit.ts. Print it
  // through CountUp or formatTransferCount, never Math.round.
  id: number; name: string; transfersToday: number; transfersWeek: number;
  appointmentsToday: number; appointmentsWeek: number; goalTransfersWeekly: number; goalAppointmentsWeekly: number;
  lastTransferAt?: string | null; lastCallAt?: string | null;
  car?: TvCarAppearance;
}
/** A lead that just landed in LeadVault. Transient — see server/tv-leads.ts. */
export interface NewLead { id: number; name: string; source: string | null; at: string }
export interface Milestone { id: string; kind: string; headline: string; detail: string; weight: 1 | 2 | 3 }
/**
 * A line for the tip page. Two registers share it: the quiet ones rewritten
 * from the training plan, which carry a day and the plan's author, and the
 * ones Ethan chose, which carry the person who actually said them.
 */
export interface Tip {
  day: number; half: "morning" | "afternoon" | "eod"; text: string;
  /** Who wrote the training plan. */
  author: string;
  /** Who said the quote, when it is one. Null for the training lines. */
  quoteAuthor?: string | null;
}
export interface Feed {
  version: string; now: string; today: string; weekStart: string; cursor: string;
  scorecard: {
    people: Person[];
    team: { transfersToday: number; transfersWeek: number; appointmentsToday: number; fellThroughToday: number; missedToday: number };
  };
  events: TvEvent[]; recent: TvEvent[]; milestones: Milestone[]; tip: Tip | null;
  newLeads?: NewLead[];
  racePlayback?: { id: number } | null;
  racePeople?: Person[];
  /** Today's transfer credits by office-local hour+minute — Play race day timeline. */
  raceDayCredits?: DayRaceHourCredit[];
}

export type Moment =
  | { type: "event"; key: string; event: TvEvent; fieldRace?: RankRow[]; raceBefore?: RankRow[] | null; focusId?: number; preview?: boolean; dayFrames?: DayRaceFrame[] }
  | { type: "milestone"; key: string; milestone: Milestone }
  | { type: "overtake"; key: string; overtake: Overtake; fieldRace?: RankRow[]; raceBefore?: RankRow[] | null };

export const POLL_MS = 10_000;
/**
 * The board pages come from their own endpoint, polled far less often than the
 * moment feed. Two reasons: this payload is much heavier, and a query that
 * throws in here must never be able to stop a transfer from being celebrated.
 */
export const PAGES_POLL_MS = 30_000;
/**
 * The office's clock, for the hourly race. The screen on the wall runs in the
 * building, but a display opened from anywhere else must still deal the race
 * on the floor's hour rather than its own.
 */
export const BOARD_TZ = "America/Los_Angeles";

/**
 * "2h 14m", "6m", "just now" — how long since something last happened.
 *
 * Deliberately plain. It is a wall the whole floor reads, so a quiet stretch
 * says so without shouting: the number goes dim-amber once someone has been
 * quiet a while rather than red, because this is information, not a telling-off.
 */
export function since(iso: string | null | undefined, now: number): { label: string; quiet: boolean } | null {
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
export const TIP_MS = 45_000;
export const PLAYED_KEY = "c3:tv:played";

/**
 * How long the new-lead strip stays up before it slides back down.
 *
 * Not part of HOLD_MS below, on purpose. A lead landing is an ambient notice
 * along the bottom of the screen, not a moment: it never queues, it never
 * pauses the deck, and it never waits behind a celebration.
 */
export const NEW_LEAD_HOLD_MS = 8_000;

/** How long each kind holds the screen. A transfer earns the longest beat. */
export const HOLD_MS: Record<Kind | "milestone" | "overtake", number> = {
  transfer: 9500, appointment: 8000, rescheduled: 8000, fell_through: 8500, missed_appointment: 7500, milestone: 10500,
  // The race runs its own ~7s beat and settles by 6.6s.
  overtake: 8500,
};

export const KIND: Record<Kind, { label: string; hue: string; ring: string; Icon: typeof ArrowRightLeft; confetti: boolean }> = {
  transfer:           { label: "Transfer",            hue: "from-amber-400 via-yellow-300 to-amber-500",   ring: "ring-amber-300/60",   Icon: ArrowRightLeft, confetti: true },
  appointment:        { label: "Meeting set",         hue: "from-sky-400 via-cyan-300 to-blue-500",        ring: "ring-sky-300/60",     Icon: CalendarCheck2, confetti: false },
  rescheduled:        { label: "Meeting rebooked",    hue: "from-teal-400 via-emerald-300 to-teal-500",    ring: "ring-teal-300/60",    Icon: CalendarClock,  confetti: false },
  fell_through:       { label: "Fell through",        hue: "from-rose-500 via-red-400 to-rose-700",        ring: "ring-rose-300/50",    Icon: Flame,          confetti: false },
  missed_appointment: { label: "Missed appointment",  hue: "from-orange-500 via-amber-400 to-orange-600",  ring: "ring-orange-300/50",  Icon: CalendarX2,     confetti: false },
};

// ── the deck ────────────────────────────────────────────────────────────────
// Order and dwell. The scorecard is what people look up for, so it stays
// longest and comes round most often.
export type PageId =
  | "scorecard" | "team" | "latest" | "tip"
  | "transfersWeek" | "transfersMonth" | "writeup" | "assignments" | "eod"
  | "phoneTime" | "leadSource" | "onPhoneNow" | "starved" | "upcoming" | "loSplit"
  | "weeklyPace";

/**
 * The deck, and when each page is allowed on it.
 *
 * `when` gates a page by the office clock. Two pages are deliberately opposite
 * each other: the EOD board only earns the wall between 3:30 and 6pm, when
 * reports are actually being filed (the deadline is 4pm the NEXT business day,
 * so before 3:30 it is a board of nothing), and the assignment list holds the
 * rest of the day, when it is still something anyone can act on.
 *
 * The scorecard keeps two slots so it still comes round roughly twice a cycle,
 * which is what the floor actually looks up for.
 */
export type Slot = { id: PageId; dwellMs: number; when?: (mins: number) => boolean };
export const EOD_FROM = 15 * 60 + 30, EOD_TO = 18 * 60;
export const inEodWindow = (mins: number) => mins >= EOD_FROM && mins < EOD_TO;
export const DECK: Slot[] = [
  { id: "scorecard",      dwellMs: 14_000 },
  { id: "onPhoneNow",     dwellMs: 9_000 },
  { id: "team",           dwellMs: 10_000 },
  { id: "latest",         dwellMs: 11_000 },
  // Straight after "what just happened", because it is the other half of the
  // same question. Thirteen seconds, matching the other list pages people read
  // names off rather than glance at.
  { id: "upcoming",       dwellMs: 13_000 },
  { id: "transfersWeek",  dwellMs: 12_000 },
  { id: "assignments",    dwellMs: 12_000, when: (m) => !inEodWindow(m) },
  { id: "eod",            dwellMs: 12_000, when: inEodWindow },
  { id: "scorecard",      dwellMs: 14_000 },
  { id: "phoneTime",      dwellMs: 11_000 },
  { id: "writeup",        dwellMs: 12_000 },
  { id: "leadSource",     dwellMs: 11_000 },
  { id: "starved",        dwellMs: 13_000 },
  // Directly after "who needs transfers", because it answers the question
  // that one raises: who is actually doing the feeding.
  { id: "loSplit",        dwellMs: 13_000 },
  { id: "transfersMonth", dwellMs: 12_000 },
  // Straight after the month, because it is the same question asked across a
  // changing roster: not how many, but how many each, per day at the desk.
  // Fourteen seconds — ten columns is a trend to read, not a number to glance
  // at, and it is the only page on the wall that shows more than this week.
  { id: "weeklyPace",     dwellMs: 14_000 },
  { id: "tip",            dwellMs: 12_000 },
];

// ── sound ───────────────────────────────────────────────────────────────────
// Synthesised so nothing has to download. A kiosk browser lets audio autoplay;
// an ordinary one blocks it until someone clicks, and then this simply does
// nothing — the screen carries the moment either way.
let audio: AudioContext | null = null;
export function tone(notes: number[], opts: { type?: OscillatorType; gap?: number; level?: number; len?: number } = {}) {
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
export function crash(opts: { delayMs: number; level: number; len: number; low?: boolean }) {
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

export const SOUND: Record<Kind | "milestone" | "overtake", () => void> = {
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
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return now;
}

/** A number that rolls up from zero when it appears, and to its new value after. */
export function CountUp({ value, className, from = 0 }: { value: number; className?: string; from?: number }) {
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
      // To the nearest HALF, not the nearest whole. Transfer figures are credit
      // — a shotgun transfer is half for the CLR who published the lead and
      // half for the one who claimed it — so 4.5 is a real number on this wall
      // and rounding it to 5 would show a CLR a transfer they did not make.
      // Every other value on the board is a whole number and is unaffected.
      const v = Math.round((start + delta * eased) * 2) / 2;
      setShown(v); cur.current = v;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <span className={className}>{formatTransferCount(shown)}</span>;
}

export function timeAgo(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : "earlier";
}

/** Staggered entrance for a list — each row a beat after the last. */
export const stagger = { show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } } };
export const rise = (reduced: boolean) => ({
  hidden: { opacity: 0, y: reduced ? 0 : 22 },
  show:   { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
});

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[clamp(1rem,1.5vw,1.6rem)] font-semibold uppercase tracking-[0.3em] text-white/55">{children}</p>;
}

// ── pages ───────────────────────────────────────────────────────────────────
/** "transfer 2h 14m" — dim once it has been quiet a while, never alarming. */
export function SinceLabel({ what, at, now }: { what: string; at: string | null | undefined; now: number }) {
  const s = since(at, now);
  if (!s) return <span className="text-white/25">no {what} yet today</span>;
  // Spelled out. "transfer 38m" made a reader work out what the number meant;
  // from across a room, on a screen you glance at, it has to say it.
  return (
    <span className={s.quiet ? "text-amber-300/70" : "text-white/45"}>
      last {what} <span className="font-semibold">{s.label}</span>{s.label === "just now" ? "" : " ago"}
    </span>
  );
}

/**
 * Everyone who is actually here, and a slow pan when they do not fit.
 *
 * About six rows fit a 1080p screen, and the floor is thirteen people, so the
 * list used to stop at eight and the bottom of the board was invisible. It now
 * pans: the whole list slides up over the dwell and comes back, slowly enough
 * to read. Anyone who has done nothing today AND has not checked in is left
 * off entirely — an empty row for someone on holiday is just noise.
 */
export function ScorecardPage({ people, reduced, now, checkins, dwellMs }: {
  people: Person[]; reduced: boolean; now: number;
  checkins?: Record<string, boolean>;
  dwellMs: number;
}) {
  const here = people.filter((p) => {
    const busy = p.transfersToday > 0 || p.appointmentsToday > 0;
    // Missing check-in data must never hide anybody: default to showing them.
    const checked = checkins ? checkins[p.name] !== false : true;
    return busy || checked;
  });
  const list = here.length ? here : people;
  // MEASURED, not counted. This used to pan `rows past six` times a hard-coded
  // 7.6rem, and both of those numbers were read off a deck that owned the whole
  // screen under the header — which it no longer does, now the bottom strip has
  // ten percent of it. usePan asks the box how much taller the list is than the
  // space it was given, so the last row lands on the bottom edge whatever that
  // space turns out to be. One pan on this wall, shared with the other pages.
  const pan = usePan(dwellMs / 1000, reduced);
  const leader = list[0];
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
      <div ref={pan.ref} className={PAN_BOX}>
      <motion.ul
        variants={stagger} initial="hidden" animate="show"
        className="flex flex-col justify-start gap-4"
        style={pan.style}
      >
        {list.map((p, i) => {
          const pct = Math.round((p.transfersToday / max) * 100);
          const gold = i === 0 && p.transfersToday > 0;
          return (
            <motion.li key={p.id} variants={rise(reduced)} className="grid grid-cols-[4rem_1fr_9rem_10rem] items-center gap-6" data-testid="tv-row">
              <span className={`text-[clamp(1.6rem,2.6vw,2.8rem)] font-black ${gold ? "text-amber-300" : "text-white/35"}`}>{i + 1}</span>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="truncate text-[clamp(1.8rem,3vw,3.2rem)] font-bold leading-tight">{p.name}</span>
                  <span className="shrink-0 text-[clamp(1rem,1.4vw,1.4rem)] text-white/45">{formatTransferCount(p.transfersWeek)} this week</span>
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
        {!list.length && <li className="text-white/50">No CLRs on the board.</li>}
      </motion.ul>
      </div>
      {pan.overflowing && (
        <p className="mt-2 shrink-0 text-center text-[clamp(0.85rem,1.1vw,1.1rem)] text-white/30">
          {list.length} on the board
        </p>
      )}
    </div>
  );
}

export function TeamPage({ team, teamGoal, reduced }: { team: Feed["scorecard"]["team"]; teamGoal: number; reduced: boolean }) {
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

export function LatestPage({ recent, now, reduced }: { recent: TvEvent[]; now: Date; reduced: boolean }) {
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

export function TipPage({ tip, reduced }: { tip: Tip | null; reduced: boolean }) {
  return (
    <div className="flex h-full items-center justify-center px-24" data-testid="tv-page-tip">
      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}
        className="max-w-[1500px] rounded-[2.5rem] border border-violet-300/25 bg-gradient-to-br from-violet-500/15 via-transparent to-transparent p-16"
      >
        <div className="mb-6 flex items-center gap-3 text-[clamp(1rem,1.5vw,1.6rem)] font-semibold uppercase tracking-[0.3em] text-violet-200/80">
          {/* A quote somebody else said is not "from the training plan", and
              labelling Rocky Balboa as such would be its own small joke. */}
          {tip?.quoteAuthor
            ? <><Quote className="h-8 w-8" /> On the wall</>
            : <><GraduationCap className="h-8 w-8" /> From the training plan</>}
        </div>
        {tip ? (
          <>
            {/* The longest of these runs past 240 characters, so the type has
                to give way rather than push the card off a 1080p screen. */}
            <blockquote
              className={`font-medium leading-snug text-white [text-wrap:balance] ${
                tip.text.length > 150
                  ? "text-[clamp(1.2rem,2vw,2.2rem)]"
                  : "text-[clamp(1.8rem,3.1vw,3.4rem)]"
              }`}
            >“{tip.text}”</blockquote>
            <p className="mt-8 text-[clamp(1.1rem,1.7vw,1.7rem)] text-white/50">
              {tip.quoteAuthor
                ? `— ${tip.quoteAuthor}`
                : `${tip.day > 0 ? `Day ${tip.day} · ${tip.half === "eod" ? "by end of day" : tip.half} · ` : ""}${tip.author}`}
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
export function MomentOverlay({ moment, reduced }: { moment: Moment; reduced: boolean }) {
  if (moment.type === "event" && moment.fieldRace) return <FieldRace key={moment.key} people={moment.fieldRace} before={moment.raceBefore} who={moment.event.who} focusId={moment.focusId} reduced={reduced} preview={moment.preview} dayFrames={moment.dayFrames} />;
  if (moment.type === "overtake" && moment.fieldRace) return <FieldRace key={moment.key} people={moment.fieldRace} before={moment.raceBefore} who={moment.overtake.passerName} focusId={moment.overtake.passerId} reduced={reduced} />;
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

// ── the bottom strip ────────────────────────────────────────────────────
/**
 * The band along the bottom of the wall.
 *
 * Ethan's ask, in his words: LeadVault's new leads go "in the bottom like 10%
 * of the screen", in small text, "not overlaying anything". It used to slide up
 * OVER whatever page was up, so this is the opposite of that. It is a row in
 * the page's own flow, and <main> above it is given a box that is shorter by
 * exactly this much. Nothing in here is absolutely positioned, and nothing in
 * here sits over the deck.
 *
 * One row, read across:
 *
 *   NEW IN LEADVAULT                                        |  ● ● ● ● ●
 *   Maria Alvarez · Facebook · +2 more                        |   the deck
 *
 * The strip used to carry a second zone at the other end — the CLRs the chart
 * leaves out — with the deck's dots holding the middle. Ethan asked for it to
 * go, so what is left is not a half-empty version of that layout: the notice
 * takes the whole width from the left edge and the deck's dots close the row on
 * the right, which is how a footer is normally read — what happened on one
 * side, where you are on the other. One hairline between them, and no mirrored
 * gap where the other zone used to be.
 *
 * The height is fixed and the lead zone always renders its content line, full
 * or empty. A strip that grew when a lead landed would jog the whole board
 * every time LeadVault fired, so the space is reserved rather than made — and
 * it is the same two-line stack, at the same two type sizes, as before, so
 * removing the other zone did not move the row by a pixel.
 *
 * It is a footer, and it is sized like one: the type bottoms out around a rem,
 * the labels are white/30, and the only colour in it is the emerald of an
 * arrival. Under a moment the overlay covers it along with everything else — a
 * celebration owns the whole screen, deliberately.
 */
export const STRIP_LABEL = "text-[clamp(0.7rem,0.85vw,0.92rem)] font-semibold uppercase tracking-[0.28em] text-white/30";
export const STRIP_LINE = "mt-1.5 flex items-baseline gap-4 text-[clamp(0.95rem,1.25vw,1.3rem)] leading-none";
export const STRIP_QUIET = "truncate text-white/25";

/** The hairline between two zones. */
export function StripRule() {
  return <span className="my-4 w-px shrink-0 self-stretch bg-white/10" aria-hidden="true" />;
}

/**
 * A lead landing in LeadVault.
 *
 * It still ARRIVES: the row re-mounts on the lead's id and rises into place,
 * lit emerald for as long as the notice holds, then fades to the same grey as
 * the rest of the strip and stays there as the last one in. Quiet on purpose —
 * a lead is news, not a celebration, and this must never read as a moment.
 *
 * What it deliberately does NOT do: pause the deck, queue behind the moment
 * overlay, own a timer, or change the height of the strip. The row is the same
 * shape before the first lead of the day as it is a second after one lands.
 */
export function NewLeadZone({ notice, up, reduced }: {
  notice: { lead: NewLead; more: number } | null;
  up: boolean;
  reduced: boolean;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col justify-center"
      data-testid="tv-new-lead"
      data-up={up ? "1" : "0"}
    >
      <div className={STRIP_LABEL}>New in LeadVault</div>
      <div className={STRIP_LINE}>
        {notice ? (
          <motion.span
            key={notice.lead.id}
            className={`flex min-w-0 items-baseline gap-3 transition-colors duration-700 ${up ? "text-emerald-200" : "text-white/45"}`}
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0.25 } : { type: "spring", stiffness: 210, damping: 26 }}
          >
            <UserPlus className={`h-[1em] w-[1em] shrink-0 self-center ${up ? "text-emerald-300" : "text-white/25"}`} />
            <span className="truncate font-semibold" title={notice.lead.name}>{notice.lead.name}</span>
            {notice.lead.source && <span className="shrink-0 text-white/35">{notice.lead.source}</span>}
            {notice.more > 0 && <span className="shrink-0 text-white/35">+{notice.more} more</span>}
          </motion.span>
        ) : (
          <span className={STRIP_QUIET}>nothing new yet today</span>
        )}
      </div>
    </div>
  );
}

// ── the page ────────────────────────────────────────────────────────────────
/** Pages slide in from the right and out to the left, like a deck being dealt. */
export const slide = (reduced: boolean) => ({
  enter:  { x: reduced ? 0 : "6%", opacity: 0, scale: reduced ? 1 : 0.985 },
  center: { x: 0, opacity: 1, scale: 1, transition: { type: "spring", stiffness: 120, damping: 22 } },
  exit:   { x: reduced ? 0 : "-6%", opacity: 0, scale: reduced ? 1 : 0.985, transition: { duration: 0.45, ease: "easeIn" } },
});

