import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eodIsOverdue, nextBusinessDay, EOD_DUE_LABEL } from "../server/business-day";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const TZ = "America/Los_Angeles";
// PDT is UTC-7, so 16:00 PT === 23:00Z the same day.
const pt = (iso: string, hour: number) =>
  new Date(Date.UTC(...(iso.split("-").map(Number) as [number, number, number]).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number], hour + 7, 0, 0));

test("the deadline is 4pm on the next business day", () => {
  assert.equal(nextBusinessDay("2026-08-26"), "2026-08-27");
  // Wed's report: on time all through Thursday morning and right up to 4pm.
  assert.equal(eodIsOverdue("2026-08-26", TZ, pt("2026-08-27", 15)), false);
  // 4:00pm Thursday exactly — the deadline has arrived.
  assert.equal(eodIsOverdue("2026-08-26", TZ, pt("2026-08-27", 16)), true);
  assert.equal(eodIsOverdue("2026-08-26", TZ, pt("2026-08-28", 9)), true);
  assert.equal(EOD_DUE_LABEL, "4:00 PM the next business day");
});

test("filing earlier can never score worse than filing later", () => {
  // The bug this rule replaced: 4:31pm on the day itself was 'late' while the
  // NEXT afternoon was 'on time', punishing whoever filed sooner. Walk the
  // clock forward and assert lateness only ever goes false -> true.
  const moments = [
    pt("2026-08-26", 9), pt("2026-08-26", 16), pt("2026-08-26", 17),
    pt("2026-08-26", 22), pt("2026-08-27", 7), pt("2026-08-27", 15),
    pt("2026-08-27", 16), pt("2026-08-28", 9),
  ];
  const flags = moments.map((m) => eodIsOverdue("2026-08-26", TZ, m));
  assert.deepEqual(flags, [false, false, false, false, false, false, true, true]);
  for (let i = 1; i < flags.length; i++) {
    assert.ok(!(flags[i - 1] === true && flags[i] === false), "lateness must never un-trip");
  }
});

test("the weekend is not a filing day", () => {
  // Friday's report is due 4pm Monday, so filing Monday morning is on time.
  assert.equal(nextBusinessDay("2026-08-28"), "2026-08-31");
  assert.equal(eodIsOverdue("2026-08-28", TZ, pt("2026-08-31", 9)), false);
  assert.equal(eodIsOverdue("2026-08-28", TZ, pt("2026-08-31", 16)), true);
});

test("today's report is never late, and the gate is what prompts instead", () => {
  assert.equal(eodIsOverdue("2026-08-27", TZ, pt("2026-08-27", 17)), false);
  // Lateness and prompting are deliberately separate: the lock gate keys off
  // requiredEodWeekdaysInTz, so people are asked the moment the business day
  // rolls over, long before the deadline can pass.
  const gate = routes.slice(routes.indexOf('app.get("/api/auth/eod-lock-status"'), routes.indexOf("Admin-only: Complete System Manual PDF"));
  assert.match(gate, /requiredEodWeekdaysInTz\(timezone, new Date\(\), 3, 10\)/);
  assert.ok(!gate.includes("eodIsOverdue"), "the prompt must not wait for the lateness deadline");
});

test("historical lateness is re-stamped once per rule change", () => {
  const m = storage.slice(
    storage.indexOf("Re-stamp historical EOD lateness"),
    storage.indexOf("EOD late re-stamp failed"),
  );
  assert.ok(m.length > 0, "the re-stamp migration must exist");
  assert.match(m, /migrations_applied WHERE name = 'eod_late_restamp_v2'/);
  assert.ok(m.indexOf("if (!done)") < m.indexOf("UPDATE eod_reports SET submitted_late"),
    "the rewrite must sit inside the run-once guard");
  assert.match(m, /eodIsOverdue\(String\(row\.report_date\), String\(row\.tz\), filedAt\)/);
  assert.match(m, /replace\(" ", "T"\)\}Z/);
  assert.match(m, /skipped \+= 1; continue;/);
});
