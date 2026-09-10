// Client-side business-day helpers.
// Mirrors server/business-day.ts: the business day rolls over at 7pm (19:00) in
// the user's timezone. Anything logged before 7pm counts toward the current
// day; from 7pm onward it counts toward the next day (so a CLR can submit their
// EOD for "today" any time up to 7pm).
//
// Use businessTodayClient() anywhere the UI was previously using
// `new Date().toISOString().split("T")[0]` or similar to pick "today's" date.

const ROLLOVER_HOUR = 19;
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
 * Business "today" in the given (or browser-detected) timezone, with a 7pm rollover.
 */
export function businessTodayInTz(tz?: string, now: Date = new Date()): string {
  const zone = tz || browserTz();
  const calendarDate = formatDateInTz(now, zone);
  const hour = hourInTz(now, zone);
  return hour >= ROLLOVER_HOUR ? addIsoDays(calendarDate, 1) : calendarDate;
}

/**
 * The signed-in user's timezone, once auth has resolved it.
 *
 * Module state rather than a parameter because this is one fact that every
 * call site needs and none should have to carry: businessTodayClient() is
 * called from ten places, and threading a timezone through all of them would
 * put the burden of remembering on whoever adds the eleventh.
 */
let preferredTz: string | null = null;

/** Called once by the auth provider. Pass null/empty to fall back to the device. */
export function setClientTimezone(tz: unknown): void {
  const value = String(tz ?? "").trim();
  preferredTz = value || null;
}

/** Exposed for tests and for anything that wants to show which zone is in use. */
export function clientTimezone(): string | null {
  return preferredTz;
}

/**
 * Business "today" for the signed-in user.
 *
 * IT USES THEIR CONFIGURED TIMEZONE, NOT THE DEVICE'S, and that distinction
 * is the whole point of this function existing. It stamps the date on every
 * outcome logged in Input Results, and it used to read the browser clock —
 * so Elleine, who works Manila hours, had her entire shift stamped with
 * TOMORROW's date: 9:51pm Manila is past the 7pm rollover, giving the next
 * day, while the office and the wallboard were still on the day before. Her
 * transfers appeared on the TV as zero every single day, then arrived a day
 * late (found 10 Sep 2026). Her C3 profile had said America/Los_Angeles all
 * along; nothing was reading it.
 *
 * The device is still the fallback, for a signed-out screen or a profile
 * with no timezone set — which is the old behaviour, and correct for anyone
 * sitting in the office.
 */
export function businessTodayClient(now: Date = new Date()): string {
  return businessTodayInTz(preferredTz || undefined, now);
}

export const BUSINESS_DAY_ROLLOVER_HOUR = ROLLOVER_HOUR;
