/**
 * Server helper: fire timed Shotgun bouncebacks (shared/shotgun-bounceback.ts).
 * Called from the Shotgun rotation tick so due leads surface without a UI login.
 */
import {
  decideShotgunBouncebackFire,
  isShotgunBouncebackWeekActive,
  pacificCalendarDate,
  shotgunBouncebackHasTransferOrAppointment,
  shotgunBouncebackPhoneKey,
} from "@shared/shotgun-bounceback";

export {
  canAcceptShotgunBounceback,
  decideShotgunBouncebackFire,
  isShotgunBouncebackWeekActive,
  pacificCalendarDate,
  shotgunBouncebackHasTransferOrAppointment,
  shotgunBouncebackPhoneKey,
  SHOTGUN_BOUNCEBACK_AFTER_MS,
  SHOTGUN_BOUNCEBACK_END_DATE,
  SHOTGUN_BOUNCEBACK_START_DATE,
} from "@shared/shotgun-bounceback";

type NotifyFn = (input: {
  orgId: number;
  leadId: number;
  leadName: string;
  readyUserIds: number[];
}) => void;

export function shotgunLeadOutcomeHits(db: any, lead: any): Array<{ outcomeType: string }> {
  const hits: Array<{ outcomeType: string }> = [];
  const outcomeId = lead.transfer_outcome_id == null ? null : Number(lead.transfer_outcome_id);
  if (outcomeId) {
    const linked = db.prepare(`SELECT outcome_type FROM lead_outcomes WHERE id=? AND org_id=?`)
      .get(outcomeId, Number(lead.org_id)) as any;
    if (linked) hits.push({ outcomeType: String(linked.outcome_type ?? "") });
  }
  const phoneKey = String(lead.phone_key ?? "") || shotgunBouncebackPhoneKey(lead.phone);
  if (phoneKey && phoneKey.length >= 10) {
    const phoneRows = db.prepare(`
      SELECT outcome_type, phone_number FROM lead_outcomes
      WHERE org_id=? AND outcome_type IN ('transfer','appointment')
        AND created_at>=? AND phone_number IS NOT NULL AND phone_number<>''
      ORDER BY id DESC LIMIT 80`).all(Number(lead.org_id), String(lead.created_at)) as any[];
    for (const row of phoneRows) {
      if (shotgunBouncebackPhoneKey(row.phone_number) === phoneKey) {
        hits.push({ outcomeType: String(row.outcome_type ?? "") });
      }
    }
  }
  return hits;
}

export function leadHasTransferOrAppointment(db: any, lead: any): boolean {
  return shotgunBouncebackHasTransferOrAppointment(shotgunLeadOutcomeHits(db, lead));
}

/**
 * Fire due bouncebacks. Marks bounceback_fired_at once per lead. Requeues
 * done/offered leads that never converted so the rotation can offer again.
 */
export function fireShotgunBouncebacks(
  db: any,
  nowIso: string,
  readyTtlMs: number,
  onFired?: NotifyFn,
): { fired: number; skipped: number } {
  if (!isShotgunBouncebackWeekActive(pacificCalendarDate(new Date(nowIso)))) {
    return { fired: 0, skipped: 0 };
  }
  const cutoff = new Date(new Date(nowIso).getTime() - 35 * 60_000).toISOString();
  const candidates = db.prepare(`
    SELECT * FROM shotgun_leads
    WHERE bounceback_fired_at IS NULL AND created_at<=? AND status<>'cancelled'
    ORDER BY created_at,id LIMIT 50`).all(cutoff) as any[];
  let fired = 0;
  let skipped = 0;
  const notify: Array<{ orgId: number; leadId: number; leadName: string }> = [];

  for (const lead of candidates) {
    const hasOutcome = leadHasTransferOrAppointment(db, lead);
    const decision = decideShotgunBouncebackFire({
      nowMs: Date.parse(nowIso),
      createdAt: String(lead.created_at),
      firedAt: lead.bounceback_fired_at,
      status: String(lead.status),
      hasTransferOrAppointment: hasOutcome,
    });
    if (decision.action === "defer_claimed") continue;
    if (
      decision.action === "skip_not_due"
      || decision.action === "skip_inactive"
      || decision.action === "skip_already_fired"
    ) continue;
    if (decision.action === "skip_has_outcome" || decision.action === "skip_cancelled") {
      db.prepare(`UPDATE shotgun_leads SET bounceback_fired_at=?,updated_at=? WHERE id=? AND bounceback_fired_at IS NULL`)
        .run(nowIso, nowIso, lead.id);
      skipped += 1;
      continue;
    }
    if (decision.action !== "fire") continue;

    const applied = db.transaction(() => {
      const current = db.prepare(`SELECT * FROM shotgun_leads WHERE id=?`).get(lead.id) as any;
      if (!current || current.bounceback_fired_at) return false;
      const again = decideShotgunBouncebackFire({
        nowMs: Date.parse(nowIso),
        createdAt: String(current.created_at),
        firedAt: current.bounceback_fired_at,
        status: String(current.status),
        hasTransferOrAppointment: leadHasTransferOrAppointment(db, current),
      });
      if (again.action !== "fire") {
        if (again.action === "skip_has_outcome" || again.action === "skip_cancelled") {
          db.prepare(`UPDATE shotgun_leads SET bounceback_fired_at=?,updated_at=? WHERE id=? AND bounceback_fired_at IS NULL`)
            .run(nowIso, nowIso, lead.id);
        }
        return false;
      }
      const cooled = new Date(Date.parse(nowIso) - 6 * 60_000).toISOString();
      if (again.requeue) {
        if (String(current.status) === "offered" && current.current_assignee_id != null) {
          db.prepare(`UPDATE shotgun_offers SET response='bounceback',responded_at=?
            WHERE lead_id=? AND user_id=? AND response='pending'`)
            .run(nowIso, lead.id, current.current_assignee_id);
          db.prepare(`UPDATE shotgun_offer_events SET response='bounceback',responded_at=?
            WHERE lead_id=? AND user_id=? AND response='pending'`)
            .run(nowIso, lead.id, current.current_assignee_id);
        }
        db.prepare(`UPDATE shotgun_leads SET status='queued',current_assignee_id=NULL,offer_expires_at=NULL,
            claimed_at=NULL,presence_confirmed_at=NULL,called=0,texted=0,result_notes='',
            transfer_outcome_id=NULL,done_at=NULL,bounceback_fired_at=?,updated_at=?
          WHERE id=? AND bounceback_fired_at IS NULL`).run(nowIso, nowIso, lead.id);
        db.prepare(`UPDATE shotgun_offers SET offered_at=?,
            response=CASE WHEN response='pending' THEN 'bounceback' ELSE response END,
            responded_at=COALESCE(responded_at,?) WHERE lead_id=?`).run(cooled, nowIso, lead.id);
      } else {
        db.prepare(`UPDATE shotgun_leads SET bounceback_fired_at=?,updated_at=? WHERE id=? AND bounceback_fired_at IS NULL`)
          .run(nowIso, nowIso, lead.id);
        db.prepare(`UPDATE shotgun_offers SET offered_at=? WHERE lead_id=?`).run(cooled, lead.id);
      }
      return true;
    })();
    if (!applied) continue;
    fired += 1;
    notify.push({
      orgId: Number(lead.org_id),
      leadId: Number(lead.id),
      leadName: String(lead.lead_name ?? ""),
    });
  }

  if (onFired) {
    const readyCutoff = new Date(new Date(nowIso).getTime() - readyTtlMs).toISOString();
    for (const n of notify) {
      const ready = db.prepare(`SELECT u.id FROM shotgun_readiness r INNER JOIN users u ON u.id=r.user_id
        WHERE r.org_id=? AND r.is_ready=1 AND r.heartbeat_at>=? AND u.is_active=1
          AND (u.is_clr=1 OR u.role='assistant') AND (u.portal IS NULL OR u.portal='c3')
          AND COALESCE(u.shotgun_opted_out,0)=0`).all(n.orgId, readyCutoff) as any[];
      onFired({
        orgId: n.orgId,
        leadId: n.leadId,
        leadName: n.leadName,
        readyUserIds: ready.map((u: any) => Number(u.id)),
      });
    }
  }
  return { fired, skipped };
}
