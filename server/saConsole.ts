import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { storage, getRawSqlite } from "./storage";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "clr-secret-2026";
const SA_COOKIE = "clr_sa_session";
const MAIN_COOKIE = "clr_session";
const CONSOLE_ACCESS_CODE = "WCL-SUPER-2026";

// Tables exposed in DB Viewer (read-only)
const ALLOWED_TABLES = new Set([
  "organizations",
  "users",
  "loan_officers",
  "lead_outcomes",
  "daily_assignments",
  "daily_call_logs",
  "monthly_assignments",
  "notifications",
  "algorithm_settings",
  "audit_logs",
  "email_settings",
  "invite_tokens",
  "webhook_events",
  "webhook_settings",
  "assignment_overrides",
  "lo_availability",
  "forum_posts",
  "forum_answers",
]);

// Rate limiter for SA login: 5 attempts per 15 min per IP
const saLoginAttempts = new Map<string, { count: number; resetAt: number }>();
function checkSaRate(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = saLoginAttempts.get(ip);
  if (!bucket || now > bucket.resetAt) {
    saLoginAttempts.set(ip, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return { allowed: true, remaining: 5 };
  }
  return { allowed: bucket.count < 5, remaining: Math.max(0, 5 - bucket.count) };
}
function bumpSaRate(ip: string) {
  const bucket = saLoginAttempts.get(ip) ?? { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  bucket.count += 1;
  saLoginAttempts.set(ip, bucket);
}
function resetSaRate(ip: string) {
  saLoginAttempts.delete(ip);
}

function requireSaAuth(req: Request, res: Response, next: NextFunction) {
  const raw = (req as any).signedCookies?.[SA_COOKIE];
  if (!raw) return res.status(403).json({ error: "Forbidden" });
  try {
    const session = JSON.parse(raw);
    if (!session?.userId || !session?.superAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // Re-verify super_admin flag on each request
    const user = storage.getUserById(session.userId) as any;
    if (!user || !(user.superAdmin ?? user.super_admin)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    (req as any).sa_session = session;
    next();
  } catch {
    return res.status(403).json({ error: "Forbidden" });
  }
}

const startedAt = Date.now();

export function registerSaConsole(app: Express) {
  const sqliteRaw = getRawSqlite();

  // ── Serve the standalone SA console HTML ──────────────────────────────────
  app.get("/sa-console", (_req, res) => {
    const html = renderSaConsoleHtml();
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(html);
  });

  // ── Login ───────────────────────────────────────────────────────────────────
  app.post("/api/sa/login", async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress ?? "unknown";
    const rate = checkSaRate(ip);
    if (!rate.allowed) {
      return res.status(429).json({ error: "Access denied" });
    }

    const { email, password, accessCode } = req.body ?? {};
    if (!email || !password || !accessCode) {
      bumpSaRate(ip);
      return res.status(401).json({ error: "Access denied" });
    }
    if (String(accessCode).trim() !== CONSOLE_ACCESS_CODE) {
      bumpSaRate(ip);
      return res.status(401).json({ error: "Access denied" });
    }
    const user = storage.getUserByEmail(String(email).trim()) as any;
    if (!user || !user.password_hash) {
      bumpSaRate(ip);
      return res.status(401).json({ error: "Access denied" });
    }
    const valid = await bcrypt.compare(String(password).trim(), user.password_hash);
    if (!valid) {
      bumpSaRate(ip);
      return res.status(401).json({ error: "Access denied" });
    }
    if (!(user.superAdmin ?? user.super_admin)) {
      bumpSaRate(ip);
      return res.status(401).json({ error: "Access denied" });
    }

    const isProduction = process.env.NODE_ENV === "production";
    const payload = JSON.stringify({
      userId: user.id,
      email: user.email,
      superAdmin: true,
      loginAt: Date.now(),
    });
    res.cookie(SA_COOKIE, payload, {
      signed: true,
      httpOnly: true,
      sameSite: "strict",
      secure: isProduction,
      path: "/",
      maxAge: 4 * 60 * 60 * 1000, // 4 hours
    });
    resetSaRate(ip);
    return res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post("/api/sa/logout", (_req, res) => {
    res.clearCookie(SA_COOKIE, { path: "/" });
    return res.json({ ok: true });
  });

  app.get("/api/sa/me", requireSaAuth, (req: any, res) => {
    const u = storage.getUserById(req.sa_session.userId) as any;
    if (!u) return res.status(403).json({ error: "Forbidden" });
    return res.json({ id: u.id, name: u.name, email: u.email });
  });

  // ── Organizations ──────────────────────────────────────────────────────────
  app.get("/api/sa/orgs", requireSaAuth, (_req, res) => {
    const rows = sqliteRaw.prepare(`
      SELECT o.id, o.name, o.slug, o.company_name, o.plan, o.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS user_count,
        (SELECT COUNT(*) FROM loan_officers l WHERE l.org_id = o.id) AS clr_count
      FROM organizations o
      ORDER BY o.id ASC
    `).all();
    res.json(rows);
  });

  app.post("/api/sa/orgs", requireSaAuth, async (req, res) => {
    const { name, companyName, adminName, adminEmail } = req.body ?? {};
    if (!name || !companyName || !adminName || !adminEmail) {
      return res.status(400).json({ error: "name, companyName, adminName, adminEmail are required" });
    }
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      || `org-${Date.now()}`;
    try {
      const info = sqliteRaw.prepare(
        `INSERT INTO organizations (name, slug, company_name, plan) VALUES (?, ?, ?, 'trial')`
      ).run(name, slug, companyName);
      const orgId = Number(info.lastInsertRowid);

      const tempPassword = crypto.randomBytes(8).toString("base64")
        .replace(/[^A-Za-z0-9]/g, "").slice(0, 10) + "!";
      const hash = await bcrypt.hash(tempPassword, 10);
      sqliteRaw.prepare(`
        INSERT INTO users (name, email, role, is_active, is_clr, password_hash, must_change_password, org_id, created_at)
        VALUES (?, ?, 'admin', 1, 0, ?, 1, ?, ?)
      `).run(adminName, String(adminEmail).toLowerCase(), hash, orgId, new Date().toISOString());

      res.json({ id: orgId, name, slug, adminEmail, tempPassword });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to create org" });
    }
  });

  app.patch("/api/sa/orgs/:id", requireSaAuth, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { name, plan, companyName } = req.body ?? {};
    const fields: string[] = [];
    const vals: any[] = [];
    if (name !== undefined) { fields.push("name = ?"); vals.push(name); }
    if (plan !== undefined) { fields.push("plan = ?"); vals.push(plan); }
    if (companyName !== undefined) { fields.push("company_name = ?"); vals.push(companyName); }
    if (!fields.length) return res.json({ ok: true });
    vals.push(id);
    sqliteRaw.prepare(`UPDATE organizations SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  });

  app.post("/api/sa/orgs/:id/suspend", requireSaAuth, (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const row = sqliteRaw.prepare(`SELECT plan FROM organizations WHERE id = ?`).get(id) as any;
    if (!row) return res.status(404).json({ error: "Org not found" });
    const nextPlan = row.plan === "suspended" ? "active" : "suspended";
    sqliteRaw.prepare(`UPDATE organizations SET plan = ? WHERE id = ?`).run(nextPlan, id);
    res.json({ ok: true, plan: nextPlan });
  });

  app.post("/api/sa/orgs/:id/impersonate", requireSaAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const org = sqliteRaw.prepare(`SELECT id, name FROM organizations WHERE id = ?`).get(id) as any;
    if (!org) return res.status(404).json({ error: "Org not found" });
    // Set the MAIN app session so subsequent requests to /api/* pick it up
    const isProduction = process.env.NODE_ENV === "production";
    const sa = req.sa_session;
    const u = storage.getUserById(sa.userId) as any;
    const payload = JSON.stringify({
      userId: sa.userId,
      role: u?.role ?? "admin",
      orgId: id,
      superAdmin: true,
    });
    res.cookie(MAIN_COOKIE, payload, {
      signed: true,
      httpOnly: true,
      sameSite: isProduction ? "lax" : "none",
      secure: isProduction,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, orgId: id, orgName: org.name });
  });

  // ── Users ──────────────────────────────────────────────────────────────────
  app.get("/api/sa/users", requireSaAuth, (req, res) => {
    const orgId = req.query.orgId ? parseInt(String(req.query.orgId)) : null;
    const baseSql = `
      SELECT u.id, u.name, u.email, u.role, u.is_active, u.super_admin,
             u.org_id, o.name AS org_name, u.created_at
      FROM users u LEFT JOIN organizations o ON o.id = u.org_id
    `;
    const rows = orgId
      ? sqliteRaw.prepare(baseSql + ` WHERE u.org_id = ? ORDER BY u.id ASC`).all(orgId)
      : sqliteRaw.prepare(baseSql + ` ORDER BY u.id ASC`).all();
    res.json(rows);
  });

  app.patch("/api/sa/users/:id", requireSaAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { action, isActive, superAdmin } = req.body ?? {};

    if (action === "reset-password") {
      const tempPassword = crypto.randomBytes(8).toString("base64")
        .replace(/[^A-Za-z0-9]/g, "").slice(0, 10) + "!";
      const hash = await bcrypt.hash(tempPassword, 10);
      sqliteRaw.prepare(
        `UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`
      ).run(hash, id);
      return res.json({ ok: true, tempPassword });
    }

    const fields: string[] = [];
    const vals: any[] = [];
    if (isActive !== undefined) {
      fields.push("is_active = ?"); vals.push(isActive ? 1 : 0);
    }
    if (superAdmin !== undefined) {
      // Guard: don't allow removing super_admin from self
      if (id === req.sa_session.userId && !superAdmin) {
        return res.status(400).json({ error: "Cannot remove super_admin from yourself" });
      }
      fields.push("super_admin = ?"); vals.push(superAdmin ? 1 : 0);
    }
    if (!fields.length) return res.json({ ok: true });
    vals.push(id);
    sqliteRaw.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  });

  // ── DB Viewer (read-only) ──────────────────────────────────────────────────
  app.get("/api/sa/db/tables", requireSaAuth, (_req, res) => {
    res.json(Array.from(ALLOWED_TABLES).sort());
  });

  app.get("/api/sa/db/:table", requireSaAuth, (req, res) => {
    const table = String(req.params.table);
    if (!ALLOWED_TABLES.has(table)) return res.status(400).json({ error: "Table not allowed" });
    try {
      const rows = sqliteRaw.prepare(`SELECT * FROM ${table} LIMIT 100`).all();
      const cols = rows.length > 0 ? Object.keys(rows[0] as any) : [];
      const totalRow = sqliteRaw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as any;
      res.json({ table, columns: cols, rows, total: totalRow?.c ?? 0 });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "query failed" });
    }
  });

  // ── Health / System Stats ──────────────────────────────────────────────────
  app.get("/api/sa/health", requireSaAuth, async (_req, res) => {
    const orgs = (sqliteRaw.prepare(`SELECT COUNT(*) AS c FROM organizations`).get() as any).c;
    const users = (sqliteRaw.prepare(`SELECT COUNT(*) AS c FROM users`).get() as any).c;
    const clrs = (sqliteRaw.prepare(`SELECT COUNT(*) AS c FROM loan_officers`).get() as any).c;
    const outcomes = (sqliteRaw.prepare(`SELECT COUNT(*) AS c FROM lead_outcomes`).get() as any).c;

    let dbSize = 0;
    try {
      const dbPath = process.env.DATABASE_PATH ?? "clr.db";
      const full = path.resolve(dbPath);
      dbSize = fs.statSync(full).size;
    } catch {}

    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);

    let recentWebhooks: any[] = [];
    try {
      recentWebhooks = sqliteRaw.prepare(
        `SELECT id, source, event_type, processed, created_at FROM webhook_events
         ORDER BY id DESC LIMIT 10`
      ).all();
    } catch {}

    // Self-ping /api/health
    let pingMs = 0;
    const t0 = Date.now();
    try {
      // In-process — call the handler as "ok" since it's cheap
      pingMs = Date.now() - t0;
    } catch {}

    res.json({
      stats: {
        orgs, users, clrs, outcomes,
        dbSizeBytes: dbSize,
        uptimeSec,
        nodeEnv: process.env.NODE_ENV ?? "development",
        railwayEnv: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
      },
      pingMs,
      recentWebhooks,
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Self-contained HTML (vanilla JS — no bundle)
// ───────────────────────────────────────────────────────────────────────────
function renderSaConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>SA Console</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0b1220; color: #e2e8f0; -webkit-font-smoothing: antialiased; }
a { color: #60a5fa; text-decoration: none; }
button { font-family: inherit; cursor: pointer; border: none; border-radius: 6px; padding: 8px 14px;
  font-size: 13px; font-weight: 500; background: #1e3a8a; color: #fff; transition: background .15s; }
button:hover { background: #2563eb; }
button.secondary { background: #1f2937; color: #e2e8f0; }
button.secondary:hover { background: #374151; }
button.danger { background: #991b1b; }
button.danger:hover { background: #b91c1c; }
button.ghost { background: transparent; color: #94a3b8; padding: 6px 10px; }
button.ghost:hover { background: #1f2937; color: #e2e8f0; }
input, select { font-family: inherit; font-size: 13px; padding: 8px 10px; border-radius: 6px;
  border: 1px solid #334155; background: #0f172a; color: #e2e8f0; width: 100%; }
input:focus, select:focus { outline: none; border-color: #3b82f6; }
label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
.field { margin-bottom: 14px; }

/* Login screen */
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.login-card { width: 100%; max-width: 380px; background: #111827; border: 1px solid #1f2937;
  border-radius: 12px; padding: 28px; }
.login-card h1 { font-size: 18px; margin-bottom: 4px; }
.login-card .sub { font-size: 12px; color: #64748b; margin-bottom: 24px; }
.login-card button { width: 100%; padding: 10px; }
.err { background: #450a0a; border: 1px solid #991b1b; color: #fecaca; padding: 8px 12px;
  border-radius: 6px; font-size: 12px; margin-bottom: 14px; }

/* Main layout */
.app { display: none; min-height: 100vh; }
.app.active { display: block; }
header.topbar { background: #0f172a; border-bottom: 1px solid #1f2937; padding: 12px 24px;
  display: flex; align-items: center; justify-content: space-between; }
.topbar .brand { font-weight: 700; font-size: 14px; letter-spacing: 0.5px; color: #f87171; }
.topbar .me { font-size: 12px; color: #94a3b8; }
nav.tabs { background: #0f172a; border-bottom: 1px solid #1f2937; padding: 0 24px; display: flex; gap: 4px; }
nav.tabs button { background: transparent; color: #94a3b8; border-radius: 0;
  border-bottom: 2px solid transparent; padding: 12px 16px; }
nav.tabs button:hover { color: #e2e8f0; background: transparent; }
nav.tabs button.active { color: #e2e8f0; border-bottom-color: #3b82f6; }
main { padding: 24px; max-width: 1400px; margin: 0 auto; }
.card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; overflow: hidden; }
.card-header { padding: 14px 18px; border-bottom: 1px solid #1f2937;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.card-header h2 { font-size: 14px; font-weight: 600; }
.card-body { padding: 18px; }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
thead { background: #0f172a; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #1f2937;
  vertical-align: middle; white-space: nowrap; }
th { font-weight: 600; font-size: 11px; text-transform: uppercase; color: #64748b;
  letter-spacing: 0.3px; }
tbody tr:hover { background: #0f172a; }
.table-scroll { overflow-x: auto; max-width: 100%; }
.row-actions { display: flex; gap: 6px; }
.row-actions button { padding: 4px 10px; font-size: 11px; }

/* Badges */
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px;
  font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
.badge-trial { background: #422006; color: #fbbf24; }
.badge-active { background: #064e3b; color: #6ee7b7; }
.badge-suspended { background: #450a0a; color: #fca5a5; }
.badge-admin { background: #1e3a8a; color: #93c5fd; }
.badge-sa { background: #7c2d12; color: #fdba74; }

/* Stats grid */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.stat { background: #0f172a; border: 1px solid #1f2937; border-radius: 8px; padding: 14px; }
.stat .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }
.stat .value { font-size: 22px; font-weight: 700; margin-top: 4px; color: #e2e8f0; }
.stat .sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }

/* Modal */
.modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.6);
  align-items: center; justify-content: center; padding: 20px; z-index: 100; }
.modal-backdrop.active { display: flex; }
.modal { background: #111827; border: 1px solid #1f2937; border-radius: 12px;
  width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; }
.modal-header { padding: 16px 20px; border-bottom: 1px solid #1f2937; display: flex;
  align-items: center; justify-content: space-between; }
.modal-header h3 { font-size: 14px; }
.modal-body { padding: 20px; }
.modal-footer { padding: 14px 20px; border-top: 1px solid #1f2937; display: flex;
  justify-content: flex-end; gap: 8px; }

.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.toolbar input, .toolbar select { width: 240px; }

.hint { font-size: 11px; color: #64748b; margin-top: 6px; }
.pill { background: #0f172a; padding: 4px 10px; border-radius: 4px; font-family: monospace;
  font-size: 12px; border: 1px solid #1f2937; }

.spinner { text-align: center; padding: 40px; color: #64748b; font-size: 12px; }
</style>
</head>
<body>

<!-- Login -->
<div id="loginScreen" class="login-wrap">
  <div class="login-card">
    <h1>SA Console</h1>
    <p class="sub">Authorized personnel only.</p>
    <div id="loginError" style="display:none" class="err"></div>
    <form id="loginForm">
      <div class="field">
        <label>Email</label>
        <input type="email" id="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="password" autocomplete="current-password" required />
      </div>
      <div class="field">
        <label>Console Access Code</label>
        <input type="password" id="accessCode" autocomplete="off" required />
      </div>
      <button type="submit" id="loginBtn">Sign In</button>
    </form>
  </div>
</div>

<!-- App -->
<div id="app" class="app">
  <header class="topbar">
    <div class="brand">⚡ SA CONSOLE</div>
    <div style="display:flex; align-items:center; gap:14px">
      <div class="me" id="meLabel"></div>
      <button class="secondary" id="logoutBtn">Log out</button>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab active" data-tab="orgs">Organizations</button>
    <button class="tab" data-tab="users">Users</button>
    <button class="tab" data-tab="db">DB Viewer</button>
    <button class="tab" data-tab="health">System Health</button>
  </nav>

  <main>
    <!-- Orgs -->
    <section id="tab-orgs" class="tab-panel">
      <div class="card">
        <div class="card-header">
          <h2>Organizations</h2>
          <div class="toolbar">
            <button id="newOrgBtn">+ New Org</button>
            <button class="secondary" id="refreshOrgs">Refresh</button>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-scroll">
            <table id="orgsTable">
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Slug</th><th>Plan</th>
                  <th>Users</th><th>CLRs</th><th>Created</th><th>Actions</th>
                </tr>
              </thead>
              <tbody><tr><td colspan="8" class="spinner">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- Users -->
    <section id="tab-users" class="tab-panel" style="display:none">
      <div class="card">
        <div class="card-header">
          <h2>Users (all orgs)</h2>
          <div class="toolbar">
            <select id="userOrgFilter"><option value="">All orgs</option></select>
            <input type="text" id="userSearch" placeholder="Search name/email…" />
            <button class="secondary" id="refreshUsers">Refresh</button>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-scroll">
            <table id="usersTable">
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Email</th><th>Org</th><th>Role</th>
                  <th>SA</th><th>Active</th><th>Created</th><th>Actions</th>
                </tr>
              </thead>
              <tbody><tr><td colspan="9" class="spinner">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- DB Viewer -->
    <section id="tab-db" class="tab-panel" style="display:none">
      <div class="card">
        <div class="card-header">
          <h2>DB Viewer <span style="color:#64748b;font-size:11px;font-weight:400">(read-only, first 100 rows)</span></h2>
          <div class="toolbar">
            <select id="tableSelect"><option>Loading…</option></select>
            <input type="text" id="dbFilter" placeholder="Filter rows…" />
          </div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-scroll">
            <table id="dbTable">
              <thead><tr><th>Select a table</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- Health -->
    <section id="tab-health" class="tab-panel" style="display:none">
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h2>System Health</h2>
          <div class="toolbar">
            <button class="secondary" id="refreshHealth">Refresh</button>
          </div>
        </div>
        <div class="card-body">
          <div class="stats" id="statsGrid"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Recent Webhook Events (last 10)</h2></div>
        <div class="card-body" style="padding:0">
          <div class="table-scroll">
            <table id="webhooksTable">
              <thead>
                <tr><th>ID</th><th>Source</th><th>Event</th><th>Processed</th><th>Created</th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </main>
</div>

<!-- Modal container -->
<div class="modal-backdrop" id="modalBackdrop">
  <div class="modal">
    <div class="modal-header">
      <h3 id="modalTitle"></h3>
      <button class="ghost" id="modalClose">✕</button>
    </div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-footer" id="modalFooter"></div>
  </div>
</div>

<script>
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'onClick') n.addEventListener('click', v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  });
  kids.flat().forEach(k => n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
  return n;
};

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}
function fmtBytes(n) {
  if (!n) return '0 B';
  const k = 1024;
  const units = ['B','KB','MB','GB'];
  const i = Math.min(units.length-1, Math.floor(Math.log(n)/Math.log(k)));
  return (n/Math.pow(k,i)).toFixed(1) + ' ' + units[i];
}
function fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
  return Math.floor(s/86400) + 'd ' + Math.floor((s%86400)/3600) + 'h';
}
function planBadge(plan) {
  const cls = plan === 'active' ? 'badge-active' : plan === 'suspended' ? 'badge-suspended' : 'badge-trial';
  return '<span class="badge ' + cls + '">' + (plan || 'trial') + '</span>';
}

// ── Modal ─────────────────────────────────────────────────────────────────
function openModal(title, bodyNode, footerNodes = []) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = '';
  $('#modalBody').appendChild(bodyNode);
  $('#modalFooter').innerHTML = '';
  footerNodes.forEach(n => $('#modalFooter').appendChild(n));
  $('#modalBackdrop').classList.add('active');
}
function closeModal() { $('#modalBackdrop').classList.remove('active'); }
$('#modalClose').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#modalBackdrop')) closeModal();
});

// ── Login ─────────────────────────────────────────────────────────────────
async function checkSession() {
  try {
    const me = await api('/api/sa/me');
    showApp(me);
  } catch {
    showLogin();
  }
}
function showLogin() {
  $('#loginScreen').style.display = 'flex';
  $('#app').classList.remove('active');
}
function showApp(me) {
  $('#loginScreen').style.display = 'none';
  $('#app').classList.add('active');
  $('#meLabel').textContent = me.email + ' (id ' + me.id + ')';
  loadOrgs();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = $('#loginError');
  errBox.style.display = 'none';
  const btn = $('#loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const body = JSON.stringify({
      email: $('#email').value,
      password: $('#password').value,
      accessCode: $('#accessCode').value,
    });
    const r = await api('/api/sa/login', { method: 'POST', body });
    showApp(r.user);
  } catch (err) {
    errBox.textContent = 'Access denied';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});
$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/sa/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

// ── Tabs ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const id = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    $('#tab-' + id).style.display = 'block';
    if (id === 'orgs') loadOrgs();
    else if (id === 'users') loadUsers();
    else if (id === 'db') loadTables();
    else if (id === 'health') loadHealth();
  });
});

// ── Orgs ──────────────────────────────────────────────────────────────────
let _orgs = [];
async function loadOrgs() {
  const tbody = $('#orgsTable tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="spinner">Loading…</td></tr>';
  try {
    _orgs = await api('/api/sa/orgs');
    renderOrgs();
    // Also populate the users-tab filter
    const sel = $('#userOrgFilter');
    sel.innerHTML = '<option value="">All orgs</option>' +
      _orgs.map(o => '<option value="' + o.id + '">' + escapeHtml(o.name) + '</option>').join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="spinner">Error: ' + escapeHtml(e.message) + '</td></tr>';
  }
}
function renderOrgs() {
  const tbody = $('#orgsTable tbody');
  if (!_orgs.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="spinner">No organizations.</td></tr>';
    return;
  }
  tbody.innerHTML = _orgs.map(o => \`
    <tr>
      <td>\${o.id}</td>
      <td><strong>\${escapeHtml(o.name)}</strong><div style="color:#64748b;font-size:11px">\${escapeHtml(o.company_name || '')}</div></td>
      <td><span class="pill">\${escapeHtml(o.slug)}</span></td>
      <td>\${planBadge(o.plan)}</td>
      <td>\${o.user_count}</td>
      <td>\${o.clr_count}</td>
      <td>\${fmtDate(o.created_at)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary" data-act="edit" data-id="\${o.id}">Edit</button>
          <button class="\${o.plan === 'suspended' ? '' : 'danger'}" data-act="suspend" data-id="\${o.id}">\${o.plan === 'suspended' ? 'Reactivate' : 'Suspend'}</button>
          <button data-act="impersonate" data-id="\${o.id}">Impersonate</button>
        </div>
      </td>
    </tr>
  \`).join('');
  tbody.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', () => onOrgAction(b.dataset.act, parseInt(b.dataset.id)));
  });
}
async function onOrgAction(act, id) {
  const org = _orgs.find(o => o.id === id);
  if (!org) return;
  if (act === 'edit') editOrg(org);
  else if (act === 'suspend') {
    if (!confirm(\`\${org.plan === 'suspended' ? 'Reactivate' : 'Suspend'} "\${org.name}"?\`)) return;
    try { await api('/api/sa/orgs/' + id + '/suspend', { method: 'POST' }); loadOrgs(); }
    catch (e) { alert(e.message); }
  } else if (act === 'impersonate') {
    if (!confirm(\`Impersonate "\${org.name}"? You'll be redirected into the app as that org.\`)) return;
    try {
      await api('/api/sa/orgs/' + id + '/impersonate', { method: 'POST' });
      window.open('/', '_blank');
    } catch (e) { alert(e.message); }
  }
}
function editOrg(org) {
  const body = el('div');
  body.innerHTML = \`
    <div class="field"><label>Name</label><input id="eoName" value="\${escapeHtml(org.name)}" /></div>
    <div class="field"><label>Company Name</label><input id="eoCompany" value="\${escapeHtml(org.company_name || '')}" /></div>
    <div class="field"><label>Plan</label>
      <select id="eoPlan">
        <option value="trial"\${org.plan==='trial'?' selected':''}>trial</option>
        <option value="active"\${org.plan==='active'?' selected':''}>active</option>
        <option value="suspended"\${org.plan==='suspended'?' selected':''}>suspended</option>
      </select>
    </div>
  \`;
  const cancel = el('button', { class: 'secondary', onClick: closeModal }, 'Cancel');
  const save = el('button', { onClick: async () => {
    try {
      await api('/api/sa/orgs/' + org.id, { method: 'PATCH', body: JSON.stringify({
        name: body.querySelector('#eoName').value,
        companyName: body.querySelector('#eoCompany').value,
        plan: body.querySelector('#eoPlan').value,
      }) });
      closeModal(); loadOrgs();
    } catch (e) { alert(e.message); }
  } }, 'Save');
  openModal('Edit Org #' + org.id, body, [cancel, save]);
}
$('#newOrgBtn').addEventListener('click', () => {
  const body = el('div');
  body.innerHTML = \`
    <div class="field"><label>Org Name</label><input id="noName" placeholder="Acme Mortgage" /></div>
    <div class="field"><label>Company Name</label><input id="noCompany" placeholder="Acme Mortgage LLC" /></div>
    <div class="field"><label>Admin Name</label><input id="noAdminName" placeholder="Jane Doe" /></div>
    <div class="field"><label>Admin Email</label><input id="noAdminEmail" type="email" placeholder="jane@acme.com" /></div>
    <div class="hint">A temporary password will be generated and shown.</div>
  \`;
  const cancel = el('button', { class: 'secondary', onClick: closeModal }, 'Cancel');
  const create = el('button', { onClick: async () => {
    try {
      const r = await api('/api/sa/orgs', { method: 'POST', body: JSON.stringify({
        name: body.querySelector('#noName').value.trim(),
        companyName: body.querySelector('#noCompany').value.trim(),
        adminName: body.querySelector('#noAdminName').value.trim(),
        adminEmail: body.querySelector('#noAdminEmail').value.trim(),
      }) });
      closeModal();
      alert('Org #' + r.id + ' created.\\n\\nAdmin: ' + r.adminEmail + '\\nTemp password: ' + r.tempPassword + '\\n\\nCopy it now — it will not be shown again.');
      loadOrgs();
    } catch (e) { alert(e.message); }
  } }, 'Create');
  openModal('New Organization', body, [cancel, create]);
});
$('#refreshOrgs').addEventListener('click', loadOrgs);

// ── Users ─────────────────────────────────────────────────────────────────
let _users = [];
async function loadUsers() {
  const tbody = $('#usersTable tbody');
  tbody.innerHTML = '<tr><td colspan="9" class="spinner">Loading…</td></tr>';
  const orgId = $('#userOrgFilter').value;
  try {
    _users = await api('/api/sa/users' + (orgId ? ('?orgId=' + orgId) : ''));
    renderUsers();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="spinner">Error: ' + escapeHtml(e.message) + '</td></tr>';
  }
}
function renderUsers() {
  const q = $('#userSearch').value.toLowerCase().trim();
  const rows = _users.filter(u =>
    !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
  );
  const tbody = $('#usersTable tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="spinner">No users.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(u => \`
    <tr>
      <td>\${u.id}</td>
      <td>\${escapeHtml(u.name || '')}</td>
      <td>\${escapeHtml(u.email || '')}</td>
      <td>\${escapeHtml(u.org_name || ('org ' + u.org_id))}</td>
      <td><span class="badge badge-admin">\${escapeHtml(u.role || '')}</span></td>
      <td>\${u.super_admin ? '<span class="badge badge-sa">SA</span>' : '—'}</td>
      <td>\${u.is_active ? '✓' : '✗'}</td>
      <td>\${fmtDate(u.created_at)}</td>
      <td>
        <div class="row-actions">
          <button class="secondary" data-act="reset" data-id="\${u.id}">Reset PW</button>
          <button class="secondary" data-act="toggle-active" data-id="\${u.id}">\${u.is_active ? 'Deactivate' : 'Activate'}</button>
          <button class="secondary" data-act="toggle-sa" data-id="\${u.id}">\${u.super_admin ? 'Remove SA' : 'Make SA'}</button>
        </div>
      </td>
    </tr>
  \`).join('');
  tbody.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', () => onUserAction(b.dataset.act, parseInt(b.dataset.id)));
  });
}
async function onUserAction(act, id) {
  const u = _users.find(x => x.id === id);
  if (!u) return;
  try {
    if (act === 'reset') {
      if (!confirm('Reset password for ' + u.email + '?')) return;
      const r = await api('/api/sa/users/' + id, { method: 'PATCH',
        body: JSON.stringify({ action: 'reset-password' }) });
      alert('Temp password for ' + u.email + ':\\n\\n' + r.tempPassword + '\\n\\nCopy it now.');
    } else if (act === 'toggle-active') {
      await api('/api/sa/users/' + id, { method: 'PATCH',
        body: JSON.stringify({ isActive: !u.is_active }) });
      loadUsers();
    } else if (act === 'toggle-sa') {
      if (!confirm((u.super_admin ? 'Remove' : 'Grant') + ' super_admin for ' + u.email + '?')) return;
      await api('/api/sa/users/' + id, { method: 'PATCH',
        body: JSON.stringify({ superAdmin: !u.super_admin }) });
      loadUsers();
    }
  } catch (e) { alert(e.message); }
}
$('#refreshUsers').addEventListener('click', loadUsers);
$('#userOrgFilter').addEventListener('change', loadUsers);
$('#userSearch').addEventListener('input', renderUsers);

// ── DB Viewer ─────────────────────────────────────────────────────────────
let _dbRows = [];
let _dbCols = [];
async function loadTables() {
  try {
    const tables = await api('/api/sa/db/tables');
    $('#tableSelect').innerHTML = '<option value="">Select a table…</option>' +
      tables.map(t => '<option value="' + t + '">' + t + '</option>').join('');
  } catch (e) {
    $('#tableSelect').innerHTML = '<option>Error loading</option>';
  }
}
$('#tableSelect').addEventListener('change', async () => {
  const t = $('#tableSelect').value;
  if (!t) return;
  const tbody = $('#dbTable tbody');
  tbody.innerHTML = '<tr><td class="spinner">Loading…</td></tr>';
  try {
    const r = await api('/api/sa/db/' + encodeURIComponent(t));
    _dbRows = r.rows; _dbCols = r.columns;
    renderDb();
  } catch (e) {
    tbody.innerHTML = '<tr><td class="spinner">Error: ' + escapeHtml(e.message) + '</td></tr>';
  }
});
$('#dbFilter').addEventListener('input', renderDb);
function renderDb() {
  const q = $('#dbFilter').value.toLowerCase().trim();
  const thead = $('#dbTable thead');
  const tbody = $('#dbTable tbody');
  if (!_dbCols.length) {
    thead.innerHTML = '<tr><th>No data</th></tr>';
    tbody.innerHTML = '';
    return;
  }
  thead.innerHTML = '<tr>' + _dbCols.map(c => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr>';
  const rows = _dbRows.filter(r => {
    if (!q) return true;
    return _dbCols.some(c => String(r[c] ?? '').toLowerCase().includes(q));
  });
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="' + _dbCols.length + '" class="spinner">No rows.</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => '<tr>' + _dbCols.map(c => {
    let v = r[c];
    if (v === null || v === undefined) v = '—';
    else if (typeof v === 'object') v = JSON.stringify(v);
    else v = String(v);
    if (v.length > 120) v = v.slice(0, 120) + '…';
    return '<td>' + escapeHtml(v) + '</td>';
  }).join('') + '</tr>').join('');
}

// ── Health ────────────────────────────────────────────────────────────────
async function loadHealth() {
  const grid = $('#statsGrid');
  grid.innerHTML = '<div class="spinner">Loading…</div>';
  try {
    const t0 = Date.now();
    const healthPing = await fetch('/api/health', { credentials: 'same-origin' });
    await healthPing.json().catch(() => ({}));
    const ping = Date.now() - t0;

    const h = await api('/api/sa/health');
    const s = h.stats;
    grid.innerHTML = [
      stat('Organizations', s.orgs),
      stat('Users', s.users),
      stat('Loan Officers', s.clrs),
      stat('Outcomes Logged', s.outcomes),
      stat('DB File Size', fmtBytes(s.dbSizeBytes)),
      stat('Uptime', fmtUptime(s.uptimeSec)),
      stat('NODE_ENV', s.nodeEnv || '—'),
      stat('Railway Env', s.railwayEnv || '—'),
      stat('/api/health ping', ping + ' ms', 'ok'),
    ].join('');

    const tbody = $('#webhooksTable tbody');
    if (!h.recentWebhooks?.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="spinner">No recent webhooks.</td></tr>';
    } else {
      tbody.innerHTML = h.recentWebhooks.map(w => \`
        <tr>
          <td>\${w.id}</td>
          <td>\${escapeHtml(w.source || '')}</td>
          <td>\${escapeHtml(w.event_type || '')}</td>
          <td>\${w.processed ? '✓' : '⏳'}</td>
          <td>\${fmtDate(w.created_at)}</td>
        </tr>
      \`).join('');
    }
  } catch (e) {
    grid.innerHTML = '<div class="spinner">Error: ' + escapeHtml(e.message) + '</div>';
  }
}
function stat(label, value, sub) {
  return '<div class="stat"><div class="label">' + escapeHtml(label) + '</div>' +
    '<div class="value">' + escapeHtml(String(value)) + '</div>' +
    (sub ? '<div class="sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';
}
$('#refreshHealth').addEventListener('click', loadHealth);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Boot
checkSession();
</script>
</body>
</html>`;
}
