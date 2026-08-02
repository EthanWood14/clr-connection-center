function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00.000Z`).getTime());
}

export function recurringCompDueDate(monthDate: string, requestedDay: number): string {
  if (!validDate(monthDate)) throw new Error("monthDate must use YYYY-MM-DD");
  const year = Number(monthDate.slice(0, 4));
  const month = Number(monthDate.slice(5, 7));
  const day = Math.max(1, Math.min(31, Math.trunc(Number(requestedDay)) || 1));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

// A missed cron tick may catch up after the scheduled day, but never before it.
export function recurringCompIsDue(today: string, requestedDay: number, lastFiledPeriod: string | null): boolean {
  if (!validDate(today)) return false;
  const period = today.slice(0, 7);
  return lastFiledPeriod !== period && today >= recurringCompDueDate(today, requestedDay);
}

export function recurringCompWasFiledEarly(
  today: string,
  requestedDay: number,
  lastFiledPeriod: string | null,
): boolean {
  if (!validDate(today)) return false;
  return lastFiledPeriod === today.slice(0, 7) && today < recurringCompDueDate(today, requestedDay);
}

export type RecurringCompRepair = {
  templateId: number;
  ownerId: number;
  period: string;
  removed: number;
};

export function repairEarlyRecurringCompRequests(db: any, today: string): RecurringCompRepair[] {
  const repairName = "comp_recurring_remove_early_generated_v1";
  db.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  if (db.prepare("SELECT 1 FROM migrations_applied WHERE name=?").get(repairName)) return [];

  const period = today.slice(0, 7);
  const monthLabel = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1))
    .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const templates = db.prepare("SELECT * FROM comp_recurring WHERE last_filed_period=?").all(period) as any[];
  const repairs: RecurringCompRepair[] = [];

  for (const template of templates) {
    const requestedDay = Number(template.day_of_month ?? 1);
    if (!recurringCompWasFiledEarly(today, requestedDay, template.last_filed_period ?? null)) continue;
    const dueDate = recurringCompDueDate(today, requestedDay);
    const generatedDescription = `${template.description} — ${monthLabel} (recurring)`.slice(0, 300);
    const repairOne = db.transaction(() => {
      const removed = db.prepare(`
        DELETE FROM comp_requests
        WHERE org_id=? AND user_id=? AND description=? AND amount_cents=?
          AND status IN ('draft','pending')
          AND COALESCE(is_paid,0)=0 AND reviewed_at IS NULL
          AND approval_token IS NOT NULL AND expense_date IS NULL
          AND substr(COALESCE(requested_at,created_at,''),1,10) < ?
          AND NOT EXISTS (
            SELECT 1 FROM comp_attachments ca
            WHERE ca.org_id=comp_requests.org_id AND ca.comp_id=comp_requests.id
          )
      `).run(template.org_id, template.user_id, generatedDescription, template.amount_cents, dueDate);
      if (removed.changes > 0) {
        db.prepare("UPDATE comp_recurring SET last_filed_period=NULL, updated_at=? WHERE id=? AND last_filed_period=?")
          .run(new Date().toISOString(), template.id, period);
      }
      return Number(removed.changes);
    });
    const removed = repairOne();
    if (removed > 0) repairs.push({ templateId: Number(template.id), ownerId: Number(template.user_id), period, removed });
  }

  db.prepare("INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)")
    .run(repairName, new Date().toISOString());
  return repairs;
}
