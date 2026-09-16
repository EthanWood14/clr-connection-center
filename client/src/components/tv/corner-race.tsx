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
  return (
    <section
      className="relative ml-auto flex w-[34vw] shrink-0 items-stretch overflow-hidden rounded-xl border border-white/15 bg-[#0d1b26]"
      data-testid="tv-corner-race"
      data-corner-race-state={failed ? "fallback" : "live"}
      aria-label="Today's race, running live"
    >
      {!failed && <div ref={host} className="absolute inset-0" />}
      {failed && (
        <ol className="flex w-full items-center justify-around gap-3 px-4">
          {top.map((p, i) => (
            <li key={p.id} className="flex min-w-0 items-baseline gap-2">
              <span className="text-[1.6vh] font-black italic" style={{ color: i === 0 ? "#f8d581" : "#89949d" }}>P{p.rank}</span>
              <span className="truncate text-[1.7vh] font-semibold text-white/80">{p.name}</span>
              <span className="text-[1.8vh] font-black tabular-nums">{formatTransferCount(p.transfersToday)}</span>
            </li>
          ))}
          {!top.length && <li className="text-[1.6vh] text-white/40">No transfers yet today.</li>}
        </ol>
      )}
      {/* The label rides on top of the scene; the scene fills the box. */}
      <span className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5 bg-red-600 px-2 py-0.5 text-[1.1vh] font-black uppercase tracking-[.2em] text-white">
        Live
      </span>
    </section>
  );
}
