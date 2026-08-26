import { nextTaskOccurrenceDueAt, normalizeTaskScheduleDays, type TaskRecurrence } from "../shared/clr-tasks";
import { BUSINESS_DAY_DEFAULT_TZ, parseWallClockInTz } from "./business-day";

type TaskDb = {
  prepare(sql: string): any;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
};

function scheduleDays(row: any): number[] {
  try {
    return normalizeTaskScheduleDays(JSON.parse(String(row.schedule_days ?? "[]")));
  } catch {
    return [];
  }
}

export function nextTaskOccurrenceForRow(row: any): string | null {
  const timezone = String(row.recurrence_timezone || BUSINESS_DAY_DEFAULT_TZ);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(String(row.due_at)));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Treat the task's local wall clock as a floating UTC date while adding the
  // calendar cycle, then resolve that wall clock back into its real timezone.
  // This keeps "Friday at 5 PM" at 5 PM across daylight-saving transitions.
  const floating = new Date(Date.UTC(
    value("year"), value("month") - 1, value("day"),
    value("hour"), value("minute"), value("second"),
  )).toISOString();
  const nextWall = nextTaskOccurrenceDueAt(
    floating,
    String(row.recurrence) as TaskRecurrence,
    scheduleDays(row),
  );
  if (!nextWall) return null;
  const absolute = parseWallClockInTz(nextWall.slice(0, 19), timezone);
  if (!Number.isFinite(absolute)) throw new Error("invalid_task_recurrence_timezone");
  return new Date(absolute).toISOString();
}

/**
 * Create exactly one successor for a recurring task occurrence.
 *
 * Every occurrence remains its own row, so a missed Monday does not disappear
 * when Tuesday arrives. The guarded parent pointer and series/deadline index
 * make this safe when a completion and the minute scheduler race each other.
 */
export function spawnNextTaskOccurrence(db: TaskDb, taskId: number): any | null {
  return db.transaction(() => {
    const task = db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(taskId) as any;
    if (!task || task.recurrence === "none" || task.spawned_next_task_id != null) return null;
    const nextDue = nextTaskOccurrenceForRow(task);
    if (!nextDue) return null;
    const now = new Date().toISOString();
    const seriesId = Number(task.series_id ?? task.id);
    let childId: number;
    try {
      const created = db.prepare(`INSERT INTO clr_tasks
        (org_id,title,description,assigned_user_id,created_by_user_id,priority,recurrence,schedule_days,recurrence_timezone,due_at,status,series_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`).run(
          task.org_id, task.title, task.description, task.assigned_user_id,
          task.created_by_user_id, task.priority, task.recurrence,
          task.schedule_days ?? "[]", task.recurrence_timezone || BUSINESS_DAY_DEFAULT_TZ,
          nextDue, seriesId, now, now,
        );
      childId = Number(created.lastInsertRowid);
    } catch (error: any) {
      if (!/unique/i.test(String(error?.message ?? ""))) throw error;
      const existing = db.prepare(`SELECT id FROM clr_tasks WHERE series_id=? AND due_at=?`).get(seriesId, nextDue) as any;
      if (!existing) throw error;
      childId = Number(existing.id);
    }
    db.prepare(`UPDATE clr_tasks SET spawned_next_task_id=?,updated_at=?
      WHERE id=? AND spawned_next_task_id IS NULL`).run(childId, now, task.id);
    return db.prepare(`SELECT * FROM clr_tasks WHERE id=?`).get(childId) as any;
  })();
}

/**
 * Catch every recurring series up through one future occurrence.
 * Completed rows spawn immediately; open rows spawn when their deadline lands.
 */
export function ensureRecurringTaskOccurrences(db: TaskDb, nowIso = new Date().toISOString(), maxCreated = 500, orgId?: number): any[] {
  const created: any[] = [];
  while (created.length < maxCreated) {
    const sql = `SELECT id FROM clr_tasks
      WHERE recurrence<>'none' AND spawned_next_task_id IS NULL
        AND (status='completed' OR (status='active' AND due_at<=?))
        ${orgId == null ? "" : "AND org_id=?"}
      ORDER BY due_at,id LIMIT 1`;
    const row = db.prepare(sql).get(...(orgId == null ? [nowIso] : [nowIso, orgId])) as any;
    if (!row) break;
    const child = spawnNextTaskOccurrence(db, Number(row.id));
    if (!child) break;
    created.push(child);
  }
  return created;
}

export function overdueEmailRetryAt(now: Date, attempts: number): string {
  const minutes = Math.min(60, 5 * (2 ** Math.max(0, attempts)));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function nextOverdueReminderAt(now: Date): string {
  return new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
}
