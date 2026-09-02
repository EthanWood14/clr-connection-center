import test from "node:test";
import assert from "node:assert/strict";
import { transfersPerWorkingDay, MIN_WORKING_DAYS_FOR_RATE } from "../server/clr-workday-rate";

const days = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `2026-06-${String(from + i).padStart(2, "0")}`);

test("everything inside the training clock yields no rate", () => {
  const r = transfersPerWorkingDay({
    activeDates: days(15),
    trainerDates: new Set(),
    transferDates: ["2026-06-03", "2026-06-10"],
    threshold: 20,
  });
  assert.equal(r.workingDays, 0);
  assert.equal(r.transfers, 0);
  assert.equal(r.ratePerWorkingDay, null);
  assert.equal(r.trainingDays, 15);
  assert.equal(r.graduated, false);
});

test("post-training days count; training-window transfers do not", () => {
  const r = transfersPerWorkingDay({
    activeDates: days(28),
    trainerDates: new Set(),
    transferDates: ["2026-06-05", "2026-06-22", "2026-06-25", "2026-06-25"],
    threshold: 20,
  });
  // 28 active - 20 training = 8 working days; the 06-05 transfer is inside training.
  assert.equal(r.workingDays, 8);
  assert.equal(r.transfers, 3);
  assert.equal(r.ratePerWorkingDay, Number((3 / 8).toFixed(2)));
  assert.equal(r.trainingDays, 20);
  assert.equal(r.trainerDays, 0);
  assert.equal(r.graduated, true);
});

test("trainer days come out of the denominator AND the numerator", () => {
  const r = transfersPerWorkingDay({
    activeDates: days(28),
    trainerDates: new Set(["2026-06-22", "2026-06-23"]),
    transferDates: ["2026-06-22", "2026-06-25"],
    threshold: 20,
  });
  assert.equal(r.workingDays, 6);
  assert.equal(r.trainerDays, 2);
  // The transfer grabbed on the 06-22 trainer day does not count.
  assert.equal(r.transfers, 1);
  assert.equal(r.ratePerWorkingDay, Number((1 / 6).toFixed(2)));
});

test("a trainer day inside the training window is not double-counted", () => {
  const r = transfersPerWorkingDay({
    activeDates: days(25),
    trainerDates: new Set(["2026-06-02"]), // falls inside the first 20
    transferDates: [],
    threshold: 20,
  });
  assert.equal(r.trainingDays, 20);
  assert.equal(r.trainerDays, 0);
  assert.equal(r.workingDays, 5);
});

test("fewer than MIN working days -> null rate but honest counts", () => {
  const r = transfersPerWorkingDay({
    activeDates: days(20 + MIN_WORKING_DAYS_FOR_RATE - 1),
    trainerDates: new Set(),
    transferDates: ["2026-06-21", "2026-06-22"],
    threshold: 20,
  });
  assert.equal(r.workingDays, MIN_WORKING_DAYS_FOR_RATE - 1);
  assert.equal(r.transfers, 2);
  assert.equal(r.ratePerWorkingDay, null);
});

test("duplicate and unsorted active dates are deduped and ordered", () => {
  const r = transfersPerWorkingDay({
    activeDates: ["2026-06-03", "2026-06-01", "2026-06-03", "2026-06-02"],
    trainerDates: new Set(),
    transferDates: ["2026-06-03"],
    threshold: 2,
    minDays: 1,
  });
  // 3 distinct days, first 2 are training, 06-03 remains.
  assert.equal(r.workingDays, 1);
  assert.equal(r.transfers, 1);
  assert.equal(r.ratePerWorkingDay, 1);
});

test("empty input is quiet, not a crash", () => {
  const r = transfersPerWorkingDay({ activeDates: [], trainerDates: new Set(), transferDates: [] });
  assert.equal(r.workingDays, 0);
  assert.equal(r.ratePerWorkingDay, null);
  assert.equal(r.graduated, false);
});
