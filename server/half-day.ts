/**
 * Half-day time off: schema, lookups, and seeded marks.
 */
import {
  SEEDED_HALF_DAYS,
  STANDING_HALF_DAY_WHO,
  buildPaceExclusions,
  isHalfDayPortion,
  nameMatchesWho,
  normalizeDayPortion,
  resolveRosterUserIds,
  standingHalfDayUserIds,
  sumDayPortions,
  sumWorkedDayPortions,
  type DayPortion,
} from "@shared/half-day";

export {
  buildPaceExclusions,
  isHalfDayPortion,
  normalizeDayPortion,
  standingHalfDayUserIds,
  sumDayPortions,
  sumWorkedDayPortions,
};

/** Additive migration — safe to call on every boot. */
export function ensureHalfDaySchema(db: { exec: (sql: string) => unknown }): void {
  try {
    db.exec(`ALTER TABLE time_off_requests ADD COLUMN day_portion TEXT NOT NULL DEFAULT 'full'`);
  } catch { /* column already present */ }
}

type UserRow = { id: number; name?: string | null; org_id?: number; orgId?: number };

function activeUsers(db: any, orgId?: number): UserRow[] {
  try {
    if (orgId != null) {
      return db.prepare(
        `SELECT id, name, org_id FROM users
          WHERE is_active=1 AND archived_at IS NULL AND (org_id=? OR org_id IS NULL)`,
      ).all(orgId) as UserRow[];
    }
    return db.prepare(
      `SELECT id, name, org_id FROM users WHERE is_active=1 AND archived_at IS NULL`,
    ).all() as UserRow[];
  } catch {
    return [];
  }
}

/**
 * Insert approved half-day rows for Jackie (2026-09-17) and Chris Bermudez
 * (2026-09-18) when those people exist and no overlapping request is on file.
 * Idempotent.
 */
export function ensureSeededHalfDays(db: any): { inserted: number; matched: Array<{ who: string; userId: number; name: string; date: string }> } {
  ensureHalfDaySchema(db);
  const users = activeUsers(db);
  const matched: Array<{ who: string; userId: number; name: string; date: string }> = [];
  let inserted = 0;
  const now = new Date().toISOString();

  for (const seed of SEEDED_HALF_DAYS) {
    const hits = users.filter((u) => nameMatchesWho(u.name, seed.who));
    for (const user of hits) {
      const userId = Number(user.id);
      const orgId = Number(user.org_id ?? user.orgId ?? 1) || 1;
      matched.push({ who: seed.who, userId, name: String(user.name ?? ""), date: seed.date });
      const existing = db.prepare(
        `SELECT id, day_portion, status FROM time_off_requests
          WHERE org_id=? AND user_id=? AND start_date<=? AND end_date>=?
          ORDER BY id DESC LIMIT 1`,
      ).get(orgId, userId, seed.date, seed.date) as any;
      if (existing) {
        // Promote a full-day seed collision to half if it was our seed reason.
        if (existing.status === "approved" && !isHalfDayPortion(existing.day_portion)) {
          try {
            db.prepare(
              `UPDATE time_off_requests SET day_portion='half', reason=?, updated_at=? WHERE id=?`,
            ).run(seed.reason, now, existing.id);
          } catch { /* ignore */ }
        }
        continue;
      }
      try {
        db.prepare(
          `INSERT INTO time_off_requests
            (org_id, user_id, start_date, end_date, reason, status, day_portion, created_at, updated_at, reviewed_at)
           VALUES (?, ?, ?, ?, ?, 'approved', 'half', ?, ?, ?)`,
        ).run(orgId, userId, seed.date, seed.date, seed.reason, now, now, now);
        inserted += 1;
      } catch (e: any) {
        console.error("[half-day] seed insert failed:", e?.message ?? e);
      }
    }
  }
  return { inserted, matched };
}

/** Approved FULL-day time off only — half days still get LO assignments. */
export function approvedFullDayTimeOffUserIds(db: any, orgId: number, date: string): Set<number> {
  try {
    ensureHalfDaySchema(db);
    const rows = db.prepare(`
      SELECT DISTINCT user_id
      FROM time_off_requests
      WHERE org_id=? AND status='approved' AND start_date<=? AND end_date>=?
        AND COALESCE(day_portion, 'full') != 'half'
    `).all(orgId, date, date) as Array<{ user_id: number }>;
    return new Set(rows.map((r) => Number(r.user_id)));
  } catch {
    // Pre-migration fallback: treat every approved row as full day.
    const rows = db.prepare(`
      SELECT DISTINCT user_id FROM time_off_requests
      WHERE org_id=? AND status='approved' AND start_date<=? AND end_date>=?
    `).all(orgId, date, date) as Array<{ user_id: number }>;
    return new Set(rows.map((r) => Number(r.user_id)));
  }
}

/** Anyone on approved half-day time off for `date`, plus standing half-day people. */
export function halfDayUserIdsForDate(db: any, orgId: number, date: string, users?: UserRow[]): Set<number> {
  const ids = new Set<number>();
  const roster = users ?? activeUsers(db, orgId);
  for (const id of standingHalfDayUserIds(roster)) ids.add(id);
  try {
    ensureHalfDaySchema(db);
    const rows = db.prepare(`
      SELECT DISTINCT user_id FROM time_off_requests
      WHERE org_id=? AND status='approved' AND start_date<=? AND end_date>=?
        AND COALESCE(day_portion, 'full') = 'half'
    `).all(orgId, date, date) as Array<{ user_id: number }>;
    for (const r of rows) ids.add(Number(r.user_id));
  } catch { /* ignore */ }
  return ids;
}

/** True when this user should not be marked late today (half day or standing). */
export function isHalfDayExcusedFromLate(db: any, orgId: number, userId: number, date: string, userName?: string | null): boolean {
  if (STANDING_HALF_DAY_WHO.some((who) => nameMatchesWho(userName, who))) return true;
  try {
    ensureHalfDaySchema(db);
    const row = db.prepare(`
      SELECT 1 AS ok FROM time_off_requests
      WHERE org_id=? AND user_id=? AND status='approved' AND start_date<=? AND end_date>=?
        AND COALESCE(day_portion, 'full') = 'half'
      LIMIT 1
    `).get(orgId, userId, date, date) as any;
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Build the halfDays set and exclusions the weekly pace feed needs, resolving
 * roster names to ids at read time.
 */
export function paceHalfDayContext(db: any, orgId: number, from: string, today: string): {
  halfDays: Set<string>;
  excludedDays: Array<{ userId: number; date: string }>;
  resolved: {
    jeremy?: { id: number; name: string };
    jackie?: { id: number; name: string };
    chris?: { id: number; name: string };
    rosas: Array<{ id: number; name: string }>;
  };
} {
  const users = activeUsers(db, orgId);
  const halfDays = new Set<string>();
  const standing = standingHalfDayUserIds(users);

  // Standing: every weekday from `from` through `today`.
  for (const id of standing) {
    for (let d = from; d <= today; ) {
      const day = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (day >= 1 && day <= 5) halfDays.add(`${id}:${d}`);
      const next = new Date(`${d}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      d = next.toISOString().slice(0, 10);
    }
  }

  try {
    ensureHalfDaySchema(db);
    const rows = db.prepare(`
      SELECT user_id, start_date, end_date FROM time_off_requests
      WHERE org_id=? AND status='approved' AND COALESCE(day_portion,'full')='half'
        AND end_date >= ? AND start_date <= ?
    `).all(orgId, from, today) as Array<{ user_id: number; start_date: string; end_date: string }>;
    for (const r of rows) {
      let d = String(r.start_date);
      const end = String(r.end_date);
      while (d <= end && d <= today) {
        if (d >= from) halfDays.add(`${Number(r.user_id)}:${d}`);
        const next = new Date(`${d}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        d = next.toISOString().slice(0, 10);
      }
    }
  } catch { /* ignore */ }

  const excludedDays = buildPaceExclusions(users).map(({ userId, date }) => ({ userId, date }));

  const pick = (who: "jeremy" | "jackie" | "chris") => {
    const hits = users.filter((u) => nameMatchesWho(u.name, who));
    if (!hits.length) return undefined;
    return { id: Number(hits[0].id), name: String(hits[0].name ?? "") };
  };

  return {
    halfDays,
    excludedDays,
    resolved: {
      jeremy: pick("jeremy"),
      jackie: pick("jackie"),
      chris: pick("chris"),
      rosas: resolveRosterUserIds(users, "rosas").map((id) => {
        const u = users.find((x) => Number(x.id) === id)!;
        return { id, name: String(u.name ?? "") };
      }),
    },
  };
}

export function parseDayPortionBody(body: any): DayPortion {
  return normalizeDayPortion(body?.dayPortion ?? body?.day_portion ?? body?.halfDay);
}
