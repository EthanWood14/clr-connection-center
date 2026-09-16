import { raceTrackPoint } from "./tv-race-grid";
import { interpolateRaceTransition, type RaceTransition } from "./tv-race-transition";

export const RACE_CAMERA_FOV = 46;

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
  const center = groupAt(subjects, elapsed);
  const cosine = Math.cos(leadAngle), sine = Math.sin(leadAngle);
  const x = center.x * cosine - center.z * sine;
  const z = center.x * sine + center.z * cosine;
  const angle = Math.atan2(z, x);
  const halfVertical = RACE_CAMERA_FOV * Math.PI / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(.25, aspect));
  const distance = Math.max(30, radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.18);
  // Elevated spectator view outside the bend. The whole camera tracks at car
  // speed: scenery flies past, but the relative overtake remains easy to read.
  const radial = distance * .855, tangent = distance * .16;
  return {
    position: { x: x + Math.cos(angle) * radial - Math.sin(angle) * tangent, y: 1.3 + distance * .493, z: z + Math.sin(angle) * radial + Math.cos(angle) * tangent },
    target: { x, y: 1.3, z },
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
