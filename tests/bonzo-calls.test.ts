import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  BONZO_CALLS_BY_DAY_SQL, BONZO_CALL_CANDIDATE_SOURCE, BONZO_CALL_PATH_SOURCE,
  bonzoRequestPath, classifyBonzoCallEvent,
} from "../shared/bonzo-calls";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * Calls placed inside Bonzo never reach Dialpad. The Shotgun extension reports
 * them to C3 against the signed-in CLR — which is the question being asked:
 * who is calling on Bonzo. This pins the counting rules and the wiring.
 */

test("a non-GET to a call-shaped path counts; a wide match is only recorded; the rest is noise", () => {
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/prospects/555/call", "POST"), "call");
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/calls", "POST"), "call");
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/dialer/start", "PUT"), "call");
  // Reading a call log is not placing a call.
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/calls", "GET"), "candidate");
  // Phone numbers being edited, a voice setting — recorded for pattern discovery, never counted.
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/prospects/555/phone_numbers", "PATCH"), "candidate");
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/settings/voice", "POST"), "candidate");
  // "recall", "callback" and the like must not slip in through the wide net.
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/recall", "POST"), null);
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/callbacks", "POST"), null);
  assert.equal(classifyBonzoCallEvent("network", "/api/v3/prospects/555/notes", "POST"), null);
  // A click on a call control always counts.
  assert.equal(classifyBonzoCallEvent("click", "tel:", "CLICK"), "call");
  assert.equal(classifyBonzoCallEvent("click", "click:call", "CLICK"), "call");
  assert.equal(classifyBonzoCallEvent("bogus", "/api/v3/calls", "POST"), null);
});

test("the patterns look at the path only", () => {
  assert.equal(bonzoRequestPath("https://platform.getbonzo.com/api/v3/calls?x=1#y"), "/api/v3/calls");
  assert.equal(bonzoRequestPath("/api/v3/calls?x=1"), "/api/v3/calls");
});

test("the extension embeds the exact same two patterns as the server", () => {
  const hook = read("chrome-extension/page-hook.js");
  assert.ok(hook.includes(`const CALL_PATH_SOURCE = ${JSON.stringify(BONZO_CALL_PATH_SOURCE)};`), "strict pattern drifted");
  assert.ok(hook.includes(`const CALL_CANDIDATE_SOURCE = ${JSON.stringify(BONZO_CALL_CANDIDATE_SOURCE)};`), "candidate pattern drifted");
  // Only the path leaves the page.
  assert.match(hook, /type: "C3_BONZO_CALL"/);
  assert.doesNotMatch(hook, /body:\s*body/);
});

test("one call per CLR per prospect per minute, whichever signals arrived", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE bonzo_call_events (id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER, event_id TEXT, prospect_id INTEGER, kind TEXT, path TEXT, method TEXT, counts INTEGER, occurred_at TEXT, business_date TEXT)`);
  const ins = db.prepare(`INSERT INTO bonzo_call_events (org_id, user_id, event_id, prospect_id, kind, path, method, counts, occurred_at, business_date) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, '2026-09-15')`);
  // Skyler: click + request for the same prospect in the same minute = 1; a second prospect = 2; a redial 5 minutes later = 3.
  ins.run(789, "a", 1, "click", "tel:", "CLICK", 1, "2026-09-15T16:04:10.000Z");
  ins.run(789, "b", 1, "network", "/api/v3/prospects/1/call", "POST", 1, "2026-09-15T16:04:12.000Z");
  ins.run(789, "c", 2, "network", "/api/v3/calls", "POST", 1, "2026-09-15T16:10:00.000Z");
  ins.run(789, "d", 1, "network", "/api/v3/calls", "POST", 1, "2026-09-15T16:09:30.000Z");
  // A candidate never counts, however many arrive.
  ins.run(789, "e", 3, "network", "/api/v3/prospects/3/phone_numbers", "PATCH", 0, "2026-09-15T16:20:00.000Z");
  ins.run(789, "f", 3, "network", "/api/v3/prospects/3/phone_numbers", "PATCH", 0, "2026-09-15T16:21:00.000Z");
  // Another CLR's single call is theirs.
  ins.run(369, "g", 1, "network", "/api/v3/prospects/1/call", "POST", 1, "2026-09-15T16:04:15.000Z");
  const rows = db.prepare(`SELECT assistant_id, d, calls FROM ${BONZO_CALLS_BY_DAY_SQL} ORDER BY assistant_id`).all();
  assert.deepEqual(rows, [
    { assistant_id: 369, d: "2026-09-15", calls: 1 },
    { assistant_id: 789, d: "2026-09-15", calls: 3 },
  ]);
});

test("the server is wired: extension-key auth, the guard exception, the EOD figure, and the counted-calls fragment", () => {
  const routes = read("server/routes.ts");
  // On the guard's exception line (which now also carries the extension's outcome paths).
  assert.match(routes, /req\.path === "\/bonzo-calls"[\s\S]{0,200}?\) return next\(\);/);
  assert.match(routes, /app\.post\("\/api\/bonzo-calls", shotgunExtensionAuth,/);
  assert.match(routes, /app\.get\("\/api\/bonzo-calls\/observed", requireAuth,/);
  assert.match(routes, /bonzoCallsToday: storageExtra\.bonzoCallsForUserDay\(/);
  assert.match(routes, /res\.json\(\{ report, activities, callToolsActivity, dialpadActivity, bonzoActivity \}\);/);
  const shared = read("shared/self-reported.ts");
  assert.match(shared, /FROM \$\{BONZO_CALLS_BY_DAY_SQL\} WHERE d >= '\$\{SELF_REPORTED_CUTOFF\}'/);
  const storage = read("server/storage.ts");
  assert.match(storage, /CREATE TABLE IF NOT EXISTS bonzo_call_events/);
  assert.match(storage, /calls_made: \(Number\(r\.dialpad_calls \?\? 0\) \|\| 0\) \+ bonzoCallsForUserDay\(orgId, assistantId, date\)/);
  // The per-user/day call-log row folds Dialpad and Bonzo into ONE row, so a
  // dashboard that `find`s a person's row sees the whole number.
  assert.match(storage, /FROM \$\{BONZO_CALLS_BY_DAY_SQL\}\s*\n\s*WHERE d >= '\$\{SELF_REPORTED_CUTOFF\}'\s*\n\s*\)\s*\n\s*GROUP BY org_id, d, assistant_id/);
});

test("the extension is wired end to end and its version moved", () => {
  const content = read("chrome-extension/content.js");
  assert.match(content, /d\.type !== "C3_BONZO_CALL"/);
  assert.match(content, /type: "c3shotgun\.call"/);
  assert.match(content, /a\[href\^="tel:"\], button, \[role="button"\]/);
  const background = read("chrome-extension/background.js");
  assert.match(background, /msg\.type === "c3shotgun\.call"/);
  assert.match(background, /c3\("\/api\/bonzo-calls", \{/);
  const popup = read("chrome-extension/popup.js");
  assert.match(popup, /bonzoCallsToday/);
  const manifest = JSON.parse(read("chrome-extension/manifest.json"));
  // 1.3.0 added the call tracker; 1.4.0 added the result panel on top of it.
  assert.ok(["1.3.0", "1.4.0"].includes(manifest.version) || manifest.version > "1.4.0", `unexpected extension version ${manifest.version}`);
  const eod = read("client/src/pages/eod-report.tsx");
  assert.match(eod, /data-testid="bonzo-calls-line"/);
});
