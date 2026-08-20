export const TASK_RECURRENCES = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type TaskRecurrence = typeof TASK_RECURRENCES[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export function isTaskRecurrence(value: unknown): value is TaskRecurrence {
  return TASK_RECURRENCES.includes(value as TaskRecurrence);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return TASK_PRIORITIES.includes(value as TaskPriority);
}

function addOneCycle(date: Date, recurrence: Exclude<TaskRecurrence, "none">): Date {
  const next = new Date(date);
  if (recurrence === "daily" || recurrence === "weekdays") {
    do next.setUTCDate(next.getUTCDate() + 1);
    while (recurrence === "weekdays" && (next.getUTCDay() === 0 || next.getUTCDay() === 6));
  } else if (recurrence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    const originalDay = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(originalDay, lastDay));
  }
  return next;
}

/** Advance a completed recurring task to its first future deadline. */
export function nextTaskDueAt(currentDueAt: string, recurrence: TaskRecurrence, now = new Date()): string | null {
  if (recurrence === "none") return null;
  let next = new Date(currentDueAt);
  if (!Number.isFinite(next.getTime())) throw new Error("invalid_task_due_at");
  do next = addOneCycle(next, recurrence);
  while (next.getTime() <= now.getTime());
  return next.toISOString();
}
