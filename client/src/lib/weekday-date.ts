// Shift weekend dates onto the following Monday for chart aggregation.
// Returns the original `YYYY-MM-DD` string unchanged if it falls Mon–Fri,
// or the next Monday's date string if it falls on Sat (6) / Sun (0).
export function toWeekdayDate(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") return dateStr;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 12, 0, 0));
  const dow = dt.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0) {
    dt.setUTCDate(dt.getUTCDate() + 1);
  } else if (dow === 6) {
    dt.setUTCDate(dt.getUTCDate() + 2);
  } else {
    return dateStr.slice(0, 10);
  }
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// True if `YYYY-MM-DD` falls on Mon–Fri.
export function isWeekday(dateStr: string): boolean {
  if (!dateStr) return false;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  const dow = dt.getUTCDay();
  return dow >= 1 && dow <= 5;
}

// Aggregate an array of rows keyed by a `YYYY-MM-DD` date field, shifting
// weekend rows onto the following Monday and summing all numeric fields.
// Non-numeric fields are taken from the first row encountered for that date.
export function aggregateByWeekday<T extends Record<string, any>>(
  rows: T[],
  dateKey: keyof T = "date" as keyof T,
): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const raw = row[dateKey];
    if (typeof raw !== "string") continue;
    const shifted = toWeekdayDate(raw);
    const existing = map.get(shifted);
    if (!existing) {
      map.set(shifted, { ...row, [dateKey]: shifted } as T);
    } else {
      const merged: Record<string, any> = { ...existing };
      for (const k of Object.keys(row)) {
        const a = (existing as any)[k];
        const b = (row as any)[k];
        if (typeof a === "number" && typeof b === "number") {
          merged[k] = a + b;
        }
      }
      merged[dateKey as string] = shifted;
      map.set(shifted, merged as T);
    }
  }
  return Array.from(map.values()).sort((a: any, b: any) =>
    String(a[dateKey]).localeCompare(String(b[dateKey])),
  );
}

// Re-bucket history-style periods (each having a `startDate` YYYY-MM-DD) so that
// any Sat/Sun bucket's numeric fields are merged onto the next Monday bucket.
// If a Monday bucket doesn't exist (e.g. range starts on Sun), one is created
// using the weekend bucket's shifted date. Non-numeric fields (label, etc.)
// come from the Monday bucket when present, otherwise from the weekend bucket
// (with the label recomputed to the Monday date).
export function shiftWeekendBucketsToMonday<T extends { startDate?: string; endDate?: string; label?: string } & Record<string, any>>(
  buckets: T[],
): T[] {
  if (!Array.isArray(buckets) || buckets.length === 0) return buckets;
  // Only treat as date-bucketed when startDate === endDate (i.e. daily granularity)
  const isDaily = (b: T) => !!b?.startDate && b.startDate === b.endDate;
  if (!buckets.some(isDaily)) return buckets;

  const byDate = new Map<string, T>();
  const order: string[] = [];
  for (const b of buckets) {
    if (!isDaily(b)) {
      const key = `__nondaily__${order.length}`;
      byDate.set(key, b);
      order.push(key);
      continue;
    }
    const shifted = toWeekdayDate(b.startDate!);
    if (!byDate.has(shifted)) {
      // Create / use the Monday slot. If b is itself a weekday Monday, keep as-is.
      // If b is a weekend, build a synthetic shifted bucket with merged numerics.
      if (b.startDate === shifted) {
        byDate.set(shifted, { ...b });
      } else {
        const m = shifted.match(/^(\d{4})-(\d{2})-(\d{2})/)!;
        const mondayDt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
        const newLabel = mondayDt.toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
        byDate.set(shifted, { ...b, startDate: shifted, endDate: shifted, label: newLabel });
      }
      order.push(shifted);
    } else {
      const existing = byDate.get(shifted) as any;
      const merged: any = { ...existing };
      for (const k of Object.keys(b)) {
        const a = existing[k];
        const v = (b as any)[k];
        if (typeof a === "number" && typeof v === "number") {
          merged[k] = a + v;
        }
      }
      byDate.set(shifted, merged);
    }
  }
  return order.map(k => byDate.get(k)!).filter(Boolean);
}

