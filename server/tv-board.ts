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
  /** The LO's assistant this transfer was handed to, when there is one. Not the CLR — that is assistant_name. */
  loa_name?: string | null;
}

const clean = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);

/**
 * An appointment stamp reduced to the slot it actually names: the day, and
 * the clock reading if there is one.
 *
 * "2026-09-04T14:30:00" and "2026-09-04 14:30" are one meeting typed two ways.
 * A datetime-local input rewriting the seconds off a stored value must never
 * read as a rebooking, and must never mint a second event id for a meeting
 * that did not move.
 */
export function normalizeAppointmentTime(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return s;
  return m[2] ? `${m[1]}T${m[2]}:${m[3]}` : m[1];
}

/**
 * Did this edit MOVE a meeting? Returns the new time if so, else null.
 *
 * A move is done by overwriting the time in place, so only the incoming patch
 * and the row as it still stands can tell a rebooking from a notes edit — one
 * statement later the old time is gone, and the audit log keeps new values
 * only. Hence the flag is written at edit time, not worked out afterwards.
 *
 * Three client paths reach this, all of them PATCH /api/outcomes/:id: the
 * Appointments page's quick reschedule and its full edit dialog, and the
 * Outcomes page's edit dialog. All three mirror a moved meeting onto BOTH
 * followUpDate and appointmentDatetime, so as things stand either field alone
 * would catch every move those pages make. Both are watched anyway: the mirror
 * is a convention the pages keep, not a rule this endpoint enforces, and a
 * patch naming only one of the two columns is a legal patch.
 *
 * A patched field is compared against BOTH stored columns, not against its own
 * one. The two columns disagree on plenty of rows already in the table: the
 * Outcomes edit dialog used to save followUpDate alone and leave
 * appointment_datetime on the original time, and every meeting it moved before
 * it started mirroring is still that shape. The Appointments edit dialog
 * rebuilds appointmentDatetime out of the follow-up field on every save that
 * carries one, a notes-only save included — it posts the whole record. (The
 * Outcomes dialog now names a time only when the follow-up actually CHANGED,
 * so its notes saves name neither column; the rows it drifted before it
 * mirrored at all are still in the table.) Compared
 * field-against-its-own-column, that notes save on such a row reads as a move
 * — a false REBOOKED on the wall, and a false "rescheduled" to Bonzo, which
 * deletes and recreates the LO's task. A time that already sits in either
 * column is a time this meeting already has, whichever field the patch puts it
 * in.
 *
 * The known and accepted cost, stated in full because it is bigger than
 * silence: moving a meeting BACK onto a time still sitting in the other column
 * is not detected. The wall says nothing for that rebooking, AND no Bonzo sync
 * fires for it either — the LO's task keeps the abandoned time and the LO is
 * never told the meeting came back. The rule is deliberately not total: it
 * trades that one missed rebooking for never inventing one, because a false
 * REBOOKED does not just mis-light the TV, it deletes and recreates the LO's
 * task at a time nobody chose.
 *
 * What the PATCH does still fix, via rescheduleStampIsStale below, is the
 * loudest half of it: the stale `rescheduled` / `reschedule_datetime` left on
 * the row no longer survives the missed move, so the Latest strip stops
 * advertising "Rebooked to <the abandoned time>". Retraction only — a missed
 * move is never turned into a claimed one.
 */
export function detectAppointmentMove(
  before: { outcome_type?: unknown; appointment_datetime?: unknown; follow_up_date?: unknown } | null | undefined,
  patch: Record<string, unknown>,
): string | null {
  if (!before || !patch) return null;
  if (String(before.outcome_type ?? "") !== "appointment") return null;
  // Converting the appointment into something else — a transfer, a
  // fall-through — is its own moment, whatever date rides along in the patch.
  if (patch.outcomeType !== undefined && patch.outcomeType !== "appointment") return null;
  // Every slot this meeting already occupies, from either column.
  const oldSlots = [before.appointment_datetime, before.follow_up_date]
    .map((v) => normalizeAppointmentTime(v))
    .filter((s) => s !== "");
  // A move needs somewhere to have come FROM. Putting a first time onto a
  // dateless row is a booking, not a rebooking — the wall already played
  // BOOKED! for that row. (routes.ts still tells Bonzo about it: the task the
  // LO needs cannot exist until the appointment has a time.)
  if (!oldSlots.length) return null;
  for (const field of ["appointmentDatetime", "followUpDate"]) {
    if (!(field in patch)) continue;
    const to = normalizeAppointmentTime(patch[field]);
    // Clearing the time is not a move; nor is writing back a slot the meeting
    // is already in, however the other column happens to spell it.
    if (!to || oldSlots.indexOf(to) !== -1) continue;
    return String(patch[field]);
  }
  return null;
}

/**
 * Is a stored reschedule stamp describing a slot this meeting no longer has?
 *
 * A live REBOOKED claim always names a time one of the two columns is actually
 * holding — the move that made the claim wrote both. A stamp matching NEITHER
 * column names a slot that was abandoned, and the only surface that reads it,
 * classifyOutcome's rescheduled branch, would put that abandoned time on the
 * wall as "Rebooked to …". Rows the Outcomes edit dialog moved before it
 * started mirroring the two columns are exactly this shape once a meeting is
 * moved back onto the time the other column was still holding: no move is
 * detected, so nothing refreshes the stamp.
 *
 * Answers one question only — "does this stamp still describe anything?" — so
 * the caller can RETRACT it. It can never say a meeting moved.
 */
export function rescheduleStampIsStale(
  stored: unknown,
  nextAppointment: unknown,
  nextFollowUp: unknown,
): boolean {
  const stamp = normalizeAppointmentTime(stored);
  if (!stamp) return false;
  return stamp !== normalizeAppointmentTime(nextAppointment)
    && stamp !== normalizeAppointmentTime(nextFollowUp);
}

/** "2026-09-01T15:30" → "Tue 3:30 PM", in the office's own clock. */
export function whenLabel(iso: string | null | undefined, tz = "America/Los_Angeles"): string | null {
  if (!iso) return null;
  const s = String(iso).trim();
  // Shape first. V8's legacy date parser is lenient enough to read "garbage"
  // as a real date, which would put a fake time on the wall.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return clean(s, 40) || null;
  // A stamp with no zone is a WALL CLOCK: an appointment typed as 14:30 means
  // half two in the office, whatever the server thinks the time is. Handing
  // that string to new Date() reads it in the SERVER's zone — and the server
  // runs in UTC, so a 2:30 PM appointment came out on the wall as 7:30 AM.
  // Read the digits and render them; only convert when a zone is actually
  // present.
  const naive = !/(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (naive) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return clean(s, 40) || null;
    const [, y, mo, day, hh, mm] = m;
    const h24 = Number(hh);
    if (!Number.isFinite(h24) || h24 > 23 || Number(mm) > 59) return clean(s, 40) || null;
    // Noon UTC so the weekday can never slide across a date boundary.
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" })
      .format(new Date(`${y}-${mo}-${day}T12:00:00Z`));
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${weekday} ${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
  }
  const d = new Date(s);
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
    case "transfer": {
      // A transfer handed to an LO's assistant says which assistant. Keyed off
      // "this transfer HAS an LOA", never off the LO's name — only Redoble has
      // assistants today, and this must not go quiet the day another LO gets
      // one. The latest-moments row already joins its fields with "·", so the
      // assistant hangs off a dash rather than adding a third dot.
      const loa = clean(row.loa_name, 40);
      const detail = base.lo
        ? (loa ? `to ${base.lo} — LOA ${loa}` : `to ${base.lo}`)
        : (loa ? `to LOA ${loa}` : null);
      return { ...base, id: `${row.id}:transfer`, kind: "transfer", detail };
    }
    case "appointment":
      if (row.rescheduled) {
        // The id carries the slot it moved TO. The client remembers every id
        // it has played, so a second rebooking under a bare `${id}:rescheduled`
        // would land on the first one's id and be swallowed in silence.
        const to = row.reschedule_datetime || row.appointment_datetime;
        const when = whenLabel(to);
        return {
          ...base, id: `${row.id}:rescheduled:${normalizeAppointmentTime(to) || "?"}`, kind: "rescheduled",
          detail: when ? `Rebooked to ${when}` : "Rebooked",
        };
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
  /** Who wrote the training plan this came out of. Always present. */
  author: string;
  /**
   * Who SAID it — set only for the attributed half of the wall-quote book, and
   * absent (or null) for a manual line, which is nobody's quotation. The board
   * prints an attribution only when this is a non-empty string; see TipPage in
   * client/src/pages/tv.tsx.
   */
  quoteAuthor?: string | null;
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
