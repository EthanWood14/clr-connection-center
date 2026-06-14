import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { currentOrgId } from "./orgContext";
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

// Ensure the parent directory exists before opening the SQLite database.
// On Railway, the volume should mount at /data and create the dir for us.
// If the volume isn't mounted (or hasn't been provisioned yet), better-sqlite3
// would otherwise throw "Cannot open database because the directory does not exist"
// and crash the process before any HTTP server starts — leaving the site fully down.
// Creating the dir here lets the process boot; if the volume is missing, the
// data lives only in the container until the volume is reattached.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  const parentDir = path.dirname(path.resolve(dbPath));
  if (parentDir && parentDir !== "." && !fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
    console.warn(`[storage] Created missing DB parent directory: ${parentDir} (volume may not be mounted)`);
  }
} catch (e: any) {
  console.error(`[storage] Failed to ensure DB parent dir for ${dbPath}:`, e?.message || e);
}

const sqlite = new Database(dbPath);

// ── Critical pre-Drizzle migrations ──────────────────────────────────────────
// These MUST run before `drizzle(sqlite)` prepares any statements referencing
// columns defined in the Drizzle schema. Otherwise Drizzle compiles SELECTs
// that reference columns not yet present on disk and the app crashes at
// startup with "no such column: <name>". Ensure the users table exists first,
// then add every schema-referenced column here.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'assistant',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
try { sqlite.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN has_seen_intro INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN is_clr INTEGER NOT NULL DEFAULT 1`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN in_daily_assignments INTEGER NOT NULL DEFAULT 1`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN exclude_from_stats INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN reset_token TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN reset_token_expiry INTEGER`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN is_manager INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN has_dismissed_sample INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN last_seen_pipeline_sop TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN goal_calls_weekly INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN goal_transfers_weekly INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN goal_appointments_weekly INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN phone TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN script_company_name TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN script_name_override TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN script_lo_override TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN super_admin INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN sms_reminders_enabled INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN mute_chat_notifications INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN mute_forum_notifications INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN getting_started_dismissed INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN getting_started_completed TEXT NOT NULL DEFAULT '[]'`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN archived_at TEXT`); } catch {}
// 2026-05-05: appointment reminder email opt-in. Defaults to ON for all CLRs
// so the 30-minute appointment reminder cron actually fires emails. Previously
// this column was referenced in the SELECT but never existed, so it returned
// NULL/falsy and emails were silently skipped.
try { sqlite.exec(`ALTER TABLE users ADD COLUMN reminder_email_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}
// ── Loan Officer Assistants (LOAs): assistants that belong to a parent LO ──
sqlite.exec(`CREATE TABLE IF NOT EXISTS loan_officer_assistants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lo_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
)`);
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN loa_id INTEGER`); } catch {}
// Whether Bulk Texter was part of a transfer (1/0/null). Only set on transfers.
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN bulk_texter INTEGER`); } catch {}

export const db = drizzle(sqlite);

// ── Init tables ────────────────────────────────────────────────────────────────
sqlite.exec(`

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

// ── Migration: per-CLR weekly goals ───────────────────────────────────
try { sqlite.exec(`ALTER TABLE users ADD COLUMN has_dismissed_sample INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN goal_calls_weekly INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN goal_transfers_weekly INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN goal_appointments_weekly INTEGER NOT NULL DEFAULT 0`); } catch {}

// ── Migration: CLR phone for webhook matching ──────────────────────────
try { sqlite.exec(`ALTER TABLE users ADD COLUMN phone TEXT`); } catch {}

// ── Migration: script placeholder defaults (per-user) ──────────────────
try { sqlite.exec(`ALTER TABLE users ADD COLUMN script_company_name TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN script_name_override TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN script_lo_override TEXT`); } catch {}

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
try { sqlite.exec(`ALTER TABLE lead_outcomes ADD COLUMN phone_number TEXT`); } catch {}

// ── Migration: manually_configured flag on daily_assignments ──────────
try { sqlite.exec(`ALTER TABLE daily_assignments ADD COLUMN manually_configured INTEGER NOT NULL DEFAULT 0`); } catch {}

try {
  sqlite.prepare(`UPDATE users SET is_manager = 1 WHERE LOWER(email) IN ('scott.petrie@westcapitallending.com', 'chris.redoble@westcapitallending.com')`).run();
} catch {}

// ── Backfill: parse "Scheduled: <date>" out of notes into appointment_datetime ──
// Many appointment/callback_requested outcomes were imported from EOD emails with
// the scheduled time embedded in notes as "Scheduled: Mon, May 11, 9:00 AM".
// Parse those one time so the Upcoming Appointments tab can use the typed
// appointment_datetime column for filtering and display. Idempotent: only
// touches rows where appointment_datetime is null/empty AND notes match.
try {
  const rows = sqlite.prepare(`
    SELECT id, notes FROM lead_outcomes
    WHERE outcome_type IN ('appointment', 'callback_requested')
      AND (appointment_datetime IS NULL OR appointment_datetime = '')
      AND notes LIKE '%Scheduled:%'
  `).all() as Array<{ id: number; notes: string }>;
  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  const update = sqlite.prepare(`UPDATE lead_outcomes SET appointment_datetime = ? WHERE id = ?`);
  let updated = 0;
  for (const r of rows) {
    const m = /Scheduled:\s*([^\n]+)/i.exec(r.notes || "");
    if (!m) continue;
    const raw = m[1].trim();
    // e.g. "Mon, May 11, 9:00 AM" — optional weekday, then "Mon DD, H:MM AM/PM"
    const dm = /(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(raw);
    if (!dm) continue;
    const month = MONTHS[dm[1].toLowerCase().slice(0, 3)];
    if (month === undefined) continue;
    const day = parseInt(dm[2], 10);
    let hour = parseInt(dm[3], 10);
    const minute = parseInt(dm[4], 10);
    const mer = dm[5].toUpperCase();
    if (mer === "PM" && hour < 12) hour += 12;
    if (mer === "AM" && hour === 12) hour = 0;
    const year = 2026;
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    update.run(iso, r.id);
    updated += 1;
  }
  if (updated > 0) console.log(`[migration] backfilled appointment_datetime on ${updated} lead_outcomes from notes`);
} catch (e) {
  console.error("[migration] appointment_datetime backfill failed:", e);
}

// loan_officers: relax nmls_id from NOT NULL → nullable so LOs can be added
// without a verified NMLS number yet (e.g. branch managers, pending licensees).
// The Drizzle schema already declares nmlsId as nullable; this brings the live
// table definition in sync. Idempotent: only rebuilds if NOT NULL is still set.
try {
  const tbl = sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='loan_officers'`).get() as { sql?: string } | undefined;
  if (tbl?.sql && /nmls_id\s+TEXT\s+NOT\s+NULL/i.test(tbl.sql)) {
    // Disable FK enforcement during the rebuild so child tables (lead_outcomes,
    // lo_assignments, etc.) survive the drop/rename. defer_foreign_keys checks
    // at COMMIT, but the simpler `foreign_keys = OFF` for the duration is safe
    // here because we re-INSERT every row with the same id values.
    const prevFk = (sqlite.prepare(`PRAGMA foreign_keys`).get() as any)?.foreign_keys ?? 1;
    sqlite.exec(`PRAGMA foreign_keys = OFF;`);
    sqlite.exec(`
      BEGIN;
      CREATE TABLE loan_officers__new (
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
      INSERT INTO loan_officers__new (id, full_name, nmls_id, phone, email, licensed_states, bonzo_username, bonzo_password, lead_mailbox_username, lead_mailbox_password, other_credentials, notes, special_requests, tags, internal_status, boost_score, priority_tier, snooze_until, snooze_reason, last_worked_date, total_times_worked, created_at, updated_at)
        SELECT id, full_name, nmls_id, phone, email, licensed_states, bonzo_username, bonzo_password, lead_mailbox_username, lead_mailbox_password, other_credentials, notes, special_requests, tags, internal_status, boost_score, priority_tier, snooze_until, snooze_reason, last_worked_date, total_times_worked, created_at, updated_at FROM loan_officers;
      DROP TABLE loan_officers;
      ALTER TABLE loan_officers__new RENAME TO loan_officers;
      COMMIT;
    `);
    sqlite.exec(`PRAGMA foreign_keys = ${prevFk ? "ON" : "OFF"};`);
    console.log("[migration] loan_officers.nmls_id is now nullable");
  }
} catch (e) {
  try { sqlite.exec(`ROLLBACK`); } catch {}
  try { sqlite.exec(`PRAGMA foreign_keys = ON;`); } catch {}
  console.warn("[migration] loan_officers nmls_id nullable migration skipped:", (e as Error).message);
}

// loan_officers: NMLS license verification columns
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_status TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_states TEXT NOT NULL DEFAULT '[]'`); } catch {}
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_last_checked TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN nmls_license_expiration TEXT`); } catch {}
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN reduced_odds INTEGER NOT NULL DEFAULT 0`); } catch {}
// loan_officers: free-form personal preferences (anyone can edit)
try { sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN personal_preferences TEXT`); } catch {}

// 2026-06: consolidate notes + special_requests + personal_preferences into a
// single "Notes & Requests" category, stored in the notes column. One-time
// merge that concatenates any existing text from all three (blank-line
// separated) and clears the two now-unused columns. Guarded by prefs_merged so
// it runs exactly once and never double-appends. The special_requests and
// personal_preferences columns are kept (not dropped) but no longer used.
try {
  const loCols = sqlite.prepare(`PRAGMA table_info(loan_officers)`).all() as any[];
  if (!loCols.find((c: any) => c.name === "prefs_merged")) {
    sqlite.exec(`ALTER TABLE loan_officers ADD COLUMN prefs_merged INTEGER NOT NULL DEFAULT 0`);
    const rows = sqlite.prepare(`SELECT id, notes, special_requests, personal_preferences FROM loan_officers`).all() as any[];
    const upd = sqlite.prepare(`UPDATE loan_officers SET notes=?, special_requests=NULL, personal_preferences=NULL, prefs_merged=1 WHERE id=?`);
    const tx = sqlite.transaction((list: any[]) => {
      for (const r of list) {
        const parts = [r.notes, r.special_requests, r.personal_preferences]
          .map((p: any) => (typeof p === "string" ? p.trim() : ""))
          .filter((p: string) => p.length > 0);
        // De-dupe identical blocks (e.g. same text copied across fields)
        const seen = new Set<string>();
        const merged = parts.filter((p) => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).join("\n\n");
        upd.run(merged || null, r.id);
      }
    });
    tx(rows);
  }
} catch (e) { console.error("[migrate] LO prefs consolidation failed:", e); }

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

// ── Multi-tenancy: organizations, invite_tokens, super_admin, org_id (early) ──
// MUST run before any Drizzle SELECT on users/etc, because schema.ts now
// references super_admin and org_id columns.
try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      logo_url TEXT,
      company_name TEXT NOT NULL,
      resend_api_key TEXT,
      from_email TEXT,
      manager_emails TEXT,
      plan TEXT NOT NULL DEFAULT 'trial',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch {}

try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS invite_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      org_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'clr',
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch {}

try {
  sqlite.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, company_name, resend_api_key, from_email, manager_emails, plan)
    VALUES (1, 'West Capital Lending', 'west-capital', 'West Capital Lending', 're_6yaHVd97_U3jABCg6Az64GCrkHCk2J24Q', 'reports@westcapitallending.center', ?, 'active')
  `).run(JSON.stringify(["scott.petrie@westcapitallending.com","chris.redoble@westcapitallending.com"]));
} catch {}

try { sqlite.exec(`ALTER TABLE users ADD COLUMN super_admin INTEGER NOT NULL DEFAULT 0`); } catch {}

// ── Per-CLR weekly goals table (admin-managed, per user) ──────────────────────
try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clr_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      org_id INTEGER NOT NULL DEFAULT 1,
      calls_goal INTEGER NOT NULL DEFAULT 0,
      transfers_goal INTEGER NOT NULL DEFAULT 0,
      appointments_goal INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id)
    );
  `);
} catch {}

// Auto-adjustment columns for goals
try { sqlite.exec(`ALTER TABLE clr_goals ADD COLUMN auto_adjust INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE clr_goals ADD COLUMN adjustment_basis TEXT`); } catch {}
// goal_model: 'manual' | 'adjustable' | 'staircase'
try { sqlite.exec(`ALTER TABLE clr_goals ADD COLUMN goal_model TEXT NOT NULL DEFAULT 'manual'`); } catch {}
// adjustment_pct: percent to increase in adjustable/staircase mode (default 5)
try { sqlite.exec(`ALTER TABLE clr_goals ADD COLUMN adjustment_pct REAL NOT NULL DEFAULT 5`); } catch {}

for (const t of ["users","loan_officers","lead_outcomes","daily_call_logs","forum_posts","forum_answers","forum_votes","forum_subscriptions","lo_assignments","unified_contacts","webhook_settings","webhook_events","bonzo_contacts","mojo_sessions","mojo_contacts"]) {
  try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1`); } catch {}
}

// ── Demo mode: is_demo column + demo org + demo users + sample data ───────
try { sqlite.exec(`ALTER TABLE organizations ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0`); } catch {}

try {
  sqlite.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, company_name, plan, is_demo)
    VALUES (2, 'Demo Company', 'demo', 'Demo Lending Co', 'active', 1)
  `).run();
  // Ensure is_demo=1 for demo org even if the row was created before this column existed
  sqlite.prepare(`UPDATE organizations SET is_demo = 1 WHERE id = 2`).run();
} catch {}

try {
  const demoHash = bcrypt.hashSync("Demo2026!", 10);
  const nowIso = new Date().toISOString();

  // Demo CLR user
  sqlite.prepare(`
    INSERT OR IGNORE INTO users
      (name, email, role, is_active, is_clr, password_hash, must_change_password, org_id, has_seen_intro, created_at)
    VALUES (?, ?, 'clr', 1, 1, ?, 0, 2, 1, ?)
  `).run("Demo CLR", "demo@clrconnection.com", demoHash, nowIso);

  // Demo admin user
  sqlite.prepare(`
    INSERT OR IGNORE INTO users
      (name, email, role, is_active, is_clr, password_hash, must_change_password, org_id, has_seen_intro, created_at)
    VALUES (?, ?, 'admin', 1, 0, ?, 0, 2, 1, ?)
  `).run("Demo Admin", "demoadmin@clrconnection.com", demoHash, nowIso);

  // Force role/password/org_id on existing demo rows (in case they were seeded differently)
  sqlite.prepare(`UPDATE users SET role='clr', org_id=2, password_hash=?, must_change_password=0, is_active=1 WHERE LOWER(email)='demo@clrconnection.com'`).run(demoHash);
  sqlite.prepare(`UPDATE users SET role='admin', org_id=2, password_hash=?, must_change_password=0, is_active=1 WHERE LOWER(email)='demoadmin@clrconnection.com'`).run(demoHash);
} catch (e) {
  console.error("demo user seed failed:", e);
}

// Seed demo sample data (only once, tracked via migrations_applied)
try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'demo_sample_data_v1'`).get();
  if (!done) {
    const nowIso = new Date().toISOString();
    const demoCLR = sqlite.prepare(`SELECT id FROM users WHERE email='demo@clrconnection.com'`).get() as { id: number } | undefined;

    // 5 demo loan officers scoped to org_id=2
    const demoLOs = [
      { fullName: "Alex Thompson",  nmlsId: "9000001", phone: "(555) 100-2001", email: "alex.thompson@demolending.com", tier: 1, boost: 8 },
      { fullName: "Jordan Rivera",  nmlsId: "9000002", phone: "(555) 100-2002", email: "jordan.rivera@demolending.com", tier: 2, boost: 5 },
      { fullName: "Taylor Morgan",  nmlsId: "9000003", phone: "(555) 100-2003", email: "taylor.morgan@demolending.com", tier: 1, boost: 7 },
      { fullName: "Casey Bennett",  nmlsId: "9000004", phone: "(555) 100-2004", email: "casey.bennett@demolending.com", tier: 2, boost: 3 },
      { fullName: "Morgan Ellis",   nmlsId: "9000005", phone: "(555) 100-2005", email: "morgan.ellis@demolending.com",  tier: 3, boost: 2 },
    ];
    const insertLO = sqlite.prepare(`
      INSERT OR IGNORE INTO loan_officers
        (full_name, nmls_id, phone, email, licensed_states, other_credentials, tags, internal_status, boost_score, priority_tier, total_times_worked, last_worked_date, nmls_states, org_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, '["CA","TX","FL"]', '{}', '[]', 'active', ?, ?, 10, ?, '[]', 2, ?, ?)
    `);
    const today = new Date();
    const dayStr = (offset: number) => {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      return d.toISOString().split("T")[0];
    };
    const dayStrFuture = (offset: number) => {
      const d = new Date(today);
      d.setDate(today.getDate() + offset);
      return d.toISOString().split("T")[0];
    };
    const loIds: number[] = [];
    for (const lo of demoLOs) {
      const info = insertLO.run(lo.fullName, lo.nmlsId, lo.phone, lo.email, lo.boost, lo.tier, dayStr(Math.floor(Math.random() * 10)), nowIso, nowIso);
      const row = sqlite.prepare(`SELECT id FROM loan_officers WHERE nmls_id = ?`).get(lo.nmlsId) as { id: number } | undefined;
      if (row) loIds.push(row.id);
    }

    if (demoCLR && loIds.length > 0) {
      // 30 lead outcomes spread over last 14 days, various types
      const outcomeTypes = ["transfer","appointment","no_answer","callback_requested","not_interested","fell_through","deferral","wrong_number"];
      const insertOutcome = sqlite.prepare(`
        INSERT INTO lead_outcomes (date, assistant_id, lo_id, borrower_name, outcome_type, transfer_type, notes, tags, org_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 2, ?, ?)
      `);
      const borrowers = ["John Smith","Emily Brown","Michael Davis","Sarah Wilson","Chris Lee","Ashley Garcia","Daniel Kim","Olivia Nguyen","Ryan Patel","Jessica Ramirez"];
      for (let i = 0; i < 30; i++) {
        const ot = outcomeTypes[i % outcomeTypes.length];
        const d = dayStr(i % 14);
        const loId = loIds[i % loIds.length];
        const borrower = borrowers[i % borrowers.length];
        const transferType = ot === "transfer" ? (i % 2 === 0 ? "direct" : "appointment") : null;
        insertOutcome.run(d, demoCLR.id, loId, borrower, ot, transferType, "Demo outcome note", nowIso, nowIso);
      }

      // 14 days of daily_call_logs for the demo CLR
      const insertCallLog = sqlite.prepare(`
        INSERT OR IGNORE INTO daily_call_logs (log_date, assistant_id, calls_made, notes, updated_at, org_id)
        VALUES (?, ?, ?, ?, ?, 2)
      `);
      for (let i = 0; i < 14; i++) {
        insertCallLog.run(dayStr(i), demoCLR.id, 40 + (i * 3) % 25, "Demo call log", nowIso);
      }

      // 3 upcoming appointments (stored as lead_outcomes with outcome_type='appointment' and appointment_datetime in next 7 days)
      const insertAppt = sqlite.prepare(`
        INSERT INTO lead_outcomes (date, assistant_id, lo_id, borrower_name, outcome_type, transfer_type, appointment_datetime, lead_goal, notes, tags, org_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'appointment', 'appointment', ?, ?, ?, '[]', 2, ?, ?)
      `);
      const apptPayloads = [
        { day: 1, name: "Kevin Wallace",  goal: "purchase" },
        { day: 3, name: "Lauren Foster",  goal: "refinance" },
        { day: 5, name: "Derrick Howard", goal: "purchase" },
      ];
      for (let i = 0; i < apptPayloads.length; i++) {
        const a = apptPayloads[i];
        const dt = `${dayStrFuture(a.day)}T15:00:00Z`;
        insertAppt.run(dayStr(0), demoCLR.id, loIds[i % loIds.length], a.name, dt, a.goal, "Upcoming demo appointment", nowIso, nowIso);
      }
    }

    // 2 forum posts + answers (forum tables may not exist yet at this point — guarded)
    try {
      sqlite.exec(`CREATE TABLE IF NOT EXISTS forum_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        upvotes INTEGER DEFAULT 0,
        is_answered INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        org_id INTEGER NOT NULL DEFAULT 1
      )`);
      sqlite.exec(`CREATE TABLE IF NOT EXISTS forum_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        upvotes INTEGER DEFAULT 0,
        is_accepted INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        org_id INTEGER NOT NULL DEFAULT 1
      )`);
    } catch {}
    if (demoCLR) {
      try {
        const p1 = sqlite.prepare(`INSERT INTO forum_posts (title, body, author_id, author_name, upvotes, is_answered, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 2, ?, ?)`)
          .run("Best time to call LOs in the morning?", "Looking for tips on when to call LOs — does before 10am work better than after?", demoCLR.id, "Demo CLR", 3, nowIso, nowIso);
        sqlite.prepare(`INSERT INTO forum_answers (post_id, body, author_id, author_name, upvotes, is_accepted, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 2, ?, ?)`)
          .run(p1.lastInsertRowid, "We've had great luck between 9-10am and right before lunch.", demoCLR.id, "Demo Admin", 5, nowIso, nowIso);

        const p2 = sqlite.prepare(`INSERT INTO forum_posts (title, body, author_id, author_name, upvotes, is_answered, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 2, ?, ?)`)
          .run("How do you handle missed-appointment follow-ups?", "What's your script for reaching back out when someone missed an LO appointment?", demoCLR.id, "Demo CLR", 4, nowIso, nowIso);
        sqlite.prepare(`INSERT INTO forum_answers (post_id, body, author_id, author_name, upvotes, is_accepted, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 2, ?, ?)`)
          .run(p2.lastInsertRowid, "We call within 2 hours and offer to reschedule same-day whenever possible.", demoCLR.id, "Demo Admin", 2, nowIso, nowIso);
      } catch (e) { console.error("demo forum seed failed:", e); }
    }

    sqlite.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`).run("demo_sample_data_v1", nowIso);
  }
} catch (e) {
  console.error("demo sample data seed failed:", e);
}

// Ensure columns referenced by the Drizzle `users` schema exist before we run
// any `db.select().from(users)` — those queries read every column in the schema,
// so if a later migration adds a column we must add it here too.
try { sqlite.exec(`ALTER TABLE users ADD COLUMN sms_reminders_enabled INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN getting_started_dismissed INTEGER NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN getting_started_completed TEXT NOT NULL DEFAULT '[]'`); } catch {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN reminder_email_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}

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

// ── Admin UPSERT migration (ensures admin exists even if users row was deleted) ─
// Inserts ethan.anthony.wood@gmail.com if missing, then forces password + role.
try {
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'admin_upsert_v2'`).get();
  if (!done) {
    const hash = "$2b$10$WgepzdNbwEzTSAQW11xE5e.NWwkYjstTBIDf8UlE.gitFxnwnMNMK";
    const nowIso = new Date().toISOString();
    sqlite.prepare(`
      INSERT OR IGNORE INTO users
        (name, email, role, is_active, is_clr, password_hash, must_change_password, created_at)
      VALUES (?, ?, 'admin', 1, 0, ?, 0, ?)
    `).run("Ethan Wood", "ethan.anthony.wood@gmail.com", hash, nowIso);
    sqlite.prepare(`
      UPDATE users
         SET name = 'Ethan Wood',
             role = 'admin',
             is_active = 1,
             password_hash = ?,
             must_change_password = 0
       WHERE email = ?
    `).run(hash, "ethan.anthony.wood@gmail.com");
    sqlite.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`)
      .run("admin_upsert_v2", nowIso);
  }
} catch (e) {
  console.error("admin upsert migration failed:", e);
}

// Mark Ethan as super_admin (must run after admin upsert migration that guarantees the row)
try {
  sqlite.prepare(`UPDATE users SET super_admin = 1 WHERE LOWER(email) = ?`).run("ethan.anthony.wood@gmail.com");
} catch {}

// Super admins always have a home org context — default to org 1 (West Capital)
// if org_id is null/0. They can still impersonate other orgs temporarily.
try {
  sqlite.prepare(`UPDATE users SET org_id = 1 WHERE super_admin = 1 AND (org_id IS NULL OR org_id = 0)`).run();
} catch {}

// ── One-time data fix: set Mark Gomez's licensed states ──────────────────────
// Requested update to his licensing footprint. Guarded so it applies exactly
// once (won't revert future edits made in the Directory UI). The "applied" flag
// is only recorded after a row is actually updated, so it still applies if the
// LO record is added after this deploy.
try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'mark_gomez_licensed_states_v1'`).get();
  if (!done) {
    const markGomezStates = ["AL","AR","AZ","CA","CO","FL","GA","IN","IA","KS","LA","MA","MI","MN","MS","NE","NJ","NV","NC","OH","OK","OR","PA","SC","TN","VA","WA","WI"];
    const info = sqlite.prepare(
      `UPDATE loan_officers SET licensed_states = ? WHERE LOWER(TRIM(full_name)) = 'mark gomez'`
    ).run(JSON.stringify(markGomezStates));
    if ((info.changes as number) > 0) {
      sqlite.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`)
        .run("mark_gomez_licensed_states_v1", new Date().toISOString());
      console.log(`[migration] updated Mark Gomez licensed_states (${markGomezStates.length} states, ${info.changes} row(s))`);
    } else {
      console.warn("[migration] mark_gomez_licensed_states_v1: no 'Mark Gomez' LO found yet — will retry next startup");
    }
  }
} catch (e) {
  console.error("mark_gomez_licensed_states_v1 migration failed:", (e as Error).message);
}

// ── One-time cleanup: purge fake sample data from West Capital (org_id=1) ─────
// Old seeds inserted demo-looking LOs, assistants, outcomes, and call logs into
// the live West Capital org. Remove them permanently. Demo org (org_id=2) is
// intentionally left untouched.
try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'purge_west_capital_samples_v1'`).get();
  if (!done) {
    // Demo-org LO names that were previously seeded into org_id=1 as well
    const fakeLoNames = [
      'Alex Thompson','Jordan Rivera','Taylor Morgan','Casey Bennett','Morgan Ellis',
      'Michael Chen','Sarah Johnson','David Park','Emily Rodriguez',
      'Robert Chen','Maria Gonzalez','James Williams','Ashley Kim','Sandra Davis','Michael Torres',
    ];
    // Look up matching LO ids in org_id=1 so we can clean up dependent rows too
    const placeholders = fakeLoNames.map(() => '?').join(',');
    const loRows = sqlite.prepare(
      `SELECT id FROM loan_officers WHERE org_id = 1 AND full_name IN (${placeholders})`
    ).all(...fakeLoNames) as Array<{ id: number }>;
    const loIds = loRows.map(r => r.id);

    if (loIds.length > 0) {
      const loPh = loIds.map(() => '?').join(',');
      try { sqlite.prepare(`DELETE FROM lead_outcomes WHERE org_id = 1 AND lo_id IN (${loPh})`).run(...loIds); } catch {}
      try { sqlite.prepare(`DELETE FROM lo_assignments WHERE org_id = 1 AND lo_id IN (${loPh})`).run(...loIds); } catch {}
      try { sqlite.prepare(`DELETE FROM daily_assignments WHERE lo_id IN (${loPh})`).run(...loIds); } catch {}
      try { sqlite.prepare(`DELETE FROM lo_availability WHERE lo_id IN (${loPh})`).run(...loIds); } catch {}
    }
    try {
      sqlite.prepare(
        `DELETE FROM loan_officers WHERE org_id = 1 AND full_name IN (${placeholders})`
      ).run(...fakeLoNames);
    } catch {}

    // Fake sample assistants seeded for West Capital
    const fakeAssistantEmails = [
      'jessica@westcapital.com',
      'marcus@westcapital.com',
      'priya@westcapital.com',
    ];
    const emailPh = fakeAssistantEmails.map(() => '?').join(',');
    try {
      const assistRows = sqlite.prepare(
        `SELECT id FROM users WHERE role = 'assistant' AND LOWER(email) IN (${emailPh})`
      ).all(...fakeAssistantEmails) as Array<{ id: number }>;
      const aIds = assistRows.map(r => r.id);
      if (aIds.length > 0) {
        const aPh = aIds.map(() => '?').join(',');
        try { sqlite.prepare(`DELETE FROM lead_outcomes WHERE org_id = 1 AND assistant_id IN (${aPh})`).run(...aIds); } catch {}
        try { sqlite.prepare(`DELETE FROM daily_call_logs WHERE org_id = 1 AND assistant_id IN (${aPh})`).run(...aIds); } catch {}
        try { sqlite.prepare(`DELETE FROM daily_assignments WHERE assistant_id IN (${aPh})`).run(...aIds); } catch {}
        try { sqlite.prepare(`DELETE FROM lo_assignments WHERE org_id = 1 AND assistant_id IN (${aPh})`).run(...aIds); } catch {}
        try { sqlite.prepare(`DELETE FROM users WHERE id IN (${aPh})`).run(...aIds); } catch {}
      }
    } catch {}

    sqlite.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`)
      .run('purge_west_capital_samples_v1', new Date().toISOString());
  }
} catch (e) {
  console.error('purge_west_capital_samples_v1 failed:', e);
}

// ── Aggressive cleanup v2: catch any remaining fake LOs by name, email, or nmls_id ──
try {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'purge_west_capital_samples_v2'`).get();
  if (!done) {
    const fakeNames = [
      'Alex Thompson','Jordan Rivera','Taylor Morgan','Casey Bennett',
      'Michael Chen','Sarah Johnson','David Park','Emily Rodriguez',
      'Robert Chen','Maria Gonzalez','James Wilson','Lisa Anderson','Kevin Martinez',
    ];
    const fakeNmls = ['100001','100002','100003','100004','100005','111111','222222','333333','444444','555555'];
    const namePh = fakeNames.map(() => '?').join(',');
    const nmlsPh = fakeNmls.map(() => '?').join(',');

    try {
      sqlite.prepare(
        `DELETE FROM loan_officers WHERE org_id = 1 AND (
          full_name IN (${namePh})
          OR email LIKE '%@westcapital.com'
          OR email LIKE '%@example.com'
          OR email LIKE '%@demo.com'
          OR nmls_id IN (${nmlsPh})
        )`
      ).run(...fakeNames, ...fakeNmls);
    } catch (e) { console.error('v2 LO delete failed:', e); }

    try {
      sqlite.prepare(
        `DELETE FROM lo_assignments WHERE org_id = 1 AND lo_id NOT IN (SELECT id FROM loan_officers)`
      ).run();
    } catch (e) { console.error('v2 lo_assignments delete failed:', e); }

    try {
      sqlite.prepare(
        `DELETE FROM lead_outcomes WHERE org_id = 1 AND lo_id NOT IN (SELECT id FROM loan_officers)`
      ).run();
    } catch (e) { console.error('v2 lead_outcomes delete failed:', e); }

    try {
      sqlite.prepare(
        `DELETE FROM daily_assignments WHERE lo_id NOT IN (SELECT id FROM loan_officers)`
      ).run();
    } catch (e) { console.error('v2 daily_assignments delete failed:', e); }

    try {
      sqlite.prepare(
        `DELETE FROM lo_availability WHERE lo_id NOT IN (SELECT id FROM loan_officers)`
      ).run();
    } catch (e) { console.error('v2 lo_availability delete failed:', e); }

    sqlite.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`)
      .run('purge_west_capital_samples_v2', new Date().toISOString());
  }
} catch (e) {
  console.error('purge_west_capital_samples_v2 failed:', e);
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

// West Capital (org_id=1) starts with zero LOs — admins add real ones manually.
// Demo org (org_id=2) LO seeding happens earlier, gated by migrations_applied.

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
  reassignAssignment(id: number, assistantId: number, assistantRank: number): DailyAssignment | undefined;
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
  getDashboardStats(startDate: string, endDate: string, assistantId?: number): any;
  getLeaderboard(startDate: string, endDate: string): any[];

  // Daily Call Logs
  getDailyCallLogs(date: string): DailyCallLog[];
  getCallLogsByRange(from: string, to: string): DailyCallLog[];
  upsertDailyCallLog(data: InsertDailyCallLog): DailyCallLog;
}

function normalizeLoanOfficer(row: any): any {
  if (!row) return row;
  // Convert snake_case columns from raw sqlite into camelCase fields the
  // frontend expects (mirrors what Drizzle returns).
  const out = { ...row };
  const map: Record<string, string> = {
    full_name: "fullName",
    first_name: "firstName",
    last_name: "lastName",
    nmls_id: "nmlsId",
    nmls_status: "nmlsStatus",
    nmls_states: "nmlsStates",
    nmls_last_checked: "nmlsLastChecked",
    nmls_license_expiration: "nmlsLicenseExpiration",
    internal_status: "internalStatus",
    total_times_worked: "totalTimesWorked",
    last_assigned_date: "lastAssignedDate",
    snooze_until: "snoozeUntil",
    snooze_reason: "snoozeReason",
    contact_email: "contactEmail",
    org_id: "orgId",
    created_at: "createdAt",
    updated_at: "updatedAt",
    do_not_call: "doNotCall",
    profile_url: "profileUrl",
    license_status: "licenseStatus",
    bonzo_username: "bonzoUsername",
    bonzo_password: "bonzoPassword",
    lead_mailbox_username: "leadMailboxUsername",
    lead_mailbox_password: "leadMailboxPassword",
    other_credentials: "otherCredentials",
    personal_preferences: "personalPreferences",
  };
  for (const [snake, camel] of Object.entries(map)) {
    if (snake in out && out[camel] === undefined) out[camel] = out[snake];
  }
  return out;
}

export class Storage implements IStorage {
  getUsers() {
    const oid = currentOrgId();
    if (oid != null) {
      return db.select().from(users).where(eq(users.orgId, oid)).all();
    }
    return db.select().from(users).all();
  }
  getUserById(id: number) {
    // getUserById is typically invoked with a trusted session.userId;
    // do not enforce org-scope here — callers that need cross-user lookup
    // (e.g. admin listing users of a different org) would be broken.
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  getUserByEmail(email: string) {
    // Login lookup must not be org-scoped — server determines org from user record.
    // Match case-insensitively so a user whose stored email casing differs from
    // what they typed still resolves (otherwise login/forgot-password silently
    // miss).
    const normalized = String(email ?? "").trim();
    if (!normalized) return undefined;
    return sqlite.prepare(`SELECT *, password_hash FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`).get(normalized) as (User & { password_hash: string | null }) | undefined;
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
    const oid = currentOrgId();
    const values: any = { ...data, createdAt: new Date().toISOString() };
    if (oid != null && values.orgId == null) values.orgId = oid;
    return db.insert(users).values(values).returning().get();
  }
  updateUser(id: number, data: Partial<InsertUser>) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT id FROM users WHERE id = ? AND org_id = ?`).get(id, oid);
      if (!existing) return undefined as any;
    }
    return db.update(users).set(data).where(eq(users.id, id)).returning().get();
  }
  deleteUser(id: number) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT id FROM users WHERE id = ? AND org_id = ?`).get(id, oid);
      if (!existing) return { changes: 0 } as any;
    }
    return db.delete(users).where(eq(users.id, id)).run();
  }

  getLoanOfficers() {
    const oid = currentOrgId();
    if (oid != null) {
      const rows = sqlite.prepare(`SELECT * FROM loan_officers WHERE org_id = ?`).all(oid) as any[];
      return rows.map(normalizeLoanOfficer);
    }
    return db.select().from(loanOfficers).all();
  }
  getLoanOfficerById(id: number) {
    const oid = currentOrgId();
    if (oid != null) {
      const row = sqlite.prepare(`SELECT * FROM loan_officers WHERE id = ? AND org_id = ? LIMIT 1`).get(id, oid) as any;
      return row ? normalizeLoanOfficer(row) : undefined;
    }
    return db.select().from(loanOfficers).where(eq(loanOfficers.id, id)).get();
  }
  createLoanOfficer(data: InsertLoanOfficer) {
    const oid = currentOrgId();
    const values: any = { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const result = db.insert(loanOfficers).values(values).returning().get();
    if (oid != null && result?.id != null) {
      sqlite.prepare(`UPDATE loan_officers SET org_id = ? WHERE id = ?`).run(oid, result.id);
    }
    return result;
  }
  updateLoanOfficer(id: number, data: Partial<InsertLoanOfficer>) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT id FROM loan_officers WHERE id = ? AND org_id = ?`).get(id, oid);
      if (!existing) return undefined as any;
    }
    return db.update(loanOfficers).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(loanOfficers.id, id)).returning().get();
  }
  archiveLoanOfficer(id: number) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT id FROM loan_officers WHERE id = ? AND org_id = ?`).get(id, oid);
      if (!existing) return;
    }
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
    const oid = currentOrgId();
    if (oid != null) {
      return sqlite.prepare(`SELECT a.* FROM daily_assignments a INNER JOIN loan_officers lo ON lo.id = a.lo_id WHERE a.assignment_date = ? AND lo.org_id = ?`).all(date, oid) as any[];
    }
    return db.select().from(dailyAssignments).where(eq(dailyAssignments.assignmentDate, date)).all();
  }
  getAssignmentsByRange(from: string, to: string) {
    const oid = currentOrgId();
    if (oid != null) {
      return sqlite.prepare(`SELECT a.* FROM daily_assignments a INNER JOIN loan_officers lo ON lo.id = a.lo_id WHERE a.assignment_date >= ? AND a.assignment_date <= ? AND lo.org_id = ?`).all(from, to, oid) as any[];
    }
    return db.select().from(dailyAssignments)
      .where(and(gte(dailyAssignments.assignmentDate, from), lte(dailyAssignments.assignmentDate, to)))
      .all();
  }
  createDailyAssignments(assignments: InsertDailyAssignment[]) {
    if (assignments.length === 0) return [];
    return db.insert(dailyAssignments).values(assignments.map(a => ({ ...a, createdAt: new Date().toISOString() }))).returning().all();
  }
  updateAssignmentStatus(id: number, status: string, notes?: string) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT a.id FROM daily_assignments a INNER JOIN loan_officers lo ON lo.id = a.lo_id WHERE a.id = ? AND lo.org_id = ?`).get(id, oid);
      if (!existing) return undefined as any;
    }
    return db.update(dailyAssignments).set({ status, notes }).where(eq(dailyAssignments.id, id)).returning().get();
  }
  reassignAssignment(id: number, assistantId: number, assistantRank: number) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT a.id FROM daily_assignments a INNER JOIN loan_officers lo ON lo.id = a.lo_id WHERE a.id = ? AND lo.org_id = ?`).get(id, oid);
      if (!existing) return undefined as any;
    }
    return db.update(dailyAssignments).set({ assistantId, assistantRank }).where(eq(dailyAssignments.id, id)).returning().get();
  }
  getAssignmentById(id: number) {
    const oid = currentOrgId();
    if (oid != null) {
      return sqlite.prepare(`SELECT a.* FROM daily_assignments a INNER JOIN loan_officers lo ON lo.id = a.lo_id WHERE a.id = ? AND lo.org_id = ? LIMIT 1`).get(id, oid) as any;
    }
    return db.select().from(dailyAssignments).where(eq(dailyAssignments.id, id)).get();
  }
  clearDailyAssignments(date: string) {
    const oid = currentOrgId();
    if (oid != null) {
      sqlite.prepare(`DELETE FROM daily_assignments WHERE assignment_date = ? AND lo_id IN (SELECT id FROM loan_officers WHERE org_id = ?)`).run(date, oid);
      return;
    }
    db.delete(dailyAssignments).where(eq(dailyAssignments.assignmentDate, date)).run();
  }

  getLeadOutcomes(filters?: { startDate?: string; endDate?: string; assistantId?: number; loId?: number }) {
    const oid = currentOrgId();
    const wheres: string[] = [];
    const params: any[] = [];
    if (filters?.startDate) { wheres.push(`date >= ?`); params.push(filters.startDate); }
    if (filters?.endDate)   { wheres.push(`date <= ?`); params.push(filters.endDate); }
    if (filters?.assistantId) { wheres.push(`assistant_id = ?`); params.push(filters.assistantId); }
    if (filters?.loId) { wheres.push(`lo_id = ?`); params.push(filters.loId); }
    if (oid != null) { wheres.push(`org_id = ?`); params.push(oid); }
    const whereSql = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
    const rows = sqlite.prepare(`SELECT * FROM lead_outcomes ${whereSql} ORDER BY date DESC`).all(...params);
    return rows as any[];
  }
  createLeadOutcome(data: InsertLeadOutcome) {
    const oid = currentOrgId();
    const result = db.insert(leadOutcomes).values({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).returning().get();
    if (oid != null && result?.id != null) {
      sqlite.prepare(`UPDATE lead_outcomes SET org_id = ? WHERE id = ?`).run(oid, result.id);
    }
    return result;
  }
  updateLeadOutcome(id: number, data: Partial<InsertLeadOutcome>) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT id FROM lead_outcomes WHERE id = ? AND org_id = ?`).get(id, oid);
      if (!existing) return undefined as any;
    }
    return db.update(leadOutcomes).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(leadOutcomes.id, id)).returning().get();
  }
  deleteLeadOutcome(id: number) {
    const oid = currentOrgId();
    if (oid != null) {
      const existing = sqlite.prepare(`SELECT id FROM lead_outcomes WHERE id = ? AND org_id = ?`).get(id, oid);
      if (!existing) return;
    }
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

  // Single source of truth: ids of "non-counted" CLRs whose data must never
  // reach team totals / leaderboard. They still use the app and submit EODs.
  getExcludedClrIds(): Set<number> {
    const oid = currentOrgId();
    const rows = oid != null
      ? sqlite.prepare(`SELECT id FROM users WHERE exclude_from_stats = 1 AND org_id = ?`).all(oid)
      : sqlite.prepare(`SELECT id FROM users WHERE exclude_from_stats = 1`).all();
    return new Set((rows as any[]).map(r => r.id));
  }

  getDashboardStats(startDate: string, endDate: string, assistantId?: number, tz?: string) {
    const oid = currentOrgId();
    const orgWhere = oid != null ? ` AND org_id = ${Number(oid)}` : "";
    const userWhere = assistantId != null ? ` AND assistant_id = ${Number(assistantId)}` : "";
    // Team scope (no assistantId): drop non-counted CLRs from every total.
    const excludeWhere = assistantId != null
      ? ""
      : ` AND assistant_id NOT IN (SELECT id FROM users WHERE exclude_from_stats = 1${orgWhere})`;
    const outcomes = sqlite.prepare(`SELECT * FROM lead_outcomes WHERE date >= ? AND date <= ?${orgWhere}${userWhere}${excludeWhere}`).all(startDate, endDate) as any[];

    const total = outcomes.length;
    const transfers = outcomes.filter((o: any) => o.outcome_type === "transfer").length;
    const appointments = outcomes.filter((o: any) => o.outcome_type === "appointment").length;
    const fellThrough = outcomes.filter((o: any) => o.outcome_type === "fell_through").length;
    const noAnswer = outcomes.filter((o: any) => o.outcome_type === "no_answer").length;
    const conversionRate = total > 0 ? Math.round((transfers / total) * 100) : 0;

    const outcomesByType: Record<string, number> = {};
    outcomes.forEach((o: any) => {
      outcomesByType[o.outcome_type] = (outcomesByType[o.outcome_type] || 0) + 1;
    });

    // Today's call totals (scoped to user when assistantId provided)
    // Uses business-day rollover (10pm forward) in the caller's timezone.
    const todayStr = (() => {
      try {
        const { businessTodayInTz } = require("./business-day") as typeof import("./business-day");
        return businessTodayInTz(tz);
      } catch {
        return new Date().toISOString().split("T")[0];
      }
    })();
    const todayLogs = sqlite.prepare(`SELECT * FROM daily_call_logs WHERE log_date = ?${orgWhere}${userWhere}${excludeWhere}`).all(todayStr) as any[];
    const totalCallsToday = todayLogs.reduce((sum: number, l: any) => sum + (l.calls_made ?? 0), 0);
    const callTransferRatio = totalCallsToday > 0 ? ((transfers / totalCallsToday) * 100).toFixed(1) : null;

    // Upcoming appointments. The "Upcoming Appointments" stat card is inherently
    // personal — when an assistantId is provided, scope to that user; otherwise
    // (team view) include the whole org.
    const allOutcomes = sqlite.prepare(`SELECT * FROM lead_outcomes WHERE 1=1${orgWhere}${userWhere}${excludeWhere}`).all() as any[];
    const upcomingAppointments = allOutcomes.filter(
      (o: any) => o.outcome_type === "appointment" && o.follow_up_date != null && o.follow_up_date >= todayStr
    ).length;

    return { total, transfers, appointments, fellThrough, noAnswer, conversionRate, outcomesByType, totalCallsToday, callTransferRatio, upcomingAppointments };
  }

  getLeaderboard(startDate: string, endDate: string) {
    const oid = currentOrgId();
    const orgWhere = oid != null ? ` AND org_id = ${Number(oid)}` : "";
    const outcomes = sqlite.prepare(`SELECT * FROM lead_outcomes WHERE date >= ? AND date <= ?${orgWhere}`).all(startDate, endDate) as any[];

    const usersQuery = oid != null
      ? sqlite.prepare(`SELECT * FROM users WHERE (role = 'assistant' OR role = 'admin') AND is_active = 1 AND exclude_from_stats = 0 AND org_id = ?`).all(oid)
      : db.select().from(users).where(sql`(${users.role} = 'assistant' OR ${users.role} = 'admin') AND ${users.isActive} = 1 AND ${users.excludeFromStats} = 0`).all();
    const allUsers = usersQuery as any[];

    const stats = allUsers.map((user: any) => {
      const userOutcomes = outcomes.filter((o: any) => (o.assistant_id ?? o.assistantId) === user.id);
      const transfers = userOutcomes.filter((o: any) => (o.outcome_type ?? o.outcomeType) === "transfer").length;
      const appointments = userOutcomes.filter((o: any) => (o.outcome_type ?? o.outcomeType) === "appointment").length;
      const total = userOutcomes.length;
      const rate = total > 0 ? Math.round((transfers / total) * 100) : 0;
      return { userId: user.id, name: user.name, transfers, appointments, total, conversionRate: rate };
    });

    return stats.sort((a, b) => b.transfers - a.transfers);
  }

  getDailyCallLogs(date: string) {
    const oid = currentOrgId();
    if (oid != null) {
      return sqlite.prepare(`SELECT * FROM daily_call_logs WHERE log_date = ? AND org_id = ?`).all(date, oid) as any[];
    }
    return db.select().from(dailyCallLogs).where(eq(dailyCallLogs.logDate, date)).all();
  }

  getCallLogsByRange(from: string, to: string) {
    const oid = currentOrgId();
    if (oid != null) {
      return sqlite.prepare(`SELECT * FROM daily_call_logs WHERE log_date >= ? AND log_date <= ? AND org_id = ?`).all(from, to, oid) as any[];
    }
    return db.select().from(dailyCallLogs)
      .where(and(gte(dailyCallLogs.logDate, from), lte(dailyCallLogs.logDate, to)))
      .all();
  }

  upsertDailyCallLog(data: InsertDailyCallLog) {
    const oid = currentOrgId();
    // Use raw SQLite so org_id is respected in the lookup
    const existingRaw = oid != null
      ? sqlite.prepare(`SELECT * FROM daily_call_logs WHERE log_date=? AND assistant_id=? AND org_id=? LIMIT 1`).get(data.logDate, data.assistantId, oid) as any
      : sqlite.prepare(`SELECT * FROM daily_call_logs WHERE log_date=? AND assistant_id=? LIMIT 1`).get(data.logDate, data.assistantId) as any;
    const now = new Date().toISOString();
    if (existingRaw) {
      sqlite.prepare(`UPDATE daily_call_logs SET calls_made=?, notes=?, updated_at=? WHERE id=?`)
        .run(data.callsMade, data.notes ?? null, now, existingRaw.id);
      return sqlite.prepare(`SELECT * FROM daily_call_logs WHERE id=?`).get(existingRaw.id);
    }
    const insertResult = sqlite.prepare(
      `INSERT INTO daily_call_logs (log_date, assistant_id, calls_made, notes, updated_at, org_id) VALUES (?,?,?,?,?,?)`
    ).run(data.logDate, data.assistantId, data.callsMade, data.notes ?? null, now, oid ?? 1);
    return sqlite.prepare(`SELECT * FROM daily_call_logs WHERE id=?`).get(insertResult.lastInsertRowid);
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

// Raw sqlite access for features that need direct SQL (super-admin, invites, etc.)
export function getRawSqlite() { return sqlite; }

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
  // 2026-06: manager who receives comp/reimbursement requests for email approval.
  if (!emailCols.find(c => c.name === 'comp_approver_id')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN comp_approver_id INTEGER`);
  }
  // 2026-06: manager who receives time-off requests for email approval.
  if (!emailCols.find(c => c.name === 'timeoff_approver_id')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN timeoff_approver_id INTEGER`);
  }
  // 2026-06: single global approver — all comp + time-off approval emails go to
  // this person. Backfilled once from whichever per-type approver was set.
  if (!emailCols.find(c => c.name === 'approval_recipient_id')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN approval_recipient_id INTEGER`);
    try { sqlite.exec(`UPDATE email_settings SET approval_recipient_id = COALESCE(approval_recipient_id, comp_approver_id, timeoff_approver_id)`); } catch {}
  }
  // 2026-06: persisted per-type 'last sent' date (JSON: { daily: 'YYYY-MM-DD', ... })
  // so scheduled reports are NOT re-sent when the process restarts mid-window.
  if (!emailCols.find(c => c.name === 'report_last_sent')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN report_last_sent TEXT NOT NULL DEFAULT '{}'`);
  }
  // 2026-06: AI Script Coach — Anthropic API key + model (key may also come from
  // the ANTHROPIC_API_KEY env var, which takes precedence).
  if (!emailCols.find(c => c.name === 'ai_api_key')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN ai_api_key TEXT NOT NULL DEFAULT ''`);
  }
  if (!emailCols.find(c => c.name === 'ai_model')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN ai_model TEXT NOT NULL DEFAULT ''`);
  }
  // 2026-06: natural text-to-speech for the Script Coach voice call.
  if (!emailCols.find(c => c.name === 'tts_provider')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN tts_provider TEXT NOT NULL DEFAULT 'browser'`);
  }
  if (!emailCols.find(c => c.name === 'tts_api_key')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN tts_api_key TEXT NOT NULL DEFAULT ''`);
  }
  if (!emailCols.find(c => c.name === 'tts_voice')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN tts_voice TEXT NOT NULL DEFAULT ''`);
  }
  // 2026-06: org toggle — when on, the transfer form asks whether Bulk Texter
  // was part of the transfer.
  if (!emailCols.find(c => c.name === 'ask_bulk_texter')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN ask_bulk_texter INTEGER NOT NULL DEFAULT 0`);
  }
  // 2026-05-05: per-type send times. Defaults match Ethan's spec:
  //   daily → already exists as daily_time (default 08:00)
  //   weekly → Monday 08:00
  //   monthly → 7:00 on the 1st of the next month
  // 2026-06: daily_time became user-adjustable. Previously the daily report
  // fired at a hard-coded 7:45 AM PT and daily_time (default 08:00) was unused.
  // One-time backfill to 07:45 so the established send time is preserved as the
  // default. Guarded by daily_time_seeded so a later admin change to 08:00 is
  // not flipped back on the next restart.
  if (!emailCols.find(c => c.name === 'daily_time_seeded')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN daily_time_seeded INTEGER NOT NULL DEFAULT 0`);
    try { sqlite.exec(`UPDATE email_settings SET daily_time='07:45' WHERE daily_time='08:00'`); } catch {}
    try { sqlite.exec(`UPDATE email_settings SET daily_time_seeded=1`); } catch {}
  }
  if (!emailCols.find(c => c.name === 'weekly_time')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN weekly_time TEXT NOT NULL DEFAULT '08:00'`);
  }
  if (!emailCols.find(c => c.name === 'monthly_time')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN monthly_time TEXT NOT NULL DEFAULT '07:00'`);
  }
  // 2026-05-29: Month-to-date + All-time reports. MTD defaults to fire daily
  // (no day-of-month constraint); All-time fires once per month on the 1st.
  if (!emailCols.find(c => c.name === 'mtd_enabled')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN mtd_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!emailCols.find(c => c.name === 'mtd_time')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN mtd_time TEXT NOT NULL DEFAULT '08:00'`);
  }
  if (!emailCols.find(c => c.name === 'alltime_enabled')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN alltime_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!emailCols.find(c => c.name === 'alltime_time')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN alltime_time TEXT NOT NULL DEFAULT '07:10'`);
  }
  // 2026-06: per-report-type section visibility config. JSON keyed by report
  // type (daily/weekly/monthly) -> { sectionKey: boolean }. Missing keys default
  // to true so existing rows keep the full report. Managers edit this in
  // Settings → Reports → "What's in the email".
  if (!emailCols.find(c => c.name === 'report_sections')) {
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN report_sections TEXT NOT NULL DEFAULT '{}'`);
  }
  // 2026-06: per-report-type "send to all managers" toggle. JSON keyed by report
  // type -> boolean. When true, every active user with is_manager=1 is added to
  // that report's recipients (on top of the manual Report Recipients list).
  // Defaults to '{}' (off) so existing behavior — manual list only — is preserved.
  if (!emailCols.find(c => c.name === 'report_to_all_managers')) {
    // Default ON for all report types — historically every manager received the
    // scheduled reports, so a fresh column should preserve that behavior.
    sqlite.exec(`ALTER TABLE email_settings ADD COLUMN report_to_all_managers TEXT NOT NULL DEFAULT '{"daily":true,"weekly":true,"monthly":true,"mtd":true,"alltime":true}'`);
  }
  // One-time backfill: rows created before this default existed have '{}' (off).
  // Flip those never-configured rows ON to match historical behavior. Rows that
  // a manager has since edited will hold explicit per-type values and are left
  // untouched by the '{}' guard.
  try {
    sqlite.exec(`UPDATE email_settings SET report_to_all_managers = '{"daily":true,"weekly":true,"monthly":true,"mtd":true,"alltime":true}' WHERE report_to_all_managers IS NULL OR report_to_all_managers = '' OR report_to_all_managers = '{}'`);
  } catch {}
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
  // Migrate stale from_address_resend values to the current default
  try { sqlite.exec(`UPDATE email_settings SET from_address_resend = 'reports@westcapitallending.center' WHERE from_address_resend = 'info@wlc.it.com'`); } catch {}
  try { sqlite.exec(`UPDATE email_settings SET from_address_resend = 'reports@westcapitallending.center' WHERE from_address_resend = 'reports@wlc.it.com'`); } catch {}
  // Seed default from_address_resend if empty
  try { sqlite.exec(`UPDATE email_settings SET from_address_resend = 'reports@westcapitallending.center' WHERE from_address_resend IS NULL OR from_address_resend = ''`); } catch {}
  // Migrate organizations.from_email from old wlc.it.com domain to westcapitallending.center
  try { sqlite.exec(`UPDATE organizations SET from_email = 'reports@westcapitallending.center' WHERE from_email = 'reports@wlc.it.com' OR from_email = 'info@wlc.it.com'`); } catch {}
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
  // Emoji reactions on chat messages (one row per user+emoji+message).
  sqlite.exec(`CREATE TABLE IF NOT EXISTS chat_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(message_id, user_id, emoji)
  )`);
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id)`); } catch {}

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
  try { sqlite.exec(`ALTER TABLE eod_reports ADD COLUMN additional_los_other_notes TEXT`); } catch {}
  // Messages sent (texts/DMs) for the day — tracked alongside calls.
  try { sqlite.exec(`ALTER TABLE eod_reports ADD COLUMN messages_sent INTEGER NOT NULL DEFAULT 0`); } catch {}

  // EOD drafts — one per user, holds serialized form state so CLRs don't lose
  // their progress if they close the page before submitting.
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS eod_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      org_id INTEGER NOT NULL DEFAULT 1,
      draft_data TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}

  // EOD activities table (individual line items per report)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS eod_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date TEXT NOT NULL,
    assistant_id INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Webhook events — raw inbound webhook payload log
  sqlite.exec(`CREATE TABLE IF NOT EXISTS webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_type TEXT,
    payload TEXT NOT NULL,
    matched_user_id INTEGER,
    processed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);

  // Webhook settings — optional per-source secrets
  sqlite.exec(`CREATE TABLE IF NOT EXISTS webhook_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    mojo_secret TEXT,
    bonzo_secret TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  try {
    const row = sqlite.prepare(`SELECT id FROM webhook_settings WHERE id=1`).get();
    if (!row) {
      const now = new Date().toISOString();
      sqlite.prepare(`INSERT INTO webhook_settings (id, mojo_secret, bonzo_secret, created_at, updated_at) VALUES (1, NULL, NULL, ?, ?)`).run(now, now);
    }
  } catch {}

  // daily_call_logs: add webhook-sourced counters
  try { sqlite.exec(`ALTER TABLE daily_call_logs ADD COLUMN contacts_reached INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE daily_call_logs ADD COLUMN dnc_hits INTEGER NOT NULL DEFAULT 0`); } catch {}

  // webhook_settings: add integration API tokens
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN bonzo_api_token TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN mojo_api_key TEXT`); } catch {}

  // ── Bonzo integration tables ─────────────────────────────────────────────
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS bonzo_prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bonzo_id TEXT UNIQUE NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      pipeline_id TEXT,
      pipeline_name TEXT,
      stage_id TEXT,
      stage_name TEXT,
      assigned_user_id INTEGER,
      bonzo_user_id TEXT,
      bonzo_user_name TEXT,
      tags TEXT DEFAULT '[]',
      last_activity_at TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS bonzo_pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bonzo_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      stages TEXT DEFAULT '[]',
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS bonzo_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL,
      records_synced INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    )`);
  } catch {}

  // ── Mojo integration tables ──────────────────────────────────────────────
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS mojo_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_date TEXT NOT NULL,
      clr_user_id INTEGER,
      clr_name TEXT,
      total_calls INTEGER DEFAULT 0,
      contacts_reached INTEGER DEFAULT 0,
      dnc_hits INTEGER DEFAULT 0,
      transfers INTEGER DEFAULT 0,
      appointments INTEGER DEFAULT 0,
      voicemails INTEGER DEFAULT 0,
      no_answers INTEGER DEFAULT 0,
      source TEXT DEFAULT 'webhook',
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_date, clr_user_id)
    )`);
  } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS mojo_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mojo_id TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      email TEXT,
      status TEXT,
      assigned_clr_id INTEGER,
      list_name TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS mojo_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL,
      records_synced INTEGER DEFAULT 0,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    )`);
  } catch {}

  // ── Forum tables ─────────────────────────────────────────────────────────
  // ── Unified contacts table ────────────────────────────────────────────────
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS unified_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT,
      last_name TEXT,
      full_name TEXT,
      phone TEXT,
      email TEXT,
      bonzo_prospect_id TEXT,
      bonzo_pipeline TEXT,
      bonzo_stage TEXT,
      bonzo_assigned_user TEXT,
      mojo_contact_id TEXT,
      mojo_group TEXT,
      mojo_status TEXT,
      clr_user_id INTEGER,
      lo_id INTEGER,
      total_calls INTEGER DEFAULT 0,
      total_transfers INTEGER DEFAULT 0,
      total_appointments INTEGER DEFAULT 0,
      last_outcome_type TEXT,
      last_outcome_date TEXT,
      last_call_date TEXT,
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch {}
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_unified_contacts_phone ON unified_contacts(phone)`); } catch {}
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_unified_contacts_email ON unified_contacts(email)`); } catch {}

  // ── Zapier webhook fields ─────────────────────────────────────────────────
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN zapier_webhook_url TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN zapier_secret TEXT`); } catch {}

  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id),
      author_name TEXT NOT NULL,
      upvotes INTEGER DEFAULT 0,
      is_answered INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS forum_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES forum_posts(id),
      body TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id),
      author_name TEXT NOT NULL,
      upvotes INTEGER DEFAULT 0,
      is_accepted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS forum_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES forum_posts(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(post_id, user_id)
    )`);
  } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS forum_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(entity_type, entity_id, user_id)
    )`);
  } catch {}

  // ── Push notifications (Web Push / VAPID) ──────────────────────────────
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN vapid_public_key TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN vapid_private_key TEXT`); } catch {}

  // ── SMS notifications (Twilio) ─────────────────────────────────────────
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN twilio_account_sid TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN twilio_auth_token TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE webhook_settings ADD COLUMN twilio_from_number TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN sms_reminders_enabled INTEGER NOT NULL DEFAULT 0`); } catch {}
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      org_id INTEGER NOT NULL DEFAULT 1,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, endpoint)
    )`);
  } catch {}
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`); } catch {}

  // ── Glossary terms (admin-editable, per-org) ────────────────────────────
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS glossary_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL DEFAULT 1,
        term TEXT NOT NULL,
        definition TEXT NOT NULL,
        category TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(org_id, term)
      )
    `);
  } catch {}
  try { seedGlossaryTerms(); } catch (e) { console.error("[glossary seed]", e); }
}
runNewMigrations();

function seedGlossaryTerms() {
  const SEED: Array<{ term: string; category: string; definition: string }> = [
    // ── Mortgage Basics (20) ─────────────────────────────────────────────
    { term: "Principal", category: "Mortgage Basics", definition: "The original loan amount a borrower owes before interest. Each monthly payment reduces principal over time through amortization." },
    { term: "Interest Rate", category: "Mortgage Basics", definition: "The annual percentage the lender charges for borrowing money, expressed as a rate. Does not include fees — see APR for the all-in cost." },
    { term: "APR", category: "Mortgage Basics", definition: "Annual Percentage Rate. The total yearly cost of a loan including interest plus most fees (origination, points, mortgage insurance). Always higher than the note rate." },
    { term: "Amortization", category: "Mortgage Basics", definition: "The schedule by which a loan is paid off over time. Early payments are mostly interest; later payments are mostly principal." },
    { term: "Equity", category: "Mortgage Basics", definition: "The difference between a home's current market value and the remaining mortgage balance. Grows as the borrower pays down principal or the home appreciates." },
    { term: "LTV", category: "Mortgage Basics", definition: "Loan-to-Value ratio. The loan amount divided by the property's appraised value, expressed as a percentage. LTV above 80% typically requires mortgage insurance." },
    { term: "DTI", category: "Mortgage Basics", definition: "Debt-to-Income ratio. The percentage of a borrower's gross monthly income that goes to debt payments. Most lenders cap DTI around 43–50% depending on program." },
    { term: "PITI", category: "Mortgage Basics", definition: "Principal, Interest, Taxes, and Insurance. The four components of a typical monthly mortgage payment when taxes and insurance are escrowed." },
    { term: "Escrow", category: "Mortgage Basics", definition: "An account the lender holds to pay property taxes and homeowners insurance on the borrower's behalf. Funded monthly as part of PITI." },
    { term: "Down Payment", category: "Mortgage Basics", definition: "Cash the borrower pays upfront toward the home's purchase price. Typical minimums range from 0% (VA/USDA) to 3–5% (conventional, FHA) to 20% (to avoid PMI)." },
    { term: "Closing Costs", category: "Mortgage Basics", definition: "Fees paid at loan closing — usually 2–5% of the loan amount. Includes lender fees, title, appraisal, recording, and prepaid escrow items." },
    { term: "Title", category: "Mortgage Basics", definition: "Legal ownership of a property. A title search confirms the seller has the right to transfer it; title insurance protects against hidden defects." },
    { term: "Appraisal", category: "Mortgage Basics", definition: "A licensed appraiser's independent estimate of a home's market value. Required by lenders to confirm the loan amount is supported by collateral." },
    { term: "Underwriting", category: "Mortgage Basics", definition: "The lender's review of a borrower's credit, income, assets, and the property to decide whether to approve the loan and at what terms." },
    { term: "Pre-qualification", category: "Mortgage Basics", definition: "An informal estimate of how much a borrower might qualify to borrow, based on self-reported income and debts. Not a commitment to lend." },
    { term: "Pre-approval", category: "Mortgage Basics", definition: "A conditional commitment from a lender based on verified credit, income, and asset documents. Stronger than a pre-qualification when making an offer." },
    { term: "Rate Lock", category: "Mortgage Basics", definition: "A lender's guarantee to hold a specific interest rate for a fixed window (typically 30–60 days) while the loan is being processed." },
    { term: "Points", category: "Mortgage Basics", definition: "Upfront fees paid at closing to lower the note rate (discount points) or to compensate the originator (origination points). Each point equals 1% of the loan amount." },
    { term: "Origination Fee", category: "Mortgage Basics", definition: "The lender's charge for processing, underwriting, and funding the loan. Disclosed on the Loan Estimate and Closing Disclosure." },
    { term: "PMI", category: "Mortgage Basics", definition: "Private Mortgage Insurance. Required on conventional loans with LTV above 80%. Protects the lender if the borrower defaults; can be removed once LTV reaches 78–80%." },

    // ── Loan Types (15) ──────────────────────────────────────────────────
    { term: "Conventional Loan", category: "Loan Types", definition: "A standard mortgage not insured or guaranteed by the federal government. Follows Fannie Mae/Freddie Mac guidelines if conforming. Typically needs 3–5% down and a 620+ score." },
    { term: "FHA Loan", category: "Loan Types", definition: "A mortgage insured by the Federal Housing Administration. Lower credit and down payment requirements (3.5% down with 580+ score) but carries mortgage insurance for the life of the loan in most cases." },
    { term: "VA Loan", category: "Loan Types", definition: "A mortgage guaranteed by the U.S. Department of Veterans Affairs for eligible service members, veterans, and surviving spouses. No down payment, no PMI, capped closing costs." },
    { term: "USDA Loan", category: "Loan Types", definition: "A USDA-backed mortgage for low- to moderate-income buyers in eligible rural and suburban areas. No down payment required; has income and geographic limits." },
    { term: "Jumbo Loan", category: "Loan Types", definition: "A mortgage that exceeds the conforming loan limit set by the FHFA (above $766,550 in most areas for 2024). Requires stronger credit, larger reserves, and bigger down payments." },
    { term: "Conforming Loan", category: "Loan Types", definition: "A conventional loan that meets Fannie Mae / Freddie Mac underwriting standards, including the maximum loan limit. Conforming loans generally get the best rates." },
    { term: "ARM", category: "Loan Types", definition: "Adjustable Rate Mortgage. Rate is fixed for an initial period (3, 5, 7, or 10 years) then adjusts periodically based on an index plus a margin. Lower initial rates than fixed; payment risk later." },
    { term: "Fixed-Rate Mortgage", category: "Loan Types", definition: "A loan whose interest rate stays the same for the entire term. 30-year and 15-year fixed are the most common products." },
    { term: "Interest-Only Loan", category: "Loan Types", definition: "A loan where the borrower pays only interest for an initial period (usually 5–10 years). Principal balance doesn't drop during that window; payments jump when principal amortization begins." },
    { term: "Reverse Mortgage", category: "Loan Types", definition: "A loan for homeowners 62+ that converts home equity into cash. No monthly payments required; balance is repaid when the borrower sells, moves out, or passes away." },
    { term: "HELOC", category: "Loan Types", definition: "Home Equity Line of Credit. A revolving line secured by home equity, like a credit card. Typically has a draw period (interest-only) then a repayment period with variable rates." },
    { term: "Home Equity Loan", category: "Loan Types", definition: "A second mortgage with a fixed rate and fixed payment, funded as a lump sum. Unlike a HELOC, the borrower gets all the money upfront and repays on a schedule." },
    { term: "Bridge Loan", category: "Loan Types", definition: "A short-term loan that lets a buyer tap equity in their current home to purchase a new one before the old one sells. Typically higher rate and fees." },
    { term: "Construction Loan", category: "Loan Types", definition: "A short-term loan funded in draws to pay for building or renovating a home. Often converts to a permanent mortgage once construction is complete." },
    { term: "Refinance", category: "Loan Types", definition: "Replacing an existing mortgage with a new one — usually to lower the rate, change the term, switch programs, or tap equity (cash-out refinance)." },

    // ── CLR Operations (20) ──────────────────────────────────────────────
    { term: "Transfer", category: "CLR Operations", definition: "The act of connecting a qualified lead to a Loan Officer. Can be a warm transfer (introduced live) or a direct transfer (cold hand-off). Counted as a key CLR performance metric." },
    { term: "Fell Through", category: "CLR Operations", definition: "A transfer or appointment that did not convert — e.g. the LO could not reach the prospect, the prospect declined, or the deal collapsed after hand-off." },
    { term: "Callback", category: "CLR Operations", definition: "A prospect who asked to be called back at a specific time, or whom the CLR must re-attempt after initially failing to reach. Tracked for follow-up discipline." },
    { term: "Future Contact", category: "CLR Operations", definition: "A lead that isn't ready to apply now but is worth nurturing (e.g. rate watching, lease ending in 6 months). Flagged for scheduled outreach." },
    { term: "No Answer", category: "CLR Operations", definition: "A dial attempt where the prospect didn't pick up and voicemail either failed or was skipped. Logged so the auto-dialer/CLR can retry later per cadence rules." },
    { term: "Deferral", category: "CLR Operations", definition: "A lead intentionally skipped for now — usually because the prospect asked to be contacted at a later date, or circumstances (credit, income) aren't yet workable." },
    { term: "Lead", category: "CLR Operations", definition: "Any inbound or sourced prospect record assigned to a CLR for outreach. Leads progress through stages: new → attempted → contacted → qualified → transferred." },
    { term: "Prospect", category: "CLR Operations", definition: "A lead with whom the CLR has had contact and who has expressed potential interest. Prospects are candidates for transfer to an LO." },
    { term: "Cold Call", category: "CLR Operations", definition: "An unsolicited outbound call to a lead with whom no prior contact exists. Contrast with warm leads that came from a referral, web form, or prior interaction." },
    { term: "Warm Transfer", category: "CLR Operations", definition: "A live three-way introduction where the CLR stays on the line, introduces the prospect to the LO, and then drops off. The highest-converting transfer type." },
    { term: "Direct Transfer", category: "CLR Operations", definition: "A transfer where the CLR hands the call off to the LO without a live three-way introduction (e.g. routed through a queue). Lower conversion than warm transfers." },
    { term: "LO", category: "CLR Operations", definition: "Loan Officer. The licensed mortgage professional who takes the application, quotes rates, and shepherds the loan through closing after a CLR transfer." },
    { term: "CLR", category: "CLR Operations", definition: "Client Lending Representative. The team member who handles first contact with leads, qualifies them, and transfers them to the appropriate LO." },
    { term: "Pipeline", category: "CLR Operations", definition: "The collective set of active leads/prospects a CLR or LO is working. Health of the pipeline (count, stages, aging) predicts future closings." },
    { term: "Conversion Rate", category: "CLR Operations", definition: "The percentage of leads that progress from one stage to the next — e.g. calls-to-transfers, transfers-to-applications, applications-to-closed." },
    { term: "Daily Assignment", category: "CLR Operations", definition: "The LO a CLR is paired with for a given shift. Drives where transfers go that day. Managed by the assignment algorithm in Settings." },
    { term: "EOD Report", category: "CLR Operations", definition: "End-of-Day Report. Each CLR submits their shift totals (calls, transfers, appointments, fell-through, notes) at the end of their shift. Triggers an email to managers." },
    { term: "Call History", category: "CLR Operations", definition: "The full record of dial attempts and outcomes against a given lead. Used to enforce cadence rules and to avoid over-calling." },
    { term: "Outcome", category: "CLR Operations", definition: "The disposition a CLR marks after each attempt — e.g. Transfer, No Answer, Callback, Fell Through, Deferral, Future Contact. Feeds dashboards and conversion metrics." },
    { term: "Script", category: "CLR Operations", definition: "An approved talk track CLRs use for specific call scenarios — intros, objections, qualifying questions, transfer hand-offs. Maintained in the Resources section." },

    // ── Credit & Finance (15) ─────────────────────────────────────────────
    { term: "Credit Score", category: "Credit & Finance", definition: "A three-digit number (usually 300–850) summarizing a borrower's creditworthiness. FICO and VantageScore are the two main scoring models." },
    { term: "FICO Score", category: "Credit & Finance", definition: "The credit score model most mortgage lenders use. Ranges 300–850; 740+ is generally considered excellent for mortgage pricing." },
    { term: "Credit Report", category: "Credit & Finance", definition: "The detailed record of a borrower's credit accounts, balances, payment history, and inquiries — maintained by the three bureaus (Equifax, Experian, TransUnion)." },
    { term: "Hard Inquiry", category: "Credit & Finance", definition: "A credit pull tied to a credit application (e.g. mortgage, auto, credit card). Can lower the score a few points and stays on the report for two years." },
    { term: "Soft Inquiry", category: "Credit & Finance", definition: "A credit pull that does not affect the score — e.g. a borrower checking their own credit, pre-qualification, or employer background check." },
    { term: "Debt Consolidation", category: "Credit & Finance", definition: "Combining multiple debts into a single loan, often at a lower rate. Cash-out refinances and HELOCs are commonly used for this." },
    { term: "Bankruptcy", category: "Credit & Finance", definition: "A legal filing that discharges or restructures debts. Seasoning periods apply before a borrower can qualify for a new mortgage — typically 2–4 years post-discharge." },
    { term: "Foreclosure", category: "Credit & Finance", definition: "The legal process a lender uses to take and sell a property after the borrower defaults. Makes qualifying for a new mortgage difficult for 3–7 years depending on program." },
    { term: "Short Sale", category: "Credit & Finance", definition: "A sale where the lender agrees to accept less than the full mortgage balance to avoid foreclosure. Less damaging to credit than foreclosure but still requires a seasoning period." },
    { term: "Default", category: "Credit & Finance", definition: "The failure to make mortgage payments as agreed. Triggers late fees, credit reporting, and eventually foreclosure proceedings if not cured." },
    { term: "Collections", category: "Credit & Finance", definition: "An account that has been turned over to a third-party collection agency after the borrower failed to pay. Large collections can block mortgage approval until resolved." },
    { term: "Charge-off", category: "Credit & Finance", definition: "A debt the original creditor has written off as uncollectible — usually after 180 days of non-payment. The debt is still owed and severely damages credit." },
    { term: "Derogatory Mark", category: "Credit & Finance", definition: "Any negative item on a credit report — late payment, collection, charge-off, foreclosure, bankruptcy, judgment. Each drags the score down and complicates approval." },
    { term: "Credit Utilization", category: "Credit & Finance", definition: "The percentage of available revolving credit currently used. Below 30% is healthy; below 10% optimizes the score. A major factor in FICO calculation." },
    { term: "Credit History", category: "Credit & Finance", definition: "The length and depth of a borrower's credit record. Longer history with on-time payments improves scores; thin files (few accounts) can hurt mortgage approval." },

    // ── Property & Title (15) ────────────────────────────────────────────
    { term: "Title Insurance", category: "Property & Title", definition: "A policy that protects against losses from title defects (liens, boundary disputes, forged deeds). Lenders require their own policy; owners' policies are optional but recommended." },
    { term: "Clear Title", category: "Property & Title", definition: "A title free of liens, disputes, or encumbrances that would prevent transfer of ownership. Must be established before closing." },
    { term: "Lien", category: "Property & Title", definition: "A legal claim on a property used as security for a debt (mortgage lien, tax lien, mechanic's lien). Must usually be paid off or subordinated before a sale." },
    { term: "Deed", category: "Property & Title", definition: "The legal document that transfers ownership of real estate from one party to another. Recorded in the county to put the public on notice of ownership." },
    { term: "Deed of Trust", category: "Property & Title", definition: "A security instrument used in many states instead of a mortgage. Involves three parties — borrower, lender, and trustee — and typically allows non-judicial foreclosure." },
    { term: "Mortgage Note", category: "Property & Title", definition: "The promissory note the borrower signs promising to repay the loan. Paired with the mortgage/deed of trust which pledges the property as collateral." },
    { term: "Easement", category: "Property & Title", definition: "A right allowing another party to use a portion of the property for a specific purpose (e.g. a utility easement, shared driveway). Survives title transfers." },
    { term: "Encumbrance", category: "Property & Title", definition: "Any claim, lien, restriction, or easement on a property that may affect its use or transfer. Includes mortgages, tax liens, HOA covenants, and easements." },
    { term: "Chain of Title", category: "Property & Title", definition: "The historical record of every owner of a property since it was first recorded. A break in the chain can cloud title and must be cured before sale." },
    { term: "Abstract of Title", category: "Property & Title", definition: "A condensed written history of a property's chain of title and any recorded encumbrances. Used by attorneys or title companies to certify marketability." },
    { term: "Survey", category: "Property & Title", definition: "A licensed surveyor's drawing showing property boundaries, improvements, and encroachments. Often required by lenders on certain property types." },
    { term: "Plat Map", category: "Property & Title", definition: "A recorded map showing how a tract of land is subdivided into lots, streets, and easements. Referenced in legal descriptions." },
    { term: "Zoning", category: "Property & Title", definition: "Municipal rules that dictate how land can be used (residential, commercial, mixed-use) and what can be built. Zoning violations can derail a closing." },
    { term: "HOA", category: "Property & Title", definition: "Homeowners Association. A governing body for a planned community or condo that enforces covenants and collects dues. HOA dues count against DTI." },
    { term: "Condo Association", category: "Property & Title", definition: "The governing body of a condominium project, which manages shared areas and collects assessments. Lenders review the association's financials before approving a condo loan." },

    // ── Regulatory & Compliance (15) ─────────────────────────────────────
    { term: "RESPA", category: "Regulatory & Compliance", definition: "Real Estate Settlement Procedures Act. Federal law regulating mortgage disclosures and prohibiting kickbacks or referral fees between settlement service providers." },
    { term: "TILA", category: "Regulatory & Compliance", definition: "Truth in Lending Act. Federal law requiring clear disclosure of loan costs and APR so consumers can comparison-shop. The parent statute behind the Loan Estimate and Closing Disclosure." },
    { term: "TRID", category: "Regulatory & Compliance", definition: "TILA-RESPA Integrated Disclosure. The 2015 rule combining TILA and RESPA disclosures into two forms: the Loan Estimate (early) and Closing Disclosure (final)." },
    { term: "GFE", category: "Regulatory & Compliance", definition: "Good Faith Estimate. The pre-TRID form that disclosed expected loan costs. Replaced by the Loan Estimate in October 2015 but still referenced colloquially." },
    { term: "Loan Estimate", category: "Regulatory & Compliance", definition: "The three-page form a lender must deliver within three business days of application. Shows the rate, payment, and estimated closing costs so buyers can comparison-shop." },
    { term: "Closing Disclosure", category: "Regulatory & Compliance", definition: "The five-page form delivered at least three business days before closing. Shows the final loan terms and exact closing costs — and must match the Loan Estimate within tight tolerances." },
    { term: "ATR", category: "Regulatory & Compliance", definition: "Ability to Repay. The Dodd-Frank requirement that lenders make a reasonable, good-faith determination a borrower can repay the loan before funding it." },
    { term: "QM", category: "Regulatory & Compliance", definition: "Qualified Mortgage. A loan category that meets specific ATR safe-harbor criteria (no risky features, capped fees, DTI limits). Gives lenders liability protection." },
    { term: "HMDA", category: "Regulatory & Compliance", definition: "Home Mortgage Disclosure Act. Requires lenders to collect and report data on mortgage applications and originations, used to monitor fair lending and community investment." },
    { term: "Fair Lending", category: "Regulatory & Compliance", definition: "The federal framework (ECOA, FHA) prohibiting discrimination in credit decisions based on race, color, religion, national origin, sex, marital status, age, or public assistance status." },
    { term: "ECOA", category: "Regulatory & Compliance", definition: "Equal Credit Opportunity Act. Federal law making it illegal to discriminate in any aspect of a credit transaction on protected-class grounds." },
    { term: "FCRA", category: "Regulatory & Compliance", definition: "Fair Credit Reporting Act. Governs how consumer credit information is collected, shared, and used. Requires adverse-action notices when credit is denied." },
    { term: "NMLS", category: "Regulatory & Compliance", definition: "Nationwide Multistate Licensing System. The registry where loan officers and mortgage companies are licensed. Each LO has a unique NMLS ID that must appear on disclosures." },
    { term: "Licensing", category: "Regulatory & Compliance", definition: "The state and federal credentials a mortgage professional must hold to originate loans. Maintained via NMLS; renewed annually with continuing education." },
    { term: "Compliance", category: "Regulatory & Compliance", definition: "The discipline of ensuring all loan activities follow applicable federal, state, and investor rules. Violations can trigger penalties, rescission, or repurchase demands." },
  ];

  const stmt = sqlite.prepare(
    `INSERT OR IGNORE INTO glossary_terms (org_id, term, definition, category) VALUES (1, ?, ?, ?)`
  );
  const tx = sqlite.transaction((rows: typeof SEED) => {
    for (const r of rows) stmt.run(r.term, r.definition, r.category);
  });
  tx(SEED);
}

// ── Forum storage helpers ──────────────────────────────────────────────────
export function listForumPosts(currentUserId: number, search?: string) {
  const searchLike = search ? `%${search.toLowerCase()}%` : null;
  const rows = searchLike
    ? sqlite.prepare(`SELECT * FROM forum_posts WHERE LOWER(title) LIKE ? OR LOWER(body) LIKE ? ORDER BY is_pinned DESC, created_at DESC`).all(searchLike, searchLike)
    : sqlite.prepare(`SELECT * FROM forum_posts ORDER BY is_pinned DESC, created_at DESC`).all();
  return (rows as any[]).map((p) => {
    const answerCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM forum_answers WHERE post_id = ?`).get(p.id) as any).c;
    const hasAccepted = (sqlite.prepare(`SELECT COUNT(*) as c FROM forum_answers WHERE post_id = ? AND is_accepted = 1`).get(p.id) as any).c > 0;
    const isSubscribed = (sqlite.prepare(`SELECT 1 FROM forum_subscriptions WHERE post_id = ? AND user_id = ?`).get(p.id, currentUserId) as any) ? 1 : 0;
    const hasUpvoted = (sqlite.prepare(`SELECT 1 FROM forum_votes WHERE entity_type='post' AND entity_id = ? AND user_id = ?`).get(p.id, currentUserId) as any) ? 1 : 0;
    return { ...p, answer_count: answerCount, has_accepted_answer: hasAccepted, is_subscribed: isSubscribed, has_upvoted: hasUpvoted };
  });
}

export function getForumPostById(id: number, currentUserId: number) {
  const post = sqlite.prepare(`SELECT * FROM forum_posts WHERE id = ?`).get(id) as any;
  if (!post) return null;
  const answers = sqlite.prepare(`SELECT * FROM forum_answers WHERE post_id = ? ORDER BY is_accepted DESC, upvotes DESC, created_at ASC`).all(id) as any[];
  const isSubscribed = (sqlite.prepare(`SELECT 1 FROM forum_subscriptions WHERE post_id = ? AND user_id = ?`).get(id, currentUserId) as any) ? 1 : 0;
  const hasUpvoted = (sqlite.prepare(`SELECT 1 FROM forum_votes WHERE entity_type='post' AND entity_id = ? AND user_id = ?`).get(id, currentUserId) as any) ? 1 : 0;
  const enrichedAnswers = answers.map((a) => {
    const upv = (sqlite.prepare(`SELECT 1 FROM forum_votes WHERE entity_type='answer' AND entity_id = ? AND user_id = ?`).get(a.id, currentUserId) as any) ? 1 : 0;
    return { ...a, has_upvoted: upv };
  });
  return { ...post, is_subscribed: isSubscribed, has_upvoted: hasUpvoted, answers: enrichedAnswers };
}

export function createForumPost(data: { title: string; body: string; authorId: number; authorName: string }) {
  const now = new Date().toISOString();
  const info = sqlite.prepare(`INSERT INTO forum_posts (title, body, author_id, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(data.title, data.body, data.authorId, data.authorName, now, now);
  sqlite.prepare(`INSERT OR IGNORE INTO forum_subscriptions (post_id, user_id, created_at) VALUES (?, ?, ?)`)
    .run(info.lastInsertRowid, data.authorId, now);
  return sqlite.prepare(`SELECT * FROM forum_posts WHERE id = ?`).get(info.lastInsertRowid) as any;
}

export function updateForumPost(id: number, data: Partial<{ title: string; body: string; is_pinned: number; is_answered: number }>) {
  const fields: string[] = [];
  const vals: any[] = [];
  for (const k of Object.keys(data)) {
    fields.push(`${k} = ?`);
    vals.push((data as any)[k]);
  }
  if (!fields.length) return;
  fields.push(`updated_at = ?`);
  vals.push(new Date().toISOString());
  vals.push(id);
  sqlite.prepare(`UPDATE forum_posts SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return sqlite.prepare(`SELECT * FROM forum_posts WHERE id = ?`).get(id) as any;
}

export function deleteForumPost(id: number) {
  sqlite.prepare(`DELETE FROM forum_answers WHERE post_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM forum_subscriptions WHERE post_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM forum_votes WHERE entity_type='post' AND entity_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM forum_posts WHERE id = ?`).run(id);
}

export function createForumAnswer(data: { postId: number; body: string; authorId: number; authorName: string }) {
  const now = new Date().toISOString();
  const info = sqlite.prepare(`INSERT INTO forum_answers (post_id, body, author_id, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(data.postId, data.body, data.authorId, data.authorName, now, now);
  return sqlite.prepare(`SELECT * FROM forum_answers WHERE id = ?`).get(info.lastInsertRowid) as any;
}

export function getForumAnswerById(id: number) {
  return sqlite.prepare(`SELECT * FROM forum_answers WHERE id = ?`).get(id) as any;
}

export function updateForumAnswer(id: number, data: Partial<{ body: string; is_accepted: number }>) {
  const fields: string[] = [];
  const vals: any[] = [];
  for (const k of Object.keys(data)) {
    fields.push(`${k} = ?`);
    vals.push((data as any)[k]);
  }
  if (!fields.length) return;
  fields.push(`updated_at = ?`);
  vals.push(new Date().toISOString());
  vals.push(id);
  sqlite.prepare(`UPDATE forum_answers SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return sqlite.prepare(`SELECT * FROM forum_answers WHERE id = ?`).get(id) as any;
}

export function deleteForumAnswer(id: number) {
  const a = sqlite.prepare(`SELECT post_id FROM forum_answers WHERE id = ?`).get(id) as any;
  sqlite.prepare(`DELETE FROM forum_votes WHERE entity_type='answer' AND entity_id = ?`).run(id);
  sqlite.prepare(`DELETE FROM forum_answers WHERE id = ?`).run(id);
  return a;
}

export function toggleForumVote(entityType: "post" | "answer", entityId: number, userId: number) {
  const existing = sqlite.prepare(`SELECT id FROM forum_votes WHERE entity_type = ? AND entity_id = ? AND user_id = ?`).get(entityType, entityId, userId) as any;
  const table = entityType === "post" ? "forum_posts" : "forum_answers";
  if (existing) {
    sqlite.prepare(`DELETE FROM forum_votes WHERE id = ?`).run(existing.id);
    sqlite.prepare(`UPDATE ${table} SET upvotes = MAX(0, upvotes - 1) WHERE id = ?`).run(entityId);
    return { upvoted: false };
  }
  sqlite.prepare(`INSERT INTO forum_votes (entity_type, entity_id, user_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(entityType, entityId, userId, new Date().toISOString());
  sqlite.prepare(`UPDATE ${table} SET upvotes = upvotes + 1 WHERE id = ?`).run(entityId);
  return { upvoted: true };
}

export function toggleForumSubscription(postId: number, userId: number) {
  const existing = sqlite.prepare(`SELECT id FROM forum_subscriptions WHERE post_id = ? AND user_id = ?`).get(postId, userId) as any;
  if (existing) {
    sqlite.prepare(`DELETE FROM forum_subscriptions WHERE id = ?`).run(existing.id);
    return { subscribed: false };
  }
  sqlite.prepare(`INSERT INTO forum_subscriptions (post_id, user_id, created_at) VALUES (?, ?, ?)`)
    .run(postId, userId, new Date().toISOString());
  return { subscribed: true };
}

export function getForumSubscribers(postId: number): number[] {
  const rows = sqlite.prepare(`SELECT user_id FROM forum_subscriptions WHERE post_id = ?`).all(postId) as any[];
  return rows.map((r) => r.user_id);
}

export function acceptForumAnswer(postId: number, answerId: number) {
  sqlite.prepare(`UPDATE forum_answers SET is_accepted = 0 WHERE post_id = ?`).run(postId);
  sqlite.prepare(`UPDATE forum_answers SET is_accepted = 1 WHERE id = ?`).run(answerId);
  sqlite.prepare(`UPDATE forum_posts SET is_answered = 1, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), postId);
}


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
export type ReportType = "daily" | "weekly" | "monthly" | "mtd" | "alltime";

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
  try { sqlite.prepare(`DELETE FROM chat_reactions WHERE message_id=?`).run(id); } catch {}
}
export function toggleChatReaction(messageId: number, userId: number, emoji: string): { added: boolean } {
  const existing = sqlite.prepare(`SELECT id FROM chat_reactions WHERE message_id=? AND user_id=? AND emoji=?`).get(messageId, userId, emoji) as any;
  if (existing) { sqlite.prepare(`DELETE FROM chat_reactions WHERE id=?`).run(existing.id); return { added: false }; }
  sqlite.prepare(`INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)`).run(messageId, userId, emoji);
  return { added: true };
}
export function getChatReactionsForMessages(ids: number[]): any[] {
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  return sqlite.prepare(`SELECT message_id, user_id, emoji FROM chat_reactions WHERE message_id IN (${ph})`).all(...ids) as any[];
}

export function deleteUserCascade(id: number): void {
  // PRESERVED FOR BACKCOMPAT: now performs an ARCHIVE instead of a destructive
  // delete. The user is deactivated and their email is suffixed so it can be
  // reused for a new invite, but all of their data — outcomes, EOD reports,
  // call logs, assignments, audit logs, notifications, NMLS checks, chat —
  // is left intact for historical reporting.
  archiveUser(id);
}

export function archiveUser(id: number): void {
  const user = sqlite.prepare(`SELECT id, email, is_active, archived_at FROM users WHERE id = ?`).get(id) as any;
  if (!user) return;
  if (user.archived_at) return; // already archived — idempotent

  const today = new Date().toISOString().slice(0, 10);
  // Suffix the email so the address can be reused for a future invite
  // without violating the UNIQUE constraint. Keep the original visible
  // in the suffix for forensics.
  const originalEmail: string = String(user.email ?? "");
  const suffixedEmail = originalEmail.includes("[archived")
    ? originalEmail
    : `${originalEmail} [archived ${today}]`;

  sqlite.prepare(`
    UPDATE users
    SET is_active = 0,
        archived_at = datetime('now'),
        email = ?
    WHERE id = ?
  `).run(suffixedEmail, id);

  // Clear any pending password-reset tokens so the archived account can't be
  // used to recover access.
  sqlite.prepare(`UPDATE users SET reset_token = NULL, reset_token_expiry = NULL WHERE id = ?`).run(id);
}

export function restoreUser(id: number): void {
  const user = sqlite.prepare(`SELECT id, email, archived_at FROM users WHERE id = ?`).get(id) as any;
  if (!user || !user.archived_at) return;
  const restoredEmail = String(user.email ?? "").replace(/\s*\[archived [^\]]+\]\s*$/, "");
  sqlite.prepare(`
    UPDATE users
    SET is_active = 1, archived_at = NULL, email = ?
    WHERE id = ?
  `).run(restoredEmail, id);
}

// ── EOD Reports ───────────────────────────────────────────────────────────────
export function getEodReport(reportDate: string, assistantId: number): any {
  return sqlite.prepare(`SELECT * FROM eod_reports WHERE report_date=? AND assistant_id=?`).get(reportDate, assistantId) as any ?? null;
}

export function upsertEodReport(data: { reportDate: string; assistantId: number; callsMade: number; messagesSent?: number; transfers: number; appointments: number; notes?: string | null; assignedLosCalled?: number[]; additionalLosCalled?: number[]; additionalLosOtherNotes?: string | null }): any {
  const assignedJson = JSON.stringify(Array.isArray(data.assignedLosCalled) ? data.assignedLosCalled.map(n => Number(n)).filter(Number.isFinite) : []);
  const additionalJson = JSON.stringify(Array.isArray(data.additionalLosCalled) ? data.additionalLosCalled.map(n => Number(n)).filter(Number.isFinite) : []);
  const otherNotes = typeof data.additionalLosOtherNotes === "string" && data.additionalLosOtherNotes.trim()
    ? data.additionalLosOtherNotes.trim()
    : null;
  const messagesSent = Number.isFinite(Number(data.messagesSent)) ? Math.max(0, Math.round(Number(data.messagesSent))) : 0;
  sqlite.prepare(`
    INSERT INTO eod_reports (report_date, assistant_id, calls_made, messages_sent, transfers, appointments, notes, assigned_los_called, additional_los_called, additional_los_other_notes, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(report_date, assistant_id) DO UPDATE SET
      calls_made=excluded.calls_made, messages_sent=excluded.messages_sent, transfers=excluded.transfers,
      appointments=excluded.appointments, notes=excluded.notes,
      assigned_los_called=excluded.assigned_los_called,
      additional_los_called=excluded.additional_los_called,
      additional_los_other_notes=excluded.additional_los_other_notes,
      submitted_at=datetime('now')
  `).run(data.reportDate, data.assistantId, data.callsMade, messagesSent, data.transfers, data.appointments, data.notes ?? null, assignedJson, additionalJson, otherNotes);
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
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'ethan_wcl_script_v5'`).get();
  if (done) return;

  // Wipe only the default (shared) script — owner_id IS NULL. Personal CLR copies
  // have owner_id set and are deliberately preserved across upgrades.
  // Use individual prepare/run rather than exec() to ensure subquery support.
  sqlite.prepare(`
    DELETE FROM script_responses WHERE node_id IN (
      SELECT sn.id FROM script_nodes sn
      JOIN call_scripts cs ON cs.id = sn.script_id
      WHERE cs.owner_id IS NULL
    )
  `).run();
  sqlite.prepare(`
    DELETE FROM script_nodes WHERE script_id IN (
      SELECT id FROM call_scripts WHERE owner_id IS NULL
    )
  `).run();
  sqlite.prepare(`DELETE FROM call_scripts WHERE owner_id IS NULL`).run();

  const node = (scriptId: number, parentId: number | null, text: string, hint: string, order: number) =>
    sqlite.prepare(`INSERT INTO script_nodes (script_id, parent_node_id, text, hint, node_order) VALUES (?,?,?,?,?)`)
      .run(scriptId, parentId, text, hint, order).lastInsertRowid as number;

  const resp = (nodeId: number, label: string, color: string, nextId: number | null, order: number) =>
    sqlite.prepare(`INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?,?,?,?,?)`)
      .run(nodeId, label, color, nextId, order);

  // ── Script ────────────────────────────────────────────────────────────────
  const sid = sqlite.prepare(`INSERT INTO call_scripts (name, description, created_by) VALUES (?,?,?)`)
    .run("WCL Cold Call Script v5", "West Capital Lending official CLR script — Ethan's conversational opener with cash-out qualifying, shopping/lender comparison, future, selling, wrong-person, and hostile paths.", 1)
    .lastInsertRowid as number;

  // ══════════════════════════════════════════════════════════════════════════
  // OPENING
  // ══════════════════════════════════════════════════════════════════════════
  const nOpen = node(sid, null,
    `Hi, is this [Borrower Name]? Great — [Borrower Name], good [morning/afternoon/evening]! This is [Your Name] calling from West Capital Lending. How are you doing today?\n\n[PAUSE — let them respond]\n\nThe reason I'm reaching out is we received an inquiry under your name for either a refinance or a Home Equity Line of Credit. I just wanted to take a couple of minutes to learn more about what you're hoping to accomplish and see if we can point you in the right direction.`,
    `Warm and unhurried. Pause after their name — confidence. Actually let them answer "how are you doing" before you give the reason for the call.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // CASH OUT — QUALIFYING
  // ══════════════════════════════════════════════════════════════════════════
  const nCashOut = node(sid, nOpen,
    `Awesome! Can you confirm a few quick things for me:\n\n1) Your address\n2) How much you're looking to take out\n3) What it's for\n4) Ballpark credit score\n5) And your income?`,
    `Work through it like a conversation, not a checklist. Purpose matters most — debt consolidation and renovation are the hottest hand-offs. If they hesitate on credit or income: "Even a range is fine — it doesn't impact anything at this stage."`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // DIRECT TRANSFER
  // ══════════════════════════════════════════════════════════════════════════
  const nTransfer = node(sid, nCashOut,
    `Perfect — that's everything I need. I'm going to connect you right now with [LO Name], our specialist for your area. I'm actually [LO Name]'s direct assistant, so I won't even put you on hold — I have them right here. It was a pleasure, [Borrower Name] — good luck!\n\n[BEFORE YOU HAND OFF — brief the LO]: "Hey [LO Name], I've got [Borrower Name] — looking to take out [amount] for [purpose], property at [address], credit around [range], income about [amount]."`,
    `Smooth and confident — hesitation kills transfers. Pre-brief the LO every single time. If the LO isn't available, pivot straight to an appointment — never leave the borrower hanging.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // APPOINTMENT
  // ══════════════════════════════════════════════════════════════════════════
  const nAppointment = node(sid, nCashOut,
    `Totally understand — let me set up a quick call with [LO Name] instead, so they can give you their full attention.\n\nWhat works better for you — mornings or afternoons? And are weekdays or weekends easier?\n\n[GET SPECIFIC]: "Perfect — so let's put you down for [Day] at [Time]. The best number for you is the one I called today?"\n\nYou'll get a confirmation and a reminder before the call. Does that work?`,
    `Get a specific day AND time — "sometime this week" is not an appointment. Confirm their number. Log it in Upcoming Appointments immediately.`,
    2);

  // ══════════════════════════════════════════════════════════════════════════
  // NOT SURE / NOT LOOKING ANYMORE
  // ══════════════════════════════════════════════════════════════════════════
  const nNotSure = node(sid, nOpen,
    `Okay. What made you make the inquiry in the first place?`,
    `Don't accept "not sure" at face value — the original reason is still in there somewhere. Stay curious, not pushy. Their answer tells you exactly where to route the call.`,
    2);

  // ══════════════════════════════════════════════════════════════════════════
  // SHOPPING AROUND
  // ══════════════════════════════════════════════════════════════════════════
  const nShopping = node(sid, nOpen,
    `That's extremely bright of you. Well, here at West Cap we're a wholesale broker, meaning that we work with over 150 lenders to get you a rate that beats one that you would get if you went into a local bank.\n\nDo you mind if I ask you a couple quick questions so we can show you a real number to compare?`,
    `Shoppers are warm — they're already in the market. Your goal is to become the benchmark they compare everyone else against. Keep it effortless: two minutes, a real number, no pressure.`,
    3);

  // ══════════════════════════════════════════════════════════════════════════
  // NO THANKS, I'M GOOD
  // ══════════════════════════════════════════════════════════════════════════
  const nChangedMind = node(sid, nOpen,
    `Okay, I mean I totally understand that things change. What made you change your mind?`,
    `Their reason routes the call: rates → rates path, timing → future, selling → selling path, another lender → comparison pitch. Listen first, then pick the branch.`,
    4);

  // ══════════════════════════════════════════════════════════════════════════
  // RATES TOO HIGH
  // ══════════════════════════════════════════════════════════════════════════
  const nRatesHigh = node(sid, nOpen,
    `Okay, I mean I understand that stuff like that happens. I will say, rates aren't expected to drop much anytime soon. However, what was your reason to look for a loan in the first place?`,
    `Don't argue rates — redirect to their original goal. If the goal is debt consolidation, today's mortgage rates still beat 20%+ credit cards by a mile. The "what was your reason" question reopens the conversation more often than any rate pitch.`,
    5);

  // ══════════════════════════════════════════════════════════════════════════
  // LOOKING IN THE FUTURE
  // ══════════════════════════════════════════════════════════════════════════
  const nFuture = node(sid, nOpen,
    `Alright, well, I understand. What made you make the change? And when would be the best time to reach out?`,
    `Your only goal here is a specific follow-up window — "mid-[Month]" beats "in a few months". Log it as a future contact with the date in the notes.`,
    6);

  // ══════════════════════════════════════════════════════════════════════════
  // PLANNING TO SELL / MOVE
  // ══════════════════════════════════════════════════════════════════════════
  const nSelling = node(sid, nOpen,
    `Okay. Are you looking to buy another house?`,
    `Timeline is everything. Buying next = purchase-loan opportunity for the LO. Selling in 4–12 months = cash out can fund repairs or staging before they list. Under 3 months out = stay friendly, no product push.`,
    7);

  const nBuying = node(sid, nSelling,
    `Oh perfect — so you'll need financing on the new place. Our LOs do purchase loans all day, and getting pre-approved early means you're ready the second you find the right house.\n\nWant me to set up a quick call with [LO Name] to get that going?`,
    `Pre-approval is the natural hook — it costs them nothing and makes their offers stronger. If they already have a lender for the purchase, pivot to the 150+ lender comparison pitch.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // WITH ANOTHER LENDER
  // ══════════════════════════════════════════════════════════════════════════
  const nOtherLender = node(sid, nOpen,
    `Have you closed or completed the deal yet?\n\n[IF NOT]: Well, here at West Cap we're a wholesale broker, meaning that we work with over 150 lenders to get you a rate that beats one that you would get if you went into a local bank. Do you mind if we run a quick comparison, so you know for sure you're getting the best deal?`,
    `"With another lender" is soft until they've actually locked or closed. Not closed = free second opinion, zero commitment. Closed = congratulate them and exit warm — they'll remember you next time.`,
    8);

  const nClosedExit = node(sid, nOtherLender,
    `Congratulations on getting it done! If anything ever comes up with the home down the road, don't hesitate to reach back out — we'd love to be your resource for anything mortgage-related.\n\nHave a great [morning/afternoon/evening], [Borrower Name]!`,
    `Exit warm and quick. A good last impression turns into referrals and the next refi in 2–3 years.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // WRONG PERSON
  // ══════════════════════════════════════════════════════════════════════════
  const nWrongPerson = node(sid, nOpen,
    `Okay. Could [Borrower Name] be someone in the family? Does anyone else live with you or use this phone?`,
    `Stay curious — half the time it's a spouse, a parent, or someone who used their number on the form. If the borrower is reachable, your goal is a time to call back. If truly nobody by that name, mark it bad data so the lead stops getting dialed.`,
    9);

  const nReIntro = node(sid, nWrongPerson,
    `Hi [Borrower Name]! This is [Your Name] with West Capital Lending — we received an inquiry under your name for either a refinance or a Home Equity Line of Credit, and I just wanted to learn what you're hoping to accomplish.\n\nWere you looking to take some cash out, or more looking at your rate?`,
    `Quick re-intro for when the right person comes to the phone — don't make them sit through the full opener again.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // WRONG NUMBER / HOSTILE
  // ══════════════════════════════════════════════════════════════════════════
  const nHostile = node(sid, nOpen,
    `Hey, what did I do? This [Address] is your address, right? Did you happen to put your information into one of those mortgage calculators, or click on one of those ads?`,
    `Keep it light — "hey, what did I do?" disarms better than apologizing. The mortgage-calculator question usually jogs their memory and explains the flood of calls they've been getting. If they stay hostile, exit fast and log it — never call back the same day.`,
    10);

  // ══════════════════════════════════════════════════════════════════════════
  // BUSY
  // ══════════════════════════════════════════════════════════════════════════
  const nBusy = node(sid, nOpen,
    `Totally get it — I'll be two minutes, max.\n\nJust one quick question: are you still looking to do something with your home equity or your rate? And if so, what time works better for a real call — mornings or afternoons?`,
    `Respect their time instantly. A yes = pivot straight to scheduling. A no = thank them and move on — never drag it out.`,
    11);

  // ══════════════════════════════════════════════════════════════════════════
  // SILENT / NO RESPONSE
  // ══════════════════════════════════════════════════════════════════════════
  const nSilent = node(sid, nOpen,
    `Hello? [Borrower Name]?\n\n[PAUSE 3 seconds]\n\nHey — just making sure I'm not talking to air here. I'm following up on the home equity inquiry under your name. Are you there?\n\n[PAUSE 3 seconds]\n\nNo worries — I'll try you again at a better time. Have a great day!`,
    `Wait 3 full seconds between attempts. Two tries, then close politely and hang up. Never talk more than 10 seconds into silence.`,
    12);

  // ══════════════════════════════════════════════════════════════════════════
  // VOICEMAIL
  // ══════════════════════════════════════════════════════════════════════════
  const nVoicemail = node(sid, nOpen,
    `[VOICEMAIL — keep it under 25 seconds, smile while recording]:\n"Hey [Borrower Name], this is [Your Name] with West Capital Lending — I'm [LO Name]'s assistant. We received your inquiry about a refinance or a Home Equity Line of Credit and I wanted to personally follow up. Give me a call back at [Phone Number] and I'll make sure [LO Name] has time set aside for you. Talk soon!"`,
    `Name + company + reason + callback number, under 25 seconds. Smile — it comes through in your voice. On callbacks, thank them and go straight to "what were you hoping to accomplish?"`,
    13);

  // ══════════════════════════════════════════════════════════════════════════
  // RESPONSES
  // ══════════════════════════════════════════════════════════════════════════

  // ── Opening → Ethan's branches ───────────────────────────────────────────
  resp(nOpen, "Looking to take cash out", "green", nCashOut, 1);
  resp(nOpen, "Not sure / not looking anymore", "yellow", nNotSure, 2);
  resp(nOpen, "Shopping around", "yellow", nShopping, 3);
  resp(nOpen, "No thanks, I'm good", "yellow", nChangedMind, 4);
  resp(nOpen, "Rates too high", "yellow", nRatesHigh, 5);
  resp(nOpen, "Looking in the future", "blue", nFuture, 6);
  resp(nOpen, "Planning to sell / move", "yellow", nSelling, 7);
  resp(nOpen, "With another lender", "yellow", nOtherLender, 8);
  resp(nOpen, "Wrong person", "gray", nWrongPerson, 9);
  resp(nOpen, "Wrong number / hostile", "red", nHostile, 10);
  resp(nOpen, "Busy right now", "yellow", nBusy, 11);
  resp(nOpen, "No response", "gray", nSilent, 12);
  resp(nOpen, "No answer — voicemail", "gray", nVoicemail, 13);

  // ── Cash-out qualifying → outcomes ───────────────────────────────────────
  resp(nCashOut, "Confirmed — ready to transfer", "green", nTransfer, 1);
  resp(nCashOut, "Set appointment instead", "blue", nAppointment, 2);
  resp(nCashOut, "Hesitant / second thoughts", "yellow", nNotSure, 3);

  // ── Transfer outcomes ────────────────────────────────────────────────────
  resp(nTransfer, "Transfer complete!", "green", null, 1);
  resp(nTransfer, "LO unavailable", "blue", nAppointment, 2);
  resp(nTransfer, "Changed mind", "yellow", nChangedMind, 3);

  // ── Appointment outcomes ─────────────────────────────────────────────────
  resp(nAppointment, "Appointment set ✓", "green", null, 1);
  resp(nAppointment, "Won't commit", "yellow", nFuture, 2);

  // ── Not sure / not looking anymore ───────────────────────────────────────
  resp(nNotSure, "Reason surfaced — still a goal", "green", nCashOut, 1);
  resp(nNotSure, "Changed their mind", "yellow", nChangedMind, 2);
  resp(nNotSure, "Not interested", "gray", null, 3);

  // ── Shopping around ──────────────────────────────────────────────────────
  resp(nShopping, "Sure, go ahead", "green", nCashOut, 1);
  resp(nShopping, "Maybe later", "yellow", nFuture, 2);
  resp(nShopping, "Not interested", "gray", null, 3);

  // ── No thanks, I'm good → why ────────────────────────────────────────────
  resp(nChangedMind, "Rates too high", "yellow", nRatesHigh, 1);
  resp(nChangedMind, "Looking in the future", "blue", nFuture, 2);
  resp(nChangedMind, "Planning to sell / move", "yellow", nSelling, 3);
  resp(nChangedMind, "With another lender", "yellow", nOtherLender, 4);
  resp(nChangedMind, "Not interested", "gray", null, 5);

  // ── Rates too high ───────────────────────────────────────────────────────
  resp(nRatesHigh, "Opened up about their goal", "green", nCashOut, 1);
  resp(nRatesHigh, "Waiting on rates", "yellow", nFuture, 2);
  resp(nRatesHigh, "Not interested", "gray", null, 3);

  // ── Looking in the future ────────────────────────────────────────────────
  resp(nFuture, "Open to talking now", "green", nCashOut, 1);
  resp(nFuture, "Future contact set", "yellow", null, 2);
  resp(nFuture, "Do not call again", "gray", null, 3);

  // ── Planning to sell / move ──────────────────────────────────────────────
  resp(nSelling, "Yes — buying another house", "green", nBuying, 1);
  resp(nSelling, "Open to cash out before selling", "green", nCashOut, 2);
  resp(nSelling, "Just selling — all set", "gray", null, 3);
  resp(nBuying, "Set appointment", "blue", nAppointment, 1);
  resp(nBuying, "Not yet", "yellow", nFuture, 2);

  // ── With another lender ──────────────────────────────────────────────────
  resp(nOtherLender, "Not closed — open to compare", "green", nCashOut, 1);
  resp(nOtherLender, "Already closed", "gray", nClosedExit, 2);
  resp(nOtherLender, "Not interested", "gray", null, 3);
  resp(nClosedExit, "Call ended", "gray", null, 1);

  // ── Wrong person ─────────────────────────────────────────────────────────
  resp(nWrongPerson, "They're grabbing them now", "green", nReIntro, 1);
  resp(nWrongPerson, "Callback time set", "blue", null, 2);
  resp(nWrongPerson, "Wrong person — bad data", "gray", null, 3);
  resp(nReIntro, "Cash out", "green", nCashOut, 1);
  resp(nReIntro, "Not sure", "yellow", nNotSure, 2);

  // ── Wrong number / hostile ───────────────────────────────────────────────
  resp(nHostile, "Calmed down — it was them", "green", nNotSure, 1);
  resp(nHostile, "Hung up / still hostile", "gray", null, 2);
  resp(nHostile, "Remove me — do not call", "red", null, 3);

  // ── Busy ─────────────────────────────────────────────────────────────────
  resp(nBusy, "Set callback", "blue", nAppointment, 1);
  resp(nBusy, "Not interested", "gray", null, 2);

  // ── Silent / voicemail ───────────────────────────────────────────────────
  resp(nSilent, "Responded", "green", nReIntro, 1);
  resp(nSilent, "No answer", "gray", null, 2);
  resp(nVoicemail, "Voicemail left", "gray", null, 1);

  sqlite.prepare(`INSERT INTO migrations_applied (name, applied_at) VALUES (?, datetime('now'))`)
    .run('ethan_wcl_script_v5');
}
try { seedEthanScript(); } catch (e: any) { console.error("[seed] seedEthanScript v5 failed:", e?.message ?? e); }


// Add owner_id column to existing DBs that don't have it
try { sqlite.exec(`ALTER TABLE call_scripts ADD COLUMN owner_id INTEGER DEFAULT NULL`); } catch {}

// Expose sqlite for direct queries in routes
export function getSqlite() { return sqlite; }

// ── Webhook storage helpers ────────────────────────────────────────────────────
export function logWebhookEvent(data: { source: string; eventType?: string | null; payload: any; matchedUserId?: number | null; processed?: boolean }) {
  const now = new Date().toISOString();
  const res = sqlite.prepare(
    `INSERT INTO webhook_events (source, event_type, payload, matched_user_id, processed, created_at) VALUES (?,?,?,?,?,?)`
  ).run(
    data.source,
    data.eventType ?? null,
    typeof data.payload === "string" ? data.payload : JSON.stringify(data.payload ?? {}),
    data.matchedUserId ?? null,
    data.processed ? 1 : 0,
    now,
  );
  return { id: res.lastInsertRowid as number, createdAt: now };
}

export function getRecentWebhookEvents(limit = 50) {
  return sqlite.prepare(
    `SELECT we.*, u.name AS matched_user_name
       FROM webhook_events we
       LEFT JOIN users u ON u.id = we.matched_user_id
       ORDER BY we.created_at DESC
       LIMIT ?`
  ).all(limit) as any[];
}

export function getWebhookSettings() {
  const row = sqlite.prepare(`SELECT * FROM webhook_settings WHERE id=1`).get() as any;
  return row ?? { id: 1, mojo_secret: null, bonzo_secret: null, bonzo_api_token: null, mojo_api_key: null, zapier_webhook_url: null, zapier_secret: null };
}

export function updateWebhookSettings(data: {
  mojoSecret?: string | null;
  bonzoSecret?: string | null;
  bonzoApiToken?: string | null;
  mojoApiKey?: string | null;
  zapierWebhookUrl?: string | null;
  zapierSecret?: string | null;
}) {
  const now = new Date().toISOString();
  const existing = getWebhookSettings();
  const mojo = data.mojoSecret !== undefined ? (data.mojoSecret || null) : existing.mojo_secret;
  const bonzo = data.bonzoSecret !== undefined ? (data.bonzoSecret || null) : existing.bonzo_secret;
  const bonzoToken = data.bonzoApiToken !== undefined ? (data.bonzoApiToken || null) : existing.bonzo_api_token;
  const mojoKey = data.mojoApiKey !== undefined ? (data.mojoApiKey || null) : existing.mojo_api_key;
  const zapUrl = data.zapierWebhookUrl !== undefined ? (data.zapierWebhookUrl || null) : existing.zapier_webhook_url;
  const zapSecret = data.zapierSecret !== undefined ? (data.zapierSecret || null) : existing.zapier_secret;
  sqlite.prepare(
    `UPDATE webhook_settings SET mojo_secret=?, bonzo_secret=?, bonzo_api_token=?, mojo_api_key=?, zapier_webhook_url=?, zapier_secret=?, updated_at=? WHERE id=1`
  ).run(mojo, bonzo, bonzoToken, mojoKey, zapUrl, zapSecret, now);
  return getWebhookSettings();
}

// ── Unified contacts storage helpers ────────────────────────────────────────
function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = String(p).replace(/\D+/g, "");
  if (!d) return null;
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

function normEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const t = String(e).trim().toLowerCase();
  return t || null;
}

export function upsertUnifiedContact(data: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  bonzoProspectId?: string | null;
  bonzoPipeline?: string | null;
  bonzoStage?: string | null;
  bonzoAssignedUser?: string | null;
  mojoContactId?: string | null;
  mojoGroup?: string | null;
  mojoStatus?: string | null;
  clrUserId?: number | null;
  loId?: number | null;
  source?: string;
}) {
  const now = new Date().toISOString();
  const phone = normPhone(data.phone);
  const email = normEmail(data.email);
  const fullName = data.fullName ||
    [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || null;

  // Find existing: prefer bonzo id, mojo id, then phone, then email
  let existing: any = null;
  if (data.bonzoProspectId) {
    existing = sqlite.prepare(`SELECT * FROM unified_contacts WHERE bonzo_prospect_id=? LIMIT 1`).get(data.bonzoProspectId);
  }
  if (!existing && data.mojoContactId) {
    existing = sqlite.prepare(`SELECT * FROM unified_contacts WHERE mojo_contact_id=? LIMIT 1`).get(data.mojoContactId);
  }
  if (!existing && phone) {
    existing = sqlite.prepare(`SELECT * FROM unified_contacts WHERE phone=? LIMIT 1`).get(phone);
  }
  if (!existing && email) {
    existing = sqlite.prepare(`SELECT * FROM unified_contacts WHERE email=? LIMIT 1`).get(email);
  }

  if (existing) {
    // Merge — keep existing values when new is null
    const merged = {
      first_name: data.firstName ?? existing.first_name,
      last_name: data.lastName ?? existing.last_name,
      full_name: fullName ?? existing.full_name,
      phone: phone ?? existing.phone,
      email: email ?? existing.email,
      bonzo_prospect_id: data.bonzoProspectId ?? existing.bonzo_prospect_id,
      bonzo_pipeline: data.bonzoPipeline ?? existing.bonzo_pipeline,
      bonzo_stage: data.bonzoStage ?? existing.bonzo_stage,
      bonzo_assigned_user: data.bonzoAssignedUser ?? existing.bonzo_assigned_user,
      mojo_contact_id: data.mojoContactId ?? existing.mojo_contact_id,
      mojo_group: data.mojoGroup ?? existing.mojo_group,
      mojo_status: data.mojoStatus ?? existing.mojo_status,
      clr_user_id: data.clrUserId ?? existing.clr_user_id,
      lo_id: data.loId ?? existing.lo_id,
      source: data.source ?? existing.source,
    };
    sqlite.prepare(
      `UPDATE unified_contacts SET first_name=?, last_name=?, full_name=?, phone=?, email=?,
       bonzo_prospect_id=?, bonzo_pipeline=?, bonzo_stage=?, bonzo_assigned_user=?,
       mojo_contact_id=?, mojo_group=?, mojo_status=?, clr_user_id=?, lo_id=?, source=?, updated_at=? WHERE id=?`
    ).run(
      merged.first_name, merged.last_name, merged.full_name, merged.phone, merged.email,
      merged.bonzo_prospect_id, merged.bonzo_pipeline, merged.bonzo_stage, merged.bonzo_assigned_user,
      merged.mojo_contact_id, merged.mojo_group, merged.mojo_status, merged.clr_user_id, merged.lo_id, merged.source, now, existing.id,
    );
    return existing.id as number;
  } else {
    const r = sqlite.prepare(
      `INSERT INTO unified_contacts (first_name, last_name, full_name, phone, email,
       bonzo_prospect_id, bonzo_pipeline, bonzo_stage, bonzo_assigned_user,
       mojo_contact_id, mojo_group, mojo_status, clr_user_id, lo_id, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      data.firstName ?? null, data.lastName ?? null, fullName, phone, email,
      data.bonzoProspectId ?? null, data.bonzoPipeline ?? null, data.bonzoStage ?? null, data.bonzoAssignedUser ?? null,
      data.mojoContactId ?? null, data.mojoGroup ?? null, data.mojoStatus ?? null,
      data.clrUserId ?? null, data.loId ?? null, data.source ?? 'manual', now, now,
    );
    return r.lastInsertRowid as number;
  }
}

export function getUnifiedContacts(filters: {
  search?: string;
  clrUserId?: number;
  loId?: number;
  source?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (filters.search) {
    where.push(`(LOWER(COALESCE(full_name,'')) LIKE ? OR LOWER(COALESCE(first_name,'')) LIKE ? OR LOWER(COALESCE(last_name,'')) LIKE ? OR LOWER(COALESCE(email,'')) LIKE ? OR phone LIKE ?)`);
    const s = `%${filters.search.toLowerCase()}%`;
    args.push(s, s, s, s, `%${filters.search}%`);
  }
  if (filters.clrUserId !== undefined) { where.push(`clr_user_id=?`); args.push(filters.clrUserId); }
  if (filters.loId !== undefined) { where.push(`lo_id=?`); args.push(filters.loId); }
  if (filters.source) { where.push(`source=?`); args.push(filters.source); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = filters.offset ?? 0;
  const rows = sqlite.prepare(
    `SELECT uc.*, u.name AS clr_user_name, lo.full_name AS lo_name FROM unified_contacts uc
     LEFT JOIN users u ON u.id = uc.clr_user_id
     LEFT JOIN loan_officers lo ON lo.id = uc.lo_id
     ${clause} ORDER BY COALESCE(uc.last_outcome_date, uc.updated_at) DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset) as any[];
  const total = (sqlite.prepare(`SELECT COUNT(*) AS c FROM unified_contacts ${clause}`).get(...args) as any).c;
  return { rows, total };
}

export function getUnifiedContactById(id: number) {
  const row = sqlite.prepare(
    `SELECT uc.*, u.name AS clr_user_name, lo.full_name AS lo_name FROM unified_contacts uc
     LEFT JOIN users u ON u.id = uc.clr_user_id
     LEFT JOIN loan_officers lo ON lo.id = uc.lo_id
     WHERE uc.id=?`
  ).get(id) as any;
  if (!row) return null;
  // Get related history
  const outcomes = row.phone
    ? sqlite.prepare(`SELECT lo.*, u.name AS assistant_name, lof.full_name AS lo_full_name FROM lead_outcomes lo
       LEFT JOIN users u ON u.id = lo.assistant_id
       LEFT JOIN loan_officers lof ON lof.id = lo.lo_id
       WHERE LOWER(COALESCE(lo.borrower_name,'')) LIKE ? OR LOWER(COALESCE(lo.borrower_name,'')) LIKE ?
       ORDER BY lo.created_at DESC LIMIT 50`).all(
        `%${(row.full_name || '').toLowerCase()}%`,
        `%${((row.first_name || '') + ' ' + (row.last_name || '')).toLowerCase().trim()}%`
      )
    : [];
  const bonzoProspect = row.bonzo_prospect_id
    ? sqlite.prepare(`SELECT * FROM bonzo_prospects WHERE bonzo_id=?`).get(row.bonzo_prospect_id)
    : null;
  const mojoContact = row.mojo_contact_id
    ? sqlite.prepare(`SELECT * FROM mojo_contacts WHERE mojo_id=?`).get(row.mojo_contact_id)
    : null;
  const mojoSessions = row.clr_user_id
    ? sqlite.prepare(`SELECT * FROM mojo_sessions WHERE clr_user_id=? ORDER BY session_date DESC LIMIT 20`).all(row.clr_user_id)
    : [];
  return { ...row, outcomes, bonzoProspect, mojoContact, mojoSessions };
}

export function updateUnifiedContactFromOutcome(outcome: {
  borrowerName?: string | null;
  outcomeType: string;
  date: string;
  loId?: number | null;
  assistantId?: number | null;
}) {
  if (!outcome.borrowerName) return;
  const name = outcome.borrowerName.toLowerCase().trim();
  const contact = sqlite.prepare(
    `SELECT * FROM unified_contacts WHERE LOWER(COALESCE(full_name,'')) = ? OR LOWER(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) = ? LIMIT 1`
  ).get(name, name) as any;
  if (!contact) return;
  const isTransfer = outcome.outcomeType === 'transfer';
  const isAppt = outcome.outcomeType === 'appointment';
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE unified_contacts SET
      last_outcome_type=?, last_outcome_date=?,
      total_transfers=total_transfers + ?,
      total_appointments=total_appointments + ?,
      clr_user_id=COALESCE(?, clr_user_id),
      lo_id=COALESCE(?, lo_id),
      updated_at=?
     WHERE id=?`
  ).run(
    outcome.outcomeType, outcome.date,
    isTransfer ? 1 : 0, isAppt ? 1 : 0,
    outcome.assistantId ?? null, outcome.loId ?? null,
    now, contact.id,
  );
}

export function upsertMojoContact(c: {
  mojoId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  listName?: string | null;
  assignedClrId?: number | null;
}) {
  const now = new Date().toISOString();
  const phone = normPhone(c.phone);
  let existing: any = null;
  if (c.mojoId) {
    existing = sqlite.prepare(`SELECT id FROM mojo_contacts WHERE mojo_id=?`).get(c.mojoId);
  }
  if (!existing && phone) {
    existing = sqlite.prepare(`SELECT id FROM mojo_contacts WHERE phone=?`).get(phone);
  }
  if (existing) {
    sqlite.prepare(
      `UPDATE mojo_contacts SET first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), phone=COALESCE(?,phone), email=COALESCE(?,email), status=COALESCE(?,status), list_name=COALESCE(?,list_name), assigned_clr_id=COALESCE(?,assigned_clr_id), updated_at=? WHERE id=?`
    ).run(
      c.firstName ?? null, c.lastName ?? null, phone, normEmail(c.email),
      c.status ?? null, c.listName ?? null, c.assignedClrId ?? null, now, existing.id,
    );
    return existing.id as number;
  } else {
    const r = sqlite.prepare(
      `INSERT INTO mojo_contacts (mojo_id, first_name, last_name, phone, email, status, list_name, assigned_clr_id, imported_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      c.mojoId ?? null, c.firstName ?? null, c.lastName ?? null,
      phone, normEmail(c.email), c.status ?? null, c.listName ?? null, c.assignedClrId ?? null, now, now,
    );
    return r.lastInsertRowid as number;
  }
}

export function findClrByPhone(phone: string | null | undefined): any | null {
  const p = normPhone(phone);
  if (!p) return null;
  const u = sqlite.prepare(`SELECT id, name FROM users WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'-',''),' ',''),'(',''),')','') LIKE ? AND is_active=1 LIMIT 1`).get(`%${p}%`) as any;
  return u ?? null;
}

export { normPhone, normEmail };

// Match a CLR user by name (case-insensitive partial match). Returns user or null.
export function findUserByName(name: string | null | undefined): any | null {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const candidates = sqlite.prepare(
    `SELECT id, name, role, is_active FROM users WHERE is_active = 1 AND (role = 'assistant' OR role = 'admin')`
  ).all() as any[];
  // Try exact match first
  const exact = candidates.find(u => u.name.toLowerCase() === lower);
  if (exact) return exact;
  // Try contains match (either direction)
  const partial = candidates.find(u => {
    const n = u.name.toLowerCase();
    return n.includes(lower) || lower.includes(n);
  });
  if (partial) return partial;
  // Try first-name match
  const first = lower.split(/\s+/)[0];
  if (first && first.length >= 3) {
    const firstMatch = candidates.find(u => u.name.toLowerCase().startsWith(first));
    if (firstMatch) return firstMatch;
  }
  return null;
}

// Upsert daily call log and increment counters by delta amounts
export function incrementDailyCallLog(params: { logDate: string; assistantId: number; callsDelta?: number; contactsDelta?: number; dncDelta?: number }) {
  const { logDate, assistantId } = params;
  const callsDelta = params.callsDelta ?? 0;
  const contactsDelta = params.contactsDelta ?? 0;
  const dncDelta = params.dncDelta ?? 0;
  const now = new Date().toISOString();
  const existing = sqlite.prepare(
    `SELECT id FROM daily_call_logs WHERE log_date=? AND assistant_id=?`
  ).get(logDate, assistantId) as any;
  if (existing) {
    sqlite.prepare(
      `UPDATE daily_call_logs
         SET calls_made = COALESCE(calls_made,0) + ?,
             contacts_reached = COALESCE(contacts_reached,0) + ?,
             dnc_hits = COALESCE(dnc_hits,0) + ?,
             updated_at = ?
       WHERE id = ?`
    ).run(callsDelta, contactsDelta, dncDelta, now, existing.id);
  } else {
    sqlite.prepare(
      `INSERT INTO daily_call_logs (log_date, assistant_id, calls_made, contacts_reached, dnc_hits, updated_at)
       VALUES (?,?,?,?,?,?)`
    ).run(logDate, assistantId, Math.max(0, callsDelta), Math.max(0, contactsDelta), Math.max(0, dncDelta), now);
  }
}

export function getCallStatsByRange(from: string, to: string) {
  return sqlite.prepare(
    `SELECT assistant_id, SUM(calls_made) AS total_calls,
            SUM(COALESCE(contacts_reached,0)) AS total_contacts,
            SUM(COALESCE(dnc_hits,0)) AS total_dnc
       FROM daily_call_logs
      WHERE log_date >= ? AND log_date <= ?
      GROUP BY assistant_id`
  ).all(from, to) as any[];
}

export function getCallLogsByRangeRaw(from: string, to: string) {
  return sqlite.prepare(
    `SELECT * FROM daily_call_logs WHERE log_date >= ? AND log_date <= ?`
  ).all(from, to) as any[];
}

export function getCallStatsForDay(date: string) {
  return sqlite.prepare(
    `SELECT assistant_id,
            COALESCE(calls_made,0) AS calls_made,
            COALESCE(contacts_reached,0) AS contacts_reached,
            COALESCE(dnc_hits,0) AS dnc_hits
       FROM daily_call_logs WHERE log_date = ?`
  ).all(date) as any[];
}

export function getCallScripts(): any[] {
  return sqlite.prepare(`SELECT * FROM call_scripts ORDER BY created_at DESC`).all() as any[];
}

// Get default (global) scripts — those with owner_id IS NULL
export function getDefaultScripts(): any[] {
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE owner_id IS NULL AND is_active=1 ORDER BY created_at ASC`).all() as any[];
}

// Get personal script for a user (copy of default, owner_id = userId)
export function getUserScript(userId: number): any {
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE owner_id=? ORDER BY created_at DESC, id DESC LIMIT 1`).get(userId) as any;
}
export function getUserScripts(userId: number): any[] {
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE owner_id=? ORDER BY created_at DESC, id DESC`).all(userId) as any[];
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
// Promote any existing script to be THE global/default script shown to all CLRs.
// Captures the source tree first, wipes the current default(s) (owner_id IS NULL),
// then re-creates a fresh default from the captured copy. The source script is
// left untouched (a personal copy stays the user's; a default is simply rebuilt).
export function promoteScriptToDefault(sourceScriptId: number): any {
  const source = sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(sourceScriptId) as any;
  if (!source) return null;

  // 1. Capture the source tree in memory BEFORE any deletes (the source may
  //    itself be the current default we are about to wipe).
  const srcNodes = sqlite.prepare(`SELECT * FROM script_nodes WHERE script_id=? ORDER BY id ASC`).all(sourceScriptId) as any[];
  const srcResponses = sqlite.prepare(
    `SELECT sr.* FROM script_responses sr JOIN script_nodes sn ON sr.node_id=sn.id WHERE sn.script_id=? ORDER BY sr.id ASC`
  ).all(sourceScriptId) as any[];
  const name = source.name;
  const description = source.description;

  const tx = sqlite.transaction(() => {
    // 2. Wipe existing default (owner_id IS NULL) scripts + their tree.
    sqlite.prepare(`
      DELETE FROM script_responses WHERE node_id IN (
        SELECT sn.id FROM script_nodes sn
        JOIN call_scripts cs ON cs.id = sn.script_id
        WHERE cs.owner_id IS NULL
      )
    `).run();
    sqlite.prepare(`
      DELETE FROM script_nodes WHERE script_id IN (
        SELECT id FROM call_scripts WHERE owner_id IS NULL
      )
    `).run();
    sqlite.prepare(`DELETE FROM call_scripts WHERE owner_id IS NULL`).run();

    // 3. Create the new default script (owner_id NULL, active).
    const newScriptId = sqlite.prepare(
      `INSERT INTO call_scripts (name, description, is_active, created_by, owner_id) VALUES (?,?,1,?,NULL)`
    ).run(name, description, source.created_by ?? null).lastInsertRowid as number;

    // 4. Copy nodes (two passes to remap parent ids).
    const nodeIdMap = new Map<number, number>();
    for (const n of srcNodes) {
      const r = sqlite.prepare(
        `INSERT INTO script_nodes (script_id, text, hint, node_order) VALUES (?,?,?,?)`
      ).run(newScriptId, n.text, n.hint, n.node_order);
      nodeIdMap.set(n.id, r.lastInsertRowid as number);
    }
    for (const n of srcNodes) {
      if (n.parent_node_id != null) {
        const newNodeId = nodeIdMap.get(n.id);
        const newParentId = nodeIdMap.get(n.parent_node_id);
        if (newNodeId && newParentId) {
          sqlite.prepare(`UPDATE script_nodes SET parent_node_id=? WHERE id=?`).run(newParentId, newNodeId);
        }
      }
    }

    // 5. Copy responses (remap node_id + next_node_id).
    for (const r of srcResponses) {
      const newNodeId = nodeIdMap.get(r.node_id);
      const newNextId = r.next_node_id != null ? (nodeIdMap.get(r.next_node_id) ?? null) : null;
      if (newNodeId) {
        sqlite.prepare(
          `INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?,?,?,?,?)`
        ).run(newNodeId, r.label, r.color, newNextId, r.response_order);
      }
    }
    return newScriptId;
  });

  const newId = tx();
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(newId);
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

// Build a user's personal script from an AI-generated spec (see /api/script-coach/build).
// Replaces any existing personal copy. The first node is the root (parent NULL).
export function buildPersonalScriptFromSpec(userId: number, name: string, spec: any, replace = true): any {
  if (replace) {
    const existing = sqlite.prepare(`SELECT id FROM call_scripts WHERE owner_id=?`).get(userId) as any;
    if (existing) sqlite.prepare(`DELETE FROM call_scripts WHERE id=?`).run(existing.id);
  }
  const sid = sqlite.prepare(
    `INSERT INTO call_scripts (name, description, is_active, created_by, owner_id) VALUES (?,?,1,?,?)`
  ).run(name, "Built with the AI Script Coach", userId, userId).lastInsertRowid as number;

  const nodes: any[] = Array.isArray(spec?.nodes) ? spec.nodes : [];
  const keyToId = new Map<string, number>();
  let order = 0;
  for (const n of nodes) {
    const text = typeof n?.text === "string" ? n.text : "";
    const hint = typeof n?.hint === "string" ? n.hint : "";
    const id = sqlite.prepare(
      `INSERT INTO script_nodes (script_id, parent_node_id, text, hint, node_order) VALUES (?,?,?,?,?)`
    ).run(sid, null, text, hint, order++).lastInsertRowid as number;
    if (n?.key != null) keyToId.set(String(n.key), id);
  }
  const allowedColors = new Set(["green", "blue", "red", "default"]);
  for (const n of nodes) {
    const nodeId = keyToId.get(String(n?.key));
    if (!nodeId) continue;
    const responses: any[] = Array.isArray(n?.responses) ? n.responses : [];
    let ro = 0;
    for (const r of responses) {
      const label = typeof r?.label === "string" && r.label.trim() ? r.label.slice(0, 200) : "Continue";
      const color = allowedColors.has(r?.color) ? r.color : "default";
      const nextId = r?.next != null ? (keyToId.get(String(r.next)) ?? null) : null;
      sqlite.prepare(
        `INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?,?,?,?,?)`
      ).run(nodeId, label, color, nextId, ro++);
      if (nextId) sqlite.prepare(`UPDATE script_nodes SET parent_node_id=COALESCE(parent_node_id, ?) WHERE id=?`).run(nodeId, nextId);
    }
  }
  return sqlite.prepare(`SELECT * FROM call_scripts WHERE id=?`).get(sid);
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

// ── Bonzo storage helpers ────────────────────────────────────────────────────
export function upsertBonzoProspect(p: {
  bonzoId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  pipelineId?: string | null;
  pipelineName?: string | null;
  stageId?: string | null;
  stageName?: string | null;
  assignedUserId?: number | null;
  bonzoUserId?: string | null;
  bonzoUserName?: string | null;
  tags?: string[];
  lastActivityAt?: string | null;
}) {
  const now = new Date().toISOString();
  const existing = sqlite.prepare(`SELECT id FROM bonzo_prospects WHERE bonzo_id=?`).get(p.bonzoId) as any;
  const tagsJson = JSON.stringify(p.tags ?? []);
  if (existing) {
    sqlite.prepare(
      `UPDATE bonzo_prospects SET first_name=?, last_name=?, email=?, phone=?, pipeline_id=?, pipeline_name=?, stage_id=?, stage_name=?, assigned_user_id=?, bonzo_user_id=?, bonzo_user_name=?, tags=?, last_activity_at=?, updated_at=? WHERE bonzo_id=?`
    ).run(
      p.firstName ?? null, p.lastName ?? null, p.email ?? null, p.phone ?? null,
      p.pipelineId ?? null, p.pipelineName ?? null, p.stageId ?? null, p.stageName ?? null,
      p.assignedUserId ?? null, p.bonzoUserId ?? null, p.bonzoUserName ?? null,
      tagsJson, p.lastActivityAt ?? null, now, p.bonzoId,
    );
  } else {
    sqlite.prepare(
      `INSERT INTO bonzo_prospects (bonzo_id, first_name, last_name, email, phone, pipeline_id, pipeline_name, stage_id, stage_name, assigned_user_id, bonzo_user_id, bonzo_user_name, tags, last_activity_at, imported_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      p.bonzoId, p.firstName ?? null, p.lastName ?? null, p.email ?? null, p.phone ?? null,
      p.pipelineId ?? null, p.pipelineName ?? null, p.stageId ?? null, p.stageName ?? null,
      p.assignedUserId ?? null, p.bonzoUserId ?? null, p.bonzoUserName ?? null,
      tagsJson, p.lastActivityAt ?? null, now, now,
    );
  }
  // Mirror into unified_contacts
  try {
    upsertUnifiedContact({
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      bonzoProspectId: p.bonzoId,
      bonzoPipeline: p.pipelineName ?? null,
      bonzoStage: p.stageName ?? null,
      bonzoAssignedUser: p.bonzoUserName ?? null,
      clrUserId: p.assignedUserId ?? null,
      source: 'bonzo',
    });
  } catch (e) { /* swallow */ }
}

export function getBonzoProspects(filters: {
  search?: string;
  pipelineId?: string;
  stageId?: string;
  assignedUserId?: number;
  limit?: number;
  offset?: number;
} = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (filters.search) {
    where.push(`(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(email) LIKE ? OR phone LIKE ?)`);
    const s = `%${filters.search.toLowerCase()}%`;
    args.push(s, s, s, `%${filters.search}%`);
  }
  if (filters.pipelineId) { where.push(`pipeline_id=?`); args.push(filters.pipelineId); }
  if (filters.stageId) { where.push(`stage_id=?`); args.push(filters.stageId); }
  if (filters.assignedUserId !== undefined) { where.push(`assigned_user_id=?`); args.push(filters.assignedUserId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = filters.offset ?? 0;
  const rows = sqlite.prepare(
    `SELECT bp.*, u.name AS assigned_user_name FROM bonzo_prospects bp LEFT JOIN users u ON u.id = bp.assigned_user_id ${clause} ORDER BY COALESCE(last_activity_at, updated_at) DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset) as any[];
  const total = (sqlite.prepare(`SELECT COUNT(*) AS c FROM bonzo_prospects ${clause}`).get(...args) as any).c;
  return { rows, total };
}

export function getBonzoPipelines() {
  return sqlite.prepare(`SELECT * FROM bonzo_pipelines ORDER BY name`).all() as any[];
}

export function upsertBonzoPipeline(p: { bonzoId: string; name: string; stages: any[] }) {
  const now = new Date().toISOString();
  const existing = sqlite.prepare(`SELECT id FROM bonzo_pipelines WHERE bonzo_id=?`).get(p.bonzoId) as any;
  const stagesJson = JSON.stringify(p.stages ?? []);
  if (existing) {
    sqlite.prepare(`UPDATE bonzo_pipelines SET name=?, stages=?, updated_at=? WHERE bonzo_id=?`).run(p.name, stagesJson, now, p.bonzoId);
  } else {
    sqlite.prepare(`INSERT INTO bonzo_pipelines (bonzo_id, name, stages, imported_at, updated_at) VALUES (?,?,?,?,?)`).run(p.bonzoId, p.name, stagesJson, now, now);
  }
}

export function startBonzoSync(syncType: string): number {
  const now = new Date().toISOString();
  const r = sqlite.prepare(`INSERT INTO bonzo_sync_log (sync_type, status, started_at) VALUES (?, 'running', ?)`).run(syncType, now);
  return r.lastInsertRowid as number;
}

export function finishBonzoSync(id: number, data: { status: 'success' | 'error'; recordsSynced?: number; errorMessage?: string | null }) {
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE bonzo_sync_log SET status=?, records_synced=?, error_message=?, completed_at=? WHERE id=?`).run(
    data.status, data.recordsSynced ?? 0, data.errorMessage ?? null, now, id,
  );
}

export function getBonzoSyncLog(limit = 20) {
  return sqlite.prepare(`SELECT * FROM bonzo_sync_log ORDER BY started_at DESC LIMIT ?`).all(limit) as any[];
}

export function getLastBonzoSync() {
  return sqlite.prepare(`SELECT * FROM bonzo_sync_log ORDER BY started_at DESC LIMIT 1`).get() as any;
}

export function getRunningBonzoSync() {
  return sqlite.prepare(`SELECT * FROM bonzo_sync_log WHERE status='running' ORDER BY started_at DESC LIMIT 1`).get() as any;
}

// ── Mojo storage helpers ─────────────────────────────────────────────────────
export function getMojoSessions(filters: { clrUserId?: number; startDate?: string; endDate?: string } = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (filters.clrUserId !== undefined) { where.push(`clr_user_id=?`); args.push(filters.clrUserId); }
  if (filters.startDate) { where.push(`session_date >= ?`); args.push(filters.startDate); }
  if (filters.endDate) { where.push(`session_date <= ?`); args.push(filters.endDate); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return sqlite.prepare(
    `SELECT ms.*, u.name AS clr_user_name FROM mojo_sessions ms LEFT JOIN users u ON u.id = ms.clr_user_id ${clause} ORDER BY session_date DESC, clr_name`
  ).all(...args) as any[];
}

export function upsertMojoSession(s: {
  sessionDate: string;
  clrUserId?: number | null;
  clrName?: string | null;
  totalCalls?: number;
  contactsReached?: number;
  dncHits?: number;
  transfers?: number;
  appointments?: number;
  voicemails?: number;
  noAnswers?: number;
  source?: string;
}) {
  const now = new Date().toISOString();
  const existing = sqlite.prepare(`SELECT id FROM mojo_sessions WHERE session_date=? AND clr_user_id IS ?`).get(s.sessionDate, s.clrUserId ?? null) as any;
  if (existing) {
    sqlite.prepare(
      `UPDATE mojo_sessions SET clr_name=?, total_calls=?, contacts_reached=?, dnc_hits=?, transfers=?, appointments=?, voicemails=?, no_answers=?, source=?, updated_at=? WHERE id=?`
    ).run(
      s.clrName ?? null, s.totalCalls ?? 0, s.contactsReached ?? 0, s.dncHits ?? 0,
      s.transfers ?? 0, s.appointments ?? 0, s.voicemails ?? 0, s.noAnswers ?? 0,
      s.source ?? 'webhook', now, existing.id,
    );
  } else {
    sqlite.prepare(
      `INSERT INTO mojo_sessions (session_date, clr_user_id, clr_name, total_calls, contacts_reached, dnc_hits, transfers, appointments, voicemails, no_answers, source, imported_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      s.sessionDate, s.clrUserId ?? null, s.clrName ?? null,
      s.totalCalls ?? 0, s.contactsReached ?? 0, s.dncHits ?? 0,
      s.transfers ?? 0, s.appointments ?? 0, s.voicemails ?? 0, s.noAnswers ?? 0,
      s.source ?? 'webhook', now, now,
    );
  }
}

export function getMojoContacts(filters: { assignedClrId?: number; limit?: number; offset?: number } = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (filters.assignedClrId !== undefined) { where.push(`assigned_clr_id=?`); args.push(filters.assignedClrId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = filters.offset ?? 0;
  const rows = sqlite.prepare(`SELECT * FROM mojo_contacts ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as any[];
  const total = (sqlite.prepare(`SELECT COUNT(*) AS c FROM mojo_contacts ${clause}`).get(...args) as any).c;
  return { rows, total };
}

export function startMojoSync(syncType: string): number {
  const now = new Date().toISOString();
  const r = sqlite.prepare(`INSERT INTO mojo_sync_log (sync_type, status, started_at) VALUES (?, 'running', ?)`).run(syncType, now);
  return r.lastInsertRowid as number;
}

export function finishMojoSync(id: number, data: { status: 'success' | 'error'; recordsSynced?: number; errorMessage?: string | null }) {
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE mojo_sync_log SET status=?, records_synced=?, error_message=?, completed_at=? WHERE id=?`).run(
    data.status, data.recordsSynced ?? 0, data.errorMessage ?? null, now, id,
  );
}

export function getMojoSyncLog(limit = 20) {
  return sqlite.prepare(`SELECT * FROM mojo_sync_log ORDER BY started_at DESC LIMIT ?`).all(limit) as any[];
}

export function getLastMojoSync() {
  return sqlite.prepare(`SELECT * FROM mojo_sync_log ORDER BY started_at DESC LIMIT 1`).get() as any;
}

export function getRunningMojoSync() {
  return sqlite.prepare(`SELECT * FROM mojo_sync_log WHERE status='running' ORDER BY started_at DESC LIMIT 1`).get() as any;
}
// ── Glossary storage helpers ───────────────────────────────────────────────
export type GlossaryTerm = {
  id: number;
  org_id: number;
  term: string;
  definition: string;
  category: string | null;
  created_at: string;
  updated_at: string;
};

export function listGlossaryTerms(): GlossaryTerm[] {
  const oid = currentOrgId() ?? 1;
  return sqlite
    .prepare(`SELECT * FROM glossary_terms WHERE org_id = ? ORDER BY category COLLATE NOCASE, term COLLATE NOCASE`)
    .all(oid) as GlossaryTerm[];
}

export function createGlossaryTerm(data: { term: string; definition: string; category?: string | null }): GlossaryTerm {
  const oid = currentOrgId() ?? 1;
  const term = String(data.term || "").trim();
  const definition = String(data.definition || "").trim();
  const category = data.category ? String(data.category).trim() : null;
  if (!term) throw new Error("term is required");
  if (!definition) throw new Error("definition is required");
  const info = sqlite
    .prepare(`INSERT INTO glossary_terms (org_id, term, definition, category) VALUES (?, ?, ?, ?)`)
    .run(oid, term, definition, category);
  return sqlite.prepare(`SELECT * FROM glossary_terms WHERE id = ?`).get(info.lastInsertRowid) as GlossaryTerm;
}

export function updateGlossaryTerm(id: number, data: Partial<{ term: string; definition: string; category: string | null }>): GlossaryTerm | null {
  const oid = currentOrgId() ?? 1;
  const existing = sqlite.prepare(`SELECT * FROM glossary_terms WHERE id = ? AND org_id = ?`).get(id, oid) as GlossaryTerm | undefined;
  if (!existing) return null;
  const fields: string[] = [];
  const vals: any[] = [];
  if (data.term !== undefined) { fields.push("term = ?"); vals.push(String(data.term).trim()); }
  if (data.definition !== undefined) { fields.push("definition = ?"); vals.push(String(data.definition).trim()); }
  if (data.category !== undefined) {
    fields.push("category = ?");
    vals.push(data.category === null ? null : String(data.category).trim() || null);
  }
  if (!fields.length) return existing;
  fields.push("updated_at = datetime('now')");
  vals.push(id, oid);
  sqlite.prepare(`UPDATE glossary_terms SET ${fields.join(", ")} WHERE id = ? AND org_id = ?`).run(...vals);
  return sqlite.prepare(`SELECT * FROM glossary_terms WHERE id = ?`).get(id) as GlossaryTerm;
}

export function deleteGlossaryTerm(id: number): boolean {
  const oid = currentOrgId() ?? 1;
  const info = sqlite.prepare(`DELETE FROM glossary_terms WHERE id = ? AND org_id = ?`).run(id, oid);
  return info.changes > 0;
}

// ── Loan Officer Assistants (LOAs) ──────────────────────────────────────────
// LOAs belong to a parent LO. Stats always roll up to the parent (lead_outcomes.lo_id);
// loa_id is stored only for display so notes/UI can show who actually worked the lead.
function normalizeLoa(row: any): any {
  if (!row) return row;
  return {
    id: row.id,
    loId: row.lo_id,
    fullName: row.full_name,
    active: row.active,
    createdAt: row.created_at,
  };
}
export function getLoanOfficerAssistants(loId?: number) {
  if (loId != null) {
    return (sqlite.prepare(`SELECT * FROM loan_officer_assistants WHERE lo_id = ? AND active = 1 ORDER BY full_name`).all(loId) as any[]).map(normalizeLoa);
  }
  return (sqlite.prepare(`SELECT * FROM loan_officer_assistants WHERE active = 1 ORDER BY full_name`).all() as any[]).map(normalizeLoa);
}
export function getLoanOfficerAssistant(id: number) {
  return normalizeLoa(sqlite.prepare(`SELECT * FROM loan_officer_assistants WHERE id = ?`).get(id));
}
export function createLoanOfficerAssistant(data: { loId: number; fullName: string }) {
  const info = sqlite.prepare(
    `INSERT INTO loan_officer_assistants (lo_id, full_name, active, created_at) VALUES (?, ?, 1, ?)`
  ).run(data.loId, data.fullName, new Date().toISOString());
  return getLoanOfficerAssistant(Number(info.lastInsertRowid));
}
export function deleteLoanOfficerAssistant(id: number) {
  // Soft-delete so historical outcomes that reference this LOA still resolve a name.
  sqlite.prepare(`UPDATE loan_officer_assistants SET active = 0 WHERE id = ?`).run(id);
}
