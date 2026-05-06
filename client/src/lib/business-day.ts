// Client-side business-day helpers.
// Mirrors server/business-day.ts: 10pm forward rollover, in the user's timezone.
//
// Use businessTodayClient() anywhere the UI was previously using
// `new Date().toISOString().split("T")[0]` or similar to pick "today's" date.

const ROLLOVER_HOUR = 22;
const DEFAULT_TZ = "America/Los_Angeles";

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

function formatDateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function hourInTz(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find(p => p.type === "hour")?.value ?? "0";
  const n = parseInt(h, 10);
  return isNaN(n) ? 0 : (n === 24 ? 0 : n);
}

export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(n => parseInt(n, 10));
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + days);
  return formatDateInTz(t, "UTC");
}

/**
 * Business "today" in the given (or browser-detected) timezone, with 10pm rollover.
 */
export function businessTodayInTz(tz?: string, now: Date = new Date()): string {
  const zone = tz || browserTz();
  const calendarDate = formatDateInTz(now, zone);
  const hour = hourInTz(now, zone);
  return hour >= ROLLOVER_HOUR ? addIsoDays(calendarDate, 1) : calendarDate;
}

/**
 * Convenience: business "today" using the browser's detected timezone.
 * This is what most of the UI should call.
 */
export function businessTodayClient(now: Date = new Date()): string {
  return businessTodayInTz(undefined, now);
}

export const BUSINESS_DAY_ROLLOVER_HOUR = ROLLOVER_HOUR;
