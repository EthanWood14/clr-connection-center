/**
 * The office TV.
 *
 * Everything the wallboard shows is derived here from plain rows, so the rules
 * for "what counts as a miss", "what is a milestone", and "which tip is next"
 * can be tested without booting the server. The route in routes.ts only runs
 * the SQL and hands the rows over.
 *
 * Two design rules the whole board rests on:
 *
 *  1. Events come from ONE cursor over COALESCE(updated_at, created_at). A new
 *     transfer is an insert; an appointment being marked missed is an UPDATE
 *     to an existing row. An id cursor would show the first and never the
 *     second, and the misses are half of what Ethan asked to see.
 *
 *  2. Milestones have stable ids. The TV polls every ten seconds and must
 *     celebrate "50 transfers today" exactly once, not once per poll. The id
 *     encodes what was crossed and on which day, and the client remembers
 *     which ids it has already played.
 */
import { TRAINING_DAYS, type TrainingDay } from "@shared/clr-training";

export type TvEventKind =
  | "transfer"
  | "appointment"
  | "rescheduled"
  | "fell_through"
  | "missed_appointment";

export interface TvEvent {
  /** Row id plus the kind, so an appointment that later becomes a miss animates twice, as two different things. */
  id: string;
  kind: TvEventKind;
  at: string;
  borrower: string;
  who: string;
  lo: string | null;
  /** The one line under the headline: an LO name, a time, a reason. */
  detail: string | null;
}

/** The subset of a lead_outcomes row the classification needs. */
export interface OutcomeRow {
  id: number;
  outcome_type: string;
  transfer_type?: string | null;
  borrower_name?: string | null;
  appointment_datetime?: string | null;
  reschedule_datetime?: string | null;
  rescheduled?: number | null;
  missed_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  assistant_name?: string | null;
  lo_name?: string | null;
}

const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);

/** "2026-09-01T15:30" → "Tue 3:30 PM", in the office's own clock. */
export function whenLabel(iso: string | null | undefined, tz = "America/Los_Angeles"): string | null {
  if (!iso) return null;
  const s = String(iso).trim();
  // Shape first. V8's legacy date parser is lenient enough to read "garbage"
  // as a real date, which would put a fake time on the wall.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return clean(s, 40) || null;
  const d = new Date(s.length <= 16 ? `${s}:00` : s);
  if (isNaN(d.getTime())) return clean(s, 40) || null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit",
    }).format(d);
  } catch { return null; }
}

/**
 * What a row means on the wall.
 *
 * Returns null for anything the board should not shout about — a no-answer,
 * a wrong number, a deferral. The TV is for the moments worth looking up for.
 */
export function classifyOutcome(row: OutcomeRow): TvEvent | null {
  const at = String(row.updated_at || row.created_at || "");
  const base = {
    at,
    borrower: clean(row.borrower_name) || "A borrower",
    who: clean(row.assistant_name) || "A CLR",
    lo: clean(row.lo_name) || null,
  };
  switch (row.outcome_type) {
    case "transfer":
      return { ...base, id: `${row.id}:transfer`, kind: "transfer", detail: base.lo ? `to ${base.lo}` : null };
    case "appointment":
      if (row.rescheduled) {
        const when = whenLabel(row.reschedule_datetime || row.appointment_datetime);
        return { ...base, id: `${row.id}:rescheduled`, kind: "rescheduled", detail: when ? `Moved to ${when}` : "Rescheduled" };
      }
      return {
        ...base, id: `${row.id}:appointment`, kind: "appointment",
        detail: whenLabel(row.appointment_datetime) ?? (base.lo ? `with ${base.lo}` : null),
      };
    case "fell_through": {
      // A fell-through WITH a missed reason is an appointment that did not
      // happen — that is the "appt miss" Ethan asked for. Without one it is an
      // ordinary transfer that did not stick.
      const reason = clean(row.missed_reason, 90);
      if (reason) return { ...base, id: `${row.id}:missed`, kind: "missed_appointment", detail: reason };
      return { ...base, id: `${row.id}:fell_through`, kind: "fell_through", detail: base.lo ? `with ${base.lo}` : null };
    }
    default:
      return null;
  }
}

// ── milestones ──────────────────────────────────────────────────────────────

export interface Milestone {
  /** Stable across polls: what was crossed, by whom, on which day or week. */
  id: string;
  kind: "team_day" | "team_week" | "goal_transfers" | "goal_appointments" | "personal_best" | "leader";
  headline: string;
  detail: string;
  /** Larger numbers get the bigger celebration. */
  weight: 1 | 2 | 3;
}

export interface PersonStats {
  id: number;
  name: string;
  transfersToday: number;
  transfersWeek: number;
  appointmentsToday: number;
  appointmentsWeek: number;
  goalTransfersWeekly: number;
  goalAppointmentsWeekly: number;
  /** ISO stamps, or null when it has never happened. */
  lastTransferAt?: string | null;
  lastCallAt?: string | null;
  /** Their best single day before today, for the personal-best check. */
  bestDayBefore: number;
}

export interface BoardInput {
  today: string;
  /** Monday of the current week, YYYY-MM-DD. */
  weekStart: string;
  people: PersonStats[];
}

const TEAM_DAY_STEPS = [10, 25, 50, 75, 100, 150];
const TEAM_WEEK_STEPS = [100, 150, 200, 250, 300, 400, 500];

/** The largest step at or below n, or null. */
function crossed(n: number, steps: number[]): number | null {
  let hit: number | null = null;
  for (const s of steps) if (n >= s) hit = s;
  return hit;
}

/**
 * Every milestone that is TRUE right now. The client keeps the set of ids it
 * has already celebrated, so this is idempotent by construction — it does not
 * try to work out what is new, only what is so.
 */
export function detectMilestones(input: BoardInput): Milestone[] {
  const out: Milestone[] = [];
  const teamDay = input.people.reduce((n, p) => n + p.transfersToday, 0);
  const teamWeek = input.people.reduce((n, p) => n + p.transfersWeek, 0);

  const d = crossed(teamDay, TEAM_DAY_STEPS);
  if (d) out.push({
    id: `team-day-${d}-${input.today}`, kind: "team_day", weight: d >= 50 ? 3 : 2,
    headline: `${d} transfers today`, detail: "The whole floor. Keep it going.",
  });
  const w = crossed(teamWeek, TEAM_WEEK_STEPS);
  if (w) out.push({
    id: `team-week-${w}-${input.weekStart}`, kind: "team_week", weight: w >= 250 ? 3 : 2,
    headline: `${w} transfers this week`, detail: `Since Monday.`,
  });

  for (const p of input.people) {
    if (p.goalTransfersWeekly > 0 && p.transfersWeek >= p.goalTransfersWeekly) out.push({
      id: `goal-transfers-${p.id}-${input.weekStart}`, kind: "goal_transfers", weight: 2,
      headline: `${p.name} hit their weekly goal`, detail: `${p.transfersWeek} of ${p.goalTransfersWeekly} transfers`,
    });
    if (p.goalAppointmentsWeekly > 0 && p.appointmentsWeek >= p.goalAppointmentsWeekly) out.push({
      id: `goal-appointments-${p.id}-${input.weekStart}`, kind: "goal_appointments", weight: 1,
      headline: `${p.name} hit their appointment goal`, detail: `${p.appointmentsWeek} of ${p.goalAppointmentsWeekly} this week`,
    });
    // A personal best needs a real history to beat, and beating it by one on
    // a two-transfer record is not a moment. Three or more, and strictly more.
    if (p.bestDayBefore >= 3 && p.transfersToday > p.bestDayBefore) out.push({
      id: `personal-best-${p.id}-${input.today}-${p.transfersToday}`, kind: "personal_best", weight: 3,
      headline: `${p.name} — personal best`, detail: `${p.transfersToday} transfers today. Old record was ${p.bestDayBefore}.`,
    });
  }

  // Heaviest first, so a queue that only has time for one plays the right one.
  return out.sort((a, b) => b.weight - a.weight);
}

// ── training tips ───────────────────────────────────────────────────────────

export interface Tip {
  day: number;
  half: "morning" | "afternoon" | "eod";
  text: string;
  author: string;
}

/** Every step in the plan, flattened, in reading order. */
export function flattenTips(days: TrainingDay[] = TRAINING_DAYS, author = "Matt Lane"): Tip[] {
  const out: Tip[] = [];
  for (const d of days) {
    for (const t of d.morning) out.push({ day: d.day, half: "morning", text: t, author });
    for (const t of d.afternoon) out.push({ day: d.day, half: "afternoon", text: t, author });
    if (d.eod) out.push({ day: d.day, half: "eod", text: d.eod, author });
  }
  return out;
}

/**
 * The tip for a given seed. Deterministic so ten TVs on the same wall show the
 * same one, and a stride coprime to the count so consecutive seeds walk the
 * whole plan rather than lingering in day one.
 */
export function pickTip(seed: number, tips: Tip[]): Tip | null {
  if (!tips.length) return null;
  const n = tips.length;
  // A stride around 37% of n is far from any small divisor; fall back to 1 if
  // it shares a factor, so every tip is still reached.
  let stride = Math.max(1, Math.floor(n * 0.37));
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  while (gcd(stride, n) !== 1 && stride > 1) stride -= 1;
  const i = ((Math.floor(Math.abs(seed)) * stride) % n + n) % n;
  return tips[i];
}
