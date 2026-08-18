import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/state-lookup.tsx"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("literal routes are declared before the :id that would swallow them", () => {
  // This shipped broken: the route existed, the tests asserted it existed, and
  // it still 404'd — Express matches in registration order, so declared after
  // /api/loan-officers/:id the path was read as an id, parsed as NaN and lost.
  // Every LO's workload column sat at 0. Asserting presence is not asserting
  // reachability.
  const idAt = routes.indexOf('app.get("/api/loan-officers/:id"');
  const countsAt = routes.indexOf('app.get("/api/loan-officers/transfer-counts"');
  assert.ok(countsAt > 0 && idAt > 0, "both routes must exist");
  assert.ok(countsAt < idAt, "transfer-counts must be registered BEFORE :id");
  // Same rule for every other literal segment under this prefix.
  for (const literal of ["performance-summary", "snoozed"]) {
    const at = routes.indexOf(`app.get("/api/loan-officers/${literal}"`);
    if (at > 0) assert.ok(at < idAt, `${literal} must precede :id`);
  }
});

test("transfer counts are served to both portals", () => {
  // State Lookup is the same page in C3 and LAP, and the LAP confinement guard
  // only lets /lap/* through — so the endpoint has to exist on both paths or it
  // silently 403s for every LOA.
  assert.match(routes, /app\.get\("\/api\/loan-officers\/transfer-counts"/);
  assert.match(routes, /app\.get\("\/api\/lap\/loan-officers\/transfer-counts"/);
  assert.match(page, /isLapPortal\s*\n?\s*\?\s*"\/api\/lap\/loan-officers\/transfer-counts"/);
});

test("counts are scoped, transfers only, and cover three windows", () => {
  // Anchored forward from the helper to whatever follows it — the route it used
  // to be sliced against now sits ABOVE it, which made this range run backwards
  // and silently match nothing.
  const from = routes.indexOf("function loTransferCounts");
  const fn = routes.slice(from, routes.indexOf("app.get(", from));
  assert.ok(fn.length > 0, "helper slice must not be empty");
  assert.match(fn, /outcome_type = 'transfer'/, "appointments and fell-throughs are not transfers");
  assert.match(fn, /org_id = \?/, "must not count another org's work");
  assert.match(fn, /lo_id IS NOT NULL/);
  for (const w of ["-30 day", "-7 day"]) assert.ok(fn.includes(w), `missing window ${w}`);
  assert.match(fn, /GROUP BY lo_id/);
  // One payload, three windows — switching must not cost a request.
  assert.match(fn, /d7:/); assert.match(fn, /d30:/); assert.match(fn, /allTime:/);
});

test("the state panel leads with the least-loaded LO", () => {
  // The whole point of the view, so it is the default order.
  assert.match(page, /useState<"fewest" \| "tier">\("fewest"\)/);
  assert.match(page, /transfersFor\(a\.id\) - transfersFor\(b\.id\)/);
  // Ties fall back to tier so the list does not reshuffle between renders.
  assert.match(page, /\|\| \(\(a\.priorityTier \?\? 99\) - \(b\.priorityTier \?\? 99\)\)/);
  // The number is shown, not just implied by position.
  assert.match(page, /data-testid=\{`lo-transfers-\$\{lo\.id\}`\}/);
  assert.match(page, /transfersFor\(lo\.id\) === fewestInState/, "the lightest-loaded LO is marked");
});

test("an LO with no transfers reads as zero, not as missing", () => {
  // A brand new LO has no row in the counts map at all; that must render as 0
  // and sort to the top, which is exactly who a CLR is looking for.
  assert.match(page, /transferCounts\[String\(loId\)\]\?\.\[countWindow\] \?\? 0/);
});
