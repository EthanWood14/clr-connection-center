import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/state-lookup.tsx"), "utf8");

const fn = routes.slice(routes.indexOf("function loaTransferCounts"), routes.indexOf('app.get("/api/lap/loan-officers/transfer-counts"'));

test("LOA counts use the same three windows as the LO totals", () => {
  assert.ok(fn.length > 0, "the helper must exist");
  // Same window definitions, so the page toggle drives both and the LOA
  // figures can be compared against the LO figure above them.
  for (const w of ["-30 day", "-7 day"]) assert.ok(fn.includes(w), `missing window ${w}`);
  assert.match(fn, /GROUP BY lo_id, loa_id/);
  assert.match(fn, /outcome_type = 'transfer'/);
  assert.match(fn, /org_id = \?/, "never crosses orgs");
});

test("an assistant with no transfers still shows, as a zero", () => {
  // Built from the assistant list, not from the transfer rows — otherwise
  // somebody who took none this week would silently vanish from the card.
  assert.match(fn, /for \(const a of assistants\)/);
  assert.match(fn, /tally\.get\(key\) \?\? \{ d7: 0, d30: 0, allTime: 0 \}/);
});

test("a missing assistants table leaves the section empty rather than failing", () => {
  assert.match(fn, /catch \{/);
});

test("the endpoint returns them alongside the LO counts", () => {
  assert.match(routes, /res\.json\(\{ counts: loTransferCounts\(orgId\), loas: loaTransferCounts\(orgId\) \}\)/);
});

test("the state lookup shows exact counts on the same window it is displaying", () => {
  assert.match(page, /const loasFor = useCallback/);
  assert.match(page, /l\[countWindow\] \?\? 0/, "must follow the page's window toggle");
  // Busiest first — the question is who is carrying the load.
  assert.match(page, /sort\(\(a, b\) => b\.count - a\.count/);
  assert.match(page, /data-testid=\{`loa-counts-\$\{lo\.id\}`\}/);
  assert.match(page, /data-testid="loa-count-row"/);
  // The heading names the window, so a number is never ambiguous.
  assert.match(page, /countWindow === "d7" \? "last 7 days"/);
  // A former assistant is shown but visibly distinguished.
  assert.match(page, /a\.active \? "" : "text-muted-foreground line-through"/);
});
