import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  TEST_QUESTIONS, TEST_QUESTION_COUNT, TEST_PASS_CORRECT, TEST_PASS_PERCENT,
  questionsWithoutAnswers, gradeTest,
} from "../shared/clr-training-test";
import { TRAINING_DAYS } from "../shared/clr-training";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-training-test.tsx"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

test("60 questions, 90% to pass, derived from the bank", () => {
  assert.equal(TEST_QUESTION_COUNT, 60);
  assert.equal(TEST_QUESTIONS.length, 60);
  assert.equal(TEST_PASS_PERCENT, 90);
  assert.equal(TEST_PASS_CORRECT, 54);
  // An earlier version hard-coded the count while the bank held 69, silently
  // turning the pass mark into 78%. The threshold must follow the bank.
  assert.match(readFileSync(join(root, "shared/clr-training-test.ts"), "utf8"),
    /TEST_QUESTION_COUNT = TEST_QUESTIONS\.length/);
});

test("the boundary is exactly right", () => {
  const key: Record<string, number> = {};
  for (const q of TEST_QUESTIONS) key[String(q.id)] = q.correct;
  assert.equal(gradeTest(key).percent, 100);
  const miss6 = { ...key }; for (let i = 1; i <= 6; i++) miss6[String(i)] = (key[String(i)] + 1) % 4;
  const miss7 = { ...key }; for (let i = 1; i <= 7; i++) miss7[String(i)] = (key[String(i)] + 1) % 4;
  assert.equal(gradeTest(miss6).correctCount, 54);
  assert.equal(gradeTest(miss6).passed, true, "54 correct must pass");
  assert.equal(gradeTest(miss7).correctCount, 53);
  assert.equal(gradeTest(miss7).passed, false, "53 correct must fail");
  // A blank is wrong, not skipped.
  assert.equal(gradeTest({}).correctCount, 0);
});

test("the correct answer is not always the same letter", () => {
  // The bank is authored correct-first for readability; shipping it that way
  // would let a trainee score 100% by always picking A.
  const spread: Record<number, number> = {};
  for (const q of TEST_QUESTIONS) spread[q.correct] = (spread[q.correct] ?? 0) + 1;
  assert.equal(Object.keys(spread).length, 4, "all four positions must be used");
  for (const n of Object.values(spread)) assert.ok(n >= 10, `uneven spread: ${JSON.stringify(spread)}`);
  const alwaysA: Record<string, number> = {};
  for (const q of TEST_QUESTIONS) alwaysA[String(q.id)] = 0;
  assert.equal(gradeTest(alwaysA).passed, false, "always picking A must fail");
});

test("every question is well formed and tied to a real training day", () => {
  const days = new Set(TRAINING_DAYS.map(d => d.day));
  const seen = new Set<string>();
  for (const q of TEST_QUESTIONS) {
    assert.ok(days.has(q.day), `question ${q.id} cites day ${q.day}, which is not in the plan`);
    assert.equal(q.choices.length, 4, `question ${q.id} needs 4 choices`);
    assert.equal(new Set(q.choices).size, 4, `question ${q.id} has duplicate choices`);
    assert.ok(q.correct >= 0 && q.correct < 4);
    assert.ok(q.why.length > 15, `question ${q.id} has no usable explanation`);
    assert.ok(!seen.has(q.text), `duplicate question: ${q.text}`);
    seen.add(q.text);
  }
});

test("the answer key never reaches the browser before submission", () => {
  const shipped = questionsWithoutAnswers();
  assert.equal(shipped.length, 60);
  for (const q of shipped) {
    assert.ok(!("correct" in q), "the key must be stripped");
    assert.ok(!("why" in q), "explanations must be stripped too — they give it away");
  }
  const get = routes.slice(routes.indexOf('app.get("/api/training-test"'), routes.indexOf('app.post("/api/training-test/attempts"'));
  assert.match(get, /questionsWithoutAnswers\(\)/);
  // Grading is server-side.
  assert.match(routes, /const graded = gradeTest\(answers\)/);
  assert.ok(!page.includes("gradeTest"), "the browser must not grade its own test");
});

test("every attempt is recorded, not just the best one", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS training_test_attempts/);
  const post = routes.slice(routes.indexOf('app.post("/api/training-test/attempts"'), routes.indexOf('app.get("/api/training-test/attempts"'));
  assert.match(post, /INSERT INTO training_test_attempts/);
  assert.ok(!/ON CONFLICT|UPDATE training_test_attempts/.test(post), "attempts must accumulate, not overwrite");
  // A CLR sees their own history; a manager sees everyone's.
  const hist = routes.slice(routes.indexOf('app.get("/api/training-test/attempts"'), routes.indexOf('app.get("/api/loan-officers/transfer-counts"'));
  assert.match(hist, /AND user_id=\?/, "a non-manager must only see their own attempts");
  assert.match(hist, /isManager/);
});
