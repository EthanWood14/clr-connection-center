import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RETAIL_DESK_BONZO_EMAIL,
  isRetailDeskBonzoEmail,
  isRetailDeskBonzoName,
  isRetailDeskShotgunLead,
} from "../shared/retail-bonzo-shotgun";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

test("the retail desk seat is the pool Bonzo login, lowercased", () => {
  assert.equal(RETAIL_DESK_BONZO_EMAIL, "ktabrizi2old@westcapitallending.com");
  assert.equal(isRetailDeskBonzoEmail("KTabrizi2OLD@westcapitallending.com"), true);
  assert.equal(isRetailDeskBonzoEmail("credoble@westcaplending.com"), false);
});

test("display-name match covers the Team Members Only pool seat label", () => {
  assert.equal(isRetailDeskBonzoName("Chris Redoble Retail (Team Members Only)"), true);
  assert.equal(isRetailDeskBonzoName("Khashi Tabrizi OLD"), false);
  assert.equal(isRetailDeskBonzoName("Christopher Redoble"), false);
});

test("Shotgun-immediate is any lead on that Bonzo seat — every pipeline", () => {
  assert.equal(isRetailDeskShotgunLead(RETAIL_DESK_BONZO_EMAIL), true);
  assert.equal(isRetailDeskShotgunLead(RETAIL_DESK_BONZO_EMAIL, "whatever"), true);
  assert.equal(isRetailDeskShotgunLead(null, "Chris Redoble Retail (Team Members Only)"), true);
  assert.equal(isRetailDeskShotgunLead("imilitello@westcapitallending.com", "Ian Militello"), false);
});

test("boot starts an always-on Retail desk watcher that queues Shotgun leads", () => {
  const index = read("server/index.ts");
  assert.match(index, /startRetailBonzoShotgunWatcher/);
  assert.match(index, /from "\.\/retail-bonzo-shotgun-watcher"/);
  const watcher = read("server/retail-bonzo-shotgun-watcher.ts");
  assert.match(watcher, /RETAIL_DESK_BONZO_EMAIL/);
  assert.match(watcher, /publishRetailDeskShotgunLeads/);
  assert.match(watcher, /insertQueuedShotgunLead/);
  assert.match(watcher, /status.*queued/);
  assert.match(watcher, /takeLoNewLeadForEscalation/);
  assert.match(watcher, /finishLoNewLeadEscalation/);
  assert.match(watcher, /newestLeadsForLos/);
  assert.match(watcher, /loNewLeadIsFresh/);
  assert.match(watcher, /isRetailDeskShotgunLead/);
  // Dedup against active Shotgun phone/email before insert.
  assert.match(watcher, /already active in Shotgun/);
});
