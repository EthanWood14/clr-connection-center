import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("changing check-in settings is recorded with before and after", () => {
  // The approved-IP list was corrected on 2026-08-05 and was back to a dead
  // IPv6 address by 2026-08-08. Because this route wrote no audit row, there
  // was no way to tell who saved what, or when — the only clue was every
  // check-in silently reading off-network.
  const route = routes.slice(
    routes.indexOf(`app.post("/api/checkin/settings"`),
    routes.indexOf("// Per-user pay rates"),
  );
  assert.match(route, /requireAdminSession\(req, res\)/, "settings stay admin-only");
  assert.match(route, /entityType: "checkin_settings"/, "the change must be attributable");
  assert.match(route, /const before = checkinConfig\(\);/, "capture state before the write");
  assert.match(route, /const after = checkinConfig\(\);/, "…and after it");
  assert.match(route, /allowedIps: before\.allowedIps/, "the approved-IP list is the field that matters");
  assert.match(route, /allowedIps: after\.allowedIps/);
  assert.match(route, /savedFromIp: requestIp\(req\)/,
    "where the save came from distinguishes an office edit from a remote one");
  // The audit must not be skipped when nothing changed, but must not fire on a
  // no-op request either — it is inside the same guard as the write.
  assert.ok(
    route.indexOf("if (Object.keys(patch).length)") < route.indexOf("entityType: \"checkin_settings\""),
    "the audit belongs with the write, not before the guard",
  );
});
