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
  assert.match(create, /requestedPortal === "lap" \|\| requestedPortal === "lop"/,
    "both portal types must be recognised at creation");
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
  assert.match(byId, /res\.json\(maskLoCredentials\(lo\)\)/,
    "credentials must be stripped through the shared helper, which handles every key casing");
});

test("writing loan officers requires a role and records the real actor", () => {
  const writes = routes.slice(
    routes.indexOf(`app.post("/api/loan-officers"`),
    routes.indexOf(`// Copy credential endpoint`),
  );
  // Checked per route rather than by counting: a bare count breaks the moment a
  // new loan-officer write is added (it did, when the needs-transfers endpoint
  // landed) and, worse, would still pass if a check moved from one route to
  // another. Each route is asserted on its own body.
  const routeBody = (decl: string, end: string) => {
    const i = routes.indexOf(decl);
    assert.ok(i > 0, `missing route: ${decl}`);
    return routes.slice(i, routes.indexOf(end, i + 1));
  };
  for (const [decl, end] of [
    [`app.post("/api/loan-officers"`, `app.post("/api/loan-officers/:id/needs-transfers"`],
    [`app.post("/api/loan-officers/:id/needs-transfers"`, `app.patch("/api/loan-officers/:id"`],
    [`app.patch("/api/loan-officers/:id"`, `app.post("/api/lead-source-outcomes"`],
    [`app.delete("/api/loan-officers/:id"`, `// Copy credential endpoint`],
  ] as const) {
    assert.match(routeBody(decl, end), /requireManagerOrAdmin\(req, res\)/,
      `${decl} must carry a role check`);
  }
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
  assert.match(welcome, /userPortal === "lap" \|\| userPortal === "lop"/,
    "welcome magic link must land portal accounts in their own portal");
  assert.match(welcome, /`\/#\/\$\{userPortal\}`/, "…and at the matching hash route");

  // Admins need a real control, not a hand-crafted API call.
  const team = readFileSync(join(root, "client/src/components/team-management.tsx"), "utf8");
  assert.match(team, /data-testid="select-account-portal"/, "team management needs an account-type control");
  assert.match(team, /apiRequest\("POST", "\/api\/users", \{[\s\S]*?portal,/, "create must send the chosen portal");
});

test("comp requests and team stats are not reachable from LAP", () => {
  // C3-only features. Leaving the routes mounted meant a LAP user could open
  // pages whose APIs the portal guard already refuses — a dead end, and comp
  // data has no business in an outside assistant's portal.
  const shell = readFileSync(join(root, "client/src/components/lap/lap-shell.tsx"), "utf8");
  const sidebar = readFileSync(join(root, "client/src/components/lap/lap-sidebar.tsx"), "utf8");
  const bell = readFileSync(join(root, "client/src/components/lap/lap-notification-bell.tsx"), "utf8");
  for (const [label, src] of [["shell", shell], ["sidebar", sidebar], ["bell", bell]] as const) {
    assert.ok(!src.includes("/comp-requests"), `LAP ${label} must not route to comp requests`);
    // the LAP-specific /api/lap/team-stats endpoint is unrelated to the C3 page
    assert.ok(!src.replace(/\/api\/lap\/team-stats/g, "").includes("/team-stats"),
      `LAP ${label} must not route to the C3 team stats page`);
  }
});

test("LOP is confined and scoped the same way LAP is", () => {
  const guard = routes.slice(routes.indexOf("// ── Portal confinement"), routes.indexOf("// ── Users ───"));
  assert.match(guard, /CONFINED_PORTALS = new Set\(\["lap", "lop"\]\)/,
    "a lop account must be confined too, or it roams all of C3");
  assert.match(guard, /!CONFINED_PORTALS\.has\(portal\)/);

  // Visibility: admins see everything, everyone else only their own work.
  assert.match(routes, /function lapVisibilityFor[\s\S]*?if \(ctx\.isAdmin\) return null;/,
    "administrators are the only unrestricted readers");
  assert.match(routes, /getPortalUserIdsForLoanOfficer/,
    "an LO must also see the packages their assistants created");

  // Mutations must not bypass the read scope.
  assert.match(routes, /if \(!lapPackageVisible\(ctx, packageId\)\)/, "patch/upload must check visibility");
  assert.match(routes, /const ownerPackageId = storageExtra\.getLapFilePackageId/,
    "file delete must resolve its parent package and check visibility");
  assert.match(routes, /if \(!ctx\.isAdmin\) return res\.status\(403\)/,
    "org-wide team stats must be admin-only");
});

test("package visibility never silently falls back to everything", () => {
  const clause = storage.slice(storage.indexOf("function lapVisibilityClause"), storage.indexOf("const LAP_PACKAGE_SELECT"));
  assert.match(clause, /if \(!ids\.length\) return " AND 0 = 1"/,
    "an unresolved identity must show nothing, not the whole org");
});

test("the loan-officer link grants visibility in one direction only", () => {
  // An LO sees the desk beneath them. An assistant must NOT gain sight of their
  // LO's packages, nor of a peer assistant linked to the same officer, just by
  // sharing a loan_officer_id.
  const fn = routes.slice(routes.indexOf("function lapVisibilityFor"), routes.indexOf("function lapPackageVisible"));
  assert.match(fn, /portal === "lop"/,
    "only a LOP account may expand beyond its own rows");
  assert.ok(!/if \(Number\.isInteger\(loId\) && loId > 0\) \{\s*ids\.push/.test(fn),
    "expansion must be gated on the portal type, not on the link alone");
});

test("portal logins are managed from the portal without opening new server surface", () => {
  const page = readFileSync(join(root, "client/src/pages/lap-users.tsx"), "utf8");
  // Reuses existing admin endpoints; the portal guard already excludes portal
  // accounts from them, so no allowlist entry was added for this feature.
  assert.match(page, /apiRequest\("POST", "\/api\/users"/);
  assert.match(page, /apiRequest\("PATCH", `\/api\/users\/\$\{v\.id\}`/);
  const guard = routes.slice(routes.indexOf("// ── Portal confinement"), routes.indexOf("// ── Users ───"));
  assert.ok(!guard.includes("/users\"") && !guard.includes("/loan-officers"),
    "managing portal users must not require exposing those routes to portal accounts");
  // Email only leaves on an explicit action, never on render.
  assert.ok(!/useEffect\([^)]*sendWelcome/.test(page), "welcome mail must not fire from an effect");
  assert.match(page, /onClick=\{\(\) => save\.mutate\(\)\}/, "creation is an explicit button press");
});

test("LO credentials are stripped in every key casing, not just camelCase", () => {
  // normalizeLoanOfficer spreads the raw row then ADDS camelCase aliases, so the
  // snake_case columns survive. Masking `bonzoPassword` alone still shipped
  // `bonzo_password` in clear text — this asserts the real behaviour by running
  // the actual masking function against a row shaped like the DB's.
  const src = routes.slice(routes.indexOf("function maskLoCredentials"), routes.indexOf("app.get(\"/api/loan-officers/:id\""));
  const body = src.slice(src.indexOf("{")).split(": any").join("");
  // eslint-disable-next-line no-new-func
  const mask = new Function(`return function maskLoCredentials(lo) ${body}`)();

  const row = {
    id: 7, full_name: "Test LO",
    bonzo_password: "s3cret-bonzo", bonzoPassword: "s3cret-bonzo",
    lead_mailbox_password: "s3cret-mail", leadMailboxPassword: "s3cret-mail",
    other_credentials: '{"vpn":"hunter2"}', otherCredentials: { vpn: "hunter2" },
  };
  const out = mask(row);
  const serialized = JSON.stringify(out);
  for (const secret of ["s3cret-bonzo", "s3cret-mail", "hunter2"]) {
    assert.ok(!serialized.includes(secret), `${secret} must never leave the server here`);
  }
  assert.equal(out.bonzoPassword, "••••••••", "presence is still signalled to the UI");
  assert.equal(out.leadMailboxPassword, "••••••••");
  assert.ok(!("bonzo_password" in out) && !("lead_mailbox_password" in out));
  assert.ok(!("otherCredentials" in out) && !("other_credentials" in out));
  assert.equal(out.id, 7, "non-credential fields survive");
});

test("both loan-officer read endpoints go through the masking helper", () => {
  const listAndById = routes.slice(routes.indexOf("const safe = (los as any[]).map"), routes.indexOf(`app.post("/api/loan-officers"`));
  assert.equal((listAndById.match(/maskLoCredentials\(/g) ?? []).length, 3,
    "list + by-id must both call it (plus the definition)");
});
