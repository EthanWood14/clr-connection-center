import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { haversineMeters, evaluateGeofence, isValidLatLng, DEFAULT_CHECKIN_RADIUS_M } from "../server/geo";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

// A real office and points measured from it.
const OFFICE = { lat: 33.6846, lng: -117.8265 };

test("distances are real metres", () => {
  assert.equal(Math.round(haversineMeters(OFFICE.lat, OFFICE.lng, OFFICE.lat, OFFICE.lng)), 0);
  // ~0.001 degrees of latitude is ~111m.
  const d = haversineMeters(OFFICE.lat, OFFICE.lng, OFFICE.lat + 0.001, OFFICE.lng);
  assert.ok(d > 105 && d < 118, `expected ~111m, got ${d}`);
  // A known long distance, to catch a units or radius mistake: LA to NYC.
  const cross = haversineMeters(34.05, -118.24, 40.71, -74.01);
  assert.ok(cross > 3_900_000 && cross < 3_960_000, `expected ~3,940km, got ${cross}`);
});

test("200m is the default radius", () => {
  assert.equal(DEFAULT_CHECKIN_RADIUS_M, 200);
  assert.match(storage, /checkin_geo_radius_m INTEGER NOT NULL DEFAULT 200/);
});

test("inside the fence passes, outside is refused with the distance", () => {
  const near = evaluateGeofence({ ...officeArgs(), lat: OFFICE.lat + 0.0005, lng: OFFICE.lng, accuracyM: 20 });
  assert.equal(near.ok, true);
  assert.ok(near.ok && near.distanceM < 200 && near.inArea === 1);

  const far = evaluateGeofence({ ...officeArgs(), lat: OFFICE.lat + 0.01, lng: OFFICE.lng, accuracyM: 20 });
  assert.equal(far.ok, false);
  assert.ok(!far.ok && far.code === "TOO_FAR");
  assert.match((far as any).error, /1\.1km|km|m from the office/);
  assert.ok(!far.ok && far.inArea === 0);
});

test("a reading too vague to answer the question is refused, not guessed", () => {
  // Accuracy wider than the fence cannot confirm or deny presence. Passing it
  // would make the fence meaningless; failing it silently would punish someone
  // standing in the office with a bad signal. Say so instead.
  const vague = evaluateGeofence({ ...officeArgs(), lat: OFFICE.lat, lng: OFFICE.lng, accuracyM: 5000 });
  assert.equal(vague.ok, false);
  assert.ok(!vague.ok && vague.code === "TOO_IMPRECISE");
  assert.match((vague as any).error, /5000m/);
});

test("a missing or nonsense location is refused distinctly", () => {
  const none = evaluateGeofence({ ...officeArgs(), lat: null, lng: null });
  assert.ok(!none.ok && none.code === "NO_LOCATION");
  // 0,0 is the Atlantic — what a broken client sends.
  assert.equal(isValidLatLng(0, 0), false);
  assert.equal(isValidLatLng(91, 0), false);
  assert.equal(isValidLatLng("abc", 5), false);
  assert.equal(isValidLatLng(33.68, -117.82), true);
  const bad = evaluateGeofence({ ...officeArgs(), lat: 999, lng: 999 });
  assert.ok(!bad.ok && bad.code === "BAD_LOCATION");
});

test("the fence only applies off-network, and only when armed", () => {
  const fn = routes.slice(routes.indexOf("function checkinGeofence"), routes.indexOf('app.post("/api/checkin"'));
  // Armed = mode enforce AND an office location on file. Either missing means
  // the old behaviour, so adding this cannot start refusing anyone.
  assert.match(fn, /cfg\.geoMode === "enforce" && cfg\.officeLat !== null && cfg\.officeLng !== null/);
  assert.match(fn, /if \(!armed \|\| isOfficeNetwork\(req, cfg\)\)/);
  // Turning it on without a location is rejected at the settings boundary.
  assert.match(routes, /Set the office location before turning the distance check on\./);
});

test("office-network membership is independent of the IP enforcement mode", () => {
  // The fence asks "are you at the office?". An admin having IP checking on
  // record-only does not change that answer.
  const fn = routes.slice(routes.indexOf("function isOfficeNetwork"), routes.indexOf("function checkinGeofence"));
  assert.match(fn, /if \(!cfg\.allowedIps\.length\) return true;/, "no allowlist means nothing to be off");
  assert.match(fn, /ipMatchesEntry/);
  assert.ok(!fn.includes("networkMode"), "must not depend on the IP mode");
});

test("only the staff check-in is fenced, and the reading is stored", () => {
  // The external LO/LOA portal check-in must stay unfenced.
  const external = routes.slice(routes.indexOf("SCHEDULE_REQUIRED"), routes.indexOf("SCHEDULE_REQUIRED") + 1500);
  assert.ok(!external.includes("checkinGeofence"), "the external portal must not be fenced");
  assert.match(routes, /lat: geo\.lat, lng: geo\.lng, accuracyM: geo\.accuracyM, distanceM: geo\.distanceM, inArea: geo\.inArea/);
  // 428 tells the client to ask for location and retry; 403 is a real refusal.
  assert.match(routes, /verdict\.code === "NO_LOCATION" \? 428 : 403/);
});

function officeArgs() {
  return { officeLat: OFFICE.lat, officeLng: OFFICE.lng, radiusM: 200 };
}
