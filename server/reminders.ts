import { Resend } from "resend";
import { getRawSqlite, storage } from "./storage";
import { sendPushToUser } from "./push";
import { sendSms, isTwilioConfigured, normalizePhone } from "./sms";
import { parseWallClockInTz, BUSINESS_DAY_DEFAULT_TZ } from "./business-day";

const DEFAULT_RESEND_KEY = "re_6yaHVd97_U3jABCg6Az64GCrkHCk2J24Q";
const DEFAULT_FROM = "CLR Connection Center <reports@westcapitallending.center>";

function resolveResendKey(): string {
  try {
    const row = getRawSqlite().prepare(`SELECT resend_api_key FROM email_settings WHERE id=1`).get() as any;
    const dbKey = String(row?.resend_api_key || "").trim();
    if (/^re_[A-Za-z0-9_]{28,}$/.test(dbKey)) return dbKey;
  } catch {}
  return DEFAULT_RESEND_KEY;
}

function resolveFrom(): string {
  try {
    const row = getRawSqlite().prepare(`SELECT from_address_resend FROM email_settings WHERE id=1`).get() as any;
    const from = String(row?.from_address_resend || "").trim();
    if (from.includes("@")) return from.includes("<") ? from : `CLR Connection Center <${from}>`;
  } catch {}
  return DEFAULT_FROM;
}

function fmtDateTime(iso: string, tz?: string): string {
  // The stored value (e.g. "2026-05-06T15:00") has no timezone offset, so
  // resolve it as a wall-clock time in the user's tz before formatting —
  // otherwise it would render in the server's local tz (UTC on Railway).
  try {
    const ms = parseWallClockInTz(iso, tz || BUSINESS_DAY_DEFAULT_TZ);
    if (!Number.isFinite(ms)) return iso;
    return new Date(ms).toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: tz || BUSINESS_DAY_DEFAULT_TZ,
    });
  } catch { return iso; }
}

type PendingOutcome = {
  outcome_id: number;
  assistant_id: number;
  org_id: number;
  outcome_type: string;
  borrower_name: string | null;
  notes: string | null;
  scheduled_date: string;
  clr_name: string;
  clr_email: string;
  clr_phone: string | null;
  clr_reminder_enabled: number;
  clr_sms_enabled: number;
  clr_timezone: string;
  lo_name: string;
};

/**
 * Find upcoming appointments/callbacks in next 24h that haven't had a reminder
 * sent in the last 12h. Outcome's scheduled_date comes from either the
 * outcome-specific datetime columns (appointment_datetime, reschedule_datetime,
 * followup_date) or follow_up_date as a last resort.
 */
function findPendingReminders(): PendingOutcome[] {
  const sqlite = getRawSqlite();
  // Use COALESCE to pick the first non-null scheduled date column.
  // appointment_datetime — transfer-with-appointment & appointment outcomes
  // reschedule_datetime  — rescheduled appointments
  // followup_date        — callback_requested & generic followup
  // follow_up_date       — legacy column
  const rows = sqlite.prepare(`
    SELECT
      lo.id AS outcome_id,
      lo.assistant_id,
      lo.outcome_type,
      lo.borrower_name,
      lo.notes,
      COALESCE(
        NULLIF(lo.appointment_datetime, ''),
        NULLIF(lo.reschedule_datetime, ''),
        NULLIF(lo.followup_date, ''),
        NULLIF(lo.follow_up_date, '')
      ) AS scheduled_date,
      u.name AS clr_name,
      u.email AS clr_email,
      u.phone AS clr_phone,
      u.reminder_email_enabled AS clr_reminder_enabled,
      u.sms_reminders_enabled AS clr_sms_enabled,
      COALESCE(u.timezone, 'America/Los_Angeles') AS clr_timezone,
      COALESCE(u.org_id, 1) AS org_id,
      loff.full_name AS lo_name
    FROM lead_outcomes lo
    JOIN users u ON u.id = lo.assistant_id
    LEFT JOIN loan_officers loff ON loff.id = lo.lo_id
    WHERE lo.outcome_type IN ('appointment', 'callback_requested')
      AND COALESCE(
        NULLIF(lo.appointment_datetime, ''),
        NULLIF(lo.reschedule_datetime, ''),
        NULLIF(lo.followup_date, ''),
        NULLIF(lo.follow_up_date, '')
      ) IS NOT NULL
  `).all() as PendingOutcome[];

  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  const twelveHoursAgoIso = new Date(now - 12 * 60 * 60 * 1000).toISOString();

  const existingReminderStmt = sqlite.prepare(`
    SELECT sent_at FROM reminder_log
    WHERE outcome_id = ? AND reminder_type IN ('email','sms')
    ORDER BY sent_at DESC LIMIT 1
  `);

  return rows.filter(r => {
    // Push always fires (no opt-in column for push specifically). Email/SMS
    // are gated on their respective opt-ins below. We still want to consider
    // the row even if the user has all channels disabled — push will at least
    // attempt to fire — but if NOTHING is enabled we may as well skip.
    const emailOk = !!r.clr_reminder_enabled && !!r.clr_email;
    const smsOk = !!r.clr_sms_enabled && !!r.clr_phone;
    // Only require at least one delivery surface; push is best-effort and
    // requires a saved subscription which we can't know cheaply here.
    if (!emailOk && !smsOk) {
      // Allow row through anyway so push still gets a shot. Push delivery
      // itself is a no-op when there are no subscriptions.
    }
    // Parse the stored wall-clock datetime in the CLR's timezone, not the
    // server's. Without this, on a UTC-running server, "3:00 PM" picked by a
    // Pacific user resolves to 8:00 AM Pacific — 7 hours early.
    const t = parseWallClockInTz(r.scheduled_date, r.clr_timezone || BUSINESS_DAY_DEFAULT_TZ);
    if (!Number.isFinite(t)) return false;
    if (t <= now || t > in24h) return false; // must be in the future, within 24h
    const existing = existingReminderStmt.get(r.outcome_id) as any;
    if (existing && existing.sent_at > twelveHoursAgoIso) return false;
    return true;
  });
}

function buildEmail(o: PendingOutcome): { subject: string; html: string } {
  const label = o.outcome_type === "appointment" ? "Appointment" : "Callback";
  const actionNoun = o.outcome_type === "appointment" ? "appointment" : "callback";
  const borrower = o.borrower_name?.trim() || "Unknown";
  const when = fmtDateTime(o.scheduled_date, o.clr_timezone);
  const subject = `Reminder: ${label} with ${borrower} — ${when}`;
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] || c));
  const notesRow = o.notes?.trim()
    ? `<p style="margin:6px 0"><strong>Notes:</strong> ${esc(o.notes.trim())}</p>`
    : "";
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1e293b;line-height:1.55">
  <p>Hi ${esc(o.clr_name)},</p>
  <p>You have an upcoming ${actionNoun} scheduled:</p>
  <div style="border-left:3px solid #1A2B4A;padding:8px 14px;background:#f8fafc;margin:12px 0">
    <p style="margin:6px 0"><strong>Borrower:</strong> ${esc(borrower)}</p>
    <p style="margin:6px 0"><strong>LO:</strong> ${esc(o.lo_name || "Unknown")}</p>
    <p style="margin:6px 0"><strong>Scheduled:</strong> ${esc(when)}</p>
    ${notesRow}
  </div>
  <p>Log in to CLR Connection Center to complete or reschedule.</p>
  <p style="margin-top:18px">
    <a href="https://www.westcapitallending.center" style="background:#1A2B4A;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:500">Login</a>
  </p>
  <p style="color:#64748b;font-size:12px;margin-top:28px">
    You're receiving this because reminder emails are enabled on your account. Disable them in Settings → Profile.
  </p>
</body></html>`;
  return { subject, html };
}

/**
 * Check all upcoming appointments/callbacks and send reminder emails where due.
 * Respects org-level `reminders_enabled` and per-user `reminder_email_enabled`.
 */
export async function runRemindersTick(): Promise<{ sent: number; skipped: number; errors: number }> {
  const sqlite = getRawSqlite();
  const stats = { sent: 0, skipped: 0, errors: 0 };

  let orgEnabled = 1;
  try {
    const row = sqlite.prepare(`SELECT reminders_enabled FROM org_settings WHERE org_id = 1`).get() as any;
    if (row && row.reminders_enabled === 0) orgEnabled = 0;
  } catch {}
  if (!orgEnabled) {
    console.log("[reminders] org-level reminders disabled; skipping tick");
    return stats;
  }

  const pending = findPendingReminders();
  if (!pending.length) return stats;

  const apiKey = resolveResendKey();
  const from = resolveFrom();
  const resend = new Resend(apiKey);
  const insertLog = sqlite.prepare(`
    INSERT OR REPLACE INTO reminder_log (outcome_id, user_id, reminder_type, sent_at)
    VALUES (?, ?, 'email', datetime('now'))
  `);
  const insertSmsLog = sqlite.prepare(`
    INSERT OR REPLACE INTO reminder_log (outcome_id, user_id, reminder_type, sent_at)
    VALUES (?, ?, 'sms', datetime('now'))
  `);

  for (const o of pending) {
    const { subject, html } = buildEmail(o);
    const oTz = o.clr_timezone || BUSINESS_DAY_DEFAULT_TZ;
    const emailEligible = !!o.clr_reminder_enabled && !!o.clr_email;
    try {
      if (emailEligible) {
        const result = await resend.emails.send({ from, to: [o.clr_email], subject, html });
        if (result?.error) {
          stats.errors++;
          console.error(`[reminders] send failed outcome=${o.outcome_id} to=${o.clr_email}:`, result.error);
        } else {
          insertLog.run(o.outcome_id, o.assistant_id);
          stats.sent++;
          console.log(`[reminders] sent outcome=${o.outcome_id} to=${o.clr_email} id=${result?.data?.id}`);
        }
      }
      // SMS (best-effort, only if Twilio configured AND user has sms enabled + phone)
      if (
        o.clr_sms_enabled &&
        o.clr_phone &&
        normalizePhone(o.clr_phone) &&
        isTwilioConfigured(o.org_id)
      ) {
        const kind = o.outcome_type === "appointment" ? "appointment" : "callback";
        const when = fmtDateTime(o.scheduled_date, oTz);
        const borrower = o.borrower_name?.trim() || "Unknown";
        const smsBody = `CLR Connection Center: Reminder — you have a ${kind} scheduled at ${when} with borrower ${borrower}. Log in: https://www.westcapitallending.center`;
        const smsResult = await sendSms(o.clr_phone, smsBody, o.org_id);
        if (smsResult.ok) {
          insertSmsLog.run(o.outcome_id, o.assistant_id);
          console.log(`[reminders] sms sent outcome=${o.outcome_id} to=${o.clr_phone} sid=${smsResult.sid}`);
        } else if (!smsResult.skipped) {
          stats.errors++;
        }
      }
      // Mirror to push notifications (best-effort). Push fires regardless of
      // email/SMS opt-in. Deep-link into /appointments so tapping the
      // notification opens the upcoming-appointments view.
      try {
        const borrower = o.borrower_name?.trim() || "this lead";
        const when = fmtDateTime(o.scheduled_date, oTz);
        const kind = o.outcome_type === "appointment" ? "Appointment" : "Callback";
        await sendPushToUser(o.assistant_id, {
          title: `⏰ ${kind} reminder — ${borrower}`,
          body: `${when} — LO: ${o.lo_name || "Unknown"}`,
          url: "/appointments",
        });
      } catch (e: any) {
        console.error(`[reminders] push failed outcome=${o.outcome_id}:`, e?.message ?? e);
      }
    } catch (e: any) {
      stats.errors++;
      console.error(`[reminders] exception outcome=${o.outcome_id}:`, e?.message ?? e);
    }
  }
  return stats;
}
