export interface Point3 { x: number; y: number; z: number }
export interface RaceSceneryClipPlane { normal: Point3; constant: number }

export const RACE_SCENERY_CAR_MARGIN = 5;
const finitePoint = (point: Point3) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Decorative scenery only: discard the camera-facing (negative) half-space.
 * Put the plane behind the farthest car, including its full bodywork, so a
 * grandstand beside the lens cannot hide either the scorer or a farther rival.
 * Three.js accepts this world-space normal/constant directly. Never attach the
 * resulting clipping plane to the track or car materials.
 */
export function raceSceneryClipPlane(camera: Point3, target: Point3, racers: readonly Point3[]): RaceSceneryClipPlane {
  const origin = finitePoint(camera) ? camera : { x: 0, y: 0, z: 0 };
  const aim = finitePoint(target) ? target : origin;
  const delta = { x: aim.x - origin.x, y: aim.y - origin.y, z: aim.z - origin.z };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const normal = length > 1e-9 && Number.isFinite(length)
    ? { x: delta.x / length, y: delta.y / length, z: delta.z / length }
    : { x: 0, y: 0, z: -1 };
  const depthOf = (point: Point3) => dot({ x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z }, normal);
  const depths = racers.filter(finitePoint).map(depthOf).filter(Number.isFinite);
  const fallbackDepth = depthOf(aim);
  const depth = Math.max(0, ...(depths.length ? depths : [Number.isFinite(fallbackDepth) ? fallbackDepth : 0])) + RACE_SCENERY_CAR_MARGIN;
  const constant = -dot(normal, origin) - depth;
  // Defensive finite fallback for malformed/extreme preview coordinates.
  return Number.isFinite(constant) ? { normal, constant } : { normal: { x: 0, y: 0, z: -1 }, constant: -RACE_SCENERY_CAR_MARGIN };
}
