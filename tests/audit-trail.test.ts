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

test("records with no resolvable user are still visible", () => {
  // Failed logins carry user_id null and system deletions carry 0. Filtering
  // those out hid exactly the rows an investigation needs.
  const route = routes.slice(
    routes.indexOf(`app.get("/api/audit-logs"`),
    routes.indexOf(`// ── Daily Call Logs`),
  );
  assert.ok(
    !/log\.userId != null && allowedUserIds\.has/.test(route),
    "the old filter dropped unowned rows entirely",
  );
  assert.match(route, /uid == null \|\| uid === 0 \|\| allowedUserIds\.has/,
    "null and 0 must survive the org filter");
  // …but rows belonging to a DIFFERENT org must still be excluded.
  assert.match(route, /allowedUserIds\.has\(Number\(uid\)\)/);
});
