import { raceTrackPoint } from "./tv-race-grid";

/**
 * The camera for the wall's corner race — a long reel of trailing shots that
 * runs all day and never goes back to the beginning while anyone is watching.
 *
 * Ethan, 16 Sep 2026: "have all the camera have a trailing view, and have
 * enough views to run for 3 minutes without refreshing or going back to the
 * beginning." Both halves of that matter:
 *
 *   TRAILING — every shot in this list sits BEHIND the car, in track space, so
 *   "eleven metres back" is eleven metres back ALONG THE RACING LINE rather
 *   than eleven metres through the infield. The earlier mix of bolted-down
 *   corner cameras is gone; what varies now is how far back, how high, how far
 *   to the side and how tight the lens is, from a gearbox camera two metres
 *   off the diffuser to a helicopter fifty metres up.
 *
 *   ENOUGH OF THEM — forty-five shots of six seconds is four and a half
 *   minutes, so a three-minute stretch of wall time never reaches the end of
 *   the reel, let alone loops it. The scene itself no longer restarts either
 *   (corner-race.tsx), so the cars lap continuously and the camera simply
 *   keeps cutting.
 *
 * The full-screen race a transfer earns is the opposite brief — ONE unbroken
 * eighteen-second flight that must never cut, because it is telling the story
 * of a single pass — so that camera (tv-race-camera.ts) is left alone and this
 * is its own thing.
 *
 * Pure: every pose is a function of the clock and where the car is, so the
 * whole reel can be walked in a test without a canvas.
 */

export const CORNER_SHOT_SECONDS = 6;

export type CornerShot = {
  id: string;
  label: string;
  /** Metres of track behind the car. Always positive: every shot trails. */
  behind: number;
  /** Metres to the side of the car's lane (+ is the outside of the bend). */
  beside?: number;
  /** Height above the track. */
  height: number;
  /** How far ahead of the car the lens looks, in metres of track. */
  lookAhead: number;
  fov: number;
};

/**
 * Forty-five shots. Read down the list and you should see the cut pattern: a
 * tight one, then a high one, then something out to the side, so no two
 * neighbours look alike even though every one of them is following.
 */
export const CORNER_SHOTS: CornerShot[] = [
  { id: "chase", label: "CHASE", behind: 11, height: 3.2, lookAhead: 6, fov: 52 },
  { id: "chase-wide", label: "CHASE WIDE", behind: 19, height: 6.5, lookAhead: 8, fov: 56 },
  { id: "roof", label: "ROOF CAM", behind: 3.2, height: 2.1, lookAhead: 14, fov: 62 },
  { id: "overhead", label: "OVERHEAD", behind: 1.5, height: 15, lookAhead: 2, fov: 50 },
  { id: "low-chase", label: "LOW CHASE", behind: 8, height: 1.35, lookAhead: 5, fov: 58 },
  { id: "chase-tight", label: "TIGHT CHASE", behind: 6.5, height: 2.4, lookAhead: 4, fov: 50 },
  { id: "drone", label: "DRONE", behind: 14, height: 26, lookAhead: 6, fov: 58 },
  { id: "high-chase", label: "HIGH CHASE", behind: 17, height: 11, lookAhead: 7, fov: 54 },
  { id: "shoulder", label: "OVER THE SHOULDER", behind: 2.6, beside: -3.2, height: 2.8, lookAhead: 11, fov: 58 },
  { id: "wing", label: "WING MIRROR", behind: 1.2, beside: 4.5, height: 1.5, lookAhead: 9, fov: 60 },
  { id: "alongside", label: "ALONGSIDE", behind: 2.5, beside: 9, height: 2.2, lookAhead: 3, fov: 54 },
  { id: "inside-shoulder", label: "INSIDE SHOULDER", behind: 4, beside: -7, height: 2, lookAhead: 6, fov: 56 },
  { id: "top-down", label: "TOP DOWN", behind: .4, height: 34, lookAhead: 0, fov: 46 },
  { id: "bird", label: "BIRDS EYE", behind: 6, height: 44, lookAhead: 4, fov: 48 },
  { id: "long-chase", label: "LONG CHASE", behind: 27, height: 4.5, lookAhead: 12, fov: 50 },
  { id: "sweep", label: "SWEEP", behind: 22, beside: 8, height: 8.5, lookAhead: 10, fov: 58 },
  { id: "gearbox", label: "GEARBOX CAM", behind: 4.8, height: 1.1, lookAhead: 3, fov: 55 },
  { id: "kerb-trail", label: "KERBSIDE", behind: 9, beside: -8, height: 1.05, lookAhead: 6, fov: 52 },
  { id: "outside-trail", label: "OUTSIDE LINE", behind: 12, beside: 11, height: 3.6, lookAhead: 7, fov: 46 },
  { id: "rear-wing", label: "REAR WING", behind: 2.2, height: 2.9, lookAhead: 7, fov: 64 },
  { id: "tow", label: "THE TOW", behind: 30, height: 5.5, lookAhead: 14, fov: 44 },
  { id: "helicopter", label: "HELICOPTER", behind: 10, height: 38, lookAhead: 8, fov: 52 },
  { id: "banking-trail", label: "BANKING", behind: 13, beside: 10, height: 4.2, lookAhead: 8, fov: 48 },
  { id: "low-wide", label: "LOW AND WIDE", behind: 16, beside: -6, height: 1.6, lookAhead: 8, fov: 56 },
  { id: "mast", label: "MAST CAM", behind: 7, height: 20, lookAhead: 5, fov: 44 },
  { id: "pursuit", label: "PURSUIT", behind: 5.5, beside: 2.6, height: 2.2, lookAhead: 5, fov: 58 },
  { id: "slipstream", label: "SLIPSTREAM", behind: 3.6, height: 1.7, lookAhead: 6, fov: 60 },
  { id: "overhead-close", label: "CLOSE OVERHEAD", behind: 2.2, height: 9, lookAhead: 3, fov: 54 },
  { id: "crane", label: "CRANE", behind: 20, height: 16, lookAhead: 9, fov: 50 },
  { id: "hip", label: "HIP LEVEL", behind: 3, beside: -5, height: 1.4, lookAhead: 5, fov: 62 },
  { id: "trail-far", label: "LONG LENS", behind: 34, height: 7.5, lookAhead: 16, fov: 42 },
  { id: "roofline", label: "ROOFLINE", behind: 2.8, beside: 3.4, height: 2.6, lookAhead: 8, fov: 57 },
  { id: "diffuser", label: "DIFFUSER", behind: 2, height: .95, lookAhead: 4, fov: 66 },
  { id: "drift", label: "DRIFT", behind: 9.5, beside: 6.5, height: 2.8, lookAhead: 6, fov: 53 },
  { id: "tower", label: "TOWER", behind: 12, height: 30, lookAhead: 7, fov: 46 },
  { id: "half-second", label: "HALF A SECOND BACK", behind: 6, beside: -2.2, height: 3.4, lookAhead: 5, fov: 51 },
  { id: "gantry", label: "GANTRY", behind: 4.2, height: 12, lookAhead: 4, fov: 49 },
  { id: "outside-high", label: "OUTSIDE HIGH", behind: 18, beside: 13, height: 9, lookAhead: 10, fov: 45 },
  { id: "skid", label: "SKID LEVEL", behind: 7.5, height: 1.2, lookAhead: 7, fov: 59 },
  { id: "blimp", label: "BLIMP", behind: 8, height: 52, lookAhead: 6, fov: 44 },
  { id: "trail-low-wide", label: "WIDE AND LOW", behind: 24, beside: -10, height: 2.4, lookAhead: 12, fov: 47 },
  { id: "shoulder-high", label: "HIGH SHOULDER", behind: 5, beside: -4, height: 6, lookAhead: 6, fov: 52 },
  { id: "backmarker", label: "BACKMARKER", behind: 26, beside: 4, height: 3.2, lookAhead: 11, fov: 49 },
  { id: "nose-trail", label: "NOSE TRAIL", behind: 2.6, height: 1.6, lookAhead: 9, fov: 63 },
  { id: "last-lap", label: "LAST LAP", behind: 15, height: 8, lookAhead: 9, fov: 51 },
];

/**
 * How many shots the camera stays with one car before moving to the next.
 *
 * Five, so the driver changes every half-minute and a three-minute stretch
 * works through six of them. Following the leader the whole way was both dull
 * and unfair to everyone else on the board (owner, 16 Sep 2026: "don't have it
 * for first place always, mix it up").
 */
export const CORNER_FOCUS_SHOTS = 5;

/**
 * Which car the corner is following, as an index into the running order.
 * `offset` lets a board start somewhere different, so the wall does not always
 * open on P1.
 */
export function cornerFocusIndex(elapsed: number, drivers: number, offset = 0) {
  if (!Number.isFinite(drivers) || drivers <= 0) return 0;
  const { index } = cornerShotAt(elapsed);
  return (Math.floor(index / CORNER_FOCUS_SHOTS) + Math.max(0, Math.floor(offset))) % drivers;
}

/** Four and a half minutes of it — comfortably longer than anyone watches. */
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
 * offset from the racing line — the same pair raceTrackPoint takes.
 *
 * `leading` turns the shot round. There is nothing in front of the car in
 * first, so pointing a trailing camera forwards at it shows empty road; the
 * lens swings to the same distance up the track instead and looks BACK down
 * it, which puts the leader in the foreground and everybody chasing them
 * behind (owner, 16 Sep 2026: "when someone's in first, have the trail camera
 * look backwards"). Same shot list, same distances, reversed.
 */
export function cornerCameraPose(elapsed: number, car: CornerCarPose, leading = false) {
  const { shot, progress } = cornerShotAt(elapsed);
  // A little drift inside every shot, so the lens breathes rather than being
  // welded to the car for six whole seconds.
  const drift = Math.sin(progress * Math.PI) * 1.6;
  const back = shot.behind / 42;
  const beside = shot.beside ?? 0;

  // Behind the car — or, for the leader, the same distance ahead of it.
  const lens = raceTrackPoint(leading ? car.angle + back : car.angle - back, car.lane + (leading ? -beside : beside));
  const position = { x: lens.x, y: lens.y + shot.height + drift * .12, z: lens.z };

  // Forwards past the car, or back down the road at whoever is chasing it.
  const aim = leading
    ? car.angle - (back + Math.max(6, shot.lookAhead) / 42)
    : car.angle + shot.lookAhead / 42;
  const aimPoint = raceTrackPoint(aim, car.lane);
  const target = { x: aimPoint.x, y: aimPoint.y + 1.1, z: aimPoint.z };
  return { position, target, fov: shot.fov, roll: 0, shot: { id: shot.id, label: leading ? `${shot.label} REVERSE` : shot.label } };
}
