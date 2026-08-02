import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/comp-requests.tsx"), "utf8");

test("manager Ask Manager action notifies the comp requester", () => {
  const endpointStart = routes.indexOf('app.post("/api/comp/:id/ask-manager"');
  const endpointEnd = routes.indexOf('app.post("/api/comp/:id/paid"', endpointStart);
  assert.ok(endpointStart >= 0 && endpointEnd > endpointStart);

  const endpoint = routes.slice(endpointStart, endpointEnd);
  assert.match(endpoint, /isCompManager/);
  assert.match(endpoint, /WHERE id=\? AND org_id=\?/);
  assert.match(endpoint, /userId: r\.user_id/);
  assert.match(endpoint, /Please talk to your managers about your comp request/);
  assert.match(endpoint, /sendPushToUser\(r\.user_id/);
});

test("team Ask Manager button calls the notification endpoint", () => {
  assert.match(page, /api\/comp\/" \+ id \+ "\/ask-manager/);
  assert.match(page, /data-testid=\{"team-ask-manager-" \+ r\.id\}/);
  assert.match(page, /onClick=\{\(\) => askManagerMutation\.mutate\(r\.id\)\}/);
});
