/**
 * The office TV — the rest of the deck.
 *
 * tv.tsx owns the loop, the moments and the four original pages; these are the
 * pages the orchestrator deals alongside them. They take plain data and nothing
 * else: no fetching, no timers, no knowledge of the deck. That keeps the wall's
 * rules in one place and lets each of these be judged on its own.
 *
 * Everything here is copied from the visual language already on the wall — the
 * eyebrow, the count-up, the stagger-and-rise entrance, clamp() type, the dark
 * palette, `tv-page-<id>` testids, and the rank / name / bar / big-number row
 * the scorecard lays out. Where a helper is not exported from tv.tsx there is a
 * local twin of it here rather than a second style.
 *
 * Two things this file is careful about, because both are about people:
 *
 *  1. A number that is a proxy is labelled as a proxy. Dialer-active time is
 *     "on the phone", never "hours worked"; the fifteen-minute list is headed
 *     as exactly that and not as who is at their desk. Read from across a room,
 *     an unqualified number becomes an accusation.
 *  2. A total that counts people the list does not is said out loud, and a
 *     plurality of blanks is never dressed up as a category.
 */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock, CalendarDays, ClipboardCheck, ClipboardList, Inbox, Layers, Phone, Radio, Trophy } from "lucide-react";

// ── local twins of the tv.tsx pieces ────────────────────────────────────────
// Same look, same timings. tv.tsx does not export them, and a near-miss on a
// wall where these pages cut straight into those ones shows up worse here than
// it would anywhere else in the app.

/** Staggered entrance for a list — each row a beat after the last. */
const stagger = { show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } } };
const rise = (reduced: boolean) => ({
  hidden: { opacity: 0, y: reduced ? 0 : 22 },
  show:   { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
});

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[clamp(1rem,1.5vw,1.6rem)] font-semibold uppercase tracking-[0.3em] text-white/55">{children}</p>;
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

// ── shared page furniture ───────────────────────────────────────────────────
const PAGE = "flex h-full flex-col px-16 py-10";
const TITLE = "mt-1 text-[clamp(2.4rem,4.4vw,4.6rem)] font-black leading-none tracking-tight";
/** For a heading too long to survive TITLE's size on a 1080p screen. */
const TITLE_LONG = "mt-1 text-[clamp(1.8rem,3.2vw,3.4rem)] font-black leading-[1.05] tracking-tight";
/** An empty page still has to read from the back of the room. */
const EMPTY = "text-[clamp(1.3rem,2vw,2rem)] text-white/50";
/** The scorecard's row shape. Fixed columns, so every bar ends on the same line. */
const COLS = "grid grid-cols-[4rem_1fr_12rem] items-center gap-6";
/** The same row where the value is a duration rather than a number. */
const COLS_WIDE = "grid grid-cols-[4rem_1fr_15rem] items-center gap-6";
const GOLD_BAR = "bg-gradient-to-r from-amber-400 to-yellow-300";
const COOL_BAR = "bg-gradient-to-r from-sky-500 to-cyan-400";

// ── the pan ─────────────────────────────────────────────────────────────────
/**
 * How long each page's pan takes, in seconds — one entry per page, matched to
 * that page's dwell in tv.tsx's DECK.
 *
 * They have to be written down here rather than passed in, because these pages
 * are handed data and nothing else; the deck is not theirs to know about. So
 * this table is the coupling, in one place, named after the thing it mirrors.
 * If a dwell moves in DECK, move its twin here.
 *
 * The duration IS the dwell, the same as the scorecard's: the keyframes reach
 * the bottom of the list at 56% and hold it to 74%, so the whole list has been
 * read well inside the page's time on screen, and only the tail of the glide
 * back to the top is clipped by the page turning over.
 */
const PAN_SECONDS = {
  transfers: 12,   // transfersWeek / transfersMonth, both 12_000
  writeup: 12,
  assignments: 12,
  eod: 12,
  phoneTime: 11,
  leadSource: 11,
  onPhoneNow: 9,
  starved: 13,
  upcoming: 13,
} as const;

/** The clipping box a panned list lives in, as a flex child. */
export const PAN_BOX = "min-h-0 flex-1 overflow-hidden";

/**
 * Pan a list that does not fit instead of cutting it off.
 *
 * The whole list slides up over the page's dwell and comes back, using the
 * board-wide `tv-pan` keyframes tv.tsx defines once on the root — this file
 * must not declare a second copy of them.
 *
 * The distance is MEASURED, not worked out from a row height. Half the lists
 * on this wall wrap — the assignment chips, the two EOD name columns, the roll
 * call — so "rows times a row height" is not a number that exists for them,
 * and the ones with uniform rows are sized in clamp() units that change with
 * the screen. What is true of all of them is how much taller the content is
 * than the box holding it, so that is what gets asked, and the pan is exactly
 * that far: the last name lands on the bottom edge, never short of it and
 * never into empty space below it.
 *
 * Exported, along with PAN_BOX, because the scorecard in tv.tsx pans too and
 * used to do it with its own arithmetic — rows times a hard-coded 7.6rem, past
 * a hard-coded six that fit. Both of those numbers were read off the height the
 * deck had before the bottom strip took ten percent of the screen, and neither
 * of them knows that happened; the measured version simply asks the box. One
 * pan on this wall, and it is this one.
 *
 * Put `ref` on a clipping box (PAN_BOX as a flex child) and `style` on the one
 * list inside it. A list that fits gets no animation at all, and neither does
 * anything under reduced motion — there the first screenful simply sits still,
 * which is why `overflowing` stays true either way: it drives the quiet count
 * line, and a reader who is not being panned needs it more, not less.
 */
export function usePan(seconds: number, reduced: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState(0);
  // Deliberately no dependency list. The board polls every thirty seconds and
  // a list can grow under a page that is already up, so this re-measures after
  // every render; it settles immediately because the answer does not change
  // unless the layout does.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = Math.max(0, el.scrollHeight - el.clientHeight);
    if (Math.abs(next - over) > 1) setOver(next);
  });
  const panning = over > 1 && !reduced;
  return {
    ref,
    /** True when the list is taller than its box, panning or not. */
    overflowing: over > 1,
    style: panning
      ? ({
          animation: `tv-pan ${seconds}s ease-in-out 1.2s both`,
          "--tv-pan": `-${Math.round(over)}px`,
        } as CSSProperties)
      : undefined,
  };
}

/**
 * "13 on the board" — the line under a list that is panning.
 *
 * Quiet on purpose. It is not a statistic, it is the answer to "is that all of
 * them?", which is the question a moving list puts in a reader's head.
 */
function PanCount({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 shrink-0 text-center text-[clamp(0.85rem,1.1vw,1.1rem)] text-white/30" data-testid="tv-pan-count">
      {children}
    </p>
  );
}

/** The pill opposite a page title — a leader, or a team figure. */
function HeaderPill({ tone = "cool", icon, children }: { tone?: "gold" | "cool"; icon?: ReactNode; children: ReactNode }) {
  const skin = tone === "gold"
    ? "border-amber-300/40 bg-amber-400/10 text-amber-300"
    : "border-white/15 bg-white/[0.05] text-white/80";
  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
      className={`flex min-w-0 shrink-0 max-w-[40%] items-center gap-3 rounded-full border px-6 py-3 text-[clamp(1.2rem,2vw,2rem)] ${skin}`}
    >
      {icon}{children}
    </motion.div>
  );
}

/**
 * One ranked row: rank, name over a bar, a big value on the right.
 *
 * `meterPct` is share-of-the-leader, not share-of-goal — the bar exists to make
 * the shape of the list readable at twenty feet, nothing more.
 */
function MeterRow({ rank, name, value, meterPct, gold, reduced, note, right, cols = COLS }: {
  rank: number; name: string; value: ReactNode; meterPct: number; gold?: boolean;
  reduced: boolean; note?: ReactNode; right?: ReactNode; cols?: string;
}) {
  return (
    <motion.li variants={rise(reduced)} className={cols} data-testid="tv-row">
      <span className={`text-[clamp(1.6rem,2.6vw,2.8rem)] font-black ${gold ? "text-amber-300" : "text-white/35"}`}>{rank}</span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-4">
          {/* truncate + min-w-0 is what keeps "Jonjairo Mercado-Nuñez" from
              pushing the big number off the right-hand edge. */}
          <span className="truncate text-[clamp(1.8rem,3vw,3.2rem)] font-bold leading-tight" title={name}>{name}</span>
          {right != null && <span className="shrink-0 text-[clamp(1rem,1.4vw,1.4rem)] text-white/45">{right}</span>}
        </div>
        <div className="mt-2 h-5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className={`h-full rounded-full ${gold ? GOLD_BAR : COOL_BAR}`}
            initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, meterPct))}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 20, delay: 0.25 + (rank - 1) * 0.07 }}
          />
        </div>
        {note != null && <div className="mt-1.5 text-[clamp(1rem,1.2vw,1.2rem)] leading-none text-white/40">{note}</div>}
      </div>
      <div className="text-right leading-none">{value}</div>
    </motion.li>
  );
}

/** A name in a wrapping list — an LO on an assignment row, a person on a roll call. */
function NameChip({ name, tone = "plain" }: { name: string; tone?: "plain" | "live" | "quiet" }) {
  const skin = tone === "live" ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100"
    : tone === "quiet" ? "border-white/10 bg-white/[0.03] text-white/60"
    : "border-white/15 bg-white/[0.06] text-white/85";
  return (
    <span
      className={`inline-block max-w-full truncate rounded-2xl border px-5 py-2.5 text-[clamp(1.2rem,1.9vw,2rem)] font-semibold ${skin}`}
      title={name}
    >
      {name}
    </span>
  );
}

// ── formatting ──────────────────────────────────────────────────────────────
export type TvWindow = "today" | "week" | "month";
/** "47 today", "47 this week" — the phrase that follows a total. */
const WINDOW_SUFFIX: Record<TvWindow, string> = { today: "today", week: "this week", month: "this month" };
/** "Transfers · Today" — the phrase that sits in an eyebrow. */
const WINDOW_TITLE: Record<TvWindow, string> = { today: "Today", week: "This week", month: "This month" };

/** "Elleine Asuncion", "Elleine and Marco", "A, B and C". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "2h 54m", "54m", "0m". */
function hoursMinutes(seconds: number): string {
  const mins = Math.floor(Math.max(0, Math.round(Number(seconds) || 0)) / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * "Monday, September 1" from a plain calendar date.
 *
 * Built from the parts rather than parsed, because `new Date("2026-09-01")` is
 * UTC midnight and prints as the day BEFORE anywhere west of Greenwich — which
 * on a page whose entire job is naming the right day is the one bug that would
 * matter. Anything that is not a plain date is shown as it arrived.
 */
function dayLabel(date: string): string {
  const raw = String(date ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/** "Aug 31" — the short form, for a "since" note. */
function shortDay(date: string | null | undefined): string | null {
  const raw = String(date ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── transfers ───────────────────────────────────────────────────────────────
export interface TvTransferPerson { id: number; name: string; count: number }
/** Someone whose transfers are inside the team total but who is not on the list. */
export interface TvExcluded { name: string; count: number }

/**
 * Who transferred over a window, and the team number.
 *
 * The team total is NOT the sum of the list. Some people's transfers count for
 * the floor without them being ranked on it, and a wall showing 47 over a list
 * adding to 36 reads as either a bug or a lie. `excluded` is the whole reason
 * this page is not the scorecard with a different window: when it is non-empty
 * the gap gets named, in words, under the number.
 */
export function TransfersPage({ window: win, people, team, excluded, reduced }: {
  window: TvWindow;
  people: TvTransferPerson[];
  team: number;
  excluded: TvExcluded[];
  reduced: boolean;
}) {
  const pan = usePan(PAN_SECONDS.transfers, reduced);
  const leader = people[0];
  const max = Math.max(1, leader?.count ?? 1);
  const hidden = (excluded ?? []).filter((e) => e && e.name);
  const hiddenTotal = hidden.reduce((n, e) => n + (Number(e.count) || 0), 0);
  // One name carries its own count implicitly. Two or more and each needs its
  // own, or the line asserts a total nobody in the room can account for.
  const hiddenNames = hidden.length === 1
    ? hidden[0].name
    : nameList(hidden.map((e) => `${e.name} (${Number(e.count) || 0})`));

  return (
    <div className={PAGE} data-testid="tv-page-transfers">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>Transfers · {WINDOW_TITLE[win]}</Eyebrow>
          <h2 className={TITLE}>Who transferred</h2>
        </div>
        {leader && leader.count > 0 && (
          <HeaderPill tone="gold" icon={<Trophy className="h-8 w-8 shrink-0" />}>
            <span className="truncate" title={leader.name}>{leader.name} leads</span>
          </HeaderPill>
        )}
      </div>

      <div ref={pan.ref} className={PAN_BOX}>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="flex flex-col justify-start gap-4" style={pan.style}>
          {people.map((p, i) => (
            <MeterRow
              key={p.id} rank={i + 1} name={p.name} reduced={reduced}
              gold={i === 0 && p.count > 0}
              meterPct={(p.count / max) * 100}
              value={<CountUp value={p.count} className="text-[clamp(2.6rem,4.4vw,4.8rem)] font-black" />}
            />
          ))}
          {!people.length && <li className={EMPTY}>Nobody has transferred {WINDOW_SUFFIX[win]} yet.</li>}
        </motion.ul>
      </div>
      {pan.overflowing && <PanCount>{people.length} on the board</PanCount>}

      <motion.div
        initial={{ opacity: 0, y: reduced ? 0 : 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, type: "spring", stiffness: 140, damping: 20 }}
        className="mt-6 flex shrink-0 items-end justify-between gap-10 rounded-3xl border border-amber-300/25 bg-amber-400/[0.07] px-10 py-6"
      >
        <div className="min-w-0">
          <Eyebrow>The floor</Eyebrow>
          {hidden.length > 0 && hiddenTotal > 0 && (
            <p className="mt-2 text-[clamp(1.1rem,1.6vw,1.7rem)] leading-snug text-white/50" data-testid="tv-transfers-excluded">
              {hiddenTotal} of these {hiddenTotal === 1 ? "is" : "are"} {hiddenNames}, who {hidden.length === 1 ? "is" : "are"} not listed
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-baseline gap-4">
          <CountUp value={team} className="text-[clamp(3rem,6.5vw,6.5rem)] font-black leading-none text-amber-300" />
          <span className="text-[clamp(1.2rem,1.9vw,2rem)] text-white/60">{WINDOW_SUFFIX[win]}</span>
        </div>
      </motion.div>
    </div>
  );
}

// ── write-up ────────────────────────────────────────────────────────────────
/** `pct` is null when there was nothing to score — not zero. */
export interface TvWriteUpPerson { id: number; name: string; pct: number | null; transfers: number }

/**
 * How complete this week's transfer write-ups are, per person.
 *
 * Somebody with no transfers has no write-up score — not a zero. A dash says
 * "nothing to measure"; a 0% says "you did it badly", and one of those is a
 * false accusation sitting on a wall all day. Nothing goes red here either: a
 * short bar is already legible from the far side of the room, and the board
 * does not have to shout at anyone to be read.
 */
export function WriteUpPage({ people, team, reduced }: {
  people: TvWriteUpPerson[];
  team: number | null;
  reduced: boolean;
}) {
  const pan = usePan(PAN_SECONDS.writeup, reduced);
  return (
    <div className={PAGE} data-testid="tv-page-writeup">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>This week</Eyebrow>
          {/* Titled for the people at the top of it, not the people at the
              bottom. Same number either way, but "write-up complete" reads as
              a compliance score on a wall the whole floor sees. */}
          <h2 className={TITLE}>Most thorough transfers</h2>
        </div>
        <HeaderPill icon={<ClipboardCheck className="h-8 w-8 shrink-0" />}>
          Team&nbsp;<span className="font-black text-white">{team == null ? "—" : `${Math.round(team)}%`}</span>
        </HeaderPill>
      </div>

      <div ref={pan.ref} className={PAN_BOX}>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="flex flex-col justify-start gap-4" style={pan.style}>
          {people.map((p, i) => {
            const scored = p.pct != null;
            const pct = scored ? Math.round(p.pct as number) : 0;
            return (
              <MeterRow
                key={p.id} rank={i + 1} name={p.name} reduced={reduced}
                gold={i === 0 && scored}
                meterPct={scored ? pct : 0}
                right={scored ? `${p.transfers} ${p.transfers === 1 ? "transfer" : "transfers"}` : undefined}
                note={scored ? undefined : "no transfers this week"}
                value={scored
                  ? <span className="text-[clamp(2.6rem,4.4vw,4.8rem)] font-black"><CountUp value={pct} />%</span>
                  : <span className="text-[clamp(2.6rem,4.4vw,4.8rem)] font-black text-white/25">—</span>}
              />
            );
          })}
          {!people.length && <li className={EMPTY}>No write-ups to score this week.</li>}
        </motion.ul>
      </div>
      {pan.overflowing && <PanCount>{people.length} on the board</PanCount>}
    </div>
  );
}

// ── assignments ─────────────────────────────────────────────────────────────
export interface TvAssignmentRow { id: number; name: string; los: string[] }

/**
 * Today's assigned loan officers, per CLR.
 *
 * A list, deliberately — not a progress bar, not "3 of 9 done", no ticks. The
 * board has no idea which of these have been called and must not imply that it
 * does; the moment a wall shows a completion figure the floor starts working
 * the figure instead of the list. So: names, in the order they were dealt, and
 * a count of them.
 */
export function AssignmentsPage({ people, reduced }: {
  people: TvAssignmentRow[];
  reduced: boolean;
}) {
  // Per ROW, not per page: a CLR with nine LOs still gets one line of chips and
  // a "+5 more", because the row already says "9 loan officers" beside the name
  // and a row three chip-lines tall would push the CLR under it off the screen.
  // The page-level cut is the one that has gone — every CLR is rendered now.
  const SHOWN = 4;
  const pan = usePan(PAN_SECONDS.assignments, reduced);
  return (
    <div className={PAGE} data-testid="tv-page-assignments">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>Today's list</Eyebrow>
          <h2 className={TITLE}>Assigned loan officers</h2>
        </div>
        <HeaderPill icon={<ClipboardList className="h-8 w-8 shrink-0" />}>Who each CLR has today</HeaderPill>
      </div>

      <div ref={pan.ref} className={PAN_BOX}>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="flex flex-col justify-start gap-4" style={pan.style}>
          {people.map((p, i) => {
            const los = p.los ?? [];
            const extra = los.length - SHOWN;
            return (
              <motion.li
                key={p.id} variants={rise(reduced)}
                className="grid grid-cols-[4rem_18rem_1fr] items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4"
                data-testid="tv-row"
              >
                <span className="text-[clamp(1.6rem,2.6vw,2.8rem)] font-black text-white/35">{i + 1}</span>
                <div className="min-w-0">
                  <p className="truncate text-[clamp(1.6rem,2.6vw,2.8rem)] font-bold leading-tight" title={p.name}>{p.name}</p>
                  <p className="text-[clamp(1rem,1.3vw,1.3rem)] text-white/40">
                    {los.length} {los.length === 1 ? "loan officer" : "loan officers"}
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5">
                  {los.slice(0, SHOWN).map((lo, j) => <NameChip key={`${lo}-${j}`} name={lo} />)}
                  {extra > 0 && <NameChip name={`+${extra} more`} tone="quiet" />}
                  {!los.length && <span className="text-[clamp(1.1rem,1.6vw,1.6rem)] text-white/35">nobody assigned yet</span>}
                </div>
              </motion.li>
            );
          })}
          {!people.length && <li className={EMPTY}>No assignments have been dealt today.</li>}
        </motion.ul>
      </div>
      {pan.overflowing && <PanCount>{people.length} CLRs on the board</PanCount>}
    </div>
  );
}

// ── EOD ─────────────────────────────────────────────────────────────────────
/**
 * Who filed an end-of-day report, and who has not.
 *
 * Headed with the day it is FOR. This page runs in the morning about the
 * PREVIOUS business day, and an undated "EOD reports" over a list of names gets
 * read as today's — which would put people in the outstanding column for a day
 * that has not finished yet. Names only: an EOD note is written for a manager,
 * not for a wall the whole floor faces.
 */
export function EodPage({ forDate, submitted, missing, reduced }: {
  forDate: string;
  submitted: string[];
  missing: string[];
  reduced: boolean;
}) {
  const total = submitted.length + missing.length;
  // Two lists on one page, panned independently: a day where twelve of thirteen
  // are still outstanding is exactly the day the outstanding column is too long,
  // and holding them in step would drag the short one for no reason.
  const inPan = usePan(PAN_SECONDS.eod, reduced);
  const outPan = usePan(PAN_SECONDS.eod, reduced);
  return (
    <div className={PAGE} data-testid="tv-page-eod">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>End-of-day reports</Eyebrow>
          <h2 className={TITLE} data-testid="tv-eod-for">For {dayLabel(forDate)}</h2>
        </div>
        {total > 0 && (
          <HeaderPill icon={<CalendarDays className="h-8 w-8 shrink-0" />}>
            {submitted.length} of {total} in
          </HeaderPill>
        )}
      </div>

      <motion.div variants={stagger} initial="hidden" animate="show" className="grid min-h-0 flex-1 grid-cols-2 gap-8 overflow-hidden">
        <motion.section variants={rise(reduced)} className="flex min-h-0 flex-col rounded-3xl border border-emerald-300/20 bg-emerald-400/[0.06] p-8">
          <div className="flex items-baseline gap-4">
            <Eyebrow>Submitted</Eyebrow>
            <CountUp value={submitted.length} className="text-[clamp(1.8rem,2.8vw,3rem)] font-black leading-none text-emerald-300" />
          </div>
          <div ref={inPan.ref} className="mt-5 min-h-0 flex-1 overflow-hidden">
            <div className="flex flex-wrap content-start gap-3" style={inPan.style} data-testid="tv-eod-submitted">
              {submitted.map((n, i) => <NameChip key={`${n}-${i}`} name={n} tone="live" />)}
              {!submitted.length && <p className={EMPTY}>Nobody has filed one yet.</p>}
            </div>
          </div>
          {inPan.overflowing && <PanCount>{submitted.length} in all</PanCount>}
        </motion.section>

        <motion.section variants={rise(reduced)} className="flex min-h-0 flex-col rounded-3xl border border-white/10 bg-white/[0.04] p-8">
          <div className="flex items-baseline gap-4">
            <Eyebrow>Still outstanding</Eyebrow>
            <CountUp value={missing.length} className="text-[clamp(1.8rem,2.8vw,3rem)] font-black leading-none text-amber-300" />
          </div>
          <div ref={outPan.ref} className="mt-5 min-h-0 flex-1 overflow-hidden">
            <div className="flex flex-wrap content-start gap-3" style={outPan.style} data-testid="tv-eod-missing">
              {missing.map((n, i) => <NameChip key={`${n}-${i}`} name={n} tone="quiet" />)}
              {!missing.length && <p className={EMPTY}>{total ? "Everyone is in." : "Nobody was on the board that day."}</p>}
            </div>
          </div>
          {outPan.overflowing && <PanCount>{missing.length} in all</PanCount>}
        </motion.section>
      </motion.div>
    </div>
  );
}

// ── phone time ──────────────────────────────────────────────────────────────
export interface TvPhoneTimePerson { id: number; name: string; seconds: number }

/**
 * Time active on the CallTools dialer today.
 *
 * "On the phone", never "hours worked". This is dialer-active time: it knows
 * nothing about a meeting, a training block, a manual-dial stretch or lunch, so
 * a wall that called it hours worked would be accusing whoever spent the
 * morning in a room with a manager. The label is doing real work here.
 */
export function PhoneTimePage({ people, teamSeconds, reduced }: {
  people: TvPhoneTimePerson[];
  teamSeconds: number;
  reduced: boolean;
}) {
  const pan = usePan(PAN_SECONDS.phoneTime, reduced);
  const max = Math.max(1, ...people.map((p) => Number(p.seconds) || 0));
  return (
    <div className={PAGE} data-testid="tv-page-phone-time">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>Today</Eyebrow>
          <h2 className={TITLE}>On the phone</h2>
          <p className="mt-2 text-[clamp(1.05rem,1.5vw,1.55rem)] text-white/45">Time active on the CallTools dialer.</p>
        </div>
        <HeaderPill icon={<Phone className="h-8 w-8 shrink-0" />}>
          Team&nbsp;<span className="whitespace-nowrap font-black text-white">{hoursMinutes(teamSeconds)}</span>
        </HeaderPill>
      </div>

      <div ref={pan.ref} className={PAN_BOX}>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="flex flex-col justify-start gap-4" style={pan.style}>
          {people.map((p, i) => {
            const secs = Number(p.seconds) || 0;
            return (
              <MeterRow
                key={p.id} rank={i + 1} name={p.name} reduced={reduced} cols={COLS_WIDE}
                gold={i === 0 && secs > 0}
                meterPct={(secs / max) * 100}
                value={
                  <span className={`whitespace-nowrap text-[clamp(1.9rem,3vw,3.2rem)] font-black ${secs > 0 ? "" : "text-white/25"}`}>
                    {hoursMinutes(secs)}
                  </span>
                }
              />
            );
          })}
          {!people.length && <li className={EMPTY}>No dialer time recorded today.</li>}
        </motion.ul>
      </div>
      {pan.overflowing && <PanCount>{people.length} on the board</PanCount>}
    </div>
  );
}

// ── lead source ─────────────────────────────────────────────────────────────
export interface TvLeadSourceRow { source: string; count: number }

/**
 * Where the window's transfers came from.
 *
 * `rows` are the transfers that CARRY a source; `coverage` is the share of the
 * window's transfers that carry one at all. When coverage is short the page
 * says how many are unaccounted for, because the alternative is a board whose
 * biggest bar is really "we did not record it" presented as a lead source that
 * beat the others. For the same reason the shares say out loud that they are
 * shares of the sourced transfers, not of every transfer.
 */
export function LeadSourcePage({ window: win, rows, coverage, fromDate, reduced }: {
  window: TvWindow;
  rows: TvLeadSourceRow[];
  /** 0–1: the share of this window's transfers that carry a lead source. */
  coverage: number;
  fromDate?: string | null;
  reduced: boolean;
}) {
  const pan = usePan(PAN_SECONDS.leadSource, reduced);
  const cov = Math.max(0, Math.min(1, Number(coverage) || 0));
  const known = rows.reduce((n, r) => n + (Number(r.count) || 0), 0);
  const max = Math.max(1, ...rows.map((r) => Number(r.count) || 0));
  // The blanks are not in `rows`: they are the difference between what the
  // sourced rows add up to and what the window actually held.
  const blank = cov > 0 && known > 0 ? Math.max(0, Math.round(known / cov) - known) : 0;
  const thin = cov < 0.95 && blank > 0;
  const since = shortDay(fromDate);

  return (
    <div className={PAGE} data-testid="tv-page-lead-source">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>Lead source · {WINDOW_TITLE[win]}{since ? ` · since ${since}` : ""}</Eyebrow>
          <h2 className={TITLE}>Where they came from</h2>
        </div>
        <HeaderPill icon={<Layers className="h-8 w-8 shrink-0" />}>
          <CountUp value={known} className="font-black text-white" />&nbsp;transfers
        </HeaderPill>
      </div>

      <div ref={pan.ref} className={PAN_BOX}>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="flex flex-col justify-start gap-4" style={pan.style}>
          {rows.map((r, i) => {
            const n = Number(r.count) || 0;
            const share = known ? Math.round((n / known) * 100) : 0;
            return (
              <MeterRow
                key={`${r.source}-${i}`} rank={i + 1} name={r.source} reduced={reduced}
                gold={i === 0 && n > 0}
                meterPct={(n / max) * 100}
                right={`${share}%${thin ? " of sourced" : ""}`}
                value={<CountUp value={n} className="text-[clamp(2.6rem,4.4vw,4.8rem)] font-black" />}
              />
            );
          })}
          {!rows.length && <li className={EMPTY}>No transfers carry a lead source {WINDOW_SUFFIX[win]}.</li>}
        </motion.ul>
      </div>
      {pan.overflowing && <PanCount>{rows.length} sources in all</PanCount>}

      {thin && (
        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          className="mt-6 shrink-0 text-[clamp(1.1rem,1.6vw,1.7rem)] leading-snug text-white/45"
          data-testid="tv-lead-source-coverage"
        >
          {blank} more {blank === 1 ? "transfer" : "transfers"} {WINDOW_SUFFIX[win]} {blank === 1 ? "carries" : "carry"} no source, and {blank === 1 ? "is" : "are"} not counted above.
        </motion.p>
      )}
    </div>
  );
}

// ── on the phone now ────────────────────────────────────────────────────────
export interface TvActivePerson { id: number; name: string }

/**
 * Active on CallTools in the last fifteen minutes.
 *
 * Headed exactly that, and nothing shorter. "On the phone now" would be read as
 * a live state and — worse — its inverse would be read as "not at their desk",
 * which this cannot know. It is a fifteen-minute window over dialer activity,
 * so the heading says fifteen minutes and the page lists only the people it can
 * actually vouch for. Nobody is ever listed here as absent.
 */
export function OnPhoneNowPage({ people, count, reduced }: {
  people: TvActivePerson[];
  count: number;
  reduced: boolean;
}) {
  const pan = usePan(PAN_SECONDS.onPhoneNow, reduced);
  return (
    <div className={PAGE} data-testid="tv-page-on-phone-now">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>Right now</Eyebrow>
          <h2 className={TITLE_LONG}>Active on CallTools in the last 15 minutes</h2>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 18 }}
          className="flex shrink-0 items-baseline gap-4 rounded-3xl border border-emerald-300/25 bg-emerald-400/[0.08] px-10 py-5"
        >
          <CountUp value={count} className="text-[clamp(3.4rem,7vw,7rem)] font-black leading-none text-emerald-300" />
          <span className="flex items-center gap-2 text-[clamp(1.1rem,1.7vw,1.8rem)] text-white/60">
            <Radio className="h-7 w-7 shrink-0" /> {count === 1 ? "person" : "people"}
          </span>
        </motion.div>
      </div>

      <div ref={pan.ref} className={PAN_BOX}>
        <motion.div variants={stagger} initial="hidden" animate="show" className="flex flex-wrap content-start gap-4" style={pan.style}>
          {people.map((p) => (
            <motion.span key={p.id} variants={rise(reduced)} className="max-w-full" data-testid="tv-row">
              <NameChip name={p.name} tone="live" />
            </motion.span>
          ))}
          {!people.length && (
            <motion.p variants={rise(reduced)} className={EMPTY}>
              Nobody has been active on CallTools in the last 15 minutes.
            </motion.p>
          )}
        </motion.div>
      </div>
      {pan.overflowing && <PanCount>{people.length} in all</PanCount>}
    </div>
  );
}

// ── who needs transfers ─────────────────────────────────────────────────────
export interface TvStarvedPerson {
  name: string;
  /** Transfers RECEIVED in the window. */
  transfers: number;
  /** Their most recent transfer of all time — not clipped to the window. */
  lastAt?: string | null;
  /** The office flagged this loan officer as needing work sent to them. */
  needsTransfers?: boolean;
}

/**
 * Whole days between a plain calendar date and today.
 *
 * Both ends are built with Date.UTC out of local calendar parts, so the two are
 * measured on the same clock and no timezone can shift the answer by a day —
 * the same reason dayLabel() above refuses to parse an ISO date directly.
 */
function daysAgo(date: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? "").trim());
  if (!m) return null;
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const n = new Date();
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  if (!Number.isFinite(then)) return null;
  // A date ahead of today is the 7pm business-day rollover, not the future.
  return Math.max(0, Math.round((today - then) / 86400000));
}

/** "3 days ago", "yesterday", "today" — or the honest blank. */
function sinceLabel(lastAt: string | null | undefined): string {
  const n = daysAgo(lastAt);
  if (n == null) return "no transfer on record";
  if (n === 0) return "last transfer today";
  if (n === 1) return "last transfer yesterday";
  return `last transfer ${n} days ago`;
}

/**
 * One row of the starved list.
 *
 * Not a MeterRow: this page carries two dozen names and MeterRow's bar and 3vw
 * name fit eight. The tokens are the same ones — rise(), the rounded bordered
 * row the assignments page uses, clamp() type bottoming out at the file's 1rem
 * floor — only the height budget is different.
 *
 * There is no bar here on purpose. A share-of-the-leader meter would be measured
 * against 294 and leave every other row a stub, which says nothing at all about
 * the difference between six and forty-five.
 */
function StarvedRow({ rank, person, flagged, reduced }: {
  rank: number; person: TvStarvedPerson; flagged: boolean; reduced: boolean;
}) {
  const n = Number(person.transfers) || 0;
  return (
    <motion.li
      variants={rise(reduced)}
      className={`grid grid-cols-[2.25rem_1fr_auto] items-center gap-4 rounded-2xl border px-5 py-1.5 ${
        flagged ? "border-amber-300/50 bg-amber-400/[0.11]" : "border-white/10 bg-white/[0.04]"
      }`}
      data-testid="tv-row"
    >
      <span className={`text-[clamp(1rem,1.5vw,1.6rem)] font-black ${flagged ? "text-amber-300" : "text-white/30"}`}>{rank}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`truncate text-[clamp(1.15rem,1.6vw,1.75rem)] font-bold leading-tight ${flagged ? "text-amber-100" : ""}`}
            title={person.name}
          >
            {person.name}
          </span>
          {flagged && (
            // Solid, not a tint. This is a person having said "send them work",
            // and it has to survive being read from the back of the room at any
            // rank — including Christopher Redoble's, near the bottom on 294.
            <span
              className="shrink-0 whitespace-nowrap rounded-full bg-amber-400 px-3 py-0.5 text-[clamp(1rem,1.05vw,1.05rem)] font-black uppercase tracking-[0.12em] text-black"
              data-testid="tv-starved-flag"
            >
              Needs transfers
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[clamp(1rem,1.1vw,1.1rem)] leading-none text-white/45">{sinceLabel(person.lastAt)}</p>
      </div>
      <span className={`text-right text-[clamp(1.3rem,2vw,2.2rem)] font-black tabular-nums ${n > 0 ? "text-white/85" : "text-amber-300"}`}>
        <CountUp value={n} />
      </span>
    </motion.li>
  );
}

/**
 * Who has received the fewest transfers over the window.
 *
 * The one thing this page must not become is a league table of loan officers. A
 * low number here is not a judgement on the person named — it is the floor's own
 * backlog printed with their name against it, and the subtitle says so out loud.
 *
 * Ranked by fewest received, full stop. The flag is emphasis, never order:
 * Christopher Redoble is flagged AND took 294 in the same fortnight the bottom
 * of the list took six, so pinning the flagged rows to the top would put the
 * best-fed loan officer at the head of a starvation list. priority_tier is not
 * in it either — all seventeen active LOs sit at tier 2, so it ranks nobody.
 *
 * Every active LO is on it, in two columns that pan together when they do not
 * fit, with the LOAs in their own panel beside them: a different population on
 * a different scale (23–57 against 6–294), and one list of both would flatter
 * the top of it and bury the bottom.
 */
export function StarvedPage({ days, los, loas, reduced }: {
  days: number;
  los: TvStarvedPerson[];
  loas: TvStarvedPerson[];
  reduced: boolean;
}) {
  const win = Math.max(1, Math.round(Number(days) || 14));
  const loPan = usePan(PAN_SECONDS.starved, reduced);
  const loaPan = usePan(PAN_SECONDS.starved, reduced);
  // Nothing is cut. About eight rows a column is what 1080p holds without going
  // under the 1rem floor — sixteen names against seventeen active loan officers
  // — so the columns pan instead of stopping. That also retires the rule that
  // used to haul a flagged row up out of the cut: there is no cut to be under,
  // and Christopher Redoble keeps his place near the bottom on 294 with the
  // flag on it, which is where the ranking honestly puts him.
  const ranked = los ?? [];
  const assistants = loas ?? [];
  // Down the left column, then the right — so the top-left name is the hungriest
  // one, which is where the room looks first.
  const half = Math.ceil(ranked.length / 2);
  const columns = [ranked.slice(0, half), ranked.slice(half)];
  const flagged = ranked.filter((p) => p.needsTransfers);
  // The sharp end, named in words. A wall of numbers still needs one sentence
  // somebody can act on without counting rows.
  const least = ranked.slice(0, 3);

  return (
    <div className={PAGE} data-testid="tv-page-starved">
      <div className="mb-6 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>Transfers received · last {win} days</Eyebrow>
          <h2 className={TITLE}>Who needs transfers</h2>
          <p className="mt-2 text-[clamp(1.05rem,1.5vw,1.55rem)] text-white/45">
            Fewest received first. This is our backlog, not their scorecard.
          </p>
        </div>
        {flagged.length > 0 ? (
          <HeaderPill tone="gold" icon={<Inbox className="h-8 w-8 shrink-0" />}>
            <span className="truncate">{flagged.length} flagged for transfers</span>
          </HeaderPill>
        ) : (
          <HeaderPill icon={<Inbox className="h-8 w-8 shrink-0" />}>Nobody is flagged today</HeaderPill>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_23rem] gap-7 overflow-hidden">
        {/* Both columns share one clipping box, so they pan as one. They are a
            single ranked list wrapped into two, and sliding them at their own
            rates would read as two lists that disagree with each other. */}
        <div ref={loPan.ref} className="col-span-2 min-h-0 overflow-hidden">
          <div className="grid grid-cols-2 gap-7" style={loPan.style}>
            {columns.map((col, c) => (
              <motion.ul
                key={c} variants={stagger} initial="hidden" animate="show"
                className="flex flex-col content-start gap-2"
              >
                {col.map((p, i) => (
                  <StarvedRow
                    key={`${p.name}-${c}-${i}`} rank={c * half + i + 1} person={p}
                    flagged={!!p.needsTransfers} reduced={reduced}
                  />
                ))}
                {c === 0 && !ranked.length && <li className={EMPTY}>No active loan officers to rank.</li>}
              </motion.ul>
            ))}
          </div>
        </div>

        <motion.section
          variants={stagger} initial="hidden" animate="show"
          className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6"
        >
          <div className="mb-3 flex items-baseline gap-3">
            <Eyebrow>LOAs</Eyebrow>
            <span className="text-[clamp(1.2rem,1.8vw,2rem)] font-black leading-none text-white/70">
              <CountUp value={assistants.length} />
            </span>
          </div>
          <div ref={loaPan.ref} className="min-h-0 flex-1 overflow-hidden">
            <ul className="flex flex-col gap-2" style={loaPan.style} data-testid="tv-starved-loas">
              {assistants.map((p, i) => (
                <StarvedRow key={`${p.name}-${i}`} rank={i + 1} person={p} flagged={false} reduced={reduced} />
              ))}
              {!assistants.length && <li className={EMPTY}>No active LOAs right now.</li>}
            </ul>
          </div>
          {loaPan.overflowing && <PanCount>{assistants.length} in all</PanCount>}
        </motion.section>
      </div>
      {loPan.overflowing && <PanCount>{ranked.length} loan officers on the board</PanCount>}

      {least.length > 0 && (
        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
          className="mt-5 shrink-0 text-[clamp(1.1rem,1.6vw,1.7rem)] leading-snug text-white/50"
          data-testid="tv-starved-least"
        >
          Send the next ones to {nameList(least.map((p) => `${p.name} (${Number(p.transfers) || 0})`))}.
        </motion.p>
      )}
    </div>
  );
}

// ── what is coming up ───────────────────────────────────────────────────────
export interface TvUpcomingAppointment {
  id: number;
  borrower: string;
  /** The CLR who booked it. */
  clr: string;
  /** The loan officer it is with. Null when the row never named one. */
  lo: string | null;
  /**
   * The time, ALREADY RENDERED by the server's whenLabel — "Thu 2:30 PM".
   *
   * It arrives as a string on purpose. These stamps carry no timezone: they
   * are the wall clock somebody typed, and reading one with `new Date()` in a
   * browser (or on a server running UTC, which is how this bit once) turns a
   * 2:30 PM appointment into a 7:30 AM one. This page therefore does no date
   * arithmetic of any kind — it prints what it is given.
   */
  when: string | null;
  /** The calendar day, YYYY-MM-DD, for the small line above the time. */
  day: string;
  isToday: boolean;
}

/**
 * The meetings that are still coming.
 *
 * The one question this page answers from the far side of the room is "what is
 * on today, and who is it with". So today's rows are the amber ones and the
 * pill counts them; everything else is the week behind them, soonest first.
 *
 * Three names on a row and no numbers anywhere: a borrower, the CLR who booked
 * it, and the loan officer it is with. There is deliberately no count per CLR
 * and no ranking — appointments booked is already a column on the scorecard,
 * and a second leaderboard hiding inside a schedule would quietly turn a list
 * people need to READ into one they check their own position on.
 */
export function UpcomingPage({ appointments, days, todayCount, reduced }: {
  appointments: TvUpcomingAppointment[];
  days: number;
  todayCount: number;
  reduced: boolean;
}) {
  const win = Math.max(1, Math.round(Number(days) || 7));
  const list = appointments ?? [];
  const dueToday = Math.max(0, Math.round(Number(todayCount) || 0));
  const pan = usePan(PAN_SECONDS.upcoming, reduced);

  return (
    <div className={PAGE} data-testid="tv-page-upcoming">
      <div className="mb-8 flex items-end justify-between gap-8">
        <div className="min-w-0">
          <Eyebrow>Next {win} days · {list.length} booked</Eyebrow>
          <h2 className={TITLE}>Coming up</h2>
          <p className="mt-2 text-[clamp(1.05rem,1.5vw,1.55rem)] text-white/45">
            Appointments still on the books, soonest first.
          </p>
        </div>
        {dueToday > 0 ? (
          <HeaderPill tone="gold" icon={<CalendarClock className="h-8 w-8 shrink-0" />}>
            <span className="truncate">{dueToday} still today</span>
          </HeaderPill>
        ) : (
          <HeaderPill icon={<CalendarClock className="h-8 w-8 shrink-0" />}>Nothing left today</HeaderPill>
        )}
      </div>

      <div ref={pan.ref} className={PAN_BOX}>
        <motion.ul variants={stagger} initial="hidden" animate="show" className="flex flex-col justify-start gap-3" style={pan.style}>
          {list.map((a) => (
            <motion.li
              key={a.id} variants={rise(reduced)}
              className={`grid grid-cols-[16rem_1fr_auto] items-center gap-6 rounded-2xl border px-6 py-3.5 ${
                a.isToday ? "border-amber-300/45 bg-amber-400/[0.10]" : "border-white/10 bg-white/[0.04]"
              }`}
              data-testid="tv-row"
            >
              <div className="min-w-0">
                <p className={`text-[clamp(0.85rem,1.1vw,1.15rem)] font-semibold uppercase tracking-[0.22em] ${
                  a.isToday ? "text-amber-200/85" : "text-white/35"
                }`}>
                  {a.isToday ? "Today" : shortDay(a.day) ?? ""}
                </p>
                <p className={`whitespace-nowrap text-[clamp(1.3rem,2vw,2.1rem)] font-black leading-tight ${
                  a.isToday ? "text-amber-200" : "text-white/85"
                }`}>
                  {/* A row with a day and no clock reading says so. A made-up
                      9am would be read as a time somebody agreed to. */}
                  {a.when ?? <span className="text-white/35">time not set</span>}
                </p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[clamp(1.5rem,2.4vw,2.6rem)] font-bold leading-tight" title={a.borrower}>{a.borrower}</p>
                <p className="truncate text-[clamp(1rem,1.35vw,1.35rem)] text-white/45">Booked by {a.clr}</p>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-3">
                <span className="shrink-0 text-[clamp(1rem,1.3vw,1.3rem)] text-white/35">with</span>
                {a.lo
                  ? <NameChip name={a.lo} />
                  : <span className="text-[clamp(1.1rem,1.5vw,1.5rem)] text-white/30">no loan officer named</span>}
              </div>
            </motion.li>
          ))}
          {!list.length && (
            <li className={EMPTY}>
              Nothing booked for the next {win} days. The board is clear.
            </li>
          )}
        </motion.ul>
      </div>
      {pan.overflowing && <PanCount>{list.length} in the next {win} days</PanCount>}
    </div>
  );
}
