// Distance helpers for the check-in geofence.
//
// Someone on the office network is presumed to be at the office. Someone who
// is NOT has to prove proximity instead: their browser's coordinates must put
// them within the configured radius (200m by default) of the office.
//
// Kept dependency-free and in its own module so the arithmetic is testable
// without starting the server.

export const DEFAULT_CHECKIN_RADIUS_M = 200;

/** Metres between two WGS-84 points. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_008.8; // mean Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const a = Number(lat), b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b)
    && a >= -90 && a <= 90 && b >= -180 && b <= 180
    // 0,0 is in the Atlantic and is what a broken client sends.
    && !(a === 0 && b === 0);
}

export type GeofenceVerdict =
  | { ok: true; distanceM: number; inArea: 1 }
  | { ok: false; code: "NO_LOCATION" | "BAD_LOCATION" | "TOO_IMPRECISE" | "TOO_FAR"; error: string; distanceM: number | null; inArea: 0 | null };

/**
 * Decide whether a reading puts someone close enough to the office.
 *
 * A fix whose own error bar is wider than the radius cannot answer the
 * question either way, so it is refused as imprecise rather than quietly
 * passed (which would make the fence meaningless) or quietly failed (which
 * would punish someone standing in the office with a poor signal).
 */
export function evaluateGeofence(input: {
  officeLat: number;
  officeLng: number;
  radiusM: number;
  lat: unknown;
  lng: unknown;
  accuracyM?: unknown;
}): GeofenceVerdict {
  if (input.lat == null || input.lng == null) {
    return {
      ok: false, code: "NO_LOCATION", distanceM: null, inArea: null,
      error: "Location is required to check in from outside the office. Allow location access and try again, or check in on the office network.",
    };
  }
  if (!isValidLatLng(input.lat, input.lng)) {
    return {
      ok: false, code: "BAD_LOCATION", distanceM: null, inArea: null,
      error: "That location reading was not usable. Try again, or check in on the office network.",
    };
  }
  const radius = Number(input.radiusM) > 0 ? Number(input.radiusM) : DEFAULT_CHECKIN_RADIUS_M;
  const accuracy = Number(input.accuracyM);
  const distance = Math.round(haversineMeters(input.officeLat, input.officeLng, Number(input.lat), Number(input.lng)));

  if (Number.isFinite(accuracy) && accuracy > radius) {
    return {
      ok: false, code: "TOO_IMPRECISE", distanceM: distance, inArea: 0,
      error: `Your device could only place you to within ${Math.round(accuracy)}m, which is not precise enough to confirm you are at the office. Try again near a window or outdoors.`,
    };
  }
  if (distance > radius) {
    return {
      ok: false, code: "TOO_FAR", distanceM: distance, inArea: 0,
      error: `You appear to be about ${formatDistance(distance)} from the office. Check in within ${radius}m of the office, or on the office network.`,
    };
  }
  return { ok: true, distanceM: distance, inArea: 1 };
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)}m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)}km`;
}
