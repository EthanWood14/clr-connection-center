/**
 * Where the browser thinks we are, for a check-in.
 *
 * Check-ins verify presence by connection IP. When someone is NOT on an
 * approved office network the server can instead require proximity to the
 * office (200m by default), and that is the only situation in which this
 * reading is used — the server ignores it entirely on the office network.
 *
 * Resolves to an empty object instead of rejecting. A denied or unavailable
 * permission still reaches the server, which answers with a real explanation,
 * rather than failing silently in the client.
 */
export function checkinPosition(): Promise<{ lat?: number; lng?: number; accuracyM?: number }> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve({});
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { lat?: number; lng?: number; accuracyM?: number }) => {
      if (!settled) { settled = true; resolve(v); }
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
        () => done({}),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    } catch { done({}); }
    // Some browsers call neither callback when the prompt is dismissed.
    setTimeout(() => done({}), 11_000);
  });
}
