import type { Express, RequestHandler } from "express";

export function migrateOtherWork(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS clr_other_work (
    id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS clr_other_work_dates ON clr_other_work(org_id,start_date,end_date);`);
}

export function otherWorkRows(db: any, orgId: number, from: string, to: string): any[] {
  // Older isolated readers and pre-migration databases do not have overrides.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='clr_other_work'").get()) return [];
  return db.prepare(`SELECT user_id, start_date, end_date FROM clr_other_work
    WHERE org_id=? AND start_date<=? AND end_date>=?`).all(orgId, to, from);
}

export function otherWorkDays(db: any, orgId: number, from: string, to: string): Array<{ userId: number; date: string }> {
  const days = new Map<string, { userId: number; date: string }>();
  for (const row of otherWorkRows(db, orgId, from, to)) {
    for (let day = row.start_date < from ? from : row.start_date; day <= to && day <= row.end_date;) {
      days.set(`${row.user_id}:${day}`, { userId: row.user_id, date: day });
      const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      day = next.toISOString().slice(0, 10);
    }
  }
  return Array.from(days.values());
}

export function registerOtherWorkRoutes(app: Express, deps: {
  db: () => any; requireAuth: RequestHandler; audit: (req: any, action: string, row: any) => void;
}) {
  const actor = (req: any) => deps.db().prepare("SELECT * FROM users WHERE id=? AND org_id=?").get(Number(req.session_user?.userId), Number(req.session_user?.orgId));
  const manager = (u: any) => u && u.is_active === 1 && !u.archived_at && (!u.portal || u.portal === "c3") && (u.role === "admin" || u.is_manager || u.super_admin);
  const validDate = (d: any) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T12:00:00Z")) && new Date(d + "T12:00:00Z").toISOString().slice(0,10) === d;
  app.get("/api/clr-other-work", deps.requireAuth, (req: any, res) => {
    const me = actor(req);
    if (!manager(me)) return res.status(403).json({ error: "Manager or admin only." });
    res.json(deps.db().prepare(`SELECT id,user_id AS userId,start_date AS startDate,end_date AS endDate,reason,
      'other_work' AS leaveKind,'approved' AS status,'work' AS dayPortion FROM clr_other_work WHERE org_id=? ORDER BY start_date DESC,id DESC`).all(me.org_id));
  });
  const save: RequestHandler = (req: any, res) => {
    const me = actor(req), db = deps.db();
    if (!manager(me)) return res.status(403).json({ error: "Manager or admin only." });
    const { startDate, endDate, userId } = req.body ?? {};
    if (!validDate(startDate) || !validDate(endDate) || endDate < startDate || Date.parse(endDate)-Date.parse(startDate) > 366*86400000 || !Number.isSafeInteger(userId)) {
      return res.status(400).json({ error: "Choose an employee and valid dates, no more than one year apart." });
    }
    const target = db.prepare("SELECT id FROM users WHERE id=? AND org_id=? AND is_active=1 AND archived_at IS NULL AND (portal IS NULL OR portal='c3')").get(userId, me.org_id);
    if (!target) return res.status(404).json({ error: "Active C3 employee not found." });
    const reason = String(req.body.reason ?? "").trim();
    if (reason.length > 3000) return res.status(400).json({ error: "Note must be 3,000 characters or fewer." });
    const now = new Date().toISOString();
    let id: number;
    if (req.params.id) {
      id = Number(req.params.id);
      const updated = db.prepare("UPDATE clr_other_work SET start_date=?,end_date=?,reason=?,updated_at=? WHERE id=? AND org_id=? AND user_id=?")
        .run(startDate,endDate,reason,now,id,me.org_id,userId);
      if (!updated.changes) return res.status(404).json({ error: "Other work entry not found." });
    } else {
      id = Number(db.prepare("INSERT INTO clr_other_work(org_id,user_id,start_date,end_date,reason,created_by,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(me.org_id,userId,startDate,endDate,reason,me.id,now).lastInsertRowid);
    }
    deps.audit(req, "other_work_saved", { id, userId, startDate, endDate });
    res.json({ id });
  };
  app.post("/api/clr-other-work", deps.requireAuth, save);
  app.patch("/api/clr-other-work/:id", deps.requireAuth, save);
  app.delete("/api/clr-other-work/:id", deps.requireAuth, (req: any, res) => {
    const me = actor(req);
    if (!manager(me)) return res.status(403).json({ error: "Manager or admin only." });
    const id = Number(req.params.id);
    const result = deps.db().prepare("DELETE FROM clr_other_work WHERE id=? AND org_id=?").run(id,me.org_id);
    if (!result.changes) return res.status(404).json({ error: "Entry not found." });
    deps.audit(req, "other_work_removed", { id });
    res.json({ ok: true });
  });
}
