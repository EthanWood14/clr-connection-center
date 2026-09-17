import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("TV feed enricher attaches raceDayCredits without editing routes.ts", () => {
  const enricher = readFileSync(new URL("../server/tv-day-race-feed.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  assert.match(enricher, /loadDayRaceHourCredits/);
  assert.match(enricher, /raceDayCredits/);
  assert.match(index, /installTvDayRaceFeedEnrichment/);
  assert.match(index, /getRawSqlite/);
  assert.doesNotMatch(routes, /loadDayRaceHourCredits|raceDayCredits/);
});
