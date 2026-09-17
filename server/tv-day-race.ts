import type Database from "better-sqlite3";
import { TRANSFER_CREDIT_SQL } from "../shared/transfer-credit";
import { officeHourFromIso, type DayRaceHourCredit } from "../shared/tv-day-race";

/**
 * Today's transfer credits, stamped with the office-local hour they landed.
 * The Play-race button turns these into a timeline (shared/tv-day-race.ts);
 * empty hours are dropped there, not here, so the raw feed stays auditable.
 */
export function loadDayRaceHourCredits(
  db: Database.Database,
  orgId: number,
  today: string,
  tz: string,
): DayRaceHourCredit[] {
  const rows = db.prepare(
    `SELECT tc.user_id AS userId, tc.credit AS credit,
            COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', o.tv_transfer_event_at),
                     strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at)) AS at
       FROM (${TRANSFER_CREDIT_SQL}) tc
       JOIN lead_outcomes o ON o.id = tc.outcome_id
      WHERE tc.org_id = ? AND tc.date = ?`,
  ).all(orgId, today) as { userId: unknown; credit: unknown; at: unknown }[];

  const out: DayRaceHourCredit[] = [];
  for (const row of rows) {
    const userId = Number(row.userId);
    const credit = Number(row.credit);
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isFinite(credit) || credit <= 0) continue;
    const hour = officeHourFromIso(String(row.at ?? ""), tz);
    if (hour == null) continue;
    out.push({ hour, userId, credit });
  }
  return out;
}
