import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eodIsOverdue, previousBusinessDay } from "../server/business-day";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const TZ = "America/Los_Angeles";
// Noon PT on the given day, so the 4pm deadline has not passed.
const noonPt = (iso: string) => new Date(`${iso}T19:00:00Z`);

test("filing yesterday's report the next morning is on time", () => {
  // Wed 2026-08-26 report, filed Thu 2026-08-27 — what nine of twelve CLRs did.
  assert.equal(eodIsOverdue("2026-08-26", TZ, noonPt("2026-08-27")), false);
  // The grace runs to the business-day rollover (7pm PT), not to midnight:
  // at 6pm Thursday it is still on time...
  assert.equal(eodIsOverdue("2026-08-26", TZ, new Date("2026-08-28T01:00:00Z")), false);
  // ...and at 7pm Thursday the business day has already become Friday, which
  // makes Wednesday's report two business days old, so it is late.
  assert.equal(eodIsOverdue("2026-08-26", TZ, new Date("2026-08-28T02:00:00Z")), true);
});

test("the weekend is not a filing day", () => {
  // Friday's report filed Monday is on time; Thursday's is not.
  assert.equal(previousBusinessDay("2026-08-31"), "2026-08-28", "Mon's previous business day is Fri");
  assert.equal(eodIsOverdue("2026-08-28", TZ, noonPt("2026-08-31")), false);
  assert.equal(eodIsOverdue("2026-08-27", TZ, noonPt("2026-08-31")), true);
});

test("genuinely stale reports are still late, and today still has its deadline", () => {
  // Two business days on: late.
  assert.equal(eodIsOverdue("2026-08-25", TZ, noonPt("2026-08-27")), true);
  // Same day before 4pm PT: on time. After: late.
  assert.equal(eodIsOverdue("2026-08-27", TZ, noonPt("2026-08-27")), false);
  assert.equal(eodIsOverdue("2026-08-27", TZ, new Date("2026-08-28T00:00:00Z")), true);
  // A future date is never owed yet.
  assert.equal(eodIsOverdue("2026-08-28", TZ, noonPt("2026-08-27")), false);
});

test("an EOD report emails the CLR who filed it and nobody else", () => {
  const block = routes.slice(
    routes.indexOf("Send the EOD summary email to the CLR who filed it"),
    routes.indexOf("EMPTY REPORTS ARE NOT NEWS"),
  );
  assert.match(block, /const allRecipients = clrEmail \? \[clrEmail\] : \[\];/);
  // The manager CC and everything that fed it must be gone.
  assert.ok(!block.includes("manager_emails"), "managers must not be looked up here any more");
  assert.ok(!routes.includes("isLateSubmission"), "the backdated-CC concept must be gone");
  assert.ok(!block.includes("managerRecipients"));
});

test("historical lateness is re-stamped once, faithfully", () => {
  const m = storage.slice(
    storage.indexOf("Re-stamp historical EOD lateness"),
    storage.indexOf("EOD late re-stamp failed"),
  );
  assert.ok(m.length > 0, "the re-stamp migration must exist");
  // Guarded: rewriting accountability history must never repeat on each boot.
  assert.match(m, /migrations_applied WHERE name = 'eod_late_restamp_v1'/);
  assert.ok(m.indexOf("if (!done)") < m.indexOf("UPDATE eod_reports SET submitted_late"),
    "the rewrite must sit inside the run-once guard");
  // Recomputed per row from the CLR's own timezone and actual filing time —
  // not a blanket clear of the flag.
  assert.match(m, /eodIsOverdue\(String\(row\.report_date\), String\(row\.tz\), filedAt\)/);
  assert.match(m, /COALESCE\(NULLIF\(u\.timezone, ''\), 'America\/Los_Angeles'\)/);
  // submitted_at is SQLite UTC without a zone marker; parsing must say so.
  assert.match(m, /replace\(" ", "T"\)\}Z/);
  // A row with no filing time is skipped, never guessed at.
  assert.match(m, /skipped \+= 1; continue;/);
});
