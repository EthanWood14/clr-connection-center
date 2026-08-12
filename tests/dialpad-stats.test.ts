import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  agentKey, matchAgent, dailyCallsByDate, flattenAgentStats,
  type Identity,
} from "../server/dialpad-stats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const routes = read("server/routes.ts");
const eodForm = read("client/src/pages/eod-report.tsx");

// The real feed: 28 agents, of whom only some are spelled the way C3 spells them.
const USERS: Identity[] = [
  { id: 740, name: "Jeremy Lapiz" },
  { id: 731, name: "Kristi Roberts" },
  { id: 369, name: "Matt Lane" },
  { id: 1, name: "Ethan Wood" },
];

test("agent names match despite spelling noise", () => {
  // "Bill  Neessen" carries a double space in the live feed.
  assert.equal(agentKey("Bill  Neessen"), agentKey("Bill Neessen"));
  assert.equal(agentKey("Jeremy Lapiz"), agentKey("jeremy lapiz"));
  assert.equal(agentKey("O'Brien-Smith"), agentKey("obriensmith"));
  // …but genuinely different people must not collide.
  assert.notEqual(agentKey("Matt Lane"), agentKey("Matthew Lane"));
});

test("an exact name match resolves to that user", () => {
  const m = matchAgent("Kristi Roberts", USERS, new Map());
  assert.equal(m.userId, 731);
  assert.equal(m.via, "name");
});

test("a name the feed spells differently stays unmatched until it is mapped", () => {
  // This is the real case: the feed says "Matthew Lane", C3 says "Matt Lane".
  const before = matchAgent("Matthew Lane", USERS, new Map());
  assert.equal(before.userId, null);
  assert.equal(before.via, "unmatched");

  const links = new Map([[agentKey("Matthew Lane"), 369]]);
  const after = matchAgent("Matthew Lane", USERS, links);
  assert.equal(after.userId, 369);
  assert.equal(after.via, "link");
});

test("an explicit mapping beats a name that happens to match", () => {
  // Somebody's recorded decision must not be undone by a coincidental rename.
  const links = new Map([[agentKey("Kristi Roberts"), 1]]);
  const m = matchAgent("Kristi Roberts", USERS, links);
  assert.equal(m.userId, 1);
  assert.equal(m.via, "link");
});

test("an empty or unusable agent name never matches anyone", () => {
  for (const bad of ["", "   ", "!!!", null, undefined]) {
    assert.equal(matchAgent(bad as any, USERS, new Map()).userId, null);
  }
});

test("per-day counts come from by_day, not the window total", () => {
  // calls_total is a rolling window; using it for a single day would report a
  // week's calls as though they all happened today.
  const byDate = dailyCallsByDate({
    agent: "Kristi Roberts", calls_total: 133,
    by_day: [{ date: "2026-08-05", calls: 21 }, { date: "2026-08-06", calls: 30 }],
  });
  assert.equal(byDate.get("2026-08-05"), 21);
  assert.equal(byDate.get("2026-08-06"), 30);
  assert.ok(!Array.from(byDate.values()).includes(133));
});

test("malformed day rows are skipped, and repeated dates add up", () => {
  const byDate = dailyCallsByDate({
    agent: "X",
    by_day: [
      { date: "2026-08-05", calls: 5 },
      { date: "2026-08-05", calls: 3 },      // a second entry adds, not replaces
      { date: "not-a-date", calls: 9 } as any,
      { date: "2026-08-06", calls: -4 },     // negative is nonsense
      { date: "2026-08-07", calls: NaN } as any,
    ],
  });
  assert.equal(byDate.get("2026-08-05"), 8);
  assert.equal(byDate.has("2026-08-06"), false);
  assert.equal(byDate.has("2026-08-07"), false);
  assert.equal(byDate.has("not-a-date"), false);
});

test("unmatched agents are kept, not silently dropped", () => {
  // The feed carries loan officers dialling for themselves and staff who are
  // not in C3. Dropping them here would leave the mapping screen with nothing
  // to show, so nobody could ever fix the mapping.
  const flat = flattenAgentStats(
    [
      { agent: "Kristi Roberts", by_day: [{ date: "2026-08-05", calls: 21 }] },
      { agent: "John Hernandez", by_day: [{ date: "2026-08-05", calls: 167 }] },
    ],
    USERS, new Map(),
  );
  assert.equal(flat.length, 2);
  const john = flat.find((r) => r.agent === "John Hernandez")!;
  assert.equal(john.userId, null);
  assert.equal(john.calls, 167);
});

test("the sync only considers C3 staff as candidates", () => {
  const fn = routes.slice(routes.indexOf("async function syncDialpadStats"), routes.indexOf(`cron.schedule("15 * * * *"`));
  assert.match(fn, /portal == null \|\| u\.portal === "c3"/,
    "portal accounts are outside staff and must not absorb a CLR's calls");
  assert.match(fn, /isActive \?\? u\.is_active/);
  assert.match(fn, /getDialpadAgentLinks\(orgId\)/);
});

test("re-syncing the same day does not double-count", () => {
  const s = read("server/storage.ts");
  const fn = s.slice(s.indexOf("export function upsertDialpadDailyStat"), s.indexOf("export function getDialpadCallsFor"));
  assert.match(fn, /ON CONFLICT\(org_id, stat_date, agent_key\) DO UPDATE/,
    "the pull re-runs hourly over a 7-day window, so it must be idempotent");
  assert.match(fn, /calls=excluded\.calls/, "a corrected upstream count must replace the old one");
});

test("mapping an agent is manager-gated and audited", () => {
  const route = routes.slice(routes.indexOf(`app.post("/api/dialpad/agents/link"`), routes.indexOf(`app.post("/api/dialpad/sync"`));
  assert.match(route, /requireManagerOrAdmin\(req, res\)/);
  assert.match(route, /User not found in your organization/, "an agent must not be mapped across orgs");
  assert.match(route, /entityType: "dialpad_agent_link"/, "reattributing call credit must be traceable");
  assert.match(route, /syncDialpadStats\(orgId\)/, "a new mapping must apply to days already pulled");
});

test("Dialpad appears as an imported figure, not folded into a manual field", () => {
  // The EOD form now shows imported activity (CallTools conversations, active
  // time) as read-only tiles, and its number inputs mean "work done OUTSIDE the
  // connected dialer". Prefilling one of those with a Dialpad total would double
  // count against the imported figures, so Dialpad gets its own tile.
  assert.match(eodForm, /data-testid="dialpad-calls-tile"/);
  assert.match(eodForm, /Dialpad Calls/);
  assert.match(eodForm, /dialpadActivity/, "the payload must carry the imported figure");
  const tile = eodForm.slice(eodForm.indexOf('data-testid="dialpad-calls-tile"'));
  assert.match(tile.slice(0, 800), /Not linked to a Dialpad agent yet/,
    "an unmapped CLR must be told why their number is zero, not shown a bare 0");
});

test("a filed report keeps the number it was filed with", () => {
  // The pull re-runs hourly over a rolling week. Without a snapshot, a later
  // correction upstream would silently rewrite an already-submitted report.
  assert.match(read("server/storage.ts"), /ALTER TABLE eod_reports ADD COLUMN dialpad_calls/);
  const upsert = read("server/storage.ts");
  assert.match(upsert, /dialpad_calls=excluded\.dialpad_calls/);
  assert.match(routes, /dialpadCalls: storageExtra\.getDialpadCallsFor\(/,
    "submit must snapshot the figure");
  assert.match(eodForm, /report\?\.dialpad_calls \?\? data\?\.dialpadActivity\?\.calls/,
    "a saved report's snapshot must win over the live figure");
});

test("an account-wide feed is not duplicated across orgs", () => {
  // The feed is one LeadVault account, not one per org. Pulling it inside the
  // per-org loop wrote a complete duplicate of every agent-day under the demo
  // org with user_id null — 176 phantom rows that made the mapping screen list
  // the entire roster as unmapped.
  const fn = routes.slice(routes.indexOf("async function syncDialpadStats"), routes.indexOf(`cron.schedule("15 * * * *"`));
  assert.match(fn, /if \(!flat\.some\(\(r\) => r\.userId != null\)\)/,
    "an org that matches no agent in the feed must write nothing");
  assert.ok(
    fn.indexOf("no agent in the feed maps to this org") < fn.indexOf("upsertDialpadDailyStat"),
    "the guard must come before any write",
  );
});

test("the trend reads only this org's mapped agents", () => {
  const block = routes.slice(routes.indexOf("const dialpadByDate"), routes.indexOf("const trendMap"));
  assert.match(block, /org_id = \?/, "scoped by org");
  assert.match(block, /user_id IS NOT NULL/, "unattributed agents never reach a team total");
});

test("the sync avoids the upstream window that returns a truncated roster", () => {
  // Measured against the live feed on 2026-08-12, seconds apart:
  //   days=1  -> 42 agents, 16,019 calls
  //   days=3  -> 42 agents, 16,019
  //   days=7  -> 34 agents,  3,552   <-- reproducible, and what the sync used
  //   days=30 -> 42 agents, 16,019
  // Every window agreed 2026-08-11 was 722, so the daily split is sound; the
  // seven-day window simply drops agents and volume.
  const fn = routes.slice(routes.indexOf("const DIALPAD_SYNC_DAYS"), routes.indexOf("async function fetchDialpadAgents"));
  assert.match(fn, /DIALPAD_SYNC_DAYS = 30/, "7 is the one window the upstream gets wrong");
  assert.ok(!/DIALPAD_SYNC_DAYS = 7/.test(fn));
});
