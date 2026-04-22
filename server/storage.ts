import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  users, loanOfficers, loAvailability, dailyAssignments,
  leadOutcomes, dailyCallLogs, notifications, algorithmSettings, auditLogs,
  type User, type InsertUser,
  type LoanOfficer, type InsertLoanOfficer,
  type LoAvailability, type InsertLoAvailability,
  type DailyAssignment, type InsertDailyAssignment,
  type LeadOutcome, type InsertLeadOutcome,
  type DailyCallLog, type InsertDailyCallLog,
  type Notification, type InsertNotification,
  type AlgorithmSettings, type InsertAlgorithmSettings,
  type AuditLog, type InsertAuditLog,
} from "@shared/schema";

const dbPath = process.env.DATABASE_PATH ?? "clr.db";
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite);

// ── Init tables ────────────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'assistant',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loan_officers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    nmls_id TEXT NOT NULL UNIQUE,
    phone TEXT,
    email TEXT,
    licensed_states TEXT NOT NULL DEFAULT '[]',
    bonzo_username TEXT,
    bonzo_password TEXT,
    lead_mailbox_username TEXT,
    lead_mailbox_password TEXT,
    other_credentials TEXT NOT NULL DEFAULT '{}',
    notes TEXT,
    special_requests TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    internal_status TEXT NOT NULL DEFAULT 'active',
    boost_score REAL NOT NULL DEFAULT 0,
    priority_tier INTEGER NOT NULL DEFAULT 2,
    snooze_until TEXT,
    snooze_reason TEXT,
    last_worked_date TEXT,
    total_times_worked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lo_availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lo_id INTEGER NOT NULL REFERENCES loan_officers(id),
    day_of_week INTEGER NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 1,
    time_slot TEXT NOT NULL DEFAULT 'all'
  );

  CREATE TABLE IF NOT EXISTS daily_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_date TEXT NOT NULL,
    lo_id INTEGER NOT NULL REFERENCES loan_officers(id),
    assistant_id INTEGER NOT NULL REFERENCES users(id),
    global_rank INTEGER NOT NULL,
    assistant_rank INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'recommended',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lead_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    assistant_id INTEGER NOT NULL REFERENCES users(id),
    lo_id INTEGER NOT NULL REFERENCES loan_officers(id),
    borrower_name TEXT,
    outcome_type TEXT NOT NULL,
    transfer_type TEXT,
    journey_id TEXT,
    notes TEXT,
    follow_up_date TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_date TEXT NOT NULL,
    assistant_id INTEGER NOT NULL,
    calls_made INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(log_date, assistant_id)
  );

  CREATE TABLE IF NOT EXISTS algorithm_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weight_days_since_worked REAL NOT NULL DEFAULT 0.30,
    weight_frequency REAL NOT NULL DEFAULT 0.25,
    weight_availability REAL NOT NULL DEFAULT 0.20,
    weight_boost REAL NOT NULL DEFAULT 0.10,
    weight_priority_tier REAL NOT NULL DEFAULT 0.05,
    weight_recent_transfers REAL NOT NULL DEFAULT 0.10,
    max_los_per_assistant INTEGER NOT NULL DEFAULT 5,
    round_robin_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    entity_label TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Migration: add password_hash column if it doesn't exist ───────────────────
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;`);
} catch {
  // Column already exists — ignore
}

// ── Migration: add time_slot to lo_availability if missing ────────────────────
try {
  sqlite.exec(`ALTER TABLE lo_availability ADD COLUMN time_slot TEXT NOT NULL DEFAULT 'all';`);
} catch {
  // Column already exists — ignore
}

// ── Migration: add has_seen_intro to users if missing ─────────────────────────
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN has_seen_intro INTEGER NOT NULL DEFAULT 0;`);
} catch {
  // Column already exists — ignore
}

// ── Migration: add is_clr to users if missing ───────────────────────────
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN is_clr INTEGER NOT NULL DEFAULT 1;`);
} catch {
  // Column already exists — ignore
}

// ── Migration: add must_change_password to users if missing ─────────────
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;`);
} catch {
  // Column already exists — ignore
}

// ── Migration: add reset_token columns to users if missing ──────────────
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN reset_token TEXT;`);
} catch {
  // Column already exists — ignore
}
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN reset_token_expiry INTEGER;`);
} catch {
  // Column already exists — ignore
}

// ── Migration: add is_manager to users if missing ──────────────────────
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN is_manager INTEGER NOT NULL DEFAULT 0;`);
} catch {
  // Column already exists — ignore
}

// ── Migration: add transfer_type to lead_outcomes if missing ───────────
// Values: 'direct' | 'appointment' | NULL (NULL for non-transfer outcomes
// and for legacy transfer rows logged before this column existed).
try {
  sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN transfer_type TEXT;`);
} catch {
  // Column already exists — ignore
}

// Transfer wizard fields — all nullable, only populated for transfer outcomes
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN conversation_notes TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN lo_action_plan TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN lead_timeframe TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN requires_followup INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN followup_reason TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN followup_date TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN lead_type TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN appointment_datetime TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN lead_goal TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN prequalification_notes TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN missed_reason TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN rescheduled INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN reschedule_datetime TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN next_steps TEXT`); } catch {}
try {
  sqlite.prepare(`UPDATE users SET is_manager = 1 WHERE LOWER(email) IN ('scott.petrie@westcapitallending.com', 'chris.redoble@westcapitallending.com')`).run();
} catch {}

// loan_officers: NMLS license verification columns
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_status TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_states TEXT NOT NULL DEFAULT '[]'`); } catch {}
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_last_checked TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_license_expiration TEXT`); } catch {}

// algorithm_settings: add 90-day transfer weight column if missing (MUST be before any SELECT from algorithmSettings)
try { sqlite.exec(`ALTER TABLE algorithm_settings ADD COLUMN weight_recent_transfers REAL NOT NULL DEFAULT 0.10`); } catch {}

// algorithm_settings: add transfer_preference column if missing — values: 'fewer' | 'more' | 'none'
try { sqlite.exec(`ALTER TABLE algorithm_settings ADD COLUMN transfer_preference TEXT NOT NULL DEFAULT 'fewer'`); } catch {}

// Normalise algorithm weights: if existing row sums to >1.05 (old 5-weight row + new column),
// reset all weights to the correct 6-weight defaults that sum to exactly 1.0
try {
  const row = sqlite.prepare(`SELECT weight_days_since_worked, weight_frequency, weight_availability, weight_boost, weight_priority_tier, weight_recent_transfers FROM algorithm_settings LIMIT 1`).get() as any;
  if (row) {
    const total =
      (row.weight_days_since_worked ?? 0) +
      (row.weight_frequency ?? 0) +
      (row.weight_availability ?? 0) +
      (row.weight_boost ?? 0) +
      (row.weight_priority_tier ?? 0) +
      (row.weight_recent_transfers ?? 0);
    if (total > 1.05) {
      sqlite.prepare(`
        UPDATE algorithm_settings SET
          weight_days_since_worked = 0.30,
          weight_frequency         = 0.25,
          weight_availability      = 0.20,
          weight_boost             = 0.10,
          weight_priority_tier     = 0.05,
          weight_recent_transfers  = 0.10,
          updated_at               = ?
      `).run(new Date().toISOString());
    }
  }
} catch {}

// Seed default admin user and algorithm settings if empty
const existingUsers = db.select().from(users).all();
if (existingUsers.length === 0) {
  db.insert(users).values({
    name: "Ethan Wood",
    email: "ethan.anthony.wood@gmail.com",
    role: "admin",
    isActive: true,
    createdAt: new Date().toISOString(),
  }).run();

  // Seed a few sample assistants
  db.insert(users).values([
    { name: "Jessica Torres", email: "jessica@westcapital.com", role: "assistant", isActive: true, createdAt: new Date().toISOString() },
    { name: "Marcus Lee", email: "marcus@westcapital.com", role: "assistant", isActive: true, createdAt: new Date().toISOString() },
    { name: "Priya Sharma", email: "priya@westcapital.com", role: "assistant", isActive: true, createdAt: new Date().toISOString() },
  ]).run();
}

// ── Seed password for Ethan Wood if not set ────────────────────────────────────
{
  const ethan = sqlite.prepare(`SELECT id, password_hash FROM users WHERE email = ?`).get("ethan.anthony.wood@gmail.com") as { id: number; password_hash: string | null } | undefined;
  if (ethan && !ethan.password_hash) {
    const hash = bcrypt.hashSync("WCL2026!", 10);
    sqlite.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, ethan.id);
  }
}

// ── One-time admin password reset (live DB has a stale/wrong hash) ─────────────
// Force-resets ethan.anthony.wood@gmail.com to a known bcrypt hash of "WCL2026!".
// Uses a dedicated migrations_applied table so it only runs once per database.
try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'admin_pw_reset_v1'`).get();
  if (!done) {
    sqlite.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE email = ?`)
      .run("$2b$10$WgepzdNbwEzTSAQW11xE5e.NWwkYjstTBIDf8UlE.gitFxnwnMNMK", "ethan.anthony.wood@gmail.com");
    sqlite.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`)
      .run("admin_pw_reset_v1", new Date().toISOString());
  }
} catch (e) {
  console.error("admin pw reset migration failed:", e);
}

const existingSettings = db.select().from(algorithmSettings).all();
if (existingSettings.length === 0) {
  db.insert(algorithmSettings).values({
    weightDaysSinceWorked: 0.30,
    weightFrequency: 0.25,
    weightAvailability: 0.20,
    weightBoost: 0.10,
    weightPriorityTier: 0.05,
    maxLosPerAssistant: 5,
    roundRobinEnabled: true,
    updatedAt: new Date().toISOString(),
  }).run();
}

// ── Seed sample LOs if none exist ─────────────────────────────────────────────
const existingLOs = db.select().from(loanOfficers).all();
if (existingLOs.length === 0) {
  const sampleLOs = [
    { fullName: "Robert Chen", nmlsId: "1234567", phone: "(323) 555-0101", email: "rchen@loans.com", licensedStates: JSON.stringify(["CA","TX","FL"]), bonzoUsername: "rchen_bonzo", bonzoPassword: "pass123", leadMailboxUsername: "rchen@leads.com", leadMailboxPassword: "leadpass1", otherCredentials: "{}", notes: "Top performer, prefers morning calls", specialRequests: "", tags: JSON.stringify(["top-producer","referral"]), internalStatus: "active", boostScore: 8, priorityTier: 1, snoozeUntil: null, snoozeReason: null, lastWorkedDate: "2026-04-10", totalTimesWorked: 45, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { fullName: "Maria Gonzalez", nmlsId: "2345678", phone: "(310) 555-0202", email: "mgonzalez@loans.com", licensedStates: JSON.stringify(["CA","AZ","NV"]), bonzoUsername: "mgonz_bonzo", bonzoPassword: "pass456", leadMailboxUsername: "mgonz@leads.com", leadMailboxPassword: "leadpass2", otherCredentials: "{}", notes: "", specialRequests: "Only work leads from CA", tags: JSON.stringify(["ca-specialist"]), internalStatus: "active", boostScore: 5, priorityTier: 2, snoozeUntil: null, snoozeReason: null, lastWorkedDate: "2026-04-14", totalTimesWorked: 32, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { fullName: "James Williams", nmlsId: "3456789", phone: "(213) 555-0303", email: "jwilliams@loans.com", licensedStates: JSON.stringify(["CA","WA","OR"]), bonzoUsername: "jwill_bonzo", bonzoPassword: "pass789", leadMailboxUsername: "jwill@leads.com", leadMailboxPassword: "leadpass3", otherCredentials: "{}", notes: "Available Mon-Fri only", specialRequests: "", tags: JSON.stringify([]), internalStatus: "active", boostScore: 0, priorityTier: 2, snoozeUntil: null, snoozeReason: null, lastWorkedDate: "2026-04-08", totalTimesWorked: 28, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { fullName: "Ashley Kim", nmlsId: "4567890", phone: "(626) 555-0404", email: "akim@loans.com", licensedStates: JSON.stringify(["CA","TX"]), bonzoUsername: "akim_bonzo", bonzoPassword: "passabc", leadMailboxUsername: "akim@leads.com", leadMailboxPassword: "leadpass4", otherCredentials: "{}", notes: "", specialRequests: "", tags: JSON.stringify(["new-lo"]), internalStatus: "active", boostScore: 2, priorityTier: 2, snoozeUntil: null, snoozeReason: null, lastWorkedDate: "2026-04-15", totalTimesWorked: 12, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { fullName: "David Park", nmlsId: "5678901", phone: "(818) 555-0505", email: "dpark@loans.com", licensedStates: JSON.stringify(["CA"]), bonzoUsername: "dpark_bonzo", bonzoPassword: "passdef", leadMailboxUsername: "dpark@leads.com", leadMailboxPassword: "leadpass5", otherCredentials: "{}", notes: "License renewal pending", specialRequests: "", tags: JSON.stringify(["pending-renewal"]), internalStatus: "active", boostScore: 0, priorityTier: 3, snoozeUntil: null, snoozeReason: null, lastWorkedDate: "2026-04-05", totalTimesWorked: 8, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { fullName: "Sandra Davis", nmlsId: "6789012", phone: "(562) 555-0606", email: "sdavis@loans.com", licensedStates: JSON.stringify(["CA","FL","TX","NY"]), bonzoUsername: "sdavis_bonzo", bonzoPassword: "passghi", leadMailboxUsername: "sdavis@leads.com", leadMailboxPassword: "leadpass6", otherCredentials: "{}", notes: "Multi-state specialist", specialRequests: "", tags: JSON.stringify(["multi-state","experienced"]), internalStatus: "active", boostScore: 7, priorityTier: 1, snoozeUntil: null, snoozeReason: null, lastWorkedDate: "2026-04-12", totalTimesWorked: 55, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { fullName: "Michael Torres", nmlsId: "7890123", phone: "(714) 555-0707", email: "mtorres@loans.com", licensedStates: JSON.stringify(["CA","AZ"]), bonzoUsername: "mtorres_bonzo", bonzoPassword: "passjkl", leadMailboxUsername: "mtorres@leads.com", leadMailboxPassword: "leadpass7", otherCredentials: "{}", notes: "", specialRequests: "", tags: JSON.stringify([]), internalStatus: "inactive", boostScore: 0, priorityTier: 2, snoozeUntil: null, snoozeReason: null, lastWorkedDate: "2026-03-20", totalTimesWorked: 15, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];
  db.insert(loanOfficers).values(sampleLOs as any).run();
}

export interface IStorage {
  // Users
  getUsers(): User[];
  getUserById(id: number): User | undefined;
  getUserByEmail(email: string): (User & { password_hash: string | null }) | undefined;
  setUserPassword(id: number, hash: string): void;
  setMustChangePassword(id: number, value: boolean): void;
  createUser(data: InsertUser): User;
  updateUser(id: number, data: Partial<InsertUser>): User | undefined;

  // Loan Officers
  getLoanOfficers(): LoanOfficer[];
  getLoanOfficerById(id: number): LoanOfficer | undefined;
  createLoanOfficer(data: InsertLoanOfficer): LoanOfficer;
  updateLoanOfficer(id: number, data: Partial<InsertLoanOfficer>): LoanOfficer | undefined;
  archiveLoanOfficer(id: number): void;

  // Availability
  getLoAvailability(loId: number): LoAvailability[];
  setLoAvailability(loId: number, days: InsertLoAvailability[]): void;

  // Daily Assignments
  getDailyAssignments(date: string): DailyAssignment[];
  createDailyAssignments(assignments: InsertDailyAssignment[]): DailyAssignment[];
  updateAssignmentStatus(id: number, status: string, notes?: string): DailyAssignment | undefined;
  getAssignmentById(id: number): DailyAssignment | undefined;
  clearDailyAssignments(date: string): void;

  // Lead Outcomes
  getLeadOutcomes(filters?: { startDate?: string; endDate?: string; assistantId?: number; loId?: number }): LeadOutcome[];
  createLeadOutcome(data: InsertLeadOutcome): LeadOutcome;
  updateLeadOutcome(id: number, data: Partial<InsertLeadOutcome>): LeadOutcome | undefined;
  deleteLeadOutcome(id: number): void;

  // Notifications
  getNotifications(userId?: number): Notification[];
  createNotification(data: InsertNotification): Notification;
  markNotificationRead(id: number): void;
  markAllNotificationsRead(userId: number): void;
  getUnreadCount(userId: number): number;

  // Algorithm Settings
  getAlgorithmSettings(): AlgorithmSettings;
  updateAlgorithmSettings(data: Partial<InsertAlgorithmSettings>): AlgorithmSettings;

  // Audit Logs
  createAuditLog(data: InsertAuditLog): AuditLog;
  getAuditLogs(filters?: { entityType?: string; userId?: number; limit?: number }): AuditLog[];

  // Dashboard stats
  getDashboardStats(startDate: string, endDate: string): any;
  getLeaderboard(startDate: string, endDate: string): any[];

  // Daily Call Logs
  getDailyCallLogs(date: string): DailyCallLog[];
  getCallLogsByRange(from: string, to: string): DailyCallLog[];
  upsertDailyCallLog(data: InsertDailyCallLog): DailyCallLog;
}

export class Storage implements IStorage {
  getUsers() {
    return db.select().from(users).all();
  }
  getUserById(id: number) {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  getUserByEmail(email: string) {
    return sqlite.prepare(`SELECT *, password_hash FROM users WHERE email = ? LIMIT 1`).get(email) as (User & { password_hash: string | null }) | undefined;
  }
  setUserPassword(id: number, hash: string) {
    sqlite.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id);
  }
  setMustChangePassword(id: number, value: boolean) {
    sqlite.prepare(`UPDATE users SET must_change_password = ? WHERE id = ?`).run(value ? 1 : 0, id);
  }
  setResetToken(id: number, token: string, expiry: number) {
    sqlite.prepare(`UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?`).run(token, expiry, id);
  }
  clearResetToken(id: number) {
    sqlite.prepare(`UPDATE users SET reset_token = NULL, reset_token_expiry = NULL WHERE id = ?`).run(id);
  }
  getUserByResetToken(token: string) {
    return sqlite.prepare(
      `SELECT *, password_hash, reset_token, reset_token_expiry FROM users WHERE reset_token = ? LIMIT 1`
    ).get(token) as (User & { password_hash: string | null; reset_token: string | null; reset_token_expiry: number | null }) | undefined;
  }
  createUser(data: InsertUser) {
    return db.insert(users).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  updateUser(id: number, data: Partial<InsertUser>) {
    return db.update(users).set(data).where(eq(users.id, id)).returning().get();
  }
  deleteUser(id: number) {
    return db.delete(users).where(eq(users.id, id)).run();
  }

  getLoanOfficers() {
    return db.select().from(loanOfficers).all();
  }
  getLoanOfficerById(id: number) {
    return db.select().from(loanOfficers).where(eq(loanOfficers.id, id)).get();
  }
  createLoanOfficer(data: InsertLoanOfficer) {
    return db.insert(loanOfficers).values({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).returning().get();
  }
  updateLoanOfficer(id: number, data: Partial<InsertLoanOfficer>) {
    return db.update(loanOfficers).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(loanOfficers.id, id)).returning().get();
  }
  archiveLoanOfficer(id: number) {
    db.update(loanOfficers).set({ internalStatus: "archived", updatedAt: new Date().toISOString() }).where(eq(loanOfficers.id, id)).run();
  }

  getLoAvailability(loId: number) {
    return db.select().from(loAvailability).where(eq(loAvailability.loId, loId)).all();
  }
  setLoAvailability(loId: number, days: InsertLoAvailability[]) {
    db.delete(loAvailability).where(eq(loAvailability.loId, loId)).run();
    if (days.length > 0) {
      db.insert(loAvailability).values(days).run();
    }
  }

  getDailyAssignments(date: string) {
    return db.select().from(dailyAssignments).where(eq(dailyAssignments.assignmentDate, date)).all();
  }
  getAssignmentsByRange(from: string, to: string) {
    return db.select().from(dailyAssignments)
      .where(and(gte(dailyAssignments.assignmentDate, from), lte(dailyAssignments.assignmentDate, to)))
      .all();
  }
  createDailyAssignments(assignments: InsertDailyAssignment[]) {
    if (assignments.length === 0) return [];
    return db.insert(dailyAssignments).values(assignments.map(a => ({ ...a, createdAt: new Date().toISOString() }))).returning().all();
  }
  updateAssignmentStatus(id: number, status: string, notes?: string) {
    return db.update(dailyAssignments).set({ status, notes }).where(eq(dailyAssignments.id, id)).returning().get();
  }
  getAssignmentById(id: number) {
    return db.select().from(dailyAssignments).where(eq(dailyAssignments.id, id)).get();
  }
  clearDailyAssignments(date: string) {
    db.delete(dailyAssignments).where(eq(dailyAssignments.assignmentDate, date)).run();
  }

  getLeadOutcomes(filters?: { startDate?: string; endDate?: string; assistantId?: number; loId?: number }) {
    let query = db.select().from(leadOutcomes);
    const conditions = [];
    if (filters?.startDate) conditions.push(gte(leadOutcomes.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(leadOutcomes.date, filters.endDate));
    if (filters?.assistantId) conditions.push(eq(leadOutcomes.assistantId, filters.assistantId));
    if (filters?.loId) conditions.push(eq(leadOutcomes.loId, filters.loId));
    if (conditions.length > 0) {
      return db.select().from(leadOutcomes).where(and(...conditions)).orderBy(desc(leadOutcomes.date)).all();
    }
    return db.select().from(leadOutcomes).orderBy(desc(leadOutcomes.date)).all();
  }
  createLeadOutcome(data: InsertLeadOutcome) {
    return db.insert(leadOutcomes).values({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).returning().get();
  }
  updateLeadOutcome(id: number, data: Partial<InsertLeadOutcome>) {
    return db.update(leadOutcomes).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(leadOutcomes.id, id)).returning().get();
  }
  deleteLeadOutcome(id: number) {
    db.delete(leadOutcomes).where(eq(leadOutcomes.id, id)).run();
  }

  getNotifications(userId?: number) {
    if (userId !== undefined) {
      // Return notifications for this user (personal + broadcasts)
      return db.select().from(notifications)
        .where(sql`(${notifications.userId} = ${userId} OR ${notifications.userId} IS NULL)`)
        .orderBy(desc(notifications.createdAt)).all();
    }
    return db.select().from(notifications).orderBy(desc(notifications.createdAt)).all();
  }
  createNotification(data: InsertNotification) {
    return db.insert(notifications).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  markNotificationRead(id: number) {
    db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id)).run();
  }
  markAllNotificationsRead(userId: number) {
    db.update(notifications).set({ isRead: true })
      .where(sql`(${notifications.userId} = ${userId} OR ${notifications.userId} IS NULL)`)
      .run();
  }
  getUnreadCount(userId: number) {
    const result = db.select({ count: sql<number>`count(*)` }).from(notifications)
      .where(sql`(${notifications.userId} = ${userId} OR ${notifications.userId} IS NULL) AND ${notifications.isRead} = 0`)
      .get();
    return result?.count ?? 0;
  }

  getAlgorithmSettings() {
    const base = db.select().from(algorithmSettings).get()!;
    // weightRecentTransfers and transferPreference added via migration — read via raw SQL to handle existing DBs
    const raw = sqlite.prepare("SELECT weight_recent_transfers, transfer_preference FROM algorithm_settings WHERE id = ?").get(base.id) as any;
    const pref = raw?.transfer_preference;
    const transferPreference: "fewer" | "more" | "none" =
      pref === "more" || pref === "none" ? pref : "fewer";
    return {
      ...base,
      weightRecentTransfers: raw?.weight_recent_transfers ?? 0.10,
      transferPreference,
    };
  }
  updateAlgorithmSettings(data: Partial<InsertAlgorithmSettings>) {
    const existing = db.select().from(algorithmSettings).get();
    // Handle non-Drizzle fields (weightRecentTransfers, transferPreference) separately via raw SQL
    const { weightRecentTransfers, transferPreference, ...drizzleData } = data as any;
    const normalizedPref =
      transferPreference === "fewer" || transferPreference === "more" || transferPreference === "none"
        ? transferPreference
        : undefined;
    if (existing) {
      db.update(algorithmSettings).set({ ...drizzleData, updatedAt: new Date().toISOString() }).where(eq(algorithmSettings.id, existing.id)).returning().get()!;
      if (weightRecentTransfers !== undefined) {
        sqlite.prepare("UPDATE algorithm_settings SET weight_recent_transfers = ? WHERE id = ?").run(weightRecentTransfers, existing.id);
      }
      if (normalizedPref !== undefined) {
        sqlite.prepare("UPDATE algorithm_settings SET transfer_preference = ? WHERE id = ?").run(normalizedPref, existing.id);
      }
      return this.getAlgorithmSettings();
    }
    const inserted = db.insert(algorithmSettings).values({ ...drizzleData as any, updatedAt: new Date().toISOString() }).returning().get()!;
    if (weightRecentTransfers !== undefined) {
      sqlite.prepare("UPDATE algorithm_settings SET weight_recent_transfers = ? WHERE id = ?").run(weightRecentTransfers, inserted.id);
    }
    if (normalizedPref !== undefined) {
      sqlite.prepare("UPDATE algorithm_settings SET transfer_preference = ? WHERE id = ?").run(normalizedPref, inserted.id);
    }
    return this.getAlgorithmSettings();
  }

  getDashboardStats(startDate: string, endDate: string) {
    const outcomes = db.select().from(leadOutcomes)
      .where(and(gte(leadOutcomes.date, startDate), lte(leadOutcomes.date, endDate))).all();

    const total = outcomes.length;
    const transfers = outcomes.filter(o => o.outcomeType === "transfer").length;
    const appointments = outcomes.filter(o => o.outcomeType === "appointment").length;
    const fellThrough = outcomes.filter(o => o.outcomeType === "fell_through").length;
    const noAnswer = outcomes.filter(o => o.outcomeType === "no_answer").length;
    const conversionRate = total > 0 ? Math.round((transfers / total) * 100) : 0;

    const outcomesByType: Record<string, number> = {};
    outcomes.forEach(o => {
      outcomesByType[o.outcomeType] = (outcomesByType[o.outcomeType] || 0) + 1;
    });

    // Today's call totals
    const todayStr = new Date().toISOString().split("T")[0];
    const todayLogs = db.select().from(dailyCallLogs).where(eq(dailyCallLogs.logDate, todayStr)).all();
    const totalCallsToday = todayLogs.reduce((sum, l) => sum + l.callsMade, 0);
    const callTransferRatio = totalCallsToday > 0 ? ((transfers / totalCallsToday) * 100).toFixed(1) : null;

    // Count upcoming appointments: outcomeType='appointment' with followUpDate >= today
    const allOutcomes = db.select().from(leadOutcomes).all();
    const upcomingAppointments = allOutcomes.filter(
      o => o.outcomeType === "appointment" && o.followUpDate != null && o.followUpDate >= todayStr
    ).length;

    return { total, transfers, appointments, fellThrough, noAnswer, conversionRate, outcomesByType, totalCallsToday, callTransferRatio, upcomingAppointments };
  }

  getLeaderboard(startDate: string, endDate: string) {
    const outcomes = db.select().from(leadOutcomes)
      .where(and(gte(leadOutcomes.date, startDate), lte(leadOutcomes.date, endDate))).all();

    const allUsers = db.select().from(users).where(
      sql`(${users.role} = 'assistant' OR ${users.role} = 'admin') AND ${users.isActive} = 1`
    ).all();

    const stats = allUsers.map(user => {
      const userOutcomes = outcomes.filter(o => o.assistantId === user.id);
      const transfers = userOutcomes.filter(o => o.outcomeType === "transfer").length;
      const appointments = userOutcomes.filter(o => o.outcomeType === "appointment").length;
      const total = userOutcomes.length;
      const rate = total > 0 ? Math.round((transfers / total) * 100) : 0;
      return { userId: user.id, name: user.name, transfers, appointments, total, conversionRate: rate };
    });

    return stats.sort((a, b) => b.transfers - a.transfers);
  }

  getDailyCallLogs(date: string) {
    return db.select().from(dailyCallLogs).where(eq(dailyCallLogs.logDate, date)).all();
  }

  getCallLogsByRange(from: string, to: string) {
    return db.select().from(dailyCallLogs)
      .where(and(gte(dailyCallLogs.logDate, from), lte(dailyCallLogs.logDate, to)))
      .all();
  }

  upsertDailyCallLog(data: InsertDailyCallLog) {
    const existing = db.select().from(dailyCallLogs)
      .where(and(eq(dailyCallLogs.logDate, data.logDate), eq(dailyCallLogs.assistantId, data.assistantId)))
      .get();
    const now = new Date().toISOString();
    if (existing) {
      return db.update(dailyCallLogs)
        .set({ callsMade: data.callsMade, notes: data.notes ?? null, updatedAt: now })
        .where(eq(dailyCallLogs.id, existing.id))
        .returning().get()!;
    }
    return db.insert(dailyCallLogs).values({ ...data, updatedAt: now }).returning().get()!;
  }

  createAuditLog(data: InsertAuditLog) {
    return db.insert(auditLogs).values({ ...data, createdAt: new Date().toISOString() }).returning().get()!;
  }

  getAuditLogs(filters?: { entityType?: string; userId?: number; limit?: number }) {
    const limit = filters?.limit ?? 100;
    const conditions = [];
    if (filters?.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
    if (filters?.userId !== undefined) conditions.push(eq(auditLogs.userId, filters.userId));
    const query = conditions.length > 0
      ? db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(limit)
      : db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
    return query.all();
  }
}

export const storage = new Storage();

// ── Migrations for new tables ──────────────────────────────────────────────────
function runNewMigrations() {
  // email_settings
  sqlite.exec(`CREATE TABLE IF NOT EXISTS email_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    smtp_host TEXT NOT NULL DEFAULT '',
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_user TEXT NOT NULL DEFAULT '',
    smtp_pass TEXT NOT NULL DEFAULT '',
    from_address TEXT NOT NULL DEFAULT '',
    manager_emails TEXT NOT NULL DEFAULT '[]',
    daily_enabled INTEGER NOT NULL DEFAULT 0,
    weekly_enabled INTEGER NOT NULL DEFAULT 0,
    monthly_enabled INTEGER NOT NULL DEFAULT 0,
    daily_time TEXT NOT NULL DEFAULT '08:00',
    weekly_day INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // seed default row if empty
  const emailRow = sqlite.prepare(`SELECT id FROM email_settings LIMIT 1`).get();
  if (!emailRow) sqlite.exec(`INSERT INTO email_settings (id) VALUES (1)`);
  // Migrate: add resend_api_key column if missing
  const emailCols = sqlite.prepare(`PRAGMA table_info(email_settings)`).all() as any[];
  if (!emailCols.find(c => c.name === 'resend_api_key')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN resend_api_key TEXT NOT NULL DEFAULT ''`);
  }
  if (!emailCols.find(c => c.name === 'from_address_resend')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN from_address_resend TEXT NOT NULL DEFAULT ''`);
  }
  if (!emailCols.find(c => c.name === 'welcome_email_enabled')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN welcome_email_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  // Seed default SMTP credentials (always set if not already a Gmail address)
  const emailKeyRow = sqlite.prepare(`SELECT smtp_user, smtp_port, manager_emails FROM email_settings WHERE id=1`).get() as any;
  if (!emailKeyRow?.smtp_user || !emailKeyRow.smtp_user.includes('@gmail.com')) {
    sqlite.exec(`UPDATE email_settings SET smtp_host='smtp.gmail.com', smtp_port=465, smtp_user='ewoodwestcap@gmail.com', smtp_pass='comp dgft hgol thwc' WHERE id=1`);
  } else if (emailKeyRow.smtp_port !== 465) {
    // Force-update port to 465 if still on old value
    sqlite.exec(`UPDATE email_settings SET smtp_host='smtp.gmail.com', smtp_port=465 WHERE id=1`);
  }
  // Seed default manager emails if none set
  if (!emailKeyRow?.manager_emails || emailKeyRow.manager_emails === '[]' || emailKeyRow.manager_emails === '') {
    const defaultManagers = JSON.stringify(["scott.petrie@westcapitallending.com", "chris.redoble@westcapitallending.com"]);
    sqlite.exec(`UPDATE email_settings SET manager_emails='${defaultManagers}' WHERE id=1`);
  }
  // Fix stale from_address_resend from info@wlc.it.com -> reports@wlc.it.com
  try { sqlite.exec(`UPDATE email_settings SET from_address_resend = 'reports@wlc.it.com' WHERE from_address_resend = 'info@wlc.it.com'`); } catch {}
  // Seed default from_address_resend if empty
  try { sqlite.exec(`UPDATE email_settings SET from_address_resend = 'reports@wlc.it.com' WHERE from_address_resend IS NULL OR from_address_resend = ''`); } catch {}
  // Fix stale default manager_emails from woodea1@masters.edu -> Scott + Chris
  try { sqlite.exec(`UPDATE email_settings SET manager_emails = '${JSON.stringify(["scott.petrie@westcapitallending.com","chris.redoble@westcapitallending.com"])}' WHERE manager_emails LIKE '%woodea1@masters.edu%'`); } catch {}

  // report_schedule_settings — per-type recipient overrides for daily/weekly/monthly scheduled reports
  sqlite.exec(`CREATE TABLE IF NOT EXISTS report_schedule_settings (
    report_type TEXT PRIMARY KEY,
    recipients TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  try {
    const defaults = JSON.stringify(["scott.petrie@westcapitallending.com", "chris.redoble@westcapitallending.com"]);
    const insertDefault = sqlite.prepare(`INSERT OR IGNORE INTO report_schedule_settings (report_type, recipients) VALUES (?, ?)`);
    insertDefault.run("daily", defaults);
    insertDefault.run("weekly", defaults);
    insertDefault.run("monthly", defaults);
  } catch (e) { console.error("report_schedule_settings seed failed:", e); }

  // Cleanup: dedupe existing recipient lists case-insensitively. Runs every boot.
  // Always writes back so stored JSON is always canonical (no stale dupes carried over).
  try {
    const rows = sqlite.prepare(`SELECT report_type, recipients FROM report_schedule_settings`).all() as any[];
    const updateStmt = sqlite.prepare(`UPDATE report_schedule_settings SET recipients = ?, updated_at = CURRENT_TIMESTAMP WHERE report_type = ?`);
    for (const row of rows) {
      let parsed: unknown = [];
      try { parsed = JSON.parse(row.recipients || "[]"); } catch { parsed = []; }
      const list = Array.isArray(parsed) ? parsed : [];
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const e of list) {
        if (typeof e !== "string") continue;
        const trimmed = e.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (!seen.has(key)) { seen.add(key); deduped.push(trimmed); }
      }
      const nextJson = JSON.stringify(deduped);
      if (nextJson !== row.recipients) {
        updateStmt.run(nextJson, row.report_type);
      }
    }
  } catch (e) { console.error("report_schedule_settings dedupe cleanup failed:", e); }

  // One-time alias cleanup: remove legacy short-form emails (spetrie@, credoble@,
  // and the "spetries@" typo variant) from recipient lists. The full-name
  // versions (scott.petrie@ / chris.redoble@) are the canonical addresses.
  try {
    const ALIASES = new Set([
      "spetrie@westcapitallending.com",
      "spetries@westcapitallending.com",
      "credoble@westcapitallending.com",
    ]);
    const rows = sqlite.prepare(`SELECT report_type, recipients FROM report_schedule_settings`).all() as any[];
    const updateStmt = sqlite.prepare(`UPDATE report_schedule_settings SET recipients = ?, updated_at = CURRENT_TIMESTAMP WHERE report_type = ?`);
    for (const row of rows) {
      let parsed: unknown = [];
      try { parsed = JSON.parse(row.recipients || "[]"); } catch { parsed = []; }
      const list = Array.isArray(parsed) ? parsed : [];
      const filtered = list.filter(e => typeof e === "string" && !ALIASES.has(e.trim().toLowerCase()));
      const nextJson = JSON.stringify(filtered);
      if (nextJson !== row.recipients) {
        updateStmt.run(nextJson, row.report_type);
      }
    }
  } catch (e) { console.error("report_schedule_settings alias cleanup failed:", e); }

  // Same alias cleanup for email_settings.manager_emails.
  try {
    const ALIASES = new Set([
      "spetrie@westcapitallending.com",
      "spetries@westcapitallending.com",
      "credoble@westcapitallending.com",
    ]);
    const rows = sqlite.prepare(`SELECT id, manager_emails FROM email_settings`).all() as any[];
    const updateStmt = sqlite.prepare(`UPDATE email_settings SET manager_emails = ? WHERE id = ?`);
    for (const row of rows) {
      let parsed: unknown = [];
      try { parsed = JSON.parse(row.manager_emails || "[]"); } catch { parsed = []; }
      const list = Array.isArray(parsed) ? parsed : [];
      const filtered = list.filter(e => typeof e === "string" && !ALIASES.has(e.trim().toLowerCase()));
      const nextJson = JSON.stringify(filtered);
      if (nextJson !== (row.manager_emails || "[]")) {
        updateStmt.run(nextJson, row.id);
      }
    }
  } catch (e) { console.error("email_settings alias cleanup failed:", e); }

  // If any user rows still have the legacy alias email, promote them to the
  // full-name version (preserving the is_manager flag from line ~195).
  try {
    sqlite.prepare(
      `UPDATE users SET email = 'scott.petrie@westcapitallending.com'
       WHERE LOWER(email) IN ('spetrie@westcapitallending.com','spetries@westcapitallending.com')`
    ).run();
    sqlite.prepare(
      `UPDATE users SET email = 'chris.redoble@westcapitallending.com'
       WHERE LOWER(email) = 'credoble@westcapitallending.com'`
    ).run();
  } catch (e) { console.error("users alias cleanup failed:", e); }

  // monthly_assignments
  sqlite.exec(`CREATE TABLE IF NOT EXISTS monthly_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_key TEXT NOT NULL,
    assistant_id INTEGER NOT NULL,
    lo_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // assignment_overrides
  sqlite.exec(`CREATE TABLE IF NOT EXISTS assignment_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    admin_id INTEGER NOT NULL,
    admin_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    signature TEXT NOT NULL,
    previous_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // algorithm_settings: add fixedMonthly mode column if missing
  try { sqlite.exec(`ALTER TABLE algorithm_settings ADD COLUMN fixed_monthly_enabled INTEGER NOT NULL DEFAULT 0`); } catch {}

  // ── Migrate nmls_id to nullable (was NOT NULL UNIQUE) ──────────────────────
  // SQLite can't DROP NOT NULL via ALTER COLUMN, so recreate the table if needed
  try {
    const col = (sqlite.prepare(`PRAGMA table_info(loan_officers)`).all() as any[])
      .find((c: any) => c.name === "nmls_id");
    if (col && col.notnull === 1) {
      // Recreate loan_officers with nmls_id as nullable TEXT UNIQUE
      sqlite.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN;
        CREATE TABLE loan_officers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL,
          nmls_id TEXT UNIQUE,
          phone TEXT,
          email TEXT,
          licensed_states TEXT NOT NULL DEFAULT '[]',
          bonzo_username TEXT,
          bonzo_password TEXT,
          lead_mailbox_username TEXT,
          lead_mailbox_password TEXT,
          other_credentials TEXT NOT NULL DEFAULT '{}',
          notes TEXT,
          special_requests TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          internal_status TEXT NOT NULL DEFAULT 'active',
          boost_score REAL NOT NULL DEFAULT 0,
          priority_tier INTEGER NOT NULL DEFAULT 2,
          snooze_until TEXT,
          snooze_reason TEXT,
          last_worked_date TEXT,
          total_times_worked INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO loan_officers_new SELECT * FROM loan_officers;
        DROP TABLE loan_officers;
        ALTER TABLE loan_officers_new RENAME TO loan_officers;
        COMMIT;
        PRAGMA foreign_keys=ON;
      `);
    }
  } catch (e) {
    console.warn("NMLS nullable migration skipped:", e);
  }

  // ── Null out non-numeric NMLS IDs ─────────────────────────────────────────
  try {
    sqlite.exec(`UPDATE loan_officers SET nmls_id = NULL WHERE nmls_id IS NOT NULL AND nmls_id NOT GLOB '[0-9]*'`);
    // Also null out values that contain non-digit characters (e.g. 'BN-WCL', 'T456')
    sqlite.exec(`UPDATE loan_officers SET nmls_id = NULL WHERE nmls_id IS NOT NULL AND CAST(nmls_id AS INTEGER) = 0 AND nmls_id != '0'`);
  } catch (e) {
    console.warn("NMLS cleanup migration skipped:", e);
  }

  // login rate limiting table
  sqlite.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT
  )`);

  // NMLS check logs
  sqlite.exec(`CREATE TABLE IF NOT EXISTS nmls_check_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lo_id INTEGER NOT NULL,
    assigned_to INTEGER,
    assigned_at TEXT NOT NULL,
    confirmed_by INTEGER,
    confirmed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    period_key TEXT NOT NULL
  )`);

  // NMLS schedule settings
  sqlite.exec(`CREATE TABLE IF NOT EXISTS nmls_schedule (
    id INTEGER PRIMARY KEY DEFAULT 1,
    check_day_1 INTEGER NOT NULL DEFAULT 1,
    check_day_2 INTEGER NOT NULL DEFAULT 16,
    escalation_days INTEGER NOT NULL DEFAULT 7,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const nmlsRow = sqlite.prepare(`SELECT id FROM nmls_schedule WHERE id=1`).get();
  if (!nmlsRow) sqlite.exec(`INSERT INTO nmls_schedule(id) VALUES(1)`);
  // Migrate: add interval_months if missing
  const nmlsCols = sqlite.prepare(`PRAGMA table_info(nmls_schedule)`).all() as any[];
  if (!nmlsCols.find(c => c.name === 'interval_months')) {
    sqlite.exec(`ALTER TABLE nmls_schedule ADD COLUMN interval_months INTEGER NOT NULL DEFAULT 2`);
  }

  // Chat messages table
  sqlite.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // EOD reports table
  sqlite.exec(`CREATE TABLE IF NOT EXISTS eod_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date TEXT NOT NULL,
    assistant_id INTEGER NOT NULL,
    calls_made INTEGER NOT NULL DEFAULT 0,
    transfers INTEGER NOT NULL DEFAULT 0,
    appointments INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(report_date, assistant_id)
  )`);
  // LO coverage columns (added post-hoc; safe to ignore duplicate errors)
  try { sqlite.exec(`ALTER TABLE eod_reports ADD COLUMN assigned_los_called TEXT NOT NULL DEFAULT '[]'`); } catch {}
  try { sqlite.exec(`ALTER TABLE eod_reports ADD COLUMN additional_los_called TEXT NOT NULL DEFAULT '[]'`); } catch {}

  // EOD activities table (individual line items per report)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS eod_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date TEXT NOT NULL,
    assistant_id INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

}
runNewMigrations();


// ── Email Settings storage ─────────────────────────────────────────────────────
export function getEmailSettings() {
  return sqlite.prepare(`SELECT * FROM email_settings WHERE id=1`).get() as any ?? {};
}
export function updateEmailSettings(data: any) {
  const fields = Object.keys(data).map(k => {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    return `${col} = ?`;
  }).join(', ');
  const vals = Object.values(data);
  sqlite.prepare(`UPDATE email_settings SET ${fields}, updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(...vals);
  return getEmailSettings();
}

// ── Report schedule recipients (per report_type) ─────────────────────────────
export type ReportType = "daily" | "weekly" | "monthly";

function dedupeRecipientList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of list) {
    if (typeof e !== "string") continue;
    const trimmed = e.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function getReportScheduleRecipients(type: ReportType): string[] {
  const row = sqlite.prepare(`SELECT recipients FROM report_schedule_settings WHERE report_type=?`).get(type) as any;
  if (!row?.recipients) return [];
  try {
    return dedupeRecipientList(JSON.parse(row.recipients));
  } catch { return []; }
}

export function getAllReportSchedules(): { report_type: ReportType; recipients: string[] }[] {
  const rows = sqlite.prepare(`SELECT report_type, recipients FROM report_schedule_settings`).all() as any[];
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    try {
      byType.set(r.report_type, dedupeRecipientList(JSON.parse(r.recipients || "[]")));
    } catch { byType.set(r.report_type, []); }
  }
  return (["daily", "weekly", "monthly"] as ReportType[]).map(t => ({
    report_type: t,
    recipients: byType.get(t) ?? [],
  }));
}

export function updateReportScheduleRecipients(type: ReportType, recipients: string[]) {
  const raw = Array.isArray(recipients)
    ? recipients.map(e => String(e || "").trim()).filter(e => e.length > 0)
    : [];
  // Dedupe case-insensitively, preserving first-seen casing and order
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const e of raw) {
    const key = e.toLowerCase();
    if (!seen.has(key)) { seen.add(key); cleaned.push(e); }
  }
  const json = JSON.stringify(cleaned);
  sqlite.prepare(`
    INSERT INTO report_schedule_settings (report_type, recipients, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(report_type) DO UPDATE SET recipients=excluded.recipients, updated_at=CURRENT_TIMESTAMP
  `).run(type, json);
  return cleaned;
}

export function addEmailToAllReportSchedules(email: string) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return;
  for (const t of ["daily", "weekly", "monthly"] as ReportType[]) {
    const current = getReportScheduleRecipients(t);
    if (!current.some(e => e.trim().toLowerCase() === target)) {
      updateReportScheduleRecipients(t, [...current, email.trim()]);
    }
  }
}

export function removeEmailFromAllReportSchedules(email: string) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return;
  for (const t of ["daily", "weekly", "monthly"] as ReportType[]) {
    const current = getReportScheduleRecipients(t);
    const filtered = current.filter(e => e.trim().toLowerCase() !== target);
    if (filtered.length !== current.length) {
      updateReportScheduleRecipients(t, filtered);
    }
  }
}

// ── Monthly Assignments storage ────────────────────────────────────────────────
export function getMonthlyAssignments(monthKey: string) {
  return sqlite.prepare(`SELECT * FROM monthly_assignments WHERE month_key=?`).all(monthKey) as any[];
}
export function setMonthlyAssignments(monthKey: string, rows: {assistantId: number, loId: number}[]) {
  sqlite.prepare(`DELETE FROM monthly_assignments WHERE month_key=?`).run(monthKey);
  const ins = sqlite.prepare(`INSERT INTO monthly_assignments (month_key, assistant_id, lo_id) VALUES (?,?,?)`);
  for (const r of rows) ins.run(monthKey, r.assistantId, r.loId);
  return getMonthlyAssignments(monthKey);
}

// ── Assignment Override log ────────────────────────────────────────────────────
export function createAssignmentOverride(data: {assignmentId:number,adminId:number,adminName:string,reason:string,signature:string,previousStatus:string,newStatus:string}) {
  return sqlite.prepare(`
    INSERT INTO assignment_overrides (assignment_id,admin_id,admin_name,reason,signature,previous_status,new_status)
    VALUES (?,?,?,?,?,?,?)
  `).run(data.assignmentId,data.adminId,data.adminName,data.reason,data.signature,data.previousStatus,data.newStatus);
}
export function getAssignmentOverrides(assignmentId?: number) {
  if (assignmentId) return sqlite.prepare(`SELECT * FROM assignment_overrides WHERE assignment_id=? ORDER BY created_at DESC`).all(assignmentId) as any[];
  return sqlite.prepare(`SELECT * FROM assignment_overrides ORDER BY created_at DESC LIMIT 100`).all() as any[];
}

// ── Login rate limiting ────────────────────────────────────────────────────────
export function checkLoginRateLimit(ip: string): {allowed: boolean, remaining: number} {
  const now = new Date().toISOString();
  const row = sqlite.prepare(`SELECT * FROM login_attempts WHERE ip=?`).get(ip) as any;
  if (!row) { sqlite.prepare(`INSERT INTO login_attempts(ip,attempts) VALUES(?,1)`).run(ip); return {allowed:true,remaining:4}; }
  if (row.locked_until && row.locked_until > now) return {allowed:false,remaining:0};
  if (row.locked_until && row.locked_until <= now) {
    sqlite.prepare(`UPDATE login_attempts SET attempts=1,locked_until=NULL WHERE ip=?`).run(ip);
    return {allowed:true,remaining:4};
  }
  const attempts = (row.attempts||0)+1;
  if (attempts >= 5) {
    const lockUntil = new Date(Date.now()+15*60*1000).toISOString();
    sqlite.prepare(`UPDATE login_attempts SET attempts=?,locked_until=? WHERE ip=?`).run(attempts,lockUntil,ip);
    return {allowed:false,remaining:0};
  }
  sqlite.prepare(`UPDATE login_attempts SET attempts=? WHERE ip=?`).run(attempts,ip);
  return {allowed:true,remaining:5-attempts};
}
export function resetLoginAttempts(ip: string) {
  sqlite.prepare(`UPDATE login_attempts SET attempts=0,locked_until=NULL WHERE ip=?`).run(ip);
}


// ── NMLS Check Storage ─────────────────────────────────────────────────────────
export function getNmlsSchedule() {
  return sqlite.prepare(`SELECT * FROM nmls_schedule WHERE id=1`).get() as any;
}
export function updateNmlsSchedule(data: { checkDay1?: number; checkDay2?: number; escalationDays?: number; intervalMonths?: number }) {
  const fields: string[] = [];
  const vals: any[] = [];
  if (data.checkDay1 !== undefined) { fields.push("check_day_1=?"); vals.push(data.checkDay1); }
  if (data.checkDay2 !== undefined) { fields.push("check_day_2=?"); vals.push(data.checkDay2); }
  if (data.escalationDays !== undefined) { fields.push("escalation_days=?"); vals.push(data.escalationDays); }
  if (data.intervalMonths !== undefined) { fields.push("interval_months=?"); vals.push(data.intervalMonths); }
  if (!fields.length) return getNmlsSchedule();
  fields.push("updated_at=?"); vals.push(new Date().toISOString());
  sqlite.prepare(`UPDATE nmls_schedule SET ${fields.join(",")} WHERE id=1`).run(...vals);
  return getNmlsSchedule();
}
export function getNmlsChecksForPeriod(periodKey: string) {
  return sqlite.prepare(`SELECT * FROM nmls_check_logs WHERE period_key=?`).all(periodKey) as any[];
}
export function getNmlsCheckForLo(loId: number, periodKey: string) {
  return sqlite.prepare(`SELECT * FROM nmls_check_logs WHERE lo_id=? AND period_key=?`).get(loId, periodKey) as any | undefined;
}
export function createNmlsCheck(data: { loId: number; assignedTo: number; periodKey: string }) {
  return sqlite.prepare(
    `INSERT INTO nmls_check_logs(lo_id, assigned_to, assigned_at, period_key) VALUES(?,?,?,?)`
  ).run(data.loId, data.assignedTo, new Date().toISOString(), data.periodKey);
}
export function confirmNmlsCheck(loId: number, periodKey: string, confirmedBy: number) {
  return sqlite.prepare(
    `UPDATE nmls_check_logs SET status='confirmed', confirmed_by=?, confirmed_at=? WHERE lo_id=? AND period_key=?`
  ).run(confirmedBy, new Date().toISOString(), loId, periodKey);
}
export function getPendingNmlsChecks(olderThanDays: number) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  return sqlite.prepare(
    `SELECT * FROM nmls_check_logs WHERE status='pending' AND assigned_at < ?`
  ).all(cutoff) as any[];
}
export function escalateNmlsCheck(id: number) {
  return sqlite.prepare(`UPDATE nmls_check_logs SET status='escalated' WHERE id=?`).run(id);
}

// ── Chat Messages storage ──────────────────────────────────────────────────────
export function getChatMessages(limit = 100, beforeId?: number): any[] {
  if (beforeId) {
    return sqlite.prepare(
      `SELECT * FROM chat_messages WHERE id < ? ORDER BY id DESC LIMIT ?`
    ).all(beforeId, limit) as any[];
  }
  return sqlite.prepare(
    `SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?`
  ).all(limit) as any[];
}
export function postChatMessage(userId: number, userName: string, message: string): any {
  const result = sqlite.prepare(
    `INSERT INTO chat_messages (user_id, user_name, message) VALUES (?, ?, ?)`
  ).run(userId, userName, message);
  return sqlite.prepare(`SELECT * FROM chat_messages WHERE id=?`).get(result.lastInsertRowid) as any;
}
export function deleteChatMessage(id: number): void {
  sqlite.prepare(`DELETE FROM chat_messages WHERE id=?`).run(id);
}

export function deleteUserCascade(id: number): void {
  // Remove FK-linked rows first so SQLite constraints don't block the delete
  sqlite.prepare(`DELETE FROM daily_assignments WHERE assistant_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM lead_outcomes WHERE assistant_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM daily_call_logs WHERE assistant_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM assignment_overrides WHERE admin_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM audit_logs WHERE user_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM nmls_check_logs WHERE assigned_to = ?`).run(id);
  sqlite.prepare(`DELETE FROM chat_messages WHERE user_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM eod_reports WHERE assistant_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM eod_activities WHERE assistant_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

// ── EOD Reports ───────────────────────────────────────────────────────────────
export function getEodReport(reportDate: string, assistantId: number): any {
  return sqlite.prepare(`SELECT * FROM eod_reports WHERE report_date=? AND assistant_id=?`).get(reportDate, assistantId) as any ?? null;
}

export function upsertEodReport(data: { reportDate: string; assistantId: number; callsMade: number; transfers: number; appointments: number; notes?: string | null; assignedLosCalled?: number[]; additionalLosCalled?: number[] }): any {
  const assignedJson = JSON.stringify(Array.isArray(data.assignedLosCalled) ? data.assignedLosCalled.map(n => Number(n)).filter(Number.isFinite) : []);
  const additionalJson = JSON.stringify(Array.isArray(data.additionalLosCalled) ? data.additionalLosCalled.map(n => Number(n)).filter(Number.isFinite) : []);
  sqlite.prepare(`
    INSERT INTO eod_reports (report_date, assistant_id, calls_made, transfers, appointments, notes, assigned_los_called, additional_los_called, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(report_date, assistant_id) DO UPDATE SET
      calls_made=excluded.calls_made, transfers=excluded.transfers,
      appointments=excluded.appointments, notes=excluded.notes,
      assigned_los_called=excluded.assigned_los_called,
      additional_los_called=excluded.additional_los_called,
      submitted_at=datetime('now')
  `).run(data.reportDate, data.assistantId, data.callsMade, data.transfers, data.appointments, data.notes ?? null, assignedJson, additionalJson);
  return getEodReport(data.reportDate, data.assistantId);
}

export function getEodActivities(reportDate: string, assistantId: number): any[] {
  return sqlite.prepare(`SELECT * FROM eod_activities WHERE report_date=? AND assistant_id=? ORDER BY id ASC`).all(reportDate, assistantId) as any[];
}

export function getEodActivitiesByRange(from: string, to: string, assistantId: number): any[] {
  return sqlite.prepare(`SELECT * FROM eod_activities WHERE report_date>=? AND report_date<=? AND assistant_id=? ORDER BY report_date ASC, id ASC`).all(from, to, assistantId) as any[];
}

export function addEodActivity(data: { reportDate: string; assistantId: number; activityType: string; description: string }): any {
  const result = sqlite.prepare(`
    INSERT INTO eod_activities (report_date, assistant_id, activity_type, description)
    VALUES (?, ?, ?, ?)
  `).run(data.reportDate, data.assistantId, data.activityType, data.description);
  return sqlite.prepare(`SELECT * FROM eod_activities WHERE id=?`).get(result.lastInsertRowid) as any;
}

export function deleteEodActivity(id: number): void {
  sqlite.prepare(`DELETE FROM eod_activities WHERE id=?`).run(id);
}

export function getEodReportsByRange(from: string, to: string): any[] {
  const reports = sqlite.prepare(`SELECT * FROM eod_reports WHERE report_date>=? AND report_date<=? ORDER BY report_date DESC`).all(from, to) as any[];
  const users = sqlite.prepare(`SELECT id, name FROM users`).all() as any[];
  return reports.map(r => ({ ...r, assistant: users.find(u => u.id === r.assistant_id) }));
}

// ── Call Scripts ──────────────────────────────────────────────────────────────
// Tables created inline here (no Drizzle schema needed for this feature)
try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS call_scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      owner_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS script_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id INTEGER NOT NULL REFERENCES call_scripts(id) ON DELETE CASCADE,
      parent_node_id INTEGER REFERENCES script_nodes(id) ON DELETE CASCADE,
      parent_response_id INTEGER,
      text TEXT NOT NULL,
      hint TEXT,
      node_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS script_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id INTEGER NOT NULL REFERENCES script_nodes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'default',
      next_node_id INTEGER REFERENCES script_nodes(id) ON DELETE SET NULL,
      response_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch {}

// Seed Ethan's real WCL script — runs once via migrations_applied table
function seedEthanScript() {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'ethan_wcl_script_v1'`).get();
  if (done) return;

  // Wipe any old placeholder script
  sqlite.exec(`DELETE FROM script_responses; DELETE FROM script_nodes; DELETE FROM call_scripts;`);

  const node = (scriptId: number, parentId: number | null, text: string, hint: string, order: number) =>
    sqlite.prepare(`INSERT INTO script_nodes (script_id, parent_node_id, text, hint, node_order) VALUES (?,?,?,?,?)`)
      .run(scriptId, parentId, text, hint, order).lastInsertRowid as number;

  const resp = (nodeId: number, label: string, color: string, nextId: number | null, order: number) =>
    sqlite.prepare(`INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?,?,?,?,?)`)
      .run(nodeId, label, color, nextId, order);

  // ── Script ────────────────────────────────────────────────────────────────
  const sid = sqlite.prepare(`INSERT INTO call_scripts (name, description, created_by) VALUES (?,?,?)`)
    .run("WCL Cold Call Script", "Ethan's official West Capital Lending call script — refi/HELOC leads.", 1)
    .lastInsertRowid as number;

  // ── OPENING ───────────────────────────────────────────────────────────────
  const nOpen = node(sid, null,
    `Hi [Their Name], how are you doing this [morning/afternoon/evening]? Great to hear! So, this is [Your Name] with West Capital Lending. I saw that you recently inquired about a refinance or Home Equity Line of Credit, and I wanted to see what you were hoping to accomplish and present some options to you.`,
    `Memo: Ethan, West Capital Lending, reaching out about home equity loan or refinance options. Speak warmly — pause after their name.`,
    1);

  // ── QUALIFYING QUESTIONS ──────────────────────────────────────────────────
  const nQual = node(sid, nOpen,
    `Great! I have a few quick questions to point you in the right direction:\n\n1. What are your goals? (type of loan — refi or HELOC?)\n2. Can I confirm your address?\n3. Do you know what your home is currently worth?\n4. What's your current loan balance and interest rate?\n5. What type of loan do you have? (Fixed, FHA, VA?)\n\nOptional: Do you own other properties? Estimated credit score? Employment status? Ballpark annual income?`,
    `Work through these conversationally — don't fire them as a list. HELOC: also ask how much they want to pull out.`,
    1);

  // ── TRANSFER (qualified) ──────────────────────────────────────────────────
  const nTransfer = node(sid, nQual,
    `Awesome! So I don't have that many connections in the state of [State], but our equity specialist [LO Name] has over 150 connections in that state — I'm going to pass the phone over to them. Give me a few seconds.\n\nOR: I've got everything I need. I'm actually [LO]'s assistant calling from their number — I won't even put you on hold, I have them right next to me. I'm going to hand the phone over now. It was great speaking with you — good luck!`,
    `This is the transfer moment. Be confident and warm. Log in Bonzo immediately after.`,
    1);

  // ── NOT QUITE READY ───────────────────────────────────────────────────────
  const nNotReady = node(sid, nQual,
    `I totally understand that you're not ready. I will say — what we do here at West Cap is keep you informed until you are ready. What's keeping you from making the next step?`,
    `Empathize first. Then dig into the real reason.`,
    2);

  const nLowerRate = node(sid, nNotReady,
    `I totally get how hard it is to keep up with rates. Here at West Capital, we partner with over 150 lenders to help keep you informed so you can get the best possible deal when you're ready. I'd love to get that done for you today — would you mind if we keep some of your information so we can help when the timing is right?`,
    `Rate objection — pivot to value and future follow-up.`,
    1);

  // ── ALREADY HANDLED ──────────────────────────────────────────────────────
  const nAlready = node(sid, nOpen,
    `I completely understand. I do want to make sure that you get the best rate — if you want, we can send it over to our pricing team and see what they can do. We typically reach out to over 50 lenders and can beat local rates by up to a full percentage point. OR: Great! Here at West Cap we often beat local lenders by 1–2 percentage points. Did you happen to get a good rate?`,
    `Don't give up — pivot to rate comparison.`,
    2);

  // ── OBJECTION: NOT MY BUSINESS ───────────────────────────────────────────
  const nPrivacy = node(sid, nOpen,
    `Totally respect that! Your personal business is yours. My goal is just to make sure your finances are protected and you're saving as much as possible — that's why I need a bit more info. Does that make sense?\n\nOR: Dang, I'm sorry — has everyone been blowing you up recently? [pause] Did you go through LendingTree or one of those calculators? I totally understand. Well, what can I do to actually help you today?`,
    `Pivot quickly — reframe privacy as protection, not intrusion.`,
    3);

  // ── GOING INTO SURGERY ───────────────────────────────────────────────────
  const nSurgery = node(sid, nOpen,
    `Wow — I hope it goes well! I'd really love to help you when you're feeling better. When would be the best time to call you back?`,
    `Be human. Get a specific callback date.`,
    4);

  // ── I'M BUSY ─────────────────────────────────────────────────────────────
  const nBusy = node(sid, nOpen,
    `I completely understand — I know you're busy and probably getting a lot of calls. I believe I have some information that can genuinely help you though. When would be a good time to reach back out?`,
    `Don't push. Get a specific time and move on.`,
    5);

  // ── F*** YOU / GET OFF MY PHONE ──────────────────────────────────────────
  const nAngry = node(sid, nOpen,
    `Hello! Please put the pistols away — the duel is tomorrow! The reason I called is that I'd like a quick discussion about the mortgage inquiry you submitted. I'll be brief and to the point — sound fair enough?`,
    `Disarm with humor. Then immediately pivot back to the script.`,
    6);

  const nHoldingOff = node(sid, nAngry,
    `No problem at all. Out of curiosity — what would need to change for you to move forward? That helps me tailor the best option for when the timing is right.`,
    `Highly variable — think on your feet and try to get back on script.`,
    1);

  // ── NO BUSINESS OVER PHONE ───────────────────────────────────────────────
  const nNoPhone = node(sid, nOpen,
    `Hey, I totally understand — trust is built and earned, not given. My goal is to give you as much value as possible via a brief conversation. What we save by not having a branch in your town, we pass directly on to you. We may not be able to hand you a cup of coffee, but as a top brokerage firm, we can get you the best rate.`,
    `Reframe phone = savings. Emphasize WCL value: 0.5–1% lower fees on avg, 100+ lenders, personalized broker match.`,
    7);

  // ── RATES TOO HIGH ───────────────────────────────────────────────────────
  const nHighRates = node(sid, nOpen,
    `I hear you — rates have been tough. Here's what makes us different at West Capital Lending:\n• 0.5–1% lower fees on average\n• Thousands lower in fees on average\n• One of the biggest brokerages in America\n• 100+ lenders — we leverage those relationships to get you the best deal\n• Quick 2-minute call to confirm a few details before we match you with the right broker`,
    `Lead with facts. Then pivot: "Let me take 2 minutes and see what we can find for you."`,
    8);

  // ── NO RESPONSE / THERE BUT SILENT ──────────────────────────────────────
  const nSilent = node(sid, nOpen,
    `Hey [Name], I noticed you're looking for a home equity loan or refinancing options — it could really help you out. Can I give you some options or answer any questions?`,
    `Simple, direct. Wait for any response before continuing.`,
    9);

  // ── VOICEMAIL / CALLBACK ─────────────────────────────────────────────────
  const nVoicemail = node(sid, nOpen,
    `Voicemail: "Hello, this is [Your Name], [LO]'s assistant from West Capital Lending. We recently received an inquiry about a home equity loan or refinance. We work with over 150 lenders to best help your needs. To reach back out, please call us at [Phone Number]."\n\nCallback: "Hey, this is [Your Name] from West Capital Lending — we're responding to your inquiry for home finance options. I happen to be on another line at the moment — give me a minute and I'll call you back."`,
    `Leave voicemail only if no answer after 2 attempts. Log in Bonzo.`,
    10);

  // ── OLD LEADS ────────────────────────────────────────────────────────────
  const nOldLead = node(sid, nOpen,
    `Hey [Name], my name is [Your Name] from West Capital Lending — we're one of the biggest mortgage brokerages in the country. We saw that you inquired about pulling some money out of your home a few months back, and wanted to chat.`,
    `Use this opening for leads 60+ days old.`,
    11);

  // ── RESPONSES ────────────────────────────────────────────────────────────

  // Opening responses
  resp(nOpen, "Yes, go ahead", "green", nQual, 1);
  resp(nOpen, "Not interested / Already taken care of", "red", nAlready, 2);
  resp(nOpen, "None of your business / Too pushy", "yellow", nPrivacy, 3);
  resp(nOpen, "Going into surgery", "yellow", nSurgery, 4);
  resp(nOpen, "I'm busy", "yellow", nBusy, 5);
  resp(nOpen, "F*** you / Get off my phone", "red", nAngry, 6);
  resp(nOpen, "Don't do business over phone", "yellow", nNoPhone, 7);
  resp(nOpen, "Rates are too high", "yellow", nHighRates, 8);
  resp(nOpen, "No response / Silent", "gray", nSilent, 9);
  resp(nOpen, "No answer — leaving voicemail", "gray", nVoicemail, 10);
  resp(nOpen, "Old lead (60+ days)", "blue", nOldLead, 11);

  // Qualifying responses
  resp(nQual, "Ready to transfer!", "green", nTransfer, 1);
  resp(nQual, "Not quite ready yet", "yellow", nNotReady, 2);

  // Not ready → lower rate
  resp(nNotReady, "Waiting for lower rates", "yellow", nLowerRate, 1);
  resp(nNotReady, "Other reason", "yellow", null, 2);

  // Transfer confirmed
  resp(nTransfer, "Transfer complete!", "green", null, 1);
  resp(nTransfer, "Changed mind", "red", nNotReady, 2);

  // Already taken care of
  resp(nAlready, "Still interested in better rate", "green", nQual, 1);
  resp(nAlready, "No thanks", "red", null, 2);

  // Angry → holding off
  resp(nAngry, "Calmed down / Willing to listen", "green", nQual, 1);
  resp(nAngry, "Still holding off", "yellow", nHoldingOff, 2);
  resp(nAngry, "Hung up", "gray", null, 3);

  sqlite.prepare(`INSERT INTO migrations_applied (name, applied_at) VALUES (?, datetime('now'))`)
    .run('ethan_wcl_script_v1');
}
seedEthanScript();

// Add owner_id column to existing DBs that don't have it
try { sqlite.exec(`ALTER TABLE call_scripts ADD COLUMN owner_id INTEGER DEFAULT NULL`); } catch {}

// Expose sqlite for direct queries in routes
export function getSqlite() { return sqlite; }

export function getCallScripts(): any[] {
  return sqlite.prepare(`SELECT * FROM call_scripts ORDER BY created_at DESC`).all() as any[];
}

// Get default (global) scripts — those with owner_id IS NULL
export function getDefaultScripts(): any[] {
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE owner_id IS NULL AND is_active=1 ORDER BY created_at ASC`).all() as any[];
}

// Get personal script for a user (copy of default, owner_id = userId)
export function getUserScript(userId: number): any {
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE owner_id=? LIMIT 1`).get(userId) as any;
}

// Deep-clone a script (all nodes + responses) for a specific user
export function cloneScriptForUser(sourceScriptId: number, userId: number): any {
  const source = sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(sourceScriptId) as any;
  if (!source) return null;

  // Check if user already has a personal copy — delete it first
  const existing = sqlite.prepare(`SELECT id FROM call_scripts WHERE owner_id=?`).get(userId) as any;
  if (existing) {
    sqlite.prepare(`DELETE FROM call_scripts WHERE id=?`).run(existing.id);
  }

  // Create new script owned by user
  const newScript = sqlite.prepare(
    `INSERT INTO call_scripts (name, description, is_active, created_by, owner_id) VALUES (?,?,1,?,?)`
  ).run(source.name, source.description, userId, userId);
  const newScriptId = newScript.lastInsertRowid as number;

  // Clone nodes — need to map old IDs to new IDs
  const oldNodes = sqlite.prepare(`SELECT * FROM script_nodes WHERE script_id=? ORDER BY id ASC`).all(sourceScriptId) as any[];
  const nodeIdMap = new Map<number, number>(); // old -> new

  // First pass: insert all nodes (without parent references)
  for (const n of oldNodes) {
    const r = sqlite.prepare(
      `INSERT INTO script_nodes (script_id, text, hint, node_order) VALUES (?,?,?,?)`
    ).run(newScriptId, n.text, n.hint, n.node_order);
    nodeIdMap.set(n.id, r.lastInsertRowid as number);
  }

  // Second pass: update parent_node_id using the map
  for (const n of oldNodes) {
    if (n.parent_node_id != null) {
      const newNodeId = nodeIdMap.get(n.id);
      const newParentId = nodeIdMap.get(n.parent_node_id);
      if (newNodeId && newParentId) {
        sqlite.prepare(`UPDATE script_nodes SET parent_node_id=? WHERE id=?`).run(newParentId, newNodeId);
      }
    }
  }

  // Clone responses — remap node_id and next_node_id
  const oldResponses = sqlite.prepare(
    `SELECT sr.* FROM script_responses sr JOIN script_nodes sn ON sr.node_id=sn.id WHERE sn.script_id=? ORDER BY sr.id ASC`
  ).all(sourceScriptId) as any[];

  for (const r of oldResponses) {
    const newNodeId = nodeIdMap.get(r.node_id);
    const newNextId = r.next_node_id != null ? (nodeIdMap.get(r.next_node_id) ?? null) : null;
    if (newNodeId) {
      sqlite.prepare(
        `INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?,?,?,?,?)`
      ).run(newNodeId, r.label, r.color, newNextId, r.response_order);
    }
  }

  return sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(newScriptId);
}
export function getCallScript(id: number): any {
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(id) as any;
}
export function createCallScript(data: { name: string; description?: string; createdBy?: number }): any {
  const r = sqlite.prepare(`INSERT INTO call_scripts (name, description, created_by) VALUES (?,?,?)`).run(data.name, data.description ?? null, data.createdBy ?? null);
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(r.lastInsertRowid);
}
export function updateCallScript(id: number, data: { name?: string; description?: string; isActive?: boolean }): any {
  if (data.name !== undefined) sqlite.prepare(`UPDATE call_scripts SET name=?, updated_at=datetime('now') WHERE id=?`).run(data.name, id);
  if (data.description !== undefined) sqlite.prepare(`UPDATE call_scripts SET description=?, updated_at=datetime('now') WHERE id=?`).run(data.description, id);
  if (data.isActive !== undefined) sqlite.prepare(`UPDATE call_scripts SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(data.isActive ? 1 : 0, id);
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(id);
}
export function deleteCallScript(id: number): void {
  sqlite.prepare(`DELETE FROM call_scripts WHERE id=?`).run(id);
}
export function getScriptNodes(scriptId: number): any[] {
  return sqlite.prepare(`SELECT * FROM script_nodes WHERE script_id=? ORDER BY node_order ASC`).all(scriptId) as any[];
}
export function getRootNode(scriptId: number): any {
  return sqlite.prepare(`SELECT * FROM script_nodes WHERE script_id=? AND parent_node_id IS NULL ORDER BY node_order ASC LIMIT 1`).get(scriptId) as any;
}
export function getNodeResponses(nodeId: number): any[] {
  return sqlite.prepare(`SELECT * FROM script_responses WHERE node_id=? ORDER BY response_order ASC`).all(nodeId) as any[];
}
export function getNodeById(id: number): any {
  return sqlite.prepare(`SELECT * FROM script_nodes WHERE id=?`).get(id) as any;
}
export function createScriptNode(data: { scriptId: number; parentNodeId?: number | null; parentResponseId?: number | null; text: string; hint?: string; nodeOrder?: number }): any {
  const r = sqlite.prepare(`INSERT INTO script_nodes (script_id, parent_node_id, parent_response_id, text, hint, node_order) VALUES (?,?,?,?,?,?)`).run(
    data.scriptId, data.parentNodeId ?? null, data.parentResponseId ?? null, data.text, data.hint ?? null, data.nodeOrder ?? 0
  );
  return sqlite.prepare(`SELECT * FROM script_nodes WHERE id=?`).get(r.lastInsertRowid);
}
export function updateScriptNode(id: number, data: { text?: string; hint?: string }): any {
  if (data.text !== undefined) sqlite.prepare(`UPDATE script_nodes SET text=? WHERE id=?`).run(data.text, id);
  if (data.hint !== undefined) sqlite.prepare(`UPDATE script_nodes SET hint=? WHERE id=?`).run(data.hint, id);
  return sqlite.prepare(`SELECT * FROM script_nodes WHERE id=?`).get(id);
}
export function deleteScriptNode(id: number): void {
  sqlite.prepare(`DELETE FROM script_nodes WHERE id=?`).run(id);
}
export function createScriptResponse(data: { nodeId: number; label: string; color?: string; nextNodeId?: number | null; responseOrder?: number }): any {
  const r = sqlite.prepare(`INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?,?,?,?,?)`).run(
    data.nodeId, data.label, data.color ?? 'default', data.nextNodeId ?? null, data.responseOrder ?? 0
  );
  return sqlite.prepare(`SELECT * FROM script_responses WHERE id=?`).get(r.lastInsertRowid);
}
export function updateScriptResponse(id: number, data: { label?: string; color?: string; nextNodeId?: number | null; responseOrder?: number }): any {
  if (data.label !== undefined) sqlite.prepare(`UPDATE script_responses SET label=? WHERE id=?`).run(data.label, id);
  if (data.color !== undefined) sqlite.prepare(`UPDATE script_responses SET color=? WHERE id=?`).run(data.color, id);
  if (data.nextNodeId !== undefined) sqlite.prepare(`UPDATE script_responses SET next_node_id=? WHERE id=?`).run(data.nextNodeId, id);
  if (data.responseOrder !== undefined) sqlite.prepare(`UPDATE script_responses SET response_order=? WHERE id=?`).run(data.responseOrder, id);
  return sqlite.prepare(`SELECT * FROM script_responses WHERE id=?`).get(id);
}
export function deleteScriptResponse(id: number): void {
  sqlite.prepare(`DELETE FROM script_responses WHERE id=?`).run(id);
}

// Get the owning script for a response (for permission checks)
export function getScriptByResponseId(responseId: number): any {
  return sqlite.prepare(
    `SELECT cs.* FROM script_responses sr JOIN script_nodes sn ON sr.node_id=sn.id JOIN call_scripts cs ON sn.script_id=cs.id WHERE sr.id=?`
  ).get(responseId) as any;
}
export function getFullScriptTree(scriptId: number): any {
  const script = getCallScript(scriptId);
  if (!script) return null;
  const nodes = getScriptNodes(scriptId);
  const allResponses = nodes.flatMap(n => getNodeResponses(n.id));
  return { ...script, nodes, responses: allResponses };
}