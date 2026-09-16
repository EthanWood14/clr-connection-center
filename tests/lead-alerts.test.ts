import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeLeadAlerts, collectLeadAlerts, leadAlertStorageKey, parseSeenLeadAlerts, renewAssignedLeadAlerts, leadAlertIsActionable, LEAD_ALERT_CHIME_INTERVAL_MS, LEAD_ALERT_SNOOZE_MS, LEAD_ALERT_MAX_AGE_MS, LEAD_ALERT_SEEN_LIMIT, type LoLeadFeed } from "../client/src/lib/lead-alerts";

const now = Date.parse("2026-09-13T18:00:00Z");
const feed = (ids = ["1"], at = now - 30_000): LoLeadFeed => ({
  configured: true, stale: false,
  los: [{ lo: { id: 7, name: "Sample LO" }, leads: ids.map(externalId => ({
    externalId, borrowerName: "Sample borrower", state: "CA", source: "Test",
    landedAt: new Date(at).toISOString(),
  })) }],
});
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fresh arrivals show immediately, not three days of history on sign-in", () => {
  assert.equal(collectLeadAlerts(feed(), [], now).alerts.length, 1);
  assert.equal(collectLeadAlerts(feed(["old"], now - LEAD_ALERT_MAX_AGE_MS - 1), [], now).alerts.length, 0);
});

test("arrival history still deduplicates polls; unresolved assigned claims are restored separately", () => {
  const first = collectLeadAlerts(feed(), [], now);
  assert.equal(collectLeadAlerts(feed(), first.seen, now + 20_000).alerts.length, 0);
  const restored = parseSeenLeadAlerts(JSON.stringify(first.seen));
  assert.equal(collectLeadAlerts(feed(), restored, now + 40_000).alerts.length, 0);
  assert.deepEqual(collectLeadAlerts(feed(["1", "2"]), restored, now).alerts.map(row => row.key), ["7:2"]);
});

function pendingFeed(ids = ["1"], deadline = now + 120_000): LoLeadFeed {
  const payload = feed(ids);
  for (const lead of payload.los[0].leads) lead.claim = {
    status: "new", escalateAt: new Date(deadline).toISOString(), claimedBy: null, shotgunLeadId: null,
  };
  return payload;
}

test("seen-but-unclaimed original assignments return on reload without duplicating the queue", () => {
  const payload = pendingFeed();
  const arrived = collectLeadAlerts(payload, [], now);
  assert.deepEqual(collectLeadAlerts(payload, arrived.seen, now).alerts, []);
  const restored = renewAssignedLeadAlerts([], payload, now);
  assert.equal(restored.length, 1, "the server still says this is my open assignment");
  assert.deepEqual(renewAssignedLeadAlerts([...restored, ...restored], payload, now), restored);
});

test("original assignments snooze briefly rather than disappearing permanently", () => {
  const payload = pendingFeed();
  const until = { "7:1": now + LEAD_ALERT_SNOOZE_MS };
  assert.equal(LEAD_ALERT_SNOOZE_MS, 10_000);
  assert.equal(renewAssignedLeadAlerts([], payload, now + 9_999, until).length, 0);
  assert.equal(renewAssignedLeadAlerts([], payload, now + 10_000, until).length, 1);
  assert.equal(renewAssignedLeadAlerts([], payload, now, {}, new Set(["7:1"])).length, 0,
    "an acknowledged server success does not reappear while its invalidation finishes");
});

test("floor cards and legacy untracked arrivals are not repeatedly resurrected", () => {
  const floor = pendingFeed();
  floor.los[0].leads[0].openToFloor = true;
  assert.equal(renewAssignedLeadAlerts([], floor, now).length, 0);
  assert.equal(renewAssignedLeadAlerts([], feed(), now).length, 0);
  const arrived = collectLeadAlerts(floor, [], now).alerts;
  assert.equal(renewAssignedLeadAlerts(arrived, floor, now).length, 1, "a real fresh floor arrival still displays once");
});

test("claimed, expired, stale, unmapped and missing lead cards stop immediately", () => {
  const payload = pendingFeed();
  const cards = renewAssignedLeadAlerts([], payload, now);
  for (const invalid of [{ ...payload, stale: true }, { ...payload, configured: false },
    { ...payload, los: [] }, { ...payload, los: [{ lo: payload.los[0].lo, leads: [] }] },
    pendingFeed(["1"], now), pendingFeed(["1"], now - 1),
  ]) assert.deepEqual(renewAssignedLeadAlerts(cards, invalid, now), []);
  for (const status of ["claimed", "escalated", "escalate_failed"] as const) {
    const settled = pendingFeed();
    settled.los[0].leads[0].claim!.status = status;
    assert.deepEqual(renewAssignedLeadAlerts(cards, settled, now), []);
  }
  assert.equal(leadAlertIsActionable(cards[0], now + 120_000), false, "expiry does not depend on a successful later network poll");
});

test("the server deadline wins over the lead's original creation age", () => {
  const payload = pendingFeed();
  payload.los[0].leads[0].landedAt = new Date(now - 11 * 60_000).toISOString();
  const current = renewAssignedLeadAlerts([], payload, now);
  assert.equal(current.length, 1, "a lead first seen later still gets its actual open server window");
  payload.los[0].leads[0].claim!.escalateAt = "bad";
  assert.deepEqual(renewAssignedLeadAlerts(current, payload, now), []);
});

test("original assignments take priority over floor cards and then sort by deadline", () => {
  const payload = pendingFeed(["early", "later"]);
  payload.los[0].leads[1].claim!.escalateAt = new Date(now + 150_000).toISOString();
  const floor = pendingFeed(["floor"], now + 30_000).los[0];
  floor.leads[0].openToFloor = true;
  payload.los.push(floor);
  const arrivals = collectLeadAlerts(payload, [], now).alerts;
  assert.deepEqual(renewAssignedLeadAlerts(arrivals, payload, now).map(row => row.externalId), ["early", "later", "floor"]);
});

test("original-assignment reminders match Shotgun cadence without auto-accept or focus stealing", () => {
  const popup = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.equal(LEAD_ALERT_CHIME_INTERVAL_MS, 2_500);
  assert.match(popup, /setInterval\(chime, LEAD_ALERT_CHIME_INTERVAL_MS\)/);
  assert.match(popup, /Date\.now\(\) < expiresAt/);
  assert.match(popup, /lead\.openToFloor \? null : setInterval/);
  assert.match(popup, /if \(!eligible \|\| blocked \|\| !lead\) return/);
  assert.match(popup, /Remind me in 10 seconds/);
  assert.match(popup, /renewAssignedLeadAlerts/);
  assert.match(popup, /Your LO has a new lead!/);
  assert.match(popup, /motion-safe:animate-pulse/);
  assert.match(popup, /window\.addEventListener\("pointerdown", unlockAudio\)/);
  assert.match(popup, /window\.removeEventListener\("pointerdown", unlockAudio\)/);
  assert.doesNotMatch(popup, /<Dialog|autoFocus|\.focus\(/);
  assert.equal((popup.match(/claim\.mutate(?:Async)?\(/g) ?? []).length, 2, "only the two explicit buttons claim");
  assert.match(popup, /onClick=\{\(\) => claim\.mutate\(lead\.externalId, \{ onSuccess: dismiss \}\)\}/);
  const callStart = popup.indexOf("const callLead = () => {");
  assert.ok(callStart >= 0);
  const callHandler = popup.slice(callStart, popup.indexOf("  return (", callStart));
  assert.match(callHandler, /claim\.mutateAsync\(lead\.externalId\)/);
  assert.match(popup, /onClick=\{callLead\}/);
  assert.equal((popup.match(/\bcallLead\b/g) ?? []).length, 2,
    "the async claim handler is only declared and bound to its button, never invoked by polling or an effect");
});

test("account or org switches hide the prior queue and reset all in-memory acknowledgements", () => {
  const popup = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.match(popup, /queueIdentity === storageKey && eligible/);
  const reset = popup.slice(popup.indexOf("identity.current = storageKey;"), popup.indexOf("}, [storageKey]);") + 19);
  for (const statement of ["seen.current = [];", "snoozedUntil.current = {};", "resolved.current = new Set();", "setQueue([]);", "setQueueIdentity(storageKey);"]) {
    assert.ok(reset.includes(statement), statement);
  }
  assert.ok(popup.indexOf("identity.current = storageKey;") < popup.indexOf("collectLeadAlerts(feed"));
  assert.match(popup, /if \(identity\.current !== storageKey\) return;/, "a previous account's late response cannot resolve the next account's card");
});

test("a burst yields every returned new lead, without duplicate queue entries", () => {
  assert.equal(collectLeadAlerts(feed(["1", "2", "3", "4", "5"]), [], now).alerts.length, 5);
  assert.equal(collectLeadAlerts(feed(["1", "1"]), [], now).alerts.length, 1);
});

test("failed, stale or unmapped reads never generate or consume arrivals", () => {
  for (const payload of [{ ...feed(), configured: false }, { ...feed(), stale: true }, { ...feed(), los: [{ ...feed().los[0], lo: null }] }]) {
    const result = collectLeadAlerts(payload, [], now);
    assert.deepEqual(result.alerts, []);
    assert.deepEqual(result.seen, []);
  }
  assert.equal(collectLeadAlerts(feed(), [], now).alerts.length, 1, "recovery still alerts");
});

test("bad or future dates and empty IDs are not new leads", () => {
  const payload = feed([""]);
  assert.equal(collectLeadAlerts(payload, [], now).alerts.length, 0);
  payload.los[0].leads[0].externalId = "valid";
  payload.los[0].leads[0].landedAt = "invalid";
  assert.equal(collectLeadAlerts(payload, [], now).alerts.length, 0);
  assert.equal(collectLeadAlerts(feed(["future"], now + 60_000), [], now).alerts.length, 0);
});

test("removing an assignment or aging out removes its pending popup", () => {
  const alerts = collectLeadAlerts(feed(), [], now).alerts;
  assert.equal(activeLeadAlerts(alerts, feed(), now).length, 1);
  assert.deepEqual(activeLeadAlerts(alerts, { ...feed(), los: [] }, now), []);
  assert.deepEqual(activeLeadAlerts(alerts, feed(), now + LEAD_ALERT_MAX_AGE_MS), []);
});

test("the same lead reassigned to another one of my LOs has a separate identity", () => {
  const first = collectLeadAlerts(feed(), [], now);
  const reassigned = feed();
  reassigned.los[0].lo!.id = 8;
  assert.deepEqual(collectLeadAlerts(reassigned, first.seen, now).alerts.map(row => row.key), ["8:1"]);
});

test("storage is bounded, identity scoped, tolerant of corrupt or disabled storage, and PII-free", () => {
  assert.notEqual(leadAlertStorageKey(1, 2), leadAlertStorageKey(1, 3));
  assert.notEqual(leadAlertStorageKey(1, 2), leadAlertStorageKey(2, 2));
  assert.deepEqual(parseSeenLeadAlerts("broken"), []);
  assert.deepEqual(parseSeenLeadAlerts('{"wrong":true}'), []);
  assert.deepEqual(parseSeenLeadAlerts('[null,42,"7:1"]'), ["7:1"]);
  const result = collectLeadAlerts(feed(), Array.from({ length: 600 }, (_, i) => `7:${i}`), now);
  assert.equal(result.seen.length, LEAD_ALERT_SEEN_LIMIT);
  assert.doesNotMatch(JSON.stringify(result.seen), /Sample borrower|Sample LO/);
});

test("both popup types are global, bottom-left, nonmodal and inside the reporting gates", () => {
  const app = read("client/src/App.tsx");
  const dock = read("client/src/components/lead-popup-dock.tsx");
  const shotgun = read("client/src/components/shotgun-offer-alert.tsx");
  assert.match(app, /<LeadPopupDock key=\{`\$\{user.orgId\}:\$\{user.id\}`\}>/);
  assert.ok(app.indexOf("<EodLockGate>") < app.indexOf("<LeadPopupDock"));
  assert.ok(app.indexOf("</LeadPopupDock>") < app.indexOf("</EodLockGate>"));
  assert.match(app, /<AssignedLoLeadAlert \/>/);
  assert.match(dock, /createPortal/);
  assert.match(dock, /fixed bottom-20 left-3/);
  assert.match(dock, /sm:bottom-4 sm:left-4/);
  assert.match(dock, /max-h-.*overflow-y-auto/);
  assert.match(dock, /z-\[45\]/, "blocking dialogs stay above these cards");
  assert.doesNotMatch(shotgun, /<Dialog|DialogContent|autoFocus/, "no overlay or stolen typing focus");
  assert.match(shotgun, /data-testid="shotgun-offer-popup"/);
  assert.match(shotgun, /Date.parse\(lead.offerExpiresAt \?\? ""\) > clockNow/);
  assert.match(shotgun, /serverTime - dataUpdatedAt/);
  assert.match(shotgun, /confirm.mutate\(offered.id\)/);
  assert.match(shotgun, /deny.mutate\(offered.id\)/);
  assert.match(shotgun, /shotgun-deny-error/);
});

test("assigned-LO polling stays private, respects locks, and never mutates lead data", () => {
  const popup = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.match(popup, /user.portal !== "lap" && user.portal !== "lop"/);
  assert.match(popup, /useContext\(DailyReportGateActive\)/);
  assert.match(popup, /useContext\(EodLockGateActive\)/);
  assert.match(popup, /enabled: eligible && !blocked/);
  assert.match(popup, /"popups", user\?\.orgId, user\?\.id/);
  // Five seconds: the server's fan-in makes the poll cheap, and a lead should be on screen in seconds.
  assert.match(popup, /refetchInterval: 5_000/);
  assert.match(popup, /hours=72&per=5/);
  // The only write the card makes is the claim — nothing else mutates from a popup.
  const writes = popup.match(/apiRequest\("(?:POST|PUT|PATCH|DELETE)", "[^"]+"/g) ?? [];
  assert.deepEqual(writes, ['apiRequest("POST", "/api/lo-new-leads/claim"']);
});
