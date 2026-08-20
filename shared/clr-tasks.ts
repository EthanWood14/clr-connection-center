export const TASK_RECURRENCES = ["none", "daily", "weekdays", "weekly", "custom_weekly", "monthly"] as const;
export type TaskRecurrence = typeof TASK_RECURRENCES[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];

export function isTaskRecurrence(value: unknown): value is TaskRecurrence {
  return TASK_RECURRENCES.includes(value as TaskRecurrence);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return TASK_PRIORITIES.includes(value as TaskPriority);
}

export function normalizeTaskScheduleDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
}

function addOneCycle(date: Date, recurrence: Exclude<TaskRecurrence, "none">, scheduleDays: number[]): Date {
  const next = new Date(date);
  if (recurrence === "custom_weekly") {
    if (!scheduleDays.length) throw new Error("custom_weekly_requires_days");
    do next.setUTCDate(next.getUTCDate() + 1);
    while (!scheduleDays.includes(next.getUTCDay()));
    return next;
  }
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
export function nextTaskDueAt(currentDueAt: string, recurrence: TaskRecurrence, now = new Date(), scheduleDays: unknown = []): string | null {
  if (recurrence === "none") return null;
  const days = normalizeTaskScheduleDays(scheduleDays);
  let next = new Date(currentDueAt);
  if (!Number.isFinite(next.getTime())) throw new Error("invalid_task_due_at");
  do next = addOneCycle(next, recurrence, days);
  while (next.getTime() <= now.getTime());
  return next.toISOString();
}
