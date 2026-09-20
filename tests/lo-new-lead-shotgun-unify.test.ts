import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LO_NEW_LEAD_FLOOR_AFTER_MS, LO_NEW_LEAD_HEAD_START_MS, loNewLeadHeadStartUntil,
} from "../shared/lo-new-leads";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * Fresh assigned-LO leads enter Shotgun immediately with a ~45s assignee
 * head-start, then Ready CLR rotation — not a forever-separate card system.
 */

test("head-start stays 45 seconds (documented choice — not zero)", () => {
  assert.equal(LO_NEW_LEAD_HEAD_START_MS, 45_000);
  assert.equal(LO_NEW_LEAD_HEAD_START_MS, LO_NEW_LEAD_FLOOR_AFTER_MS);
  assert.equal(loNewLeadHeadStartUntil("2026-09-20T18:00:00.000Z"), "2026-09-20T18:00:45.000Z");
  const shared = read("shared/lo-new-leads.ts");
  assert.match(shared, /Documented choice: keep ~45s/);
  assert.match(shared, /immediately publishes a Shotgun lead/);
});

test("announceFreshLoLeads creates a Shotgun lead with preferred assignees + head-start", () => {
  const routes = read("server/routes.ts");
  const announce = routes.slice(routes.indexOf("function announceFreshLoLeads("), routes.indexOf("function newestLeadsDeps("));
  assert.match(announce, /createShotgunLeadFromFields\(/);
  assert.match(announce, /preferredAssigneeIds: assigned/);
  assert.match(announce, /headStartUntil/);
  assert.match(announce, /loNewExternalId: String\(lead\.externalId\)/);
  assert.match(announce, /\}, "lo-feed"\)/);
  assert.match(announce, /markLoNewLeadEscalated\(/);
  assert.match(announce, /url: "\/#\/shotgun"/);
  assert.doesNotMatch(announce, /3 min before Shotgun/);
});

test("assignShotgunLead honors head-start preferred pool before Ready rotation", () => {
  const routes = read("server/routes.ts");
  const assign = routes.slice(routes.indexOf("function assignShotgunLead"), routes.indexOf("function advanceShotgun"));
  assert.match(assign, /inHeadStart/);
  assert.match(assign, /preferred_assignee_ids/);
  assert.match(assign, /head_start_until/);
  assert.match(assign, /u\.id IN \(\$\{placeholders\}\)/);
  // Ready required only after head-start
  assert.match(assign, /r\.is_ready=1 AND r\.heartbeat_at>=\?/);
});

test("floor cards skip leads already linked to Shotgun — no competing claim button", () => {
  const storage = read("server/storage.ts");
  assert.match(storage, /shotgun_lead_id IS NULL/);
  assert.match(storage, /competing claim button/);
  const alert = read("client/src/components/assigned-lo-lead-alert.tsx");
  assert.match(alert, /ShotgunOfferAlert is the only claim UX/);
});

test("lo-feed may publish without state; Dialpad open stamps first_dial_at from offer call", () => {
  const routes = read("server/routes.ts");
  assert.match(routes, /via !== "lo-feed"/);
  const offer = read("client/src/components/shotgun-offer-alert.tsx");
  assert.match(offer, /\/api\/shotgun\/\$\{offered\.id\}\/open-phone/);
});
