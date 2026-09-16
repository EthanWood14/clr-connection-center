import { interpolateRaceTransition, type RaceTransition } from "./tv-race-transition";

export const RACE_DYNAMICS_LIMITS = {
  steering: .3, yawOffset: .085, roll: .055, pitch: .032, heave: .024,
} as const;

export interface RaceDynamics {
  /** Front-wheel heading, in radians. The base bend is left-handed. */
  steering: number;
  /** Visual heading only. Never feed this back into track position. */
  yawOffset: number;
  /** Chassis-local suspension loading; wheel contact points remain unchanged. */
  roll: number;
  pitch: number;
  heave: number;
  /** Wheel spin around local X, derived from actual forward travel. */
  wheelAngle: number;
}

const ZERO: RaceDynamics = { steering: 0, yawOffset: 0, roll: 0, pitch: 0, heave: 0, wheelAngle: 0 };
const clamp = (number: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, number));
const finite = (number: number, fallback = 0) => Number.isFinite(number) ? number : fallback;
const bounded = (number: number, limit: number) => clamp(finite(number), -limit, limit) || 0;

/**
 * Restrained articulation, not a second race simulation. The exact transition
 * remains the sole authority for longitudinal distance and lane. `speed` is
 * the scene's base angular speed (radians/second), constant for this clip.
 * Deterministic finite differences give steering and loading to actual lane
 * changes/acceleration; no random swerves or additional passes are introduced.
 */
export function sampleRaceDynamics({ transition, elapsed, driverId, speed, reduced = false }: {
  transition: RaceTransition; elapsed: number; driverId: number; speed: number; reduced?: boolean;
}): RaceDynamics {
  if (reduced) return { ...ZERO };
  const time = clamp(finite(elapsed), 0, 3600);
  const angularSpeed = clamp(finite(speed), 0, 3);
  const plan: RaceTransition = {
    ...transition,
    startDistance: bounded(transition.startDistance, 100000), endDistance: bounded(transition.endDistance, 100000),
    startLane: bounded(transition.startLane, 9.2), endLane: bounded(transition.endLane, 9.2), maneuverLane: bounded(transition.maneuverLane, 9.2),
  };
  const dt = .04;
  const earlier = interpolateRaceTransition(plan, time - dt);
  const pose = interpolateRaceTransition(plan, time);
  const later = interpolateRaceTransition(plan, time + dt);
  const laneVelocity = (later.lane - earlier.lane) / (2 * dt);
  const laneAcceleration = (later.lane - 2 * pose.lane + earlier.lane) / (dt * dt);
  const distanceVelocity = (later.distance - earlier.distance) / (2 * dt);
  const forwardAcceleration = -(later.distance - 2 * pose.distance + earlier.distance) / (dt * dt);
  const radius = 42 + pose.lane;
  const forwardSpeed = Math.max(0, angularSpeed * radius - distanceVelocity * radius / 42);
  const moving = clamp(forwardSpeed / 8, 0, 1);
  const heading = Math.atan2(laneVelocity, Math.max(8, forwardSpeed));
  const turnLoad = forwardSpeed * forwardSpeed / radius;
  // Absolute travel keeps wheel phase independent of frame rate and camera cuts.
  // The score-derived distance gain is the same one the renderer already uses.
  const travel = angularSpeed * 42 * time + Math.max(0, plan.startDistance - pose.distance);
  const phase = (Math.abs(finite(driverId)) % 997) * .1731;
  const roadFeel = (Math.sin(travel * .5 + phase) * .005 + Math.sin(travel * .21 + phase * .7) * .003) * moving;
  return {
    steering: bounded((-Math.atan2(3.02, radius) + heading * 1.4) * moving, RACE_DYNAMICS_LIMITS.steering),
    yawOffset: bounded(heading * moving, RACE_DYNAMICS_LIMITS.yawOffset),
    roll: bounded((-turnLoad * .0017 - laneAcceleration * .0012) * moving, RACE_DYNAMICS_LIMITS.roll),
    pitch: bounded(-forwardAcceleration * .0024 * moving, RACE_DYNAMICS_LIMITS.pitch),
    heave: bounded(roadFeel - Math.min(.009, turnLoad * .00045) * moving, RACE_DYNAMICS_LIMITS.heave),
    wheelAngle: -(travel / .43) % (Math.PI * 2) || 0,
  };
}
