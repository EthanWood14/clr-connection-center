import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateCostCents, REVIEW_SCHEMA, ROUTINE_MODEL, DEEP_MODEL, ROUTINE_INTERVAL_DAYS, DEEP_INTERVAL_DAYS, recentReleaseSummary } from "../server/app-review";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/app-review.tsx"), "utf8");
const engine = readFileSync(join(root, "server/app-review.ts"), "utf8");

test("the cadence and models are what was asked for", () => {
  assert.equal(ROUTINE_INTERVAL_DAYS, 3);
  assert.equal(DEEP_INTERVAL_DAYS, 28);
  // Routine runs on the default model; the four-weekly deep pass uses the most
  // capable one. Both overridable by env without a deploy.
  assert.equal(ROUTINE_MODEL, "claude-opus-5");
  assert.equal(DEEP_MODEL, "claude-fable-5");
  assert.match(engine, /process\.env\.APP_REVIEW_MODEL/);
  assert.match(engine, /process\.env\.APP_REVIEW_DEEP_MODEL/);
});

test("suggestions are data, never instructions", () => {
  // The whole safety property of this feature: nothing reads a suggestion back
  // and acts on it. Approving records intent for a person.
  const flow = routes.slice(routes.indexOf("function runAppReview"), routes.indexOf("function appReviewDue"));
  for (const forbidden of ["eval(", "exec(", "spawn(", "Function("]) {
    assert.ok(!flow.includes(forbidden), `suggestion handling must never ${forbidden}`);
  }
  const decision = routes.slice(routes.indexOf('app.post("/api/app-review/suggestions/:id/decision"'), routes.length);
  assert.match(decision.slice(0, 1200), /UPDATE app_review_suggestions SET status=\?/);
  assert.ok(!decision.slice(0, 1200).includes("sendEmail"), "a decision only records a status");
});

test("the review is admin-only and fails closed without a key", () => {
  const get = routes.slice(routes.indexOf('app.get("/api/app-review"'), routes.indexOf('app.post("/api/app-review/run"'));
  assert.match(get, /requireAdminSession\(req, res\)/);
  const run = routes.slice(routes.indexOf('app.post("/api/app-review/run"'), routes.indexOf('app.post("/api/app-review/suggestions/:id/decision"'));
  assert.match(run, /requireAdminSession\(req, res\)/);
  assert.match(run, /if \(!anthropicConfigured\(\)\) return res\.status\(503\)/);
  // The scheduler must not attempt a run with no key at all.
  assert.match(routes, /if \(!anthropicConfigured\(\)\) return;/);
});

test("a due cycle cannot be skipped by a restart", () => {
  // Checked hourly against the last COMPLETED run rather than fired on an exact
  // day, so a deploy at the wrong moment cannot swallow a cycle.
  assert.match(routes, /cron\.schedule\("20 \* \* \* \*"/);
  const due = routes.slice(routes.indexOf("function appReviewDue"), routes.indexOf('cron.schedule("20 * * * *"'));
  assert.match(due, /status='complete' AND started_at>=\?/);
  // Deep takes precedence when both are due, so the thorough pass is not
  // starved by the frequent one.
  assert.match(routes, /if \(appReviewDue\(1, "deep"\)\) await runAppReview\(1, "deep"\);/);
});

test("a failed or refused run is recorded, not silently lost", () => {
  const flow = routes.slice(routes.indexOf("function runAppReview"), routes.indexOf("function appReviewDue"));
  assert.match(flow, /UPDATE app_reviews SET status='failed', finished_at=\?, error=\?/);
  // A safety refusal returns HTTP 200 with no usable content.
  assert.match(engine, /message\?\.stop_reason === "refusal"/);
  assert.match(flow, /if \(result\.refusal\) throw new Error/);
});

test("cost is estimated from the published rates", () => {
  // 1M input + 1M output on Opus 5 = $5 + $25.
  assert.equal(estimateCostCents("claude-opus-5", 1_000_000, 1_000_000), 3000);
  // Fable is the pricier deep-pass model.
  assert.equal(estimateCostCents("claude-fable-5", 1_000_000, 1_000_000), 6000);
  assert.equal(estimateCostCents("claude-opus-5", 0, 0), 0);
  // An unknown model falls back rather than reporting zero cost.
  assert.ok(estimateCostCents("something-else", 1_000_000, 0) > 0);
});

test("the structured-output schema pins every field the page renders", () => {
  const props = (REVIEW_SCHEMA as any).properties.suggestions.items;
  assert.deepEqual(props.required, ["title", "area", "problem", "proposal", "evidence", "impact", "effort"]);
  assert.equal(props.additionalProperties, false);
  assert.deepEqual(props.properties.impact.enum, ["high", "medium", "low"]);
  // Evidence is required so a suggestion has to cite the digest it came from.
  assert.match(props.properties.evidence.description, /Quote them/);
});

test("storage keeps reviews and decisions", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS app_reviews/);
  assert.match(storage, /CREATE TABLE IF NOT EXISTS app_review_suggestions/);
  assert.match(storage, /idx_app_review_suggestions_status/);
  assert.match(storage, /FOREIGN KEY \(review_id\) REFERENCES app_reviews\(id\) ON DELETE CASCADE/);
});

test("the digest is built from the database, not the source tree", () => {
  // Only dist/ ships to production, so a source-reading review would be empty
  // there and green locally.
  const digest = routes.slice(routes.indexOf("function buildReviewDigest"), routes.indexOf("async function runAppReview"));
  assert.ok(!digest.includes("readFileSync"), "the digest must not try to read source files");
  for (const table of ["lead_outcomes", "shotgun_leads", "eod_reports", "comp_requests", "email_sends", "notifications", "audit_logs"]) {
    assert.ok(digest.includes(table), `the digest should look at ${table}`);
  }
  assert.ok(recentReleaseSummary(3).split("\n").length <= 3);
});

test("the page explains that approving changes nothing by itself", () => {
  assert.match(page, /approving records that you want it done/);
  assert.match(page, /data-testid="app-review-suggestion"/);
  assert.match(page, /ANTHROPIC_API_KEY/);
});
