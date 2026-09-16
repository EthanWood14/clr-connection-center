import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACE_RAMP_DAYS, PACE_TODAY_WEIGHT, completedAverage, mondayOf, weekLabel, weeklyPace,
} from "../shared/weekly-pace";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * Transfers per CLR per DAY WORKED, for the office TV. Ethan's rules, in the
 * order he gave them on 15-16 Sep 2026: past their first two weeks; count the
 * people who have gone quiet for the weeks they were here; "someone shouldn't
 * count for a week if they only worked a day — count by days"; and this week
 * counts today as half a day.
 */

const TODAY = "2026-09-16"; // a Wednesday
const MON = "2026-09-14";

test("weeks run Monday to Friday and are labelled for the wall", () => {
  assert.equal(mondayOf(TODAY), MON);
  assert.equal(mondayOf(MON), MON);
  assert.equal(mondayOf("2026-09-20"), MON, "Sunday belongs to the week it ends");
  assert.equal(weekLabel(MON), "Sep 14");
});

test("the denominator is days worked, so a one-day week is one day and not five", () => {
  const days = [
    // Ana: three days. Ben: one day. Both past their ramp.
    { userId: 1, date: "2026-09-14" }, { userId: 1, date: "2026-09-15" }, { userId: 1, date: "2026-09-16" },
    { userId: 2, date: "2026-09-14" },
    { userId: 1, date: "2026-06-01" }, { userId: 2, date: "2026-06-01" },
  ];
  const credits = [
    { userId: 1, date: "2026-09-14", credit: 6 },
    { userId: 1, date: "2026-09-15", credit: 4 },
    { userId: 2, date: "2026-09-14", credit: 2 },
  ];
  const [week] = weeklyPace({ days, credits, today: TODAY, weeks: 1 });
  // Ana 1 + 1 + half of today = 2.5; Ben 1. Three and a half days, not ten.
  assert.equal(week.clrDays, 3.5);
  assert.equal(week.clrs, 2);
  assert.equal(week.transfers, 12);
  assert.equal(week.perClrPerDay, Math.round((12 / 3.5) * 100) / 100);
  assert.equal(week.partial, true);
  assert.equal(PACE_TODAY_WEIGHT, 0.5);
});

test("somebody in their first two weeks is not counted, and nor is their work", () => {
  const days = [
    { userId: 1, date: "2026-06-01" }, { userId: 1, date: MON },
    // Started last Thursday: still inside the ramp this week.
    { userId: 9, date: "2026-09-10" }, { userId: 9, date: MON },
  ];
  const credits = [{ userId: 1, date: MON, credit: 3 }, { userId: 9, date: MON, credit: 5 }];
  const [week] = weeklyPace({ days, credits, today: TODAY, weeks: 1 });
  assert.equal(PACE_RAMP_DAYS, 14);
  assert.equal(week.clrs, 1, "only the rostered CLR counts");
  assert.equal(week.transfers, 3, "the new starter's transfers are not in the average either");
});

test("a week somebody did not work leaves them out of it entirely", () => {
  const days = [
    { userId: 1, date: "2026-06-01" }, { userId: 2, date: "2026-06-01" },
    { userId: 1, date: "2026-09-07" }, { userId: 1, date: "2026-09-08" },
    // User 2 worked nothing that week.
  ];
  const credits = [{ userId: 1, date: "2026-09-07", credit: 8 }];
  const weeks = weeklyPace({ days, credits, today: TODAY, weeks: 2 });
  const prior = weeks[0];
  assert.equal(prior.weekStart, "2026-09-07");
  assert.equal(prior.clrs, 1);
  assert.equal(prior.clrDays, 2);
  assert.equal(prior.perClrPerDay, 4);
  assert.equal(prior.partial, false);
  // Weekend work does not create a day.
  const withSunday = weeklyPace({
    days: [...days, { userId: 2, date: "2026-09-13" }], credits, today: TODAY, weeks: 2,
  })[0];
  assert.equal(withSunday.clrDays, 2, "Saturday and Sunday are not the week's shape");
});

test("the headline average uses completed weeks only", () => {
  const weeks = [
    { weekStart: "a", label: "a", clrs: 1, clrDays: 5, transfers: 20, perClrPerDay: 4, partial: false },
    { weekStart: "b", label: "b", clrs: 1, clrDays: 5, transfers: 25, perClrPerDay: 5, partial: false },
    { weekStart: "c", label: "c", clrs: 1, clrDays: 1, transfers: 1, perClrPerDay: 1, partial: true },
  ];
  assert.equal(completedAverage(weeks), 4.5, "the part week cannot drag the average down");
  assert.equal(completedAverage([]), null);
});

test("the wall gets the pace page, fed by its own section on the TV endpoint", () => {
  const routes = read("server/routes.ts");
  const section = routes.slice(routes.indexOf('section("weeklyPace"'), routes.indexOf('section("loSplit"'));
  assert.match(section, /weeklyPace\(\{/);
  assert.match(section, /COALESCE\(exclude_from_stats,0\)=0/, "Elleine and the system accounts stay out");
  assert.doesNotMatch(section, /is_active=1/, "somebody who has left still counts for the weeks they worked");
  assert.match(section, /FROM dialpad_sms_events WHERE org_id=\? AND user_id IS NOT NULL/);
  assert.match(section, /completedAverage\(weeks\)/);
  const tv = read("client/src/pages/tv.tsx");
  assert.match(tv, /\{ id: "weeklyPace",\s+dwellMs: 14_000 \}/);
  assert.match(tv, /weeks=\{board\?\.weeklyPace\?\.weeks \?\? \[\]\}/);
  const pages = read("client/src/components/tv/pages.tsx");
  assert.match(pages, /data-testid="tv-page-weekly-pace"/);
  assert.match(pages, /data-testid="tv-pace-columns"/);
  assert.match(pages, /Days actually worked, not headcount\. Today counts as half a day\./);
  assert.match(pages, /w\.partial \? GOLD_BAR : COOL_BAR/, "the week in progress is marked, not left looking like a collapse");
});
