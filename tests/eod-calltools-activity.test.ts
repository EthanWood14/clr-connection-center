import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("../server/storage.ts", import.meta.url), "utf8");
const eod = readFileSync(new URL("../client/src/pages/eod-report.tsx", import.meta.url), "utf8");
const outcomes = readFileSync(new URL("../client/src/pages/outcomes.tsx", import.meta.url), "utf8");

test("EOD snapshots server-owned CallTools conversations and active time", () => {
  assert.match(routes, /const importedActivity = callSyncActivitySummary\(reportDate, reportDate, Number\(userId\)\)/);
  assert.match(routes, /callToolsConversations: importedActivity\.conversations/);
  assert.match(routes, /callToolsActiveSeconds: importedActivity\.activeSeconds/);
  assert.match(storage, /calltools_conversations=excluded\.calltools_conversations/);
  assert.match(storage, /calltools_active_seconds=excluded\.calltools_active_seconds/);
});

test("manual calls, texts, and conversations remain optional additions", () => {
  assert.match(routes, /if \(value === null \|\| value === undefined \|\| value === ""\) return 0/);
  assert.match(eod, />Additional Calls</);
  assert.match(eod, />Additional Texts</);
  assert.match(eod, />Additional Conversations</);
  assert.doesNotMatch(eod, /disabled=\{submitMutation\.isPending \|\| !callsMade/);
});

test("CallTools call events feed active time and callbacks are no longer offered", () => {
  assert.match(routes, /normalized\.eventType === "calltools\.call" && normalized\.activeSeconds > 0/);
  assert.match(routes, /SUM\(active_seconds\)/);
  assert.doesNotMatch(outcomes, /value:\s*"callback_requested"/);
});
