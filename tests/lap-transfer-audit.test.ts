import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { nameKey, windowStart, buildAuditRows, auditSummary, type TransferRow, type PackageRow } from "../server/lap-transfer-audit";
import { deviceLabelFrom, gateAttemptAllowed, resetGateAttempts, newDeviceId } from "../server/lap-gate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const shell = readFileSync(join(root, "client/src/components/lap/lap-shell.tsx"), "utf8");
const results = readFileSync(join(root, "client/src/pages/lap-results.tsx"), "utf8");

const t = (id: number, date: string, name: string): TransferRow =>
  ({ outcomeId: id, date, borrowerName: name, clrName: "Ethan", loaName: null });
const p = (id: number, name: string, date: string, docs: string[]): PackageRow =>
  ({ packageId: id, borrowerName: name, resultDate: date, documentTypes: docs });

test("borrower names match across the two systems despite typing noise", () => {
  assert.equal(nameKey("Jasper Leaven Jr."), nameKey("jasper leaven"));
  assert.equal(nameKey("O'Brien, Sean"), nameKey("Sean OBrien"));
  assert.equal(nameKey("  Dennis   Mclendon "), nameKey("Dennis McLendon"));
  // …but different people must not collide.
  assert.notEqual(nameKey("Mark Rooney"), nameKey("Mike Rooney"));
  assert.equal(nameKey(""), "");
  assert.equal(nameKey(null), "");
});

test("document completeness is reported per transfer", () => {
  const rows = buildAuditRows(
    [t(1, "2026-08-14", "Ann Diaz"), t(2, "2026-08-14", "Bob Lee"), t(3, "2026-08-13", "Cy Ng")],
    [
      p(10, "ann diaz", "2026-08-14", ["credit_report", "aus", "formal_quote"]),
      p(11, "Bob Lee", "2026-08-14", ["credit_report"]),
    ],
  );
  assert.equal(rows[0].complete, true);
  assert.equal(rows[0].submittedCount, 3);
  assert.equal(rows[1].complete, false);
  assert.equal(rows[1].submittedCount, 1);
  assert.deepEqual(rows[1].docs, { credit_report: true, aus: false, formal_quote: false });
  // No package at all — every document reads as missing, not as an error.
  assert.equal(rows[2].packageId, null);
  assert.equal(rows[2].submittedCount, 0);
});

test("a repeat borrower credits the package nearest the transfer", () => {
  // Otherwise last spring's paperwork would mark today's transfer complete.
  const rows = buildAuditRows(
    [t(1, "2026-08-14", "Ann Diaz")],
    [
      p(10, "Ann Diaz", "2026-02-01", ["credit_report", "aus", "formal_quote"]),
      p(11, "Ann Diaz", "2026-08-13", ["credit_report"]),
    ],
  );
  assert.equal(rows[0].packageId, 11);
  assert.equal(rows[0].complete, false);
});

test("the summary splits complete, partial and nothing-submitted", () => {
  const rows = buildAuditRows(
    [t(1, "2026-08-14", "A A"), t(2, "2026-08-14", "B B"), t(3, "2026-08-14", "C C"), t(4, "2026-08-14", "D D")],
    [p(10, "A A", "2026-08-14", ["credit_report", "aus", "formal_quote"]), p(11, "B B", "2026-08-14", ["aus"])],
  );
  assert.deepEqual(auditSummary(rows), { transfers: 4, complete: 1, partial: 1, missing: 2, completionPct: 25 });
  assert.equal(auditSummary([]).completionPct, 0, "no transfers must not divide by zero");
});

test("windows cover N days inclusive, and all-time has no lower bound", () => {
  assert.equal(windowStart("2026-08-14", 3), "2026-08-12", "3 days = today and the two before it");
  assert.equal(windowStart("2026-08-14", 7), "2026-08-08");
  assert.equal(windowStart("2026-08-14", 30), "2026-07-16");
  assert.equal(windowStart("2026-08-14", 0), null);
  assert.equal(windowStart("2026-03-01", 3), "2026-02-27", "windows cross month boundaries");
});

test("the audit endpoint finds Chris by name and ignores removed documents", () => {
  const fn = routes.slice(routes.indexOf('app.get("/api/lap/transfer-audit"'), routes.indexOf('app.get("/api/lap/results"'));
  assert.match(fn, /full_name LIKE '%Redoble%'/, "by name, so a changed LO id cannot break it");
  assert.match(fn, /outcome_type='transfer'/);
  assert.match(fn, /f\.is_current = 1 AND f\.removed_at IS NULL/, "a removed document is not submitted");
});

test("the shared gate is rate limited, device tagged, and never stores the password", () => {
  resetGateAttempts();
  const ip = "203.0.113.9";
  for (let i = 0; i < 10; i++) assert.equal(gateAttemptAllowed(ip), true, `attempt ${i + 1} should pass`);
  assert.equal(gateAttemptAllowed(ip), false, "11th attempt in the window must be refused");
  // Only the hash is persisted.
  assert.match(routes, /lap_gate_password_hash/);
  // The shared password is seeded straight into the production database, never
  // committed. The one pre-existing literal (the "WCL2026!" default for the
  // imported Randy Hammond account) has since been removed too, so the
  // invariant is now simply: no password literals at all.
  assert.equal((routes.match(/WCL2026/g) ?? []).length, 0, "no password literal may live in the repo");
  const gateFn = routes.slice(routes.indexOf('app.post("/api/lap/gate"'), routes.indexOf('app.get("/api/lap/gate"'));
  assert.ok(!/WCL2026/.test(gateFn), "the gate must never embed the password");
  assert.match(routes, /bcrypt\.compare\(password, hash\)/);
  // Cookie hardening.
  const gate = routes.slice(routes.indexOf('app.post("/api/lap/gate"'), routes.indexOf('app.get("/api/lap/gate"'));
  assert.match(gate, /httpOnly: true, signed: true/);
  assert.match(gate, /secure: process\.env\.NODE_ENV === "production"/);
  // Device labels describe a machine, not a person.
  const label = deviceLabelFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari/604", newDeviceId());
  assert.match(label, /^iPhone Safari · [0-9a-f]{6}$/);
});

test("the shared password is the only door, and the gate itself is reachable", () => {
  // Three things broke this in production: the global /api guard ran requireAuth
  // before the gate could issue a session (so even POST /api/lap/gate 401'd),
  // the device middleware was registered AFTER that guard, and the client then
  // fell back to the email/password login it was meant to replace.
  assert.match(routes, /if \(req\.path === "\/lap\/gate"\) return next\(\);/,
    "the door cannot require the session it creates");
  const guardAt = routes.indexOf('if (req.path === "/lap/gate") return next();');
  const deviceAt = routes.indexOf('app.use("/api/lap", (req: any, _res, next) => {');
  assert.ok(deviceAt > 0 && deviceAt < guardAt,
    "the device cookie must establish a session BEFORE requireAuth runs");
  // The account login survives only as a fallback and an explicit admin choice.
  assert.match(shell, /!gate!\.configured \|\| staffLogin/);
  assert.match(shell, /gate!\.configured && !staffLogin/);
});

test("the transfer audit is reachable without an admin account", () => {
  // With logins replaced by one shared password nobody on the portal side is an
  // administrator, so gating this on isAdmin made it unreachable for the people
  // who chase the paperwork.
  const fn = routes.slice(routes.indexOf('app.get("/api/lap/transfer-audit"'), routes.indexOf('app.get("/api/lap/results"'));
  assert.ok(!/isAdmin/.test(fn), "must not be admin-only");
  // …but the surfaces that change WHO has access stay admin-only.
  const devices = routes.slice(routes.indexOf('app.get("/api/lap/devices"'), routes.indexOf('app.post("/api/lap/gate/password"'));
  assert.match(devices, /if \(!ctx\.isAdmin\) return res\.status\(403\)/);
});

test("requireAuth accepts a session an upstream middleware already established", () => {
  // requireAuth re-derived the session from the C3 login cookie and ignored
  // anything already on the request, so the gate's device session was silently
  // discarded and every LAP call 401'd even with a valid gate cookie.
  const fn = routes.slice(routes.indexOf("function requireAuth("), routes.indexOf("// Helper: get current reporting period"));
  assert.match(fn, /if \(\(req as any\)\.session_user\) return next\(\);/);
  assert.ok(fn.indexOf("session_user) return next()") < fn.indexOf("freshSessionFromSignedCookie"),
    "the established session must be honored before falling back to the cookie");
});

test("a signed-in session still wins over the shared device", () => {
  // Otherwise every existing LAP account would lose its name in the audit trail.
  const mw = routes.slice(routes.indexOf('app.use("/api/lap"'), routes.indexOf('app.post("/api/lap/gate"'));
  assert.match(mw, /if \(req\.session_user\) return next\(\)/);
  assert.match(mw, /req\.lap_device = device/);
  // A misconfigured gate must still not lock everyone out — that is the ONLY
  // remaining path to the per-account login, along with an explicit admin click.
  assert.match(shell, /!gate!\.configured \|\| staffLogin/);
});

test("a package can be created before any documents arrive", () => {
  const create = results.slice(results.indexOf("const createMutation"), results.indexOf("const createMutation") + 2_000);
  assert.ok(!/Attach at least one document/.test(create));
  assert.ok(!/allCreateFilesSelected/.test(results));
  assert.match(results, /Every document is optional/);
  assert.match(results, />Optional<\/Badge>/);
});

test("C3 transfers can be linked exactly and duplicate LAP packages can be merged", () => {
  assert.match(routes, /app\.post\("\/api\/lap\/transfer-audit\/:outcomeId\/package"/);
  assert.match(routes, /linkLapTransferToPackage/);
  assert.match(routes, /app\.post\("\/api\/lap\/results\/:id\/merge"/);
  assert.match(results, /Merge package/);
  assert.match(results, /sourcePackageId/);
});

test("an available LOA routes a transfer to LAP without a competing Bonzo update", () => {
  // Still true, and still the point: LAP owns the borrower's workflow, so C3
  // makes no competing UPDATE -- no reassign, no stage move, no rename.
  // What changed on 1 Sep 2026 is that the note is no longer suppressed too.
  // Skipping it left a transfer to any LO with an active assistant with no
  // trace in Bonzo whatsoever, which is how Joy Crosett's went missing.
  const sync = routes.slice(routes.indexOf("async function syncTransferToBonzo"), routes.indexOf("app.post(\"/api/bonzo/test-transfer\""));
  assert.match(sync, /hasAvailableLapAssistant/);
  assert.match(sync, /reassigned = "skipped_lap";/);
  assert.match(sync, /const shouldMove = !lapCovered &&/);
  // The rename and the clrtransfer tag are markers and DO apply; only the
  // automation trigger would be a mutation, and shouldMove already excludes it.
  assert.doesNotMatch(sync, /delete updates\[k\]/);
  assert.match(sync, /if \(shouldMove && moved === "tagged" && !has\(moveTag\)\)/);
  // The note is the one thing that must still go.
  assert.match(sync, /notesToBonzoHtml\(convo/);
  assert.doesNotMatch(sync, /Bonzo skipped/);
});
