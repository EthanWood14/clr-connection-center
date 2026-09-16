import { raceTrackPoint } from "./tv-race-grid";
import { interpolateRaceTransition, type RaceTransition } from "./tv-race-transition";
import { RACE_BASE_ANGULAR_SPEED, RACE_SPEED_MULTIPLIER } from "./tv-race-labels";

export const RACE_CAMERA_FOV = 46;

const BROADCAST_SHOTS = [
  { id: "establishing", label: "TRACKSIDE LIVE", start: 0, end: 2.8, height: 10.5, hold: .66, bias: -.07, push: 1.18 },
  { id: "battle", label: "SIDE-BY-SIDE CAMERA", start: 2.8, end: 7.2, height: 9.2, hold: .65, bias: .2, push: 1.08 },
  { id: "exit", label: "CORNER EXIT", start: 7.2, end: 12, height: 9.6, hold: .48, bias: .24, push: 1.12 },
] as const;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const sceneTime = (elapsed: number) => Number.isFinite(elapsed) ? clamp(elapsed, 0, 12) : 0;
const shotAt = (elapsed: number) => BROADCAST_SHOTS.find(shot => sceneTime(elapsed) < shot.end) ?? BROADCAST_SHOTS[BROADCAST_SHOTS.length - 1];

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
  const x = points.reduce((sum, point) => sum + point.x, 0) / Math.max(1, points.length);
  const z = points.reduce((sum, point) => sum + point.z, 0) / Math.max(1, points.length);
  return { x, z, radius: Math.max(8, ...points.map(point => Math.hypot(point.x - x, point.z - z) + 4)) };
}

/** A constant lens distance avoids zoom pumping as the two cars draw level. */
export function raceCameraRadius(subjects: RaceTransition[]) {
  return Math.max(8, ...Array.from({ length: 41 }, (_, i) => groupAt(subjects, i / 4).radius));
}

export function raceCameraPose(subjects: RaceTransition[], elapsed: number, leadAngle: number, aspect: number, radius = raceCameraRadius(subjects)) {
  const time = sceneTime(elapsed), shot = shotAt(time);
  const center = groupAt(subjects, time);
  const cosine = Math.cos(leadAngle), sine = Math.sin(leadAngle);
  const x = center.x * cosine - center.z * sine;
  const z = center.x * sine + center.z * cosine;
  const panorama = subjects.length > 8 || radius > 25 || aspect < .7;
  // Portrait panoramas need a wider lens, not a retreat beyond the far plane.
  const fov = panorama && aspect < .7 ? 58 : RACE_CAMERA_FOV;
  const halfVertical = fov * Math.PI / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(.25, aspect));
  // A panorama follows a flat field: its breadth needs the horizontal lens,
  // not a sphere-sized vertical reserve that shrinks every car into the fog.
  const framingHalf = panorama && aspect >= 1 ? halfHorizontal : Math.min(halfVertical, halfHorizontal);
  const distance = Math.max(30, radius / Math.sin(framingHalf) * 1.18);
  const progress = clamp((time - shot.start) / (shot.end - shot.start), 0, 1);
  const smooth = progress * progress * (3 - 2 * progress);
  const midpoint = panorama ? time : (shot.start + shot.end) / 2;
  const anchor = panorama ? center : groupAt(subjects, midpoint);
  const speed = RACE_BASE_ANGULAR_SPEED * RACE_SPEED_MULTIPLIER;
  // Trackside camera stations move much slower than the field and pan toward
  // it. Cars approach, draw level and leave the lens instead of being frozen
  // by an exactly speed-matched helicopter. All shots stay outside the bend.
  const hold = panorama ? 0 : (midpoint - time) * speed * shot.hold;
  const anchorAngle = Math.atan2(anchor.z, anchor.x) + leadAngle + hold + (panorama ? -.08 : shot.bias);
  const push = panorama ? 1.12 : shot.push - smooth * .055;
  const anchorRadius = Math.hypot(anchor.x, anchor.z) + distance * push;
  let offsetX = Math.cos(anchorAngle) * anchorRadius - x;
  let offsetZ = Math.sin(anchorAngle) * anchorRadius - z;
  const radialLength = Math.hypot(x, z);
  const radialX = radialLength > .001 ? x / radialLength : cosine;
  const radialZ = radialLength > .001 ? z / radialLength : sine;
  // Very spread-out fields can shift the centroid during a shot. Keep the
  // same side of the action and the full framing reserve even in that case.
  const outward = offsetX * radialX + offsetZ * radialZ;
  const correction = Math.max(0, distance * .5 - outward);
  offsetX += radialX * correction; offsetZ += radialZ * correction;
  const length = Math.hypot(offsetX, offsetZ);
  const tangent = -offsetX * radialZ + offsetZ * radialX;
  const perspective = Math.atan2(tangent, offsetX * radialX + offsetZ * radialZ);
  // Retain a readable three-quarter side profile rather than shrinking the
  // cars into head-on dots as they approach a trackside camera station.
  const viewAngle = panorama ? perspective : .08 + .68 * Math.tanh(perspective / .8);
  const framing = clamp(length, distance, distance * push);
  offsetX = (radialX * Math.cos(viewAngle) - radialZ * Math.sin(viewAngle)) * framing;
  offsetZ = (radialZ * Math.cos(viewAngle) + radialX * Math.sin(viewAngle)) * framing;
  const height = panorama ? (radius > 25 ? 18 : 10.5) : shot.height - smooth * .35;
  return {
    position: { x: x + offsetX, y: height, z: z + offsetZ },
    target: { x, y: 1.8, z },
    fov,
    shot: panorama ? { id: "panorama", label: "TRACKSIDE PANORAMA" } : raceBroadcastShot(time),
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
