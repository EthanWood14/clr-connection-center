import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeNetworks, type NetworkObservation } from "../server/checkin-networks";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/check-ins.tsx"), "utf8");

const obs = (ip: string | null, over: Partial<NetworkObservation> = {}): NetworkObservation => ({
  ip,
  wasAllowed: null,
  person: null,
  source: "clr",
  at: "2026-09-01T09:00:00.000Z",
  ...over,
});

test("addresses split into the office wifi and everywhere else", () => {
  const out = summarizeNetworks(
    [obs("107.220.82.133"), obs("107.220.82.133"), obs("70.243.203.10")],
    ["107.220.82.133"],
  );
  assert.deepEqual(out.office.map((r) => r.ip), ["107.220.82.133"]);
  assert.deepEqual(out.offNetwork.map((r) => r.ip), ["70.243.203.10"]);
  assert.equal(out.office[0].checkins, 2);
  assert.deepEqual(out.totals, { checkins: 3, office: 2, offNetwork: 1, addresses: 2 });
});

test("the office is decided by the allowlist NOW, not by what was recorded then", () => {
  // Approving an address has to make its history read as office immediately,
  // or the screen contradicts the setting that was just saved.
  const rows = [obs("70.243.203.10", { wasAllowed: 0 }), obs("70.243.203.10", { wasAllowed: 0 })];
  const before = summarizeNetworks(rows, []);
  assert.equal(before.office.length, 0);
  const after = summarizeNetworks(rows, ["70.243.203.10"]);
  assert.equal(after.office.length, 1);
  assert.equal(after.office[0].allowed, true);
});

test("an address whose status has flipped is flagged", () => {
  // Somebody's check-ins now read differently than they did on the day, which
  // is worth surfacing rather than quietly rewriting.
  const flipped = summarizeNetworks([obs("70.243.203.10", { wasAllowed: 1 })], []);
  assert.equal(flipped.offNetwork[0].changed, true);
  // A null flag predates enforcement and claims nothing either way.
  const unknown = summarizeNetworks([obs("70.243.203.10", { wasAllowed: null })], []);
  assert.equal(unknown.offNetwork[0].changed, false);
  const agreeing = summarizeNetworks([obs("70.243.203.10", { wasAllowed: 0 })], []);
  assert.equal(agreeing.offNetwork[0].changed, false);
});

test("a CIDR office covers every address inside it", () => {
  // The reason the allowlist supports prefixes at all: an IPv6 host portion
  // rotates daily, so pinning one full address stops matching within a day.
  const out = summarizeNetworks(
    [obs("2600:1700:1251:1980::5"), obs("2600:1700:1251:1980:abcd::9"), obs("2600:1700:9999::1")],
    ["2600:1700:1251:1980::/64"],
  );
  assert.equal(out.totals.office, 2);
  assert.equal(out.totals.offNetwork, 1);
});

test("both check-in surfaces are counted, and told apart", () => {
  const out = summarizeNetworks(
    [obs("1.2.3.4", { source: "clr" }), obs("1.2.3.4", { source: "external" }), obs("1.2.3.4", { source: "external" })],
    [],
  );
  assert.equal(out.offNetwork[0].checkins, 3);
  assert.equal(out.offNetwork[0].clrCheckins, 1);
  assert.equal(out.offNetwork[0].externalCheckins, 2);
});

test("people are listed once each, and the window is first to last", () => {
  const out = summarizeNetworks([
    obs("1.2.3.4", { person: "Elleine Asuncion", at: "2026-08-01T09:00:00.000Z" }),
    obs("1.2.3.4", { person: "Elleine Asuncion", at: "2026-09-01T09:00:00.000Z" }),
    obs("1.2.3.4", { person: "Aaron", at: "2026-08-15T09:00:00.000Z" }),
    obs("1.2.3.4", { person: null }),
  ], []);
  assert.deepEqual(out.offNetwork[0].people, ["Aaron", "Elleine Asuncion"]);
  assert.equal(out.offNetwork[0].firstSeen, "2026-08-01T09:00:00.000Z");
  assert.equal(out.offNetwork[0].lastSeen, "2026-09-01T09:00:00.000Z");
});

test("a check-in with no address is not a network", () => {
  // A missing IP means recording was off. That is a settings fact, reported
  // separately — not somewhere anyone connected from.
  const out = summarizeNetworks([obs(null), obs(""), obs("1.2.3.4")], []);
  assert.equal(out.totals.addresses, 1);
  assert.equal(out.totals.checkins, 1);
});

test("busiest first, so the address to recognise is at the top", () => {
  const out = summarizeNetworks(
    [obs("1.1.1.1"), obs("2.2.2.2"), obs("2.2.2.2"), obs("2.2.2.2")],
    [],
  );
  assert.deepEqual(out.offNetwork.map((r) => r.ip), ["2.2.2.2", "1.1.1.1"]);
});

test("an approved address nothing has ever come from is called out", () => {
  // Usually a typo, or a network that has since changed. Invisible otherwise.
  const out = summarizeNetworks([obs("1.2.3.4")], ["9.9.9.9", "1.2.3.4"]);
  assert.deepEqual(out.unusedEntries, ["9.9.9.9"]);
});

test("the endpoint is admin-only and reads both tables", () => {
  const route = routes.slice(
    routes.indexOf('app.get("/api/checkin/networks"'),
    routes.indexOf('app.get("/api/checkin/admin"'),
  );
  assert.ok(route.length > 0, "the route must exist");
  // Home IP addresses with names attached — managers get the board, not this.
  assert.match(route, /actor\?\.role === "admin" \|\| actor\?\.superAdmin/);
  assert.match(route, /return res\.status\(403\)/);
  assert.match(route, /FROM morning_checkins/);
  assert.match(route, /FROM external_checkins/);
  assert.match(route, /org_id = \?/, "never crosses orgs");
  // Recording being off is a fact about the settings, and the screen says so.
  assert.match(route, /recording: cfg\.networkMode !== "off"/);
  assert.match(route, /catch \{/, "a missing column must not break the page");
});

test("the page says when nothing is being recorded, and can turn it on", () => {
  // Mode was "off" in production when this was built: 411 historic rows and
  // nothing new. A list that silently stopped updating is worse than no list.
  assert.match(page, /data-testid="networks-recording-off"/);
  assert.match(page, /Not recording/);
  assert.match(page, /networkMode: "record"/);
  // The settings route is POST. A PATCH falls through to the SPA handler,
  // which answers 200 with an HTML page -- the save looks fine and never
  // happens. Caught exactly that way in the browser.
  assert.match(page, /apiRequest\("POST", "\/api\/checkin\/settings"/);
  assert.doesNotMatch(page, /apiRequest\("PATCH", "\/api\/checkin\/settings"/);
  assert.match(routes, /app\.post\("\/api\/checkin\/settings"/);
  // And an unrecognised address can be adopted without hunting for settings.
  assert.match(page, /This is the office/);
  assert.match(page, /allowedIps: \[\.\.\.data\.allowedIps, ip\]/);
  assert.match(page, /\{isAdmin && <NetworksCard \/>\}/);
});

test("the geofence only ever applies off the office network", () => {
  // This is the rule Ethan asked for and it was already the behaviour:
  // checkinGeofence returns un-gated for anyone on an approved address.
  const fence = routes.slice(routes.indexOf("function checkinGeofence"), routes.indexOf("function requestIp"));
  assert.match(fence, /if \(!armed \|\| isOfficeNetwork\(req, cfg\)\)/);
  // And isOfficeNetwork must not depend on the recording mode, or switching
  // recording on or off would silently change who gets fenced.
  const office = routes.slice(routes.indexOf("function isOfficeNetwork"), routes.indexOf("The 200m rule"));
  assert.doesNotMatch(office, /networkMode/);
});

test("the panel states both rules, including the fence", () => {
  // "Is the location check on" had no answer on any screen, and the setting
  // that looked like it turned it off wrote checkin_location_mode, which
  // nothing reads. That is how it ran armed for a week unnoticed.
  assert.match(page, /data-testid="networks-rules"/);
  assert.match(page, /the location check is skipped/);
  // Optional-chained on purpose: during a rolling deploy the page is
  // briefly newer than the server, and reading through a missing object
  // white-screened the entire check-in page rather than dropping a line.
  assert.match(page, /data\.geofence\?\.armed/);
  assert.match(page, /\{data\.geofence && \(/);
  assert.doesNotMatch(page, /data\.geofence\.(armed|radiusM|hasOffice)/);
  assert.match(routes, /geofence: \{/);
  assert.match(routes, /armed: cfg\.geoMode === "enforce" && cfg\.officeLat !== null/);
});

test("nothing reads checkin_location_mode, so nothing should pretend to", () => {
  // Dead column. It exists only as an ALTER in storage.ts; a settings screen
  // that once wrote it is gone. Left in place deliberately (dropping a column
  // in SQLite rewrites the table) but nothing may start reading it again.
  // Naming it in a comment is fine; READING it is not.
  const code = routes.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /checkin_location_mode/);
  assert.doesNotMatch(page, /locationMode/);
  // The live flag is checkin_geo_mode, and that is what the config reads.
  assert.match(routes, /s\?\.checkin_geo_mode === "enforce"/);
});
