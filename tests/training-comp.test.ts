import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRAINING_DAY_RATES, trainingAmountCents, trainingRateCents,
  normalizeTrainingDates, describeTrainingDays, isTrainingRate,
} from "../shared/training-comp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const comp = readFileSync(join(root, "client/src/pages/comp-requests.tsx"), "utf8");
const profile = readFileSync(join(root, "client/src/pages/clr-profile.tsx"), "utf8");

test("a training day is $20, and double time is $40", () => {
  assert.equal(TRAINING_DAY_RATES.standard.cents, 2000);
  assert.equal(TRAINING_DAY_RATES.double.cents, 4000);
  assert.equal(trainingAmountCents(1, "standard"), 2000);
  assert.equal(trainingAmountCents(3, "standard"), 6000);
  assert.equal(trainingAmountCents(3, "double"), 12000);
});

test("an unknown rate falls back to standard rather than to free or to double", () => {
  assert.equal(trainingRateCents("triple"), 2000);
  assert.equal(trainingRateCents(undefined), 2000);
  assert.equal(trainingRateCents(null), 2000);
  assert.equal(isTrainingRate("double"), true);
  assert.equal(isTrainingRate("DOUBLE"), false);
});

test("a day count is never negative, fractional, or invented", () => {
  assert.equal(trainingAmountCents(0, "standard"), 0);
  assert.equal(trainingAmountCents(-4, "standard"), 0);
  assert.equal(trainingAmountCents(2.9, "standard"), 4000);
  assert.equal(trainingAmountCents(NaN as any, "standard"), 0);
});

test("submitted days are cleaned: no duplicates, no junk, no future", () => {
  const today = "2026-08-31";
  assert.deepEqual(
    normalizeTrainingDates(["2026-08-20", "2026-08-20", "2026-08-19"], today),
    ["2026-08-19", "2026-08-20"],
    "the same day twice on one request must not be paid twice",
  );
  assert.deepEqual(normalizeTrainingDates(["2026-09-01"], today), [],
    "you cannot claim a day that has not happened");
  assert.deepEqual(normalizeTrainingDates(["not-a-date", "", null, 7, "2026-13-45"], today), []);
  assert.deepEqual(normalizeTrainingDates("2026-08-20" as any, today), [], "a bare string is not a day list");
  assert.equal(normalizeTrainingDates(Array.from({ length: 200 }, (_, i) =>
    `2026-0${1 + (i % 8)}-${String(1 + (i % 28)).padStart(2, "0")}`), today).length <= 31, true,
    "a single request cannot claim an unbounded number of days");
});

test("the description reports the days actually accepted", () => {
  assert.match(describeTrainingDays(["2026-08-19", "2026-08-20"], "standard"), /2 days at \$20\/day/);
  assert.match(describeTrainingDays(["2026-08-19"], "double"), /1 day at \$40\/day/);
});

// ── the server owns the money ────────────────────────────────────────────────

test("the amount is computed on the server, never taken from the client", () => {
  const block = routes.slice(
    routes.indexOf("// Training-day mode:"),
    routes.indexOf("if (category === \"time\" && rawEntryIds.length)"),
  );
  assert.ok(block.length > 100, "the training intake block must exist");
  assert.match(block, /amountCents = trainingAmountCents\(days\.length, rate\)/,
    "the price must come from the day count, not the request body");
  // The days priced are the deduped ones, not what was asked for.
  assert.match(block, /const days = asked\.filter\(\(d\) => !taken\.has\(d\)\)/);
  assert.match(block, /compClaimedTrainingDates\(targetId, orgId\)/,
    "must dedupe against the TARGET user, not the submitter");
});

test("a training day already claimed cannot be claimed again", () => {
  const fn = routes.slice(
    routes.indexOf("function compClaimedTrainingDates"),
    routes.indexOf("function compClaimedShiftIds"),
  );
  assert.ok(fn.length > 0);
  // Same rule as claimed shifts: live requests hold their days, and a paid
  // request keeps holding them even if it is later denied.
  assert.match(fn, /status NOT IN \('draft','denied'\) OR is_paid=1 OR is_received=1/);
  assert.match(fn, /user_id=\? AND org_id=\?/, "claims are per person and per org");
  // A malformed row must not throw and take the whole request down.
  assert.match(fn, /catch \{/);
});

test("the request is stored with the days it covers", () => {
  assert.match(routes, /ADD COLUMN training_dates TEXT/);
  assert.match(routes, /ADD COLUMN training_rate TEXT/);
  const insert = routes.slice(routes.indexOf("INSERT INTO comp_requests (org_id, user_id, description, category, amount_cents, expense_date, note, is_reimbursement, hours_covered"));
  assert.match(insert.slice(0, 1200), /training_dates, training_rate/,
    "without storing the days, the dedupe above has nothing to read");
});

test("a training request still goes through the ordinary comp flow", () => {
  const block = routes.slice(
    routes.indexOf("// Training-day mode:"),
    routes.indexOf("if (category === \"time\" && rawEntryIds.length)"),
  );
  assert.ok(block.length > 100);
  // It must NOT invent its own status, approval or payment path — it hands off
  // to the same insert, approval email and payout tracking as every other
  // request, so training pay cannot bypass a manager.
  for (const forbidden of ["status = 'approved'", "is_paid = 1", "INSERT INTO comp_requests"]) {
    assert.ok(!block.includes(forbidden), `training must not do its own ${forbidden}`);
  }
});

// ── both surfaces ────────────────────────────────────────────────────────────

test("trainers can file it from the comp page", () => {
  assert.match(comp, /data-testid="training-days-picker"/);
  assert.match(comp, /data-testid=\{"training-rate-" \+ r\}/);
  // Both rates must actually be offered, from the shared table.
  assert.match(comp, /Object\.keys\(TRAINING_DAY_RATES\)/);
  assert.match(comp, /\.\.\.\(isTrainingDays \? \{ trainingDates, trainingRate \} : \{\}\)/);
  // The amount box must not be editable once days drive it.
  assert.match(comp, /readOnly=\{isTrainingDays\}/);
  // Filing must not leave the days behind for the next request.
  assert.match(comp, /setTrainingDates\(\[\]\); setTrainingRate\("standard"\)/);
});

test("managers can file it from a CLR's profile, for that CLR", () => {
  assert.match(profile, /data-testid="clr-training-submit"/);
  const m = profile.slice(profile.indexOf("const fileTraining = useMutation"), profile.indexOf("onSuccess:", profile.indexOf("const fileTraining")));
  assert.match(m, /category: "training"/);
  assert.match(m, /onBehalfOf: Number\(id\)/, "it must be filed for the CLR whose profile this is");
  assert.match(m, /trainingDates: trainDates/);
});

test("the day field stores what you type, so a date can actually be entered", () => {
  // The bug this pins: the input is CONTROLLED on a value that was only ever
  // set to "". Every partial keystroke hit an early return before storing, so
  // React rewrote the field back to empty on each render and the date could
  // never be completed. A controlled field must store every intermediate value.
  const handler = comp.slice(comp.indexOf("const onTrainingDayChange"), comp.indexOf("const addTrainingDay"));
  assert.ok(handler.length > 0, "the comp page needs a change handler that stores first");
  const setPos = handler.indexOf("setTrainingDay(v)");
  const testPos = handler.indexOf("test(v)");
  assert.ok(setPos > 0, "it must store the typed value");
  assert.ok(setPos < testPos, "it must store BEFORE validating, or partial input is discarded");

  // Same shape on the profile card.
  const prof = profile.slice(profile.indexOf('type="date" value={trainDay}'), profile.indexOf('data-testid="clr-training-day"'));
  assert.match(prof, /setTrainDay\(d\);/, "the profile field must store the typed value too");
  assert.ok(prof.indexOf("setTrainDay(d)") < prof.indexOf("test(d)"),
    "store before validating on the profile card as well");

  // And there is a way to add a day that does not depend on autodetection.
  assert.match(comp, /data-testid="button-add-training-day"/);
  assert.match(profile, /data-testid="clr-training-add-day"/);
});
