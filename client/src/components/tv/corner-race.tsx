import { useEffect, useMemo, useRef, useState } from "react";
import { raceGrid, type RaceDriver } from "@shared/tv-race-grid";
import { formatTransferCount } from "@shared/transfer-credit";
import type { RankRow } from "@shared/tv-overtake";
import { CORNER_CAMERA_SECONDS } from "@shared/tv-corner-camera";
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
 *  2. It is built ONCE. The camera never goes back to its first shot and a
 *     transfer moves the cars where they stand rather than rebuilding the
 *     scene, because a wall that visibly restarts reads as broken.
 *  3. If the scene cannot start, or the driver drops the context, it falls
 *     back to the top three as text and stops trying. A black rectangle on
 *     the wall all day is worse than no rectangle.
 */
/**
 * How long the camera's reel is before it would come round again: four and a
 * half minutes, the forty-five six-second shots in shared/tv-corner-camera.ts.
 * The SCENE has no length — it runs until the page does.
 */
export const CORNER_RACE_SECONDS = CORNER_CAMERA_SECONDS;

/** What mountRaceScene hands back: tear it down, or move it on in place. */
type RaceSceneHandle = (() => void) & { update: (next: RaceDriver[]) => boolean };

export function CornerRace({ people, reduced, paused = false }: {
  people: RankRow[];
  reduced: boolean;
  /** The full-screen race has the wall: give up the context until it is done. */
  paused?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Bumped ONLY when the roster itself changes shape. Nothing else rebuilds
  // the scene any more: not the clock, not a transfer, not a poll.
  const [mount, setMount] = useState(0);
  const scene = useRef<RaceSceneHandle | null>(null);
  const drivers = useMemo(() => raceGrid(people), [people]);
  const latest = useRef(drivers);
  latest.current = drivers;
  // Who is out there, versus what they are on. A new name needs a new scene;
  // a new transfer does not.
  const roster = useMemo(() => drivers.map((d) => d.id).join("|"), [drivers]);
  const grid = useMemo(
    () => drivers.map((d) => `${d.id}:${d.transfersToday}`).join("|"),
    [drivers],
  );
  const top = drivers.slice(0, 3);

  useEffect(() => {
    // NOT gated on `paused`. Tearing the scene down every time a moment cut
    // in — a transfer, a new lead, the hourly race — restarted the three
    // minutes from zero, so the corner never got past its opening shots and
    // read as a twenty-second loop (owner, 16 Sep 2026: "the shot is still
    // 20 seconds"). The full-screen race covers the whole wall while it
    // plays, so the corner is not visible under it anyway.
    if (failed || !people.length) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void preloadFieldRace().then(({ mountRaceScene }) => {
      if (cancelled || !host.current) return;
      try {
        cleanup = mountRaceScene(host.current, {
          drivers: latest.current, before: null, reduced,
          // It never ends. The camera has a four-and-a-half-minute reel of
          // trailing shots to work through (shared/tv-corner-camera.ts) and
          // the cars lap underneath it all day, so nobody in the room ever
          // sees the picture start over (Ethan, 16 Sep 2026: "enough views to
          // run for 3 minutes without refreshing or going back to the
          // beginning").
          runSeconds: Infinity,
          // One car, close up, with its name shown now and then rather than a
          // nameplate on every car at once — twelve labels on a panel this
          // size was unreadable (Ethan, 16 Sep 2026). The camera works down
          // the running order every half-minute, so over a morning the corner
          // gets to the whole floor.
          spotlight: true,
          // Written straight to the node rather than through state: it ticks
          // five times a second for twelve seconds and nothing renders off
          // it. It is how anyone can tell from the page itself whether the
          // corner is animating or just showing a dead last frame.
          onProgress: (elapsed) => { if (host.current) host.current.dataset.raceElapsed = elapsed.toFixed(1); },
          onFailure: () => { if (!cancelled) setFailed(true); },
        });
      } catch { if (!cancelled) setFailed(true); return; }
      scene.current = cleanup as RaceSceneHandle;
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; scene.current = null; cleanup?.(); };
    // `roster` is the dependency, not `drivers` and not `grid`: a rebuild is
    // for a new NAME on the board. A changed score is handled below without
    // touching the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, reduced, mount, failed]);

  // A transfer lands: move the cars to their new places on the road they are
  // already driving. Only a roster that gained or lost somebody falls through
  // to a rebuild, and that IS a new race rather than a flicker.
  useEffect(() => {
    if (!scene.current) return;
    if (!scene.current.update(latest.current)) setMount((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid]);

  // `paused` no longer unmounts the scene; it only dims the panel while the
  // full-screen race owns the wall.
  const leader = drivers[0];
  const second = drivers.find((d) => d.rank > 1);
  const margin = leader && second ? leader.transfersToday - second.transfersToday : 0;
  return (
    <section
      className={`ml-auto flex w-[38vw] shrink-0 items-stretch gap-3 overflow-hidden rounded-xl border border-white/15 bg-[#0d1b26]${paused ? " opacity-0" : ""}`}
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
