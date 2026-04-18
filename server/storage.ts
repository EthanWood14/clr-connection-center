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
    weight_days_since_worked REAL NOT NULL DEFAULT 0.35,
    weight_frequency REAL NOT NULL DEFAULT 0.25,
    weight_availability REAL NOT NULL DEFAULT 0.20,
    weight_boost REAL NOT NULL DEFAULT 0.15,
    weight_priority_tier REAL NOT NULL DEFAULT 0.05,
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

const existingSettings = db.select().from(algorithmSettings).all();
if (existingSettings.length === 0) {
  db.insert(algorithmSettings).values({
    weightDaysSinceWorked: 0.35,
    weightFrequency: 0.25,
    weightAvailability: 0.20,
    weightBoost: 0.15,
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
    return db.select().from(algorithmSettings).get()!;
  }
  updateAlgorithmSettings(data: Partial<InsertAlgorithmSettings>) {
    const existing = db.select().from(algorithmSettings).get();
    if (existing) {
      return db.update(algorithmSettings).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(algorithmSettings.id, existing.id)).returning().get()!;
    }
    return db.insert(algorithmSettings).values({ ...data as any, updatedAt: new Date().toISOString() }).returning().get()!;
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

    return { total, transfers, appointments, fellThrough, noAnswer, conversionRate, outcomesByType };
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
    const defaultManagers = JSON.stringify(["credoble@westcapitallending.com", "spetries@westcapitallending.com"]);
    sqlite.exec(`UPDATE email_settings SET manager_emails='${defaultManagers}' WHERE id=1`);
  }

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

  // has_seen_intro migration
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN has_seen_intro INTEGER NOT NULL DEFAULT 0`); } catch {}
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
  sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}
