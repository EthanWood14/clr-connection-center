import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeLeadAlerts, collectLeadAlerts, leadAlertStorageKey, parseSeenLeadAlerts, LEAD_ALERT_MAX_AGE_MS, LEAD_ALERT_SEEN_LIMIT, type LoLeadFeed } from "../client/src/lib/lead-alerts";

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

test("polling, dismissing, route changes and reloads do not replay an arrival", () => {
  const first = collectLeadAlerts(feed(), [], now);
  assert.equal(collectLeadAlerts(feed(), first.seen, now + 20_000).alerts.length, 0);
  const restored = parseSeenLeadAlerts(JSON.stringify(first.seen));
  assert.equal(collectLeadAlerts(feed(), restored, now + 40_000).alerts.length, 0);
  assert.deepEqual(collectLeadAlerts(feed(["1", "2"]), restored, now).alerts.map(row => row.key), ["7:2"]);
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
  assert.doesNotMatch(popup, /apiRequest\("(?:POST|PUT|PATCH|DELETE)"/);
});
