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
import {
  BOARD_TZ,
  DECK,
  Feed,
  HOLD_MS,
  Kind,
  LatestPage,
  Moment,
  MomentOverlay,
  NEW_LEAD_HOLD_MS,
  NewLead,
  NewLeadZone,
  PAGES_POLL_MS,
  PLAYED_KEY,
  POLL_MS,
  PageId,
  SOUND,
  ScorecardPage,
  StripRule,
  TIP_MS,
  TeamPage,
  TipPage,
  since,
  slide,
  useNow,
} from "./tv-board-kit";

export default function TvBoard({ publicPath = false }: { publicPath?: boolean }) {
  const [, params] = useRoute("/tv/:token");
  const token = params?.token ?? "";
  const apiRoot = publicPath ? "/api/tv" : `/api/tv/${encodeURIComponent(token)}`;
  const reduced = !!useReducedMotion();
  const now = useNow();
  useEffect(() => { void preloadFieldRace().catch(() => {}); }, []);

  const cursorRef = useRef<string | null>(null);
  const [tipSeed, setTipSeed] = useState(() => Math.floor(Date.now() / TIP_MS));
  useEffect(() => { const id = setInterval(() => setTipSeed((s) => s + 1), TIP_MS); return () => clearInterval(id); }, []);

  const { data, isError } = useQuery<Feed>({
    queryKey: ["/api/tv", publicPath ? "public" : token, "feed", tipSeed],
    queryFn: async () => {
      const q = new URLSearchParams({ tip: String(tipSeed) });
      if (cursorRef.current) q.set("since", cursorRef.current);
      const r = await fetch(`${apiRoot}/feed?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    enabled: publicPath || !!token,
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
  const previewSequence = useRef(0);
  const previewStatus = racePreviewStatus(current, queue);
  const previewPeople = data?.racePeople ?? data?.scorecard.people ?? [];
  const raceDayCredits = data?.raceDayCredits ?? [];
  const playRacePreview = useCallback(() => {
    if (!previewPeople.length || previewStatus) return;
    const key = `local-race-preview:${Date.now()}:${++previewSequence.current}`;
    // Day replay: 8s per non-empty hour, Elleine off the field. Falls back to
    // a still of today's grid when no hourly credits have landed yet.
    const moment = createTvDayRacePreview(previewPeople, raceDayCredits, key, new Date().toISOString());
    // A double click cannot add two previews. Real celebrations already in
    // line keep their place, and the current transfer is never interrupted.
    setQueue(queued => racePreviewStatus(current, queued) ? queued : [...queued, moment]);
  }, [previewPeople, previewStatus, current, raceDayCredits]);
  /** Last poll's standings, for spotting one CLR passing another. */
  const prevStandings = useRef<RankRow[] | null>(null);
  const prevStandingsDay = useRef<string | null>(null);
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
    const standings: RankRow[] = (data.racePeople ?? data.scorecard.people).map((p) => ({ id: p.id, name: p.name, transfersToday: p.transfersToday, car: p.car }));
    const before = prevStandingsDay.current === data.today ? prevStandings.current : null;
    const races = new Map(planTransferRaces(before, standings, data.events, played.current).map(race => [race.event.id, race]));
    const playbackKey = data.racePlayback ? `manual-race:${data.racePlayback.id}` : null;
    if (playbackKey && !played.current.has(playbackKey)) next.push({
      type: "event", key: playbackKey, preview: true, fieldRace: standings,
      event: { id: playbackKey, kind: "transfer", at: data.now, borrower: "", who: "", lo: null, detail: null },
    });
    for (const ev of data.events) {
      if (played.current.has(ev.id)) continue;
      const race = races.get(ev.id);
      // The race IS this transfer's moment, not a second sampled celebration.
      // Keep its original ID so an edit or refresh cannot replay an old result.
      next.push(race
        ? { type: "event", key: ev.id, event: ev, fieldRace: race.people, raceBefore: race.before, focusId: race.focusId }
        : { type: "event", key: ev.id, event: ev });
    }
    for (const m of data.milestones) if (!played.current.has(m.id)) next.push({ type: "milestone", key: m.id, milestone: m });
    // The whole field, at the top of every hour (shared/tv-hourly-race.ts).
    // Dealt like any other moment, so it cuts in over whatever page is up and
    // the deck picks up behind it; keyed by the hour so a reload, a second
    // poll in the same minute, or a dwell straddling the hour cannot repeat it.
    const hourly = dueHourlyRaceKey(Date.now(), BOARD_TZ, played.current);
    if (hourly && standings.length) next.push(createTvRacePreview(standings, hourly, data.now));
    prevStandings.current = standings;
    prevStandingsDay.current = data.today;
    if (next.length) setQueue((q) => appendTvMoments(q, next, played.current));
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
      ev("rescheduled", "Tomas Reyes", "Rebooked to Tue 4:15 PM"),
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
    const hold = (current.type === "event" || current.type === "overtake") && current.fieldRace
      ? (current.type === "event" && current.dayFrames?.length ? dayRaceMomentMs(current.dayFrames.length) : RACE_MOMENT_MS)
      : current.type === "milestone" ? HOLD_MS.milestone
      : current.type === "overtake" ? HOLD_MS.overtake
      : HOLD_MS[current.event.kind];
    const done = setTimeout(() => setCurrent(null), hold);
    return () => clearTimeout(done);
  }, [current]);

  // ── new leads ─────────────────────────────────────────────────────────
  // LeadVault says a lead landed; it rises into the right-hand end of the
  // bottom strip, holds lit for eight seconds, then settles into the strip's
  // own grey as the last one in. Deliberately NOT a moment: it never goes
  // into the queue, so it cannot pause the deck and cannot end up waiting
  // behind a transfer's hype screen — by the time that finished, a lead that
  // "just" landed would be two minutes old and no longer news.
  //
  // It owns no timer either. Whether the notice is still lit is read off the
  // same second-clock the header already runs, which is one fewer thing that
  // can be left running, or cancelled at the wrong moment. And the zone it
  // lands in is the same height empty as full, so the strip never changes
  // size under the deck when one arrives.
  const lastLeadId = useRef(0);
  const [leadNotice, setLeadNotice] = useState<{ lead: NewLead; more: number; until: number } | null>(null);
  useEffect(() => {
    const fresh = (data?.newLeads ?? []).filter((l) => l.id > lastLeadId.current);
    if (!fresh.length) return;
    // Five arriving in one poll is ONE notice, not five eight-second holds
    // stacked behind each other: the newest gets the strip, and the rest are
    // a quiet count beside it.
    const newest = fresh.reduce((a, b) => (b.id > a.id ? b : a));
    // Ids only climb, so the newest one IS the high-water mark. The feed
    // re-sends a lead until an outcome moves the shared cursor past it, and a
    // screen that stays up for weeks should remember one number for that, not
    // a set that grows all day.
    lastLeadId.current = newest.id;
    setLeadNotice({ lead: newest, more: fresh.length - 1, until: Date.now() + NEW_LEAD_HOLD_MS });
  }, [data]);
  const leadUp = !!leadNotice && now.getTime() < leadNotice.until;

  // ── the deck ──────────────────────────────────────────────────────────
  // Advances on its own clock; pauses while a moment is up so the page under
  // it does not change out from beneath the card.
  // The heavier board data, on its own endpoint and its own clock.
  const { data: board } = useQuery<any>({
    queryKey: [apiRoot, "pages"],
    queryFn: async () => {
      const res = await fetch(`${apiRoot}/pages`);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: publicPath || !!token,
    refetchInterval: PAGES_POLL_MS,
    staleTime: PAGES_POLL_MS,
  });

  // Which slots are allowed on the wall right now. A page whose data is
  // missing — its section failed, or the endpoint has not answered yet — is
  // dropped rather than shown empty, so a broken query costs a slot instead of
  // putting a blank screen in front of the floor.
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const deck = useMemo(() => {
    const has = (id: PageId) => {
      switch (id) {
        case "transfersWeek": case "transfersMonth": return !!board?.transfers;
        case "writeup":      return !!board?.writeUps;
        case "assignments":  return !!board?.assignments?.people?.length;
        case "eod":          return !!board?.eod;
        case "phoneTime":    return !!board?.phoneTime;
        case "leadSource":   return !!board?.leadSources;
        case "onPhoneNow":   return !!board?.onPhoneNow;
        case "starved":      return !!board?.starved;
        case "loSplit":      return !!board?.loSplit;
        case "upcoming":     return !!board?.upcoming;
        default:             return true;
      }
    };
    const allowed = DECK.filter((d) => (!d.when || d.when(nowMins)) && has(d.id));
    // Never leave the wall with nothing to show.
    return allowed.length ? allowed : DECK.filter((d) => !d.when && has(d.id));
    // Re-deal only when the hour band or the available sections change, not on
    // every minute tick, or the deck would reshuffle under the viewer.
  }, [board, Math.floor(nowMins / 30)]);

  const [slot, setSlot] = useState(0);
  const [dealt, setDealt] = useState(0); // bumps on every advance so a repeated page re-enters fresh
  useEffect(() => {
    if (current) return;
    const id = setTimeout(() => { setSlot((s) => (s + 1) % deck.length); setDealt((d) => d + 1); }, (deck[slot] ?? deck[0]).dwellMs);
    return () => clearTimeout(id);
  }, [slot, current]);
  const page = (deck[slot] ?? deck[0]).id;
  const dwellMs = (deck[slot] ?? deck[0]).dwellMs;
  /** Tap or click anywhere to skip to the next page. */
  const advance = useCallback(() => {
    setSlot((v) => (v + 1) % deck.length);
    setDealt((d) => d + 1);
  }, [deck.length]);

  const people = data?.scorecard.people ?? [];
  // The field the corner race drives round, as the full-screen race builds it.
  const raceStandings = useMemo<RankRow[]>(
    () => (data?.racePeople ?? data?.scorecard.people ?? [])
      .map((p) => ({ id: p.id, name: p.name, transfersToday: p.transfersToday, car: p.car })),
    [data?.racePeople, data?.scorecard.people],
  );
  const team = data?.scorecard.team ?? { transfersToday: 0, transfersWeek: 0, appointmentsToday: 0, fellThroughToday: 0, missedToday: 0 };
  const teamGoal = useMemo(() => people.reduce((n, p) => n + p.goalTransfersWeekly, 0), [people]);

  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (!token && !publicPath) return <div className="flex h-screen items-center justify-center bg-[#0B1220] text-white/70">No display link.</div>;

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#0B1220] text-white [font-variant-numeric:tabular-nums]"
      data-testid="tv-board"
      onClick={advance}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") advance(); }}
      title="Click for the next page"
    >
      {/* The scorecard pans when more people are on the board than fit. */}
      <style>{`@keyframes tv-pan {
        0%, 14%   { transform: translateY(0); }
        56%, 74%  { transform: translateY(var(--tv-pan)); }
        100%      { transform: translateY(0); }
      }`}</style>
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
      <header className="relative z-10 flex h-24 items-center justify-between gap-5 px-6 xl:px-12 2xl:px-16">
        <div className="flex min-w-0 flex-col justify-center gap-1 2xl:flex-row 2xl:items-baseline 2xl:gap-5">
          <span className="text-[clamp(1.2rem,1.8vw,1.8rem)] font-black tracking-[0.22em] text-amber-300">WEST CAPITAL</span>
          <span className="truncate text-[clamp(.65rem,1vw,1.3rem)] font-medium uppercase tracking-[0.2em] text-white/45">CLR Connection Center</span>
        </div>
        <div className="flex shrink-0 items-center gap-4 xl:gap-8">
          <span className="hidden text-[clamp(1rem,1.4vw,1.6rem)] text-white/60 lg:inline">{dateLabel}</span>
          <span className="whitespace-nowrap text-[clamp(1.5rem,2.6vw,3rem)] font-bold tabular-nums">{clock}</span>
          <span className="flex items-center gap-2 text-[clamp(.85rem,1.1vw,1.1rem)] uppercase tracking-widest text-white/50" data-testid="tv-live">
            <span className={`h-3 w-3 rounded-full ${isError ? "bg-rose-400" : "bg-emerald-400"} ${!reduced && !isError ? "animate-pulse" : ""}`} />
            {isError ? "Reconnecting" : "Live"}
          </span>
        </div>
      </header>

      {/* ── the deck ── */}
      {/* The deck's box, shortened by the strip below it rather than padded
          behind it: 100vh less the 6rem header less the strip. Every page
          inside measures its own pan against the height it is handed, so a
          tall list simply pans that much further. The strip went from 10vh to
          20vh when the live race moved into it (owner, 16 Sep 2026) — this
          number is the reason the pages did not need touching for that. */}
      <main className="relative z-10 h-[calc(100vh-6rem-20vh)]">
        {/* Not mode="wait". That holds the incoming page until the outgoing
            one reports its exit finished, and an exit that never finishes
            wedges the board — which has already happened twice on this screen.
            The pages are absolutely positioned, so they simply cross. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={`${page}-${dealt}`}
            className="absolute inset-0"
            variants={slide(reduced)} initial="enter" animate="center" exit="exit"
            data-testid="tv-page" data-page={page}
          >
            {page === "scorecard" && (
              <ScorecardPage
                people={people} reduced={reduced} now={now.getTime()} dwellMs={dwellMs}
                checkins={board?.checkins?.people
                  ? Object.fromEntries(board.checkins.people.map((c: any) => [c.name, !!c.checkedIn || !!c.excused]))
                  : undefined}
              />
            )}
            {page === "team"      && <TeamPage team={team} teamGoal={teamGoal} reduced={reduced} />}
            {page === "latest"    && <LatestPage recent={data?.recent ?? []} now={now} reduced={reduced} />}
            {page === "tip"       && <TipPage tip={data?.tip ?? null} reduced={reduced} />}
            {page === "transfersWeek" && (
              <TransfersPage
                window="week" reduced={reduced}
                people={(board?.transfers?.people ?? []).map((p: any) => ({ id: p.id, name: p.name, count: p.week }))}
                team={board?.transfers?.team?.week ?? 0}
                excluded={(board?.transfers?.excluded ?? []).map((e: any) => ({ name: e.name, count: e.week }))}
              />
            )}
            {page === "transfersMonth" && (
              <TransfersPage
                window="month" reduced={reduced}
                people={(board?.transfers?.people ?? []).map((p: any) => ({ id: p.id, name: p.name, count: p.month }))}
                team={board?.transfers?.team?.month ?? 0}
                excluded={(board?.transfers?.excluded ?? []).map((e: any) => ({ name: e.name, count: e.month }))}
              />
            )}
            {page === "writeup" && (
              <WriteUpPage
                reduced={reduced}
                people={(board?.writeUps?.people ?? []).map((p: any, i: number) => ({ id: i, name: p.name, pct: p.pct, transfers: p.transfers }))}
                team={board?.writeUps?.team?.pct ?? null}
              />
            )}
            {page === "assignments" && (
              <AssignmentsPage
                reduced={reduced}
                people={(board?.assignments?.people ?? []).map((p: any, i: number) => ({
                  id: p.id ?? i, name: p.name, los: (p.los ?? []).map((l: any) => (typeof l === "string" ? l : l.loName ?? l.name ?? "")),
                }))}
              />
            )}
            {page === "eod" && (
              <EodPage
                reduced={reduced}
                forDate={board?.eod?.forDate ?? ""}
                // The server sends rows, the page wants names. Passing the
                // rows straight through rendered an object as a React child,
                // which is error #31 and a blank screen.
                submitted={(board?.eod?.submitted ?? []).map((r: any) => (typeof r === "string" ? r : r.name))}
                missing={(board?.eod?.missing ?? []).map((r: any) => (typeof r === "string" ? r : r.name))}
              />
            )}
            {page === "phoneTime" && (
              <PhoneTimePage
                reduced={reduced}
                people={(board?.phoneTime?.people ?? []).map((p: any, i: number) => ({ id: p.id ?? i, name: p.name, seconds: p.seconds }))}
                teamSeconds={board?.phoneTime?.teamSeconds ?? 0}
              />
            )}
            {page === "leadSource" && (() => {
              const wnd = board?.leadSources?.windows?.week;
              return (
                <LeadSourcePage
                  window="week" reduced={reduced}
                  rows={(wnd?.sources ?? []).map((r: any) => ({ source: r.source, count: r.count }))}
                  // The page wants a fraction; the server reports a percentage.
                  coverage={wnd?.pct == null ? 1 : wnd.pct / 100}
                  // The dates these counts actually cover, and whether
                  // lead_source's rollout is what moved the start. One period
                  // on the eyebrow, never a window name beside a second date.
                  startDate={wnd?.startDate ?? ""}
                  endDate={wnd?.endDate ?? board?.today ?? ""}
                  clipped={!!wnd?.clipped}
                />
              );
            })()}
            {page === "starved" && (
              <StarvedPage
                reduced={reduced}
                days={board?.starved?.days ?? 14}
                los={board?.starved?.los ?? []}
                loas={board?.starved?.loas ?? []}
              />
            )}
            {page === "weeklyPace" && (
              <WeeklyPacePage
                reduced={reduced}
                weeks={board?.weeklyPace?.weeks ?? []}
                average={board?.weeklyPace?.average ?? null}
              />
            )}
            {page === "loSplit" && (
              <LoSplitPage
                reduced={reduced}
                helperName={board?.loSplit?.helperName ?? "Elleine"}
                helperKnown={!!board?.loSplit?.helperKnown}
                rows={board?.loSplit?.windows?.month ?? []}
                totals={board?.loSplit?.totals ?? {
                  today: { helper: 0, others: 0, total: 0 },
                  week: { helper: 0, others: 0, total: 0 },
                  month: { helper: 0, others: 0, total: 0 },
                  all: { helper: 0, others: 0, total: 0 },
                }}
              />
            )}
            {page === "upcoming" && (
              <UpcomingPage
                reduced={reduced}
                days={board?.upcoming?.days ?? 7}
                todayCount={board?.upcoming?.todayCount ?? 0}
                // The rows arrive already resolved and already formatted: the
                // server picked appointment_datetime over follow_up_date and
                // ran whenLabel over it. Nothing here parses a date — one
                // `new Date("2026-09-03T14:30")` in this file would put a
                // 2:30 PM meeting on the wall as 7:30 AM.
                appointments={(board?.upcoming?.appointments ?? []).map((a: any, i: number) => ({
                  id: a.id ?? i,
                  borrower: String(a.borrower ?? ""),
                  clr: String(a.clr ?? ""),
                  lo: a.lo == null ? null : String(a.lo),
                  when: a.when == null ? null : String(a.when),
                  day: String(a.day ?? ""),
                  isToday: !!a.isToday,
                }))}
              />
            )}
            {page === "onPhoneNow" && (
              <OnPhoneNowPage
                reduced={reduced}
                count={board?.onPhoneNow?.count ?? 0}
                people={(board?.onPhoneNow?.people ?? [])
                  .filter((p: any) => p.activeAgo != null)
                  .map((p: any, i: number) => ({ id: i, name: p.name }))}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── the bottom strip: what just landed, and where the deck is. One row
             in the page's own flow, ten percent of the screen, over nothing —
             see NewLeadZone above. ── */}
      <footer
        className="relative z-10 flex h-[20vh] items-stretch gap-8 border-t border-white/10 bg-white/[0.03] pl-44 pr-10 py-3"
        data-testid="tv-strip"
      >
        <NewLeadZone notice={leadNotice} up={leadUp} reduced={reduced} />
        <StripRule />
        {/* Progress dots: which page, and how long until the next. They close
            the row on the right, the way page numbers close a footer. */}
        <div className="flex min-w-0 flex-1 shrink items-center justify-center gap-3 overflow-hidden" aria-hidden="true" data-testid="tv-progress">
          {deck.map((d, i) => (
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
        </div>
        {/* The race, always on, at the end of the strip. In the row rather than
            over a page — the deck's box is measured against this strip, so
            nothing it shows was something somebody was reading. It gives up
            its WebGL context while the full-screen race has the wall. */}
        <CornerRace people={raceStandings} reduced={reduced} paused={!!current} />
      </footer>

      {current && <MomentOverlay moment={current} reduced={reduced} />}
      <button
        type="button"
        data-testid="tv-play-race"
        className="absolute bottom-1 left-3 z-50 flex h-8 items-center gap-2 rounded-md border border-cyan-200/50 bg-slate-950/95 px-3 text-xs font-bold text-cyan-100 shadow-lg transition-colors hover:bg-cyan-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-default disabled:border-white/20 disabled:text-white/60"
        disabled={!previewPeople.length || !!previewStatus}
        onClick={(event) => { event.stopPropagation(); playRacePreview(); }}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        aria-label={previewStatus === "playing" ? "Race preview playing" : previewStatus === "queued" ? "Race preview queued" : "Play race preview"}
        title="Play today's race on this screen only (8s per hour, skip empty hours, Elleine excluded). Does not log a transfer or change scores."
      >
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        {previewStatus === "playing" ? "Race playing…" : previewStatus === "queued" ? "Race queued…" : "Play race"}
      </button>
    </div>
  );
}
