/** Freeze explicit routing instructions; history is recovered only from recorded priority changes. */
export function migrateTransferPrioritySnapshots(db: any): void {
  const cols = new Set(db.prepare("PRAGMA table_info(lead_outcomes)").all().map((r: any) => r.name));
  if (!cols.has("priority_at_transfer")) db.exec("ALTER TABLE lead_outcomes ADD COLUMN priority_at_transfer INTEGER");
  if (!cols.has("priority_snapshot_source")) db.exec("ALTER TABLE lead_outcomes ADD COLUMN priority_snapshot_source TEXT");
  db.transaction(() => {
    const pending = db.prepare(`SELECT o.id,o.org_id,o.lo_id,o.created_at,COALESCE(lo.needs_transfers,0) AS current_priority
      FROM lead_outcomes o LEFT JOIN loan_officers lo ON lo.id=o.lo_id AND lo.org_id=o.org_id
      WHERE o.outcome_type='transfer' AND o.priority_at_transfer IS NULL`).all();
    if (pending.length) {
      const los = db.prepare("SELECT id,org_id,full_name FROM loan_officers").all();
      const events = new Map<string, Array<{ at: number; on: boolean; changed: boolean }>>();
      const stamp = (raw: string) => Date.parse(/[Zz]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw.replace(" ","T")+"Z");
      const add = (org: number, id: number, at: number, on: boolean, changed: boolean) => {
        if (!Number.isFinite(at)) return;
        const key=`${org}:${id}`, list=events.get(key)??[];list.push({at,on,changed});events.set(key,list);
      };
      for (const log of db.prepare(`SELECT org_id,entity_id,entity_label,details,created_at FROM audit_logs
        WHERE entity_type='loan_officer' ORDER BY created_at,id`).all()) {
        const at=stamp(String(log.created_at));
        try { const d=JSON.parse(log.details??"null");if(typeof d?.needsTransfers==='boolean') add(log.org_id,log.entity_id,at,d.needsTransfers,false); } catch {}
        const prefix="Pinned loan officers changed by link: ";
        if(String(log.entity_label??"").startsWith(prefix)) for(const entry of log.entity_label.slice(prefix.length).split(", ")) {
          const m=entry.match(/^(.*): (pinned|unpinned)$/);if(!m)continue;
          const matches=los.filter((lo:any)=>lo.org_id===log.org_id&&lo.full_name===m[1]);
          if(matches.length===1)add(log.org_id,matches[0].id,at,m[2]==="pinned",true);
        }
      }
      for(const list of events.values()) list.sort((a,b)=>a.at-b.at);
      const save=db.prepare("UPDATE lead_outcomes SET priority_at_transfer=?,priority_snapshot_source=? WHERE id=? AND priority_at_transfer IS NULL");
      for(const row of pending) {
        const at=stamp(String(row.created_at)),list=events.get(`${row.org_id}:${row.lo_id}`)??[];
        const prior=list.filter(e=>e.at<=at).at(-1);
        const initial=!prior&&Number.isFinite(at)&&list[0]?.changed&&at<list[0].at?list[0]:null;
        save.run(prior?+prior.on:initial?+!initial.on:+!!row.current_priority,prior||initial?"audit_history":"legacy_baseline",row.id);
      }
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS transfer_priority_on_insert AFTER INSERT ON lead_outcomes
      WHEN NEW.outcome_type='transfer' BEGIN
        UPDATE lead_outcomes SET priority_at_transfer=COALESCE((SELECT needs_transfers FROM loan_officers WHERE id=NEW.lo_id AND org_id=NEW.org_id),0),priority_snapshot_source='recorded'
        WHERE id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS transfer_priority_on_destination AFTER UPDATE OF lo_id,org_id,outcome_type ON lead_outcomes
      WHEN NEW.outcome_type='transfer' AND (OLD.lo_id IS NOT NEW.lo_id OR OLD.org_id IS NOT NEW.org_id OR OLD.outcome_type IS NOT NEW.outcome_type) BEGIN
        UPDATE lead_outcomes SET priority_at_transfer=COALESCE((SELECT needs_transfers FROM loan_officers WHERE id=NEW.lo_id AND org_id=NEW.org_id),0),priority_snapshot_source='recorded'
        WHERE id=NEW.id;
      END;`);
  })();
}
