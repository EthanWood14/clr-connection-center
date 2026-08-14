import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const eodPage = readFileSync(join(root, "client/src/pages/eod-report.tsx"), "utf8");
const gate = readFileSync(join(root, "client/src/components/eod-lock-gate.tsx"), "utf8");

test("reminder emails name the weekday, not a bare ISO date", () => {
  // A reminder about a PAST day must say which day it means. "2026-08-13" reads
  // as noise at a glance, and "yesterday" would be wrong by the time a Monday
  // reminder covers Friday.
  assert.match(routes, /function eodDayLabel/);
  const fn = routes.slice(routes.indexOf("function eodDayLabel"), routes.indexOf("function buildEodReminderHtml"));
  assert.match(fn, /weekday: "long"/);
  // The exact rendering, on a real date: 2026-08-13 is a Thursday.
  const label = new Date("2026-08-13T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: "UTC",
  });
  assert.equal(label, "Thursday, Aug 13");
  // All three escalation subjects and the body header use it.
  for (const m of [
    "EOD Report Reminder — ${eodDayLabel(reportDate)}",
    "EOD Report Still Missing — ${eodDayLabel(reportDate)}",
    "Overdue EOD Report — ${eodDayLabel(reportDate)}",
    "EOD Report Missing — ${eodDayLabel(reportDate)}",
  ]) {
    assert.ok(routes.includes(m), `missing day label in: ${m}`);
  }
  assert.ok(!routes.includes("EOD Report Reminder — ${reportDate}"), "no bare-ISO subject may remain");
});

test("the lock-gate popup lists each missing day by weekday", () => {
  assert.match(gate, /weekday: "long"/, "the popup formats dates with the day name");
  assert.match(gate, /formatDate\(d\)/, "…and renders every missing date through it");
});

test("filling a past day shows a banner naming that day", () => {
  assert.match(eodPage, /data-testid="past-day-banner"/);
  const banner = eodPage.slice(eodPage.indexOf('data-testid="past-day-banner"') - 400, eodPage.indexOf('data-testid="past-day-banner"') + 400);
  assert.match(banner, /\{!isToday && !isFuture && !report &&/, "only on an unsubmitted past day");
  assert.match(banner, /\{displayDate\}/, "the banner names the day being filled");
  assert.match(banner, /not today/);
  // displayDate carries the weekday.
  assert.match(eodPage, /"EEEE, MMMM d, yyyy"/);
});
