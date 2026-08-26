import { STATE_CALL_RULES, type StateCallRule } from "@/data/state-call-hours";

// Primary timezone only. Multi-timezone states are intentionally marked as
// approximate in the result so the CLR still verifies the borrower's actual
// local time near a boundary.
const STATE_TIMEZONE: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago",
  CA: "America/Los_Angeles", CO: "America/Denver", CT: "America/New_York", DE: "America/New_York",
  DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver",
  NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
};

const MULTI_TZ_STATES = new Set(["AK", "FL", "ID", "IN", "KS", "KY", "MI", "ND", "NE", "OR", "SD", "TN", "TX"]);

export type StateCallStatus = {
  status: "allowed" | "prohibited" | "unknown";
  reason: string;
  localTime: string;
  approximate: boolean;
  rule: StateCallRule | null;
};

function minutes(hhmm: string) {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + (minute || 0);
}

export function stateCallStatus(stateCode: string, now = new Date()): StateCallStatus {
  const state = stateCode.trim().toUpperCase();
  const rule = STATE_CALL_RULES.find((item) => item.state === state) ?? null;
  const timeZone = STATE_TIMEZONE[state];
  const approximate = MULTI_TZ_STATES.has(state);
  if (!rule || !timeZone) {
    return { status: "unknown", reason: "Lead state is missing or unsupported", localTime: "Unknown", approximate, rule };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
    const localTime = new Intl.DateTimeFormat("en-US", {
      timeZone, weekday: "short", hour: "numeric", minute: "2-digit", hour12: true,
    }).format(now);
    if (weekday === "Sun" && rule.sunday_rule.toUpperCase().includes("PROHIBITED")) {
      return { status: "prohibited", reason: "Sunday calls are prohibited", localTime, approximate, rule };
    }
    if (weekday === "Sat" && rule.saturday_rule.toUpperCase().includes("PROHIBITED")) {
      return { status: "prohibited", reason: "Saturday calls are prohibited", localTime, approximate, rule };
    }
    const current = hour * 60 + minute;
    if (current < minutes(rule.start_hour)) {
      return { status: "prohibited", reason: `Calls start at ${rule.start_hour} local time`, localTime, approximate, rule };
    }
    if (current >= minutes(rule.end_hour)) {
      return { status: "prohibited", reason: `Calls must end by ${rule.end_hour} local time`, localTime, approximate, rule };
    }
    return { status: "allowed", reason: `Inside the ${rule.start_hour}–${rule.end_hour} window`, localTime, approximate, rule };
  } catch {
    return { status: "unknown", reason: "Local calling time could not be calculated", localTime: "Unknown", approximate, rule };
  }
}

