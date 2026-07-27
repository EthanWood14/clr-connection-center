import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-text assertions, matching the style of admin-bootstrap-auth.test.ts.
// A LAP account is an ordinary `users` row on the same session cookie as C3, so
// the only thing keeping an outside assistant out of C3 is the portal guard.
// These lock down the properties that make that guard real.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

test("portal membership is re-derived from the database on every request", () => {
  const fresh = routes.slice(
    routes.indexOf("function freshSessionFromSignedCookie"),
    routes.indexOf("function requireAuth"),
  );
  assert.match(fresh, /portal:\s*\(user\.portal/,
    "session portal must come from the DB user row, not the cookie payload");
});

test("the portal guard denies by default and runs for every /api route", () => {
  const guard = routes.slice(
    routes.indexOf("// ── Portal confinement"),
    routes.indexOf("// ── Users ───"),
  );
  assert.ok(guard.includes(`app.use("/api"`), "guard must be mounted on all of /api");
  assert.match(guard, /return res\.status\(403\)/,
    "guard must reject anything not explicitly allowed (deny by default)");
  // The allowlist must not hand LAP accounts the routes that leak C3 data.
  for (const forbidden of ["/loan-officers", "/users\"", "/outcomes", "/chat", "/forum", "/bonzo"]) {
    assert.ok(!guard.includes(forbidden),
      `LAP allowlist must not include ${forbidden}`);
  }
});

test("portal cannot be self-assigned through a profile edit", () => {
  const privileged = routes.slice(routes.indexOf("const PRIVILEGED = ["), routes.indexOf("if (!isAdmin) for (const k of PRIVILEGED)"));
  assert.ok(privileged.includes('"portal"'),
    "portal must be a privileged column or a LAP user could edit their way out of the portal");
});

test("creating a LAP account strips C3 privileges", () => {
  const create = routes.slice(routes.indexOf(`app.post("/api/users"`), routes.indexOf(`const newUser = storage.createUser(createData)`));
  assert.match(create, /portal\s*\?\?\s*""\)\.toLowerCase\(\)\s*===\s*"lap"/);
  for (const stripped of ["createData.role", "createData.isClr", "createData.isManager"]) {
    assert.ok(create.includes(stripped), `${stripped} must be forced for LAP accounts`);
  }
});

test("LO credentials are never returned unmasked by the by-id endpoint", () => {
  const byId = routes.slice(
    routes.indexOf(`app.get("/api/loan-officers/:id"`),
    routes.indexOf(`app.post("/api/loan-officers"`),
  );
  assert.ok(!/res\.json\(lo\);/.test(byId), "must not return the raw loan_officers row");
  assert.match(byId, /bonzoPassword:.*"••••••••"/, "bonzo password must be masked");
  assert.match(byId, /leadMailboxPassword:.*"••••••••"/, "mailbox password must be masked");
  assert.match(byId, /otherCredentials:\s*undefined/, "other credentials must be dropped");
});

test("writing loan officers requires a role and records the real actor", () => {
  const writes = routes.slice(
    routes.indexOf(`app.post("/api/loan-officers"`),
    routes.indexOf(`// Copy credential endpoint`),
  );
  assert.equal((writes.match(/requireManagerOrAdmin\(req, res\)/g) ?? []).length, 3,
    "POST, PATCH and DELETE must each carry a role check");
  assert.ok(!writes.includes(`userName: "Ethan Wood"`),
    "audit rows must name the actual acting user, not a hardcoded one");
});

test("LAP document bytes are stored outside the backed-up database", () => {
  assert.match(storage, /ATTACH DATABASE .* AS lapfiles/,
    "blobs must live in a sidecar DB so backup rotation does not multiply them");
  assert.ok(!/data_blob BLOB NOT NULL/.test(storage),
    "the metadata table must no longer declare a blob column");
  assert.match(storage, /INSERT INTO lapfiles\.lap_result_file_blobs/);
  assert.match(storage, /ALTER TABLE lap_result_file_versions DROP COLUMN data_blob/,
    "existing installs must be migrated off the in-DB blob");
});

test("a LAP account is provisioned and onboarded into LAP, not C3", () => {
  // Magic link must not drop a LAP user on C3's root — the portal guard would
  // immediately 403 every call the C3 shell makes.
  const welcome = routes.slice(
    routes.indexOf(`app.get("/api/auth/welcome-login"`),
    routes.indexOf(`app.post("/api/users"`),
  );
  assert.match(welcome, /portal\s*\?\?\s*""\)\s*===\s*"lap"\s*\?\s*"\/#\/lap"/,
    "welcome magic link must land LAP accounts in the portal");

  // Admins need a real control, not a hand-crafted API call.
  const team = readFileSync(join(root, "client/src/components/team-management.tsx"), "utf8");
  assert.match(team, /data-testid="select-account-portal"/, "team management needs an account-type control");
  assert.match(team, /apiRequest\("POST", "\/api\/users", \{[\s\S]*?portal,/, "create must send the chosen portal");
});
