import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  BONZO_CONTACTS_VIEWED_BY_DAY_SQL, BONZO_CONVERSATIONS_VIEWED_BY_DAY_SQL, BONZO_VIEW_TYPES,
} from "../shared/bonzo-views";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

test("view types are contact and conversation only", () => {
  assert.deepEqual([...BONZO_VIEW_TYPES], ["contact", "conversation"]);
});

test("one unique view per CLR per target per business day", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE bonzo_view_events (
    id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER, event_id TEXT,
    view_type TEXT, target_id INTEGER, prospect_id INTEGER, occurred_at TEXT, business_date TEXT,
    UNIQUE(org_id, event_id),
    UNIQUE(org_id, user_id, view_type, target_id, business_date)
  )`);
  const ins = db.prepare(`INSERT OR IGNORE INTO bonzo_view_events
    (org_id, user_id, event_id, view_type, target_id, prospect_id, occurred_at, business_date)
    VALUES (1, ?, ?, ?, ?, ?, ?, '2026-09-18')`);
  assert.equal(ins.run(10, "a", "contact", 100, 100, "2026-09-18T10:00:00Z").changes, 1);
  assert.equal(ins.run(10, "b", "contact", 100, 100, "2026-09-18T11:00:00Z").changes, 0);
  assert.equal(ins.run(10, "c", "contact", 101, 101, "2026-09-18T12:00:00Z").changes, 1);
  assert.equal(ins.run(10, "d", "conversation", 200, 100, "2026-09-18T13:00:00Z").changes, 1);
  assert.equal(ins.run(10, "e", "conversation", 200, 100, "2026-09-18T14:00:00Z").changes, 0);
  assert.equal(ins.run(11, "f", "contact", 100, 100, "2026-09-18T10:00:00Z").changes, 1);

  const contacts = db.prepare(`SELECT assistant_id, d, contacts FROM ${BONZO_CONTACTS_VIEWED_BY_DAY_SQL} ORDER BY assistant_id`).all();
  assert.deepEqual(contacts, [
    { assistant_id: 10, d: "2026-09-18", contacts: 2 },
    { assistant_id: 11, d: "2026-09-18", contacts: 1 },
  ]);
  const convos = db.prepare(`SELECT assistant_id, d, conversations FROM ${BONZO_CONVERSATIONS_VIEWED_BY_DAY_SQL} ORDER BY assistant_id`).all();
  assert.deepEqual(convos, [
    { assistant_id: 10, d: "2026-09-18", conversations: 1 },
  ]);
});

test("server and extension are wired for Bonzo views", () => {
  const routes = read("server/routes.ts");
  assert.match(routes, /\/bonzo-views/);
  assert.match(routes, /app\.post\("\/api\/bonzo-views", shotgunExtensionAuth,/);
  assert.match(routes, /bonzoContactsToday: storageExtra\.bonzoContactsViewedForUserDay\(/);
  assert.match(routes, /bonzoConversationsToday: storageExtra\.bonzoConversationsViewedForUserDay\(/);
  assert.match(routes, /bonzoCalls: lbBonzoCalls\.get\(/);
  assert.match(routes, /bonzoContacts: lbBonzoViews\.get\(/);
  assert.match(routes, /bonzoConversations: lbBonzoViews\.get\(/);

  const storage = read("server/storage.ts");
  assert.match(storage, /CREATE TABLE IF NOT EXISTS bonzo_view_events/);
  assert.match(storage, /export function insertBonzoViewEvents/);

  const background = read("chrome-extension/background.js");
  assert.match(background, /c3shotgun\.view/);
  assert.match(background, /\/api\/bonzo-views/);

  const content = read("chrome-extension/content.js");
  assert.match(content, /c3shotgun\.view/);
  assert.match(content, /"contact"/);
  assert.match(content, /"conversation"/);

  const dash = read("client/src/pages/manager-dashboard.tsx");
  assert.match(dash, /label: "Bonzo Calls"/);
  assert.match(dash, /label: "Bonzo Contacts"/);
  assert.match(dash, /label: "Bonzo Convos"/);
});
