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
