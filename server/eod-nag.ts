/**
 * How hard C3 pushes a CLR to file today's EOD report.
 *
 * The report is expected at 4pm on the day it covers. Being *late* is still
 * judged at 4pm the NEXT business day (see eodIsOverdue) — this ladder is
 * about getting the report in on the day, not about re-defining lateness, so
 * nothing here feeds the late statistics.
 *
 * Pure so it can be tested directly: importing server/routes.ts from a test
 * boots the whole server and hangs.
 */

export type EodNagStage = "none" | "due" | "urgent" | "alarm" | "locked";

/** Minutes past midnight, in the CLR's own timezone, for each rung. */
export const EOD_NAG_STEPS: ReadonlyArray<{ stage: EodNagStage; atMinutes: number }> = [
  { stage: "due", atMinutes: 16 * 60 },          // 4:00pm — a pinned banner
  { stage: "urgent", atMinutes: 16 * 60 + 30 },  // 4:30pm — larger, pulsing
  { stage: "alarm", atMinutes: 17 * 60 },        // 5:00pm — red, with a chime
  { stage: "locked", atMinutes: 17 * 60 + 30 },  // 5:30pm — the app locks
];

/** How often the chime repeats once the alarm rung is reached, in ms. */
export const EOD_NAG_CHIME_INTERVAL_MS = 10 * 60 * 1000;

export interface EodNagInput {
  /** Whether today's report is already filed. */
  submitted: boolean;
  /** Local wall-clock hour (0-23) in the CLR's timezone. */
  hour: number;
  /** Local wall-clock minute (0-59). */
  minute: number;
  /** False on weekends and any day no report is expected. */
  expectedToday: boolean;
}

/**
 * The rung reached right now. Filing the report drops it straight back to
 * "none" — the nag is never a punishment for having already done it.
 */
export function eodNagStage(input: EodNagInput): EodNagStage {
  if (input.submitted || !input.expectedToday) return "none";
  const mins = Math.max(0, Math.min(24 * 60 - 1, input.hour * 60 + input.minute));
  let stage: EodNagStage = "none";
  for (const step of EOD_NAG_STEPS) {
    if (mins >= step.atMinutes) stage = step.stage;
  }
  return stage;
}

/** Whether this rung takes the app away until the report is filed. */
export function eodNagLocks(stage: EodNagStage): boolean {
  return stage === "locked";
}

/** Whether this rung makes noise. */
export function eodNagChimes(stage: EodNagStage): boolean {
  return stage === "alarm" || stage === "locked";
}

/** Minutes until the next rung, or null when there is none left. */
export function minutesToNextStage(input: EodNagInput): number | null {
  if (input.submitted || !input.expectedToday) return null;
  const mins = input.hour * 60 + input.minute;
  for (const step of EOD_NAG_STEPS) {
    if (mins < step.atMinutes) return step.atMinutes - mins;
  }
  return null;
}
