import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("../server/storage.ts", import.meta.url), "utf8");

test("CallTools call identity de-duplicates paired call and disposition events", () => {
  const events = [
    { externalEventId: "call-event-1", callId: "call-1" },
    { externalEventId: "outcome-event-1", callId: "call-1" },
    { externalEventId: "legacy-history-2", callId: null },
  ];
  assert.equal(new Set(events.map((event) => event.callId || event.externalEventId)).size, 2);
});

test("manager history adds CallTools calls to every calls surface", () => {
  assert.match(storage, /ALTER TABLE callsync_activity_events ADD COLUMN call_id TEXT/);
  assert.match(routes, /COUNT\(DISTINCT COALESCE\(NULLIF\(call_id,''\), external_event_id\)\) AS calls/);
  assert.match(routes, /calls: \(callsByDate\.get\(d\) \?\? 0\) \+ \(leadvaultCallTools\.get\(d\) \?\? callToolsByDate\.get\(d\)\?\.calls \?\? 0\)/);
  assert.match(routes, /bucket\.calls\[idx\] \+= Number\(r\.calls\) \|\| 0/);
  assert.match(routes, /callsHmMap\[key\] = \(callsHmMap\[key\] \?\? 0\) \+ \(Number\(r\.calls\) \|\| 0\)/);
});

test("CallSync keeps the provider call id when historical events are replayed", () => {
  assert.match(routes, /\(org_id, external_event_id, call_id, assistant_id, activity_date/);
  assert.match(routes, /call_id=COALESCE\(excluded\.call_id, callsync_activity_events\.call_id\)/);
});

test("CallTools active time accumulates across session counter resets", () => {
  const observations = [6_000, 8_400, 6_000];
  const total = observations.reduce((state, raw) => ({
    total: state.total + (raw >= state.last ? raw - state.last : raw),
    last: raw,
  }), { total: 0, last: 0 }).total;
  assert.equal(total, 14_400, "1h40 + 40m + reset 1h40 should total 4h");
});

test("active-time dashboards use cumulative daily observations", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS callsync_agent_activity_daily/);
  assert.match(storage, /LAG\(active_seconds, 1, 0\) OVER/);
  assert.match(storage, /ELSE raw_seconds END\) AS accumulated_seconds/);
  assert.match(storage, /ON CONFLICT\(org_id, assistant_id, activity_date\) DO NOTHING/);
  assert.match(routes, /ELSE callsync_agent_activity_daily\.active_seconds \+ excluded\.last_observed_seconds/);
  assert.match(routes, /FROM callsync_agent_activity_daily WHERE/);
});
