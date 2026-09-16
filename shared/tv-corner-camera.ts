import { raceTrackPoint } from "./tv-race-grid";

/**
 * The camera for the wall's corner race — a three-minute broadcast of thirty
 * shots, cut rather than glided.
 *
 * Ethan, 16 Sep 2026: "I want it to be 3 minutes, with shots behind the cars,
 * right on top of the cars, at corners not moving, etc." The full-screen race
 * a transfer earns is the opposite brief — ONE unbroken twelve-second flight
 * that must never cut, because it is telling the story of a single pass — so
 * that camera (tv-race-camera.ts) is left alone and this is its own thing.
 *
 * Two families of shot, and the difference is the whole point:
 *
 *   FOLLOW — the camera is placed relative to the car, in track space, so
 *   "behind" really is behind it along the racing line and stays there.
 *   Chase, onboard, overhead, alongside, head-on.
 *
 *   FIXED — the camera is bolted to a place on the circuit and only turns to
 *   watch. The car sweeps through the frame and out of it. This is the "at
 *   corners not moving" shot, and it is what stops three minutes of following
 *   from feeling like one long drone sweep.
 *
 * Pure: every pose is a function of the clock and where the car is, so the
 * whole three minutes can be walked in a test without a canvas.
 *
 * Fixed cameras stay INSIDE the grandstand ring (lane 20 and under). Parked
 * out at the stands themselves, the lens ends up buried in that geometry —
 * and the corner does not clip its scenery away the way the transfer race
 * does, precisely so the stands stay standing (owner, 16 Sep 2026: "why do
 * the grandstands like go away and it look so weird").
 */

export const CORNER_SHOT_SECONDS = 6;

export type CornerShot = {
  id: string;
  label: string;
  /** Where the camera sits. */
  kind: "follow" | "fixed";
  /** FOLLOW: metres of track behind the car (negative is ahead of it). */
  behind?: number;
  /** FOLLOW: metres to the side of the car's lane (+ is outside the bend). */
  beside?: number;
  /** FIXED: the camera's own place on the circuit, as a track angle and lane. */
  angle?: number;
  lane?: number;
  /** Height above the track, both kinds. */
  height: number;
  /** How far ahead of the car the lens looks, in metres of track. */
  lookAhead?: number;
  fov: number;
};

/**
 * Thirty shots. Read down the list and you should be able to see the cut
 * pattern: a couple of following shots, then something fixed, then something
 * overhead, so no two neighbours look alike.
 */
export const CORNER_SHOTS: CornerShot[] = [
  { id: "chase", label: "CHASE", kind: "follow", behind: 11, height: 3.2, lookAhead: 6, fov: 52 },
  { id: "chase-wide", label: "CHASE WIDE", kind: "follow", behind: 19, height: 6.5, lookAhead: 8, fov: 56 },
  { id: "apex-still", label: "APEX CAM", kind: "fixed", angle: .35, lane: -13, height: 2.4, fov: 44 },
  { id: "roof", label: "ROOF CAM", kind: "follow", behind: 3.2, height: 2.1, lookAhead: 14, fov: 62 },
  { id: "overhead", label: "OVERHEAD", kind: "follow", behind: 1.5, height: 15, lookAhead: 2, fov: 50 },
  { id: "outside-still", label: "OUTSIDE LINE", kind: "fixed", angle: .95, lane: 16, height: 3.6, fov: 42 },
  { id: "alongside", label: "ALONGSIDE", kind: "follow", behind: 0, beside: 9, height: 2.2, lookAhead: 3, fov: 54 },
  { id: "head-on", label: "HEAD ON", kind: "follow", behind: -13, height: 2.6, lookAhead: -4, fov: 48 },
  { id: "infield-still", label: "INFIELD", kind: "fixed", angle: 1.5, lane: -18, height: 5.5, fov: 40 },
  { id: "low-chase", label: "LOW CHASE", kind: "follow", behind: 8, height: 1.35, lookAhead: 5, fov: 58 },
  { id: "drone", label: "DRONE", kind: "follow", behind: 14, height: 26, lookAhead: 6, fov: 58 },
  { id: "grass-still", label: "GRASS LEVEL", kind: "fixed", angle: 2.1, lane: -9, height: 1.15, fov: 46 },
  { id: "inside-shoulder", label: "INSIDE SHOULDER", kind: "follow", behind: 4, beside: -7, height: 2, lookAhead: 6, fov: 56 },
  { id: "top-down", label: "TOP DOWN", kind: "follow", behind: .4, height: 34, lookAhead: 0, fov: 46 },
  { id: "banking-still", label: "BANKING", kind: "fixed", angle: 2.7, lane: 16, height: 4.2, fov: 44 },
  { id: "chase-tight", label: "TIGHT CHASE", kind: "follow", behind: 6.5, height: 2.4, lookAhead: 4, fov: 50 },
  { id: "wing", label: "WING MIRROR", kind: "follow", behind: 1.2, beside: 4.5, height: 1.5, lookAhead: 9, fov: 60 },
  { id: "far-still", label: "FAR SIDE", kind: "fixed", angle: -1.1, lane: 19, height: 7, fov: 38 },
  { id: "high-chase", label: "HIGH CHASE", kind: "follow", behind: 17, height: 11, lookAhead: 7, fov: 54 },
  { id: "tunnel", label: "TRACK LEVEL", kind: "fixed", angle: -.4, lane: -6, height: .95, fov: 50 },
  { id: "overhead-lead", label: "OVERHEAD LEAD", kind: "follow", behind: -4, height: 17, lookAhead: -2, fov: 52 },
  { id: "sweep", label: "SWEEP", kind: "follow", behind: 22, beside: 8, height: 8.5, lookAhead: 10, fov: 58 },
  { id: "pit-still", label: "PIT WALL", kind: "fixed", angle: .05, lane: 17, height: 3, fov: 46 },
  { id: "nose", label: "NOSE CAM", kind: "follow", behind: -2.4, height: 1.25, lookAhead: -6, fov: 64 },
  { id: "crest-still", label: "THE CREST", kind: "fixed", angle: 1.85, lane: 13, height: 6.5, fov: 42 },
  { id: "shoulder", label: "OVER THE SHOULDER", kind: "follow", behind: 2.6, beside: -3.2, height: 2.8, lookAhead: 11, fov: 58 },
  { id: "bird", label: "BIRD'S EYE", kind: "follow", behind: 6, height: 44, lookAhead: 4, fov: 48 },
  { id: "kerb-still", label: "KERBSIDE", kind: "fixed", angle: -2, lane: -11, height: 1.05, fov: 52 },
  { id: "long-chase", label: "LONG CHASE", kind: "follow", behind: 27, height: 4.5, lookAhead: 12, fov: 50 },
  { id: "grandstand-still", label: "GRANDSTAND", kind: "fixed", angle: -2.6, lane: 20, height: 8, fov: 40 },
];

/**
 * How many shots the camera stays with one car before moving to the next.
 *
 * Five, so the driver changes every half-minute and a three-minute
 * broadcast works through six of them. Following the leader the whole way
 * was both dull and unfair to everyone else on the board (owner, 16 Sep
 * 2026: "don't have it for first place always, mix it up").
 */
export const CORNER_FOCUS_SHOTS = 5;

/**
 * Which car the corner is following, as an index into the running order.
 * `offset` lets each run start somewhere different, so the wall does not
 * open on P1 every three minutes.
 */
export function cornerFocusIndex(elapsed: number, drivers: number, offset = 0) {
  if (!Number.isFinite(drivers) || drivers <= 0) return 0;
  const { index } = cornerShotAt(elapsed);
  return (Math.floor(index / CORNER_FOCUS_SHOTS) + Math.max(0, Math.floor(offset))) % drivers;
}

/** Three minutes of it, and then the running order has moved on anyway. */
export const CORNER_CAMERA_SECONDS = CORNER_SHOTS.length * CORNER_SHOT_SECONDS;

/** Which shot is up, and how far through it we are (0-1). */
export function cornerShotAt(elapsed: number) {
  const time = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const index = Math.floor(time / CORNER_SHOT_SECONDS) % CORNER_SHOTS.length;
  return { shot: CORNER_SHOTS[index], index, progress: (time % CORNER_SHOT_SECONDS) / CORNER_SHOT_SECONDS };
}

export type CornerCarPose = { angle: number; lane: number };

/**
 * Where to put the lens, given the clock and the car being followed.
 *
 * `angle` is the car's position round the circuit in radians and `lane` its
 * offset from the racing line — the same pair raceTrackPoint takes, so a
 * camera placed "eleven metres behind" is eleven metres behind ALONG THE
 * TRACK rather than eleven metres back in a straight line through the infield.
 */
export function cornerCameraPose(elapsed: number, car: CornerCarPose) {
  const { shot, progress } = cornerShotAt(elapsed);
  // A little drift inside every shot, so even a fixed camera breathes and a
  // follow shot is not frozen relative to the car for six whole seconds.
  const drift = Math.sin(progress * Math.PI) * 1.6;

  const position = shot.kind === "fixed"
    ? (() => {
        const point = raceTrackPoint(shot.angle ?? 0, shot.lane ?? 0);
        return { x: point.x, y: point.y + shot.height, z: point.z };
      })()
    : (() => {
        const back = (shot.behind ?? 0) / 42;
        const point = raceTrackPoint(car.angle - back, car.lane + (shot.beside ?? 0));
        return { x: point.x, y: point.y + shot.height + drift * .12, z: point.z };
      })();

  const aheadPoint = raceTrackPoint(car.angle + (shot.lookAhead ?? 0) / 42, car.lane);
  const target = { x: aheadPoint.x, y: aheadPoint.y + 1.1, z: aheadPoint.z };
  return { position, target, fov: shot.fov, roll: 0, shot: { id: shot.id, label: shot.label } };
}
