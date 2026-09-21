import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { formatSlaSeconds, summarizeShotgunSla, summarizeShotgunSlaByClr, SHOTGUN_DIAL_SLA_MS, SHOTGUN_UNCLAIMED_CLAIM_SECONDS } from "../shared/shotgun-sla";
import { computeShotgunSla, computeShotgunSlaByClr, resolveFirstDialAt } from "../server/shotgun-sla";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

test("claimed vs unclaimed stay separate — no blended under-30s vanity rate", () => {
  const summary = summarizeShotgunSla([
    { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: null, status: "queued", firstDialAt: null },
    { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: null, status: "offered", firstDialAt: null },
    { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: "2026-09-20T15:00:10.000Z", status: "claimed", firstDialAt: "2026-09-20T15:00:40.000Z" },
    { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: "2026-09-20T15:00:20.000Z", status: "done", firstDialAt: null },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.unclaimed, 2);
  assert.equal(summary.claimed, 2);
  assert.equal(summary.unclaimedPct, 50);
  assert.equal(summary.claimedPct, 50);
  // Two actual claims (10s, 20s), two unclaimed (240s each).
  assert.equal(summary.medianClaimSeconds, 130);
  assert.equal(summary.averageClaimSeconds, 127.5);
  assert.equal(summary.dialedUnder60sCount, 1);
  assert.equal(summary.dialedUnder60sPct, 50);
  assert.equal(summary.claimedWithoutDialEvidence, 1);
});

test("actual claims keep their real times; exclude_from_stats drops claimer", () => {
  const summary = summarizeShotgunSla([
    { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: "2026-09-20T15:00:05.000Z", status: "claimed", firstDialAt: "2026-09-20T15:00:10.000Z" },
    { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: "2026-09-20T15:01:00.000Z", status: "claimed", firstDialAt: "2026-09-20T15:01:10.000Z" },
    { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: "2026-09-20T15:00:01.000Z", status: "claimed", firstDialAt: "2026-09-20T15:00:02.000Z", claimantExcluded: true },
  ]);
  assert.equal(summary.claimed, 2);
  assert.equal(summary.medianClaimSeconds, 32.5);
  assert.equal(summary.averageClaimSeconds, 32.5);
  assert.equal(summary.dialedUnder60sCount, 2);
  assert.equal(SHOTGUN_DIAL_SLA_MS, 60_000);
  assert.equal(formatSlaSeconds(12.5), "12.5s");
  assert.equal(formatSlaSeconds(65), "1m 05s");
  assert.equal(formatSlaSeconds(null), "—");
});

test("dial proxy prefers first_dial_at over bonzo path match; never invents from called flag", () => {
  const map = new Map([["7:5555550100", "2026-09-20T15:00:50.000Z"]]);
  assert.equal(resolveFirstDialAt({
    firstDialAt: "2026-09-20T15:00:20.000Z",
    claimedAt: "2026-09-20T15:00:10.000Z",
    claimantId: 7,
    phone: "+15555550100",
    bonzoByUserPhone: map,
  }), "2026-09-20T15:00:20.000Z");
  assert.equal(resolveFirstDialAt({
    firstDialAt: null,
    claimedAt: "2026-09-20T15:00:10.000Z",
    claimantId: 7,
    phone: "555-555-0100",
    bonzoByUserPhone: map,
  }), "2026-09-20T15:00:50.000Z");
  assert.equal(resolveFirstDialAt({
    firstDialAt: null,
    claimedAt: "2026-09-20T15:00:10.000Z",
    claimantId: 7,
    phone: "555-555-0199",
    bonzoByUserPhone: map,
  }), null);
});

test("computeShotgunSla is org-scoped and skips exclude_from_stats claimants", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, exclude_from_stats INTEGER DEFAULT 0);
    INSERT INTO users VALUES (1,1,0),(2,1,1),(3,2,0);
    CREATE TABLE shotgun_leads (
      id INTEGER PRIMARY KEY, org_id INTEGER, created_at TEXT, claimed_at TEXT, status TEXT,
      first_dial_at TEXT, phone TEXT, phone_key TEXT, current_assignee_id INTEGER
    );
    CREATE TABLE shotgun_offer_events (
      id INTEGER PRIMARY KEY, lead_id INTEGER, org_id INTEGER, user_id INTEGER,
      offered_at TEXT, expires_at TEXT, response TEXT, responded_at TEXT
    );
    CREATE TABLE bonzo_call_events (
      id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER, occurred_at TEXT, path TEXT, counts INTEGER
    );
    INSERT INTO shotgun_leads VALUES
      (1,1,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:12.000Z','claimed','2026-09-20T15:00:30.000Z','5555550100','5555550100',1),
      (2,1,'2026-09-20T15:00:00.000Z',NULL,'queued',NULL,'5555550101','5555550101',NULL),
      (3,1,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:05.000Z','claimed','2026-09-20T15:00:10.000Z','5555550102','5555550102',2),
      (4,2,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:08.000Z','claimed','2026-09-20T15:00:15.000Z','5555550103','5555550103',3);
    INSERT INTO shotgun_offer_events VALUES
      (1,1,1,1,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:10.000Z','confirmed','2026-09-20T15:00:12.000Z'),
      (2,3,1,2,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:10.000Z','confirmed','2026-09-20T15:00:05.000Z');
  `);
  const summary = computeShotgunSla(db, 1, "2026-09-20T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
  assert.equal(summary.total, 3);
  assert.equal(summary.unclaimed, 1);
  assert.equal(summary.claimed, 1); // excluded claimant dropped from claimed count
  assert.equal(summary.medianClaimSeconds, 126); // actual 12s + unclaimed 240s
  assert.equal(summary.averageClaimSeconds, 126);
  assert.equal(summary.dialedUnder60sCount, 1);
  db.close();
});

test("routes expose SLA API; open-phone stamps first_dial_at; pages mount scoreboard", () => {
  const routes = read("server/routes.ts");
  const storage = read("server/storage.ts");
  assert.match(storage, /first_dial_at TEXT/);
  assert.match(storage, /head_start_until TEXT/);
  assert.match(storage, /preferred_assignee_ids TEXT/);
  assert.match(routes, /app\.get\("\/api\/shotgun\/sla"/);
  assert.match(routes, /computeShotgunSla/);
  assert.match(routes, /first_dial_at=COALESCE\(first_dial_at/);
  assert.match(read("client/src/pages/shotgun.tsx"), /ShotgunSlaScoreboard/);
  assert.doesNotMatch(read("client/src/pages/manager-dashboard.tsx"), /ShotgunSlaScoreboard/);
  const board = read("client/src/components/shotgun-sla-scoreboard.tsx");
  assert.match(board, /data-testid="shotgun-sla-scoreboard"/);
  assert.match(board, /Median claim/);
  assert.match(board, /Avg claim/);
  assert.match(board, /Unclaimed/);
  assert.match(board, /Claimed/);
  assert.doesNotMatch(board, /% claimed under 30/);
  assert.doesNotMatch(board, /Dialed <60s/);
  assert.doesNotMatch(board, /No dial proof/);
  assert.doesNotMatch(board, /dialedUnder60s/);
  // API payload for the board omits dial display fields
  assert.match(routes, /medianClaimSeconds: summary\.medianClaimSeconds/);
  assert.doesNotMatch(routes, /dialProxy:/);
});


test("per-CLR summarizer attributes claimed to claimant and expired offers to unclaimed", () => {
  const byClr = summarizeShotgunSlaByClr(
    [
      {
        createdAt: "2026-09-20T15:00:00.000Z",
        claimedAt: "2026-09-20T15:00:10.000Z",
        status: "claimed",
        firstDialAt: "2026-09-20T15:00:20.000Z",
        claimantId: 1,
      },
      {
        createdAt: "2026-09-20T15:00:00.000Z",
        claimedAt: "2026-09-20T15:00:30.000Z",
        status: "claimed",
        firstDialAt: null,
        claimantId: 1,
      },
      {
        createdAt: "2026-09-20T15:00:00.000Z",
        claimedAt: null,
        status: "queued",
        firstDialAt: null,
        claimantId: null,
      },
    ],
    [1, 2, 2], // CLR1 timed out once; CLR2 timed out twice
  );
  const a = byClr.get(1)!;
  assert.equal(a.claimed, 2);
  assert.equal(a.unclaimed, 1);
  assert.equal(a.medianClaimSeconds, 30);
  assert.equal(a.averageClaimSeconds, 93.3); // (10 + 30 + 240) / 3
  assert.equal(a.dialedUnder60sCount, 1);
  assert.equal(a.dialedUnder60sPct, 50);
  // claimed and unclaimed stay separate — not one blended under-30s rate
  assert.equal(a.claimedPct, Math.round((2 / 3) * 1000) / 10);
  assert.equal(a.unclaimedPct, Math.round((1 / 3) * 1000) / 10);
  const b = byClr.get(2)!;
  assert.equal(b.claimed, 0);
  assert.equal(b.unclaimed, 2);
  assert.equal(b.medianClaimSeconds, 240);
  assert.equal(b.averageClaimSeconds, 240);
  assert.equal(b.dialedUnder60sPct, null, "unclaimed offers do not invent a claim or dial");
});

test("computeShotgunSlaByClr joins expired offers to in-range leads", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, exclude_from_stats INTEGER DEFAULT 0);
    INSERT INTO users VALUES (1,1,0),(2,1,0);
    CREATE TABLE shotgun_leads (
      id INTEGER PRIMARY KEY, org_id INTEGER, created_at TEXT, claimed_at TEXT, status TEXT,
      first_dial_at TEXT, phone TEXT, phone_key TEXT, current_assignee_id INTEGER
    );
    CREATE TABLE shotgun_offer_events (
      id INTEGER PRIMARY KEY, lead_id INTEGER, org_id INTEGER, user_id INTEGER,
      offered_at TEXT, expires_at TEXT, response TEXT, responded_at TEXT
    );
    CREATE TABLE bonzo_call_events (
      id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER, occurred_at TEXT, path TEXT, counts INTEGER
    );
    INSERT INTO shotgun_leads VALUES
      (1,1,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:12.000Z','claimed','2026-09-20T15:00:30.000Z','5555550100','5555550100',1),
      (2,1,'2026-09-20T15:00:00.000Z',NULL,'queued',NULL,'5555550101','5555550101',NULL);
    INSERT INTO shotgun_offer_events VALUES
      (1,1,1,1,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:10.000Z','confirmed','2026-09-20T15:00:12.000Z'),
      (2,2,1,2,'2026-09-20T15:00:00.000Z','2026-09-20T15:00:20.000Z','expired','2026-09-20T15:00:20.000Z');
  `);
  const byClr = computeShotgunSlaByClr(db, 1, "2026-09-20T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
  assert.equal(byClr.get(1)?.claimed, 1);
  assert.equal(byClr.get(1)?.medianClaimSeconds, 12);
  assert.equal(byClr.get(2)?.unclaimed, 1);
  assert.equal(byClr.get(2)?.claimed ?? 0, 0);
  assert.equal(byClr.get(2)?.medianClaimSeconds, 240);
  assert.equal(byClr.get(2)?.averageClaimSeconds, 240);
  db.close();
});

test("unclaimed scoring is fixed at four minutes, while actual late claims are never capped", () => {
  assert.equal(SHOTGUN_UNCLAIMED_CLAIM_SECONDS, 240);
  const unclaimed = { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: null, status: "queued", firstDialAt: null };
  const lateClaim = { ...unclaimed, claimedAt: "2026-09-20T15:10:00.000Z", status: "claimed", claimantId: 1 };
  const summary = summarizeShotgunSla([unclaimed, lateClaim]);
  assert.equal(summary.medianClaimSeconds, 420);
  assert.equal(summary.averageClaimSeconds, 420); // 240 + real 600
  assert.equal(summary.claimed, 1);
  assert.equal(summary.unclaimed, 1);
  assert.equal(summary.claimedWithoutDialEvidence, 1);
  assert.equal(summary.dialedUnder60sPct, 0);
  const clr = summarizeShotgunSlaByClr([lateClaim], [1]).get(1)!;
  assert.equal(clr.averageClaimSeconds, 420);
  assert.equal(clr.medianClaimSeconds, 420);
  assert.equal(clr.claimed, 1);
  assert.equal(clr.unclaimed, 1);
  assert.equal(clr.dialedUnder60sPct, 0);
});

test("no claims or expired offers remain a dash, not an invented four-minute sample", () => {
  const empty = summarizeShotgunSla([]);
  assert.equal(empty.medianClaimSeconds, null);
  assert.equal(empty.averageClaimSeconds, null);
  assert.equal(summarizeShotgunSlaByClr([], []).size, 0);
  const pending = { createdAt: "2026-09-20T15:00:00.000Z", claimedAt: null, status: "offered", firstDialAt: null, claimantId: null };
  assert.equal(summarizeShotgunSlaByClr([pending], []).size, 0, "a still-pending offer is not a timed-out offer against a CLR");
  const allUnclaimed = summarizeShotgunSla([pending, { ...pending, status: "queued" }]);
  assert.equal(allUnclaimed.averageClaimSeconds, 240);
  assert.equal(allUnclaimed.medianClaimSeconds, 240);
  assert.equal(allUnclaimed.dialedUnder60sPct, null);
});

test("claim-time explanations disclose the four-minute scoring rule and do not imply a real claim", () => {
  const page = read("client/src/pages/manager-dashboard.tsx");
  const board = read("client/src/components/shotgun-sla-scoreboard.tsx");
  assert.match(page, /4 minutes for each unclaimed\/timed-out offer/);
  assert.match(page, /Actual claims over 4 minutes are not capped/);
  assert.match(page, /\(r\.slaClaimed \?\? 0\) \+ \(r\.slaUnclaimed \?\? 0\) > 0/);
  assert.match(board, /Unclaimed = 4 minutes/);
  assert.doesNotMatch(board, /sub="among claimed"/);
});
