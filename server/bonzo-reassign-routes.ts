import type { Express, Response, RequestHandler } from "express";

import {
  planReassign, isUsablePhone, normalizeEmail, normalizePhone,
  type ReassignCandidate, type ReassignVerdict,
} from "./bonzo-reassign";

/**
 * The two steps of moving one prospect in Bonzo, knowing only a phone number,
 * who holds it now, and who should hold it.
 *
 * TWO steps on purpose. This moves a real person's client out of their CRM,
 * and the phone alone cannot say which record is meant — several prospects
 * routinely share one. So the first call only LOOKS, and hands back exactly
 * which record would move and who currently holds it; the second call moves
 * that specific prospect by id, and refuses if anything has changed
 * underneath it since.
 *
 * One at a time, per Ethan. A bulk version of this would turn a mistyped
 * column into forty misplaced borrowers.
 */

export interface BonzoReassignDeps {
  requireAuth: RequestHandler;
  /** Manager-or-admin gate; writes to the response and returns false on refusal. */
  requireManagerOrAdmin: (req: any, res: Response) => boolean;
  bonzoConfigured: () => boolean;
  findProspectByPhone: (phone: string) => Promise<{ candidates: ReassignCandidate[] }>;
  reassignProspectByEmail: (
    prospectId: number, userEmail: string,
  ) => Promise<{ ok: boolean; verified: boolean; nowEmail: string | null; error?: string }>;
  getProspectAssigneeEmail: (prospectId: number) => Promise<string | null>;
  /** Records who moved what, so a disputed move has an answer. */
  audit: (req: any, entry: { action: string; details: Record<string, unknown> }) => void;
}

/** The candidate list, reduced to what the decision and the screen both need. */
function summarize(candidates: ReassignCandidate[]) {
  return candidates.map((c) => ({
    id: Number(c.id),
    name: String(c.name ?? ""),
    assignedUserName: c.assignedUserName ?? null,
    assignedUserEmail: c.assignedUserEmail ?? null,
  }));
}

export function registerBonzoReassignRoutes(app: Express, deps: BonzoReassignDeps): void {
  const {
    requireAuth, requireManagerOrAdmin, bonzoConfigured,
    findProspectByPhone, reassignProspectByEmail, getProspectAssigneeEmail, audit,
  } = deps;

  /**
   * Step one: look, decide, and explain. Changes nothing.
   */
  app.post("/api/bonzo/reassign/check", requireAuth, async (req: any, res: Response) => {
    if (!requireManagerOrAdmin(req, res)) return;
    if (!bonzoConfigured()) {
      return res.status(503).json({ error: "Bonzo is not connected. Add the API token on the Integrations page." });
    }

    const phone = String(req.body?.phone ?? "");
    const fromEmail = String(req.body?.fromEmail ?? "");
    const toEmail = String(req.body?.toEmail ?? "");

    // Checked before the lookup so an obviously wrong number does not cost a
    // round trip to Bonzo, and so the message is about the number rather than
    // about an empty result.
    if (!isUsablePhone(phone)) {
      return res.json({
        verdict: { action: "refuse", prospectId: null, prospectName: null, reason: "That is not a ten-digit phone number." },
        candidates: [],
      });
    }

    let candidates: ReassignCandidate[] = [];
    try {
      const found = await findProspectByPhone(normalizePhone(phone));
      candidates = Array.isArray(found?.candidates) ? found.candidates : [];
    } catch (e: any) {
      console.error("[bonzo-reassign] lookup failed:", e?.message ?? e);
      return res.status(502).json({ error: "Bonzo did not answer. Try again in a moment." });
    }

    const verdict = planReassign({ phone, fromEmail, toEmail }, candidates);
    res.json({ verdict, candidates: summarize(candidates) });
  });

  /**
   * Step two: move the one prospect the check named.
   *
   * The id comes from the check rather than from the phone again, and the
   * holder is re-read immediately before the move: between the two clicks
   * somebody may have moved the record, and moving it anyway would undo their
   * work without either person knowing.
   */
  app.post("/api/bonzo/reassign", requireAuth, async (req: any, res: Response) => {
    if (!requireManagerOrAdmin(req, res)) return;
    if (!bonzoConfigured()) {
      return res.status(503).json({ error: "Bonzo is not connected." });
    }

    const prospectId = Number(req.body?.prospectId);
    const fromEmail = normalizeEmail(req.body?.fromEmail);
    const toEmail = normalizeEmail(req.body?.toEmail);

    if (!Number.isInteger(prospectId) || prospectId <= 0) {
      return res.status(400).json({ error: "Run the check first — this needs the prospect the check found." });
    }
    if (!fromEmail || !toEmail) return res.status(400).json({ error: "Both addresses are required." });
    if (fromEmail === toEmail) return res.status(400).json({ error: "It is already assigned to that person." });

    let holder: string | null = null;
    try {
      holder = await getProspectAssigneeEmail(prospectId);
    } catch (e: any) {
      console.error("[bonzo-reassign] re-read failed:", e?.message ?? e);
      return res.status(502).json({ error: "Bonzo did not answer. Nothing was moved." });
    }

    if (holder === toEmail) {
      return res.json({ moved: false, alreadyThere: true, message: "It is already assigned to that person. Nothing to do." });
    }
    if (holder !== fromEmail) {
      // Somebody moved it between the check and the confirm, or the check was
      // left open. Either way the record is no longer the one that was agreed.
      return res.status(409).json({
        error: `This prospect is now held by ${holder ?? "nobody"}, not ${fromEmail}. Run the check again.`,
      });
    }

    let result: Awaited<ReturnType<typeof reassignProspectByEmail>>;
    try {
      result = await reassignProspectByEmail(prospectId, toEmail);
    } catch (e: any) {
      console.error("[bonzo-reassign] move failed:", e?.message ?? e);
      return res.status(502).json({ error: "Bonzo did not answer. The prospect may not have moved — check it in Bonzo." });
    }

    audit(req, {
      action: "bonzo_prospect_reassigned",
      details: { prospectId, fromEmail, toEmail, ok: result.ok, verified: result.verified, nowEmail: result.nowEmail },
    });

    if (!result.ok) {
      return res.status(502).json({ error: `Bonzo refused the move: ${result.error ?? "no reason given"}` });
    }
    // A 2xx from Bonzo is not proof. Say plainly which of the two happened.
    res.json({
      moved: true,
      verified: result.verified,
      nowEmail: result.nowEmail,
      message: result.verified
        ? `Moved to ${toEmail}.`
        : `Bonzo accepted the move but still shows ${result.nowEmail ?? "nobody"}. Check it in Bonzo before moving on.`,
    });
  });
}
