import type { Express, Request, Response, NextFunction } from "express";
import { BUSINESS_DAY_DEFAULT_TZ, businessTodayInTz } from "./business-day";
import { loadDayRaceHourCredits } from "./tv-day-race";

type Sqlite = {
  prepare: (sql: string) => { get: (...args: unknown[]) => any };
};

/**
 * Attach today's hourly transfer credits to the TV feed JSON so the Play race
 * button can walk the day without editing the giant feed handler in routes.ts.
 */
export function installTvDayRaceFeedEnrichment(app: Express, getSqlite: () => Sqlite) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const match = req.path.match(/^\/api\/tv\/([^/]+)\/feed$/);
    if (!match || req.method !== "GET") return next();
    const token = decodeURIComponent(match[1]);
    const original = res.json.bind(res);
    res.json = ((body: any) => {
      try {
        if (body && typeof body === "object" && Array.isArray(body.racePeople) && body.raceDayCredits == null) {
          const sqlite = getSqlite();
          const link = sqlite.prepare(
            `SELECT org_id FROM tv_display_links WHERE token=? AND revoked_at IS NULL`,
          ).get(token) as { org_id?: number } | undefined;
          const orgId = Number(link?.org_id) || 1;
          const tz = BUSINESS_DAY_DEFAULT_TZ;
          const today = typeof body.today === "string" && body.today ? body.today : businessTodayInTz(tz);
          body.raceDayCredits = loadDayRaceHourCredits(sqlite as any, orgId, today, tz);
        }
      } catch {
        // Feed must still return; Play falls back to a still of today's grid.
      }
      return original(body);
    }) as Response["json"];
    next();
  });
}
