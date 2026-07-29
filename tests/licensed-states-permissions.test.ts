import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizeLicensedStates, US_STATE_OPTIONS } from "../shared/licensed-states";

test("licensed state permissions normalize casing, duplicates, order, and D.C.", () => {
  const result = normalizeLicensedStates(["dc", "CA", " ca ", "ny"]);
  assert.deepEqual(result, {
    success: true,
    states: ["CA", "NY", "DC"],
  });
  assert.equal(US_STATE_OPTIONS.length, 51);
});

test("licensed state permissions reject malformed or unknown input", () => {
  assert.deepEqual(normalizeLicensedStates("CA"), {
    success: false,
    error: "States must be provided as a list.",
  });
  const invalid = normalizeLicensedStates(["CA", "XX"]);
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.match(invalid.error, /XX/);
});

test("both portals expose the narrow authenticated state-permissions endpoint", () => {
  const routes = readFileSync(join(process.cwd(), "server/routes.ts"), "utf8");
  assert.match(
    routes,
    /app\.patch\("\/api\/loan-officers\/:id\/licensed-states", requireAuth, updateLicensedStates\)/,
  );
  assert.match(
    routes,
    /app\.patch\("\/api\/lap\/loan-officers\/:id\/licensed-states", requireAuth,/,
  );

  const start = routes.indexOf("function updateLicensedStates");
  const end = routes.indexOf('app.patch("/api/loan-officers/:id/licensed-states"', start);
  assert.ok(start >= 0 && end > start);
  const handler = routes.slice(start, end);
  assert.match(handler, /req\.body\?\.states/);
  assert.match(handler, /licensedStates: JSON\.stringify\(parsed\.states\)/);
  assert.doesNotMatch(handler, /\{\s*\.\.\.req\.body/);
});

test("C3 and LAP profiles both render the shared editor", () => {
  const directory = readFileSync(join(process.cwd(), "client/src/pages/directory.tsx"), "utf8");
  const lapProfiles = readFileSync(join(process.cwd(), "client/src/pages/lap-lo-profiles.tsx"), "utf8");
  assert.match(directory, /<LicensedStatesEditor/);
  assert.match(lapProfiles, /<LicensedStatesEditor/);
  assert.match(lapProfiles, /every signed-in user/);
});
