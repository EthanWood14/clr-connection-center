import type { Express, RequestHandler } from "express";

export function migratePortalTaskLocks(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS portal_task_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, task_id INTEGER NOT NULL, locked_by INTEGER NOT NULL,
    created_at TEXT NOT NULL, released_at TEXT, released_by INTEGER
  ); CREATE UNIQUE INDEX IF NOT EXISTS portal_task_lock_one_active
    ON portal_task_locks(org_id,user_id) WHERE released_at IS NULL;`);
}

const internal = (u: any) => u && (u.portal == null || u.portal === "c3");
const manager = (u: any) => internal(u) && u.is_active === 1 && !u.archived_at
  && (u.role === "admin" || !!u.is_manager || !!u.super_admin);
const activeSql = `SELECT l.id, l.user_id AS userId, l.task_id AS taskId,
  l.created_at AS createdAt, t.title, t.description, t.due_at AS dueAt,
  t.comp_amount_cents AS compAmountCents, u.name AS userName, m.name AS managerName
  FROM portal_task_locks l JOIN clr_tasks t ON t.id=l.task_id AND t.org_id=l.org_id
  JOIN users u ON u.id=l.user_id AND u.org_id=l.org_id
  JOIN users m ON m.id=l.locked_by AND m.org_id=l.org_id
  WHERE l.org_id=? AND l.released_at IS NULL AND t.status='active'
    AND t.assigned_user_id=l.user_id AND u.is_active=1 AND u.archived_at IS NULL
    AND (u.portal IS NULL OR u.portal='c3')`;

export function activePortalTaskLock(db: any, orgId: number, userId: number): any | null {
  return db.prepare(activeSql + " AND l.user_id=?").get(orgId, userId) ?? null;
}

/** Registered before API handlers, after fresh session/org resolution. */
export function portalTaskLockGuard(db: () => any): RequestHandler {
  return (req: any, res, next) => {
    const s = req.session_user;
    if (!s?.userId || !internal(s)) return next();
    const path = req.path.replace(/\/+$/, "") || "/";
    if (["/health", "/version", "/auth/me", "/auth/logout", "/auth/login", "/portal-task-locks/me"].includes(path)) return next();
    const lock = activePortalTaskLock(db(), Number(s.orgId), Number(s.userId));
    if (!lock) return next();
    // The employee can finish only the task holding this portal closed.
    if (req.method === "POST" && path === `/clr-tasks/${lock.taskId}/complete`) return next();
    res.status(423).json({ error: "Complete your assigned task to reopen C3.", code: "PORTAL_TASK_LOCKED", lock });
  };
}

export function registerPortalTaskLockRoutes(app: Express, deps: {
  db: () => any; requireAuth: RequestHandler;
  audit: (req: any, action: string, lock: any) => void;
}) {
  const who = (req: any) => deps.db().prepare("SELECT * FROM users WHERE id=? AND org_id=?")
    .get(Number(req.session_user?.userId), Number(req.session_user?.orgId));
  app.get("/api/portal-task-locks/me", deps.requireAuth, (req: any, res) => {
    const me = who(req);
    if (!internal(me) || me.is_active !== 1 || me.archived_at) return res.status(403).json({ error: "Active C3 account required." });
    res.set("Cache-Control", "no-store").json({ lock: activePortalTaskLock(deps.db(), me.org_id, me.id) });
  });
  app.get("/api/portal-task-locks", deps.requireAuth, (req: any, res) => {
    const me = who(req);
    if (!manager(me)) return res.status(403).json({ error: "Manager or admin only." });
    res.set("Cache-Control", "no-store").json({ locks: deps.db().prepare(activeSql).all(me.org_id) });
  });
  app.post("/api/portal-task-locks", deps.requireAuth, (req: any, res) => {
    const me = who(req), db = deps.db();
    if (!manager(me)) return res.status(403).json({ error: "Manager or admin only." });
    const id = req.body?.taskId;
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Choose an active task." });
    const task = db.prepare("SELECT * FROM clr_tasks WHERE id=? AND org_id=?").get(id, me.org_id);
    if (!task || task.status !== "active") return res.status(404).json({ error: "Active task not found." });
    const target = db.prepare("SELECT * FROM users WHERE id=? AND org_id=?").get(task.assigned_user_id, me.org_id);
    if (!internal(target) || target.is_active !== 1 || target.archived_at || target.id === me.id || manager(target)) {
      return res.status(400).json({ error: "Choose an active C3 employee who is not a manager or admin." });
    }
    const result = db.transaction(() => {
      const existing = activePortalTaskLock(db, me.org_id, target.id);
      if (existing) return { existing };
      // Completed, archived or reassigned tasks cannot strand their former owner.
      db.prepare("UPDATE portal_task_locks SET released_at=? WHERE org_id=? AND user_id=? AND released_at IS NULL")
        .run(new Date().toISOString(), me.org_id, target.id);
      db.prepare("INSERT INTO portal_task_locks(org_id,user_id,task_id,locked_by,created_at) VALUES(?,?,?,?,?)")
        .run(me.org_id, target.id, task.id, me.id, new Date().toISOString());
      return { lock: activePortalTaskLock(db, me.org_id, target.id) };
    }).immediate();
    if (result.existing) return res.status(409).json({ error: `This employee is already locked for “${result.existing.title}”.` });
    deps.audit(req, "portal_task_lock", result.lock);
    res.status(201).json(result);
  });
  app.delete("/api/portal-task-locks/:id", deps.requireAuth, (req: any, res) => {
    const me = who(req), db = deps.db();
    if (!manager(me)) return res.status(403).json({ error: "Manager or admin only." });
    const lock = db.prepare("SELECT * FROM portal_task_locks WHERE id=? AND org_id=? AND released_at IS NULL")
      .get(Number(req.params.id), me.org_id);
    if (!lock) return res.status(404).json({ error: "Lock not found." });
    db.prepare("UPDATE portal_task_locks SET released_at=?,released_by=? WHERE id=? AND org_id=?")
      .run(new Date().toISOString(), me.id, lock.id, me.org_id);
    deps.audit(req, "portal_task_unlock", lock);
    res.json({ ok: true });
  });
}
