import { raw, type Express, type RequestHandler, type Response } from "express";
import { normalizeTvCarAppearance, validateTvCarAppearance, TV_CAR_WRAP_MAX_BYTES, type TvCarAppearance } from "../shared/tv-car";
import { removeTvCarWrap, saveTvCarWrap, selfTvCarWrapUrl, sendTvCarWrap, TvCarWrapError, validateTvCarWrapImage } from "./tv-car-wrap";
import { isTvCarParticipant } from "../shared/tv-race-participation";

type CarSession = { userId?: unknown; orgId?: unknown; portal?: unknown };
type CarOwner = { id: number; org_id: number; name: string; role: string; is_clr: number; is_active: number; portal: string | null };

export interface TvCarRouteDeps {
  requireAuth: RequestHandler;
  db: () => any;
  sessionFor: (req: any) => CarSession | null;
  displayOrgFor?: (token: string) => number | null;
  audit: (entry: { owner: CarOwner; before: TvCarAppearance; after: TvCarAppearance }) => void;
}

const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const internalPortal = (value: unknown) => value == null || value === "c3";

/** Participation never overrides the current owner, org or active C3 boundary. */
export function canCustomizeTvCar(session: CarSession | null, owner: CarOwner | null | undefined): boolean {
  if (!session || !owner || !positiveId(session.userId) || !positiveId(session.orgId)) return false;
  return Number(session.userId) === Number(owner.id)
    && Number(session.orgId) === Number(owner.org_id)
    && Number(owner.is_active) === 1
    && internalPortal(session.portal) && internalPortal(owner.portal)
    && isTvCarParticipant(owner);
}

function readAppearance(db: any, owner: CarOwner): TvCarAppearance {
  const row = db.prepare(`SELECT body_color AS bodyColor, accent_color AS accentColor, livery
    FROM tv_car_preferences WHERE org_id = ? AND user_id = ?`).get(owner.org_id, owner.id);
  const wrap = db.prepare("SELECT version FROM tv_car_wraps WHERE org_id=? AND user_id=?").get(owner.org_id, owner.id);
  return normalizeTvCarAppearance({ ...row, ...(wrap ? { wrapUrl: selfTvCarWrapUrl(wrap.version) } : {}) }, owner.id);
}

export function registerTvCarRoutes(app: Express, deps: TvCarRouteDeps): void {
  function ownerFor(req: any, res: Response): CarOwner | null {
    const session = deps.sessionFor(req);
    if (!session || !positiveId(session.userId) || !positiveId(session.orgId)) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    // Resolve current role, activity and portal from the DB, not stale cookies.
    const owner = deps.db().prepare(`SELECT id, org_id, name, role, is_clr, is_active, portal
      FROM users WHERE id = ? AND org_id = ?`).get(Number(session.userId), Number(session.orgId)) as CarOwner | undefined;
    if (!canCustomizeTvCar(session, owner)) {
      res.status(403).json({ error: "Your active C3 race-participant account is required to customize a TV car." });
      return null;
    }
    return owner!;
  }

  app.get("/api/me/tv-car", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner) return;
      return res.json({ appearance: readAppearance(deps.db(), owner) });
    } catch (error: any) {
      console.error("[tv-car] read failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not load your TV car." });
    }
  });

  app.patch("/api/me/tv-car", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner) return;
      const appearance = validateTvCarAppearance(req.body);
      if (!appearance) return res.status(400).json({ error: "Choose a body color, accent color, and valid paint style." });
      const db = deps.db();
      const before = readAppearance(db, owner);
      db.prepare(`INSERT INTO tv_car_preferences (org_id, user_id, body_color, accent_color, livery, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(org_id, user_id) DO UPDATE SET body_color=excluded.body_color,
          accent_color=excluded.accent_color, livery=excluded.livery, updated_at=excluded.updated_at`)
        .run(owner.org_id, owner.id, appearance.bodyColor, appearance.accentColor, appearance.livery, new Date().toISOString());
      const saved = readAppearance(db, owner);
      deps.audit({ owner, before, after: saved });
      return res.json({ appearance: saved });
    } catch (error: any) {
      console.error("[tv-car] save failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not save your TV car." });
    }
  });

  const parseRaw = raw({ type: () => true, limit: TV_CAR_WRAP_MAX_BYTES });
  const authorizedUpload: RequestHandler = (req, res, next) => {
    try { if (ownerFor(req, res)) next(); }
    catch { res.status(500).json({ error: "Could not authorize the car-wrap upload." }); }
  };
  const parseUpload: RequestHandler = (req, res, next) => parseRaw(req, res, (error: any) => {
    if (error) return res.status(error.status === 413 ? 413 : 400).json({ error: "Choose a prepared PNG wrap no larger than 1 MB." });
    next();
  });

  app.post("/api/me/tv-car/wrap", deps.requireAuth, authorizedUpload, parseUpload, (req: any, res: Response) => {
    try {
      // Recheck after reading bytes in case access changed during an upload.
      const owner = ownerFor(req, res);
      if (!owner) return;
      const image = validateTvCarWrapImage(req.body, req.headers["content-type"]);
      const db = deps.db();
      const before = readAppearance(db, owner);
      saveTvCarWrap(db, owner.org_id, owner.id, image);
      const appearance = readAppearance(db, owner);
      deps.audit({ owner, before, after: appearance });
      return res.status(201).json({ appearance });
    } catch (error: any) {
      if (error instanceof TvCarWrapError) return res.status(error.status).json({ error: error.message });
      console.error("[tv-car] wrap upload failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not save your car wrap." });
    }
  });

  app.delete("/api/me/tv-car/wrap", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner) return;
      const db = deps.db();
      const before = readAppearance(db, owner);
      removeTvCarWrap(db, owner.org_id, owner.id);
      const appearance = readAppearance(db, owner);
      deps.audit({ owner, before, after: appearance });
      return res.json({ appearance });
    } catch (error: any) {
      console.error("[tv-car] wrap removal failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not remove your car wrap." });
    }
  });

  app.get("/api/me/tv-car/wrap", deps.requireAuth, (req: any, res: Response) => {
    const owner = ownerFor(req, res);
    if (owner) sendTvCarWrap(deps.db(), res, owner.org_id, owner.id, req.query.v);
  });

  app.get("/api/tv/:token/cars/:userId/wrap", (req: any, res: Response) => {
    const orgId = deps.displayOrgFor?.(String(req.params.token ?? ""));
    if (!orgId) return res.status(404).json({ error: "This display link is no longer active." });
    sendTvCarWrap(deps.db(), res, orgId, Number(req.params.userId), req.query.v);
  });
}
