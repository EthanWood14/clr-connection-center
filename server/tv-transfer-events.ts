import type Database from "better-sqlite3";

/** Metadata edits are not new transfers, even after a TV forgets an old ID. */
export const TV_OUTCOME_EVENT_STAMP_SQL = `CASE WHEN o.outcome_type = 'transfer'
  THEN COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', o.tv_transfer_event_at), strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at))
  ELSE COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', o.updated_at), strftime('%Y-%m-%dT%H:%M:%fZ', o.created_at)) END`;

/**
 * Keep this beside the row so every writer, including direct call-sync SQL,
 * distinguishes a real conversion from editing an existing transfer. No
 * historical rows are backfilled: their original creation time is the read
 * fallback, and TV startup still advances its cursor without replaying them.
 */
export function ensureTvTransferEvents(db: Database.Database): void {
  db.transaction(() => {
    const columns = db.prepare("PRAGMA table_info(lead_outcomes)").all() as { name: string }[];
    if (!columns.some(column => column.name === "tv_transfer_event_at")) {
      db.exec("ALTER TABLE lead_outcomes ADD COLUMN tv_transfer_event_at TEXT");
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tv_transfer_event_insert
      AFTER INSERT ON lead_outcomes
      WHEN NEW.outcome_type = 'transfer'
      BEGIN
        UPDATE lead_outcomes
          SET tv_transfer_event_at = COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          WHERE id = NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS tv_transfer_event_conversion
      AFTER UPDATE OF outcome_type ON lead_outcomes
      WHEN NEW.outcome_type = 'transfer' AND OLD.outcome_type IS NOT 'transfer'
      BEGIN
        UPDATE lead_outcomes
          SET tv_transfer_event_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = NEW.id;
      END;
    `);
  })();
}
