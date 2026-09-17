/**
 * Atomic take/finish for escalating unclaimed LO new leads into Shotgun.
 * loNewLeadsDueForShotgun takes each row BEFORE the watcher publishes, so a
 * CLR Call/claim that lands after the due-list select still wins the race.
 */
import { getRawSqlite } from "./storage";

export function takeLoNewLeadForEscalation(id: number): boolean {
  const sqlite = getRawSqlite();
  const now = new Date().toISOString();
  const res = sqlite.prepare(`UPDATE lo_new_leads SET status='escalated', escalated_at=?, escalate_error=NULL, shotgun_lead_id=NULL
    WHERE id=? AND status='new'`).run(now, id);
  return res.changes > 0;
}

export function finishLoNewLeadEscalation(id: number, shotgunLeadId: number | null, error: string | null): void {
  const sqlite = getRawSqlite();
  if (error) {
    sqlite.prepare(`UPDATE lo_new_leads SET status='escalate_failed', shotgun_lead_id=NULL, escalate_error=? WHERE id=? AND status='escalated'`)
      .run(error.slice(0, 300), id);
    return;
  }
  sqlite.prepare(`UPDATE lo_new_leads SET shotgun_lead_id=?, escalate_error=NULL WHERE id=? AND status='escalated'`)
    .run(shotgunLeadId, id);
}

/** Safe after due-list take, or legacy create-then-mark: take if still new, then finish. */
export function markLoNewLeadEscalated(id: number, shotgunLeadId: number | null, error: string | null): void {
  takeLoNewLeadForEscalation(id);
  finishLoNewLeadEscalation(id, shotgunLeadId, error);
}

/** Unclaimed leads past the claim window — atomically taken for Shotgun. */
export function loNewLeadsDueForShotgun(orgId: number, cutoffIso: string): any[] {
  const sqlite = getRawSqlite();
  const candidates = sqlite.prepare(`SELECT * FROM lo_new_leads WHERE org_id=? AND status='new' AND first_seen_at<=? ORDER BY first_seen_at, id LIMIT 50`)
    .all(orgId, cutoffIso) as any[];
  const taken: any[] = [];
  for (const lead of candidates) {
    if (takeLoNewLeadForEscalation(Number(lead.id))) taken.push(lead);
    else console.log(`[lo-new-lead] ${lead.lo_name}: ${lead.external_id} skipped — claimed before Shotgun`);
  }
  return taken;
}
