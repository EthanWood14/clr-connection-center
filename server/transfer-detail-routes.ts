import type { Express, Response, RequestHandler } from "express";

import {
  TRANSFER_DETAIL_SQL, TRANSFER_DETAIL_LOA_SQL, TRANSFER_DETAIL_LIST_SQL,
  TRANSFER_DETAIL_LIST_LIMIT, canReadTransfer, listAssistantFilter,
  presentTransfer, type DetailViewer,
} from "./transfer-detail-query";

/**
 * The two read routes behind the transfer write-up page.
 *
 * They live here rather than in routes.ts so the whole feature is one file a
 * person can read, and so routes.ts gains one line instead of two hundred.
 *
 * Both are reads. Neither takes a body.
 */

export interface TransferDetailDeps {
  requireAuth: RequestHandler;
  /** The raw better-sqlite3 handle. */
  db: () => any;
  /** The signed-in user, as the rest of the app resolves them. */
  userFor: (req: any) => DetailViewer | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date the query may be handed, or nothing. */
function safeDate(value: unknown, fallback: string): string {
  const s = String(value ?? "").trim();
  return DATE.test(s) ? s : fallback;
}

/** Today, in the same YYYY-MM-DD shape the date column stores. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerTransferDetailRoutes(app: Express, deps: TransferDetailDeps): void {
  const { requireAuth, db, userFor } = deps;

  /**
   * One window of transfers, with everything written on each already attached.
   *
   * The write-ups come back with the list rather than one fetch per opened
   * row: the page's whole purpose is to browse them, and a request per row
   * would make reading ten of them ten round trips.
   */
  app.get("/api/transfers/written", requireAuth, (req: any, res: Response) => {
    const viewer = userFor(req);
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });

    const to = safeDate(req.query.to, today());
    const from = safeDate(req.query.from, to);
    // A backwards window returns nothing rather than everything.
    if (from > to) return res.json({ transfers: [], truncated: false });

    try {
      const rows = db().prepare(TRANSFER_DETAIL_LIST_SQL).all({
        who: listAssistantFilter(viewer, req.query.assistantId),
        from,
        to,
        // One over the cap, so we can tell a full page from a truncated one.
        limit: TRANSFER_DETAIL_LIST_LIMIT + 1,
      }) as any[];

      const truncated = rows.length > TRANSFER_DETAIL_LIST_LIMIT;
      const page = truncated ? rows.slice(0, TRANSFER_DETAIL_LIST_LIMIT) : rows;
      res.json({
        transfers: page.map((r) => presentTransfer(r, Number(r.loaCount ?? 0) > 0)),
        truncated,
      });
    } catch (e: any) {
      console.error("[transfer-written] list failed:", e?.message ?? e);
      res.status(500).json({ error: "Could not load transfers" });
    }
  });

  /** One transfer, for a link straight to it. */
  app.get("/api/transfers/:id/written", requireAuth, (req: any, res: Response) => {
    const viewer = userFor(req);
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    try {
      const row = db().prepare(TRANSFER_DETAIL_SQL).get(id) as any;
      if (!row) return res.status(404).json({ error: "Not found" });
      // Same 404 for "does not exist" and "not yours", so the id space cannot
      // be walked to learn who transferred what.
      if (!canReadTransfer(viewer, row)) return res.status(404).json({ error: "Not found" });

      const loa = Number(row.loId ?? 0) > 0
        ? Number((db().prepare(TRANSFER_DETAIL_LOA_SQL).get(row.loId) as any)?.c ?? 0)
        : 0;
      res.json({ transfer: presentTransfer(row, loa > 0) });
    } catch (e: any) {
      console.error("[transfer-written] detail failed:", e?.message ?? e);
      res.status(500).json({ error: "Could not load transfer" });
    }
  });
}
