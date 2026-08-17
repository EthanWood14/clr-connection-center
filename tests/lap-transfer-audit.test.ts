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

test("the audit endpoint is admin-only and finds Chris by name", () => {
  const fn = routes.slice(routes.indexOf('app.get("/api/lap/transfer-audit"'), routes.indexOf('app.get("/api/lap/results"'));
  assert.match(fn, /if \(!ctx\.isAdmin\) return res\.status\(403\)/);
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
  // committed. (routes.ts does still carry ONE pre-existing literal — the
  // "WCL2026!" default for the seeded Randy Hammond account — which is a
  // separate, older issue; this pins it so no SECOND one creeps in.)
  assert.equal((routes.match(/WCL2026/g) ?? []).length, 1, "no new password literal may be added to the repo");
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

test("a signed-in session still wins over the shared device", () => {
  // Otherwise every existing LAP account would lose its name in the audit trail.
  const mw = routes.slice(routes.indexOf('app.use("/api/lap"'), routes.indexOf('app.post("/api/lap/gate"'));
  assert.match(mw, /if \(req\.session_user\) return next\(\)/);
  assert.match(mw, /req\.lap_device = device/);
  // And a misconfigured gate must not lock everyone out.
  assert.match(shell, /gate\?\.configured && !gate\.unlocked/);
  assert.match(shell, /: !user && !gate\?\.unlocked \? <LapLogin \/>/);
});

test("a package can be created with a single document", () => {
  assert.match(results, /Attach at least one document to create the package\./);
  assert.ok(!/is required\.`\)/.test(results.slice(results.indexOf("const createMutation"), results.indexOf("const createMutation") + 900)),
    "the all-three gate must be gone");
  assert.ok(!/attach all three required files/i.test(results));
});
