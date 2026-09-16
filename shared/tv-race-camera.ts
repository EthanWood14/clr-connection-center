import { raceTrackPoint } from "./tv-race-grid";
import { interpolateRaceTransition, type RaceTransition } from "./tv-race-transition";
import { RACE_BASE_ANGULAR_SPEED } from "./tv-race-labels";

export const RACE_CAMERA_FOV = 46;

const BROADCAST_SHOTS = [
  { id: "grandstand", label: "GRANDSTAND POV", end: 1.6 },
  { id: "launch", label: "OVER THE CARS", end: 4.2 },
  { id: "drone", label: "DRONE SWEEP", end: 6.8 },
  { id: "infield", label: "INTO THE INFIELD", end: 9.5 },
  { id: "grass", label: "GRASS-SIDE", end: 12 },
] as const;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const sceneTime = (elapsed: number) => Number.isFinite(elapsed) ? clamp(elapsed, 0, 12) : 0;
const shotAt = (elapsed: number) => BROADCAST_SHOTS.find(shot => sceneTime(elapsed) < shot.end) ?? BROADCAST_SHOTS[BROADCAST_SHOTS.length - 1];
const smooth = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

// These are waypoints along ONE flight, not camera cuts. Velocity eases at each
// waypoint while angular travel and the live target continue uninterrupted.
const FLIGHT = [
  { time: 0, radius: 69, height: 9.5, azimuth: -.3, fov: 54, roll: 0 },
  { time: 1.6, radius: 65, height: 11, azimuth: -.2, fov: 58, roll: -.025 },
  { time: 3.4, radius: 48, height: 38, azimuth: .06, fov: 64, roll: -.035 },
  { time: 4.2, radius: 43, height: 40, azimuth: .2, fov: 67, roll: -.015 },
  { time: 5.6, radius: 38, height: 42, azimuth: .36, fov: 66, roll: .025 },
  { time: 6.8, radius: 34, height: 36, azimuth: .28, fov: 64, roll: .035 },
  { time: 9.5, radius: 21, height: 2.2, azimuth: -.12, fov: 62, roll: -.012 },
  { time: 12, radius: 16, height: 1.55, azimuth: -.45, fov: 58, roll: 0 },
] as const;

function flightAt(time: number) {
  const next = Math.max(1, FLIGHT.findIndex(point => point.time >= time));
  const a = FLIGHT[next - 1], b = FLIGHT[next];
  const amount = smooth((time - a.time) / (b.time - a.time));
  return {
    radius: mix(a.radius, b.radius, amount), height: mix(a.height, b.height, amount),
    azimuth: mix(a.azimuth, b.azimuth, amount), fov: mix(a.fov, b.fov, amount), roll: mix(a.roll, b.roll, amount),
  };
}

/** Shared by the broadcast HUD; never describes a pass that has not happened. */
export function raceBroadcastShot(elapsed: number, reduced = false): { id: string; label: string } {
  if (reduced) return { id: "trackside", label: "TRACKSIDE VIEW" };
  const { id, label } = shotAt(elapsed);
  return { id, label };
}

/** Keep the scorer AND the actual rivals in the shot throughout the pass. */
export function raceCameraSubjects(plans: RaceTransition[], focusId?: number): RaceTransition[] {
  if (focusId === undefined) return plans;
  const focus = plans.find(row => row.id === focusId) ?? plans[0];
  if (!focus) return [];
  const rivals = new Set([...focus.passedIds, ...focus.tieIds]);
  if (!rivals.size) {
    const nearest = plans.filter(row => row.id !== focus.id)
      .sort((a, b) => Math.abs(a.endDistance - focus.endDistance) - Math.abs(b.endDistance - focus.endDistance))
      .slice(0, 2);
    nearest.forEach(row => rivals.add(row.id));
  }
  return plans.filter(row => row.id === focus.id || rivals.has(row.id));
}

function groupAt(subjects: RaceTransition[], elapsed: number) {
  const poses = subjects.map(row => interpolateRaceTransition(row, elapsed));
  const points = poses.map(pose => raceTrackPoint(-pose.distance / 42, pose.lane));
  const x = points.length ? points.reduce((sum, point) => sum + point.x, 0) / points.length : 42;
  const z = points.reduce((sum, point) => sum + point.z, 0) / Math.max(1, points.length);
  return { x, z, radius: Math.max(8, ...points.map(point => Math.hypot(point.x - x, point.z - z) + 4)) };
}

/** Close phases follow a real local pack; the drone apex can show the full field. */
function localPack(subjects: RaceTransition[]) {
  if (subjects.length <= 5) return subjects;
  const focus = subjects.find(row => row.scored) ?? [...subjects].sort((a, b) => a.startDistance - b.startDistance || a.id - b.id)[0];
  const neighbors = subjects.filter(row => row.id !== focus.id)
    .sort((a, b) => Math.abs(a.endDistance - focus.endDistance) - Math.abs(b.endDistance - focus.endDistance) || a.id - b.id).slice(0, 2);
  // A low-ID tie peer must never displace the actual scorer from their own shot.
  return [focus, ...neighbors];
}

/** Place the opening local pack in front of the real -2.15…-.25rad grandstand. */
export function raceCameraStartAngle(subjects: RaceTransition[]) {
  const pack = groupAt(localPack(subjects), 0);
  return -1.1 - Math.atan2(pack.z, pack.x);
}

/** A constant lens distance avoids zoom pumping as the two cars draw level. */
export function raceCameraRadius(subjects: RaceTransition[]) {
  return Math.max(8, ...Array.from({ length: 41 }, (_, i) => groupAt(subjects, i / 4).radius));
}

export function raceCameraPose(subjects: RaceTransition[], elapsed: number, leadAngle: number, aspect: number, radius = raceCameraRadius(subjects), reduced = false) {
  const time = reduced ? 12 : sceneTime(elapsed);
  const lead = reduced ? raceCameraStartAngle(subjects) + 4.6 * RACE_BASE_ANGULAR_SPEED : (Number.isFinite(leadAngle) ? leadAngle : raceCameraStartAngle(subjects));
  const ratio = Number.isFinite(aspect) && aspect > 0 ? Math.max(.25, aspect) : 16 / 9;
  const pack = groupAt(localPack(subjects), time), field = groupAt(subjects, time);
  const drone = reduced ? 0 : smooth((time - 1.6) / 1.8) * (1 - smooth((time - 6.8) / 2.7));
  const center = { x: mix(pack.x, field.x, drone), z: mix(pack.z, field.z, drone) };
  const cosine = Math.cos(lead), sine = Math.sin(lead);
  const target = { x: center.x * cosine - center.z * sine, y: 1.8, z: center.x * sine + center.z * cosine };
  const flight = reduced ? { radius: 69, height: 10.5, azimuth: -.25, fov: 54, roll: 0 } : flightAt(time);
  const fov = flight.fov + Math.max(0, 1 - ratio) * 12;
  const halfVertical = fov * Math.PI / 360, halfHorizontal = Math.atan(Math.tan(halfVertical) * ratio);
  const framingRadius = mix(pack.radius, Number.isFinite(radius) ? radius : field.radius, drone);
  const droneClearance = framingRadius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.12;
  const height = flight.height + drone * Math.max(0, droneClearance + target.y - flight.height);
  const angle = Math.atan2(pack.z, pack.x) + lead + flight.azimuth;
  return {
    position: { x: Math.cos(angle) * flight.radius, y: height, z: Math.sin(angle) * flight.radius },
    target,
    fov,
    roll: flight.roll,
    shot: raceBroadcastShot(time, reduced),
  };
}

export function raceFocusCaption(plan: RaceTransition | undefined, plans: RaceTransition[], elapsed: number) {
  if (!plan?.scored) return "LIVE RUNNING ORDER";
  const pose = interpolateRaceTransition(plan, elapsed);
  if (pose.progress === 0) return plan.passing ? "WATCH THE MOVE" : "TRANSFER BOOST";
  if (pose.progress === 1) return plan.passedIds.length ? "PASS COMPLETE" : plan.tieIds.length ? "LEVEL ON TRANSFERS" : "TRANSFER ADDED";
  const rivals = plans.filter(row => [...plan.passedIds, ...plan.tieIds].includes(row.id));
  if (rivals.some(row => Math.abs(interpolateRaceTransition(row, elapsed).distance - pose.distance) < 2.5)) return "SIDE BY SIDE";
  if (plan.passedIds.some(id => {
    const rival = plans.find(row => row.id === id);
    return rival && pose.distance < interpolateRaceTransition(rival, elapsed).distance;
  })) return "MOVING AHEAD";
  return plan.passing ? "ON THE ATTACK" : "BUILDING THE PACE";
}
