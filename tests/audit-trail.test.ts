import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");

test("a deleted outcome records who removed it and what it was", () => {
  // Once the row is gone this audit entry is the only surviving record of it,
  // so a blank actor and a null label make the deletion untraceable.
  const route = routes.slice(
    routes.indexOf(`app.delete("/api/outcomes/:id"`),
    routes.indexOf(`// Recent activity widget`),
  );
  assert.ok(!/userName: ""/.test(route), "the actor must be named, not blank");
  assert.match(route, /userName: me\?\.name \?\? "Unknown"/);
  assert.match(route, /entityLabel: existing\.borrower_name/, "which borrower was removed");
  assert.match(route, /outcomeType: existing\.outcome_type/, "…and whether it was a transfer");
  assert.match(route, /date: existing\.date/, "…and which day it counted toward");
  assert.match(route, /deletedByOwner:/, "an admin deleting someone else's row is a different act");
  // The row must be read BEFORE it is deleted, or there is nothing left to describe.
  assert.ok(
    route.indexOf("SELECT id, assistant_id") < route.indexOf("storage.deleteLeadOutcome"),
    "the row must be captured before deletion",
  );
});

test("an audit write that fails is reported, never swallowed", () => {
  const fn = routes.slice(routes.indexOf("function audit(data:"), routes.indexOf("// ── Cookie parser"));
  assert.ok(!/catch \{\}/.test(fn), "an empty catch hides mutations that went unrecorded");
  assert.match(fn, /console\.error\(/, "a failed trail write must surface in the logs");
  assert.match(fn, /\[audit\] FAILED/);
  // It still must not fail the request — the mutation already happened.
  assert.ok(!/throw/.test(fn), "auditing must not break the request it is recording");
});

test("the audit viewer can filter by action and date range", () => {
  // Without these, "what was deleted this afternoon" is unanswerable from the UI.
  const fn = storage.slice(storage.indexOf("getAuditLogs(filters?: {"), storage.indexOf("export const storage"));
  for (const f of ["action", "from", "to", "search"]) {
    assert.ok(fn.includes(`filters?.${f}`), `getAuditLogs must support ${f}`);
  }
  assert.match(fn, /gte\(auditLogs\.createdAt/, "from must be a real lower bound");
  assert.match(fn, /lte\(auditLogs\.createdAt/, "to must be a real upper bound");
});

test("a bare end date covers the whole day", () => {
  // "to=2026-08-05" against ISO timestamps would otherwise match only midnight
  // and report an empty day.
  const fn = storage.slice(storage.indexOf("getAuditLogs(filters?: {"), storage.indexOf("export const storage"));
  assert.match(fn, /T23:59:59\.999Z/, "an end date must be widened to end-of-day");
});

test("audit filter inputs are validated before they reach the query", () => {
  const route = routes.slice(
    routes.indexOf(`app.get("/api/audit-logs"`),
    routes.indexOf(`// ── Daily Call Logs`),
  );
  assert.match(route, /requireAdminSession\(req, res\)/, "the trail is admin-only");
  assert.match(route, /\^\[A-Za-z0-9_-\]\{1,64\}\$/, "action must be constrained");
  assert.match(route, /\\d\{4\}-\\d\{2\}-\\d\{2\}/, "dates must be constrained");
  assert.match(route, /Math\.min\(500/, "the result set stays bounded");
});

test("records with no resolvable user are visible without leaking across orgs", () => {
  // Failed logins carry user_id null and system deletions carry 0. The old
  // post-filter kept only rows whose user_id was a current org member, so those
  // were dropped — exactly the rows an investigation needs. Simply letting them
  // through is not the fix either: with no org column on the row, one org's
  // failed logins (and the IPs and addresses in them) would be readable by every
  // other org's admins. Scoping has to happen on org_id, in SQL.
  const route = routes.slice(
    routes.indexOf(`app.get("/api/audit-logs"`),
    routes.indexOf(`// ── Daily Call Logs`),
  );
  assert.ok(!/log\.userId != null && allowedUserIds\.has/.test(route),
    "the user-based post-filter dropped unowned rows");
  assert.ok(!/uid == null \|\| uid === 0/.test(route),
    "…and passing them through unscoped leaked them to every org");
  assert.ok(!/\.filter\(\(log/.test(route), "no post-filter should remain at all");
});

// ── Credential redaction ──────────────────────────────────────────────────────
// PATCH /api/loan-officers/:id serialised the raw request body into details,
// which put 45 rows of live Bonzo and lead-mailbox passwords into audit_logs.

test("secrets are masked, never written through", async () => {
  const { auditDetails, AUDIT_MASK } = await import("../server/audit-details");
  const out = auditDetails({
    fullName: "Sample LO", bonzoUsername: "user@example.com",
    bonzoPassword: "Sher22vin!$!$", leadMailboxPassword: "hunter2", newPassword: "x",
  })!;
  assert.ok(!out.includes("Sher22vin"), "the real password must not survive");
  assert.ok(!out.includes("hunter2"));
  assert.match(out, new RegExp(AUDIT_MASK));
  // Non-secret fields still come through — a redacted row must stay useful.
  assert.match(out, /Sample LO/);
  assert.match(out, /user@example\.com/);
});

test("an absent secret is null, a set one is the placeholder", async () => {
  const { auditDetails, AUDIT_MASK } = await import("../server/audit-details");
  const cleared = JSON.parse(auditDetails({ bonzoPassword: "" })!);
  const set = JSON.parse(auditDetails({ bonzoPassword: "real" })!);
  // "changed a password" and "cleared a password" are different events and the
  // audit row is the only witness to which one happened.
  assert.equal(cleared.bonzoPassword, null);
  assert.equal(set.bonzoPassword, AUDIT_MASK);
});

test("credential bags and binary payloads are dropped, not masked", async () => {
  const { auditDetails } = await import("../server/audit-details");
  const out = auditDetails({ name: "x", otherCredentials: { a: 1 }, dataBase64: "AAAA", subscription: { keys: {} } })!;
  for (const k of ["otherCredentials", "dataBase64", "subscription"]) {
    assert.ok(!out.includes(k), `${k} must not appear at all`);
  }
  assert.match(out, /"name":"x"/);
});

test("snake_case and camelCase spellings are both caught", async () => {
  const { auditDetails } = await import("../server/audit-details");
  const out = auditDetails({ bonzo_password: "secret1", lead_mailbox_password: "secret2", twilio_auth_token: "secret3" })!;
  for (const v of ["secret1", "secret2", "secret3"]) assert.ok(!out.includes(v), `${v} leaked`);
});

test("details are bounded so one request cannot flood the table", async () => {
  const { auditDetails } = await import("../server/audit-details");
  const out = auditDetails({ notes: "x".repeat(50_000) })!;
  assert.ok(out.length <= 4000, `details capped, got ${out.length}`);
});

test("rotated settings record which fields moved, never the values", async () => {
  const { auditChangedFields } = await import("../server/audit-details");
  const out = auditChangedFields(
    { twilioAuthToken: "old-token", fromNumber: "+15550001111" },
    { twilioAuthToken: "new-token", fromNumber: "+15550001111" },
  );
  assert.ok(!out.includes("old-token") && !out.includes("new-token"), "a diff of a secret is as bad as the secret");
  assert.match(out, /"changed":\["twilioAuthToken"\]/);
  assert.match(out, /"wasSet":\{"twilioAuthToken":true\}/);
});

test("the scrub detector finds plaintext but ignores already-masked rows", async () => {
  const { detailsHasPlaintextSecret, auditDetails, AUDIT_MASK } = await import("../server/audit-details");
  assert.equal(detailsHasPlaintextSecret(`{"bonzoPassword":"Sher22vin!$!$"}`), true);
  assert.equal(detailsHasPlaintextSecret(`{"bonzoPassword":"${AUDIT_MASK}"}`), false);
  assert.equal(detailsHasPlaintextSecret(`{"bonzoPassword":""}`), false, "empty means no credential was set");
  assert.equal(detailsHasPlaintextSecret(`{"fullName":"Sample"}`), false);
  assert.equal(detailsHasPlaintextSecret(null), false);
  // Anything the scrubber rewrites must come back clean.
  assert.equal(detailsHasPlaintextSecret(auditDetails(JSON.parse(`{"bonzoPassword":"live"}`))), false);
});

test("the LO update route no longer serialises the raw body", () => {
  const route = routes.slice(
    routes.indexOf(`app.patch("/api/loan-officers/:id"`),
    routes.indexOf(`// ── Lead sources`),
  );
  assert.ok(!/details: JSON\.stringify\(body\)/.test(route), "the raw body carried live credentials");
  assert.match(route, /details: auditDetails\(body\)/);
});

test("audit rows are scoped by org in SQL, not by guessing from the user", () => {
  assert.match(storage, /orgId: integer\("org_id"\)|ALTER TABLE audit_logs ADD COLUMN org_id/);
  const create = storage.slice(storage.indexOf("createAuditLog(data: InsertAuditLog) {"), storage.indexOf("getAuditLogs(filters?: {", storage.indexOf("createAuditLog(data: InsertAuditLog) {")));
  assert.match(create, /getOrgContext\(\)\?\.orgId/,
    "getOrgContext, not currentOrgId — the latter is null under bypassScope");
  const get = storage.slice(storage.indexOf("getAuditLogs(filters?: {", storage.indexOf("class Storage")));
  assert.match(get, /eq\(auditLogs\.orgId, orgId\)/, "scoping must be a WHERE clause");
});

test("historical plaintext credentials are scrubbed once, and the scrub is recorded", () => {
  assert.match(storage, /audit_credential_scrub_v1/, "the scrub must be idempotent via a marker");
  const block = storage.slice(storage.indexOf("Migration: scrub plaintext credentials"));
  assert.match(block.slice(0, 1800), /detailsHasPlaintextSecret/, "only rewrite rows that actually leak");
  assert.match(block.slice(0, 1800), /rowsScrubbed/, "the scrub itself must be auditable");
});
