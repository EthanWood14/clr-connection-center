import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import * as storageExtra from "./storage";
import { insertUserSchema, insertLoanOfficerSchema, insertLeadOutcomeSchema, insertAlgorithmSettingsSchema, type InsertAuditLog } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import nodemailer from "nodemailer";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "clr-secret-2026";
const COOKIE_NAME = "clr_session";

function signPayload(payload: object): string {
  // Simple HMAC-like signature using base64 + secret
  // We use cookie-parser's signed cookie mechanism, so the value is just JSON
  return JSON.stringify(payload);
}

// Auth middleware — reads signed cookie and attaches user to req
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const raw = (req as any).signedCookies?.[COOKIE_NAME];
  if (!raw) return res.status(401).json({ error: "Unauthorized" });
  try {
    const session = JSON.parse(raw);
    if (!session?.userId) return res.status(401).json({ error: "Unauthorized" });
    (req as any).session_user = session;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// Helper: get current reporting period (16th of prev month to 15th of current)
function getDefaultPeriod() {
  const now = new Date();
  const day = now.getDate();
  let startDate: Date, endDate: Date;
  if (day >= 16) {
    startDate = new Date(now.getFullYear(), now.getMonth(), 16);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 16);
    endDate = new Date(now.getFullYear(), now.getMonth(), 15);
  }
  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
}

// Ranking algorithm
function generateRankings(los: any[], settings: any, todayStr: string) {
  const today = new Date(todayStr);
  const dayOfWeek = today.getDay();

  return los
    .filter(lo => lo.internalStatus === "active")
    .filter(lo => !lo.snoozeUntil || lo.snoozeUntil < todayStr)
    .map(lo => {
      const daysSince = lo.lastWorkedDate
        ? Math.floor((today.getTime() - new Date(lo.lastWorkedDate).getTime()) / 86400000)
        : 999;
      const daysSinceNorm = Math.min(daysSince / 30, 1);
      const freqScore = 1 - Math.min(lo.totalTimesWorked / 100, 1);
      const availScore = 1; // simplified - full availability check in prod
      const boostNorm = (lo.boostScore || 0) / 10;
      const tierScore = lo.priorityTier === 1 ? 1 : lo.priorityTier === 2 ? 0.5 : 0.1;

      const score =
        settings.weightDaysSinceWorked * daysSinceNorm +
        settings.weightFrequency * freqScore +
        settings.weightAvailability * availScore +
        settings.weightBoost * boostNorm +
        settings.weightPriorityTier * tierScore +
        Math.random() * 0.01; // tiny tiebreak noise

      return { lo, score, daysSince };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Email report sender ───────────────────────────────────────────────────────
async function sendReport(type: "daily" | "weekly" | "monthly") {
  const settings = storageExtra.getEmailSettings() as any;
  const managers: string[] = (() => { try { return JSON.parse(settings.manager_emails || "[]"); } catch { return []; } })();
  if (!managers.length) return;
  if (!settings.smtp_host || !settings.smtp_user) throw new Error("SMTP not configured");

  const period = getDefaultPeriod();
  const outcomes = storage.getLeadOutcomes({ startDate: period.startDate, endDate: period.endDate });
  const los = storage.getLoanOfficers();
  const users = storage.getUsers();
  const transfers = outcomes.filter((o: any) => o.outcome_type === "transfer" || o.outcomeType === "transfer");

  // Build leaderboard
  const tally: Record<number, number> = {};
  for (const t of transfers) { const aid = t.assistantId || t.assistant_id; tally[aid] = (tally[aid] || 0) + 1; }
  const leaderboard = Object.entries(tally)
    .map(([id, count]) => { const u = users.find(u => u.id === parseInt(id)); return { name: u?.name ?? `User ${id}`, count }; })
    .sort((a, b) => b.count - a.count);

  const subject = `CLR ${type.charAt(0).toUpperCase() + type.slice(1)} Report — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1A2B4A;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">CLR Connection Center</h1>
        <p style="color:#94a3b8;margin:4px 0 0">${subject}</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
        <h2 style="color:#1A2B4A;font-size:16px;margin-top:0">Reporting Period: ${period.startDate} → ${period.endDate}</h2>
        <div style="display:flex;gap:16px;margin-bottom:24px">
          <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:16px;flex:1;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#1A2B4A">${transfers.length}</div>
            <div style="color:#64748b;font-size:13px">Transfers</div>
          </div>
          <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:16px;flex:1;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#1A2B4A">${outcomes.length}</div>
            <div style="color:#64748b;font-size:13px">Total Outcomes</div>
          </div>
          <div style="background:white;border:1px solid #e2e8f0;border-radius:8px;padding:16px;flex:1;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#1A2B4A">${los.filter((l: any) => l.internalStatus === "active").length}</div>
            <div style="color:#64748b;font-size:13px">Active LOs</div>
          </div>
        </div>
        <h3 style="color:#1A2B4A;font-size:14px">CLR Leaderboard</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#1A2B4A;color:white"><th style="padding:8px 12px;text-align:left">#</th><th style="padding:8px 12px;text-align:left">CLR</th><th style="padding:8px 12px;text-align:right">Transfers</th></tr></thead>
          <tbody>${leaderboard.map((row, i) => `<tr style="background:${i%2===0?"white":"#f8fafc"}"><td style="padding:8px 12px">${i+1}</td><td style="padding:8px 12px">${row.name}</td><td style="padding:8px 12px;text-align:right;font-weight:600">${row.count}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;

  const transporter = nodemailer.createTransport({ host: settings.smtp_host, port: settings.smtp_port, secure: settings.smtp_port === 465, auth: { user: settings.smtp_user, pass: settings.smtp_pass } });
  await transporter.sendMail({ from: settings.from_address || settings.smtp_user, to: managers.join(", "), subject, html });
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Audit helper ─────────────────────────────────────────────────────────────
  function audit(data: Omit<InsertAuditLog, never>) {
    try { storage.createAuditLog(data); } catch {}
  }

  // ── Cookie parser ──────────────────────────────────────────────────────────
  app.use(cookieParser(SESSION_SECRET));

  // ── Health check (Railway) ────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // ── Auth routes (public) ───────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    const rateCheck = storageExtra.checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: "Too many failed attempts. Please wait 15 minutes before trying again." });
    }
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const user = storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (!user.password_hash) return res.status(401).json({ error: "Account has no password set" });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: `Invalid email or password${rateCheck.remaining <= 2 ? ` (${rateCheck.remaining} attempt${rateCheck.remaining === 1 ? "" : "s"} remaining)` : ""}` });

    const isProduction = process.env.NODE_ENV === "production";
    const payload = JSON.stringify({ userId: user.id, role: user.role });
    res.cookie(COOKIE_NAME, payload, {
      signed: true,
      httpOnly: true,
      sameSite: isProduction ? "lax" : "none",
      secure: isProduction,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    storageExtra.resetLoginAttempts(ip);
    return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const raw = (req as any).signedCookies?.[COOKIE_NAME];
    if (!raw) return res.status(401).json({ error: "Not authenticated" });
    try {
      const session = JSON.parse(raw);
      if (!session?.userId) return res.status(401).json({ error: "Not authenticated" });
      const user = storage.getUserById(session.userId);
      if (!user) return res.status(401).json({ error: "User not found" });
      return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch {
      return res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.post("/api/auth/change-password", async (req, res) => {
    const raw = (req as any).signedCookies?.[COOKIE_NAME];
    if (!raw) return res.status(401).json({ error: "Not authenticated" });
    let userId: number;
    try {
      const session = JSON.parse(raw);
      if (!session?.userId) return res.status(401).json({ error: "Not authenticated" });
      userId = session.userId;
    } catch {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const user = storage.getUserByEmail(
      (storage.getUserById(userId) as any)?.email ?? ""
    );
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.password_hash) return res.status(401).json({ error: "No password set for this account" });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 10);
    storage.setUserPassword(userId, hash);
    return res.json({ ok: true });
  });

  // ── Auth guard for all /api/* routes except /api/auth/* ────────────────────
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/auth")) return next();
    requireAuth(req, res, next);
  });

  // ── Users ────────────────────────────────────────────────────────────────────
  app.get("/api/users", (req, res) => {
    res.json(storage.getUsers());
  });

  app.post("/api/users", (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.json(storage.createUser(parsed.data));
  });

  app.patch("/api/users/:id", (req, res) => {
    const id = parseInt(req.params.id);
    res.json(storage.updateUser(id, req.body));
  });

  // ── Loan Officers ────────────────────────────────────────────────────────────
  // Snoozed must be registered BEFORE /:id to avoid param capture
  // ── Bulk CSV import — must be BEFORE /:id routes ────────────────────────────
  app.post("/api/loan-officers/import", async (req, res) => {
    try {
      const { rows } = req.body ?? {};
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: "Request body must include a 'rows' array" });
      }

      const existingLOs = storage.getLoanOfficers();
      const existingNmlsIds = new Set(existingLOs.map(lo => lo.nmlsId));

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowLabel = `Row ${i + 1}`;

        if (!row.fullName || !row.nmlsId) {
          errors.push(`${rowLabel}: Missing required fields (fullName, nmlsId)`);
          continue;
        }

        if (existingNmlsIds.has(String(row.nmlsId))) {
          skipped++;
          continue;
        }

        try {
          storage.createLoanOfficer({
            fullName: String(row.fullName),
            nmlsId: String(row.nmlsId),
            phone: row.phone ? String(row.phone) : undefined,
            email: row.email ? String(row.email) : undefined,
            licensedStates: row.licensedStates ? String(row.licensedStates) : "[]",
            bonzoUsername: row.bonzoUsername ? String(row.bonzoUsername) : undefined,
            bonzoPassword: row.bonzoPassword ? String(row.bonzoPassword) : undefined,
            leadMailboxUsername: row.leadMailboxUsername ? String(row.leadMailboxUsername) : undefined,
            leadMailboxPassword: row.leadMailboxPassword ? String(row.leadMailboxPassword) : undefined,
            notes: row.notes ? String(row.notes) : undefined,
            specialRequests: row.specialRequests ? String(row.specialRequests) : undefined,
            boostScore: row.boostScore !== undefined && row.boostScore !== "" ? Number(row.boostScore) : 0,
            priorityTier: row.priorityTier !== undefined && row.priorityTier !== "" ? Number(row.priorityTier) : 2,
            internalStatus: row.internalStatus ? String(row.internalStatus) : "active",
          });
          existingNmlsIds.add(String(row.nmlsId));
          imported++;
        } catch (e: any) {
          errors.push(`${rowLabel} (${row.fullName}): ${e.message}`);
        }
      }

      audit({
        userId: 1,
        userName: "Ethan Wood",
        action: "IMPORT_LOS",
        entityType: "loan_officer",
        entityId: null,
        entityLabel: `Bulk import: ${imported} LOs`,
        details: JSON.stringify({ imported, skipped, errors: errors.length }),
      });

      return res.json({ imported, skipped, errors });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/loan-officers/snoozed", (req, res) => {
    const today = new Date().toISOString().split("T")[0];
    const snoozed = storage.getLoanOfficers().filter(
      (lo) => lo.snoozeUntil && lo.snoozeUntil >= today && lo.internalStatus === "active"
    );
    res.json(snoozed);
  });

  app.get("/api/loan-officers", (req, res) => {
    const los = storage.getLoanOfficers();
    // Strip passwords from list view
    const safe = los.map(lo => ({ ...lo, bonzoPassword: lo.bonzoPassword ? "••••••••" : null, leadMailboxPassword: lo.leadMailboxPassword ? "••••••••" : null }));
    res.json(safe);
  });

  app.get("/api/loan-officers/:id", (req, res) => {
    const lo = storage.getLoanOfficerById(parseInt(req.params.id));
    if (!lo) return res.status(404).json({ error: "Not found" });
    res.json(lo);
  });

  app.post("/api/loan-officers", (req, res) => {
    try {
      const lo = storage.createLoanOfficer(req.body);
      audit({ userId: 1, userName: "Ethan Wood", action: "create", entityType: "loan_officer", entityId: lo.id, entityLabel: lo.fullName, details: null });
      res.json(lo);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/loan-officers/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const lo = storage.updateLoanOfficer(id, req.body);
    if (lo) audit({ userId: 1, userName: "Ethan Wood", action: "update", entityType: "loan_officer", entityId: lo.id, entityLabel: lo.fullName, details: JSON.stringify(req.body) });
    res.json(lo);
  });

  app.delete("/api/loan-officers/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const lo = storage.getLoanOfficerById(id);
    storage.archiveLoanOfficer(id);
    audit({ userId: 1, userName: "Ethan Wood", action: "delete", entityType: "loan_officer", entityId: id, entityLabel: lo?.fullName ?? null, details: null });
    res.json({ ok: true });
  });

  // Copy credential endpoint (reveals plaintext password)
  app.get("/api/loan-officers/:id/credentials", (req, res) => {
    const lo = storage.getLoanOfficerById(parseInt(req.params.id));
    if (!lo) return res.status(404).json({ error: "Not found" });
    res.json({
      bonzoUsername: lo.bonzoUsername,
      bonzoPassword: lo.bonzoPassword,
      leadMailboxUsername: lo.leadMailboxUsername,
      leadMailboxPassword: lo.leadMailboxPassword,
      otherCredentials: lo.otherCredentials,
    });
  });

  // ── LO Availability ──────────────────────────────────────────────────────────
  app.get("/api/loan-officers/:id/availability", (req, res) => {
    const loId = parseInt(req.params.id);
    res.json(storage.getLoAvailability(loId));
  });

  app.put("/api/loan-officers/:id/availability", (req, res) => {
    const loId = parseInt(req.params.id);
    const days = (req.body as any[]).map((d: any) => ({ loId, dayOfWeek: d.dayOfWeek, isAvailable: d.isAvailable, timeSlot: d.timeSlot ?? "all" }));
    storage.setLoAvailability(loId, days);
    res.json(storage.getLoAvailability(loId));
  });

  // ── Daily Assignments ────────────────────────────────────────────────────────
  app.get("/api/assignments", (req, res) => {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const assignments = storage.getDailyAssignments(date);
    const los = storage.getLoanOfficers();
    const users = storage.getUsers();
    const enriched = assignments.map(a => ({
      ...a,
      lo: los.find(l => l.id === a.loId),
      assistant: users.find(u => u.id === a.assistantId),
    }));
    res.json(enriched);
  });

  app.post("/api/assignments/generate", (req, res) => {
    const date = (req.body.date as string) || new Date().toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    // ── One-per-day lock: block re-generation if assignments already exist for today ──
    if (date === today) {
      const existing = storage.getDailyAssignments(date);
      if (existing.length > 0) {
        return res.status(409).json({
          error: "Assignments have already been generated for today. They are locked until tomorrow.",
          locked: true,
          date,
        });
      }
    }

    const settings = storage.getAlgorithmSettings();
    const los = storage.getLoanOfficers();
    const assistants = storage.getUsers().filter(u => u.role === "assistant" && u.isActive);

    if (assistants.length === 0) return res.status(400).json({ error: "No active assistants" });

    // Check what's already worked today
    const existing = storage.getDailyAssignments(date);
    const workedToday = existing.filter(a => a.status === "worked").map(a => a.loId);
    const eligibleLOs = los.filter(lo => !workedToday.includes(lo.id));

    const ranked = generateRankings(eligibleLOs, settings, date);
    const maxTotal = settings.maxLosPerAssistant * assistants.length;
    const topRanked = ranked.slice(0, maxTotal);

    // Clear existing recommended assignments for today
    storage.clearDailyAssignments(date);

    const assignments: any[] = [];

    if (settings.roundRobinEnabled) {
      // ── Spaced Round Robin: CLRs take turns, no CLR gets back-to-back same LO ──
      // Interleave: slot 0→CLR0, slot 1→CLR1, slot 2→CLR2, slot 3→CLR0, ...
      // This ensures max spacing between any CLR's consecutive LO assignments
      const slots = assistants.length;
      topRanked.forEach((item, index) => {
        // Rotate starting CLR each "round" to distribute top-ranked LOs fairly
        const round = Math.floor(index / slots);
        const posInRound = index % slots;
        // Even rounds go 0..N-1, odd rounds go N-1..0 (snake pattern for fairness)
        const assistantIndex = round % 2 === 0 ? posInRound : (slots - 1 - posInRound);
        const assistantRank = round + 1;
        assignments.push({
          assignmentDate: date,
          loId: item.lo.id,
          assistantId: assistants[assistantIndex].id,
          globalRank: index + 1,
          assistantRank,
          status: "recommended",
          notes: null,
        });
      });
    } else {
      // ── Fixed Monthly mode: use monthly assignments table ──────────────────
      const month = date.slice(0, 7);
      const monthlyRows = storageExtra.getMonthlyAssignments(month);
      if (monthlyRows.length === 0) {
        // Auto-generate if empty
        const shuffled = [...topRanked].sort(() => Math.random() - 0.5);
        const rows = shuffled.map((item, i) => ({ assistantId: assistants[i % assistants.length].id, loId: item.lo.id }));
        storageExtra.setMonthlyAssignments(month, rows);
      }
      const monthlyMap = storageExtra.getMonthlyAssignments(month);
      // Use monthly assignment order, filter to top-ranked LOs that are eligible today
      const eligibleIds = new Set(topRanked.map(r => r.lo.id));
      const orderedRows = monthlyMap.filter((r: any) => eligibleIds.has(r.lo_id || r.loId));
      orderedRows.forEach((r: any, index: number) => {
        const assistantId = r.assistant_id || r.assistantId;
        const loId = r.lo_id || r.loId;
        const assistantRank = Math.floor(index / assistants.length) + 1;
        assignments.push({
          assignmentDate: date,
          loId,
          assistantId,
          globalRank: index + 1,
          assistantRank,
          status: "recommended",
          notes: null,
        });
      });
    }

    const created = storage.createDailyAssignments(assignments);
    audit({ userId: 1, userName: "Ethan Wood", action: "generate", entityType: "assignment", entityId: null, entityLabel: `Assignments for ${date}`, details: JSON.stringify({ date, count: created.length }) });

    // Create notification
    storage.createNotification({
      userId: null,
      type: "assignment_ready",
      title: "Daily Assignments Ready",
      message: `${topRanked.length} LOs have been ranked and assigned for ${date}.`,
      isRead: false,
    });

    res.json({ generated: created.length, date });
  });

  app.patch("/api/assignments/:id", (req, res) => {
    // Block status changes unless user is admin (admins use /admin-override endpoint for full audit)
    const raw = (req as any).signedCookies?.[COOKIE_NAME];
    const session = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
    const currentUser = session?.userId ? storage.getUserById(session.userId) : null;
    // Non-admins can still log EOD status (worked/attempted/skipped) — that's normal workflow
    // Only status changes BACK to 'recommended' are blocked for non-admins
    const { status, notes } = req.body;
    if (status === "recommended" && currentUser?.role !== "admin") {
      return res.status(403).json({ error: "Only admins can reset assignment status. Use the admin override process." });
    }
    const assignment = storage.updateAssignmentStatus(parseInt(req.params.id), status, notes);

    // If marked worked, update LO's last worked date
    if (status === "worked" && assignment) {
      storage.updateLoanOfficer(assignment.loId, {
        lastWorkedDate: assignment.assignmentDate,
        totalTimesWorked: (storage.getLoanOfficerById(assignment.loId)?.totalTimesWorked ?? 0) + 1,
      });
    }

    if (assignment) {
      const lo = storage.getLoanOfficerById(assignment.loId);
      audit({ userId: 1, userName: "Ethan Wood", action: "update", entityType: "assignment", entityId: assignment.id, entityLabel: lo?.fullName ?? `Assignment #${assignment.id}`, details: JSON.stringify({ status, notes: notes ?? null }) });
    }

    res.json(assignment);
  });

  // ── Lead Outcomes ────────────────────────────────────────────────────────────
  app.get("/api/outcomes", (req, res) => {
    const { startDate, endDate, assistantId, loId } = req.query;
    const outcomes = storage.getLeadOutcomes({
      startDate: startDate as string,
      endDate: endDate as string,
      assistantId: assistantId ? parseInt(assistantId as string) : undefined,
      loId: loId ? parseInt(loId as string) : undefined,
    });
    const los = storage.getLoanOfficers();
    const users = storage.getUsers();
    const enriched = outcomes.map(o => ({
      ...o,
      lo: los.find(l => l.id === o.loId),
      assistant: users.find(u => u.id === o.assistantId),
    }));
    res.json(enriched);
  });

  app.post("/api/outcomes", (req, res) => {
    try {
      const outcome = storage.createLeadOutcome(req.body);
      const lo = outcome.loId ? storage.getLoanOfficerById(outcome.loId) : null;
      audit({ userId: 1, userName: "Ethan Wood", action: "create", entityType: "outcome", entityId: outcome.id, entityLabel: outcome.borrowerName ?? lo?.fullName ?? null, details: JSON.stringify({ outcomeType: outcome.outcomeType }) });
      res.json(outcome);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/outcomes/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const outcome = storage.updateLeadOutcome(id, req.body);
    if (outcome) audit({ userId: 1, userName: "Ethan Wood", action: "update", entityType: "outcome", entityId: outcome.id, entityLabel: outcome.borrowerName ?? null, details: JSON.stringify(req.body) });
    res.json(outcome);
  });

  app.delete("/api/outcomes/:id", (req, res) => {
    const id = parseInt(req.params.id);
    audit({ userId: 1, userName: "Ethan Wood", action: "delete", entityType: "outcome", entityId: id, entityLabel: null, details: null });
    storage.deleteLeadOutcome(id);
    res.json({ ok: true });
  });

  // ── Notifications ────────────────────────────────────────────────────────────
  app.get("/api/notifications", (req, res) => {
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    res.json(storage.getNotifications(userId));
  });

  app.get("/api/notifications/unread-count", (req, res) => {
    const userId = req.query.userId ? parseInt(req.query.userId as string) : 1;
    res.json({ count: storage.getUnreadCount(userId) });
  });

  app.post("/api/notifications", (req, res) => {
    res.json(storage.createNotification(req.body));
  });

  app.patch("/api/notifications/:id/read", (req, res) => {
    storage.markNotificationRead(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/notifications/mark-all-read", (req, res) => {
    const { userId } = req.body;
    storage.markAllNotificationsRead(userId || 1);
    res.json({ ok: true });
  });

  // ── Dashboard ────────────────────────────────────────────────────────────────
  app.get("/api/dashboard/stats", (req, res) => {
    const period = getDefaultPeriod();
    const startDate = (req.query.startDate as string) || period.startDate;
    const endDate = (req.query.endDate as string) || period.endDate;
    const stats = storage.getDashboardStats(startDate, endDate);
    res.json({ ...stats, startDate, endDate });
  });

  // ── Leaderboard ───────────────────────────────────────────────────────────────
  app.get("/api/leaderboard", (req, res) => {
    const period = getDefaultPeriod();
    const startDate = (req.query.startDate as string) || period.startDate;
    const endDate = (req.query.endDate as string) || period.endDate;
    const leaderboard = storage.getLeaderboard(startDate, endDate);
    res.json({ leaderboard, startDate, endDate });
  });

  // ── Algorithm Settings ────────────────────────────────────────────────────────
  app.get("/api/settings/algorithm", (req, res) => {
    res.json(storage.getAlgorithmSettings());
  });

  app.patch("/api/settings/algorithm", (req, res) => {
    const settings = storage.updateAlgorithmSettings(req.body);
    audit({ userId: 1, userName: "Ethan Wood", action: "update", entityType: "settings", entityId: settings.id, entityLabel: "Algorithm Settings", details: JSON.stringify(req.body) });
    res.json(settings);
  });

  // ── Audit Logs ───────────────────────────────────────────────────────────────
  app.get("/api/audit-logs", (req, res) => {
    const entityType = req.query.entityType as string | undefined;
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam === "all" || limitParam === undefined ? 100 : parseInt(limitParam);
    const logs = storage.getAuditLogs({
      entityType: entityType && entityType !== "all" ? entityType : undefined,
      userId,
      limit: isNaN(limit) ? 100 : limit,
    });
    res.json(logs);
  });

  // ── Daily Call Logs ────────────────────────────────────────────────────────────────
  app.get("/api/call-logs", (req, res) => {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const logs = storage.getDailyCallLogs(date);
    const users = storage.getUsers();
    const enriched = logs.map(l => ({ ...l, assistant: users.find(u => u.id === l.assistantId) }));
    res.json(enriched);
  });

  app.get("/api/call-logs/summary", (req, res) => {
    const from = (req.query.from as string) || "2000-01-01";
    const to = (req.query.to as string) || new Date().toISOString().split("T")[0];
    const allLogs = storage.getCallLogsByRange(from, to);
    const users = storage.getUsers();
    // Aggregate by assistant
    const summary: Record<number, { assistantId: number; name: string; totalCalls: number }> = {};
    allLogs.forEach(l => {
      if (!summary[l.assistantId]) {
        const u = users.find(u => u.id === l.assistantId);
        summary[l.assistantId] = { assistantId: l.assistantId, name: u?.name ?? `CLR #${l.assistantId}`, totalCalls: 0 };
      }
      summary[l.assistantId].totalCalls += l.callsMade;
    });
    res.json(Object.values(summary));
  });

  app.post("/api/call-logs", (req, res) => {
    const { logDate, assistantId, callsMade, notes } = req.body;
    if (!logDate || !assistantId || callsMade === undefined) {
      return res.status(400).json({ error: "logDate, assistantId, and callsMade are required" });
    }
    const log = storage.upsertDailyCallLog({ logDate, assistantId: Number(assistantId), callsMade: Number(callsMade), notes: notes ?? null });
    res.json(log);
  });

  // ── Reporting period helper ───────────────────────────────────────────────────
  app.get("/api/reporting-period", (req, res) => {
    res.json(getDefaultPeriod());
  });

  // ── LO Performance History ────────────────────────────────────────────────────
  app.get("/api/loan-officers/:id/performance", (req, res) => {
    const loId = parseInt(req.params.id);
    const outcomes = storage.getLeadOutcomes({ loId });
    const lo = storage.getLoanOfficerById(loId);
    if (!lo) return res.status(404).json({ error: "Not found" });

    // Group by month (YYYY-MM)
    const byMonth: Record<string, { transfers: number; appointments: number; fellThrough: number; noAnswer: number; total: number }> = {};
    outcomes.forEach(o => {
      const month = o.date.slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = { transfers: 0, appointments: 0, fellThrough: 0, noAnswer: 0, total: 0 };
      byMonth[month].total++;
      if (o.outcomeType === "transfer") byMonth[month].transfers++;
      else if (o.outcomeType === "appointment") byMonth[month].appointments++;
      else if (o.outcomeType === "fell_through") byMonth[month].fellThrough++;
      else if (o.outcomeType === "no_answer") byMonth[month].noAnswer++;
    });

    const monthlyData = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, stats]) => ({ month, ...stats }));

    res.json({ lo, monthlyData, totalOutcomes: outcomes.length });
  });

  // ── Email Settings ────────────────────────────────────────────────────────────
  app.get("/api/settings/email", requireAuth, (_req, res) => {
    const s = storageExtra.getEmailSettings();
    // Never expose SMTP password to frontend
    res.json({ ...s, smtpPass: s.smtpPass ? "••••••••" : "" });
  });

  app.patch("/api/settings/email", requireAuth, (req, res) => {
    const data = { ...req.body };
    if (data.smtpPass === "••••••••") delete data.smtpPass; // don't overwrite with mask
    storageExtra.updateEmailSettings(data);
    res.json({ ok: true });
  });

  app.post("/api/settings/email/test", requireAuth, async (req, res) => {
    const s = storageExtra.getEmailSettings();
    if (!s.smtpHost || !s.smtpUser) return res.status(400).json({ error: "SMTP not configured" });
    try {
      const transporter = nodemailer.createTransport({ host: s.smtpHost, port: s.smtpPort, secure: s.smtpPort === 465, auth: { user: s.smtpUser, pass: s.smtpPass } });
      await transporter.verify();
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/settings/email/send-now", requireAuth, async (req, res) => {
    const { type } = req.body; // 'daily' | 'weekly' | 'monthly'
    try {
      await sendReport(type ?? "daily");
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Monthly Assignments (Fixed mode) ─────────────────────────────────────────
  app.get("/api/monthly-assignments", requireAuth, (req, res) => {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const rows = storageExtra.getMonthlyAssignments(month);
    const los = storage.getLoanOfficers();
    const users = storage.getUsers();
    const enriched = rows.map((r: any) => ({
      ...r,
      lo: los.find(l => l.id === r.lo_id),
      assistant: users.find(u => u.id === r.assistant_id),
    }));
    res.json(enriched);
  });

  app.post("/api/monthly-assignments/shuffle", requireAuth, (req, res) => {
    const month = (req.body.month as string) || new Date().toISOString().slice(0, 7);
    const activeLos = storage.getLoanOfficers().filter(lo => lo.internalStatus === "active");
    const assistants = storage.getUsers().filter(u => (u.role === "assistant" || u.role === "admin") && u.isActive);
    if (!assistants.length) return res.status(400).json({ error: "No active assistants" });
    // Shuffle LOs randomly then distribute round-robin
    const shuffled = [...activeLos].sort(() => Math.random() - 0.5);
    const rows = shuffled.map((lo, i) => ({ assistantId: assistants[i % assistants.length].id, loId: lo.id }));
    storageExtra.setMonthlyAssignments(month, rows);
    audit({ userId: 1, userName: "Ethan Wood", action: "generate", entityType: "assignment", entityId: null, entityLabel: `Monthly shuffle for ${month}`, details: JSON.stringify({ month, count: rows.length }) });
    res.json({ ok: true, count: rows.length });
  });

  // ── Assignment Override (admin triple-confirm) ────────────────────────────────
  app.post("/api/assignments/:id/admin-override", requireAuth, (req, res) => {
    const raw = (req as any).signedCookies?.[COOKIE_NAME];
    const session = raw ? JSON.parse(raw) : null;
    const user = session?.userId ? storage.getUserById(session.userId) : null;
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const { reason, signature, newStatus, notes } = req.body;
    if (!reason?.trim() || !signature?.trim() || !newStatus) return res.status(400).json({ error: "reason, signature, and newStatus required" });
    const assignmentId = parseInt(req.params.id);
    const existing = storage.getAssignmentById ? storage.getAssignmentById(assignmentId) : null;
    const previousStatus = existing?.status ?? "unknown";
    // Log the override
    storageExtra.createAssignmentOverride({ assignmentId, adminId: user.id, adminName: user.name, reason, signature, previousStatus, newStatus });
    // Apply the status change
    const updated = storage.updateAssignmentStatus(assignmentId, newStatus, notes ?? null);
    audit({ userId: user.id, userName: user.name, action: "admin-override", entityType: "assignment", entityId: assignmentId, entityLabel: `Assignment #${assignmentId}`, details: JSON.stringify({ reason, signature, previousStatus, newStatus }) });
    res.json({ ok: true, assignment: updated });
  });

  app.get("/api/assignment-overrides", requireAuth, (_req, res) => {
    res.json(storageExtra.getAssignmentOverrides());
  });

  // ── Hot-patch: pull latest dist from GitHub and overwrite local static files ──
  app.post("/api/admin/hotpatch", async (req, res) => {
    const fs = await import("fs");
    const path = await import("path");
    const https = await import("https");
    const distPath = path.resolve(__dirname, "public");

    function fetchRaw(url: string): Promise<Buffer> {
      return new Promise((resolve, reject) => {
        const doReq = (u: string) => https.get(u, { headers: { "User-Agent": "clr-hotpatch" } }, (r) => {
          if (r.statusCode === 302 || r.statusCode === 301) { doReq(r.headers.location!); return; }
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => resolve(Buffer.concat(chunks)));
          r.on("error", reject);
        }).on("error", reject);
        doReq(u);
      });
    }

    const REPO = "EthanWood14/clr-connection-center";
    const BRANCH = "main";
    const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

    try {
      // Fetch index.html first to discover asset filenames
      const indexBuf = await fetchRaw(`${RAW}/dist/public/index.html`);
      const indexHtml = indexBuf.toString("utf8");

      // Parse asset filenames from index.html
      const jsMatch = indexHtml.match(/assets\/(index-[^"']+\.js)/);
      const cssMatch = indexHtml.match(/assets\/(index-[^"']+\.css)/);
      if (!jsMatch || !cssMatch) return res.status(500).json({ error: "Could not parse asset filenames" });

      const jsFile = jsMatch[1];
      const cssFile = cssMatch[1];

      // Download assets
      const [jsBuf, cssBuf] = await Promise.all([
        fetchRaw(`${RAW}/dist/public/assets/${jsFile}`),
        fetchRaw(`${RAW}/dist/public/assets/${cssFile}`),
      ]);

      // Wipe old assets and write new ones
      const assetsDir = path.join(distPath, "assets");
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
      // Remove old index-*.js and index-*.css
      for (const f of fs.readdirSync(assetsDir)) {
        if (f.startsWith("index-")) fs.unlinkSync(path.join(assetsDir, f));
      }
      fs.writeFileSync(path.join(assetsDir, jsFile), jsBuf);
      fs.writeFileSync(path.join(assetsDir, cssFile), cssBuf);
      fs.writeFileSync(path.join(distPath, "index.html"), indexHtml, "utf8");

      res.json({ ok: true, js: jsFile, css: cssFile });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}

export function createHttpServer(app: Express): Server {
  const server = createServer(app);
  registerRoutes(server, app);
  return server;
}
