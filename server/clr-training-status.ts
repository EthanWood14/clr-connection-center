/**
 * A CLR remains in training until they have completed 20 business workdays.
 * `activeWorkdays` is supplied by the lifetime activity query so calendar
 * tenure, weekends and days away never graduate someone early.
 */
export const CLR_TRAINING_WORKDAY_THRESHOLD = 20;

export type ClrTrainingStatus = {
  activeWorkdays: number;
  inTraining: boolean;
};

export function clrTrainingStatus(activeWorkdays: number): ClrTrainingStatus {
  const days = Math.max(0, Math.floor(Number(activeWorkdays) || 0));
  return {
    activeWorkdays: days,
    inTraining: days < CLR_TRAINING_WORKDAY_THRESHOLD,
  };
}
