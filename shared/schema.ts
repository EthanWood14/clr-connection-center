import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Users ──────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("assistant"), // admin | assistant | viewer
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Loan Officers ──────────────────────────────────────────────────────────────
export const loanOfficers = sqliteTable("loan_officers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull(),
  nmlsId: text("nmls_id").notNull().unique(),
  phone: text("phone"),
  email: text("email"),
  licensedStates: text("licensed_states").notNull().default("[]"), // JSON array
  bonzoUsername: text("bonzo_username"),
  bonzoPassword: text("bonzo_password"),
  leadMailboxUsername: text("lead_mailbox_username"),
  leadMailboxPassword: text("lead_mailbox_password"),
  otherCredentials: text("other_credentials").notNull().default("{}"), // JSON object
  notes: text("notes"),
  specialRequests: text("special_requests"),
  tags: text("tags").notNull().default("[]"), // JSON array
  internalStatus: text("internal_status").notNull().default("active"), // active | inactive | archived
  boostScore: real("boost_score").notNull().default(0), // 0-10
  priorityTier: integer("priority_tier").notNull().default(2), // 1=VIP, 2=Standard, 3=Low
  snoozeUntil: text("snooze_until"), // ISO date string or null
  snoozeReason: text("snooze_reason"),
  lastWorkedDate: text("last_worked_date"),
  totalTimesWorked: integer("total_times_worked").notNull().default(0),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const insertLoanOfficerSchema = createInsertSchema(loanOfficers).omit({
  id: true, createdAt: true, updatedAt: true, totalTimesWorked: true,
});
export type InsertLoanOfficer = z.infer<typeof insertLoanOfficerSchema>;
export type LoanOfficer = typeof loanOfficers.$inferSelect;

// ── LO Availability (recurring weekly) ────────────────────────────────────────
export const loAvailability = sqliteTable("lo_availability", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loId: integer("lo_id").notNull().references(() => loanOfficers.id),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun, 1=Mon ... 6=Sat
  isAvailable: integer("is_available", { mode: "boolean" }).notNull().default(true),
});

export const insertLoAvailabilitySchema = createInsertSchema(loAvailability).omit({ id: true });
export type InsertLoAvailability = z.infer<typeof insertLoAvailabilitySchema>;
export type LoAvailability = typeof loAvailability.$inferSelect;

// ── Daily Assignments ──────────────────────────────────────────────────────────
export const dailyAssignments = sqliteTable("daily_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentDate: text("assignment_date").notNull(), // YYYY-MM-DD
  loId: integer("lo_id").notNull().references(() => loanOfficers.id),
  assistantId: integer("assistant_id").notNull().references(() => users.id),
  globalRank: integer("global_rank").notNull(),
  assistantRank: integer("assistant_rank").notNull(),
  status: text("status").notNull().default("recommended"), // recommended | worked | skipped | attempted | manual
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertDailyAssignmentSchema = createInsertSchema(dailyAssignments).omit({ id: true, createdAt: true });
export type InsertDailyAssignment = z.infer<typeof insertDailyAssignmentSchema>;
export type DailyAssignment = typeof dailyAssignments.$inferSelect;

// ── Lead Outcomes ──────────────────────────────────────────────────────────────
export const OUTCOME_TYPES = [
  "transfer", "appointment", "fell_through",
  "no_answer", "callback_requested", "not_interested",
  "wrong_number", "other"
] as const;

// ── Daily Call Logs ──────────────────────────────────────────────────────────────

export type OutcomeType = typeof OUTCOME_TYPES[number];

export const leadOutcomes = sqliteTable("lead_outcomes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  assistantId: integer("assistant_id").notNull().references(() => users.id),
  loId: integer("lo_id").notNull().references(() => loanOfficers.id),
  borrowerName: text("borrower_name"),
  outcomeType: text("outcome_type").notNull(),
  journeyId: text("journey_id"),
  notes: text("notes"),
  followUpDate: text("follow_up_date"),
  tags: text("tags").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const insertLeadOutcomeSchema = createInsertSchema(leadOutcomes).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertLeadOutcome = z.infer<typeof insertLeadOutcomeSchema>;
export type LeadOutcome = typeof leadOutcomes.$inferSelect;

export const dailyCallLogs = sqliteTable("daily_call_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  logDate: text("log_date").notNull(),       // YYYY-MM-DD
  assistantId: integer("assistant_id").notNull().references(() => users.id),
  callsMade: integer("calls_made").notNull().default(0),
  notes: text("notes"),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const insertDailyCallLogSchema = createInsertSchema(dailyCallLogs).omit({ id: true, updatedAt: true });
export type InsertDailyCallLog = z.infer<typeof insertDailyCallLogSchema>;
export type DailyCallLog = typeof dailyCallLogs.$inferSelect;

// ── Notifications ──────────────────────────────────────────────────────────────
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"), // null = broadcast to all
  type: text("type").notNull(), // license_alert | assignment_ready | eod_reminder | follow_up | announcement
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ── Algorithm Settings ─────────────────────────────────────────────────────────
export const algorithmSettings = sqliteTable("algorithm_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weightDaysSinceWorked: real("weight_days_since_worked").notNull().default(0.35),
  weightFrequency: real("weight_frequency").notNull().default(0.25),
  weightAvailability: real("weight_availability").notNull().default(0.20),
  weightBoost: real("weight_boost").notNull().default(0.15),
  weightPriorityTier: real("weight_priority_tier").notNull().default(0.05),
  maxLosPerAssistant: integer("max_los_per_assistant").notNull().default(5),
  roundRobinEnabled: integer("round_robin_enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const insertAlgorithmSettingsSchema = createInsertSchema(algorithmSettings).omit({ id: true, updatedAt: true });
export type InsertAlgorithmSettings = z.infer<typeof insertAlgorithmSettingsSchema>;
export type AlgorithmSettings = typeof algorithmSettings.$inferSelect;

// ── Audit Logs ─────────────────────────────────────────────────────────────────
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),             // who did it (null = system)
  userName: text("user_name"),            // denormalized name for display
  action: text("action").notNull(),       // "create" | "update" | "delete" | "login" | "generate"
  entityType: text("entity_type").notNull(), // "loan_officer" | "assignment" | "outcome" | "user" | "settings" | "auth"
  entityId: integer("entity_id"),         // ID of the affected record
  entityLabel: text("entity_label"),      // human-readable description e.g. "Robert Chen"
  details: text("details"),              // JSON string with before/after or context
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
