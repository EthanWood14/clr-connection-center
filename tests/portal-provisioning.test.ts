import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");

test("inviting requires an explicit list and an admin — there is no invite-everyone", () => {
  const route = routes.slice(
    routes.indexOf(`app.post("/api/portal-provisioning/invite"`),
    routes.indexOf(`app.get("/api/portal-link"`),
  );
  assert.match(route, /requireAdminSession\(req, res\)/, "sending mail to outsiders is admin-only");
  assert.match(route, /subjects: z\.array/, "callers must name who they are inviting");
  assert.match(route, /\.min\(1\)\.max\(50\)/, "bounded — no unbounded blast");
  // Every subject is re-checked against the roster server-side.
  assert.match(route, /roster\.find\(/, "a client-supplied id must be confirmed against the roster");
  assert.match(route, /Already has a login/, "must not double-provision");
  assert.match(route, /No email address on file/, "must refuse when there is nowhere to send");
});

test("provisioning preview is manager-gated and classifies every roster row", () => {
  const route = routes.slice(
    routes.indexOf(`app.get("/api/portal-provisioning"`),
    routes.indexOf(`app.post("/api/portal-provisioning/invite"`),
  );
  assert.match(route, /requireManagerOrAdmin\(req, res\)/);
  for (const status of ["has_login", "ready", "needs_email"]) {
    assert.ok(route.includes(status), `status ${status} must be reported`);
  }
});

test("a provisioned portal login can never carry C3 privileges", () => {
  const fn = routes.slice(routes.indexOf("async function provisionPortalLogin"), routes.indexOf("// ── Portal provisioning"));
  assert.match(fn, /role: "assistant"/);
  assert.match(fn, /isClr: false/);
  assert.match(fn, /inDailyAssignments: false/);
  assert.match(fn, /excludeFromStats: true/);
  assert.match(fn, /setMustChangePassword\(newUser\.id, true\)/, "first sign-in must force a password change");
  assert.match(fn, /getUserByEmail/, "must refuse to create a duplicate account");
  assert.match(fn, /audit\(\{/, "provisioning must be attributable");
});

test("assistants can hold an email so they can be invited at all", () => {
  assert.match(storage, /ALTER TABLE loan_officer_assistants ADD COLUMN email TEXT/,
    "without an address there is nowhere to send an LOA login");
  assert.match(storage, /export function updateLoanOfficerAssistant/);
  const patch = routes.slice(
    routes.indexOf(`app.patch("/api/loan-officer-assistants/:id"`),
    routes.indexOf(`app.delete("/api/loan-officer-assistants/:id"`),
  );
  assert.match(patch, /requireManagerOrAdmin\(req, res\)/);
  assert.match(patch, /email: z\.string\(\)\.trim\(\)\.email\(\)/, "the address must be validated");
});

test("account creation and privilege edits are audited", () => {
  const post = routes.slice(routes.indexOf(`app.post("/api/users"`), routes.indexOf(`app.patch("/api/users/:id"`));
  assert.match(post, /action: "create", entityType: "user"/, "creating an account must be audited");
  const patch = routes.slice(routes.indexOf(`app.patch("/api/users/:id"`), routes.indexOf(`app.delete("/api/users/:id"`));
  assert.match(patch, /PRIV_TOUCHED/, "privilege-bearing edits must be audited");
  for (const field of ["role", "portal", "loanOfficerId", "isActive"]) {
    assert.ok(patch.includes(`"${field}"`), `${field} changes must be tracked`);
  }
});

test("the welcome email is reported as queued, not delivered", () => {
  // sendEmail() holds messages for EMAIL_SEND_DELAY_MS, so "sent" overstates it.
  const post = routes.slice(routes.indexOf(`app.post("/api/users"`), routes.indexOf(`app.patch("/api/users/:id"`));
  assert.match(post, /emailQueued: emailSent/, "the response must expose the honest field");
  for (const f of ["client/src/components/team-management.tsx", "client/src/components/lap/lap-portal-users-card.tsx"]) {
    const src = read(f);
    assert.ok(!/Welcome email sent\./.test(src), `${f} must not claim delivery`);
    assert.match(src, /queued/i, `${f} should say the mail is queued`);
  }
});

test("schedule changes notify managers", () => {
  assert.match(routes, /async function notifyScheduleChange/);
  const fn = routes.slice(routes.indexOf("async function notifyScheduleChange"), routes.indexOf("async function notifyAttendanceManagers"));
  assert.match(fn, /attendanceManagerUsers\(orgId, actorUserId\)/, "the person making the change is not notified of it");
  assert.match(fn, /createNotification/);
  assert.match(fn, /sendPushToUser/);
  assert.match(fn, /if \(!isFirst && !changes\.length\) return;/,
    "a notes-only edit must not ping anyone");
  // The save must not fail because a notification did not send.
  assert.match(routes, /notifyScheduleChange\([\s\S]{0,160}?\.catch\(/);
});

test("portal accounts can save their own schedule but not review others'", () => {
  const guard = routes.slice(routes.indexOf("// ── Portal confinement"), routes.indexOf("// ── Users ───"));
  const exact = guard.slice(guard.indexOf("LAP_ALLOWED_EXACT"), guard.indexOf("LAP_ALLOWED_PREFIXES"));
  const prefixes = guard.slice(guard.indexOf("LAP_ALLOWED_PREFIXES"), guard.indexOf("app.use("));
  assert.ok(exact.includes('"/schedule"'),
    "check-in lateness is judged against the schedule, so they must be able to set it");
  // Exact-match only: /schedule/team and /schedule/:id/decision are manager
  // surfaces and must stay unreachable for a portal account.
  assert.ok(!/["']\/schedule\//.test(prefixes), "no /schedule/ prefix may be allowlisted");
  assert.ok(!exact.includes('"/schedule/team"'));
});

test("LAP nav offers nothing whose API the portal guard refuses", () => {
  const sidebar = read("client/src/components/lap/lap-sidebar.tsx");
  const shell = read("client/src/components/lap/lap-shell.tsx");
  // These pages call C3-only endpoints (/api/timeclock, /api/time-off, /api/reports)
  // that a portal account cannot reach — mounting them produced dead ends.
  for (const dead of ["/time-clock", "/time-off", "/reports-archive"]) {
    assert.ok(!sidebar.includes(dead), `LAP nav must not link to ${dead}`);
    assert.ok(!shell.includes(dead), `LAP router must not mount ${dead}`);
  }
});
