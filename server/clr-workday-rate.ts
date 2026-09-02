/**
 * clr-workday-rate.ts — transfers per NORMAL working day.
 *
 * "Transfers per active day" counts every day a CLR shows up, which
 * penalizes people for days they could not have been on the phones. This
 * rate uses only normal working days:
 *
 *   - active weekdays (the same 7-source union that drives the 20-workday
 *     training clock), MINUS
 *   - the CLR's first `threshold` active weekdays (the app-wide "in
 *     training" definition — C3 stores no trainee dates, so the training
 *     clock is the honest proxy), MINUS
 *   - trainer days (the exact dates on the CLR's approved/paid training
 *     comp requests — days spent training someone else).
 *
 * Transfers logged ON an excluded day are excluded from the numerator too:
 * a trainer who grabs one call between sessions must not score it against
 * a shrunken denominator.
 */
import { CLR_TRAINING_WORKDAY_THRESHOLD } from "./clr-training-status";

/** Below this many qualifying workdays the rate is noise, not a number. */
export const MIN_WORKING_DAYS_FOR_RATE = 5;

export type ClrWorkdayRate = {
  /** Post-training active weekdays that were not trainer days. */
  workingDays: number;
  /** Transfers that landed on those working days. */
  transfers: number;
  /** transfers / workingDays, 2dp — null under MIN_WORKING_DAYS_FOR_RATE. */
  ratePerWorkingDay: number | null;
  /** Active days consumed by the 20-workday training clock. */
  trainingDays: number;
  /** Trainer days excluded (only ones that fell on post-training active days). */
  trainerDays: number;
  /** False while the CLR is still inside the training clock. */
  graduated: boolean;
};

export function transfersPerWorkingDay(input: {
  /** Distinct active WEEKDAY dates (YYYY-MM-DD), any order. */
  activeDates: readonly string[];
  /** Dates claimed on live/paid training comp requests. */
  trainerDates: ReadonlySet<string>;
  /** One entry per transfer: the transfer's date. */
  transferDates: readonly string[];
  threshold?: number;
  minDays?: number;
}): ClrWorkdayRate {
  const threshold = input.threshold ?? CLR_TRAINING_WORKDAY_THRESHOLD;
  const minDays = input.minDays ?? MIN_WORKING_DAYS_FOR_RATE;
  const active = [...new Set(input.activeDates)].sort();
  const trainingDays = Math.min(active.length, threshold);
  const postTraining = active.slice(trainingDays);
  const workingSet = new Set(postTraining.filter((date) => !input.trainerDates.has(date)));
  const trainerDays = postTraining.length - workingSet.size;
  const transfers = input.transferDates.filter((date) => workingSet.has(date)).length;
  return {
    workingDays: workingSet.size,
    transfers,
    ratePerWorkingDay: workingSet.size >= minDays
      ? Number((transfers / workingSet.size).toFixed(2))
      : null,
    trainingDays,
    trainerDays,
    graduated: active.length >= threshold,
  };
}
