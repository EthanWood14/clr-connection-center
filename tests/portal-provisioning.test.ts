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
  for (const f of ["client/src/components/team-management.tsx", "client/src/pages/lap-users.tsx"]) {
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

test("each portal sends mail under its own identity", () => {
  // The Resend key and verified domain stay shared with C3 on purpose; only the
  // visible sender name and reply-to are per portal.
  assert.match(routes, /function portalEmailIdentity/);
  const dispatch = routes.slice(routes.indexOf("async function dispatchEmailNow"), routes.indexOf("type ReportOptions"));
  assert.match(dispatch, /fromName\s*\?/, "a portal name must be able to override the display name");
  assert.match(dispatch, /replyTo && replyTo\.includes\("@"\)/, "reply-to must be validated before it is set");
  // The address itself must still come from the verified domain.
  assert.match(dispatch, /baseFrom\.match\(\/<\(\[\^>\]\+\)>\//, "only the display name is swapped, never the address");
});

test("portal email settings are admin-gated and bounded", () => {
  const patch = routes.slice(
    routes.indexOf(`app.patch("/api/portal-email-settings/:portal"`),
    routes.indexOf(`app.post("/api/portal-email-settings/:portal/test"`),
  );
  assert.match(patch, /requireAdminSession\(req, res\)/);
  assert.match(patch, /portal !== "lap" && portal !== "lop"/, "the portal name must be validated, not interpolated blindly");
  assert.match(patch, /z\.string\(\)\.trim\(\)\.email\(\)/, "reply-to must be a real address");
});

test("a resent welcome never advertises C3 to a portal account", () => {
  const route = routes.slice(
    routes.indexOf(`app.post("/api/users/:id/resend-welcome"`),
    routes.indexOf(`app.post("/api/users/:id/restore"`),
  );
  assert.match(route, /const isPortalUser = userPortal === "lap" \|\| userPortal === "lop"/);
  assert.match(route, /productName = isPortalUser \? userPortal\.toUpperCase\(\)/,
    "the email must name the product the recipient can actually reach");
  assert.match(route, /fromName: identity\?\.fromName/, "and go out under that portal's identity");
});

test("portal user management lives in the portal and stays admin-only", () => {
  const page = read("client/src/pages/lap-users.tsx");
  assert.match(page, /const isAdmin = user\?\.role === "admin"/);
  assert.match(page, /Administrators only/, "non-admins must be told, not shown an empty page");
  // The full set of account actions C3 has.
  assert.match(page, /resend-welcome/, "resend welcome");
  assert.match(page, /isActive: !u\.isActive/, "deactivate/reactivate");
  assert.match(page, /apiRequest\("POST", "\/api\/users"/, "create");
  assert.match(page, /apiRequest\("PATCH", `\/api\/users\/\$\{editUser!\.id\}`/, "edit");
  // Only this portal's accounts, never C3 staff.
  assert.match(page, /String\(u\.portal \?\? ""\)\.toLowerCase\(\) === product/);
});

test("the portal users page did not widen the guard", () => {
  const guard = routes.slice(routes.indexOf("// ── Portal confinement"), routes.indexOf("// ── Users ───"));
  for (const forbidden of ['"/users"', "/loan-officers", "/portal-email-settings", "/portal-provisioning"]) {
    assert.ok(!guard.includes(forbidden),
      `${forbidden} must stay unreachable for portal accounts — admins reach it as C3 users`);
  }
});

test("submitting documents emails one message per package, not per file", () => {
  const fn = routes.slice(routes.indexOf("function emailLapSubmission"), routes.indexOf("/** The sender identity"));
  // Queuing alone does not supersede an earlier message — the pending one for
  // this package has to be dropped first, or three uploads send three emails.
  assert.match(fn, /cancelPendingEmails\(cancelKey\)/,
    "a pending email for the same package must be superseded");
  assert.match(fn, /lap-submission:\$\{orgId\}:\$\{packageId\}/, "the key must be per package, not global");
  assert.match(fn, /if \(!to\.includes\("@"\)\) return;/, "no recipient configured means no email");
  assert.match(fn, /if \(!pkg \|\| !pkg\.files\.length\) return;/, "never send an empty submission");
  // Oversized attachments degrade to a list rather than a failed send.
  assert.match(fn, /LAP_EMAIL_ATTACH_MAX_BYTES/);
  assert.match(fn, /too large to attach/);
  // Borrower names and notes are user-supplied and land in HTML.
  assert.match(fn, /const esc = /, "user-supplied values must be escaped");
});

test("a failed submission email never fails the upload", () => {
  const upload = routes.slice(routes.indexOf("function uploadLapResultFile"), routes.indexOf("const lapResultCreateSchema") > 0 ? routes.length : routes.length);
  assert.match(routes, /emailLapSubmission\(ctx\.orgId, packageId, submitterPortal === "lop" \? "lop" : "lap"\)/,
    "the portal decides which recipient receives it");
  const fn = routes.slice(routes.indexOf("function emailLapSubmission"), routes.indexOf("/** The sender identity"));
  assert.match(fn, /try \{/, "the whole build is guarded");
  assert.match(fn, /\.catch\(\(e\) =>/, "and the send itself cannot reject into the request");
});

test("each portal has its own document recipient", () => {
  assert.match(storage, /lap_files_recipient/);
  assert.match(storage, /lop_files_recipient/);
  const patch = routes.slice(
    routes.indexOf(`app.patch("/api/portal-email-settings/:portal"`),
    routes.indexOf(`app.post("/api/portal-email-settings/:portal/test"`),
  );
  assert.match(patch, /filesRecipient/, "it must be settable per portal");
  assert.match(patch, /z\.literal\(""\)/, "clearing it must be allowed — that switches sending off");
});

test("both portals are reachable from C3", () => {
  // LOP existed for a release with no link anywhere, so the only way in was
  // typing the URL.
  const sidebar = read("client/src/components/app-sidebar.tsx");
  assert.match(sidebar, /href: "\/#\/lap"/);
  assert.match(sidebar, /href: "\/#\/lop"/, "LOP needs an entry point too");
  assert.match(sidebar, /Open Loan Officer Portal/);
});

test("check-ins use an approved IP allowlist with a safe record-only default", () => {
  assert.match(storage, /ADD COLUMN checkin_ip_mode TEXT NOT NULL DEFAULT 'record'/);
  assert.match(storage, /ADD COLUMN checkin_allowed_ips TEXT NOT NULL DEFAULT '\[\]'/);
  const cfg = routes.slice(routes.indexOf("function checkinConfig"), routes.indexOf("function requestIp"));
  assert.match(cfg, /\["enforce", "record", "off"\]/);
  assert.match(cfg, /normalizeAllowedIps/);
});

test("the server derives check-in IPs and never trusts the request body", () => {
  const fn = routes.slice(routes.indexOf("function requestIp"), routes.indexOf("function wallClockMinutes"));
  assert.match(fn, /req\.ip/);
  assert.match(fn, /req\.socket\?\.remoteAddress/);
  assert.doesNotMatch(fn, /req\.body/);
  assert.match(fn, /evaluateCheckinIp/);
});

test("check-in clients no longer request browser geolocation", () => {
  for (const f of ["client/src/pages/check-ins.tsx", "client/src/pages/dashboard.tsx", "client/src/pages/portal.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /navigator\.geolocation/, `${f} must not request GPS`);
    assert.doesNotMatch(src, /accuracyM/, `${f} must not submit browser accuracy`);
    assert.match(src, /no location permission is requested/i,
      `${f} should explain that IP verification is automatic`);
  }
});

test("a schedule must exist before the first portal check-in", () => {
  // Without a schedule there is no start time to judge against, so the check-in
  // records but can never be scored — which is how people accumulated weeks of
  // unscoreable entries. Ask once, up front.
  const route = routes.slice(
    routes.indexOf(`app.post("/api/portal/:code/checkin"`),
    routes.indexOf(`app.put("/api/portal/:code/schedule"`),
  );
  assert.match(route, /externalExpectedStart\(orgId, type, id, date\)\.source === "none"/,
    "the gate must key off there being no schedule at all");
  assert.match(route, /code: "SCHEDULE_REQUIRED"/);
  assert.match(route, /res\.status\(422\)/);
  // Order matters: refuse before spending the user's time on a location prompt.
  assert.ok(route.indexOf("SCHEDULE_REQUIRED") < route.indexOf("validateCheckinLocation"),
    "check the schedule before asking for a position");
  // Being scheduled off today is NOT the same as having no schedule — those
  // people may still record a check-in.
  assert.ok(!/\.working === false/.test(route), "a day off must not block checking in");
});

test("the portal explains the requirement instead of failing on press", () => {
  const portal = read("client/src/pages/portal.tsx");
  assert.match(portal, /disabled=\{!me\.enabled \|\| !me\.schedule/,
    "the button must be disabled when no schedule is on file");
  assert.match(portal, /Save your schedule to check in/, "and say why");
  assert.match(portal, /Set your schedule first/);
});
