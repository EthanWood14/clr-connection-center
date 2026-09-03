import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BUSINESS_DAY_DEFAULT_TZ,
  BUSINESS_DAY_ROLLOVER_HOUR as SERVER_ROLLOVER_HOUR,
  businessTodayInTz as serverBusinessToday,
  countWeekdaysInMonth,
  isValidTimezone,
  normalizeTimezone,
  previousWeekdaysFromBusinessDate,
  requiredEodWeekdaysInTz,
} from "../server/business-day";
import {
  BUSINESS_DAY_ROLLOVER_HOUR as CLIENT_ROLLOVER_HOUR,
  businessTodayInTz as clientBusinessToday,
} from "../client/src/lib/business-day";

const PACIFIC = "America/Los_Angeles";

test("server and client stay on the current date until exactly 7pm PDT", () => {
  const formerUtcBug = new Date("2026-07-25T00:00:00.000Z"); // Fri Jul 24, 5:00pm PDT
  const before = new Date("2026-07-25T01:59:59.999Z"); // Fri Jul 24, 6:59:59pm PDT
  const cutoff = new Date("2026-07-25T02:00:00.000Z"); // Fri Jul 24, 7:00pm PDT

  assert.equal(SERVER_ROLLOVER_HOUR, 19);
  assert.equal(CLIENT_ROLLOVER_HOUR, 19);
  assert.equal(serverBusinessToday(PACIFIC, formerUtcBug), "2026-07-24");
  assert.equal(clientBusinessToday(PACIFIC, formerUtcBug), "2026-07-24");
  assert.equal(serverBusinessToday(PACIFIC, before), "2026-07-24");
  assert.equal(clientBusinessToday(PACIFIC, before), "2026-07-24");
  assert.equal(serverBusinessToday(PACIFIC, cutoff), "2026-07-25");
  assert.equal(clientBusinessToday(PACIFIC, cutoff), "2026-07-25");
});

test("the 7pm boundary remains fixed through Pacific standard time", () => {
  const formerUtcBug = new Date("2026-01-10T00:00:00.000Z"); // Fri Jan 9, 4:00pm PST
  const before = new Date("2026-01-10T02:59:59.999Z"); // Fri Jan 9, 6:59:59pm PST
  const cutoff = new Date("2026-01-10T03:00:00.000Z"); // Fri Jan 9, 7:00pm PST

  assert.equal(serverBusinessToday(PACIFIC, formerUtcBug), "2026-01-09");
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, formerUtcBug),
    ["2026-01-08", "2026-01-07", "2026-01-06"],
  );
  assert.equal(serverBusinessToday(PACIFIC, before), "2026-01-09");
  assert.equal(clientBusinessToday(PACIFIC, before), "2026-01-09");
  assert.equal(serverBusinessToday(PACIFIC, cutoff), "2026-01-10");
  assert.equal(clientBusinessToday(PACIFIC, cutoff), "2026-01-10");
});

test("Friday's report becomes required at 7pm and weekends are skipped", () => {
  const formerUtcBug = new Date("2026-07-25T00:00:00.000Z"); // Friday, 5:00pm PDT
  const beforeCutoff = serverBusinessToday(
    PACIFIC,
    new Date("2026-07-25T01:59:59.999Z"),
  );
  const atCutoff = serverBusinessToday(
    PACIFIC,
    new Date("2026-07-25T02:00:00.000Z"),
  );

  assert.deepEqual(
    previousWeekdaysFromBusinessDate(beforeCutoff),
    ["2026-07-23", "2026-07-22", "2026-07-21"],
  );
  assert.deepEqual(
    previousWeekdaysFromBusinessDate(atCutoff),
    ["2026-07-24", "2026-07-23", "2026-07-22"],
  );
  assert.deepEqual(
    previousWeekdaysFromBusinessDate("2026-07-27"),
    ["2026-07-24", "2026-07-23", "2026-07-22"],
  );
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, formerUtcBug),
    ["2026-07-23", "2026-07-22", "2026-07-21"],
  );
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, new Date("2026-07-25T02:00:00.000Z")),
    ["2026-07-24", "2026-07-23", "2026-07-22"],
  );
});

test("the morning activity gate can only ask for a completed workday", () => {
  const routes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server/routes.ts"), "utf8");
  const gate = routes.slice(
    routes.indexOf('app.get("/api/call-logs/check-previous-day"'),
    routes.indexOf('app.get("/api/call-logs"'),
  );
  assert.match(gate, /requiredEodWeekdaysInTz\(timezone, new Date\(\), 1, 7\)\[0\]/);
  assert.doesNotMatch(gate, /businessTodayForRequest/);
  assert.deepEqual(
    requiredEodWeekdaysInTz(PACIFIC, new Date("2026-08-18T15:00:00.000Z"), 1, 7),
    ["2026-08-17"],
    "Tuesday morning must ask for Monday, never Tuesday",
  );
});

test("weekday counting excludes Saturdays and Sundays", () => {
  // August 2026: the 1st is a Saturday, the 31st a Monday. 21 weekdays.
  assert.equal(countWeekdaysInMonth(2026, 8), 21);
  // Through Tue Aug 4 -> Mon 3rd + Tue 4th only; the 1st and 2nd are a weekend.
  assert.equal(countWeekdaysInMonth(2026, 8, 4), 2);
  // Through Sun Aug 2 -> still zero weekdays elapsed.
  assert.equal(countWeekdaysInMonth(2026, 8, 2), 0);

  // February 2026 starts on a Sunday and has 28 days -> exactly 20 weekdays.
  assert.equal(countWeekdaysInMonth(2026, 2), 20);
  // A leap February with a 29th that lands on a Friday counts one more.
  assert.equal(countWeekdaysInMonth(2028, 2), 21);
});

test("weekday counting clamps a day past the end of the month", () => {
  // Asking for the 31st of a 30-day month must not invent a day.
  assert.equal(countWeekdaysInMonth(2026, 9, 31), countWeekdaysInMonth(2026, 9));
  assert.equal(countWeekdaysInMonth(2026, 2, 31), countWeekdaysInMonth(2026, 2));
});

test("the month-end comp estimate paces on weekdays, not calendar days", () => {
  // The MTD email extrapolates each CLR's transfers to month-end. Dividing by
  // elapsed calendar days counted weekends as zero-transfer days, understating
  // every projection; both sides of the ratio must be weekday counts.
  const routes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server/routes.ts"), "utf8");
  const projected = routes.slice(
    routes.indexOf("// Projected mode (Wednesday MTD)"),
    routes.indexOf("Estimate only — not final pay."),
  );
  assert.match(projected, /countWeekdaysInMonth\(ey, em, ed\)/, "elapsed must be weekdays through the report date");
  assert.match(projected, /countWeekdaysInMonth\(ey, em\)/, "the month total must be weekdays too");
  assert.match(projected, /mtd \/ weekdaysElapsed\) \* weekdaysInMonth/, "the ratio must use both weekday counts");
  // \b matters: "weekdaysElapsed" contains "daysElapsed" as a substring.
  assert.ok(!/\bdaysElapsed\b|\bdaysInMonth\b/.test(projected), "no calendar-day pacing may remain");
  assert.match(projected, /Math\.max\(1, countWeekdaysInMonth/, "a weekend-only window must not divide by zero");
});

// A zone name is not a preference, it is an argument to Intl. Every zone-aware
// call in this app - business "today", the EOD window, push quiet hours, a task
// deadline, the recurrence engine - raises a RangeError on a name Intl does not
// know. So there are two questions here, deliberately answered apart: what may
// be WRITTEN, and what a read does with what is already stored.

test("a timezone is checked before it is ever stored", () => {
  assert.equal(isValidTimezone("America/Los_Angeles"), true);
  assert.equal(isValidTimezone("America/New_York"), true);
  assert.equal(isValidTimezone("UTC"), true);
  // Surrounding whitespace is a typo, not a different zone.
  assert.equal(isValidTimezone("  America/Denver  "), true);

  // Legacy spellings Intl still resolves are storable too. The question is
  // whether the value WORKS, not whether tzdata calls it canonical - a zone
  // that formats without throwing cannot hurt any read path downstream.
  assert.equal(isValidTimezone("PST"), true);
  assert.equal(isValidTimezone("US/Pacific"), true);

  // Everything a NOT NULL TEXT column will otherwise happily accept. Each of
  // these is a RangeError at some later, entirely unrelated moment.
  for (const bad of ["", "   ", "Mars/Olympus_Mons", "America/Nowhere", "Pacific Time", "not a zone at all"]) {
    assert.equal(isValidTimezone(bad), false, `${JSON.stringify(bad)} must not be storable`);
  }
  // Not-a-string is not a zone either, null included: the column is NOT NULL
  // with a real default, so a request does not get to say "unset".
  for (const bad of [null, undefined, 0, 1, true, {}, ["America/Denver"]]) {
    assert.equal(isValidTimezone(bad), false, `${String(bad)} must not be storable`);
  }

  // Every zone the app itself offers has to survive its own check. The rule
  // this replaced preferred Intl.supportedValuesOf("timeZone"), which lists
  // canonical names only and so refused "UTC" and "Asia/Kolkata" - two options
  // sitting in that very picker, which 400'd when anybody chose them.
  const settings = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "client/src/pages/settings.tsx"), "utf8");
  const picker = settings.slice(
    settings.indexOf("const TIMEZONE_GROUPS"),
    settings.indexOf("];", settings.indexOf("const TIMEZONE_GROUPS")),
  );
  const offered = [...picker.matchAll(/value: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(offered.length >= 30, "the timezone picker was found and still offers a full list");
  assert.ok(offered.includes("UTC") && offered.includes("Asia/Kolkata"), "including the two that used to be refused");
  for (const zone of offered) {
    assert.equal(isValidTimezone(zone), true, `the picker offers ${zone}, so it must be storable`);
  }
});

test("a timezone already in the database degrades instead of throwing", () => {
  // Checking the write cannot repair rows written before the check existed, and
  // rewriting people's records to cover for a bug is not a migration anyone
  // should run. So every read falls back rather than trusting the column.
  assert.equal(normalizeTimezone("America/New_York"), "America/New_York");
  assert.equal(normalizeTimezone("  America/Denver  "), "America/Denver");
  for (const stored of ["", "   ", "Mars/Olympus_Mons", "America/Nowhere", null, undefined, 7]) {
    assert.throws(() => new Intl.DateTimeFormat("en-US", { timeZone: String(stored) }), RangeError,
      `${String(stored)} is what a bare read could not survive`);
    assert.equal(normalizeTimezone(stored), BUSINESS_DAY_DEFAULT_TZ);
  }
  // A caller may name the zone it falls back TO - the CLR task PATCH keeps the
  // row's own stored zone when the assignee has none worth using.
  assert.equal(normalizeTimezone("", "America/Chicago"), "America/Chicago");
  assert.equal(normalizeTimezone("Mars/Olympus_Mons", "America/Chicago"), "America/Chicago");
  // And the office clock is a zone Intl really does accept, so the fallback of
  // last resort can never itself be the next RangeError.
  assert.equal(isValidTimezone(BUSINESS_DAY_DEFAULT_TZ), true);
});

test("every route that writes users.timezone checks it first", () => {
  const routes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server/routes.ts"), "utf8");

  // PATCH /api/users/:id takes the whole request body. Before this check any
  // signed-in account could store "" or "Mars/Olympus_Mons" on itself, and the
  // RangeError then surfaced somewhere else entirely - a task deadline, the
  // overdue sweep, push quiet hours - long after the request that caused it.
  // This is the source that fed every one of those, so it is stopped at the write.
  const patchUser = routes.slice(
    routes.indexOf('app.patch("/api/users/:id", requireAuth'),
    routes.indexOf('app.patch("/api/users/:id/manager"'),
  );
  assert.match(patchUser, /if \("timezone" in \(rest as any\)\) \{/,
    "the mass-assigned body is asked about timezone at all");
  assert.match(patchUser, /if \(!isValidTimezone\(tz\)\) return res\.status\(400\)/,
    "and an unusable one is refused rather than stored");
  assert.match(patchUser, /\(rest as any\)\.timezone = tz;/, "the trimmed value is what reaches the column");
  // Before the write, not merely somewhere in the same handler.
  assert.ok(patchUser.indexOf("isValidTimezone") < patchUser.indexOf("storage.updateUser(id, rest)"),
    "a check that runs after the update is not a check");

  // The other two doors onto the same column. The profile route has always had
  // this rule; it now states it in the same words instead of its own copy.
  const profile = routes.slice(
    routes.indexOf('app.patch("/api/auth/profile"'),
    routes.indexOf('app.patch("/api/users/me/seen-intro"'),
  );
  assert.match(profile, /if \(!isValidTimezone\(tz\)\) return res\.status\(400\)/);
  assert.doesNotMatch(profile, /supportedValuesOf/, "one rule in one place, not a copy per route");

  // insertUserSchema is generated from the table, so `timezone` is nothing more
  // than TEXT to it: POST /api/users would mint an account with a junk zone.
  const createUser = routes.slice(
    routes.indexOf('app.post("/api/users", async'),
    routes.indexOf("const newUser = storage.createUser(createData);"),
  );
  assert.match(createUser, /if \(!isValidTimezone\(tz\)\) return res\.status\(400\)/);

  // And nothing else writes the column. A hand-built UPDATE would sidestep all
  // three checks above, and the super-admin console builds exactly that shape
  // of statement for users - today over is_active and super_admin only.
  assert.doesNotMatch(routes, /UPDATE users SET[^`]*\btimezone\b/,
    "no raw SQL may set users.timezone");
  const saConsole = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "server/saConsole.ts"), "utf8");
  assert.doesNotMatch(saConsole, /timezone/,
    "the super-admin console must not grow a fourth door onto this column");
});
