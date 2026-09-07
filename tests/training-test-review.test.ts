import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  TEST_QUESTIONS, TEST_QUESTION_COUNT, gradeTest,
  reviewAnswers, unansweredQuestionIds, missRates, missRatesByDay, parseStoredAnswers, canReviewAttempt,
} from "../shared/clr-training-test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/training-results.tsx"), "utf8");
const testPage = readFileSync(join(root, "client/src/pages/clr-training-test.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const lapShell = readFileSync(join(root, "client/src/components/lap/lap-shell.tsx"), "utf8");

const key = () => {
  const out: Record<string, number> = {};
  for (const q of TEST_QUESTIONS) out[String(q.id)] = q.correct;
  return out;
};
const wrong = (id: number) => (TEST_QUESTIONS.find((q) => q.id === id)!.correct + 1) % 4;

// ── The bank asks whether they can do the job ────────────────────────────────

test("the bank tests judgement, not recall of the schedule", () => {
  // The old bank asked things like "how many objections should the trainee
  // master on day three?" — answerable by someone who has never held a call.
  const secondPerson = TEST_QUESTIONS.filter((q) => /\b(you|your)\b/i.test(q.text));
  assert.ok(secondPerson.length >= 40,
    `only ${secondPerson.length}/60 questions put the CLR in the moment`);
  for (const q of TEST_QUESTIONS) {
    assert.doesNotMatch(q.text, /how many .*(should|must) the trainee/i, `q${q.id} is trivia: ${q.text}`);
    // A numbered quiz is the schedule, not the phone. The guard used to look at
    // q.text only, which is how five questions kept "…only if you also failed
    // Quiz #1" sitting in their CHOICES — visible to every trainee, in the same
    // list they are picking from, and just as much a question about the
    // training programme as if it had been in the stem.
    for (const part of [q.text, ...q.choices]) {
      assert.doesNotMatch(part, /\bquiz\b/i, `q${q.id} asks about the quiz schedule: ${part}`);
    }
    // The explanation is coaching, not a citation. A pointer back to the plan
    // ("see day 4") teaches nothing to somebody who just got it wrong.
    assert.ok(q.why.length >= 80, `q${q.id}'s explanation is too thin to be useful: ${q.why}`);
  }
  // No two questions may turn on the same fact with the same framing: #18 and
  // #21 both used to ask "are the top four automatic yet?", so one of them was
  // free marks for anybody who had read the other.
  const shape = (q: (typeof TEST_QUESTIONS)[number]) =>
    `${q.day}|${q.choices[q.correct].toLowerCase().replace(/[^a-z ]/g, "").split(" ").sort().join(" ")}`;
  const shapes = new Set<string>();
  for (const q of TEST_QUESTIONS) {
    assert.ok(!shapes.has(shape(q)), `q${q.id} repeats an earlier question's answer verbatim: ${q.choices[q.correct]}`);
    shapes.add(shape(q));
  }
  // Still spread over the real days, so the per-day mapping keeps working.
  for (let day = 1; day <= 10; day++) {
    const n = TEST_QUESTIONS.filter((q) => q.day === day).length;
    assert.ok(n >= 4, `day ${day} only has ${n} questions`);
  }
});

// ── Per-attempt review ───────────────────────────────────────────────────────

test("a review says what was asked, what they picked, and what was right", () => {
  const answers = { ...key(), "3": wrong(3), "17": wrong(17) };
  delete (answers as any)["9"]; // left blank
  const review = reviewAnswers(answers);

  assert.equal(review.length, TEST_QUESTION_COUNT - 1, "59 answered, so 59 rows");
  const q3 = review.find((r) => r.id === 3)!;
  assert.equal(q3.isCorrect, false);
  assert.equal(q3.chosen, wrong(3));
  assert.equal(q3.chosenText, q3.choices[wrong(3)]);
  assert.equal(q3.correctText, q3.choices[q3.correct]);
  assert.ok(q3.why.length > 20, "the review has to carry the explanation, or it is just a score");
  assert.ok(q3.text.length > 0 && q3.choices.length === 4);
  assert.equal(q3.day, TEST_QUESTIONS.find((q) => q.id === 3)!.day);

  // A blank is still distinguishable from a wrong answer — it is reported by
  // id, separately, and carries no answer with it.
  assert.equal(review.find((r) => r.id === 9), undefined, "a blank has nothing to review");
  assert.deepEqual(unansweredQuestionIds(answers), [9]);

  assert.equal(review.filter((r) => !r.isCorrect).length, 2, "only the two answered-and-wrong");
  assert.equal(review.find((r) => r.id === 1)!.isCorrect, true);
});

// ── The answer key is not a browsing service ─────────────────────────────────

test("a review never answers a question the attempt did not", () => {
  // The leak: every row carries `correct`, `correctText` and `why`, and the
  // review used to return a row for all 60 regardless. So somebody who had not
  // sat the test could file an empty attempt, open its own review — which they
  // are entitled to, it is theirs — and read the whole key before taking it.
  const emptyReview = reviewAnswers({});
  assert.deepEqual(emptyReview, [], "an empty attempt must reveal nothing at all");
  assert.equal(unansweredQuestionIds({}).length, TEST_QUESTION_COUNT);

  const oneAnswer = reviewAnswers({ "4": 0 });
  assert.equal(oneAnswer.length, 1, "one answer buys you one answer");
  assert.equal(oneAnswer[0].id, 4);
  assert.deepEqual(oneAnswer.map((r) => r.id), [4]);
  // And nothing about the other 59 comes back in any field.
  const leaked = JSON.stringify(oneAnswer);
  for (const q of TEST_QUESTIONS) {
    if (q.id === 4) continue;
    assert.ok(!leaked.includes(q.why), `q${q.id}'s explanation leaked through a one-answer review`);
    assert.ok(!leaked.includes(q.choices[q.correct]), `q${q.id}'s answer leaked through a one-answer review`);
  }
  // Out-of-range stored junk is not an answer either, so it buys nothing.
  assert.deepEqual(reviewAnswers('{"4":9}'), []);
});

test("submitting an empty paper does not come back as the answer key", () => {
  // Same shape problem on the way IN: gradeTest's `results` carries the key,
  // and the POST hands the whole thing straight back to the submitter.
  const blank = gradeTest({});
  assert.equal(blank.correctCount, 0);
  assert.equal(blank.total, TEST_QUESTION_COUNT, "unanswered still counts against you");
  assert.equal(blank.passed, false);
  assert.deepEqual(blank.results, [], "no rows, so no answers");
  assert.equal(blank.unanswered.length, TEST_QUESTION_COUNT, "ids only");
  assert.equal(JSON.stringify(blank.unanswered).includes("why"), false);

  const partial = gradeTest({ "1": TEST_QUESTIONS[0].correct, "2": wrong(2) });
  assert.deepEqual(partial.results.map((r) => r.id), [1, 2]);
  assert.equal(partial.correctCount, 1);
  assert.equal(partial.unanswered.length, TEST_QUESTION_COUNT - 2);
  assert.ok(!partial.unanswered.includes(1) && !partial.unanswered.includes(2));

  // A full paper still reviews in full — the fix must not cost the coaching.
  const full = gradeTest(key());
  assert.equal(full.results.length, TEST_QUESTION_COUNT);
  assert.deepEqual(full.unanswered, []);
  assert.equal(full.percent, 100);

  // The route hands back exactly what gradeTest produced, so the same rule
  // covers the submit response.
  const post = routes.slice(
    routes.indexOf('app.post("/api/training-test/attempts"'),
    routes.indexOf('app.get("/api/training-test/attempts", requireAuth'),
  );
  assert.match(post, /const graded = gradeTest\(answers\)/);
  assert.match(post, /res\.json\(\{ \.\.\.graded/);
});

test("a stored blob is treated as input, not as trusted data", () => {
  assert.deepEqual(parseStoredAnswers("not json"), {});
  assert.deepEqual(parseStoredAnswers(null), {});
  assert.deepEqual(parseStoredAnswers("[]"), {});
  assert.deepEqual(parseStoredAnswers('{"1":"2"}'), { "1": 2 });
  // Out-of-range choices are dropped rather than indexing off the end.
  assert.deepEqual(parseStoredAnswers('{"1":9,"2":-1,"3":1.5,"4":0}'), { "4": 0 });
  // …and a dropped choice is an unanswered question, not a question whose
  // answer we hand over for free.
  assert.deepEqual(reviewAnswers('{"1":99}'), []);
  assert.deepEqual(unansweredQuestionIds('{"1":99}').length, TEST_QUESTION_COUNT);
  assert.deepEqual(reviewAnswers(undefined), []);
  assert.deepEqual(reviewAnswers("not json"), []);
});

// ── The aggregate ────────────────────────────────────────────────────────────

test("the aggregate says where the training is failing, worst first", () => {
  // Five people: everyone misses q7, three miss q2, nobody misses the rest.
  const attempts = [
    { ...key(), "7": wrong(7), "2": wrong(2) },
    { ...key(), "7": wrong(7), "2": wrong(2) },
    { ...key(), "7": wrong(7), "2": wrong(2) },
    { ...key(), "7": wrong(7) },
    { ...key(), "7": wrong(7) },
  ];
  const rates = missRates(attempts);
  assert.equal(rates.length, TEST_QUESTION_COUNT);
  assert.equal(rates[0].id, 7, "the most-missed question must sort first");
  assert.equal(rates[0].missed, 5);
  assert.equal(rates[0].attempts, 5);
  assert.equal(rates[0].missRate, 100);
  assert.equal(rates[1].id, 2);
  assert.equal(rates[1].missRate, 60);
  assert.equal(rates[rates.length - 1].missed, 0);

  // The wrong answer the team reaches for is usually the actual lesson.
  assert.deepEqual(rates[0].topWrong, {
    index: wrong(7),
    text: TEST_QUESTIONS.find((q) => q.id === 7)!.choices[wrong(7)],
    count: 5,
  });
  assert.equal(rates[rates.length - 1].topWrong, null);
  // A question nobody got wrong still reports its answer, for the trainer.
  assert.ok(rates[rates.length - 1].correctText.length > 0);
});

test("a blank counts as a miss, because the trainee did not know it", () => {
  const blank = { ...key() };
  delete (blank as any)["5"];
  const rates = missRates([blank, key()]);
  const q5 = rates.find((r) => r.id === 5)!;
  assert.equal(q5.missed, 1);
  assert.equal(q5.blank, 1);
  assert.equal(q5.missRate, 50);
  assert.equal(q5.topWrong, null, "a blank is not a wrong answer anybody chose");
  assert.deepEqual(missRates([]).map((r) => r.missRate).filter((n) => n !== 0), []);
});

test("misses roll up per training day, so a thin day is visible", () => {
  const attempt = { ...key() };
  for (const q of TEST_QUESTIONS.filter((x) => x.day === 8)) attempt[String(q.id)] = wrong(q.id);
  const byDay = missRatesByDay([attempt]);
  assert.deepEqual(byDay.map((r) => r.day), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const day8 = byDay.find((r) => r.day === 8)!;
  assert.equal(day8.missRate, 100);
  assert.equal(day8.asked, TEST_QUESTIONS.filter((q) => q.day === 8).length);
  for (const row of byDay) if (row.day !== 8) assert.equal(row.missRate, 0);
});

// ── Authority ────────────────────────────────────────────────────────────────

test("a CLR may read their own attempt and nobody else's", () => {
  // Both sides of the rule, on the same function the route calls.
  assert.equal(canReviewAttempt({ viewerId: 12, isManager: false, attemptUserId: 12 }), true);
  assert.equal(canReviewAttempt({ viewerId: 12, isManager: false, attemptUserId: 13 }), false,
    "guessing an attempt id must not reveal somebody else's answers");
  assert.equal(canReviewAttempt({ viewerId: 12, isManager: true, attemptUserId: 13 }), true);
  assert.equal(canReviewAttempt({ viewerId: 12, isManager: true, attemptUserId: 12 }), true);
  // No session, no review — even if something upstream claims manager rights.
  assert.equal(canReviewAttempt({ viewerId: 0, isManager: true, attemptUserId: 0 }), false);
  assert.equal(canReviewAttempt({ viewerId: NaN as any, isManager: false, attemptUserId: NaN as any }), false);
});

test("the per-attempt route enforces that rule, and is org-scoped", () => {
  const detail = routes.slice(
    routes.indexOf('app.get("/api/training-test/attempts/:id"'),
    routes.indexOf('app.get("/api/training-test/insights"'),
  );
  assert.ok(detail.length > 0, "the per-attempt review route must exist");
  assert.match(detail, /requireAuth/);
  assert.match(detail, /WHERE id=\? AND org_id=\?/,
    "an attempt id from another org must not resolve");
  assert.match(detail, /canReviewAttempt\(\{ viewerId: userId, isManager, attemptUserId: Number\(row\.user_id\) \}\)/);
  assert.match(detail, /reviewAnswers\(row\.answers\)/);
  assert.match(detail, /unansweredQuestionIds\(row\.answers\)/);
  // The answer key is only ever attached to an attempt somebody already sat.
  assert.doesNotMatch(detail, /questionsWithoutAnswers/);
});

test('"not yours" and "does not exist" are the same answer', () => {
  // 403-for-exists / 404-for-missing turns the id space into a staff directory:
  // walk the ids, and a CLR learns how many attempts each colleague has filed
  // and roughly when, without ever being shown one.
  const detail = routes.slice(
    routes.indexOf('app.get("/api/training-test/attempts/:id"'),
    routes.indexOf('app.get("/api/training-test/insights"'),
  );
  assert.doesNotMatch(detail, /status\(403\)/,
    "a refusal that only happens for real attempts is a confirmation that they are real");
  // Both cases go through one reply, so they cannot drift apart later.
  assert.match(detail, /const notFound = \(\) => res\.status\(404\)\.json\(\{ error: "That attempt is gone\." \}\);/);
  assert.equal((detail.match(/return notFound\(\);/g) ?? []).length, 2,
    "the missing row and the forbidden row must return the identical thing");
  assert.match(detail, /if \(!row\) return notFound\(\);/);
  assert.match(detail, /canReviewAttempt\([\s\S]{0,160}?\{\s*\r?\n\s*return notFound\(\);/);
  // Exactly one 404 body in the route, so status AND text match either way.
  assert.equal((detail.match(/status\(404\)/g) ?? []).length, 1);
});

test("the new endpoints never write their bodies to the application log", () => {
  // C3 already has the mechanism: SENSITIVE_PATH in server/index.ts suppresses
  // the response body in the request log. These replies are a named person's
  // per-question performance plus the answer key, so they belong behind it —
  // otherwise every page open files both into log retention.
  const source = readFileSync(join(root, "server/index.ts"), "utf8");
  const declared = source.match(/const SENSITIVE_PATH = \/(.+)\/;/);
  assert.ok(declared, "SENSITIVE_PATH must still exist in server/index.ts");
  const pattern = new RegExp(declared![1]);
  for (const path of [
    "/api/training-test",
    "/api/training-test/check",
    "/api/training-test/attempts",
    "/api/training-test/attempts/17",
    "/api/training-test/insights",
  ]) {
    assert.ok(pattern.test(path), `${path} would be logged in full`);
  }
  // Still only the sensitive ones — the mechanism must not have been widened
  // into "log nothing", which would take the request log down with it.
  assert.ok(!pattern.test("/api/clr-sop"));
  assert.ok(!pattern.test("/api/loan-officers"));
  // And the log line is genuinely gated on it.
  assert.match(source, /if \(capturedJsonResponse && !SENSITIVE_PATH\.test\(path\)\)/);
});

test("there is one notion of authority, not one per route", () => {
  const block = routes.slice(
    routes.indexOf("// ── CLR training certification test"),
    routes.indexOf("// ── CLR task center"),
  );
  assert.match(block, /const trainingTestManager = \(user: any\) =>/);
  // Every route that can show somebody else's data goes through it.
  assert.equal((block.match(/trainingTestManager\(me\)/g) ?? []).length, 3,
    "the history, the per-attempt review and the aggregate all call the same check");
  // And nobody re-derives it inline any more.
  assert.doesNotMatch(block, /me\?\.role === "admin" \|\| me\?\.superAdmin/);
});

test("the aggregate is managers only, and the plain history still hides answers", () => {
  const insights = routes.slice(
    routes.indexOf('app.get("/api/training-test/insights"'),
    routes.indexOf('app.get("/api/clr-sop"'),
  );
  assert.match(insights, /requireAuth/);
  assert.match(insights, /if \(!trainingTestManager\(me\)\) \{\s*\n?\s*return res\.status\(403\)/);
  assert.match(insights, /WHERE org_id=\?/);
  assert.match(insights, /missRates\(answers\)/);
  assert.match(insights, /missRatesByDay\(answers\)/);

  // The list endpoint still returns scores only — the blob is fetched one
  // attempt at a time, through the check above.
  const list = routes.slice(
    routes.indexOf('app.get("/api/training-test/attempts", requireAuth'),
    routes.indexOf('app.get("/api/training-test/attempts/:id"'),
  );
  assert.ok(!/,\s*answers\s*\n/.test(list) && !list.includes("answers\n"),
    "the history list must not ship every answer blob to everyone");
  assert.match(list, /AND user_id=\?/);
});

test("the review page is reachable, and asks for the aggregate only as a manager", () => {
  assert.match(app, /<Route path="\/clr-training\/results" component=\{TrainingResults\} \/>/);
  assert.match(app, /"\/clr-training\/results": "Certification Results"/);
  // Attempt data is C3 data: a portal account has no business with it, and the
  // /api guard would 403 it anyway.
  assert.ok(!lapShell.includes("/clr-training/results"), "the results page must not be routed into LAP");

  assert.match(page, /queryKey: \["\/api\/training-test\/attempts"\]/);
  assert.match(page, /queryKey: \[`\/api\/training-test\/attempts\/\$\{openId\}`\]/);
  assert.match(page, /queryKey: \["\/api\/training-test\/insights"\],\s*\n[\s\S]{0,200}?enabled: isManager/);
  assert.match(page, /data-testid="attempt-review"/);
  assert.match(page, /data-testid="training-insights"/);
  assert.match(page, /review-chosen-/);
  assert.match(page, /review-correct-/);
  // Blanks are surfaced as a count of ids, with no answers behind them.
  assert.match(page, /data-testid="review-unanswered"/);
  assert.match(page, /Blank questions are not reviewed/);
  // The test itself links to it — a score with no way to see the misses is what
  // this whole change exists to fix.
  assert.match(testPage, /data-testid="link-training-results"/);
});
