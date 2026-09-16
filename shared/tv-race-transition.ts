import { raceGrid } from "./tv-race-grid";
import type { RankRow } from "./tv-overtake";

/** Distances are raceGrid's trailing distance: smaller means farther ahead. */
export interface RaceTransition {
  id: number;
  startDistance: number;
  endDistance: number;
  startLane: number;
  endLane: number;
  /** A verified positive score delta, not a correction or a new appearance. */
  scored: boolean;
  /** Includes catching a tie; consult passedIds for strictly completed passes. */
  passing: boolean;
  passedIds: number[];
  tieIds: number[];
  /** The lateral corridor occupied while accelerating, before rejoining. */
  maneuverLane: number;
}

export interface RaceTransitionPose {
  distance: number;
  lane: number;
  /** Overall maneuver progress, clamped to [0, 1]. */
  progress: number;
  /** True only during a genuine passing/catching maneuver, not at its endpoints. */
  passing: boolean;
}

export const RACE_TRANSITION_START = 2;
export const RACE_TRANSITION_END = 7;

/** Use the corrected visual baseline, never uncorrected historical totals. */
export function raceTransitionStartRank(driver: RaceTransition | undefined, plans: RaceTransition[]): number | undefined {
  return driver?.scored ? 1 + plans.filter(other => other.startDistance < driver.startDistance - 1e-6).length : undefined;
}

function uniqueRows(rows: RankRow[]): RankRow[] {
  const seen = new Set<number>();
  return rows.filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/**
 * Plan one poll-to-poll race in the next grid's stable order. Never mutate input.
 *
 * Callers MUST clear prev on a business-day change: RankRow deliberately carries
 * no date, so a mixed rollover is otherwise indistinguishable from corrections.
 * A first load, changed roster, missing history, and an obvious all-score reset
 * stay still. A newcomer has no prior on-track position: showing a concurrent
 * scoring move could otherwise invent a visual pass against that new driver.
 *
 * Corrections are applied before the animated baseline is built.
 * Only known drivers whose own credit increased earn a move or a passing flag.
 * Unchanged cars can still shift to accommodate genuine scoring and tie lanes;
 * that formation adjustment is not credited as an overtake. One common distance
 * offset keeps the before/after grids in the same moving frame, so breaking a
 * first-place tie makes the scorer accelerate rather than merely dropping rivals.
 * End coordinates always equal raceGrid(next), including fractional-credit ties.
 */
export function planRaceTransition(prev: RankRow[] | null, next: RankRow[], focusId?: number): RaceTransition[] {
  const current = uniqueRows(next);
  const finalGrid = raceGrid(current);
  const previous = new Map(uniqueRows(prev ?? []).map(row => [row.id, row]));
  const sameRoster = previous.size === current.length && current.every(row => previous.has(row.id));
  const sharedScorers = current.filter(row => (previous.get(row.id)?.transfersToday ?? 0) > 0);
  const obviousReset = sharedScorers.length > 0 && sharedScorers.every(row => row.transfersToday === 0);
  const canAnimate = previous.size > 0 && sameRoster && !obviousReset;
  const increases = new Set(current.filter(row => {
    const before = previous.get(row.id);
    return canAnimate && before && row.transfersToday > before.transfersToday;
  }).map(row => row.id));

  // Only positive credit changes within the same roster are replayed. A
  // corrected-down driver starts at the corrected score, not an earned pass.
  const baseline = current.map(row => ({
    ...row,
    transfersToday: increases.has(row.id) ? previous.get(row.id)!.transfersToday : row.transfersToday,
  }));
  const baselineById = new Map(baseline.map(row => [row.id, row]));
  const initialById = new Map(raceGrid(baseline).map(row => [row.id, row]));
  const offset = Math.max(0, ...finalGrid.map(row => row.distance - initialById.get(row.id)!.distance));

  const plans = finalGrid.map(row => {
    const start = initialById.get(row.id)!;
    const before = baselineById.get(row.id)!;
    const passedIds: number[] = [], tieIds: number[] = [];
    if (increases.has(row.id)) {
      for (const other of finalGrid) {
        if (other.id === row.id || !previous.has(other.id)) continue;
        const otherBefore = baselineById.get(other.id)!;
        if (before.transfersToday <= otherBefore.transfersToday && row.transfersToday > other.transfersToday) {
          passedIds.push(other.id);
        } else if (before.transfersToday < otherBefore.transfersToday && row.transfersToday === other.transfersToday) {
          tieIds.push(other.id);
        }
      }
    }
    return {
      id: row.id,
      startDistance: start.distance + offset,
      endDistance: row.distance,
      startLane: start.lane,
      endLane: row.lane,
      scored: increases.has(row.id),
      passing: passedIds.length > 0 || tieIds.length > 0,
      passedIds,
      tieIds,
      maneuverLane: row.lane,
    };
  });

  // Reserve distinct corridors for concurrent scorers. The focus can choose
  // first, but it cannot manufacture an increase or alter anyone's race order.
  const passers = plans.filter(row => row.passing).sort((a, b) =>
    Number(b.id === focusId) - Number(a.id === focusId) || a.id - b.id);
  const reserved: number[] = [];
  for (const passer of passers) {
    const opponents = plans.filter(row => passer.passedIds.includes(row.id) || passer.tieIds.includes(row.id));
    const occupied = [...opponents.flatMap(row => [row.startLane, row.endLane]), ...reserved];
    // A car catching a tie rejoins at the same forward distance as its peers.
    // Stay on its final side of every tied peer instead of cutting across a
    // neighbor's body during the final lateral move.
    const tiedPeers = plans.filter(row => row.id !== passer.id && row.endDistance === passer.endDistance);
    const candidates = [-9.2, -6.4, -3.2, 0, 3.2, 6.4, 9.2, passer.endLane].filter(lane =>
      tiedPeers.every(peer => (lane - peer.endLane) * (passer.endLane - peer.endLane) > 0));
    const quality = (lane: number) => Math.min(...occupied.map(other => Math.abs(other - lane)))
      - Math.abs(lane - passer.startLane) * .035;
    passer.maneuverLane = candidates.reduce((best, lane) => quality(lane) > quality(best) ? lane : best);
    reserved.push(passer.maneuverLane);
  }
  return plans;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (start: number, end: number, amount: number) => start + (end - start) * amount;

/**
 * Sample with scene elapsed seconds (not milliseconds). Hold the before pose
 * through 2s, pull out, accelerate past/catch rivals, then rejoin by exactly 7s.
 * Every car uses the same longitudinal curve so only earned relative-order
 * changes can cross; catching a tie never overshoots into a fabricated pass.
 * A reduced-motion renderer should sample at RACE_TRANSITION_END or later.
 */
export function interpolateRaceTransition(driver: RaceTransition, elapsedSeconds: number): RaceTransitionPose {
  const progress = clamp((elapsedSeconds - RACE_TRANSITION_START) / (RACE_TRANSITION_END - RACE_TRANSITION_START));
  if (progress === 0) return { distance: driver.startDistance, lane: driver.startLane, progress, passing: false };
  if (progress === 1) return { distance: driver.endDistance, lane: driver.endLane, progress, passing: false };
  const forward = smooth((progress - .2) / .6);
  let lane: number;
  if (!driver.passing) lane = mix(driver.startLane, driver.endLane, smooth(progress));
  else if (progress < .2) lane = mix(driver.startLane, driver.maneuverLane, smooth(progress / .2));
  else if (progress <= .8) lane = driver.maneuverLane;
  else lane = mix(driver.maneuverLane, driver.endLane, smooth((progress - .8) / .2));
  return { distance: mix(driver.startDistance, driver.endDistance, forward), lane, progress, passing: driver.passing };
}
