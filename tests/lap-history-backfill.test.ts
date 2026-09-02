import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const at = (src: string, needle: string) => { const i = src.indexOf(needle); assert.ok(i >= 0, `missing: ${needle}`); return i; };
const flowStart = at(routes, "function autoFlowLapTransfers");
const flow = routes.slice(flowStart, at(routes, 'app.get("/api/lap/results"'));
const oneShot = routes.slice(at(routes, "function backfillLapTransferHistoryOnce"), at(routes, 'app.get("/api/lap/results"'));

test("the history pass is the cron's own function with the cutoff and the bell switched off", () => {
  // Ethan, 2026-09-02: every C3 transfer ever, in LAP, dated by the transfer.
  // One code path: the minute cron passes the epoch and rings the bell; the
  // history pass passes null (all time) and stays silent.
  assert.match(routes, /sinceCreatedAt: string \| null/);
  assert.match(flow, /= \{ sinceCreatedAt: LAP_AUTO_PACKAGE_EPOCH, notify: true \}/);
  assert.match(flow, /\$\{opts\.sinceCreatedAt \? "AND o\.created_at >= \?" : ""\}/);
  assert.match(flow, /if \(!opts\.notify\) continue;/);
  assert.match(oneShot, /autoFlowLapTransfers\(1, \{ sinceCreatedAt: null, untilCreatedAt: LAP_AUTO_PACKAGE_EPOCH, notify: false, maxRows: LAP_HISTORY_CHUNK \}\)/);
  // The package is dated by the transfer, never by the day it was created.
  assert.match(flow, /resultDate: row\.date,/);
});

test("the history pass runs exactly once, and a repeat is harmless", () => {
  assert.match(routes, /const LAP_HISTORY_BACKFILL_KEY = "lap_transfer_history_backfill_v1"/);
  assert.match(oneShot, /SELECT 1 FROM migrations_applied WHERE name=\?/);
  assert.match(oneShot, /INSERT OR IGNORE INTO migrations_applied \(name, applied_at\)/);
  // The key is recorded AFTER the pass, so a crash mid-way retries next boot,
  // and the link table's NOT EXISTS keeps the retry from double-creating.
  assert.ok(at(oneShot, "autoFlowLapTransfers(1, { sinceCreatedAt: null") < at(oneShot, "INSERT OR IGNORE INTO migrations_applied"));
  assert.match(flow, /NOT EXISTS \(SELECT 1 FROM lap_result_transfer_links t/);
  // It runs before the cron's boot pass (5s vs 10s) so history is in place first.
  assert.match(routes, /\}, 5_000\);/);
});

test("the history pass runs in chunks so a boot is never frozen", () => {
  // Rehearsal: 1,316 packages written back to back held the event loop for
  // 18 seconds. Each write is its own synchronous transaction, so the pass
  // has to hand the loop back between batches.
  assert.match(routes, /const LAP_HISTORY_CHUNK = \d+;/);
  assert.match(routes, /maxRows\?: number;/);
  assert.match(flow, /if \(opts\.maxRows && filed >= opts\.maxRows\) break;/);
  assert.match(oneShot, /setTimeout\(step, \d+\)/);
  // A chunk that files nothing ends the pass, so a row that fails every time
  // cannot loop for ever: only rows that were really filed count.
  assert.match(oneShot, /if \(filedNow > 0\)/);
  assert.match(flow, /return filed;/);
  // The key is written only after a chunk comes back empty.
  assert.ok(at(oneShot, "if (filedNow > 0)") < at(oneShot, "INSERT OR IGNORE INTO migrations_applied"));
});

test("the two passes split the transfers, so a live one still rings the bell", () => {
  // Caught in review. The history pass had no upper bound, so its rows were a
  // superset of the cron's. A transfer logged during the ~20s pass would be
  // filed by it with the bell off, and the minute cron would then skip it as
  // already linked — the assistant never heard about a live transfer.
  assert.match(routes, /untilCreatedAt\?: string;/);
  assert.match(flow, /\$\{opts\.untilCreatedAt \? "AND o\.created_at < \?" : ""\}/);
  assert.match(oneShot, /untilCreatedAt: LAP_AUTO_PACKAGE_EPOCH/);
  // Same boundary on both sides: the cron takes >= the epoch, history takes <.
  assert.match(flow, /if \(opts\.sinceCreatedAt\) bounds\.push\(opts\.sinceCreatedAt\);/);
  assert.match(flow, /if \(opts\.untilCreatedAt\) bounds\.push\(opts\.untilCreatedAt\);/);
  assert.match(flow, /\.all\(orgId, lo\.id, \.\.\.bounds\)/);
});

test("repeat borrowers in one pass share a package", () => {
  // The universe of packages grows as the pass creates them; a same-borrower
  // transfer within 7 days links to the package just made instead of making
  // a second one (23 such repeat groups in the real history).
  assert.match(flow, /for \(const transfer of transfers\)/);
  assert.match(flow, /const \[row\] = buildAuditRows\(\[transfer\], packages\);/);
  assert.match(flow, /packages\.push\(\{/);
  assert.match(flow, /if \(suggested\) \(suggested\.linkedOutcomeIds \?\?= \[\]\)\.push\(row\.outcomeId\);/);
  assert.match(flow, /row\.matchType === "suggested" && row\.packageId && gapDays <= 7/);
});
