import { useEffect, useMemo, useRef, useState } from "react";
import { raceGrid } from "@shared/tv-race-grid";
import { formatTransferCount } from "@shared/transfer-credit";
import type { RankRow } from "@shared/tv-overtake";
import { preloadFieldRace } from "./field-race";

/**
 * The race, always on, in the corner of the wall.
 *
 * Ethan, 16 Sep 2026: "can you have the race on the tv constantly be playing
 * in live a corner of the screen or something." The full-screen race is a
 * moment — it belongs to one transfer and it is over in twelve seconds. This
 * is the same field, small, running all day at the end of the bottom strip, so
 * the standings are in the room's peripheral vision the whole time.
 *
 * Three things it is careful about, because a thing that is on all day has to
 * be:
 *
 *  1. It never floats over a page. It sits IN the strip, which the deck's box
 *     is measured against, so nothing it covers is something somebody was
 *     reading. (Same rule as NewLeadZone, for the same reason.)
 *  2. One WebGL context at a time on this screen. The full-screen race takes
 *     the wall for its twelve seconds and this one unmounts while it does —
 *     two live contexts on a kiosk is how you lose both of them.
 *  3. If the scene cannot start, or the driver drops the context, it falls
 *     back to the top three as text and stops trying. A black rectangle on
 *     the wall all day is worse than no rectangle.
 */
export function CornerRace({ people, reduced, paused = false }: {
  people: RankRow[];
  reduced: boolean;
  /** The full-screen race has the wall: give up the context until it is done. */
  paused?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // A new run every cycle, so the cars are always moving rather than sitting
  // at the line the first race left them on.
  const [run, setRun] = useState(0);
  const drivers = useMemo(() => raceGrid(people), [people]);
  // The standings as a value, so a poll that changes nothing does not restart
  // a race mid-corner.
  const grid = useMemo(
    () => drivers.map((d) => `${d.id}:${d.transfersToday}`).join("|"),
    [drivers],
  );
  const top = drivers.slice(0, 3);

  useEffect(() => {
    if (paused || failed || !people.length) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let timer = 0;
    void preloadFieldRace().then(({ mountRaceScene }) => {
      if (cancelled || !host.current) return;
      try {
        cleanup = mountRaceScene(host.current, {
          drivers, before: null, reduced,
          // Written straight to the node rather than through state: it ticks
          // five times a second for twelve seconds and nothing renders off
          // it. It is how anyone can tell from the page itself whether the
          // corner is animating or just showing a dead last frame.
          onProgress: (elapsed) => { if (host.current) host.current.dataset.raceElapsed = elapsed.toFixed(1); },
          onFailure: () => { if (!cancelled) setFailed(true); },
        });
      } catch { if (!cancelled) setFailed(true); return; }
      // The scene stops drawing at 11.8s. Start the next lap as it ends: a
      // longer wait leaves a dead rectangle on the wall, and a WebGL canvas
      // that has stopped is not guaranteed to keep showing its last frame.
      timer = window.setTimeout(() => { if (!cancelled) setRun((n) => n + 1); }, reduced ? 60_000 : 12_200);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; window.clearTimeout(timer); cleanup?.(); };
    // `grid` is the dependency, not `drivers`: same standings, same race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, reduced, run, paused, failed, people.length]);

  if (paused) return null;
  const leader = drivers[0];
  const second = drivers.find((d) => d.rank > 1);
  const margin = leader && second ? leader.transfersToday - second.transfersToday : 0;
  return (
    <section
      className="ml-auto flex w-[38vw] shrink-0 items-stretch gap-3 overflow-hidden rounded-xl border border-white/15 bg-[#0d1b26]"
      data-testid="tv-corner-race"
      data-corner-race-state={failed ? "fallback" : "live"}
      aria-label="Today's race, running live"
    >
      {/* The cars. Half the box: on their own they are decoration, and a
          decoration nobody can read is what makes a wall boring. */}
      <div className="relative w-1/2 shrink-0 overflow-hidden">
        {!failed && <div ref={host} className="absolute inset-0" />}
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 bg-red-600 px-1.5 py-0.5 text-[1.05vh] font-black uppercase tracking-[.18em] text-white">
          Live
        </span>
      </div>
      {/* The other half says who is winning, which is the part anybody in the
          room actually wants from a glance at the corner. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.4vh] py-1 pr-3">
        <p className="text-[1.05vh] font-semibold uppercase tracking-[.22em] text-white/45">Today&apos;s race</p>
        {top.map((p, i) => (
          <div key={p.id} className="flex min-w-0 items-baseline gap-2" data-testid={`tv-corner-race-p${p.rank}`}>
            <span className="w-[2.2vh] shrink-0 text-[1.7vh] font-black italic" style={{ color: i === 0 ? "#f8d581" : "#7b8894" }}>P{p.rank}</span>
            <span className="h-[1.5vh] w-[3px] shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate text-[1.75vh] font-semibold text-white/85">{p.name}</span>
            <span className="text-[2vh] font-black tabular-nums">{formatTransferCount(p.transfersToday)}</span>
          </div>
        ))}
        {!top.length && <p className="text-[1.6vh] text-white/40">No transfers yet today.</p>}
        {leader && margin > 0 && (
          <p className="truncate text-[1.15vh] text-white/45">
            <span className="font-bold text-amber-300">{leader.name.split(" ")[0]}</span> leads by {formatTransferCount(margin)}
          </p>
        )}
        {leader && margin === 0 && second && <p className="text-[1.15vh] text-white/45">Level at the front</p>}
      </div>
    </section>
  );
}
