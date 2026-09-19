import { raw, type Express, type RequestHandler, type Response } from "express";
import { normalizeTvCarAppearance, validateTvCarAppearance, TV_CAR_WRAP_MAX_BYTES, type TvCarAppearance } from "../shared/tv-car";
import { removeTvCarWrap, saveTvCarWrap, selfTvCarWrapUrl, sendTvCarWrap, TvCarWrapError, validateTvCarWrapImage } from "./tv-car-wrap";
import { isTvCarParticipant } from "../shared/tv-race-participation";
import { validateTvCarSkin, type TvCarSkin } from "../shared/tv-car-skin";
import { formatTvCarRemaining, TV_CAR_DAILY_SECONDS, tvCarBudget, tvCarBudgetDay, tvCarTickSeconds, type TvCarBudget } from "../shared/tv-car-budget";
import { formatShopPrice, formatShopBalance, shopCurrencyLabel, garageDailyBonusSeconds } from "../shared/tv-car-shop";
import {
  buildShopSnapshot, purchaseShopItem, readOwnedShopItems, shopUpgradesForOwner,
} from "./tv-car-shop";

type CarSession = { userId?: unknown; orgId?: unknown; portal?: unknown };
type CarOwner = { id: number; org_id: number; name: string; role: string; is_clr: number; is_active: number; portal: string | null };

export interface TvCarRouteDeps {
  requireAuth: RequestHandler;
  db: () => any;
  sessionFor: (req: any) => CarSession | null;
  displayOrgFor?: (token: string) => number | null;
  audit: (entry: { owner: CarOwner; before: TvCarAppearance; after: TvCarAppearance }) => void;
  /** Lifetime transfer credit for the shop currency. Injected so tests need no credit SQL. */
  transferCreditFor?: (owner: CarOwner) => number;
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

export function parseStoredTvCarSkin(value: unknown): TvCarSkin | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try { return validateTvCarSkin(JSON.parse(value)); }
  catch { return null; }
}

/** The public TV feed only receives valid cosmetics from its own organization. */
export function readTvCarSkinsForOrg(db: any, orgId: number): Map<number, TvCarSkin> {
  const skins = new Map<number, TvCarSkin>();
  // A retained cosmetic record does not retain public-display eligibility after
  // its owner leaves C3, is archived, or moves to another organization.
  const rows = db.prepare(`SELECT s.user_id, s.skin_json, u.id, u.role, u.is_clr, u.portal
    FROM tv_car_skins s JOIN users u ON u.id=s.user_id AND u.org_id=s.org_id
    WHERE s.org_id=? AND u.is_active=1 AND u.archived_at IS NULL
      AND (u.portal IS NULL OR u.portal='c3')`).all(orgId) as any[];
  for (const row of rows) {
    if (!isTvCarParticipant(row)) continue;
    const skin = parseStoredTvCarSkin(row.skin_json);
    if (skin) skins.set(Number(row.user_id), skin);
  }
  return skins;
}

function readAppearance(db: any, owner: CarOwner): TvCarAppearance {
  const row = db.prepare(`SELECT body_color AS bodyColor, accent_color AS accentColor, livery
    FROM tv_car_preferences WHERE org_id = ? AND user_id = ?`).get(owner.org_id, owner.id);
  const wrap = db.prepare("SELECT version FROM tv_car_wraps WHERE org_id=? AND user_id=?").get(owner.org_id, owner.id);
  const skinRow = db.prepare("SELECT skin_json FROM tv_car_skins WHERE org_id=? AND user_id=?").get(owner.org_id, owner.id);
  const skin = parseStoredTvCarSkin(skinRow?.skin_json);
  const upgrades = shopUpgradesForOwner(db, owner);
  return normalizeTvCarAppearance({ ...row,
    ...(wrap ? { wrapUrl: selfTvCarWrapUrl(wrap.version) } : {}),
    ...(skin ? { skin } : {}),
    ...(upgrades.length ? { upgrades } : {}),
  }, owner.id);
}

function dailyGarageSeconds(db: any, owner: CarOwner): number {
  return TV_CAR_DAILY_SECONDS + garageDailyBonusSeconds(readOwnedShopItems(db, owner));
}

/**
 * How much garage time this person has left today.
 *
 * Read-only: opening the page, or looking at the car, never costs anything.
 */
export function readTvCarBudget(db: any, owner: CarOwner, now = Date.now()): TvCarBudget {
  const day = tvCarBudgetDay(now);
  const row = db.prepare("SELECT seconds FROM tv_car_garage_time WHERE org_id=? AND user_id=? AND day=?")
    .get(owner.org_id, owner.id, day);
  return tvCarBudget(row?.seconds ?? 0, day, dailyGarageSeconds(db, owner));
}

/**
 * Charge one tick of open-tab time.
 *
 * The tick is worth the gap since this person's LAST tick as the server
 * recorded it, capped (shared/tv-car-budget.ts), so the page cannot spend more
 * than has actually passed however often or rarely it reports in.
 */
export function spendTvCarTime(db: any, owner: CarOwner, now = Date.now()): TvCarBudget {
  const day = tvCarBudgetDay(now);
  const stamp = new Date(now).toISOString();
  const allowance = dailyGarageSeconds(db, owner);
  const row = db.prepare("SELECT seconds, last_tick_at FROM tv_car_garage_time WHERE org_id=? AND user_id=? AND day=?")
    .get(owner.org_id, owner.id, day);
  if (!row) {
    db.prepare("INSERT INTO tv_car_garage_time (org_id,user_id,day,seconds,last_tick_at) VALUES (?,?,?,?,?)")
      .run(owner.org_id, owner.id, day, 1, stamp);
    return tvCarBudget(1, day, allowance);
  }
  const since = now - Date.parse(String(row.last_tick_at));
  const seconds = Math.min(allowance, Number(row.seconds ?? 0) + tvCarTickSeconds(since));
  db.prepare("UPDATE tv_car_garage_time SET seconds=?, last_tick_at=? WHERE org_id=? AND user_id=? AND day=?")
    .run(seconds, stamp, owner.org_id, owner.id, day);
  return tvCarBudget(seconds, day, allowance);
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

  /**
   * Out of time: the garage is read-only until tomorrow. 423 rather than 403
   * because nothing is wrong with who they are — the day's quarter of an hour
   * is simply spent.
   */
  function unlocked(owner: CarOwner, res: Response): boolean {
    const budget = readTvCarBudget(deps.db(), owner);
    if (!budget.locked) return true;
    res.status(423).json({
      error: "You have used your 15 minutes in the garage today. Your car is locked until tomorrow.",
      budget,
    });
    return false;
  }

  app.get("/api/me/tv-car", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner) return;
      const db = deps.db();
      return res.json({ appearance: readAppearance(db, owner), budget: readTvCarBudget(db, owner) });
    } catch (error: any) {
      console.error("[tv-car] read failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not load your TV car." });
    }
  });

  /** The open tab reporting in. Costs time; changes nothing. */
  app.post("/api/me/tv-car/time", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner) return;
      const budget = spendTvCarTime(deps.db(), owner);
      return res.json({ budget, message: formatTvCarRemaining(budget.remaining) });
    } catch (error: any) {
      console.error("[tv-car] time tick failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not record your garage time." });
    }
  });

  app.patch("/api/me/tv-car", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner || !unlocked(owner, res)) return;
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
      return res.json({ appearance: saved, budget: readTvCarBudget(db, owner) });
    } catch (error: any) {
      console.error("[tv-car] save failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not save your TV car." });
    }
  });

  app.put("/api/me/tv-car/skin", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner || !unlocked(owner, res)) return;
      const body = req.body;
      const skin = body && typeof body === "object" && !Array.isArray(body)
        && Object.keys(body).length === 1 && Object.prototype.hasOwnProperty.call(body, "skin")
        ? validateTvCarSkin(body.skin) : null;
      if (!skin) return res.status(400).json({ error: "Choose a valid six-panel car skin with a 16-color palette." });
      const db = deps.db();
      const before = readAppearance(db, owner);
      db.prepare(`INSERT INTO tv_car_skins (org_id,user_id,skin_json,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(org_id,user_id) DO UPDATE SET skin_json=excluded.skin_json,updated_at=excluded.updated_at`)
        .run(owner.org_id, owner.id, JSON.stringify(skin), new Date().toISOString());
      const appearance = readAppearance(db, owner);
      deps.audit({ owner, before, after: appearance });
      return res.json({ appearance, budget: readTvCarBudget(db, owner) });
    } catch (error: any) {
      console.error("[tv-car] skin save failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not save your car skin." });
    }
  });

  app.delete("/api/me/tv-car/skin", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner || !unlocked(owner, res)) return;
      const db = deps.db();
      const before = readAppearance(db, owner);
      db.prepare("DELETE FROM tv_car_skins WHERE org_id=? AND user_id=?").run(owner.org_id, owner.id);
      const appearance = readAppearance(db, owner);
      deps.audit({ owner, before, after: appearance });
      return res.json({ appearance, budget: readTvCarBudget(db, owner) });
    } catch (error: any) {
      console.error("[tv-car] skin removal failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not remove your car skin." });
    }
  });

  const parseRaw = raw({ type: () => true, limit: TV_CAR_WRAP_MAX_BYTES });
  const authorizedUpload: RequestHandler = (req, res, next) => {
    // Checked before the megabyte is read, and again in the handler after it.
    try { const owner = ownerFor(req, res); if (owner && unlocked(owner, res)) next(); }
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
      if (!owner || !unlocked(owner, res)) return;
      const image = validateTvCarWrapImage(req.body, req.headers["content-type"]);
      const db = deps.db();
      const before = readAppearance(db, owner);
      saveTvCarWrap(db, owner.org_id, owner.id, image);
      const appearance = readAppearance(db, owner);
      deps.audit({ owner, before, after: appearance });
      return res.status(201).json({ appearance, budget: readTvCarBudget(db, owner) });
    } catch (error: any) {
      if (error instanceof TvCarWrapError) return res.status(error.status).json({ error: error.message });
      console.error("[tv-car] wrap upload failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not save your car wrap." });
    }
  });

  app.delete("/api/me/tv-car/wrap", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner || !unlocked(owner, res)) return;
      const db = deps.db();
      const before = readAppearance(db, owner);
      removeTvCarWrap(db, owner.org_id, owner.id);
      const appearance = readAppearance(db, owner);
      deps.audit({ owner, before, after: appearance });
      return res.json({ appearance, budget: readTvCarBudget(db, owner) });
    } catch (error: any) {
      console.error("[tv-car] wrap removal failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not remove your car wrap." });
    }
  });

  function transferCredit(owner: CarOwner): number {
    try { return Math.max(0, Number(deps.transferCreditFor?.(owner) ?? 0) || 0); }
    catch { return 0; }
  }

  function shopFor(owner: CarOwner) {
    return buildShopSnapshot(deps.db(), owner, transferCredit(owner), formatShopPrice);
  }

  /** Balances + catalog for the garage shop. Read-only; does not spend garage time. */
  app.get("/api/me/tv-car/shop", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner) return;
      const shop = shopFor(owner);
      return res.json({
        ...shop,
        balanceLabels: {
          transfers: formatShopBalance("transfers", shop.balances.transfers),
          dialpad_calls: formatShopBalance("dialpad_calls", shop.balances.dialpad_calls),
          calltools_seconds: formatShopBalance("calltools_seconds", shop.balances.calltools_seconds),
        },
        currencyLabels: {
          transfers: shopCurrencyLabel("transfers"),
          dialpad_calls: shopCurrencyLabel("dialpad_calls"),
          calltools_seconds: shopCurrencyLabel("calltools_seconds"),
        },
      });
    } catch (error: any) {
      console.error("[tv-car] shop read failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not load the garage shop." });
    }
  });

  /**
   * Buy one catalog item with earned stats. Idempotent: owning it already
   * returns 200 without charging again. Buying never spends garage edit time.
   */
  app.post("/api/me/tv-car/shop/buy", deps.requireAuth, (req: any, res: Response) => {
    try {
      const owner = ownerFor(req, res);
      if (!owner) return;
      const itemId = req.body?.itemId ?? req.body?.id;
      const { evaluation, snapshot, inserted } = purchaseShopItem(
        deps.db(), owner, itemId, transferCredit(owner), formatShopPrice,
      );
      if (evaluation.status === "unknown_item") {
        return res.status(400).json({ error: "That upgrade is not in the shop.", shop: snapshot });
      }
      if (evaluation.status === "insufficient") {
        return res.status(402).json({
          error: `You need ${formatShopPrice(evaluation.item)} — you have ${formatShopBalance(evaluation.item.currency, evaluation.balance)}.`,
          shop: snapshot,
        });
      }
      // already_owned and fresh purchase both 200: clients can retry safely.
      return res.json({
        ok: true,
        inserted,
        alreadyOwned: evaluation.status === "already_owned",
        item: evaluation.item,
        message: evaluation.status === "already_owned"
          ? `You already own ${evaluation.item.name}.`
          : `Purchased ${evaluation.item.name}.`,
        shop: {
          ...snapshot,
          balanceLabels: {
            transfers: formatShopBalance("transfers", snapshot.balances.transfers),
            dialpad_calls: formatShopBalance("dialpad_calls", snapshot.balances.dialpad_calls),
            calltools_seconds: formatShopBalance("calltools_seconds", snapshot.balances.calltools_seconds),
          },
        },
        appearance: readAppearance(deps.db(), owner),
        budget: readTvCarBudget(deps.db(), owner),
      });
    } catch (error: any) {
      console.error("[tv-car] shop buy failed:", error?.message ?? error);
      return res.status(500).json({ error: "Could not complete that purchase." });
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
