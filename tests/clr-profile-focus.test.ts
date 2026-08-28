import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-profile.tsx"), "utf8");

test("the daily series comes from the dialer, not from self-reported numbers", () => {
  const block = routes.slice(routes.indexOf("const DAILY_TREND_MAX_DAYS"), routes.indexOf("// Weekly goals (per-CLR override falls back"));
  // The old chart's tallest bars were daily_call_logs.calls_made — the
  // "Additional Calls" box a CLR types into their own EOD form.
  assert.ok(!block.includes("getCallLogsByRange"), "the self-reported call log must not drive the chart");
  assert.match(block, /FROM callsync_agent_activity_daily/, "call time");
  assert.match(block, /SUM\(conversation\)/, "conversations");
  assert.match(block, /FROM dialpad_daily_stats/, "dialpad calls");
  // Every feed query is org- AND user-scoped.
  for (const m of block.matchAll(/WHERE org_id=\? AND (assistant_id|user_id)=\?/g)) assert.ok(m);
  assert.equal((block.match(/WHERE org_id=\? AND (assistant_id|user_id)=\?/g) ?? []).length, 4);
});

test("the five focus metrics are all emitted per day", () => {
  const block = routes.slice(routes.indexOf("const daily = dailyTooLong"), routes.indexOf("// Weekly goals (per-CLR override falls back"));
  for (const f of ["callMinutes", "dialpadCalls", "callToolsCalls", "conversations", "transfers", "appointments"]) {
    assert.ok(block.includes(f), `daily rows must carry ${f}`);
  }
  // Call time is stored in seconds and shown in minutes.
  assert.match(block, /Math\.round\(\(callTimeByDay\.get\(day\) \?\? 0\) \/ 60\)/);
});

test("a feed that has never run degrades to zero instead of a 500", () => {
  const helper = routes.slice(routes.indexOf("const numByDay ="), routes.indexOf("const callTimeByDay"));
  assert.match(helper, /catch \{/, "a missing table must not break the profile");
});

test("manager notes are dated, and are never a metric", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS clr_notes/);
  assert.match(storage, /note_date TEXT NOT NULL/);
  assert.match(storage, /idx_clr_notes_subject/);
  // The whole point: nothing aggregates them.
  const profileRoute = routes.slice(routes.indexOf('app.get("/api/clr-profiles/:id", requireAuth'), routes.indexOf("// Weekly goals (per-CLR override falls back"));
  assert.ok(!profileRoute.includes("clr_notes"), "the profile payload must not read notes into any metric");
  assert.ok(!/clr_notes/.test(routes.slice(routes.indexOf("const daily = dailyTooLong"), routes.indexOf("// Weekly goals (per-CLR override falls back"))));
  assert.match(page, /Notes are never counted in any statistic or chart/);
});

test("notes are manager-gated, org-scoped and audited", () => {
  const get = routes.slice(routes.indexOf('app.get("/api/clr-profiles/:id/notes"'), routes.indexOf('app.post("/api/clr-profiles/:id/notes"'));
  const post = routes.slice(routes.indexOf('app.post("/api/clr-profiles/:id/notes"'), routes.indexOf('app.delete("/api/clr-profiles/notes/:noteId"'));
  for (const block of [get, post]) {
    assert.match(block, /requireManagerOrAdmin\(req, res\)/);
    // getUserById is not org-scoped — without this a manager could reach
    // another tenant's people.
    assert.match(block, /uOrg !== orgId\)\) return res\.status\(404\)/);
  }
  assert.match(post, /audit\(\{/);
  // Only the author or an admin may delete.
  const del = storage.slice(storage.indexOf("export function deleteClrNote"), storage.indexOf("// ── Email send ledger"));
  assert.match(del, /!actorIsAdmin && Number\(row\.author_user_id\) !== actorUserId/);
});

test("the page lets a manager pick which metric to plot", () => {
  assert.match(page, /const DAILY_SERIES = \[/);
  for (const label of ["Call time", "Dialpad calls", "CallTools calls", "Conversations", "Transfers", "Appointments"]) {
    assert.ok(page.includes(label), `the picker should offer ${label}`);
  }
  assert.match(page, /data-testid=\{"clr-series-" \+ sdef\.key\}/);
  // A real chart with axes, not hand-computed pixel heights.
  assert.match(page, /<BarChart data=\{data\.daily\}/);
  assert.ok(!page.includes("peakCalls"), "the hand-drawn pixel bars must be gone");
  assert.match(page, /data-testid="clr-note-save"/);
});
