import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Organizations (multi-tenancy) ──────────────────────────────────────────────
export const organizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  companyName: text("company_name").notNull(),
  resendApiKey: text("resend_api_key"),
  fromEmail: text("from_email"),
  managerEmails: text("manager_emails"),
  plan: text("plan").notNull().default("trial"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type Organization = typeof organizations.$inferSelect;

export const inviteTokens = sqliteTable("invite_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  orgId: integer("org_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("clr"),
  used: integer("used").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type InviteToken = typeof inviteTokens.$inferSelect;

// ── Users ──────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("assistant"), // admin | assistant | viewer
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  isClr: integer("is_clr", { mode: "boolean" }).notNull().default(true), // admins: true = also a CLR, included in assignments
  // false = skip this CLR in daily assignment generation (auto-generate, regenerate,
  // monthly shuffle). They remain a CLR everywhere else: EODs, dashboards,
  // leaderboard, reports, manual reassign/pre-configure targets.
  inDailyAssignments: integer("in_daily_assignments", { mode: "boolean" }).notNull().default(true),
  // Non-counted CLR: still uses the app (logs outcomes, EODs) but is excluded
  // from team/total stats, the leaderboard, and daily assignment generation.
  // In reports they appear as a separate "Non-counted" group, not in the totals.
  excludeFromStats: integer("exclude_from_stats", { mode: "boolean" }).notNull().default(false),
  hasSeenIntro: integer("has_seen_intro", { mode: "boolean" }).notNull().default(false),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  isManager: integer("is_manager", { mode: "boolean" }).notNull().default(false),
  hasDismissedSample: integer("has_dismissed_sample", { mode: "boolean" }).notNull().default(false),
  // ISO timestamp of when the CLR last dismissed the pipeline-stages popup.
  // The popup re-appears 14 days after this; null/empty = never seen yet.
  lastSeenPipelineSop: text("last_seen_pipeline_sop"),
  goalCallsWeekly: integer("goal_calls_weekly").notNull().default(0),
  goalTransfersWeekly: integer("goal_transfers_weekly").notNull().default(0),
  goalAppointmentsWeekly: integer("goal_appointments_weekly").notNull().default(0),
  phone: text("phone"),
  scriptCompanyName: text("script_company_name"),
  scriptNameOverride: text("script_name_override"),
  scriptLoOverride: text("script_lo_override"),
  superAdmin: integer("super_admin", { mode: "boolean" }).notNull().default(false),
  smsRemindersEnabled: integer("sms_reminders_enabled", { mode: "boolean" }).notNull().default(false),
  muteChatNotifications: integer("mute_chat_notifications", { mode: "boolean" }).notNull().default(false),
  muteForumNotifications: integer("mute_forum_notifications", { mode: "boolean" }).notNull().default(false),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  orgId: integer("org_id").notNull().default(1),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── CLR Goals (per-user weekly goals set by admins) ───────────────────────────
export const clrGoals = sqliteTable("clr_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  orgId: integer("org_id").notNull().default(1),
  callsGoal: integer("calls_goal").notNull().default(0),
  transfersGoal: integer("transfers_goal").notNull().default(0),
  appointmentsGoal: integer("appointments_goal").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});
export type ClrGoal = typeof clrGoals.$inferSelect;

// ── Loan Officers ──────────────────────────────────────────────────────────────
export const loanOfficers = sqliteTable("loan_officers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull(),
  nmlsId: text("nmls_id").unique(),
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
  personalPreferences: text("personal_preferences"),
  tags: text("tags").notNull().default("[]"), // JSON array
  internalStatus: text("internal_status").notNull().default("active"), // active | inactive | archived
  boostScore: real("boost_score").notNull().default(0), // 0-10
  priorityTier: integer("priority_tier").notNull().default(2), // 1=VIP, 2=Standard, 3=Low
  // When true, the assignment algorithm quarters this LO's score — they get
  // picked far less often but are never fully removed from the rotation.
  reducedOdds: integer("reduced_odds", { mode: "boolean" }).notNull().default(false),
  snoozeUntil: text("snooze_until"), // ISO date string or null
  snoozeReason: text("snooze_reason"),
  lastWorkedDate: text("last_worked_date"),
  totalTimesWorked: integer("total_times_worked").notNull().default(0),
  nmlsStatus: text("nmls_status"), // Active | Inactive | Expired | Unknown | null
  nmlsStates: text("nmls_states").notNull().default("[]"), // JSON array of state codes
  nmlsLastChecked: text("nmls_last_checked"), // ISO date string
  nmlsLicenseExpiration: text("nmls_license_expiration"),
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
  timeSlot: text("time_slot").notNull().default("all"), // "all" | "morning" | "afternoon"
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
  "no_answer", "callback_requested", "deferral", "future_contact",
  "not_interested", "wrong_number", "other"
] as const;

// ── Daily Call Logs ──────────────────────────────────────────────────────────────

export type OutcomeType = typeof OUTCOME_TYPES[number];

export const loanOfficerAssistants = sqliteTable("loan_officer_assistants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loId: integer("lo_id").notNull().references(() => loanOfficers.id),
  fullName: text("full_name").notNull(),
  active: integer("active").default(1),
  createdAt: text("created_at"),
});

export const leadOutcomes = sqliteTable("lead_outcomes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  assistantId: integer("assistant_id").notNull().references(() => users.id),
  loId: integer("lo_id").notNull().references(() => loanOfficers.id),
  loaId: integer("loa_id").references(() => loanOfficerAssistants.id),
  borrowerName: text("borrower_name"),
  outcomeType: text("outcome_type").notNull(),
  transferType: text("transfer_type"), // 'direct' | 'appointment' | null (required when outcomeType='transfer')
  bulkTexter: integer("bulk_texter"), // 1/0/null — whether Bulk Texter was part of the transfer
  journeyId: text("journey_id"),
  phoneNumber: text("phone_number"),
  notes: text("notes"),
  followUpDate: text("follow_up_date"),
  tags: text("tags").notNull().default("[]"),
  // Transfer wizard fields — only populated for transfer outcomes, all nullable
  conversationNotes: text("conversation_notes"),
  loActionPlan: text("lo_action_plan"),
  leadTimeframe: text("lead_timeframe"),
  requiresFollowup: integer("requires_followup"),
  followupReason: text("followup_reason"),
  followupDate: text("followup_date"),
  leadType: text("lead_type"), // 'appointment_transfer' | 'missed_appointment'
  appointmentDatetime: text("appointment_datetime"),
  leadGoal: text("lead_goal"),
  prequalificationNotes: text("prequalification_notes"),
  missedReason: text("missed_reason"),
  rescheduled: integer("rescheduled"),
  rescheduleDatetime: text("reschedule_datetime"),
  nextSteps: text("next_steps"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const insertLeadOutcomeSchema = createInsertSchema(leadOutcomes).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertLoanOfficerAssistantSchema = createInsertSchema(loanOfficerAssistants).omit({
  id: true, createdAt: true,
});
export type InsertLeadOutcome = z.infer<typeof insertLeadOutcomeSchema>;
export type LeadOutcome = typeof leadOutcomes.$inferSelect;
export type LoanOfficerAssistant = typeof loanOfficerAssistants.$inferSelect;
export type InsertLoanOfficerAssistant = z.infer<typeof insertLoanOfficerAssistantSchema>;

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
  weightDaysSinceWorked: real("weight_days_since_worked").notNull().default(0.30),
  weightFrequency: real("weight_frequency").notNull().default(0.25),
  weightAvailability: real("weight_availability").notNull().default(0.20),
  weightBoost: real("weight_boost").notNull().default(0.10),
  weightPriorityTier: real("weight_priority_tier").notNull().default(0.05),
  // weightRecentTransfers added via migration — NOT in Drizzle schema to avoid startup crash on existing DBs
  maxLosPerAssistant: integer("max_los_per_assistant").notNull().default(5),
  roundRobinEnabled: integer("round_robin_enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const insertAlgorithmSettingsSchema = createInsertSchema(algorithmSettings).omit({ id: true, updatedAt: true });
export type InsertAlgorithmSettings = z.infer<typeof insertAlgorithmSettingsSchema> & { weightRecentTransfers?: number };
export type AlgorithmSettings = typeof algorithmSettings.$inferSelect & { weightRecentTransfers: number };

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

// ── Email Report Settings ──────────────────────────────────────────────────────
export const emailSettings = sqliteTable("email_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  smtpHost: text("smtp_host").notNull().default(""),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpUser: text("smtp_user").notNull().default(""),
  smtpPass: text("smtp_pass").notNull().default(""),
  fromAddress: text("from_address").notNull().default(""),
  managerEmails: text("manager_emails").notNull().default("[]"), // JSON array
  dailyEnabled: integer("daily_enabled", { mode: "boolean" }).notNull().default(false),
  weeklyEnabled: integer("weekly_enabled", { mode: "boolean" }).notNull().default(false),
  monthlyEnabled: integer("monthly_enabled", { mode: "boolean" }).notNull().default(false),
  dailyTime: text("daily_time").notNull().default("08:00"),   // HH:MM
  weeklyDay: integer("weekly_day").notNull().default(1),       // 0=Sun..6=Sat
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});
export type EmailSettings = typeof emailSettings.$inferSelect;

// ── Fixed Monthly Assignments ──────────────────────────────────────────────────
// When round-robin is disabled, each CLR keeps the same LOs for a month.
// Admin clicks "Shuffle" to regenerate for the next month.
export const monthlyAssignments = sqliteTable("monthly_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monthKey: text("month_key").notNull(),   // e.g. "2026-04"
  assistantId: integer("assistant_id").notNull().references(() => users.id),
  loId: integer("lo_id").notNull().references(() => loanOfficers.id),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type MonthlyAssignment = typeof monthlyAssignments.$inferSelect;

// ── Assignment Overrides (admin unlock log) ────────────────────────────────────
export const assignmentOverrides = sqliteTable("assignment_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentId: integer("assignment_id").notNull(),
  adminId: integer("admin_id").notNull().references(() => users.id),
  adminName: text("admin_name").notNull(),
  reason: text("reason").notNull(),
  signature: text("signature").notNull(),
  previousStatus: text("previous_status").notNull(),
  newStatus: text("new_status").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
export type AssignmentOverride = typeof assignmentOverrides.$inferSelect;
