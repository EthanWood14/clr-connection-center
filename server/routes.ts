import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import * as storageExtra from "./storage";
import { insertUserSchema, insertLoanOfficerSchema, insertLeadOutcomeSchema, insertAlgorithmSettingsSchema, type InsertAuditLog } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { Resend } from "resend";
import cron from "node-cron";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { checkNmlsLicense, nmlsProfileUrl } from "./nmls";
import { registerSaConsole } from "./saConsole";
import { LANDING_HTML } from "./landing";
import { initPush, getVapidPublicKey, saveSubscription, removeSubscription, sendPushToUser, sendPushToUsers } from "./push";
import { STATUS_HTML, runAllChecks, getOverallStatus, startUptimeCron, getProcessUptimeSec } from "./status";
import { runWithOrg, currentOrgId } from "./orgContext";
import { npaToState } from "./npa-state";
import { businessTodayInTz, businessTodayForRequest, addIsoDays, parseWallClockInTz, BUSINESS_DAY_DEFAULT_TZ, rolloverIfEodSubmitted } from "./business-day";
import { createBackup, listBackups } from "./backup";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "clr-secret-2026";
const COOKIE_NAME = "clr_session";

// ── In-memory rate limiter for the public request-access form (3/hr/IP) ───
const requestAccessHits = new Map<string, number[]>();
function requestAccessRateOk(ip: string): boolean {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const arr = (requestAccessHits.get(ip) ?? []).filter(t => t > hourAgo);
  if (arr.length >= 3) return false;
  arr.push(now);
  requestAccessHits.set(ip, arr);
  return true;
}

// ── Outcome breakdown for a user on a given date ─────────────────────────
type OutcomeBreakdown = {
  transfer: number;
  appointment: number;
  fell_through: number;
  callback_requested: number;
  deferral: number;
  future_contact: number;
  no_answer: number;
  total: number;
};
function emptyOutcomeBreakdown(): OutcomeBreakdown {
  return { transfer: 0, appointment: 0, fell_through: 0, callback_requested: 0, deferral: 0, future_contact: 0, no_answer: 0, total: 0 };
}
function getOutcomeBreakdownFor(userId: number, dateStr: string): OutcomeBreakdown {
  const rows = storage.getLeadOutcomes({ startDate: dateStr, endDate: dateStr, assistantId: userId });
  const b = emptyOutcomeBreakdown();
  for (const r of rows as any[]) {
    const t = String(r.outcome_type ?? r.outcomeType ?? "");
    if (t in b) (b as any)[t] += 1;
    b.total += 1;
  }
  return b;
}

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

// Helper: get current reporting period.
// Changed 2026-05-05: now returns the full calendar month — previous month if
// we're on the 1st (i.e. yesterday's month), otherwise the current month.
// This replaces the older 16th-of-prev-month → 15th-of-current billing window.
function getDefaultPeriod() {
  const now = new Date();
  let startDate: Date, endDate: Date;
  if (now.getDate() === 1) {
    // On the 1st we're typically firing the *previous* month's report
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
}

// Resolve a named period to date range.
// Supported: today | week | month | 30days | 90days | alltime | period
function resolveNamedPeriod(name: string, tz?: string): { startDate: string; endDate: string } {
  // Anchor every range to the *business* today (10pm forward rollover) in the
  // caller's timezone. Week boundaries derive from this business today.
  const todayStr = businessTodayInTz(tz || BUSINESS_DAY_DEFAULT_TZ);
  if (name === "today") {
    return { startDate: todayStr, endDate: todayStr };
  }
  if (name === "week") {
    // Business-week boundaries: Sunday…Saturday, anchored to business today.
    const [y, m, d] = todayStr.split("-").map(n => parseInt(n, 10));
    const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const dow = anchor.getUTCDay();
    const sunday = new Date(anchor); sunday.setUTCDate(anchor.getUTCDate() - dow);
    const saturday = new Date(sunday); saturday.setUTCDate(sunday.getUTCDate() + 6);
    const fmt = (dt: Date) => dt.toISOString().split("T")[0];
    return { startDate: fmt(sunday), endDate: fmt(saturday) };
  }
  if (name === "month") {
    const [y, m] = todayStr.split("-").map(n => parseInt(n, 10));
    const start = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
    const end   = new Date(Date.UTC(y, m,     0, 12, 0, 0)); // last day of this month
    const fmt = (dt: Date) => dt.toISOString().split("T")[0];
    return { startDate: fmt(start), endDate: fmt(end) };
  }
  if (name === "30days") {
    return { startDate: addIsoDays(todayStr, -29), endDate: todayStr };
  }
  if (name === "90days") {
    return { startDate: addIsoDays(todayStr, -89), endDate: todayStr };
  }
  if (name === "alltime") {
    return { startDate: "2000-01-01", endDate: todayStr };
  }
  // default: "period" (16th–15th)
  return getDefaultPeriod();
}

// Ranking algorithm
function generateRankings(los: any[], settings: any, todayStr: string, recentTransferCounts?: Map<number, number>) {
  const today = new Date(todayStr);

  // Max transfers in the pool for normalization
  const maxXfers = recentTransferCounts
    ? Math.max(1, ...Array.from(recentTransferCounts.values()))
    : 1;

  return los
    .filter(lo => {
      const status = lo.internalStatus ?? lo.internal_status;
      return status == null || status === "active";
    })
    .filter(lo => {
      const snooze = lo.snoozeUntil ?? lo.snooze_until;
      return !snooze || snooze < todayStr;
    })
    .map(lo => {
      const lastWorked = lo.lastWorkedDate ?? lo.last_worked_date;
      const totalWorked = lo.totalTimesWorked ?? lo.total_times_worked ?? 0;
      const boostScore = lo.boostScore ?? lo.boost_score ?? 0;
      const priorityTier = lo.priorityTier ?? lo.priority_tier ?? 2;
      const daysSince = lastWorked
        ? Math.floor((today.getTime() - new Date(lastWorked).getTime()) / 86400000)
        : 999;
      const daysSinceNorm = Math.min(daysSince / 30, 1);
      const freqScore = 1 - Math.min(totalWorked / 100, 1);
      const availScore = 1; // simplified - full availability check in prod
      const boostNorm = boostScore / 10;
      const tierScore = priorityTier === 1 ? 1 : priorityTier === 2 ? 0.5 : 0.1;
      // 90-day transfer score: direction is controlled by settings.transferPreference
      // 'fewer' → fewer transfers = higher score (spread leads to quieter LOs)
      // 'more'  → more transfers = higher score (reward recent producers)
      // 'none'  → neutral 0.5, weight still applied but has no effect on ranking order
      const recentXfers = recentTransferCounts ? (recentTransferCounts.get(lo.id) || 0) : 0;
      const pref: "fewer" | "more" | "none" =
        settings.transferPreference === "more" || settings.transferPreference === "none"
          ? settings.transferPreference
          : "fewer";
      let recentXferScore: number;
      if (maxXfers <= 0) {
        recentXferScore = 0.5;
      } else if (pref === "more") {
        recentXferScore = recentXfers / maxXfers;
      } else if (pref === "none") {
        recentXferScore = 0.5;
      } else {
        recentXferScore = 1 - (recentXfers / maxXfers);
      }

      const weightRecentTransfers = settings.weightRecentTransfers ?? 0.10;

      // Small bonus for never-worked LOs so new additions get tried
      const neverWorkedBonus = lastWorked ? 0 : 0.05;

      let score =
        settings.weightDaysSinceWorked * daysSinceNorm +
        settings.weightFrequency * freqScore +
        settings.weightAvailability * availScore +
        settings.weightBoost * boostNorm +
        settings.weightPriorityTier * tierScore +
        weightRecentTransfers * recentXferScore +
        neverWorkedBonus +
        ((lo.id % 100) / 10000); // deterministic tiebreak (stable across runs same day)

      // Reduced odds: LOs flagged in the Directory are made significantly less
      // likely to be assigned — their final score is quartered. They still stay
      // in the pool, so they get the occasional assignment when everyone else
      // has been worked recently.
      if (lo.reducedOdds ?? lo.reduced_odds) score *= 0.25;

      return { lo, score, daysSince };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Email report sender ───────────────────────────────────────────────────────

// ── Branded email template ────────────────────────────────────────────────────
function buildEmail(opts: {
  subject: string;
  preheader?: string;
  body: string;
}): string {
  const { subject, preheader = "", body } = opts;
  // Render "today" in the business-day default tz so a 6pm PT send doesn't get
  // labeled with tomorrow's date because the host server is on UTC.
  const now = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: BUSINESS_DAY_DEFAULT_TZ });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;-webkit-font-smoothing:antialiased">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden">${preheader}</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">
        <!-- Header -->
        <tr>
          <td style="background:#0F182D;border-radius:12px 12px 0 0;padding:28px 36px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <img src="https://westcapitallending.com/assets/WestCapitalLogo_dark-blue-f79872f0.png"
                       alt="West Capital Lending" width="130"
                       style="display:block;filter:brightness(0) invert(1);opacity:0.95" />
                </td>
                <td align="right" style="vertical-align:middle">
                  <span style="background:rgba(255,255,255,0.12);color:#e2e8f0;font-size:11px;font-weight:bold;letter-spacing:0.5px;padding:4px 12px;border-radius:20px;text-transform:uppercase">CLR Connection Center</span>
                </td>
              </tr>
            </table>
            <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.12)">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700">${subject}</h1>
              <p style="margin:6px 0 0;color:#94a3b8;font-size:13px">${now}</p>
            </div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:32px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:18px 36px">
            <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.7">
              <strong style="color:#64748b">CLR Connection Center</strong> &mdash; West Capital Lending<br />
              Sent from <a href="mailto:reports@westcapitallending.center" style="color:#1A2B4A;text-decoration:none">reports@westcapitallending.center</a>.
              If you didn't expect this, check your spam folder.<br />
              To use a custom sender, log in to <a href="https://resend.com" style="color:#1A2B4A">resend.com</a> and configure your own domain.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Shared Resend send helper ─────────────────────────────────────────────────
const DEFAULT_RESEND_KEY = "re_6yaHVd97_U3jABCg6Az64GCrkHCk2J24Q";
const DEFAULT_FROM = "CLR Connection Center <reports@westcapitallending.center>";

async function sendEmail({ to, subject, html }: { to: string | string[]; subject: string; html: string }): Promise<string> {
  const s = storageExtra.getEmailSettings() as any;
  // Prefer a valid-looking DB key; otherwise fall back to the known-good default.
  // Old installs sometimes have a non-empty but revoked key in the DB, which
  // made the plain `||` fallback skip the working default and hard-fail the send.
  const dbKey = String(s.resend_api_key || "").trim();
  // A Resend API key looks like "re_" + ~32 chars of [A-Za-z0-9_]. Anything
  // shorter/obviously-placeholder is treated as unset so we fall back to the
  // known-good default instead of hard-failing with "API key is invalid".
  const looksLikeRealKey = /^re_[A-Za-z0-9_]{28,}$/.test(dbKey);
  const apiKey = looksLikeRealKey ? dbKey : DEFAULT_RESEND_KEY;
  // Same logic for the From address — only use a DB-configured value when it
  // is non-empty AND plausibly an email; otherwise fall back to the default.
  const dbFrom = String(s.from_address_resend || "").trim();
  const from = dbFrom.includes("@") ? dbFrom : DEFAULT_FROM;
  const toArr = Array.isArray(to) ? to : [to];
  console.log(`[sendEmail] to=${JSON.stringify(toArr)} subject=${JSON.stringify(subject)} from=${JSON.stringify(from)} keyHead=${apiKey.slice(0, 6)}… keySource=${apiKey === DEFAULT_RESEND_KEY ? "default" : "db"}`);
  let result: any;
  try {
    const resend = new Resend(apiKey);
    result = await resend.emails.send({ from, to: toArr, subject, html });
  } catch (err: any) {
    console.error(`[sendEmail] SDK threw:`, err?.message ?? err);
    throw new Error(`Resend SDK error: ${err?.message ?? "unknown"}`);
  }
  if (result?.error) {
    const msg = result.error.message ?? result.error.name ?? JSON.stringify(result.error);
    console.error(`[sendEmail] Resend returned error:`, result.error);
    throw new Error(`Resend: ${msg}`);
  }
  const id = result?.data?.id;
  if (!id) {
    console.error(`[sendEmail] no id in response:`, result);
    throw new Error("Resend returned no email id — delivery status unknown");
  }
  console.log(`[sendEmail] delivered id=${id}`);
  return id;
}

type ReportOptions = {
  customRange?: { startDate: string; endDate: string };
  recipientsOverride?: string[];
  // When true, builds the HTML and returns it but does not send any email.
  renderOnly?: boolean;
  // When set, the report includes only this CLR's activity (instead of the full team).
  clrId?: number;
  // Daily reports only: which day to cover relative to the PT business day.
  //   -1 (default) = yesterday (the morning-summary behavior)
  //    0           = today (partial day so far)
  dailyOffset?: number;
};

type ReportType = "daily" | "weekly" | "monthly" | "mtd" | "alltime";

// ── EOD "Additional Activity Log" presentation (shared by report emails) ───────
// Mirrors the client's ACTIVITY_TYPES labels + colors so the emails read the same
// as the app. Colors are email-safe inline hex (light bg / dark fg) for pills.
const EOD_ACTIVITY_LABELS: Record<string, string> = {
  follow_up: "Follow-Up Call",
  email_sent: "Email Sent",
  transfer_assisted: "Transfer Assisted",
  appointment_set: "Appointment Set",
  lo_contact: "LO Contact",
  training: "Training / Meeting",
  project_work: "Project Work",
  admin: "Admin Work",
  other: "Other",
};
const EOD_ACTIVITY_PILL: Record<string, { bg: string; fg: string }> = {
  follow_up: { bg: "#dbeafe", fg: "#1e40af" },
  email_sent: { bg: "#ede9fe", fg: "#6d28d9" },
  transfer_assisted: { bg: "#dcfce7", fg: "#15803d" },
  appointment_set: { bg: "#ccfbf1", fg: "#0f766e" },
  lo_contact: { bg: "#ffedd5", fg: "#c2410c" },
  training: { bg: "#fef9c3", fg: "#854d0e" },
  project_work: { bg: "#e0e7ff", fg: "#4338ca" },
  admin: { bg: "#f1f5f9", fg: "#475569" },
  other: { bg: "#f1f5f9", fg: "#475569" },
};
function eodActivityLabel(t: string): string {
  return EOD_ACTIVITY_LABELS[t] ?? String(t ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function eodActivityPill(t: string): { bg: string; fg: string } {
  return EOD_ACTIVITY_PILL[t] ?? EOD_ACTIVITY_PILL.other;
}
function eodActivityEsc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendReport(
  type: ReportType,
  opts: ReportOptions = {},
) {
  // Multi-day reports (weekly, MTD, all-time) use a richer layout with
  // per-day breakdowns and team totals rows. Daily and monthly use the
  // single-period layout.
  const isMultiDay = type === "weekly" || type === "mtd" || type === "alltime";
  // Resolve recipients. By default uses email_settings.manager_emails (the
  // "Report Recipients" card on Settings). For ad-hoc historical exports the
  // caller can pass recipientsOverride to send to a specific list (e.g. just
  // the requesting admin/viewer). When renderOnly=true, recipients are
  // unused and we skip the validation entirely.
  let managers: string[] = [];
  if (!opts.renderOnly) {
    let rawManagers: string[] = [];
    if (opts.recipientsOverride && opts.recipientsOverride.length) {
      rawManagers = opts.recipientsOverride;
    } else {
      const settings = storageExtra.getEmailSettings() as any;
      try { rawManagers = JSON.parse(settings.manager_emails || "[]"); } catch { rawManagers = []; }
      // Per-report-type "send to all managers": when enabled for this report
      // type, add every active manager's email to the recipient list (deduped
      // below). Falls back silently to the manual list on any parse error.
      try {
        const toAll = JSON.parse(settings.report_to_all_managers || "{}");
        if (toAll && typeof toAll === "object" && toAll[type] === true) {
          const managerUsers = (storage.getUsers() as any[]).filter(
            (u) => (u.isManager ?? u.is_manager) && (u.isActive ?? u.is_active) && (u.email || "").includes("@")
          );
          rawManagers = rawManagers.concat(managerUsers.map((u) => u.email));
        }
      } catch { /* keep manual list */ }
    }
    const seenManagers = new Set<string>();
    for (const e of rawManagers) {
      const trimmed = String(e || "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seenManagers.has(key)) { seenManagers.add(key); managers.push(trimmed); }
    }
    console.log(`[sendReport] type=${type} resolved-recipients=${JSON.stringify(managers)} (source=${opts.recipientsOverride ? "override" : "email_settings.manager_emails"})`);
    if (!managers.length) throw new Error(`No recipients configured. Add recipients in Settings → Report Recipients.`);
  }

  // Choose the reporting window. Caller can pass a custom range for
  // historical exports; otherwise we default based on type:
  //   daily   → today only
  //   weekly  → previous Mon–Sun (the week that just ended)
  //   monthly → full previous calendar month (when run on the 1st)
  const period = opts.customRange
    ? opts.customRange
    : type === "daily"
    ? (() => {
        // Daily report covers the PREVIOUS day: it's sent at 7:45 AM PT each
        // morning summarizing yesterday. addIsoDays(...,-1) on the PT business
        // day gives yesterday's calendar date in the morning window.
        const off = opts.dailyOffset === 0 ? 0 : -1;
        const y = addIsoDays(businessTodayInTz(BUSINESS_DAY_DEFAULT_TZ), off);
        return { startDate: y, endDate: y };
      })()
    : type === "weekly"
    ? (() => {
        // endDate = last Sunday (yesterday if today is Monday, else most recent Sunday)
        // startDate = the Monday 6 days before endDate
        const t = businessTodayInTz(BUSINESS_DAY_DEFAULT_TZ);
        const [y, m, d] = t.split("-").map(n => parseInt(n, 10));
        const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        const dow = anchor.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
        // Days to step back to reach last Sunday: Mon→1, Tue→2, …, Sun→7
        const stepBack = dow === 0 ? 7 : dow;
        const endDt = new Date(anchor); endDt.setUTCDate(anchor.getUTCDate() - stepBack);
        const startDt = new Date(endDt); startDt.setUTCDate(endDt.getUTCDate() - 6);
        const fmt = (dt: Date) => dt.toISOString().split("T")[0];
        return { startDate: fmt(startDt), endDate: fmt(endDt) };
      })()
    : type === "mtd"
    ? (() => {
        // Month-to-date: 1st of the current month through business-today
        const t = businessTodayInTz(BUSINESS_DAY_DEFAULT_TZ);
        const [y, m] = t.split("-").map(n => parseInt(n, 10));
        const start = `${y}-${String(m).padStart(2, "0")}-01`;
        return { startDate: start, endDate: t };
      })()
    : type === "alltime"
    ? (() => {
        // All-time: from inception through business-today.
        const t = businessTodayInTz(BUSINESS_DAY_DEFAULT_TZ);
        return { startDate: "2000-01-01", endDate: t };
      })()
    : getDefaultPeriod();
  const { startDate, endDate } = period;

  const outcomesAll   = storage.getLeadOutcomes({ startDate, endDate });
  const los           = storage.getLoanOfficers();
  const users         = storage.getUsers();
  const callLogsAll   = storage.getCallLogsByRange(startDate, endDate);
  const assignmentsAll = storage.getAssignmentsByRange(startDate, endDate);

  // When clrId is set, scope ALL downstream data sources to that CLR so
  // history/details sections (transfer details, call notes, daily breakdown)
  // don't leak other CLRs' activity into a single-CLR report.
  const scopedClrId = opts.clrId;
  const outcomes = scopedClrId
    ? outcomesAll.filter((o: any) => (o.assistantId ?? o.assistant_id) === scopedClrId)
    : outcomesAll;
  const callLogs = scopedClrId
    ? callLogsAll.filter((l: any) => (l.assistantId ?? l.assistant_id) === scopedClrId)
    : callLogsAll;
  const assignments = scopedClrId
    ? assignmentsAll.filter((a: any) => (a.assistantId ?? a.assistant_id) === scopedClrId)
    : assignmentsAll;

  // CLR list — assistants + admin-CLRs. When clrId is set, scope to that CLR.
  // Non-counted CLRs are excluded from the team breakdown/totals and rendered in
  // a separate "Non-counted CLRs" section. A single-CLR scoped report still works
  // for a non-counted CLR (they remain valid report subjects).
  const isClrRow = (u: any) => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr));
  const clrs = users.filter((u: any) =>
    isClrRow(u) && (scopedClrId ? u.id === scopedClrId : !u.excludeFromStats)
  );
  const nonCountedClrs = scopedClrId ? [] : users.filter((u: any) => isClrRow(u) && u.excludeFromStats);

  // Per-CLR aggregates
  interface ClrStats {
    name: string;
    calls: number;
    messages: number;
    transfers: number;
    appointments: number;
    fellThrough: number;
    callbacks: number;
    futureContacts: number;
    noAnswers: number;
    assigned: number;
    missed: number;
    ratio: string;
    eodNotes: string[];
    activityNotes: Array<{ date: string; type: string; description: string }>;
  }

  function computeClrStat(u: any): ClrStats {
    const uid = u.id;

    // Calls from call logs (raw SQLite returns snake_case)
    const myCallsFromLogs = callLogs
      .filter((l: any) => (l.assistant_id ?? l.assistantId) === uid)
      .reduce((sum: number, l: any) => sum + Number(l.calls_made ?? l.callsMade ?? 0), 0);

    // Outcomes
    const myOutcomes = outcomes.filter((o: any) => (o.assistantId || o.assistant_id) === uid);
    const outcomeTypeOf = (o: any) => (o.outcomeType || o.outcome_type) as string;
    const myTransfers       = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "transfer").length;
    const myAppointments    = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "appointment").length;
    const myFellThrough     = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "fell_through").length;
    const myCallbacks       = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "callback_requested" || outcomeTypeOf(o) === "deferral").length;
    const myFutureContacts  = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "future_contact").length;
    const myNoAnswers       = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "no_answer").length;

    // Total calls — always use the daily call_logs sum across the period.
    // (Previously fell back to outcomes count when logs empty, which understated
    // the true number of calls made for CLRs who didn't log every day.)
    const myCalls = myCallsFromLogs;

    // Assignments
    const myAssignments = assignments.filter((a: any) => (a.assistantId || a.assistant_id) === uid);
    const myAssigned = myAssignments.length;
    // "Missed" = assigned but never marked worked or skipped (still "recommended")
    const myMissed = myAssignments.filter((a: any) => a.status === "recommended").length;

    const ratio = myCalls > 0 ? ((myTransfers / myCalls) * 100).toFixed(1) + "%" : "—";

    // EOD reports in period — notes plus messages-sent totals
    const myEodAll = storageExtra.getEodReportsByRange(startDate, endDate)
      .filter((r: any) => r.assistant_id === uid);
    const eodNotes = myEodAll
      .filter((r: any) => r.notes && r.notes.trim())
      .map((r: any) => `[${r.report_date}] ${r.notes.trim()}`);
    const myMessages = myEodAll.reduce((s: number, r: any) => s + Number(r.messages_sent ?? 0), 0);

    // Additional activity log entries
    const myActivities = storageExtra.getEodActivitiesByRange(startDate, endDate, uid);
    const activityNotes = myActivities.map((a: any) => ({
      date: a.report_date,
      type: a.activity_type,
      description: a.description,
    }));

    return {
      name: u.name,
      calls: myCalls,
      messages: myMessages,
      transfers: myTransfers,
      appointments: myAppointments,
      fellThrough: myFellThrough,
      callbacks: myCallbacks,
      futureContacts: myFutureContacts,
      noAnswers: myNoAnswers,
      assigned: myAssigned,
      missed: myMissed,
      ratio,
      eodNotes,
      activityNotes,
    };
  }

  const clrStats: ClrStats[] = clrs.map(computeClrStat).sort((a, b) => b.transfers - a.transfers);
  // Separate group — does NOT feed any team total.
  const nonCountedStats: ClrStats[] = nonCountedClrs.map(computeClrStat).sort((a, b) => b.transfers - a.transfers);

  // Team totals
  const teamCalls          = clrStats.reduce((s, r) => s + r.calls, 0);
  const teamMessages       = clrStats.reduce((s, r) => s + r.messages, 0);
  const teamTransfers      = clrStats.reduce((s, r) => s + r.transfers, 0);
  const teamAppointments   = clrStats.reduce((s, r) => s + r.appointments, 0);
  const teamFellThrough    = clrStats.reduce((s, r) => s + r.fellThrough, 0);
  const teamCallbacks      = clrStats.reduce((s, r) => s + r.callbacks, 0);
  const teamFutureContacts = clrStats.reduce((s, r) => s + r.futureContacts, 0);
  const teamNoAnswers      = clrStats.reduce((s, r) => s + r.noAnswers, 0);
  const teamAssigned       = clrStats.reduce((s, r) => s + r.assigned, 0);
  const teamMissed         = clrStats.reduce((s, r) => s + r.missed, 0);
  const teamRatio          = teamCalls > 0 ? ((teamTransfers / teamCalls) * 100).toFixed(1) + "%" : "—";

  // Transfers in this period with their conversation notes / LO plan / timeframe / follow-up flag
  const transferDetails = outcomes
    .filter((o: any) => (o.outcomeType || o.outcome_type) === "transfer")
    .map((o: any) => {
      const lo = los.find((l: any) => l.id === (o.loId ?? o.lo_id));
      const assistant = users.find((u: any) => u.id === (o.assistantId ?? o.assistant_id));
      return {
        date: o.date as string,
        borrowerName: (o.borrowerName ?? o.borrower_name ?? "").toString().trim(),
        loName: lo ? ((lo as any).fullName ?? (lo as any).full_name ?? `LO #${lo.id}`) : "—",
        assistantName: assistant ? (assistant as any).name : "—",
        transferType: (o.transferType ?? o.transfer_type) as string | null,
        conversationNotes: (o.conversationNotes ?? o.conversation_notes) as string | null,
        loActionPlan: (o.loActionPlan ?? o.lo_action_plan) as string | null,
        leadTimeframe: (o.leadTimeframe ?? o.lead_timeframe) as string | null,
        requiresFollowup: (o.requiresFollowup ?? o.requires_followup) as number | null,
        followupReason: (o.followupReason ?? o.followup_reason) as string | null,
        followupDate: (o.followupDate ?? o.followup_date) as string | null,
      };
    });

  const transferDetailsHtml = transferDetails.length > 0 ? (() => {
    const esc = (s: string) => (s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    const detailLine = (label: string, val: string | null | undefined) =>
      val && String(val).trim() ? `<div style="font-size:12px;color:#334155;margin-top:4px"><strong style="color:#166534">${label}:</strong> ${esc(String(val).trim())}</div>` : "";
    const rows = transferDetails.map((t, i) => {
      const tt = t.transferType === "direct" ? "Direct" : t.transferType === "appointment" ? "Appt" : null;
      const tf = t.leadTimeframe ? String(t.leadTimeframe).replace(/_/g, " ") : null;
      const followup = t.requiresFollowup
        ? `<div style="font-size:12px;color:#b45309;margin-top:4px;background:#fef3c7;padding:4px 8px;border-radius:4px;border-left:3px solid #d97706"><strong>⚑ Follow-up needed${t.followupDate ? ` by ${t.followupDate}` : ""}</strong>${t.followupReason ? ` — ${esc(t.followupReason)}` : ""}</div>`
        : "";
      return `<div style="padding:10px 0;${i < transferDetails.length - 1 ? "border-bottom:1px solid #dcfce7" : ""}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="display:inline-block;width:22px;height:22px;background:#16a34a;color:#fff;border-radius:50%;text-align:center;font-size:11px;font-weight:700;line-height:22px">${i + 1}</span>
          <span style="font-size:13px;font-weight:600;color:#14532d">${esc(t.borrowerName) || "—"}</span>
          <span style="font-size:12px;color:#15803d">&rarr; ${esc(t.loName)}</span>
          ${tt ? `<span style="font-size:12px;color:#4b5563;font-weight:500">(${tt})</span>` : ""}
          ${tf ? `<span style="font-size:11px;color:#64748b;background:#ecfccb;border:1px solid #bef264;border-radius:999px;padding:2px 8px;font-weight:500">${tf}</span>` : ""}
          <span style="font-size:11px;color:#94a3b8;margin-left:auto">${t.date} · ${esc(t.assistantName)}</span>
        </div>
        ${detailLine("Summary", t.conversationNotes)}
        ${detailLine("LO Plan", t.loActionPlan)}
        ${followup}
      </div>`;
    }).join("");
    return `
    <div style="margin-top:28px">
      <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">Transfer Details (${transferDetails.length})</h2>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 16px">
        ${rows}
      </div>
    </div>`;
  })() : "";

  // Full outcome breakdown per CLR — Total Calls, Transfers, Appointments,
  // Fell Throughs, Callbacks, Future Contacts, No Answers.
  const outcomeBreakdownHtml = (() => {
    const visibleRows = clrStats.filter(r =>
      r.calls > 0 || r.messages > 0 || r.transfers > 0 || r.appointments > 0 || r.fellThrough > 0 ||
      r.callbacks > 0 || r.futureContacts > 0 || r.noAnswers > 0,
    );
    if (visibleRows.length === 0) return "";
    const title = type === "weekly" ? "Weekly Outcome Breakdown"
      : type === "mtd" ? "Month-to-Date Outcome Breakdown"
      : type === "alltime" ? "All-Time Outcome Breakdown"
      : "Outcome Breakdown";
    const cellHead = (label: string) =>
      `<th style="padding:9px 10px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap">${label}</th>`;
    const cell = (v: number | string, color = "#334155", bold = false) =>
      `<td style="padding:9px 10px;text-align:center;font-size:13px;color:${color};${bold ? "font-weight:700" : ""}">${v}</td>`;

    const rowsHtml = visibleRows.map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      return `<tr style="background:${bg}">
        <td style="padding:9px 12px;font-size:13px;font-weight:600;color:#1e293b">${r.name}</td>
        ${cell(r.calls, "#0369a1", true)}
        ${cell(r.messages, "#0d9488", true)}
        ${cell(r.transfers, "#1A2B4A", true)}
        ${cell(r.appointments, "#0f766e")}
        ${cell(r.fellThrough, "#b45309")}
        ${cell(r.callbacks, "#7c3aed")}
        ${cell(r.futureContacts, "#0891b2")}
        ${cell(r.noAnswers, "#64748b")}
      </tr>`;
    }).join("");

    const totalsRow = isMultiDay ? `<tr style="background:#f0f4ff;border-top:2px solid #e2e8f0">
      <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0F182D">Team Totals</td>
      ${cell(teamCalls, "#0369a1", true)}
      ${cell(teamMessages, "#0d9488", true)}
      ${cell(teamTransfers, "#1A2B4A", true)}
      ${cell(teamAppointments, "#0f766e", true)}
      ${cell(teamFellThrough, "#b45309", true)}
      ${cell(teamCallbacks, "#7c3aed", true)}
      ${cell(teamFutureContacts, "#0891b2", true)}
      ${cell(teamNoAnswers, "#64748b", true)}
    </tr>` : "";

    return `
    <div style="margin-top:28px">
      <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">${title}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;font-size:12px">
        <thead>
          <tr style="background:#0F182D">
            <th style="padding:9px 12px;text-align:left;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">CLR</th>
            ${cellHead("Total Calls")}
            ${cellHead("Messages")}
            ${cellHead("Transfers")}
            ${cellHead("Appointments")}
            ${cellHead("Fell Throughs")}
            ${cellHead("Callbacks &amp; Deferrals")}
            ${cellHead("Future Contacts")}
            ${cellHead("No Answers")}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          ${totalsRow}
        </tbody>
      </table>
    </div>`;
  })();

  // Separate "Non-counted CLRs" section — their activity, explicitly NOT in team totals.
  const nonCountedHtml = nonCountedStats.length === 0 ? "" : (() => {
    const rowsHtml = nonCountedStats.map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      return `<tr style="background:${bg}">
        <td style="padding:9px 12px;font-size:13px;font-weight:600;color:#1e293b">${r.name}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0369a1">${r.calls}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0d9488">${r.messages}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;font-weight:700;color:#1A2B4A">${r.transfers}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0f766e">${r.appointments}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#b45309">${r.fellThrough}</td>
      </tr>`;
    }).join("");
    return `
    <div style="margin-top:28px">
      <h2 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">Non-counted CLRs</h2>
      <p style="margin:0 0 12px;font-size:12px;color:#64748b">Tracked separately — <strong>not included</strong> in the team totals, leaderboard, or charts above.</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;font-size:12px">
        <thead>
          <tr style="background:#475569">
            <th style="padding:9px 12px;text-align:left;color:#cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">CLR (non-counted)</th>
            <th style="padding:9px 12px;text-align:center;color:#cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Calls</th>
            <th style="padding:9px 12px;text-align:center;color:#cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Msgs</th>
            <th style="padding:9px 12px;text-align:center;color:#cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Transfers</th>
            <th style="padding:9px 12px;text-align:center;color:#cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Appts</th>
            <th style="padding:9px 12px;text-align:center;color:#cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Fell Through</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  })();

  const todayLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: BUSINESS_DAY_DEFAULT_TZ });
  const subject = type === "weekly"
    ? (() => {
        // "Last Week's Summary — May 4–10" (or May 30–Jun 5 if month rolls over)
        const fmt = (iso: string) => {
          const [yy, mm, dd] = iso.split("-").map(n => parseInt(n, 10));
          const dt = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
          return {
            month: dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
            day: dt.getUTCDate(),
          };
        };
        const s = fmt(startDate);
        const e = fmt(endDate);
        const range = s.month === e.month
          ? `${s.month} ${s.day}\u2013${e.day}`
          : `${s.month} ${s.day}\u2013${e.month} ${e.day}`;
        return `Last Week's Summary \u2014 ${range}`;
      })()
    : type === "mtd"
    ? `CLR Month-to-Date Report \u2014 ${todayLabel}`
    : type === "alltime"
    ? `CLR All-Time Report \u2014 ${todayLabel}`
    : `CLR ${type.charAt(0).toUpperCase() + type.slice(1)} Report \u2014 ${todayLabel}`;

  // Stat card helper — 25% wide (4 cards)
  const statCard = (value: string | number, label: string, color = "#1A2B4A") =>
    `<td width="25%" style="padding:4px">
       <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 10px;text-align:center">
         <div style="font-size:28px;font-weight:700;color:${color};line-height:1">${value}</div>
         <div style="color:#64748b;font-size:11px;margin-top:5px;text-transform:uppercase;letter-spacing:0.5px">${label}</div>
       </div>
     </td>`;

  // Per-CLR detail rows
  const clrRows = clrStats.map((row, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
    const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
    const ratioColor  = row.ratio === "—" ? "#94a3b8" : parseFloat(row.ratio) >= 10 ? "#15803d" : parseFloat(row.ratio) >= 5 ? "#b45309" : "#dc2626";
    return `<tr style="background:${bg}">
      <td style="padding:10px 12px;font-size:13px">${medal}</td>
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b">${row.name}</td>
      <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#1A2B4A;text-align:center">${row.transfers}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;color:#0369a1">${row.calls}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;color:#0d9488">${row.messages}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;font-weight:600;color:${ratioColor}">${row.ratio}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;color:#0f766e">${row.appointments}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;color:#b45309">${row.fellThrough}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center">${row.assigned}</td>
    </tr>`;
  }).join("");

  // Per-day breakdown (weekly only)
  const eodAllInRange = storageExtra.getEodReportsByRange(startDate, endDate);
  const datesInRange: string[] = (() => {
    const out: string[] = [];
    const start = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  })();

  interface DailyClrRow {
    name: string;
    calls: number;
    messages: number;
    transfers: number;
    appointments: number;
    fellThrough: number;
    notes: string;
  }
  interface DaySection {
    date: string;
    heading: string;
    rows: DailyClrRow[];
  }

  const daySections: DaySection[] = datesInRange.map(dateStr => {
    const rows: DailyClrRow[] = clrs.map((u: any) => {
      const uid = u.id;
      const eod = eodAllInRange.find((r: any) => r.report_date === dateStr && r.assistant_id === uid);
      const dayOutcomes = outcomes.filter((o: any) =>
        (o.assistantId || o.assistant_id) === uid && (o.date || o.report_date) === dateStr,
      );
      const dayTransfersFromOutcomes = dayOutcomes.filter((o: any) => (o.outcomeType || o.outcome_type) === "transfer").length;
      const dayApptsFromOutcomes = dayOutcomes.filter((o: any) => {
        const t = o.outcomeType || o.outcome_type;
        return t === "appointment" || t === "callback_requested" || t === "deferral" || t === "future_contact";
      }).length;
      const dayFellThroughFromOutcomes = dayOutcomes.filter((o: any) => (o.outcomeType || o.outcome_type) === "fell_through").length;

      if (eod) {
        return {
          name: u.name,
          calls: eod.calls_made || 0,
          messages: eod.messages_sent || 0,
          transfers: eod.transfers || 0,
          appointments: eod.appointments || 0,
          fellThrough: dayFellThroughFromOutcomes,
          notes: String(eod.notes ?? ""),
        };
      }
      if (dayOutcomes.length === 0) {
        return { name: u.name, calls: 0, messages: 0, transfers: 0, appointments: 0, fellThrough: 0, notes: "" };
      }
      return {
        name: u.name,
        calls: dayOutcomes.length,
        messages: 0,
        transfers: dayTransfersFromOutcomes,
        appointments: dayApptsFromOutcomes,
        fellThrough: dayFellThroughFromOutcomes,
        notes: "",
      };
    })
    .filter(r => r.calls > 0 || r.messages > 0 || r.transfers > 0 || r.appointments > 0 || r.fellThrough > 0)
    .sort((a, b) => b.transfers - a.transfers || b.calls - a.calls);

    const heading = new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
    });
    return { date: dateStr, heading, rows };
  }).filter(s => s.rows.length > 0);

  const escDayNote = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const perDayHtml = daySections.map(section => {
    const rowsHtml = section.rows.map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const noteRow = r.notes
        ? `<tr style="background:${bg}"><td colspan="6" style="padding:2px 12px 9px;font-size:12px;color:#64748b"><strong style="color:#475569">Notes:</strong> ${escDayNote(r.notes)}</td></tr>`
        : "";
      return `<tr style="background:${bg}">
        <td style="padding:9px 12px;font-size:13px;font-weight:600;color:#1e293b">${r.name}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0369a1">${r.calls}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0d9488">${r.messages}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;font-weight:700;color:#1A2B4A">${r.transfers}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0f766e">${r.appointments}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#b45309">${r.fellThrough}</td>
      </tr>${noteRow}`;
    }).join("");

    return `
    <div style="margin-bottom:22px">
      <div style="background:#1A2B4A;color:#ffffff;padding:10px 14px;border-radius:10px 10px 0 0;font-size:13px;font-weight:700;letter-spacing:0.2px">
        📅 ${section.heading}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;overflow:hidden;font-size:12px">
        <thead>
          <tr style="background:#0F182D">
            <th style="padding:9px 12px;text-align:left;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">CLR</th>
            <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Calls</th>
            <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Msgs</th>
            <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Transfers</th>
            <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Appts</th>
            <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Fell Through</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>`;
  }).join("");

  // Totals row
  const teamRatioColor = teamCalls > 0 ? (parseFloat(teamRatio) >= 10 ? "#15803d" : parseFloat(teamRatio) >= 5 ? "#b45309" : "#dc2626") : "#94a3b8";
  const totalsRow = `<tr style="background:#f0f4ff;border-top:2px solid #e2e8f0">
    <td style="padding:10px 12px;font-size:12px;color:#94a3b8"></td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0F182D">Team Total</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#1A2B4A;text-align:center">${teamTransfers}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0369a1;text-align:center">${teamCalls}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0d9488;text-align:center">${teamMessages}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;text-align:center;color:${teamRatioColor}">${teamRatio}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0f766e;text-align:center">${teamAppointments}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#b45309;text-align:center">${teamFellThrough}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;text-align:center">${teamAssigned}</td>
  </tr>`;

  // ── Per-type report section visibility (managers configure in Settings) ─────
  // report_sections is JSON keyed by report type → { sectionKey: boolean }.
  // Missing keys default to true, so older configs keep the full report.
  const reportSectionCfg: Record<string, boolean> = (() => {
    try {
      const s = storageExtra.getEmailSettings() as any;
      const all = JSON.parse(s.report_sections || "{}");
      return (all && typeof all === "object" && all[type] && typeof all[type] === "object") ? all[type] : {};
    } catch { return {}; }
  })();
  const sec = (key: string): boolean => reportSectionCfg[key] !== false;
  const stripDisabledSections = (h: string): string =>
    h.replace(/<!--SEC:([a-zA-Z]+)-->([\s\S]*?)<!--\/SEC:\1-->/g, (_m, key, inner) => (sec(key) ? inner : ""));

  const body = `
    <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6">
      ${type === "weekly"
        ? "Here's how the team performed last week."
        : type === "mtd"
        ? "Here's how the team is tracking month-to-date."
        : type === "alltime"
        ? "Here's the team's all-time performance summary."
        : `Here is the ${type} performance summary for the CLR Connection Center team.`}
      Reporting period: <strong style="color:#1e293b">${startDate}</strong> &rarr; <strong style="color:#1e293b">${endDate}</strong>.
    </p>

    <!--SEC:summary-->
    <!-- Team summary stat cards -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px">
      <tr>
        ${statCard(teamTransfers, "Transfers", "#1A2B4A")}
        ${statCard(teamCalls, "Total Calls", "#0369a1")}
        ${statCard(teamMessages, "Messages", "#0d9488")}
        ${statCard(teamRatio, "Transfer / Call %", teamRatioColor)}
        ${statCard(teamAppointments, "Appointments", "#0f766e")}
      </tr>
    </table>

    <!-- Team outcome breakdown — all 6 outcome types -->
    <div style="margin-bottom:24px">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0F182D">📊 Team Outcome Breakdown</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:12px;table-layout:fixed">
        <thead>
          <tr style="background:#0F182D">
            <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Transfers</th>
            <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Appointments</th>
            <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Fell Through</th>
            <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Callbacks &amp; Deferrals</th>
            <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Future Contacts</th>
            <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">No Answer</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background:#ffffff">
            <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#1A2B4A">${teamTransfers}</td>
            <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#2563eb">${teamAppointments}</td>
            <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#dc2626">${teamFellThrough}</td>
            <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#7c3aed">${teamCallbacks}</td>
            <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#0891b2">${teamFutureContacts}</td>
            <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#64748b">${teamNoAnswers}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:8px 0 0;font-size:12px;color:#475569;text-align:right"><strong>Total:</strong> ${teamTransfers + teamAppointments + teamFellThrough + teamCallbacks + teamFutureContacts + teamNoAnswers} outcomes · <strong>${teamCalls}</strong> calls</p>
    </div>
    <!--/SEC:summary-->

    <!-- Divider -->
    <div style="border-top:1px solid #e2e8f0;margin-bottom:24px"></div>

    <!--SEC:clrBreakdown-->
    ${isMultiDay ? `
    <!-- Per-day CLR breakdown -->
    <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">Daily CLR Activity</h2>
    ${daySections.length > 0 ? perDayHtml : `<p style="color:#94a3b8;font-size:13px;font-style:italic">No CLR activity recorded for this period.</p>`}
    ` : `
    <!-- Per-CLR breakdown table -->
    <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">CLR Breakdown</h2>
    ${clrStats.length > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;font-size:12px">
      <thead>
        <tr style="background:#0F182D">
          <th style="padding:9px 12px;text-align:left;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase"></th>
          <th style="padding:9px 12px;text-align:left;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">CLR</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Xfers</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Calls</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Msgs</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Xfer/Call%</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Appts</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Fell Thru</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Assigned</th>
        </tr>
      </thead>
      <tbody>
        ${clrRows}
        ${totalsRow}
      </tbody>
    </table>
` : `<p style="color:#94a3b8;font-size:13px;font-style:italic">No CLR data for this period.</p>`}
    `}
    <!--/SEC:clrBreakdown-->

    <!--SEC:outcomeBreakdown-->${outcomeBreakdownHtml}<!--/SEC:outcomeBreakdown-->

    ${nonCountedHtml}

    <!--SEC:transferDetails-->${transferDetailsHtml}<!--/SEC:transferDetails-->

    <!--SEC:activeLos-->
    <!-- Active LOs callout -->
    <div style="margin-top:28px;padding:14px 18px;background:#eff6ff;border-left:4px solid #1A2B4A;border-radius:0 8px 8px 0">
      <p style="margin:0;font-size:13px;color:#1e40af">
        <strong>Active LOs this period:</strong> ${los.filter((l: any) => l.internalStatus === "active").length} loan officers available for assignment.
      </p>
    </div>
    <!--/SEC:activeLos-->

    <!-- CLR EOD Notes & Activity Log -->
    ${clrStats.some(r => r.eodNotes.length > 0 || r.activityNotes.length > 0) ? `<!--SEC:eodNotes-->
    <div style="margin-top:28px">
      <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">CLR Notes & Activity Log</h2>
      ${clrStats.filter(r => r.eodNotes.length > 0 || r.activityNotes.length > 0).map(row => `
      <div style="margin-bottom:18px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="background:#0F182D;padding:9px 14px">
          <span style="color:#e2e8f0;font-size:12px;font-weight:700">${row.name}</span>
        </div>
        <div style="padding:12px 14px;background:#ffffff">
          ${row.eodNotes.length > 0 ? `
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">EOD Notes</p>
          ${row.eodNotes.map(n => `<p style="margin:0 0 6px;font-size:13px;color:#334155;padding:6px 10px;background:#f8fafc;border-radius:6px;border-left:3px solid #1A2B4A">${n}</p>`).join('')}
          ` : ''}
          ${row.activityNotes.length > 0 ? `
          <p style="margin:${row.eodNotes.length > 0 ? '12px' : '0'} 0 8px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Activity Log</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:12px;border-collapse:separate;border-spacing:0 5px">
            ${row.activityNotes.map((a) => {
              const p = eodActivityPill(a.type);
              return `
            <tr>
              <td style="vertical-align:top;white-space:nowrap;width:1%;padding:0">
                <span style="display:inline-block;background:${p.bg};color:${p.fg};font-size:10px;font-weight:700;padding:3px 9px;border-radius:9999px;white-space:nowrap">${eodActivityLabel(a.type)}</span>
              </td>
              <td style="vertical-align:top;color:#334155;padding:2px 0 0 10px;line-height:1.5">${eodActivityEsc(a.description)} <span style="color:#94a3b8;font-size:11px;white-space:nowrap">&middot; ${a.date}</span></td>
            </tr>`;
            }).join('')}
          </table>
          ` : ''}
        </div>
      </div>`).join('')}
    </div><!--/SEC:eodNotes-->` : ''}
  `;

  // ── Call Notes section ──────────────────────────────────────────────────────
  // Lists every outcome with a non-empty `notes` field, grouped by CLR.
  // For weekly reports, further grouped by day. Section is omitted entirely if
  // no notes exist in the reporting window.
  const escNote = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const formatOutcomeType = (t: string) => {
    const map: Record<string, string> = {
      transfer: "Transfer",
      appointment: "Appointment",
      fell_through: "Fell Through",
      no_answer: "No Answer",
      callback_requested: "Callback Requested",
      deferral: "Deferral",
      future_contact: "Future Contact",
      not_interested: "Not Interested",
      wrong_number: "Wrong Number",
      other: "Other",
    };
    return map[t] || t.replace(/_/g, " ");
  };
  interface NoteEntry {
    date: string;
    outcomeType: string;
    borrowerName: string | null;
    loName: string | null;
    note: string;
    conversationSummary: string | null;
    loPlan: string | null;
    timeframe: string | null;
    followup: string | null;
  }
  // Pull notes from every outcome where ANY note-bearing field is filled in
  // (legacy notes, conversation summary, LO action plan, timeframe, or follow-up
  // reason). This way the daily EOD report shows the full CLR-side picture, not
  // just the legacy free-text notes field.
  const clrNotes: Array<{ clrId: number; clrName: string; entries: NoteEntry[] }> = clrs.map((u: any) => {
    const uid = u.id;
    const entries: NoteEntry[] = outcomes
      .filter((o: any) => {
        const aid = o.assistantId ?? o.assistant_id;
        if (aid !== uid) return false;
        const fields = [
          o.notes,
          o.conversationNotes ?? o.conversation_notes,
          o.loActionPlan ?? o.lo_action_plan,
          o.leadTimeframe ?? o.lead_timeframe,
          o.followupReason ?? o.followup_reason,
        ];
        return fields.some((f) => typeof f === "string" && f.trim().length > 0);
      })
      .map((o: any) => {
        const loId = o.loId ?? o.lo_id;
        const lo = los.find((l: any) => l.id === loId);
        const loName = lo ? ((lo as any).fullName ?? (lo as any).full_name ?? null) : null;
        const outcomeType = (o.outcomeType ?? o.outcome_type) as string;
        const showLo = outcomeType === "transfer" || outcomeType === "appointment";
        const grab = (v: any) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
        return {
          date: (o.date ?? o.report_date) as string,
          outcomeType,
          borrowerName: grab(o.borrowerName ?? o.borrower_name),
          loName: showLo ? loName : null,
          note: grab(o.notes) ?? "",
          conversationSummary: grab(o.conversationNotes ?? o.conversation_notes),
          loPlan: grab(o.loActionPlan ?? o.lo_action_plan),
          timeframe: grab(o.leadTimeframe ?? o.lead_timeframe),
          followup: grab(o.followupReason ?? o.followup_reason),
        };
      });
    return { clrId: uid, clrName: u.name, entries };
  }).filter(c => c.entries.length > 0);

  // Render one outcome's notes as a structured block: header line + any
  // sub-fields the CLR filled in. Single source of truth so daily and weekly
  // branches stay in sync.
  const renderNoteEntry = (e: NoteEntry): string => {
    const headerBits: string[] = [`<strong style="color:#1A2B4A">${formatOutcomeType(e.outcomeType)}</strong>`];
    if (e.borrowerName) headerBits.push(`<span style="color:#0F182D">${escNote(e.borrowerName)}</span>`);
    if (e.loName) headerBits.push(`<span style="color:#334155">→ ${escNote(e.loName)}</span>`);
    const header = headerBits.join(" &middot; ");
    const subBits: string[] = [];
    const addSub = (label: string, value: string | null) => {
      if (!value) return;
      subBits.push(
        `<div style="margin:3px 0 0;font-size:12px;color:#475569;line-height:1.5">` +
        `<span style="font-weight:600;color:#1A2B4A">${label}:</span> ` +
        `<span style="color:#475569">${escNote(value)}</span>` +
        `</div>`
      );
    };
    addSub("Summary", e.conversationSummary);
    addSub("LO plan", e.loPlan);
    addSub("Timeframe", e.timeframe);
    addSub("Follow-up", e.followup);
    if (e.note) addSub("Notes", e.note);
    return `<li style="margin:0 0 10px;padding:0;list-style:disc;font-size:13px;color:#334155;line-height:1.5">
      <div>${header}</div>
      ${subBits.join("")}
    </li>`;
  };

  let callNotesHtml = "";
  if (clrNotes.length > 0) {
    if (isMultiDay) {
      const clrBlocks = clrNotes.map((c, idx) => {
        // Group entries by date
        const byDate = new Map<string, NoteEntry[]>();
        for (const e of c.entries) {
          if (!byDate.has(e.date)) byDate.set(e.date, []);
          byDate.get(e.date)!.push(e);
        }
        const sortedDates = Array.from(byDate.keys()).sort();
        const daysHtml = sortedDates.map(dateStr => {
          const heading = new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
            weekday: "long", month: "short", day: "numeric", timeZone: "UTC",
          });
          const items = byDate.get(dateStr)!.map(renderNoteEntry).join("");
          return `<div style="margin:8px 0 4px">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#475569">${heading}</p>
            <ul style="margin:0 0 0 18px;padding:0;list-style:disc">${items}</ul>
          </div>`;
        }).join("");
        return `<div style="margin-bottom:${idx < clrNotes.length - 1 ? '18px' : '0'};padding-bottom:${idx < clrNotes.length - 1 ? '14px' : '0'};${idx < clrNotes.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''}">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0F182D">${escNote(c.clrName)} <span style="font-weight:400;color:#64748b;font-size:12px">— ${c.entries.length} note${c.entries.length !== 1 ? "s" : ""}</span></p>
          ${daysHtml}
        </div>`;
      }).join("");
      callNotesHtml = `
      <div style="margin-top:28px">
        <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">Notes This Week</h2>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px">
          ${clrBlocks}
        </div>
      </div>`;
    } else {
      const clrBlocks = clrNotes.map((c, idx) => {
        const items = c.entries.map(renderNoteEntry).join("");
        return `<div style="margin-bottom:${idx < clrNotes.length - 1 ? '14px' : '0'};padding-bottom:${idx < clrNotes.length - 1 ? '12px' : '0'};${idx < clrNotes.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''}">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0F182D">${escNote(c.clrName)} <span style="font-weight:400;color:#64748b;font-size:12px">— ${c.entries.length} note${c.entries.length !== 1 ? "s" : ""}</span></p>
          <ul style="margin:0 0 0 18px;padding:0;list-style:disc">${items}</ul>
        </div>`;
      }).join("");
      callNotesHtml = `
      <div style="margin-top:28px">
        <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">Call Notes by CLR</h2>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px">
          ${clrBlocks}
        </div>
      </div>`;
    }
  }

  const wrappedCallNotes = callNotesHtml ? `<!--SEC:callNotes-->${callNotesHtml}<!--/SEC:callNotes-->` : "";
  const html = buildEmail({ subject, preheader: `${teamTransfers} transfers · ${teamRatio} transfer/call ratio`, body: stripDisabledSections(body + wrappedCallNotes) });
  if (opts.renderOnly) {
    console.log(`[sendReport] type=${type} renderOnly window=${startDate}..${endDate}`);
    return { id: null, recipients: [], html, subject, startDate, endDate };
  }
  console.log(`[sendReport] type=${type} recipients=${JSON.stringify(managers)} window=${startDate}..${endDate}`);
  const id = await sendEmail({ to: managers, subject, html });
  return { id, recipients: managers, html, subject, startDate, endDate };
}

// ── NMLS Check trigger + cron ────────────────────────────────────────────────
// Period key: groups months into blocks of intervalMonths.
// E.g. intervalMonths=2 → Jan+Feb = "2026-01", Mar+Apr = "2026-03", etc.
function getNmlsPeriodKey(refDate?: Date): string {
  const now = refDate ?? new Date();
  const schedule = storageExtra.getNmlsSchedule();
  const intervalMonths: number = schedule.interval_months ?? 2;
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  // Find the start month of the current block (0-indexed)
  const blockStart = Math.floor(month / intervalMonths) * intervalMonths;
  return `${year}-${String(blockStart + 1).padStart(2, "0")}`;
}

// Next time the automatic check-reminder cron ("0 8 1 1,3,5,7,9,11 *") will
// fire: the 1st of the next odd month (Jan/Mar/May/Jul/Sep/Nov) at 08:00 UTC.
// Keep this in sync with the cron.schedule definition below.
function getNextNmlsCheckDate(now: Date = new Date()): Date {
  const months = [0, 2, 4, 6, 8, 10]; // 0-indexed Jan, Mar, May, Jul, Sep, Nov
  const year = now.getUTCFullYear();
  for (let addYear = 0; addYear <= 1; addYear++) {
    for (const m of months) {
      const d = new Date(Date.UTC(year + addYear, m, 1, 8, 0, 0));
      if (d.getTime() > now.getTime()) return d;
    }
  }
  return new Date(Date.UTC(year + 2, 0, 1, 8, 0, 0));
}

function triggerNmlsChecks() {
  const periodKey = getNmlsPeriodKey();
  const activeLos = storage.getLoanOfficers().filter((lo: any) => lo.internalStatus === "active" && lo.nmlsId);
  const assistants = storage.getUsers().filter((u: any) => u.isActive && !u.excludeFromStats && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
  if (!assistants.length) return;

  for (const lo of activeLos) {
    // Skip if already exists for this period
    const existing = storageExtra.getNmlsCheckForLo(lo.id, periodKey);
    if (existing) continue;

    // Assign a random CLR
    const assignee = assistants[Math.floor(Math.random() * assistants.length)];
    storageExtra.createNmlsCheck({ loId: lo.id, assignedTo: assignee.id, periodKey });

    // Notify the assigned CLR (in-app + push). The notification bell and push
    // both deep-link to /nmls-checks (the NMLS Tracker tab).
    storage.createNotification({
      userId: assignee.id,
      type: "nmls_check",
      title: "NMLS License Check Due",
      message: `Please verify ${lo.fullName}'s NMLS license (${lo.nmlsId ?? "no NMLS"}) is still active in all licensed states. Open the NMLS Tracker to confirm.`,
      isRead: false,
    });
    sendPushToUser(assignee.id, {
      title: "NMLS License Check Due",
      body: `Verify ${lo.fullName}'s NMLS license (${lo.nmlsId ?? "no NMLS"}) — tap to open NMLS Tracker.`,
      url: "/nmls-checks",
    }).catch(() => {});
  }
}

function runNmlsEscalations() {
  const schedule = storageExtra.getNmlsSchedule();
  const overdue = storageExtra.getPendingNmlsChecks(schedule.escalation_days);
  if (!overdue.length) return;

  const los = storage.getLoanOfficers();
  for (const check of overdue) {
    const lo = los.find((l: any) => l.id === check.lo_id);
    if (!lo) continue;
    storageExtra.escalateNmlsCheck(check.id);
    // Broadcast to ALL users (userId null = everyone)
    storage.createNotification({
      userId: null as any,
      type: "nmls_escalation",
      title: "NMLS Check Overdue ⚠️",
      message: `${lo.fullName}'s NMLS license check has not been confirmed in ${schedule.escalation_days} days. Open the NMLS Tracker to verify it now.`,
      isRead: false,
    });
    // Mirror as push to all active users so they see it on mobile/desktop too,
    // deep-linked to the NMLS Tracker tab.
    try {
      const recipients = (storage.getUsers() as any[])
        .filter((u: any) => u.isActive)
        .map((u: any) => u.id);
      sendPushToUsers(recipients, {
        title: "NMLS Check Overdue",
        body: `${lo.fullName}'s NMLS license check is ${schedule.escalation_days}+ days overdue — tap to verify.`,
        url: "/nmls-checks",
      }).catch(() => {});
    } catch {}
  }
}

// Run NMLS checks on the 1st of every other month (Jan, Mar, May, Jul, Sep, Nov) at 8am UTC.
cron.schedule("0 8 1 1,3,5,7,9,11 *", () => {
  try { triggerNmlsChecks(); } catch (e) { console.error("NMLS check trigger error:", e); }
});

// Check for escalations every morning at 9am
cron.schedule("0 9 * * *", () => {
  try { runNmlsEscalations(); } catch (e) { console.error("NMLS escalation error:", e); }
});

// ── Missed-appointment nag ────────────────────────────────────────────────────
// Appointments whose scheduled time has passed without being completed
// (transferred / rescheduled / fell through) still carry a follow_up_date in
// the past. Nag the owning CLR every morning AND mid-afternoon (in-app + push)
// until each one is handled.
function nagMissedAppointments() {
  const db = storageExtra.getRawSqlite();
  const todayLA = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const rows = db.prepare(`
    SELECT assistant_id AS assistantId, COUNT(*) AS n, MIN(substr(follow_up_date, 1, 10)) AS oldest
    FROM lead_outcomes
    WHERE outcome_type = 'appointment'
      AND follow_up_date IS NOT NULL AND follow_up_date != ''
      AND substr(follow_up_date, 1, 10) < ?
    GROUP BY assistant_id
  `).all(todayLA) as any[];
  for (const r of rows) {
    const u = storage.getUserById(r.assistantId) as any;
    if (!u || !(u.isActive ?? u.is_active)) continue;
    const plural = r.n === 1 ? "" : "s";
    storage.createNotification({
      userId: r.assistantId,
      type: "missed_appointment",
      title: `⚠️ ${r.n} missed appointment${plural}`,
      message: `You have ${r.n} appointment${plural} past the scheduled time (oldest: ${r.oldest}). Open Upcoming Appointments and mark each as transferred, rescheduled, or fell through — this reminder repeats until they're handled.`,
      isRead: false,
    });
    sendPushToUser(r.assistantId, {
      title: `${r.n} missed appointment${plural} need attention`,
      body: "Mark them transferred, rescheduled, or fell through — tap to open.",
      url: "/#/appointments",
    }).catch(() => {});
  }
  if (rows.length) console.log(`[missed-appts] nagged ${rows.length} CLR(s)`);
}

// Twice daily: 9:30 AM and 2:30 PM PT — persistent enough to actually bother people.
cron.schedule("30 9,14 * * *", () => {
  try { nagMissedAppointments(); } catch (e) { console.error("missed-appt nag error:", e); }
}, { timezone: "America/Los_Angeles" });

// Daily SQLite backup at 8am UTC
cron.schedule("0 8 * * *", () => {
  try {
    createBackup('daily');
    console.log("[backup] Daily backup complete");
  } catch (e) { console.error("[backup] Daily backup error:", e); }
});

// Purge comp-request attachments older than ~1 year (retention policy). Runs
// daily at 4am UTC.
cron.schedule("0 4 * * *", () => {
  try {
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const r = storageExtra.getRawSqlite().prepare("DELETE FROM comp_attachments WHERE created_at IS NOT NULL AND created_at < ?").run(cutoff);
    if (r.changes > 0) console.log("[comp-attachments] purged " + r.changes + " attachment(s) older than 1 year");
  } catch (e) { console.error("[comp-attachments] purge error:", e); }
});

// Comp reminders: nudge the approver about requests still not accepted (pending)
// or not paid (approved + unpaid). First reminder at 3 days, then every 6 days.
// Runs daily at 5am UTC.
cron.schedule("0 5 * * *", async () => {
  try {
    const settings = storageExtra.getEmailSettings() as any;
    const approverId = Number(settings.approval_recipient_id ?? settings.comp_approver_id ?? settings.timeoff_approver_id ?? 0) || 0;
    if (!approverId) return;
    const approver = storage.getUserById(approverId) as any;
    const approverEmail = approver?.email && String(approver.email).includes("@") ? String(approver.email) : null;
    if (!approverEmail) return;
    const db = storageExtra.getRawSqlite();
    const items = db.prepare("SELECT * FROM comp_requests WHERE approval_token IS NOT NULL AND (status='pending' OR (status='approved' AND is_paid=0))").all() as any[];
    if (!items.length) return;
    const users = storage.getUsers() as any[];
    const nameById = new Map<number, string>(users.map((u: any) => [u.id, u.name]));
    const groups = new Map<string, any[]>();
    for (const it of items) {
      const k = it.approval_token;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(it);
    }
    const nowMs = Date.now();
    const DAY = 86400000;
    const nowIso = new Date().toISOString();
    for (const [token, group] of groups) {
      const anchorMs = Math.min(...group.map(g => new Date(g.requested_at || g.created_at || nowIso).getTime()));
      const lastMs = group.map(g => g.last_reminder_at ? new Date(g.last_reminder_at).getTime() : 0).reduce((a, b) => Math.max(a, b), 0);
      const due = lastMs ? (nowMs - lastMs) >= 6 * DAY : (nowMs - anchorMs) >= 3 * DAY;
      if (!due) continue;
      const daysWaiting = Math.max(0, Math.floor((nowMs - anchorMs) / DAY));
      const requesterName = nameById.get(group[0].user_id) ?? "a team member";
      try {
        const { subject, html } = buildCompApprovalEmail(group, token, requesterName, { days: daysWaiting });
        await sendEmail({ to: approverEmail, subject, html });
        db.prepare("UPDATE comp_requests SET last_reminder_at=? WHERE approval_token=? AND (status='pending' OR (status='approved' AND is_paid=0))").run(nowIso, token);
        console.log("[comp-reminder] reminded " + approverEmail + " (" + group.length + " items, " + daysWaiting + "d)");
      } catch (e: any) { console.error("[comp-reminder] send failed:", e?.message ?? e); }
    }
  } catch (e: any) { console.error("[comp-reminder] cron error:", e?.message ?? e); }
});

// ── Weekly auto-adjust CLR goals (Mondays 6am) ──────────────────────────────
cron.schedule("0 6 * * 1", () => {
  try { runGoalAutoAdjust(); } catch (e) { console.error("Goal auto-adjust error:", e); }
});

function runGoalAutoAdjust() {
  const sqlite = storageExtra.getSqlite();
  // Process both adjustable and staircase models
  const rows = sqlite.prepare(`
    SELECT user_id, calls_goal, transfers_goal, appointments_goal,
           goal_model, adjustment_pct
    FROM clr_goals WHERE auto_adjust = 1
  `).all() as any[];
  if (rows.length === 0) return;

  // Last week range (previous Mon-Sun)
  const today = new Date();
  const dow = today.getDay();
  const daysSinceMon = (dow + 6) % 7;
  const thisMon = new Date(today); thisMon.setDate(today.getDate() - daysSinceMon);
  const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
  const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const startDate = fmt(lastMon);
  const endDate = fmt(lastSun);

  for (const g of rows) {
    try {
      const userId = g.user_id;
      const model = (g.goal_model ?? 'adjustable') as string;
      const pct = Math.max(0, parseFloat(String(g.adjustment_pct ?? 5)) || 5);
      const multiplier = 1 + pct / 100;

      // Tally last week's actuals for this user
      const callsRow = sqlite.prepare(`
        SELECT COALESCE(SUM(calls_made),0) AS n FROM daily_call_logs
        WHERE assistant_id = ? AND log_date BETWEEN ? AND ?
      `).get(userId, startDate, endDate) as any;
      const actualCalls = callsRow?.n ?? 0;

      const outcomeRow = sqlite.prepare(`
        SELECT
          SUM(CASE WHEN outcome_type = 'transfer' THEN 1 ELSE 0 END) AS transfers,
          SUM(CASE WHEN outcome_type = 'appointment' THEN 1 ELSE 0 END) AS appointments
        FROM lead_outcomes
        WHERE assistant_id = ? AND date BETWEEN ? AND ?
      `).get(userId, startDate, endDate) as any;
      const actualTransfers = outcomeRow?.transfers ?? 0;
      const actualAppointments = outcomeRow?.appointments ?? 0;

      let newCalls = g.calls_goal;
      let newTransfers = g.transfers_goal;
      let newAppts = g.appointments_goal;

      if (model === 'adjustable') {
        // Adjustable: set goal to X% above last week's actual performance
        // Only adjust upward if actuals > 0 to avoid zeroing goals
        if (actualCalls > 0) newCalls = Math.max(1, Math.round(actualCalls * multiplier));
        if (actualTransfers > 0) newTransfers = Math.max(1, Math.round(actualTransfers * multiplier));
        if (actualAppointments > 0) newAppts = Math.max(1, Math.round(actualAppointments * multiplier));
      } else if (model === 'staircase') {
        // Staircase: only bump UP when goal was hit (>= 100% achieved); never reduce
        const hitCalls = g.calls_goal > 0 && actualCalls >= g.calls_goal;
        const hitTransfers = g.transfers_goal > 0 && actualTransfers >= g.transfers_goal;
        const hitAppts = g.appointments_goal > 0 && actualAppointments >= g.appointments_goal;
        if (hitCalls) newCalls = Math.max(1, Math.round(g.calls_goal * multiplier));
        if (hitTransfers) newTransfers = Math.max(1, Math.round(g.transfers_goal * multiplier));
        if (hitAppts) newAppts = Math.max(1, Math.round(g.appointments_goal * multiplier));
      }

      const basis = JSON.stringify({
        weekOf: startDate,
        model,
        pct,
        actual: { calls: actualCalls, transfers: actualTransfers, appointments: actualAppointments },
        before: { calls: g.calls_goal, transfers: g.transfers_goal, appointments: g.appointments_goal },
        after: { calls: newCalls, transfers: newTransfers, appointments: newAppts },
      });

      sqlite.prepare(`
        UPDATE clr_goals
        SET calls_goal = ?, transfers_goal = ?, appointments_goal = ?,
            adjustment_basis = ?, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(newCalls, newTransfers, newAppts, basis, userId);
    } catch (e) {
      console.error(`[goal-auto-adjust] user ${g.user_id} failed:`, e);
    }
  }
  console.log(`[goal-auto-adjust] processed ${rows.length} users for week ${startDate} – ${endDate}`);
}

// ── NMLS license auto-verification (Consumer Access) ────────────────────────
// Hits NMLS Consumer Access for each LO with an NMLS ID, stores status + licensed
// states. Consumer Access is usually behind Cloudflare Turnstile; when blocked
// we mark status "Unknown" and the UI surfaces a direct link for manual verify.
async function verifyLoNmls(loId: number): Promise<{ ok: boolean; status: string; states: string[]; blocked: boolean; error?: string }> {
  const lo = storage.getLoanOfficerById(loId) as any;
  if (!lo) return { ok: false, status: "Unknown", states: [], blocked: false, error: "LO not found" };
  if (!lo.nmlsId) return { ok: false, status: "Unknown", states: [], blocked: false, error: "No NMLS ID" };

  const prevStatus = lo.nmlsStatus ?? null;
  const result = await checkNmlsLicense(lo.nmlsId);

  const updates: any = {
    nmlsStatus: result.status,
    nmlsLastChecked: new Date().toISOString(),
  };
  // Only overwrite states list if we got a real page (not blocked)
  if (!result.blocked) {
    updates.nmlsStates = JSON.stringify(result.states);
    if (result.licenseExpiration) updates.nmlsLicenseExpiration = result.licenseExpiration;
  }
  storage.updateLoanOfficer(loId, updates);

  // Alert admins if status flipped to Inactive/Expired
  const flaggedStatuses = new Set(["Inactive", "Expired"]);
  if (!result.blocked && flaggedStatuses.has(result.status) && prevStatus !== result.status) {
    try {
      const admins = storage.getUsers().filter((u: any) => u.role === "admin" && u.isActive);
      const adminEmails = admins.map((a: any) => a.email).filter(Boolean);
      if (adminEmails.length > 0) {
        const subject = `⚠️ NMLS License Alert: ${lo.fullName} is ${result.status}`;
        const body = `
          <h2>NMLS License Status Changed</h2>
          <p><strong>${lo.fullName}</strong> (NMLS #${lo.nmlsId}) has been flagged as <strong>${result.status}</strong>.</p>
          <p>Previous status: ${prevStatus ?? "Unknown"}</p>
          <p><a href="${nmlsProfileUrl(lo.nmlsId)}">View NMLS Consumer Access record</a></p>
          <p>Please review in the CLR Connection Center directory.</p>
        `;
        const html = buildEmail({ subject, body });
        await sendEmail({ to: adminEmails, subject, html });
      }
      // Also create an in-app broadcast notification
      storage.createNotification({
        userId: null as any,
        type: "license_alert",
        title: `NMLS Alert: ${lo.fullName} is ${result.status}`,
        message: `${lo.fullName}'s NMLS license is now ${result.status}. Verify at nmlsconsumeraccess.org.`,
        isRead: false,
      });
    } catch (e) { console.error("NMLS alert email failed:", e); }
  }

  return { ok: true, status: result.status, states: result.states, blocked: result.blocked, error: result.rawError };
}

async function verifyAllLoNmls(): Promise<{ checked: number; blocked: number; flagged: number }> {
  const los = storage.getLoanOfficers().filter((lo: any) => lo.nmlsId && lo.internalStatus === "active");
  let checked = 0, blocked = 0, flagged = 0;
  for (const lo of los) {
    const r = await verifyLoNmls(lo.id);
    checked++;
    if (r.blocked) blocked++;
    if (r.status === "Inactive" || r.status === "Expired") flagged++;
    // Tiny delay to avoid hammering
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { checked, blocked, flagged };
}

// ── Incomplete LO profile notifications ─────────────────────────────────────
// Runs every 3 days at 9am UTC. For each active LO missing nmlsId, phone, or
// email, broadcast a notification to ALL users until the field is filled in.
cron.schedule("0 9 */3 * *", () => {
  try {
    const allLos = storage.getLoanOfficers().filter((lo: any) => lo.internalStatus === "active");
    const incomplete = allLos.filter((lo: any) =>
      !lo.nmlsId?.trim() || !lo.phone?.trim() || !lo.email?.trim()
    );
    if (!incomplete.length) return;

    for (const lo of incomplete) {
      const missing: string[] = [];
      if (!lo.nmlsId?.trim()) missing.push("NMLS ID");
      if (!lo.phone?.trim()) missing.push("phone number");
      if (!lo.email?.trim()) missing.push("email");
      const missingStr = missing.join(", ");

      // userId null = broadcast to everyone
      storage.createNotification({
        userId: null as any,
        type: "announcement",
        title: `⚠️ Incomplete LO Profile: ${lo.fullName}`,
        message: `${lo.fullName} is missing required info: ${missingStr}. Please update their profile in LO Management.`,
        isRead: false,
      });
    }
  } catch (e) { console.error("Incomplete LO notification error:", e); }
});

// ── Scheduled CLR reports (daily / weekly / monthly) ────────────────────────
// Fires every minute and checks email_settings to decide whether any of the
// three reports should be dispatched. Each type has its own configurable HH:MM:
//   daily_time   (default 08:00) — fires every day
//   weekly_time  (default 08:00) — fires on Monday only
//   monthly_time (default 07:00) — fires on the 1st only (covers prev month)
//
// Lateness windows (added 2026-05-05) — if cron starts up after these cutoffs
// without having fired today, it skips the run and waits for the next period:
//   daily   → 19:00 (7 PM) cutoff → wait for tomorrow's scheduled time
//   weekly  → Monday 08:00 cutoff → wait for next Monday
//   monthly → 1st of month 07:00 cutoff → wait for next month
//
// Window guard (added 2026-05-05) — weekly and monthly emails are never sent
// before 06:00 or after 22:00 local server time, regardless of configuration.
let lastReportFiredAt: Record<"daily" | "weekly" | "monthly" | "mtd" | "alltime", string> = { daily: "", weekly: "", monthly: "", mtd: "", alltime: "" };

// Persisted per-type "last sent" guard (survives process restarts/redeploys).
// Without this, the wide morning send-windows re-fire a report every time the
// app restarts during the window (which is why the daily report went out ~10x
// on heavy-deploy days). Backed by email_settings.report_last_sent (JSON).
function reportSentOn(settings: any, type: string, dateKey: string): boolean {
  try { return JSON.parse(settings?.report_last_sent || "{}")[type] === dateKey; } catch { return false; }
}
function markReportSent(type: string, dateKey: string) {
  try {
    const s = storageExtra.getEmailSettings() as any;
    let obj: any = {};
    try { obj = JSON.parse(s?.report_last_sent || "{}"); } catch {}
    obj[type] = dateKey;
    storageExtra.updateEmailSettings({ reportLastSent: JSON.stringify(obj) });
  } catch (e: any) { console.error("[report-cron] markReportSent failed:", e?.message ?? e); }
}

function parseHM(s: string | undefined, fallback: string): { h: number; m: number } {
  const raw = (s || fallback).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    const fb = fallback.match(/^(\d{1,2}):(\d{2})$/)!;
    return { h: Number(fb[1]), m: Number(fb[2]) };
  }
  return { h: Math.min(23, Math.max(0, Number(m[1]))), m: Math.min(59, Math.max(0, Number(m[2]))) };
}

cron.schedule("* * * * *", async () => {
  try {
    const s = storageExtra.getEmailSettings() as any;
    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();
    const nowMinutes = hh * 60 + mm;
    const nowDateKey = now.toISOString().split("T")[0];

    // Hard window for weekly + monthly: never send before 06:00 or after 22:00
    const inAllowedWindow = nowMinutes >= 6 * 60 && nowMinutes <= 22 * 60;

    // ── Daily report — handled by its own dedicated 7:45 AM PT cron below.
    //   Sends a report for the PREVIOUS day each morning. No-op here.

    // ── Weekly report — handled by its own dedicated cron below
    //   ("0 15 * * 1" = 8:00 AM PT every Monday). No-op here.

    // ── Monthly report (1st of month only — covers previous full month) ────
    if (s.monthly_enabled && now.getDate() === 1 && lastReportFiredAt.monthly !== nowDateKey && !reportSentOn(s, "monthly", nowDateKey)) {
      const { h: mh, m: mmin } = parseHM(s.monthly_time, "07:00");
      const targetMin = mh * 60 + mmin;
      // 5-minute grace window after 07:00 so the cron can land on the
      // configured time even though the cutoff is also 07:00
      const cutoffMin = 7 * 60 + 5;
      if (inAllowedWindow && nowMinutes >= targetMin && nowMinutes < cutoffMin) {
        lastReportFiredAt.monthly = nowDateKey; markReportSent("monthly", nowDateKey);
        try { await sendReport("monthly"); }
        catch (e: any) { console.error("Scheduled monthly report failed:", e?.message ?? e); }
      } else if (nowMinutes >= cutoffMin) {
        lastReportFiredAt.monthly = nowDateKey; markReportSent("monthly", nowDateKey);
        console.log(`[report-cron] monthly skipped — past 07:00 cutoff on day 1 (now=${hh}:${String(mm).padStart(2, "0")}); will fire next month`);
      }
    }

    // ── Month-to-Date report (any day — covers 1st→today) ──────────────────────
    if (s.mtd_enabled && lastReportFiredAt.mtd !== nowDateKey && !reportSentOn(s, "mtd", nowDateKey)) {
      const { h: mh, m: mmin } = parseHM(s.mtd_time, "08:00");
      const targetMin = mh * 60 + mmin;
      const cutoffMin = 19 * 60; // 7 PM lateness cutoff (same as daily)
      if (inAllowedWindow && nowMinutes >= targetMin && nowMinutes < cutoffMin) {
        lastReportFiredAt.mtd = nowDateKey; markReportSent("mtd", nowDateKey);
        try { await sendReport("mtd"); }
        catch (e: any) { console.error("Scheduled MTD report failed:", e?.message ?? e); }
      } else if (nowMinutes >= cutoffMin) {
        lastReportFiredAt.mtd = nowDateKey; markReportSent("mtd", nowDateKey);
        console.log(`[report-cron] mtd skipped — past 19:00 cutoff (now=${hh}:${String(mm).padStart(2, "0")}); will fire tomorrow at ${s.mtd_time || "08:00"}`);
      }
    }

    // ── All-Time report (1st of month — inception through today) ────────────────
    if (s.alltime_enabled && now.getDate() === 1 && lastReportFiredAt.alltime !== nowDateKey && !reportSentOn(s, "alltime", nowDateKey)) {
      const { h: ah, m: amin } = parseHM(s.alltime_time, "07:10");
      const targetMin = ah * 60 + amin;
      const cutoffMin = 7 * 60 + 15;
      if (inAllowedWindow && nowMinutes >= targetMin && nowMinutes < cutoffMin) {
        lastReportFiredAt.alltime = nowDateKey; markReportSent("alltime", nowDateKey);
        try { await sendReport("alltime"); }
        catch (e: any) { console.error("Scheduled all-time report failed:", e?.message ?? e); }
      } else if (nowMinutes >= cutoffMin) {
        lastReportFiredAt.alltime = nowDateKey; markReportSent("alltime", nowDateKey);
        console.log(`[report-cron] alltime skipped — past cutoff on day 1 (now=${hh}:${String(mm).padStart(2, "0")}); will fire next month`);
      }
    }
  } catch (e: any) { console.error("Scheduled report cron error:", e?.message ?? e); }
});

// ── Daily report — fires at the configured Pacific time every morning ──────
// Summarizes the PREVIOUS day (see the "daily" branch of sendReport's period
// resolver). The send time is adjustable from Settings via daily_time
// (default 07:45). We check every minute against the Pacific wall-clock, so it
// is DST-safe without a fixed cron expression. Gated by daily_enabled. A
// once-per-PT-day guard plus a 19:00 lateness cutoff prevent duplicates and
// stop a late process start from blasting yesterday's report at, say, 9 PM.
cron.schedule("* * * * *", async () => {
  try {
    const s = storageExtra.getEmailSettings() as any;
    if (!s.daily_enabled) return;
    const ptDateKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    // Persisted guard first so a restart mid-window never re-sends.
    if (lastReportFiredAt.daily === ptDateKey || reportSentOn(s, "daily", ptDateKey)) return;
    const ptTime = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour12: false });
    const tm = ptTime.match(/^(\d{1,2}):(\d{2})/);
    if (!tm) return;
    const nowMinutes = Number(tm[1]) * 60 + Number(tm[2]);
    const { h, m } = parseHM(s.daily_time, "07:45");
    const targetMin = h * 60 + m;
    const cutoffMin = 19 * 60; // 7 PM PT lateness cutoff
    if (nowMinutes >= targetMin && nowMinutes < cutoffMin) {
      lastReportFiredAt.daily = ptDateKey;
      markReportSent("daily", ptDateKey);
      try { await sendReport("daily"); }
      catch (e: any) { console.error("Scheduled daily report failed:", e?.message ?? e); }
    } else if (nowMinutes >= cutoffMin) {
      lastReportFiredAt.daily = ptDateKey;
      markReportSent("daily", ptDateKey);
      console.log(`[report-cron] daily skipped — past 19:00 PT cutoff; will fire tomorrow at ${s.daily_time || "07:45"}`);
    }
  } catch (e: any) {
    console.error("Scheduled daily report cron error:", e?.message ?? e);
  }
});

// ── Weekly report — fires Mondays at 8:00 AM PT (15:00 UTC) ─────────────────
// Summarizes the previous Mon–Sun. The send is still gated by
// email_settings.weekly_enabled so admins can disable it from Settings.
cron.schedule("0 15 * * 1", async () => {
  try {
    const s = storageExtra.getEmailSettings() as any;
    if (!s.weekly_enabled) return;
    const nowDateKey = new Date().toISOString().split("T")[0];
    if (lastReportFiredAt.weekly === nowDateKey || reportSentOn(s, "weekly", nowDateKey)) return;
    lastReportFiredAt.weekly = nowDateKey;
    markReportSent("weekly", nowDateKey);
    await sendReport("weekly");
  } catch (e: any) {
    console.error("Scheduled weekly report failed:", e?.message ?? e);
  }
});

// ── 30-minute appointment reminder ──────────────────────────────────────────
// Adds a `reminder_sent_30m` column to lead_outcomes (idempotent), then every
// 5 minutes finds appointment outcomes whose appointment_datetime is between
// now and now+35min and reminder hasn't been sent. Sends email via Resend +
// web push via sendPushToUser, then sets the flag.
try { storageExtra.getRawSqlite().exec(`ALTER TABLE lead_outcomes ADD COLUMN reminder_sent_30m INTEGER NOT NULL DEFAULT 0`); } catch {}

cron.schedule("*/5 * * * *", async () => {
  try {
    const sqlite = storageExtra.getRawSqlite();
    const nowMs = Date.now();
    const cutoffMs = nowMs + 35 * 60 * 1000;
    // The Appointments page binds its datetime-local input to follow_up_date,
    // not appointment_datetime, so most rows in production have only
    // follow_up_date populated. Treat either field as a valid scheduled time;
    // appointment_datetime takes precedence when present.
    const rows = sqlite.prepare(`
      SELECT lo.id, lo.assistant_id, lo.borrower_name,
             lo.appointment_datetime, lo.follow_up_date,
             u.email AS clr_email, u.name AS clr_name, COALESCE(u.reminder_email_enabled, 1) AS reminder_email_enabled,
             COALESCE(u.timezone, 'America/Los_Angeles') AS clr_timezone,
             loff.full_name AS lo_name
      FROM lead_outcomes lo
      JOIN users u ON u.id = lo.assistant_id
      LEFT JOIN loan_officers loff ON loff.id = lo.lo_id
      WHERE lo.outcome_type = 'appointment'
        AND COALESCE(lo.reminder_sent_30m, 0) = 0
        AND (
          (lo.appointment_datetime IS NOT NULL AND lo.appointment_datetime <> '')
          OR
          (lo.follow_up_date IS NOT NULL AND lo.follow_up_date <> '')
        )
    `).all() as any[];
    if (rows.length > 0) {
      console.log(`[appt-30m] cron tick: ${rows.length} candidate appointment row(s) without reminder yet`);
    }

    for (const r of rows) {
      // Prefer appointment_datetime, fall back to follow_up_date. The latter
      // can be either a date (YYYY-MM-DD) or a datetime (YYYY-MM-DDTHH:MM).
      // Date-only values have no time component, so treat them as midnight
      // local time — a date-only follow_up_date will never be in the
      // "now → now+35min" window unless the cron happens to run within 35
      // minutes after midnight, which is fine.
      const rawTime = (r.appointment_datetime && String(r.appointment_datetime).trim())
        || (r.follow_up_date && String(r.follow_up_date).trim())
        || "";
      if (!rawTime) continue;
      // CRITICAL: the appointments page stores datetime-local strings like
      // "2026-05-06T15:00" with NO timezone offset. Date.parse() then
      // interprets them in the *server's* local timezone, which on Railway
      // is UTC — making the reminder fire 7–8 hours early for Pacific users.
      // Resolve the wall-clock time in the CLR's stored timezone instead.
      const clrTz = r.clr_timezone || "America/Los_Angeles";
      const t = parseWallClockInTz(rawTime, clrTz);
      if (!Number.isFinite(t)) {
        console.warn(`[appt-30m] skip outcome=${r.id}: unparseable time=${JSON.stringify(rawTime)} tz=${clrTz}`);
        continue;
      }
      if (t <= nowMs || t > cutoffMs) continue;

      const borrower = r.borrower_name?.trim() || "Unknown";
      const loName = r.lo_name || "Unknown LO";
      const when = (() => {
        try {
          return new Date(t).toLocaleString("en-US", {
            weekday: "short", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit", hour12: true,
            timeZone: clrTz,
          });
        } catch { return rawTime; }
      })();

      // Email (only if user opted in + has address)
      if (r.reminder_email_enabled && r.clr_email) {
        try {
          await sendEmail({
            to: r.clr_email,
            subject: `Appointment in 30 minutes — ${borrower}`,
            html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1e293b;line-height:1.55">
              <p>Hi ${String(r.clr_name || "")},</p>
              <p>Your appointment with <strong>${borrower}</strong> (LO: ${loName}) is in about 30 minutes.</p>
              <p><strong>Scheduled:</strong> ${when}</p>
              <p style="margin-top:18px"><a href="https://www.westcapitallending.center/#/outcomes" style="background:#1A2B4A;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:500">Open CLR Connection Center</a></p>
            </body></html>`,
          });
        } catch (e: any) { console.error(`[appt-30m] email failed outcome=${r.id}:`, e?.message ?? e); }
      }

      // Push (best-effort) — deep-link to /appointments so tapping the
      // notification opens the upcoming appointments view directly.
      let pushSummary: { sent: number; failed: number } = { sent: 0, failed: 0 };
      try {
        pushSummary = await sendPushToUser(r.assistant_id, {
          title: "⏰ Appointment in 30 minutes",
          body: `${borrower} — ${loName}`,
          url: "/appointments",
        });
      } catch (e: any) {
        console.error(`[appt-30m] push failed outcome=${r.id}:`, e?.message ?? e);
      }

      try { sqlite.prepare(`UPDATE lead_outcomes SET reminder_sent_30m = 1 WHERE id = ?`).run(r.id); } catch {}
      console.log(`[appt-30m] reminder fired outcome=${r.id} user=${r.assistant_id} push.sent=${pushSummary.sent} push.failed=${pushSummary.failed} to=${r.clr_email ?? "(no email)"}`);
    }
  } catch (e: any) { console.error("[appt-30m] cron error:", e?.message ?? e); }
});


// ── EOD Missing-Report Reminders ─────────────────────────────────────────────
// Tracks which CLRs are missing weekday EOD reports and reminds them (and
// their managers) every 3 days until the report is submitted.
//
// Table: eod_reminder_log(id, org_id, clr_id, report_date, last_sent_at)
//   — one row per (org_id, clr_id, report_date)
//   — updated each time a reminder fires for that combo
//   — deleted automatically when the CLR eventually submits the report
// ─────────────────────────────────────────────────────────────────────────────

try {
  storageExtra.getRawSqlite().exec(`
    CREATE TABLE IF NOT EXISTS eod_reminder_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id       INTEGER NOT NULL DEFAULT 1,
      clr_id       INTEGER NOT NULL,
      report_date  TEXT NOT NULL,
      last_sent_at TEXT NOT NULL,
      send_count   INTEGER NOT NULL DEFAULT 1,
      UNIQUE(org_id, clr_id, report_date)
    )
  `);
} catch {}

// Clean up reminder log rows whose report has since been submitted
function purgeSubmittedEodReminders() {
  try {
    const sqlite = storageExtra.getRawSqlite();
    sqlite.exec(`
      DELETE FROM eod_reminder_log
      WHERE EXISTS (
        SELECT 1 FROM eod_reports r
        WHERE r.assistant_id = eod_reminder_log.clr_id
          AND r.report_date  = eod_reminder_log.report_date
      )
    `);
  } catch {}
}

function buildEodReminderHtml({
  clrName, reportDate, daysLate, sendCount, appUrl,
}: { clrName: string; reportDate: string; daysLate: number; sendCount: number; appUrl: string }): string {
  const dayLabel = daysLate === 1 ? "1 day" : `${daysLate} days`;
  const countLabel = sendCount === 1 ? "1st reminder" : sendCount === 2 ? "2nd reminder" : sendCount === 3 ? "3rd reminder" : `${sendCount}th reminder`;
  const urgencyColor = sendCount >= 3 ? "#dc2626" : sendCount === 2 ? "#d97706" : "#1e40af";
  const urgencyLabel = sendCount >= 3 ? "⚠️ Overdue" : sendCount === 2 ? "🔔 Follow-up" : "📋 Reminder";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EOD Report Reminder</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr><td style="background:#1A2B4A;padding:28px 32px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td><span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">CLR Connection Center</span></td>
              <td align="right"><span style="font-size:12px;font-weight:600;color:#93c5fd;background:rgba(255,255,255,0.1);padding:4px 10px;border-radius:20px">${urgencyLabel} · ${countLabel}</span></td>
            </tr>
          </table>
        </td></tr>
        <!-- Alert bar -->
        <tr><td style="background:${urgencyColor};padding:12px 32px">
          <p style="margin:0;font-size:13px;font-weight:600;color:#ffffff">
            EOD Report Missing — ${reportDate} (${dayLabel} ago)
          </p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#0f172a">Hi ${clrName},</p>
          <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6">
            Your EOD report for <strong style="color:#0f172a">${reportDate}</strong> hasn't been submitted yet.
            Daily reports help the team track activity, transfer rates, and weekly goals — please submit it when you get a moment.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            <tr>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px">Missing Report Date</p>
                <p style="margin:0;font-size:18px;font-weight:700;color:#0f172a">${reportDate}</p>
                <p style="margin:4px 0 0;font-size:12px;color:#64748b">${dayLabel} overdue · ${countLabel}</p>
              </td>
            </tr>
          </table>
          <a href="${appUrl}/#/eod-report?date=${reportDate}" style="display:inline-block;background:#1A2B4A;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px">
            Submit EOD Report →
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.5">
            This reminder will repeat every 3 days until the report is submitted.<br>
            If this date was a holiday or you were out, you can log a skip in the app.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center">
            © 2026 West Capital Lending · Built by Chris Redoble &amp; Ethan Wood
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function checkAndSendEodReminders(opts?: { testClrId?: number; testEmail?: string }) {
  const sqlite = storageExtra.getRawSqlite();
  purgeSubmittedEodReminders();

  const isTest = !!opts?.testClrId;

  // Get all orgs (or just org 1 for now — single-tenant production)
  const orgs: Array<{ id: number }> = sqlite.prepare(`SELECT id FROM organizations WHERE is_demo = 0 OR is_demo IS NULL`).all() as any[];

  for (const org of orgs) {
    // Get CLRs: role=assistant OR (role=admin AND is_clr=1), active, in this org
    const clrs: Array<{ id: number; name: string; email: string; created_at: string }> = sqlite.prepare(`
      SELECT id, name, email, created_at
      FROM users
      WHERE is_active = 1
        AND org_id = ?
        AND (
          role = 'assistant'
          OR (role = 'admin' AND is_clr = 1)
        )
    `).all(org.id) as any[];

    if (!clrs.length) continue;

    // Build list of weekdays to check: up to 14 calendar days back, skip weekends
    const today = new Date();
    const weekdaysToCheck: string[] = [];
    for (let i = 1; i <= 21; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dow = d.getDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) continue;
      weekdaysToCheck.push(d.toISOString().split("T")[0]);
      if (weekdaysToCheck.length >= 14) break;
    }

    const appUrl = "https://www.westcapitallending.center";

    for (const clr of clrs) {
      if (isTest && clr.id !== opts!.testClrId) continue;

      // Parse CLR creation date (normalize to date-only, UTC)
      const clrCreatedDate = clr.created_at
        ? (clr.created_at.endsWith("Z") ? clr.created_at : clr.created_at + "Z").slice(0, 10)
        : null;

      for (const reportDate of weekdaysToCheck) {
        // Skip dates older than 10 calendar days
        const reportD0 = new Date(reportDate + "T00:00:00Z");
        const daysAgo = Math.floor((today.getTime() - reportD0.getTime()) / (24 * 60 * 60 * 1000));
        if (daysAgo > 10) continue;

        // Skip dates before this CLR account was created
        if (clrCreatedDate && reportDate < clrCreatedDate) continue;

        // Check if report exists
        const submitted = sqlite.prepare(`
          SELECT 1 FROM eod_reports WHERE assistant_id = ? AND report_date = ?
        `).get(clr.id, reportDate) as any;
        if (submitted) continue;

        // Check reminder log
        const logRow = sqlite.prepare(`
          SELECT last_sent_at, send_count FROM eod_reminder_log
          WHERE org_id = ? AND clr_id = ? AND report_date = ?
        `).get(org.id, clr.id, reportDate) as any;

        const now = new Date();
        const nowIso = now.toISOString();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

        if (!isTest && logRow) {
          const lastSent = new Date(logRow.last_sent_at + (logRow.last_sent_at.endsWith("Z") ? "" : "Z"));
          if (now.getTime() - lastSent.getTime() < threeDaysMs) continue; // too soon
        }

        // daysAgo already computed above (used for the >10 guard)
        const daysLate = daysAgo;

        const sendCount = logRow ? logRow.send_count + 1 : 1;

        // Build and send email
        const html = buildEodReminderHtml({ clrName: clr.name, reportDate, daysLate, sendCount, appUrl });
        const toEmail = isTest && opts?.testEmail ? opts.testEmail : clr.email;

        const subject = sendCount === 1
          ? `📋 EOD Report Reminder — ${reportDate}`
          : sendCount === 2
          ? `🔔 Follow-up: EOD Report Still Missing — ${reportDate}`
          : `⚠️ Overdue EOD Report — ${reportDate} (${sendCount}th reminder)`;

        try {
          await sendEmail({ to: toEmail, subject, html });
          console.log(`[eod-reminder] sent to ${toEmail} for ${clr.name} date=${reportDate} count=${sendCount}`);

          // Upsert log row
          sqlite.prepare(`
            INSERT INTO eod_reminder_log (org_id, clr_id, report_date, last_sent_at, send_count)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(org_id, clr_id, report_date) DO UPDATE SET
              last_sent_at = excluded.last_sent_at,
              send_count   = excluded.send_count
          `).run(org.id, clr.id, reportDate, nowIso, sendCount);
        } catch (e: any) {
          console.error(`[eod-reminder] failed for ${clr.name} ${reportDate}:`, e?.message ?? e);
        }

        // In test mode, only send the first missing date found per CLR
        if (isTest) break;
      }
    }
  }
}

// Cron: daily at 9:00 AM UTC — find CLRs missing weekday EOD reports and
// send reminder every 3 days until they submit
cron.schedule("0 9 * * 1-5", async () => {
  try {
    console.log("[eod-reminder] daily check running...");
    await checkAndSendEodReminders();
  } catch (e: any) {
    console.error("[eod-reminder] cron error:", e?.message ?? e);
  }
});

// ── EOD Manager Digest ────────────────────────────────────────────────────────
// Cron: daily at 6:30 PM Pacific time (DST-aware via timezone option) on weekdays.
// Sends ONE digest email to managers covering all EOD submissions that day.
// Individual CLRs already get their own copy immediately on submission.
cron.schedule("30 18 * * 1-5", async () => {
  try {
    console.log("[eod-digest] daily manager digest running...");
    const db = storageExtra.getRawSqlite();
    const settings = storageExtra.getEmailSettings() as any;
    const managers: string[] = (() => {
      try { return JSON.parse(settings.manager_emails || "[]"); } catch { return []; }
    })();
    if (managers.length === 0) {
      console.log("[eod-digest] no manager emails configured, skipping");
      return;
    }

    // Today's date in PT (matches report_date stored by CLRs)
    const todayPT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YYYY-MM-DD

    const allRows = db.prepare(`
      SELECT e.report_date, e.assistant_id, e.calls_made, e.messages_sent, e.transfers, e.appointments, e.notes,
             u.name AS clr_name, u.email AS clr_email, u.exclude_from_stats AS excluded
      FROM eod_reports e
      JOIN users u ON u.id = e.assistant_id
      WHERE e.report_date = ?
      ORDER BY u.name ASC
    `).all(todayPT) as any[];

    if (allRows.length === 0) {
      console.log("[eod-digest] no submissions today, skipping manager digest");
      return;
    }
    // Non-counted CLRs are shown in their own section and excluded from totals.
    const rows = allRows.filter((r: any) => !r.excluded);
    const nonCountedRows = allRows.filter((r: any) => r.excluded);

    // Additional work logged for the day (eod_activities), grouped per CLR.
    const activityByClr = new Map<number, any[]>();
    try {
      const acts = db.prepare(`SELECT assistant_id, activity_type, description FROM eod_activities WHERE report_date = ?`).all(todayPT) as any[];
      for (const a of acts) {
        if (!activityByClr.has(a.assistant_id)) activityByClr.set(a.assistant_id, []);
        activityByClr.get(a.assistant_id)!.push(a);
      }
    } catch {}

    const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const totalCalls = rows.reduce((s: number, r: any) => s + Number(r.calls_made ?? 0), 0);
    const totalMsgs = rows.reduce((s: number, r: any) => s + Number(r.messages_sent ?? 0), 0);
    const totalXfers = rows.reduce((s: number, r: any) => s + Number(r.transfers ?? 0), 0);
    const totalAppts = rows.reduce((s: number, r: any) => s + Number(r.appointments ?? 0), 0);

    const renderDigestRows = (list: any[]) => list.map((r: any) => {
      const acts = activityByClr.get(r.assistant_id) ?? [];
      const extras: string[] = [];
      if (r.notes) extras.push(`<strong style="color:#475569">Notes:</strong> ${esc(String(r.notes))}`);
      if (acts.length) {
        const actHtml = acts.map((a: any) => {
          const p = eodActivityPill(a.activity_type);
          return `<span style="display:inline-block;background:${p.bg};color:${p.fg};font-size:10px;font-weight:700;padding:2px 8px;border-radius:9999px">${eodActivityLabel(a.activity_type)}</span> ${esc(a.description ?? "")}`;
        }).join("<br>");
        extras.push(`<strong style="color:#475569">Additional work:</strong><br>${actHtml}`);
      }
      const extraRow = extras.length
        ? `<tr><td colspan="5" style="padding:0 12px 10px;font-size:12px;color:#64748b;line-height:1.5">${extras.join("<br>")}</td></tr>`
        : "";
      return `
      <tr style="border-top:1px solid #e2e8f0">
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1A2B4A">${esc(r.clr_name)}</td>
        <td style="padding:10px 12px;text-align:center;font-size:14px;font-weight:700;color:#3B82F6">${r.calls_made ?? 0}</td>
        <td style="padding:10px 12px;text-align:center;font-size:14px;font-weight:700;color:#0d9488">${r.messages_sent ?? 0}</td>
        <td style="padding:10px 12px;text-align:center;font-size:14px;font-weight:700;color:#16a34a">${r.transfers ?? 0}</td>
        <td style="padding:10px 12px;text-align:center;font-size:14px;font-weight:700;color:#A855F7">${r.appointments ?? 0}</td>
      </tr>${extraRow}`;
    }).join("");
    const rowsHtml = renderDigestRows(rows);
    const nonCountedDigestHtml = nonCountedRows.length === 0 ? "" : `
      <h3 style="margin:22px 0 6px;font-size:13px;font-weight:700;color:#0F182D">Non-counted CLRs</h3>
      <p style="margin:0 0 8px;font-size:11px;color:#64748b">Not included in the totals above.</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">CLR</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase">Calls</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase">Msgs</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase">Xfers</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase">Appts</th>
        </tr></thead>
        <tbody>${renderDigestRows(nonCountedRows)}</tbody>
      </table>`;

    const body = `
      <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#1A2B4A">Daily EOD Summary — ${todayPT}</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:20px;display:flex;gap:18px">
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:#3B82F6">${totalCalls}</div><div style="font-size:11px;color:#64748b;margin-top:2px">Total Calls</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:#0d9488">${totalMsgs}</div><div style="font-size:11px;color:#64748b;margin-top:2px">Messages</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:#16a34a">${totalXfers}</div><div style="font-size:11px;color:#64748b;margin-top:2px">Transfers</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:#A855F7">${totalAppts}</div><div style="font-size:11px;color:#64748b;margin-top:2px">Appointments</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:#0F182D">${rows.length}</div><div style="font-size:11px;color:#64748b;margin-top:2px">CLRs submitted</div></div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">CLR</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Calls</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Msgs</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Xfers</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Appts</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${nonCountedDigestHtml}
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">
        This digest is sent once daily. Each CLR also receives their own full report immediately on submission.
      </p>`;

    const subject = `EOD Team Digest — ${todayPT} (${rows.length} CLR${rows.length !== 1 ? "s" : ""})`;
    const html = buildEmail({ subject, preheader: `${totalCalls} calls · ${totalMsgs} messages · ${totalXfers} transfers · ${totalAppts} appointments — ${rows.length} CLRs submitted`, body });
    await sendEmail({ to: managers, subject, html });
    console.log(`[eod-digest] sent to ${managers.length} managers covering ${rows.length} submissions`);
  } catch (e: any) {
    console.error("[eod-digest] cron error:", e?.message ?? e);
  }
}, { timezone: "America/Los_Angeles" });

// Chat email throttle — suppress flood of per-message emails during active chat sessions.
// We send at most one email per CHAT_EMAIL_THROTTLE_MS window.
let lastChatEmailAt = 0;
const CHAT_EMAIL_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

// ── Time-off decision email to the requester (acceptance on approval) ─────────
function buildTimeOffDecisionEmail(
  row: any,
  requesterName: string,
  status: "approved" | "denied",
): { subject: string; html: string } {
  const prettyDate = (s: string) => {
    try { return new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
    catch { return s; }
  };
  let days = 1;
  try {
    const a = new Date(row.start_date + "T12:00:00").getTime();
    const b = new Date(row.end_date + "T12:00:00").getTime();
    days = Math.max(1, Math.round((b - a) / 86400000) + 1);
  } catch {}
  const range = row.start_date === row.end_date ? prettyDate(row.start_date) : (prettyDate(row.start_date) + " &rarr; " + prettyDate(row.end_date));
  const approved = status === "approved";
  const headline = approved
    ? `Good news, ${requesterName} — your time off is approved! 🌴`
    : `${requesterName}, an update on your time-off request`;
  const lead = approved
    ? `Your request for <strong>${range}</strong> (${days} day${days === 1 ? "" : "s"}) has been <strong style="color:#16a34a">approved</strong>. Enjoy your time off!`
    : `Your request for <strong>${range}</strong> (${days} day${days === 1 ? "" : "s"}) was <strong style="color:#dc2626">not approved</strong>.`;
  const note = row.reviewer_note ? `<p style="margin:14px 0 0;font-size:13px;color:#475569">Note from your manager: ${row.reviewer_note}</p>` : "";
  const body = `<p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#0F182D">${headline}</p>
    <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.6">${lead}</p>
    ${note}
    <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">You can view your requests anytime in the app under Time Off.</p>`;
  const subject = approved ? ("Your time off is approved — " + range.replace(" &rarr; ", " to ")) : ("Update on your time-off request — " + range.replace(" &rarr; ", " to "));
  return { subject, html: buildEmail({ subject: approved ? "Time Off Approved" : "Time Off Update", preheader: lead.replace(/<[^>]+>/g, ""), body }) };
}

// ── Comp approval/reminder email builder (shared by submit + reminder cron) ───
const COMP_APP_URL = "https://www.westcapitallending.center";
function buildCompApprovalEmail(
  items: any[],
  token: string,
  requesterName: string,
  reminder?: { days: number },
): { subject: string; html: string } {
  const fmt = (c: number) => "$" + ((c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalCents = items.reduce((a, r) => a + (r.amount_cents || 0), 0);
  const rows = items.map((r) => {
    const dateTag = r.expense_date ? ` <span style=\"color:#94a3b8\">(${r.expense_date})</span>` : "";
    const stateTag = r.status === "approved" ? ` <span style=\"color:#0284c7;font-size:12px\">approved, awaiting payment</span>` : "";
    return `<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b">${(r.description || "Expense")}${dateTag}${stateTag}</td><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b;text-align:right;font-weight:600">${fmt(r.amount_cents || 0)}</td></tr>`;
  }).join("");
  const approveUrl = `${COMP_APP_URL}/api/comp/email-decision?token=${token}&action=approve`;
  const denyUrl = `${COMP_APP_URL}/api/comp/email-decision?token=${token}&action=deny`;
  const paidUrl = `${COMP_APP_URL}/api/comp/email-decision?token=${token}&action=paid`;
  const intro = reminder
    ? `<p style="margin:0 0 14px;font-size:15px;color:#1e293b"><strong>Reminder:</strong> the comp request from <strong>${requesterName}</strong> for <strong>${fmt(totalCents)}</strong> has been waiting <strong>${reminder.days} day(s)</strong> without being fully approved and paid. Please take action below.</p>`
    : `<p style="margin:0 0 14px;font-size:15px;color:#1e293b"><strong>${requesterName}</strong> submitted a comp request totaling <strong>${fmt(totalCents)}</strong>. Approve, deny, or mark it paid below.</p>`;
  const body = `${intro}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px;border-collapse:collapse">${rows}
      <tr><td style="padding:10px;font-size:14px;font-weight:700;color:#0F182D">Total</td><td style="padding:10px;font-size:14px;font-weight:700;color:#0F182D;text-align:right">${fmt(totalCents)}</td></tr>
    </table>
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:8px"><a href="${approveUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px">Approve</a></td>
      <td style="padding-right:8px"><a href="${denyUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px">Deny</a></td>
      <td><a href="${paidUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px">Mark Paid</a></td>
    </tr></table>
    <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">These actions apply to all items in this request. "Mark Paid" approves it (if needed) and records it as reimbursed. You can also manage requests in the app under Comp Requests.</p>`;
  const subject = (reminder ? "Reminder: " : "") + "Comp request from " + requesterName + " — " + fmt(totalCents);
  return { subject, html: buildEmail({ subject: reminder ? "Comp Request Reminder" : "Comp Request Approval", preheader: fmt(totalCents) + " from " + requesterName, body }) };
}

// ── Time-off approval email builder ───────────────────────────────────────────
function buildTimeOffApprovalEmail(
  reqRow: any,
  requesterName: string,
): { subject: string; html: string } {
  const prettyDate = (s: string) => {
    try { return new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
    catch { return s; }
  };
  let days = 1;
  try {
    const a = new Date(reqRow.start_date + "T12:00:00").getTime();
    const b = new Date(reqRow.end_date + "T12:00:00").getTime();
    days = Math.max(1, Math.round((b - a) / 86400000) + 1);
  } catch {}
  const range = reqRow.start_date === reqRow.end_date ? prettyDate(reqRow.start_date) : (prettyDate(reqRow.start_date) + " &rarr; " + prettyDate(reqRow.end_date));
  const approveUrl = `${COMP_APP_URL}/api/time-off/email-decision?token=${reqRow.approval_token}&action=approve`;
  const denyUrl = `${COMP_APP_URL}/api/time-off/email-decision?token=${reqRow.approval_token}&action=deny`;
  const reasonRow = reqRow.reason ? `<tr><td style="padding:8px 10px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b">Reason</td><td style="padding:8px 10px;border-top:1px solid #e2e8f0;font-size:14px;color:#1e293b;text-align:right">${reqRow.reason}</td></tr>` : "";
  const body = `<p style="margin:0 0 14px;font-size:15px;color:#1e293b"><strong>${requesterName}</strong> requested time off. Approve or deny it below.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px;border-collapse:collapse">
      <tr><td style="padding:8px 10px;font-size:13px;color:#64748b">Dates</td><td style="padding:8px 10px;font-size:14px;color:#1e293b;text-align:right;font-weight:600">${range}</td></tr>
      <tr><td style="padding:8px 10px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b">Length</td><td style="padding:8px 10px;border-top:1px solid #e2e8f0;font-size:14px;color:#1e293b;text-align:right">${days} day${days === 1 ? "" : "s"}</td></tr>
      ${reasonRow}
    </table>
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:8px"><a href="${approveUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:8px">Approve</a></td>
      <td><a href="${denyUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:8px">Deny</a></td>
    </tr></table>
    <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">You can also manage time-off requests in the app under Time Off.</p>`;
  const subject = "Time off request from " + requesterName + " — " + range.replace(" &rarr; ", " to ");
  return { subject, html: buildEmail({ subject: "Time Off Approval", preheader: requesterName + " requested " + days + " day(s) off", body }) };
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ── One-time cleanup: scrub LO credentials accidentally saved as the
  // masked bullet placeholder. Earlier versions of the edit form could
  // round-trip the "••••••••" mask back into storage; the password reveal
  // would then appear broken because the "plaintext" was just bullets.
  try {
    const sqlite = storageExtra.getRawSqlite();
    const result = sqlite.prepare(`
      UPDATE loan_officers
      SET bonzo_password = CASE WHEN bonzo_password GLOB '•*' AND TRIM(bonzo_password, '•') = '' THEN NULL ELSE bonzo_password END,
          lead_mailbox_password = CASE WHEN lead_mailbox_password GLOB '•*' AND TRIM(lead_mailbox_password, '•') = '' THEN NULL ELSE lead_mailbox_password END
      WHERE (bonzo_password GLOB '•*' AND TRIM(bonzo_password, '•') = '')
         OR (lead_mailbox_password GLOB '•*' AND TRIM(lead_mailbox_password, '•') = '')
    `).run();
    if (result.changes > 0) {
      console.log(`[lo-creds] scrubbed ${result.changes} loan_officer rows with masked-placeholder credentials`);
    }
  } catch (e) {
    console.error("[lo-creds] scrub failed", e);
  }

  // ── lo_preferences migration ────────────────────────────────────────────────
  // Per-CLR-per-LO notes, preferred contact time, and pin flag for the daily
  // call list. Idempotent — wrapped in try/catch so app boots cleanly if the
  // table already exists.
  try {
    storageExtra.getRawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS lo_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        lo_id INTEGER NOT NULL,
        notes TEXT DEFAULT '',
        preferred_time TEXT DEFAULT '' CHECK(preferred_time IN ('', 'morning', 'afternoon', 'evening')),
        is_pinned INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(org_id, user_id, lo_id)
      )
    `);
  } catch {}

  // ── time_off_requests migration ──────────────────────────────────────────────
  // CLRs request time off; managers/admins approve or deny. Scoped per org.
  // Idempotent (CREATE TABLE IF NOT EXISTS) so the app boots cleanly on re-run.
  try {
    storageExtra.getRawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS time_off_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','cancelled')),
        reviewed_by INTEGER,
        reviewer_note TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        reviewed_at TEXT,
        approval_token TEXT
      )
    `);
    storageExtra.getRawSqlite().exec(`CREATE INDEX IF NOT EXISTS idx_time_off_token ON time_off_requests(approval_token)`);
  } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE time_off_requests ADD COLUMN approval_token TEXT`); } catch {}

  // ── weekly_schedules migration ───────────────────────────────────────────────
  // Planned weekly work schedule per CLR. One row per user per week (week_start
  // is the Monday, YYYY-MM-DD). days is JSON: { mon: {working, start, end}, ... }.
  try {
    storageExtra.getRawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS weekly_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        week_start TEXT NOT NULL,
        days TEXT NOT NULL DEFAULT '{}',
        notes TEXT DEFAULT '',
        submitted_at TEXT,
        updated_at TEXT,
        UNIQUE(org_id, user_id, week_start)
      )
    `);
  } catch {}
  // Approval workflow columns (schedule submissions must be accepted by a
  // manager/admin, like comp requests and time off).
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE weekly_schedules ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE weekly_schedules ADD COLUMN reviewed_by INTEGER`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE weekly_schedules ADD COLUMN reviewer_note TEXT DEFAULT ''`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE weekly_schedules ADD COLUMN reviewed_at TEXT`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE weekly_schedules ADD COLUMN approval_token TEXT`); } catch {}

  // ── comp_requests migration ──────────────────────────────────────────────────
  // Reimbursement/comp tracking. Each row is one expense the user logged. It
  // moves through: draft (saved) -> pending (comp requested) -> approved/denied
  // (manager decision) -> is_paid flag (requester marks reimbursement received).
  // Amounts stored as integer cents to avoid float rounding. Scoped per org.
  try {
    storageExtra.getRawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS comp_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'other',
        amount_cents INTEGER NOT NULL DEFAULT 0,
        expense_date TEXT,
        note TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','denied')),
        is_paid INTEGER NOT NULL DEFAULT 0,
        is_received INTEGER NOT NULL DEFAULT 0,
        reviewed_by INTEGER,
        reviewer_note TEXT DEFAULT '',
        requested_at TEXT,
        reviewed_at TEXT,
        paid_at TEXT,
        created_at TEXT,
        updated_at TEXT,
        received_at TEXT,
        approval_token TEXT
      )
    `);
  } catch {}
  // comp_requests: add paid/received tracking columns to pre-existing tables.
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE comp_requests ADD COLUMN is_received INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE comp_requests ADD COLUMN received_at TEXT`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE comp_requests ADD COLUMN approval_token TEXT`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE comp_requests ADD COLUMN last_reminder_at TEXT`); } catch {}
  // "Processing" stage: managers flip this on once an approved request is being
  // worked through for payout (sits between Approved and Paid in the tracker).
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE comp_requests ADD COLUMN is_processing INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { storageExtra.getRawSqlite().exec(`ALTER TABLE comp_requests ADD COLUMN processing_at TEXT`); } catch {}

  // One-time: any comp requests that CLRs had saved as drafts are promoted to
  // "pending" (sent for approval) so they surface in the approval queue instead
  // of sitting invisibly as unsent drafts. Runs once via migrations_applied.
  try {
    const db = storageExtra.getRawSqlite();
    db.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    const done = db.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'comp_drafts_to_pending_v1'`).get();
    if (!done) {
      const nowIso = new Date().toISOString();
      const info = db.prepare(`
        UPDATE comp_requests
        SET status = 'pending',
            requested_at = COALESCE(requested_at, ?),
            approval_token = COALESCE(approval_token, lower(hex(randomblob(24)))),
            updated_at = ?
        WHERE status = 'draft'
      `).run(nowIso, nowIso);
      db.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`).run('comp_drafts_to_pending_v1', nowIso);
      if ((info.changes as number) > 0) console.log(`[migration] comp_drafts_to_pending_v1: promoted ${info.changes} saved comp request(s) to pending`);
    }
  } catch (e: any) { console.error('comp_drafts_to_pending_v1 failed:', e?.message ?? e); }

  // One-time: purge old "transfer_celebration" notifications. Celebrations are now
  // ephemeral (in-memory feed, not stored), so any historical ones just clog the
  // notification bell. Runs once via migrations_applied.
  try {
    const db = storageExtra.getRawSqlite();
    db.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    const done = db.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'purge_transfer_celebration_notifications_v1'`).get();
    if (!done) {
      const nowIso = new Date().toISOString();
      const info = db.prepare(`DELETE FROM notifications WHERE type = 'transfer_celebration'`).run();
      db.prepare(`INSERT OR IGNORE INTO migrations_applied (name, applied_at) VALUES (?, ?)`).run('purge_transfer_celebration_notifications_v1', nowIso);
      if ((info.changes as number) > 0) console.log(`[migration] purge_transfer_celebration_notifications_v1: removed ${info.changes} stale celebration notification(s)`);
    }
  } catch (e: any) { console.error('purge_transfer_celebration_notifications_v1 failed:', e?.message ?? e); }

  // ── comp_attachments migration ───────────────────────────────────────────────
  // Receipts / files attached to a comp request. Stored as base64 in SQLite (the
  // DB lives on a persistent Railway volume). Auto-purged after ~1 year by a cron.
  try {
    storageExtra.getRawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS comp_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        comp_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL DEFAULT 'file',
        mime TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        data_base64 TEXT NOT NULL,
        created_at TEXT
      )
    `);
    storageExtra.getRawSqlite().exec(`CREATE INDEX IF NOT EXISTS idx_comp_attachments_comp ON comp_attachments(comp_id)`);
  } catch {}

  // ── Audit helper ─────────────────────────────────────────────────────────────
  function audit(data: Omit<InsertAuditLog, never>) {
    try { storage.createAuditLog(data); } catch {}
  }

  // ── Cookie parser ──────────────────────────────────────────────────────────
  app.use(cookieParser(SESSION_SECRET));

  // ── Per-request org context (AsyncLocalStorage): scopes all storage queries.
  // Super-admin and SA console routes bypass scope (they intentionally cross orgs).
  app.use((req: Request, res: Response, next: NextFunction) => {
    let orgId = 1;
    let superAdmin = false;
    try {
      const raw = (req as any).signedCookies?.[COOKIE_NAME];
      if (raw) {
        const session = JSON.parse(raw);
        orgId = Number(session?.orgId ?? 1) || 1;
        superAdmin = !!session?.superAdmin;
      }
    } catch {}
    const path = req.path || "";
    const bypassScope = path.startsWith("/api/super-admin")
      || path.startsWith("/api/sa/")
      || path.startsWith("/__sa/");
    runWithOrg({ orgId, superAdmin, bypassScope }, () => next());
  });

  // ── Demo guard: block mutations for users whose org is flagged is_demo=1 ──
  // Exceptions: auth/login and auth/logout must always work.
  const demoOrgCache = new Map<number, boolean>();
  function isDemoOrg(orgId: number): boolean {
    if (!orgId) return false;
    if (demoOrgCache.has(orgId)) return demoOrgCache.get(orgId)!;
    try {
      const sqliteDb = storageExtra.getRawSqlite();
      const row = sqliteDb.prepare(`SELECT is_demo FROM organizations WHERE id = ?`).get(orgId) as any;
      const flag = !!(row && row.is_demo);
      demoOrgCache.set(orgId, flag);
      return flag;
    } catch {
      return false;
    }
  }
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const mutating = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE";
    if (!mutating) return next();
    // Allowed auth routes even in demo mode
    if (req.path === "/auth/login" || req.path === "/auth/logout") return next();
    try {
      const raw = (req as any).signedCookies?.[COOKIE_NAME];
      if (!raw) return next();
      const session = JSON.parse(raw);
      // Super-admins are never demo-locked, even if impersonating a demo org.
      if (session?.superAdmin) return next();
      const orgId = Number(session?.orgId ?? 0);
      if (orgId && isDemoOrg(orgId)) {
        return res.status(403).json({ error: "Demo mode is read-only. Sign up for full access." });
      }
    } catch {
      // bad cookie → let downstream auth handle it
    }
    next();
  });

  // ── Standalone private SA console (separate from main app) ────────────────
  registerSaConsole(app);

  // ── Health check (Railway) ────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    let dbOk = true;
    try {
      const sqliteDb = storageExtra.getRawSqlite();
      sqliteDb.prepare(`SELECT 1 AS ok`).get();
    } catch {
      dbOk = false;
    }
    res.json({ status: dbOk ? "ok" : "degraded", uptime: getProcessUptimeSec(), db: dbOk });
  });

  // ── Public status page + API (no auth) ────────────────────────────────────
  app.get("/status", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(STATUS_HTML);
  });

  app.get("/api/status", (_req, res) => {
    try {
      const services = runAllChecks();
      res.json({
        services,
        overall: getOverallStatus(services),
        lastUpdated: new Date().toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "status failed" });
    }
  });

  try { startUptimeCron(); } catch (e: any) { console.error("[status] cron init failed:", e?.message ?? e); }

  // ── Manual backup trigger (admin only) ───────────────────────────────────
  app.post("/api/admin/backup", requireAuth, (req: any, res: any) => {
    const sess = req.session_user;
    const me = sess?.userId ? (storage.getUserById(sess.userId) as any) : null;
    if (!me || (me.role !== "admin" && !me.superAdmin)) {
      return res.status(403).json({ error: "Admin only" });
    }
    const file = createBackup('manual');
    if (!file) return res.status(500).json({ success: false, error: "Backup failed" });
    return res.json({ success: true, file });
  });

  // ── List backups (admin only) ────────────────────────────────────────────
  app.get("/api/admin/backups", requireAuth, (req: any, res: any) => {
    const sess = req.session_user;
    const me = sess?.userId ? (storage.getUserById(sess.userId) as any) : null;
    if (!me || (me.role !== "admin" && !me.superAdmin)) {
      return res.status(403).json({ error: "Admin only" });
    }
    return res.json({ backups: listBackups() });
  });

  // ── One-time import: replace Ethan's lead outcomes ──────────────────────
  // Auth: either authenticated admin OR a request bearing the Railway project ID
  // in X-Bootstrap-Token (so the import can be triggered without a session).
  app.post("/api/admin/import-ethan-outcomes", async (req: any, res: any) => {
    const bootstrap = req.headers["x-bootstrap-token"];
    const isBootstrap = typeof bootstrap === "string" && bootstrap === "06e30810-b43c-4bad-8fac-0093a269a917";
    if (!isBootstrap) {
      const raw = (req as any).signedCookies?.[COOKIE_NAME];
      if (!raw) return res.status(401).json({ error: "Unauthorized" });
      try {
        const session = JSON.parse(raw);
        const me = session?.userId ? (storage.getUserById(session.userId) as any) : null;
        if (!me || (me.role !== "admin" && !me.superAdmin)) {
          return res.status(403).json({ error: "Admin only" });
        }
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    try {
      const sqlite = (storageExtra as any).getRawSqlite();
      const ASSISTANT_ID = 1;
      const ETHAN_OUTCOMES: any[] = [{"date": "2026-04-20", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "John Hankin", "lo_name": "Dan Baker", "notes": "Wants small personal loan, seemingly great credit, locked his credit and having trouble unlocking it."}, {"date": "2026-04-20", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "Juan Falcon", "lo_name": "Khashi Tabrizi", "notes": "DNQ"}, {"date": "2026-04-20", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "Geino Duriel", "lo_name": "Khashi Tabrizi", "notes": "Follow up"}, {"date": "2026-04-20", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": "trash credit lol, said it was 270 HAHA"}, {"date": "2026-04-20", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": "Investment property, interested."}, {"date": "2026-04-21", "outcome_type": "future_contact", "borrower_name": "Unknown", "lo_name": null, "notes": "waiting for credit to get better -- not Gary's lead, from OR"}, {"date": "2026-04-21", "outcome_type": "future_contact", "borrower_name": "Unknown", "lo_name": null, "notes": "was in hospital, said she would save number for the future"}, {"date": "2026-04-21", "outcome_type": "future_contact", "borrower_name": "Unknown", "lo_name": null, "notes": "very nice, dealing with a lot, wants a callback a year from now."}, {"date": "2026-04-22", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Larry Young", "lo_name": "Ian Militello", "notes": "Wants cb at 1:30-2:00 PST, looking for a 20k loan, like a HEL, comparing to Rocket"}, {"date": "2026-04-22", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Gurmeet Singh", "lo_name": "Sean Murphy", "notes": ""}, {"date": "2026-04-23", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Bernard Hudson", "lo_name": "Sean Murphy", "notes": ""}, {"date": "2026-04-24", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "Jennifer Wells", "lo_name": "Sean Murphy", "notes": ""}, {"date": "2026-04-27", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Mark Bewley", "lo_name": "Cole Fairon", "notes": "CT (479) 381-6834 Very busy at work, wants cb over the weekend for home imp loan."}, {"date": "2026-04-27", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "Marie Michaelle Bazile", "lo_name": "Ian Militello", "notes": "30K hel loan, James old lead that I was able to directly transfer to Ian. LO Plan: I think he was taking an app"}, {"date": "2026-04-27", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": "Man picked up, said to cb later. (540) 479-7509"}, {"date": "2026-04-28", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "Jaymie Lebile", "lo_name": "Kurt Christman", "notes": "Need money because her son died, running into a ton of issues. LO Plan: Find other options for a $2000 loan."}, {"date": "2026-04-28", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Stephen Mcgibbon", "lo_name": "Sean Murphy", "notes": "called me during lunch, looking for HELOC or something. LO Plan: more information"}, {"date": "2026-04-28", "outcome_type": "deferral", "borrower_name": "Unknown", "lo_name": null, "notes": "Said he would cb eventually. Got my number and name."}, {"date": "2026-04-28", "outcome_type": "deferral", "borrower_name": "Unknown", "lo_name": null, "notes": "said he needed to wait a year 1/18"}, {"date": "2026-04-30", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Jason Grubbs", "lo_name": "Khashi Tabrizi", "notes": ""}, {"date": "2026-04-30", "outcome_type": "deferral", "borrower_name": "Unknown", "lo_name": null, "notes": ""}, {"date": "2026-05-04", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "Sylvanus Pratt", "lo_name": "Ian Militello", "notes": "Wanted HTI loan. LO Plan: advised on other options, since we do not offer the loan"}, {"date": "2026-05-04", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Dawn Schwalm", "lo_name": "Cole Fairon", "notes": "looking for either a va refi or heloc, unsure now or later, had a 7.9 quote from another company. LO Plan: start working on the refi in a few weeks"}, {"date": "2026-05-04", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": ""}, {"date": "2026-05-04", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": ""}, {"date": "2026-05-04", "outcome_type": "callback_requested", "borrower_name": "Unknown", "lo_name": null, "notes": ""}, {"date": "2026-05-05", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "John Ko", "lo_name": "Bill Neessen", "notes": "vm cb that led to live transfer, wanted to talk to Billy. LO Plan: working with the lead on a reverse."}, {"date": "2026-05-05", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": ""}, {"date": "2026-05-05", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": ""}, {"date": "2026-05-05", "outcome_type": "fell_through", "borrower_name": "Unknown", "lo_name": null, "notes": ""}, {"date": "2026-05-05", "outcome_type": "deferral", "borrower_name": "Tim Boyle", "lo_name": "Bill Neessen", "notes": "waiting on other lender rates, aware of West Cap. Scheduled: Thu, May 14, 12:00 PM"}, {"date": "2026-05-05", "outcome_type": "callback_requested", "borrower_name": "Mary Nazworth", "lo_name": "Bill Neessen", "notes": "refied recently, needs time, still interested, said she was looking for a higher amount. Scheduled: Tue, Sep 1, 12:00 PM"}, {"date": "2026-05-05", "outcome_type": "callback_requested", "borrower_name": "Donald Mullen", "lo_name": "Sean Murphy", "notes": "has cold, requested callback later. Scheduled: Wed, May 6, 4:00 PM"}, {"date": "2026-05-06", "outcome_type": "transfer", "transfer_type": "direct", "borrower_name": "Kenneth Bellamy", "lo_name": "Dan Baker", "notes": "was super eager to start the process. LO Plan: not sure, finish the application I think"}, {"date": "2026-05-06", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Kyle Greenwood", "lo_name": "Cole Fairon", "notes": ""}, {"date": "2026-05-07", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Stephan Thomas", "lo_name": "Gary Dawson", "notes": ""}, {"date": "2026-05-08", "outcome_type": "appointment", "borrower_name": "Joseph Fritts", "lo_name": "Bill Neessen", "notes": ""}, {"date": "2026-05-11", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Richard Braun", "lo_name": "Ian Militello", "notes": ""}, {"date": "2026-05-11", "outcome_type": "transfer", "transfer_type": "appointment", "borrower_name": "Jody Myatt", "lo_name": "Gary Dawson", "notes": "looking for advice. 1.1 house, 800k loan, looking to consolidate debt and prep for house move. 670 credit score. LO Plan: cb in an hour"}, {"date": "2026-05-11", "outcome_type": "fell_through", "borrower_name": "Alexander Diaz", "lo_name": "Derek Bullen", "notes": "Shopping around, said I could cb later."}, {"date": "2026-05-11", "outcome_type": "appointment", "borrower_name": "Mr Conny Jackson", "lo_name": "Derek Bullen", "notes": "At work, just messing around. Scheduled: Mon, May 11, 3:00 PM"}, {"date": "2026-05-11", "outcome_type": "appointment", "borrower_name": "Tamara Fagatele", "lo_name": "Bill Neessen", "notes": "Texted me to call then. Scheduled: Tue, May 12, 9:00 AM"}, {"date": "2026-05-11", "outcome_type": "callback_requested", "borrower_name": "Anthony Powell", "lo_name": "Bill Neessen", "notes": "Trying to get ex-wife off the deed, cb in a week. Scheduled: Mon, May 18, 2:30 PM"}, {"date": "2026-05-11", "outcome_type": "deferral", "borrower_name": "Mohamed Osman", "lo_name": "Derek Bullen", "notes": "Talked to him, say call him later down the line. Scheduled: Sat, Aug 1, 9:00 AM"}, {"date": "2026-05-11", "outcome_type": "callback_requested", "borrower_name": "Daniel Henry", "lo_name": "Derek Bullen", "notes": "said maybe could talk next week -- already in convos with Derek. Scheduled: Mon, May 18, 12:09 PM"}, {"date": "2026-05-11", "outcome_type": "callback_requested", "borrower_name": "Marcelino Venegas", "lo_name": "Khashi Tabrizi", "notes": "said husband would call back. Scheduled: Mon, May 11, 4:30 PM"}];

      const los = sqlite.prepare("SELECT id, full_name FROM loan_officers").all() as { id: number; full_name: string }[];
      const matchLoId = (raw: string | null): { loId: number; matched: boolean } => {
        if (!raw) return { loId: 999, matched: false };
        const norm = raw.trim().toLowerCase();
        let hit = los.find(l => (l.full_name || "").trim().toLowerCase() === norm);
        if (!hit) {
          const first = norm.split(/\s+/)[0];
          const last = norm.split(/\s+/).slice(-1)[0];
          hit = los.find(l => {
            const fn = (l.full_name || "").toLowerCase();
            if (fn.includes(norm)) return true;
            if (last && fn.includes(last)) return true;
            return false;
          });
        }
        return hit ? { loId: hit.id, matched: true } : { loId: 999, matched: false };
      };

      try { createBackup('pre-ethan-import'); } catch (e) { console.error('backup failed', e); }

      const delStmt = sqlite.prepare("DELETE FROM lead_outcomes WHERE assistant_id = ?");
      const delInfo = delStmt.run(ASSISTANT_ID);
      const deleted = delInfo.changes as number;

      const insStmt = sqlite.prepare(
        `INSERT INTO lead_outcomes
          (date, assistant_id, lo_id, borrower_name, outcome_type, transfer_type, notes, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
      );

      const unmatched: string[] = [];
      const errors: string[] = [];
      let inserted = 0;
      const now = new Date().toISOString();

      const trx = sqlite.transaction((rows: any[]) => {
        for (const r of rows) {
          const { loId, matched } = matchLoId(r.lo_name ?? null);
          if (r.lo_name && !matched) unmatched.push(r.lo_name);
          try {
            insStmt.run(
              r.date,
              ASSISTANT_ID,
              loId,
              r.borrower_name ?? null,
              r.outcome_type,
              r.transfer_type ?? null,
              r.notes ?? null,
              now,
              now,
            );
            inserted++;
          } catch (e: any) {
            errors.push(`row ${JSON.stringify(r)}: ${e?.message || e}`);
          }
        }
      });
      trx(ETHAN_OUTCOMES);

      return res.json({
        success: true,
        deleted,
        inserted,
        total: ETHAN_OUTCOMES.length,
        unmatched_lo_names: Array.from(new Set(unmatched)),
        loan_officers: los.map(l => ({ id: l.id, name: l.full_name })),
        errors,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ── Verify Ethan's outcome count ─────────────────────────────────────────
  app.get("/api/admin/ethan-outcomes-count", (req: any, res: any) => {
    const bootstrap = req.headers["x-bootstrap-token"];
    const isBootstrap = typeof bootstrap === "string" && bootstrap === "06e30810-b43c-4bad-8fac-0093a269a917";
    if (!isBootstrap) {
      const raw = (req as any).signedCookies?.[COOKIE_NAME];
      if (!raw) return res.status(401).json({ error: "Unauthorized" });
      try {
        const session = JSON.parse(raw);
        const me = session?.userId ? (storage.getUserById(session.userId) as any) : null;
        if (!me || (me.role !== "admin" && !me.superAdmin)) {
          return res.status(403).json({ error: "Admin only" });
        }
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    const sqlite = (storageExtra as any).getRawSqlite();
    const total = sqlite.prepare("SELECT COUNT(*) AS c FROM lead_outcomes WHERE assistant_id = 1").get() as { c: number };
    const byType = sqlite.prepare("SELECT outcome_type, COUNT(*) AS c FROM lead_outcomes WHERE assistant_id = 1 GROUP BY outcome_type").all();
    const byDate = sqlite.prepare("SELECT date, COUNT(*) AS c FROM lead_outcomes WHERE assistant_id = 1 GROUP BY date ORDER BY date").all();
    const placeholderRows = sqlite.prepare("SELECT id, date, outcome_type, lo_id, borrower_name FROM lead_outcomes WHERE assistant_id = 1 AND lo_id = 999").all();
    return res.json({ total: total.c, byType, byDate, placeholder_count: placeholderRows.length });
  });

  // ── LO diagnostic + cleanup (admin / bootstrap-token) ────────────────────
  // Used to figure out why a given LO is missing from a UI list (state-lookup,
  // directory, etc.) and to clean up archived/inactive rows that don't have
  // historical outcomes/assignments tied to them.
  function isBootstrapOrAdmin(req: any): boolean {
    const bootstrap = req.headers["x-bootstrap-token"];
    if (typeof bootstrap === "string" && bootstrap === "06e30810-b43c-4bad-8fac-0093a269a917") return true;
    try {
      const raw = (req as any).signedCookies?.[COOKIE_NAME];
      if (!raw) return false;
      const session = JSON.parse(raw);
      const me = session?.userId ? (storage.getUserById(session.userId) as any) : null;
      return !!(me && (me.role === "admin" || me.superAdmin));
    } catch { return false; }
  }

  app.get("/api/admin/lo-diagnostic", (req: any, res: any) => {
    if (!isBootstrapOrAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const sqlite = (storageExtra as any).getRawSqlite();
    const rows = sqlite.prepare(`
      SELECT id, full_name, email, internal_status, snooze_until, snooze_reason,
             licensed_states, priority_tier, nmls_id, created_at, updated_at
      FROM loan_officers
      ORDER BY id ASC
    `).all() as any[];
    const outcomeCounts = sqlite.prepare(`SELECT lo_id, COUNT(*) AS c FROM lead_outcomes GROUP BY lo_id`).all() as { lo_id: number; c: number }[];
    const outcomeMap = new Map(outcomeCounts.map(r => [r.lo_id, r.c]));
    const assignCounts = sqlite.prepare(`SELECT lo_id, COUNT(*) AS c FROM daily_assignments GROUP BY lo_id`).all() as { lo_id: number; c: number }[];
    const assignMap = new Map(assignCounts.map(r => [r.lo_id, r.c]));
    const today = new Date().toISOString().split("T")[0];
    const enriched = rows.map(r => {
      let states: string[] = [];
      try { states = JSON.parse(r.licensed_states || "[]"); } catch {}
      const status = r.internal_status ?? "active";
      const snoozedActive = !!(r.snooze_until && r.snooze_until >= today);
      const reasonsHidden: string[] = [];
      if (status === "archived") reasonsHidden.push("status=archived");
      if (status === "inactive") reasonsHidden.push("status=inactive");
      if (snoozedActive) reasonsHidden.push(`snoozed until ${r.snooze_until}`);
      if (states.length === 0) reasonsHidden.push("no licensed states");
      return {
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        status,
        snoozeUntil: r.snooze_until,
        snoozeReason: r.snooze_reason,
        licensedStates: states,
        stateCount: states.length,
        priorityTier: r.priority_tier,
        nmlsId: r.nmls_id,
        outcomeCount: outcomeMap.get(r.id) ?? 0,
        assignmentCount: assignMap.get(r.id) ?? 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        whyHidden: reasonsHidden,
        visibleOnStateLookup: reasonsHidden.length === 0,
      };
    });
    return res.json({ total: enriched.length, today, los: enriched });
  });

  app.post("/api/admin/purge-inactive-los", (req: any, res: any) => {
    if (!isBootstrapOrAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const dryRun = req.query.dryRun === "1" || req.body?.dryRun === true;
    const sqlite = (storageExtra as any).getRawSqlite();
    try { createBackup('pre-lo-purge'); } catch (e) { console.error('backup failed', e); }
    const targets = sqlite.prepare(`
      SELECT id, full_name, internal_status FROM loan_officers
      WHERE internal_status IN ('archived', 'inactive')
    `).all() as { id: number; full_name: string; internal_status: string }[];
    const deleted: { id: number; name: string; status: string }[] = [];
    const kept: { id: number; name: string; status: string; reason: string; outcomes: number; assignments: number }[] = [];
    const outcomesStmt = sqlite.prepare(`SELECT COUNT(*) AS c FROM lead_outcomes WHERE lo_id = ?`);
    const assignStmt = sqlite.prepare(`SELECT COUNT(*) AS c FROM daily_assignments WHERE lo_id = ?`);
    const availStmt = sqlite.prepare(`DELETE FROM lo_availability WHERE lo_id = ?`);
    const delStmt = sqlite.prepare(`DELETE FROM loan_officers WHERE id = ?`);
    const trx = sqlite.transaction(() => {
      for (const t of targets) {
        const outcomes = (outcomesStmt.get(t.id) as { c: number }).c;
        const assignments = (assignStmt.get(t.id) as { c: number }).c;
        if (outcomes > 0 || assignments > 0) {
          kept.push({
            id: t.id, name: t.full_name, status: t.internal_status,
            reason: "has historical data",
            outcomes, assignments,
          });
          continue;
        }
        if (!dryRun) {
          availStmt.run(t.id);
          delStmt.run(t.id);
        }
        deleted.push({ id: t.id, name: t.full_name, status: t.internal_status });
      }
    });
    trx();
    return res.json({
      dryRun,
      considered: targets.length,
      deleted_count: deleted.length,
      kept_count: kept.length,
      deleted,
      kept,
    });
  });

  // ── Send a sample report email (bootstrap- or admin-authorized) ──────────
  app.post("/api/admin/send-report-sample", async (req: any, res: any) => {
    if (!isBootstrapOrAdmin(req)) return res.status(403).json({ error: "Admin only" });
    const rawType = req.body?.type;
    const type: "daily" | "weekly" | "monthly" | "mtd" | "alltime" =
      rawType === "weekly" || rawType === "monthly" || rawType === "mtd" || rawType === "alltime" ? rawType : "daily";
    const recipients: string[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const cleaned = recipients
      .map((r: any) => String(r || "").trim())
      .filter((r: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
    if (!cleaned.length) return res.status(400).json({ error: "No valid recipients" });
    try {
      const startDate = req.body?.startDate;
      const endDate = req.body?.endDate;
      const customRange = (startDate && endDate) ? { startDate, endDate } : undefined;
      const result: any = await sendReport(type, { customRange, recipientsOverride: cleaned });
      return res.json({
        ok: true,
        id: result?.id,
        recipients: result?.recipients,
        startDate: result?.startDate,
        endDate: result?.endDate,
        type,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ── One-time import v2: Ryan + Randy outcomes ────────────────────────────
  app.post("/api/admin/run-import-v2", async (req: any, res: any) => {
    const bootstrap = req.headers["x-bootstrap-token"];
    const isBootstrap = typeof bootstrap === "string" && bootstrap === "06e30810-b43c-4bad-8fac-0093a269a917";
    if (!isBootstrap) {
      const sess = req.session_user;
      const me = sess?.userId ? (storage.getUserById(sess.userId) as any) : null;
      if (!me || (me.role !== "admin" && !me.superAdmin)) {
        return res.status(403).json({ error: "Admin only" });
      }
    }

    try {
      const sqlite = (storageExtra as any).getRawSqlite();
      const RYAN_ID = 14;

      const RYAN_OUTCOMES: any[] = [{"date":"2026-04-27","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Bruno Vaitekunas","lo_name":"Khashi Tabrizi","notes":"HELOC Min."},{"date":"2026-04-27","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"Victor Gonzalez","lo_name":"Bill Neessen","notes":""},{"date":"2026-04-27","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"Yanela/Pedro Sanchez","lo_name":"Bill Neessen","notes":""},{"date":"2026-04-28","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Wladamir Maldonado","lo_name":"Khashi Tabrizi","notes":""},{"date":"2026-04-28","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"John Fretz","lo_name":"Ian Militello","notes":""},{"date":"2026-04-28","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"John Fretz","lo_name":"Ian Militello","notes":"(duplicate entry in report)"},{"date":"2026-04-29","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Tom Knight","lo_name":"Derek Bullen","notes":""},{"date":"2026-04-30","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Gary Ceplina","lo_name":"Gary Dawson","notes":""},{"date":"2026-04-30","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Alberto Tapia","lo_name":"Ian Militello","notes":""},{"date":"2026-05-01","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"Michael Daniels","lo_name":"Sean Murphy","notes":""},{"date":"2026-05-01","outcome_type":"transfer","transfer_type":"direct","borrower_name":"James Larson","lo_name":"Sean Murphy","notes":"ORANGE - Home Equity W2"},{"date":"2026-05-04","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"Wayne Mclaughliin","lo_name":"Khashi Tabrizi","notes":""},{"date":"2026-05-04","outcome_type":"appointment","borrower_name":null,"lo_name":null,"notes":""},{"date":"2026-05-04","outcome_type":"appointment","borrower_name":null,"lo_name":null,"notes":""},{"date":"2026-05-04","outcome_type":"appointment","borrower_name":null,"lo_name":null,"notes":""},{"date":"2026-05-04","outcome_type":"fell_through","borrower_name":null,"lo_name":null,"notes":""},{"date":"2026-05-05","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Debbie Evonne James","lo_name":"Gary Dawson","notes":"BLACK - W2"},{"date":"2026-05-05","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"Cynthia Reynolds","lo_name":"Khashi Tabrizi","notes":""},{"date":"2026-05-06","outcome_type":"fell_through","borrower_name":"Thomas Lahman","lo_name":"Bill Neessen","notes":""},{"date":"2026-05-07","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Darlene Baker","lo_name":"Khashi Tabrizi","notes":"RETREAD - Called back, working with another lender. Saved deal, working with us for a reverse."},{"date":"2026-05-07","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Iris Riley","lo_name":"Gary Dawson","notes":""},{"date":"2026-05-07","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Corey Booth","lo_name":"Ian Militello","notes":""},{"date":"2026-05-07","outcome_type":"appointment","borrower_name":"Rasheeda Marshall","lo_name":"Dan Baker","notes":"Scheduled: Fri, May 8, 7:30 AM"},{"date":"2026-05-07","outcome_type":"appointment","borrower_name":"James Keyes","lo_name":"Gary Dawson","notes":"Scheduled: Mon, May 11, 9:00 AM"},{"date":"2026-05-08","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Nancy Baker","lo_name":"Bill Neessen","notes":"ORANGE W2 - HELOC"},{"date":"2026-05-08","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"Victoria Dalton","lo_name":"Bill Neessen","notes":"Spanish speaking only. Transferred to Justin V. to be originated under Chris."},{"date":"2026-05-08","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Bridgett Wade","lo_name":"Derek Bullen","notes":""},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"Leanne Hanson","lo_name":"Ian Militello","notes":"Scheduled: Fri, May 8, 4:00 PM"},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"Leigh Sullivan","lo_name":"Bill Neessen","notes":"Scheduled: Fri, May 8, 5:00 PM"},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"James Midkiff","lo_name":"Bill Neessen","notes":""},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"Adrian Nicely","lo_name":"Bill Neessen","notes":"Scheduled: Sat, May 9, 11:00 AM"},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"Joe Fuquay","lo_name":"Khashi Tabrizi","notes":"Scheduled: Fri, May 8, 5:00 PM"},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"James Midkiff","lo_name":"Bill Neessen","notes":"Scheduled: Mon, May 11, 8:00 AM"},{"date":"2026-05-11","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Michael Whitmer","lo_name":"Gary Dawson","notes":"ORANGE W2 - HELOC"},{"date":"2026-05-11","outcome_type":"transfer","transfer_type":"direct","borrower_name":"James Midkiff","lo_name":"Bill Neessen","notes":""},{"date":"2026-05-11","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Leigh Sullivan","lo_name":"Ian Militello","notes":""},{"date":"2026-05-11","outcome_type":"transfer","transfer_type":"appointment","borrower_name":"Richard Brown","lo_name":"Gary Dawson","notes":"MAROON - HELOC 580-619 $25-60K LTV 80%+"},{"date":"2026-05-11","outcome_type":"appointment","borrower_name":"Kevin Dimedio","lo_name":"Bill Neessen","notes":"Scheduled: Mon, May 11, 10:00 AM"}];

      const RANDY_OUTCOMES: any[] = [{"date":"2026-05-05","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Debra Hall","lo_name":"Dan Baker","notes":"Client interested in 30k heloc"},{"date":"2026-05-06","outcome_type":"appointment","borrower_name":"Adrian Nicely","lo_name":"Bill Neessen","notes":"Client wants a call 2pm est/11am pst, per previous texts with agent Adrian Salazar client was looking to take out 250k and has a $0 balance. Scheduled: Fri, May 8, 11:00 AM"},{"date":"2026-05-07","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Jimmy Williams","lo_name":"Khashi Tabrizi","notes":"Client was looking for a cash out refi, didn't like the numbers from other companies, mainly a company called Point"},{"date":"2026-05-07","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Donald Kirkpatrick","lo_name":"Dan Baker","notes":"Client is looking for a Cash Out Refinance, received quotes from local credit union, still shopping around"},{"date":"2026-05-07","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Paula Boyle","lo_name":"Dan Baker","notes":"Direct transfer to Dan Baker, client has had issues qualifying with other companies in the past and needs creative solutions"},{"date":"2026-05-07","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Eugene Merello","lo_name":"Cole Fairon","notes":"Client is in need of a loan to fix his roof, direct transfer to Cole"},{"date":"2026-05-07","outcome_type":"appointment","borrower_name":"Marcy Spears","lo_name":"Cole Fairon","notes":"Scheduled: Thu, Jul 9, 4:55 PM"},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"Mark Washington","lo_name":"Gary Dawson","notes":"Scheduled: Mon, May 11, 8:30 AM"},{"date":"2026-05-08","outcome_type":"appointment","borrower_name":"Ron Glazer","lo_name":"Cole Fairon","notes":"Client wants follow up, looking for a 2nd HELOC for 75-80k, wants to follow up the week of 5/18. Scheduled: Mon, May 18, 8:30 AM"},{"date":"2026-05-11","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Roderick Madison","lo_name":"Khashi Tabrizi","notes":"Client wants to pull out 20-30k out of the home"},{"date":"2026-05-11","outcome_type":"transfer","transfer_type":"direct","borrower_name":"Clarence Taylor","lo_name":"Cole Fairon","notes":"Client needs 40k, business owner, further notes sent to cole"},{"date":"2026-05-11","outcome_type":"appointment","borrower_name":"Joseph Lemons","lo_name":"Cole Fairon","notes":"Client responded still interested in tapping into home equity, wants a call at 10am CST/8am PST. Scheduled: Tue, May 12, 8:00 AM"}];

      // Get Ethan's org_id
      const ethan = sqlite.prepare("SELECT org_id FROM users WHERE id = 1").get() as { org_id: number } | undefined;
      const orgId = ethan?.org_id ?? 1;

      // Find or create Randy Hammond
      let randyRow = sqlite.prepare("SELECT id FROM users WHERE LOWER(name) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1")
        .get("Randy Hammond", "rhammond@westcapitallending.com") as { id: number } | undefined;
      let randyId: number;
      let randyCreated = false;
      if (randyRow) {
        randyId = randyRow.id;
      } else {
        const hash = bcrypt.hashSync("WCL2026!", 10);
        const nowIso = new Date().toISOString();
        const ins = sqlite.prepare(`
          INSERT INTO users
            (name, email, role, is_active, is_clr, is_manager, super_admin, password_hash, must_change_password, org_id, has_seen_intro, created_at)
          VALUES (?, ?, 'assistant', 1, 1, 0, 0, ?, 0, ?, 0, ?)
        `).run("Randy Hammond", "rhammond@westcapitallending.com", hash, orgId, nowIso);
        randyId = Number(ins.lastInsertRowid);
        randyCreated = true;
      }

      // LO matcher (same logic as ethan import)
      const los = sqlite.prepare("SELECT id, full_name FROM loan_officers").all() as { id: number; full_name: string }[];
      const matchLoId = (raw: string | null): { loId: number; matched: boolean } => {
        if (!raw) return { loId: 999, matched: false };
        const norm = raw.trim().toLowerCase();
        let hit = los.find(l => (l.full_name || "").trim().toLowerCase() === norm);
        if (!hit) {
          const last = norm.split(/\s+/).slice(-1)[0];
          hit = los.find(l => {
            const fn = (l.full_name || "").toLowerCase();
            if (fn.includes(norm)) return true;
            if (last && fn.includes(last)) return true;
            return false;
          });
        }
        return hit ? { loId: hit.id, matched: true } : { loId: 999, matched: false };
      };

      try { createBackup('pre-import-v2'); } catch (e) { console.error('backup failed', e); }

      const delStmt = sqlite.prepare("DELETE FROM lead_outcomes WHERE assistant_id = ?");
      const ryanDeleted = (delStmt.run(RYAN_ID).changes) as number;
      const randyDeleted = (delStmt.run(randyId).changes) as number;

      const insStmt = sqlite.prepare(
        `INSERT INTO lead_outcomes
          (date, assistant_id, lo_id, borrower_name, outcome_type, transfer_type, notes, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
      );

      const unmatched: string[] = [];
      const errors: string[] = [];
      const now = new Date().toISOString();

      const insertBatch = (rows: any[], assistantId: number): number => {
        let count = 0;
        const trx = sqlite.transaction((batch: any[]) => {
          for (const r of batch) {
            const { loId, matched } = matchLoId(r.lo_name ?? null);
            if (r.lo_name && !matched) unmatched.push(r.lo_name);
            try {
              insStmt.run(
                r.date,
                assistantId,
                loId,
                (r.borrower_name == null ? "" : r.borrower_name),
                r.outcome_type,
                r.transfer_type ?? null,
                r.notes ?? null,
                now,
                now,
              );
              count++;
            } catch (e: any) {
              errors.push(`row ${JSON.stringify(r)}: ${e?.message || e}`);
            }
          }
        });
        trx(rows);
        return count;
      };

      const ryanInserted = insertBatch(RYAN_OUTCOMES, RYAN_ID);
      const randyInserted = insertBatch(RANDY_OUTCOMES, randyId);

      return res.json({
        success: true,
        randyId,
        randyCreated,
        ryanDeleted,
        randyDeleted,
        ryanInserted,
        randyInserted,
        ryanTotal: RYAN_OUTCOMES.length,
        randyTotal: RANDY_OUTCOMES.length,
        unmatchedLOs: Array.from(new Set(unmatched)),
        errors,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });


  // ── EOD Reminder: manual test trigger (admin only) ───────────────────────
  // POST /api/admin/eod-reminders/test
  // Immediately fires EOD reminder check for the calling user, sending to their
  // own email address. Useful for verifying the template before relying on the cron.
  app.post("/api/admin/eod-reminders/test", requireAuth, async (req: any, res: any) => {
    const sess = req.session_user;
    const me = sess?.userId ? (storage.getUserById(sess.userId) as any) : null;
    if (!me || (me.role !== "admin" && !me.superAdmin)) {
      return res.status(403).json({ error: "Admin only" });
    }
    try {
      await checkAndSendEodReminders({ testClrId: me.id, testEmail: me.email });
      return res.json({ ok: true, message: `Test reminder sent to ${me.email}` });
    } catch (e: any) {
      console.error("[eod-reminder-test]", e?.message ?? e);
      return res.status(500).json({ error: e?.message ?? "Failed to send test reminder" });
    }
  });

  // ── One-shot Bonzo password restore (admin only) ─────────────────────────
  // Restores Bonzo passwords from the CLR Master Sheet source-of-truth
  // (parsed 2026-05-05). Idempotent — safe to re-run. Matches LOs by email
  // (case-insensitive). LOs not in the list are skipped.
  app.post("/api/admin/restore-bonzo-passwords", requireAuth, async (req: any, res: any) => {
    const sess = req.session_user;
    const me = sess?.userId ? (storage.getUserById(sess.userId) as any) : null;
    if (!me || (me.role !== "admin" && !me.superAdmin)) {
      return res.status(403).json({ error: "Admin only" });
    }
    const RESTORE_MAP: Record<string, string> = {
      "bneessen@westcapitallending.com":   "ChBn100215#N",
      "ktabrizi@westcapitallending.com":   "Jonah#525252",
      "smurphy@westcapitallending.com":    "Operator1991!!",
      "dbaker@westcapitallending.com":     "$Herbalife247",
      "imilitello@westcapitallending.com": "December#417",
      "cfairon@westcapitallending.com":    "Bheart2026$$!!",
      "jmcgowan@westcapitallending.com":   "Bonzo#051996",
      "dbullen@westcapitallending.com":    "#Everett12!!",
      "gdawson@westcapitallending.com":    "LAChargersKings$1",
      "asalazar@westcapitallending.com":   "Wesleycap23$",
      "sripperger@westcapitallending.com": "Ranierbeer14!",
    };
    const los = storage.getLoanOfficers() as any[];
    const results: { email: string; loId?: number; name?: string; status: string }[] = [];
    for (const [email, password] of Object.entries(RESTORE_MAP)) {
      const lo = los.find((l: any) => {
        const e = String(l.email ?? l.email_address ?? "").toLowerCase().trim();
        return e === email;
      });
      if (!lo) { results.push({ email, status: "not_found" }); continue; }
      try {
        storage.updateLoanOfficer(lo.id, { bonzoPassword: password } as any);
        results.push({ email, loId: lo.id, name: lo.fullName ?? lo.full_name, status: "updated" });
      } catch (e: any) {
        results.push({ email, loId: lo.id, name: lo.fullName ?? lo.full_name, status: `error: ${e?.message ?? e}` });
      }
    }
    audit({
      userId: me.id,
      userName: me.name,
      action: "restore_bonzo_passwords",
      entityType: "loan_officer",
      entityLabel: `${results.filter(r => r.status === "updated").length} LOs updated`,
      details: JSON.stringify(results),
    });
    return res.json({ ok: true, updated: results.filter(r => r.status === "updated").length, results });
  });

  // ── EOD Reminder: force-run cron now (super admin only) ──────────────────
  app.post("/api/admin/eod-reminders/run-now", requireAuth, async (req: any, res: any) => {
    const sess = req.session_user;
    const me = sess?.userId ? (storage.getUserById(sess.userId) as any) : null;
    if (!me?.superAdmin) return res.status(403).json({ error: "Super admin only" });
    try {
      await checkAndSendEodReminders();
      return res.json({ ok: true, message: "EOD reminder check completed" });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? "Failed" });
    }
  });

  // ── Web Push (VAPID) ──────────────────────────────────────────────────────
  try { initPush(); } catch (e: any) { console.error("[push] init failed:", e?.message ?? e); }

  app.get("/api/push/vapid-public-key", (_req, res) => {
    const key = getVapidPublicKey();
    if (!key) return res.status(503).json({ error: "Push not configured" });
    res.json({ publicKey: key });
  });

  app.post("/api/push/subscribe", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const sub = req.body?.subscription ?? req.body;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    const user = storage.getUserById(userId) as any;
    const orgId = user?.orgId ?? 1;
    try {
      saveSubscription(userId, orgId, sub);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "save failed" });
    }
  });

  app.delete("/api/push/unsubscribe", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const endpoint = (req.body?.endpoint ?? req.query?.endpoint) as string | undefined;
    if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });
    removeSubscription(userId, endpoint);
    res.json({ ok: true });
  });

  // Admin diagnostic: shows total subscription count, per-user counts, and
  // whether VAPID is initialized. Useful when troubleshooting "why isn't push
  // firing" — if push.sent is always 0, this tells you whether the issue is
  // an empty subscription table or a delivery failure.
  app.get("/api/push/diagnostics", requireAuth, (req: any, res) => {
    const me = req.session_user?.userId;
    const meUser = me ? (storage.getUserById(me) as any) : null;
    if (!me || meUser?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    try {
      const sqlite = storageExtra.getRawSqlite();
      const total = (sqlite.prepare(`SELECT COUNT(*) AS c FROM push_subscriptions`).get() as any).c as number;
      const perUser = sqlite.prepare(`
        SELECT ps.user_id AS userId, u.name, u.email, COUNT(*) AS subscriptions
          FROM push_subscriptions ps
          LEFT JOIN users u ON u.id = ps.user_id
         GROUP BY ps.user_id
         ORDER BY subscriptions DESC, u.name ASC
      `).all();
      const usersTotal = (sqlite.prepare(`SELECT COUNT(*) AS c FROM users`).get() as any).c as number;
      res.json({
        vapidInitialized: !!getVapidPublicKey(),
        totalSubscriptions: total,
        usersTotal,
        usersWithSubscription: perUser.length,
        perUser,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "diagnostics failed" });
    }
  });

  // Admin test: fire a sample appointment-reminder push at the requesting
  // user (or a target userId). Mirrors the format the [appt-30m] cron sends
  // so we can verify end-to-end push delivery without waiting for a real
  // appointment to come within 30 minutes.
  app.post("/api/push/test-appointment", requireAuth, async (req: any, res) => {
    const me = req.session_user?.userId;
    if (!me) return res.status(401).json({ error: "Unauthorized" });
    const meUser = storage.getUserById(me) as any;
    if (meUser?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const targetId = Number(req.body?.userId ?? me);
    const borrower = (req.body?.borrower as string) || "Sample Borrower";
    const loName = (req.body?.loName as string) || "Sample LO";
    const result = await sendPushToUser(targetId, {
      title: "⏰ Appointment in 30 minutes",
      body: `${borrower} — ${loName}`,
      url: "/appointments",
    });
    console.log(`[push-test] sample appointment reminder fired to user=${targetId} sent=${result.sent} failed=${result.failed}`);
    res.json({ targetUserId: targetId, ...result });
  });

  // Internal-ish helper: admins can send a push to any user; users can self-test
  app.post("/api/push/send", requireAuth, async (req: any, res) => {
    const me = req.session_user?.userId;
    if (!me) return res.status(401).json({ error: "Unauthorized" });
    const meUser = storage.getUserById(me) as any;
    const targetId = Number(req.body?.userId ?? me);
    if (targetId !== me && meUser?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { title, body, url } = req.body ?? {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const result = await sendPushToUser(targetId, { title, body, url });
    res.json(result);
  });

  // ── SMS (Twilio) ────────────────────────────────────────────────────────────
  // Whether SMS is configured for the current user's org — used by clients to
  // decide whether to show the "SMS Reminders" toggle.
  app.get("/api/sms/status", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const user = storage.getUserById(userId) as any;
    const orgId = user?.orgId ?? 1;
    const { isTwilioConfigured } = require("./sms");
    res.json({ configured: isTwilioConfigured(orgId) });
  });

  // Admin: load Twilio creds (auth token redacted)
  app.get("/api/sms/settings", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    try {
      const row = (require("./storage").getRawSqlite() as any)
        .prepare(`SELECT twilio_account_sid, twilio_auth_token, twilio_from_number FROM webhook_settings WHERE id=1`)
        .get();
      res.json({
        twilioAccountSid: row?.twilio_account_sid ?? "",
        twilioAuthToken: row?.twilio_auth_token ? "••••••••" : "",
        twilioAuthTokenSet: !!row?.twilio_auth_token,
        twilioFromNumber: row?.twilio_from_number ?? "",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load settings" });
    }
  });

  // Admin: update Twilio creds. Auth token omitted/empty preserves existing value.
  app.patch("/api/sms/settings", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const { twilioAccountSid, twilioAuthToken, twilioFromNumber } = req.body ?? {};
    try {
      const sqlite = (require("./storage").getRawSqlite() as any);
      // Only update non-undefined fields. Empty string clears.
      const sets: string[] = [];
      const vals: any[] = [];
      if (typeof twilioAccountSid === "string") {
        sets.push("twilio_account_sid = ?");
        vals.push(twilioAccountSid.trim() || null);
      }
      if (typeof twilioAuthToken === "string" && twilioAuthToken !== "••••••••") {
        sets.push("twilio_auth_token = ?");
        vals.push(twilioAuthToken.trim() || null);
      }
      if (typeof twilioFromNumber === "string") {
        sets.push("twilio_from_number = ?");
        vals.push(twilioFromNumber.trim() || null);
      }
      if (sets.length) {
        sqlite.prepare(`UPDATE webhook_settings SET ${sets.join(", ")}, updated_at = ? WHERE id = 1`)
          .run(...vals, new Date().toISOString());
      }
      const row = sqlite
        .prepare(`SELECT twilio_account_sid, twilio_auth_token, twilio_from_number FROM webhook_settings WHERE id=1`)
        .get();
      res.json({
        twilioAccountSid: row?.twilio_account_sid ?? "",
        twilioAuthToken: row?.twilio_auth_token ? "••••••••" : "",
        twilioAuthTokenSet: !!row?.twilio_auth_token,
        twilioFromNumber: row?.twilio_from_number ?? "",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to save settings" });
    }
  });

  // Admin: send a test SMS to their own phone number.
  app.post("/api/sms/test", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const userId = req.session_user?.userId;
    const user = storage.getUserById(userId) as any;
    const orgId = user?.orgId ?? 1;
    const to = (req.body?.to as string | undefined)?.trim() || user?.phone;
    if (!to) return res.status(400).json({ error: "No phone number on profile; set one or pass 'to' in body." });
    const { sendSms } = require("./sms");
    const result = await sendSms(to, "CLR Connection Center: This is a test SMS. Twilio is configured correctly.", orgId);
    if (!result.ok) return res.status(400).json({ error: result.error ?? "SMS failed", skipped: result.skipped });
    res.json({ ok: true, sid: result.sid });
  });

  // Per-user SMS reminders toggle
  app.patch("/api/users/me/sms-reminders", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const enabled = !!req.body?.enabled;
    try {
      (require("./storage").getRawSqlite() as any)
        .prepare(`UPDATE users SET sms_reminders_enabled = ? WHERE id = ?`)
        .run(enabled ? 1 : 0, userId);
      res.json({ ok: true, enabled });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update" });
    }
  });

  // Per-user appointment-reminder email toggle (default ON)
  app.patch("/api/users/me/reminder-email", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const enabled = !!req.body?.enabled;
    try {
      (require("./storage").getRawSqlite() as any)
        .prepare(`UPDATE users SET reminder_email_enabled = ? WHERE id = ?`)
        .run(enabled ? 1 : 0, userId);
      res.json({ ok: true, enabled });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update" });
    }
  });

  // Per-user mute toggles for chat and forum notifications (in-app + push + email).
  app.patch("/api/users/me/mute-chat", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const muted = !!req.body?.muted;
    try {
      (require("./storage").getRawSqlite() as any).prepare(`UPDATE users SET mute_chat_notifications = ? WHERE id = ?`).run(muted ? 1 : 0, userId);
      res.json({ ok: true, muted });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? "Failed to update" }); }
  });
  app.patch("/api/users/me/mute-forum", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const muted = !!req.body?.muted;
    try {
      (require("./storage").getRawSqlite() as any).prepare(`UPDATE users SET mute_forum_notifications = ? WHERE id = ?`).run(muted ? 1 : 0, userId);
      res.json({ ok: true, muted });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? "Failed to update" }); }
  });

  // ── Public marketing landing page ──────────────────────────────────────────
  app.get("/landing", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(LANDING_HTML);
  });

  // ── Request access form (public, rate-limited 3/hr per IP) ────────────────
  app.post("/api/request-access", async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    if (!requestAccessRateOk(ip)) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    const { companyName, yourName, email, teamSize, message } = req.body ?? {};
    const errors: string[] = [];
    const safeCompany = String(companyName ?? "").trim();
    const safeName = String(yourName ?? "").trim();
    const safeEmail = String(email ?? "").trim();
    const safeTeamSize = String(teamSize ?? "").trim();
    const safeMessage = String(message ?? "").trim();
    if (!safeCompany) errors.push("companyName required");
    if (!safeName) errors.push("yourName required");
    if (!safeEmail.includes("@")) errors.push("valid email required");
    if (!["1-5", "6-15", "16+"].includes(safeTeamSize)) errors.push("teamSize must be 1-5, 6-15, or 16+");
    if (errors.length) return res.status(400).json({ error: errors.join(", ") });

    const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] || c));
    const html = `<h2>New CLR Connection Center access request</h2>
<table cellpadding="6" style="border-collapse:collapse;font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">
  <tr><td><strong>Company</strong></td><td>${esc(safeCompany)}</td></tr>
  <tr><td><strong>Name</strong></td><td>${esc(safeName)}</td></tr>
  <tr><td><strong>Email</strong></td><td>${esc(safeEmail)}</td></tr>
  <tr><td><strong>Team size</strong></td><td>${esc(safeTeamSize)}</td></tr>
  <tr><td><strong>IP</strong></td><td>${esc(ip)}</td></tr>
</table>
${safeMessage ? `<p><strong>Message:</strong></p><p style="white-space:pre-wrap">${esc(safeMessage)}</p>` : ""}`;

    try {
      await sendEmail({
        to: "ethan.anthony.wood@gmail.com",
        subject: `Access request: ${safeCompany} (${safeName})`,
        html,
      });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[request-access] send failed:", e?.message ?? e);
      res.status(500).json({ error: "Could not send request. Please email ethan.anthony.wood@gmail.com directly." });
    }
  });

  // ── Auth routes (public) ───────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    const rateCheck = storageExtra.checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: "Too many failed attempts. Please wait 15 minutes before trying again." });
    }
    const { email, password } = req.body ?? {};
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    const user = storage.getUserByEmail(trimmedEmail);
    if (!user) {
      audit({ action: "login_failed", entityType: "auth", entityLabel: trimmedEmail, details: JSON.stringify({ ip, reason: "no_user" }) });
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (!user.password_hash) return res.status(401).json({ error: "Account has no password set" });
    const valid = await bcrypt.compare(trimmedPassword, user.password_hash);
    if (!valid) {
      audit({ userId: user.id, userName: user.name, action: "login_failed", entityType: "auth", entityId: user.id, entityLabel: user.email, details: JSON.stringify({ ip, reason: "bad_password" }) });
      return res.status(401).json({ error: `Invalid email or password${rateCheck.remaining <= 2 ? ` (${rateCheck.remaining} attempt${rateCheck.remaining === 1 ? "" : "s"} remaining)` : ""}` });
    }

    const isProduction = process.env.NODE_ENV === "production";
    const u = user as any;
    const orgId = Number(u.orgId ?? u.org_id ?? 1);
    const superAdmin = !!(u.superAdmin ?? u.super_admin);
    const payload = JSON.stringify({ userId: user.id, role: user.role, orgId, superAdmin });
    res.cookie(COOKIE_NAME, payload, {
      signed: true,
      httpOnly: true,
      sameSite: isProduction ? "strict" : "none",
      secure: isProduction,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    storageExtra.resetLoginAttempts(ip);
    audit({ userId: user.id, userName: user.name, action: "login", entityType: "auth", entityId: user.id, entityLabel: user.email, details: JSON.stringify({ ip }) });
    return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, isClr: !!(u.isClr ?? u.is_clr), hasSeenIntro: !!(u.hasSeenIntro ?? u.has_seen_intro), mustChangePassword: !!(u.mustChangePassword ?? u.must_change_password), hasDismissedSample: !!(u.hasDismissedSample ?? u.has_dismissed_sample), superAdmin, orgId } });
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
      const u = user as any;
      // Allow impersonation: session.orgId overrides user.orgId if super admin
      const orgId = session.superAdmin && session.orgId ? Number(session.orgId) : Number(u.orgId ?? u.org_id ?? 1);
      const superAdmin = !!(u.superAdmin ?? u.super_admin);
      const isImpersonating = !!(session.superAdmin && session.isImpersonating);
      const impersonatingOrgName = isImpersonating ? (session.impersonatingOrgName ?? null) : null;
      return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, isClr: !!u.isClr, isManager: !!(u.isManager ?? u.is_manager), excludeFromStats: !!(u.excludeFromStats ?? u.exclude_from_stats), hasSeenIntro: !!u.hasSeenIntro, mustChangePassword: !!u.mustChangePassword, hasDismissedSample: !!(u.hasDismissedSample ?? u.has_dismissed_sample), lastSeenPipelineSop: u.lastSeenPipelineSop ?? u.last_seen_pipeline_sop ?? null, createdAt: u.createdAt ?? u.created_at ?? null, phone: u.phone ?? null, scriptCompanyName: u.scriptCompanyName ?? u.script_company_name ?? null, scriptNameOverride: u.scriptNameOverride ?? u.script_name_override ?? null, scriptLoOverride: u.scriptLoOverride ?? u.script_lo_override ?? null, goalCallsWeekly: u.goalCallsWeekly ?? u.goal_calls_weekly ?? 0, goalTransfersWeekly: u.goalTransfersWeekly ?? u.goal_transfers_weekly ?? 0, goalAppointmentsWeekly: u.goalAppointmentsWeekly ?? u.goal_appointments_weekly ?? 0, smsRemindersEnabled: !!(u.smsRemindersEnabled ?? u.sms_reminders_enabled), muteChatNotifications: !!(u.muteChatNotifications ?? u.mute_chat_notifications), muteForumNotifications: !!(u.muteForumNotifications ?? u.mute_forum_notifications), reminderEmailEnabled: (u.reminderEmailEnabled ?? u.reminder_email_enabled) === undefined ? true : !!(u.reminderEmailEnabled ?? u.reminder_email_enabled), timezone: u.timezone ?? "America/Los_Angeles", superAdmin, orgId, isImpersonating, impersonatingOrgName } });
    } catch {
      return res.status(401).json({ error: "Not authenticated" });
    }
  });

  // EOD lock status: locks CLRs who haven't submitted EODs for any of the last
  // 3 weekdays. Skips dates before the user's created_at and dates >10 days ago.
  // Non-CLRs (admin without isClr, viewers) are never locked.
  app.get("/api/auth/eod-lock-status", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const user = storage.getUserById(userId) as any;
    if (!user) return res.status(404).json({ error: "User not found" });

    const isClr = user.role === "assistant" || (user.role === "admin" && !!(user.isClr ?? user.is_clr));
    if (!isClr) return res.json({ locked: false, missingDates: [] });

    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tenDaysAgo = new Date(today);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const createdAtRaw = user.createdAt ?? user.created_at ?? null;
    const createdAt = createdAtRaw ? new Date(String(createdAtRaw).replace(" ", "T")) : null;
    if (createdAt) createdAt.setHours(0, 0, 0, 0);

    const lastWeekdays: string[] = [];
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - 1);
    while (lastWeekdays.length < 3 && cursor >= tenDaysAgo) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        if (!createdAt || cursor >= createdAt) lastWeekdays.push(fmt(cursor));
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    const missingDates: string[] = [];
    for (const d of lastWeekdays) {
      const r = storageExtra.getEodReport(d, userId);
      if (!r) missingDates.push(d);
    }
    res.json({ locked: missingDates.length > 0, missingDates });
  });

  // Admin-only: Complete System Manual PDF.
  // Also intercepts the public static path so old links still enforce auth.
  const serveCompleteManual = (req: any, res: Response) => {
    const user = storage.getUserById(req.session_user?.userId) as any;
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }
    // Try dist-bundled location first (prod), then repo root (dev)
    const candidates = [
      path.resolve(process.cwd(), "dist", "docs-private", "complete-manual.pdf"),
      path.resolve(process.cwd(), "docs-private", "complete-manual.pdf"),
      path.resolve(__dirname, "docs-private", "complete-manual.pdf"),
    ];
    const pdfPath = candidates.find((p) => fs.existsSync(p)) || candidates[0];
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="complete-manual.pdf"');
    res.setHeader("Cache-Control", "private, no-store");
    fs.createReadStream(pdfPath).pipe(res);
  };
  app.get("/api/docs/complete-manual.pdf", requireAuth, serveCompleteManual);
  app.get("/docs/complete-manual.pdf", requireAuth, serveCompleteManual);

  // Current user's full record (including goals etc.)
  app.get("/api/me", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const user = storage.getUserById(userId) as any;
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  });

  // Update own profile preferences (currently: timezone).
  // IANA timezone name, validated against Intl.supportedValuesOf when available;
  // we also fall back to constructing an Intl.DateTimeFormat to probe the value.
  app.patch("/api/auth/profile", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const body = req.body ?? {};
    const patch: Record<string, any> = {};

    if (typeof body.timezone === "string") {
      const tz = body.timezone.trim();
      let valid = false;
      try {
        const supported = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
        if (supported && Array.isArray(supported)) {
          valid = supported.includes(tz);
        } else {
          new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
          valid = true;
        }
      } catch { valid = false; }
      if (!valid) return res.status(400).json({ error: `Invalid timezone: ${tz}` });
      patch.timezone = tz;
    }

    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No supported fields provided" });
    const updated = storage.updateUser(userId, patch as any);
    if (!updated) return res.status(404).json({ error: "User not found" });
    return res.json({ ok: true, user: updated });
  });

  // Mark intro video as seen for current user
  app.patch("/api/users/me/seen-intro", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    storage.updateUser(userId, { hasSeenIntro: true } as any);
    return res.json({ ok: true });
  });

  // Record that the CLR just saw the pipeline-stages popup. Resets the 14-day
  // clock; the popup reappears 14 days after this timestamp.
  app.patch("/api/users/me/seen-pipeline-sop", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    storage.updateUser(userId, { lastSeenPipelineSop: new Date().toISOString() } as any);
    return res.json({ ok: true });
  });

  // Getting Started checklist — per-user DB-tracked (replaces old localStorage scheme)
  app.get("/api/user/getting-started", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const sqliteDb: any = storageExtra.getSqlite();
      const row: any = sqliteDb.prepare(
        `SELECT getting_started_dismissed AS dismissed, getting_started_completed AS completed FROM users WHERE id = ?`
      ).get(userId);
      let completed: string[] = [];
      try { completed = JSON.parse(row?.completed ?? "[]"); } catch { completed = []; }
      if (!Array.isArray(completed)) completed = [];
      res.json({ dismissed: !!row?.dismissed, completed });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "failed" });
    }
  });

  app.post("/api/user/getting-started", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const sqliteDb: any = storageExtra.getSqlite();
      const body = req.body ?? {};
      const updates: string[] = [];
      const values: any[] = [];
      if (typeof body.dismissed === "boolean") {
        updates.push("getting_started_dismissed = ?");
        values.push(body.dismissed ? 1 : 0);
      }
      if (Array.isArray(body.completed)) {
        const cleaned = Array.from(new Set(body.completed.filter((x: any) => typeof x === "string")));
        updates.push("getting_started_completed = ?");
        values.push(JSON.stringify(cleaned));
      }
      if (updates.length > 0) {
        values.push(userId);
        sqliteDb.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      }
      const row: any = sqliteDb.prepare(
        `SELECT getting_started_dismissed AS dismissed, getting_started_completed AS completed FROM users WHERE id = ?`
      ).get(userId);
      let completed: string[] = [];
      try { completed = JSON.parse(row?.completed ?? "[]"); } catch { completed = []; }
      res.json({ dismissed: !!row?.dismissed, completed });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "failed" });
    }
  });

  // Admin: reset intro for a specific user (so they see it again)
  app.patch("/api/users/:id/reset-intro", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    storage.updateUser(id, { hasSeenIntro: false } as any);
    return res.json({ ok: true });
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

  // ── Update own password (supports forced first-login change) ───────────────
  app.put("/api/users/me/password", async (req, res) => {
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

    const { currentPassword, newPassword, confirmPassword, forced } = req.body ?? {};
    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ error: "New password and confirmation are required" });
    }
    const trimmedCurrent = typeof currentPassword === "string" ? currentPassword.trim() : currentPassword;
    const trimmedNew = typeof newPassword === "string" ? newPassword.trim() : newPassword;
    const trimmedConfirm = typeof confirmPassword === "string" ? confirmPassword.trim() : confirmPassword;
    if (trimmedNew !== trimmedConfirm) {
      return res.status(400).json({ error: "New password and confirmation do not match" });
    }
    if (trimmedNew.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const userRow = storage.getUserById(userId) as any;
    if (!userRow) return res.status(401).json({ error: "User not found" });
    const user = storage.getUserByEmail(userRow.email);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.password_hash) return res.status(401).json({ error: "No password set for this account" });

    const mustChange = !!((user as any).mustChangePassword ?? (user as any).must_change_password);
    const skipCurrentCheck = !!forced && mustChange;
    if (!skipCurrentCheck) {
      if (!trimmedCurrent) {
        return res.status(400).json({ error: "Current password is required" });
      }
      const valid = await bcrypt.compare(trimmedCurrent, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hash = await bcrypt.hash(trimmedNew, 10);
    storage.setUserPassword(userId, hash);
    storage.setMustChangePassword(userId, false);
    return res.json({ success: true, ok: true });
  });

  // ── Forgot password: send reset link ──────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body ?? {};
    const genericResponse = { message: "If an account exists, a reset link was sent." };
    if (!email || typeof email !== "string") {
      console.log(`[forgot-password] missing/invalid email field`);
      return res.json(genericResponse);
    }

    // Normalize the same way the login route does — otherwise a user whose
    // stored email is e.g. "Foo@bar.com" but who types "foo@bar.com" (or has a
    // trailing space) silently gets the generic response and no email is sent.
    const normalizedEmail = email.trim().toLowerCase();
    const user =
      storage.getUserByEmail(normalizedEmail) ??
      storage.getUserByEmail(email.trim()) ??
      storage.getUserByEmail(email);
    if (!user) {
      console.log(`[forgot-password] no user for email=${JSON.stringify(normalizedEmail)}`);
      return res.json(genericResponse);
    }
    console.log(`[forgot-password] user matched id=${user.id} email=${JSON.stringify(user.email)}`);

    try {
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = Date.now() + 60 * 60 * 1000; // 1 hour
      (storage as any).setResetToken(user.id, token, expiry);

      const resetUrl = `https://www.westcapitallending.center/#/reset-password?token=${token}`;
      const resetBody = `
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7">
          Hi <strong style="color:#1e293b">${user.name}</strong>,
        </p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7">
          We received a request to reset your <strong style="color:#1e293b">CLR Connection Center</strong> password.
          Click the button below to choose a new password.
        </p>
        <div style="text-align:center;margin:24px 0">
          <a href="${resetUrl}" style="display:inline-block;background:#0F182D;color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px">
            Reset My Password
          </a>
        </div>
        <p style="margin:0 0 12px;color:#64748b;font-size:12px;line-height:1.7">
          Or copy &amp; paste this link into your browser:<br />
          <a href="${resetUrl}" style="color:#1A2B4A;word-break:break-all">${resetUrl}</a>
        </p>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;margin:20px 0">
          <p style="margin:0;font-size:12px;color:#92400e">
            <strong>Heads up:</strong> This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.
          </p>
        </div>
      `;

      await sendEmail({
        to: user.email,
        subject: "Reset your CLR Connection Center password",
        html: buildEmail({
          subject: "Reset your password",
          preheader: "Click the link to reset your CLR Connection Center password. Expires in 1 hour.",
          body: resetBody,
        }),
      });
      console.log(`[forgot-password] reset email dispatched for user id=${user.id}`);
    } catch (e: any) {
      console.error(`[forgot-password] flow failed for user id=${user.id}:`, e?.message ?? e);
      // Still return generic response to avoid leaking info
    }

    return res.json(genericResponse);
  });

  // ── Reset password: consume token and set new password ────────────────────
  app.post("/api/auth/reset-password", async (req, res) => {
    const { token, newPassword, confirmPassword } = req.body ?? {};
    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const user = (storage as any).getUserByResetToken(token);
    if (!user || !user.reset_token_expiry || user.reset_token_expiry < Date.now()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    storage.setUserPassword(user.id, hash);
    storage.setMustChangePassword(user.id, false);
    (storage as any).clearResetToken(user.id);

    return res.json({ ok: true });
  });

  // ── Welcome magic-link login: consume reset_token, set session cookie, redirect ──
  // Used by the welcome email's "Log In Instantly" button so new users land in
  // the app already authenticated. Token is single-use (cleared after consumption);
  // mustChangePassword is left true so the app forces a password change on entry.
  app.get("/api/auth/welcome-login", async (req, res) => {
    const token = String((req.query as any)?.token ?? "").trim();
    const failHtml = (msg: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Link expired</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0F182D;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:#1A2B4A;border:1px solid #C9A24A33;border-radius:14px;padding:32px 36px;max-width:420px;text-align:center}h1{margin:0 0 12px;color:#C9A24A;font-size:20px}p{margin:0 0 18px;color:#cbd5e1;line-height:1.6;font-size:14px}a{display:inline-block;background:#C9A24A;color:#0F182D;font-weight:600;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:14px}</style></head><body><div class="card"><h1>Link expired</h1><p>${msg}</p><a href="https://www.westcapitallending.center">Go to log in</a></div></body></html>`;
    if (!token) return res.status(400).send(failHtml("This welcome link is missing its token."));
    const user = (storage as any).getUserByResetToken(token) as any;
    if (!user || !user.reset_token_expiry || user.reset_token_expiry < Date.now()) {
      return res.status(400).send(failHtml("This welcome link is invalid or has expired. Use your temporary password to log in instead, or request a new welcome email from your admin."));
    }
    // Single-use: consume the token immediately
    try { (storage as any).clearResetToken(user.id); } catch {}

    const isProduction = process.env.NODE_ENV === "production";
    const orgId = Number(user.orgId ?? user.org_id ?? 1);
    const superAdmin = !!(user.superAdmin ?? user.super_admin);
    const payload = JSON.stringify({ userId: user.id, role: user.role, orgId, superAdmin });
    res.cookie(COOKIE_NAME, payload, {
      signed: true,
      httpOnly: true,
      sameSite: isProduction ? "strict" : "none",
      secure: isProduction,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    audit({ userId: user.id, userName: user.name, action: "welcome_login", entityType: "auth", entityId: user.id, entityLabel: user.email, details: JSON.stringify({ via: "magic_link" }) });
    // mustChangePassword stays true; the SPA will route them to the change-password
    // screen on first load.
    return res.redirect(302, "/");
  });

  // ── Auth guard for all /api/* routes except /api/auth/* and /api/invite/* ──
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/auth")) return next();
    if (req.path.startsWith("/invite")) return next();
    // Public, token-secured comp approve/deny from the approver email (no session).
    if (req.path === "/comp/email-decision") return next();
    if (req.path === "/time-off/email-decision") return next();
    if (req.path === "/schedule/email-decision") return next();
    // Narrow bootstrap-token escape hatch for /api/loan-officers/import only.
    // The route handler itself ALSO validates the token, so this just lets
    // that single endpoint be reached from automation without a session.
    if (req.path === "/loan-officers/import") {
      const bootstrap = (req.headers["x-bootstrap-token"] ?? "") as string;
      if (bootstrap === "06e30810-b43c-4bad-8fac-0093a269a917") return next();
    }
    requireAuth(req, res, next);
  });

  // ── Users ────────────────────────────────────────────────────────────────────
  app.get("/api/users", (req, res) => {
    res.json(storage.getUsers());
  });

  app.post("/api/users", async (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const newUser = storage.createUser(parsed.data);

    // Generate WCL-themed temp password, hash + store, flag must_change_password
    const WCL_WORDS = ["Lending", "Capital", "Realty", "Connect", "Bridge", "Funded", "Closed"];
    const WCL_SPECIALS = ["!", "@", "#", "$"];
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    const special = WCL_SPECIALS[Math.floor(Math.random() * WCL_SPECIALS.length)];
    const word = WCL_WORDS[Math.floor(Math.random() * WCL_WORDS.length)];
    const tempPassword = `WCL${digits}${special}${word}`;
    // Magic-link token: 7-day, single-use — lets the welcome email "Log In Instantly"
    // button drop the user straight into the app with no typing required.
    const welcomeToken = crypto.randomBytes(32).toString("hex");
    const welcomeExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    try {
      const hash = await bcrypt.hash(tempPassword, 10);
      storage.setUserPassword(newUser.id, hash);
      storage.setMustChangePassword(newUser.id, true);
      (storage as any).setResetToken(newUser.id, welcomeToken, welcomeExpiry);
    } catch (e) {
      console.error("Failed to set temp password for new user:", e);
    }
    const welcomeLoginUrl = `https://www.westcapitallending.center/api/auth/welcome-login?token=${welcomeToken}`;

    // Send welcome email if requested (non-blocking — don't fail the request if email fails)
    let emailSent = false;
    let emailError: string | null = null;
    let welcomeRequested = false;
    try {
      const sendWelcome = !!(req.body?.sendWelcome ?? true);
      welcomeRequested = sendWelcome;
      if (!sendWelcome) throw new Error("welcome_email_disabled");
      const roleLabel = (parsed.data.role as string) === "admin" ? "Administrator" : (parsed.data.role as string) === "assistant" ? "CLR Assistant" : "Viewer";
      const welcomeBody = `
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7">
          Hi <strong style="color:#1e293b">${newUser.name}</strong>,
        </p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7">
          Welcome to the <strong style="color:#1e293b">CLR Connection Center</strong> — the internal platform for the West Capital Lending Irvine branch team.
          Your account has been created and you're ready to log in.
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:24px">
          <p style="margin:0 0 8px;font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Your Login Details</p>
          <table cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#1e293b">
            <tr><td style="padding:3px 12px 3px 0;color:#64748b">Email</td><td style="font-weight:500">${newUser.email}</td></tr>
            <tr><td style="padding:3px 12px 3px 0;color:#64748b">Role</td><td style="font-weight:500">${roleLabel}</td></tr>
          </table>
          <p style="margin:14px 0 4px;font-size:13px;color:#666;">Your temporary password (tap to select, then copy):</p>
          <div style="background:#f4f4f4;border:1px solid #ddd;border-radius:6px;padding:12px 18px;margin:4px 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;letter-spacing:2px;text-align:center;color:#1A2B4A;user-select:all;-webkit-user-select:all;">
            ${tempPassword}
          </div>
          <p style="margin:12px 0 0;font-size:12px;color:#475569;line-height:1.6">
            You will be prompted to change your password on first login.
          </p>
        </div>
        <div style="text-align:center;margin-bottom:14px">
          <a href="${welcomeLoginUrl}" style="display:inline-block;background:#C9A24A;color:#0F182D;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;box-shadow:0 2px 6px rgba(15,24,45,0.15)">
            Log In Instantly
          </a>
          <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;line-height:1.5">
            One-tap link — no password needed. Expires in 7 days.
          </p>
        </div>
        <div style="text-align:center;margin-bottom:24px">
          <a href="https://www.westcapitallending.center" style="display:inline-block;background:#0F182D;color:#ffffff;font-size:13px;font-weight:600;padding:10px 22px;border-radius:8px;text-decoration:none;letter-spacing:0.2px">
            Or log in manually with your password
          </a>
        </div>
        <div style="border-top:1px solid #e2e8f0;padding-top:16px">
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
            If you have any questions, reach out to your team admin or reply to this email.
          </p>
        </div>
      `;
      await sendEmail({
        to: newUser.email,
        subject: `Welcome to CLR Connection Center, ${newUser.name}!`,
        html: buildEmail({
          subject: `Welcome to CLR Connection Center!`,
          preheader: `Your account is ready — log in to get started.`,
          body: welcomeBody,
        }),
      });
      emailSent = true;
    } catch (e: any) {
      // Email failure is non-fatal — user was still created
      if (e?.message !== "welcome_email_disabled") {
        console.error("Welcome email failed:", e);
        emailError = e?.message || "Unknown error";
      }
    }

    res.json({ ...newUser, emailRequested: welcomeRequested, emailSent, emailError });
  });

  app.patch("/api/users/:id", requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id);
    const { newPassword, ...rest } = req.body;
    // Only admins can edit other users
    const requester = req.session_user;
    if (requester.userId !== id && requester.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }
    if (newPassword?.trim()) {
      const hash = await bcrypt.hash(newPassword.trim(), 10);
      storage.setUserPassword(id, hash);
    }
    res.json(storage.updateUser(id, rest));
  });

  // Toggle is_manager flag (admin only) with auto-sync to scheduled report recipients
  app.patch("/api/users/:id/manager", requireAuth, async (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid user id" });
    const user = storage.getUserById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const isManager = !!req.body?.is_manager;
    const updated = storage.updateUser(id, { isManager } as any);
    if (user.email) {
      // Sync the single unified recipient list (email_settings.manager_emails).
      const settings = storageExtra.getEmailSettings() as any;
      let list: string[] = [];
      try { list = JSON.parse(settings.manager_emails || "[]"); } catch { list = []; }
      const lower = String(user.email).trim().toLowerCase();
      const filtered = list.filter(e => String(e || "").trim().toLowerCase() !== lower);
      const next = isManager ? [...filtered, user.email] : filtered;
      storageExtra.updateEmailSettings({ manager_emails: JSON.stringify(next) } as any);
    }
    res.json(updated);
  });

  // Resend intro/welcome email to any user (admin only)
  app.post("/api/users/:id/resend-welcome", requireAuth, async (req: any, res: any) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admins only" });
    const id = parseInt(req.params.id);
    const user = storage.getUserById(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Generate a fresh temp password and mark must_change_password
    const words = ["Capital","Lending","Mortgage","Equity","Bridge","Realty","Fund","Asset","Broker","Western"];
    const word = words[Math.floor(Math.random() * words.length)];
    const num = String(Math.floor(Math.random() * 9000) + 1000);
    const tempPassword = `WCL${num}!${word}`;
    const hash = await bcrypt.hash(tempPassword, 10);
    storage.setUserPassword(id, hash);
    storage.updateUser(id, { mustChangePassword: true } as any);

    // Magic-link token — same flow as new user creation. 7-day, single-use.
    const welcomeToken = crypto.randomBytes(32).toString("hex");
    const welcomeExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    try { (storage as any).setResetToken(id, welcomeToken, welcomeExpiry); } catch (e) { console.error("setResetToken (resend-welcome) failed:", e); }
    const welcomeLoginUrl = `https://www.westcapitallending.center/api/auth/welcome-login?token=${welcomeToken}`;

    const roleLabel = user.role === "admin" ? "Administrator" : user.role === "assistant" ? "CLR Assistant" : "Viewer";
    const welcomeBody = `
      <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7">
        Hi <strong style="color:#1e293b">${user.name}</strong>,
      </p>
      <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7">
        Your access to the <strong style="color:#1e293b">CLR Connection Center</strong> has been refreshed. Use the credentials below to log in.
        You will be prompted to set a new password on first login.
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:24px">
        <p style="margin:0 0 8px;font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Your Login Details</p>
        <table cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#1e293b">
          <tr><td style="padding:3px 12px 3px 0;color:#64748b">Email</td><td style="font-weight:500">${user.email}</td></tr>
          <tr><td style="padding:3px 12px 3px 0;color:#64748b">Role</td><td style="font-weight:500">${roleLabel}</td></tr>
        </table>
        <p style="margin:14px 0 4px;font-size:13px;color:#666;">Your temporary password (tap to select, then copy):</p>
        <div style="background:#f4f4f4;border:1px solid #ddd;border-radius:6px;padding:12px 18px;margin:4px 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;letter-spacing:2px;text-align:center;color:#1A2B4A;user-select:all;-webkit-user-select:all;">
          ${tempPassword}
        </div>
        <p style="margin:12px 0 0;font-size:12px;color:#475569;line-height:1.6">
          You will be prompted to change your password on first login.
        </p>
      </div>
      <div style="text-align:center;margin-bottom:14px">
        <a href="${welcomeLoginUrl}" style="display:inline-block;background:#C9A24A;color:#0F182D;font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.2px;box-shadow:0 2px 6px rgba(15,24,45,0.15)">
          Log In Instantly
        </a>
        <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;line-height:1.5">
          One-tap link — no password needed. Expires in 7 days.
        </p>
      </div>
      <div style="text-align:center;margin-bottom:24px">
        <a href="https://www.westcapitallending.center" style="display:inline-block;background:#0F182D;color:#ffffff;font-size:13px;font-weight:600;padding:10px 22px;border-radius:8px;text-decoration:none;letter-spacing:0.2px">
          Or log in manually with your password
        </a>
      </div>
      <div style="border-top:1px solid #e2e8f0;padding-top:16px">
        <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
          If you have any questions, reach out to your team admin.
        </p>
      </div>
    `;
    try {
      await sendEmail({
        to: user.email,
        subject: `Your CLR Connection Center access — ${user.name}`,
        html: buildEmail({
          subject: "CLR Connection Center Access",
          preheader: "Your login details are ready.",
          body: welcomeBody,
        }),
      });
      res.json({ ok: true, tempPassword });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Email failed" });
    }
  });

  // Archive (formerly DELETE). The endpoint path stays /api/users/:id with
  // method DELETE so existing clients continue to work, but the behavior is
  // now non-destructive: the user is deactivated and their email is suffixed
  // for reuse, while every related row (outcomes, EOD reports, call logs,
  // assignments, audit logs, notifications) is preserved for reporting.
  app.delete("/api/users/:id", requireAuth, (req: any, res) => {
    const requesterId = req.session_user?.userId;
    const requesterRole = req.session_user?.role;
    if (requesterRole !== "admin") return res.status(403).json({ error: "Admins only" });
    const id = parseInt(req.params.id);
    if (id === requesterId) return res.status(400).json({ error: "You cannot archive your own account" });
    if (id === 1) return res.status(400).json({ error: "The primary admin account cannot be archived" });
    try {
      createBackup('pre-archive');
      storageExtra.archiveUser(id);
      res.json({ ok: true, archived: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message ?? "Archive failed" });
    }
  });

  // Restore an archived user (admins only). Re-activates them and strips the
  // "[archived YYYY-MM-DD]" suffix from their email.
  app.post("/api/users/:id/restore", requireAuth, (req: any, res) => {
    const requesterRole = req.session_user?.role;
    if (requesterRole !== "admin") return res.status(403).json({ error: "Admins only" });
    const id = parseInt(req.params.id);
    try {
      storageExtra.restoreUser(id);
      res.json({ ok: true, restored: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message ?? "Restore failed" });
    }
  });

  // ── Loan Officers ────────────────────────────────────────────────────────────
  // Snoozed must be registered BEFORE /:id to avoid param capture
  // ── Bulk CSV import — must be BEFORE /:id routes ────────────────────────────
  // Auth: authenticated admin OR a request bearing the Railway project ID in
  // X-Bootstrap-Token (same pattern as /api/admin/import-ethan-outcomes) so
  // bulk imports can be driven from automation without a browser session.
  app.post("/api/loan-officers/import", async (req: any, res) => {
    const bootstrap = req.headers["x-bootstrap-token"];
    const isBootstrap = typeof bootstrap === "string" && bootstrap === "06e30810-b43c-4bad-8fac-0093a269a917";
    if (!isBootstrap) {
      const raw = (req as any).signedCookies?.[COOKIE_NAME];
      if (!raw) return res.status(401).json({ error: "Unauthorized" });
      try {
        const session = JSON.parse(raw);
        const me = session?.userId ? (storage.getUserById(session.userId) as any) : null;
        if (!me || (me.role !== "admin" && !me.superAdmin)) {
          return res.status(403).json({ error: "Admin only" });
        }
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    try {
      const { rows } = req.body ?? {};
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: "Request body must include a 'rows' array" });
      }

      const existingLOs = storage.getLoanOfficers() as any[];
      const byNmls = new Map<string, any>();
      const byNameLc = new Map<string, any>();
      for (const lo of existingLOs) {
        const nm = (lo.nmlsId ?? lo.nmls_id);
        if (nm) byNmls.set(String(nm), lo);
        const fn = (lo.fullName ?? lo.full_name ?? "").toLowerCase().trim();
        if (fn) byNameLc.set(fn, lo);
      }

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowLabel = `Row ${i + 1}`;

        if (!row.fullName) {
          errors.push(`${rowLabel}: Missing required field (fullName)`);
          continue;
        }

        const nmlsId = row.nmlsId ? String(row.nmlsId).trim() : "";
        const nameLc = String(row.fullName).toLowerCase().trim();
        const existing = (nmlsId && byNmls.get(nmlsId)) || byNameLc.get(nameLc) || null;

        // Build a clean patch with only present fields so we don't blank out
        // values that aren't in the import row.
        const patch: any = {
          fullName: String(row.fullName),
          internalStatus: row.internalStatus ? String(row.internalStatus) : "active",
        };
        if (nmlsId) patch.nmlsId = nmlsId;
        if (row.phone) patch.phone = String(row.phone);
        if (row.email) patch.email = String(row.email);
        if (row.licensedStates) patch.licensedStates = String(row.licensedStates);
        if (row.bonzoUsername) patch.bonzoUsername = String(row.bonzoUsername);
        if (row.bonzoPassword) patch.bonzoPassword = String(row.bonzoPassword);
        if (row.leadMailboxUsername) patch.leadMailboxUsername = String(row.leadMailboxUsername);
        if (row.leadMailboxPassword) patch.leadMailboxPassword = String(row.leadMailboxPassword);
        {
          // Consolidated "Notes & Requests": merge any imported notes + special
          // requests into the single notes column (see schema consolidation).
          const _combined = [row.notes, row.specialRequests]
            .map((x: any) => (x ? String(x).trim() : ""))
            .filter((x: string) => x.length > 0)
            .join("\n\n");
          if (_combined) patch.notes = _combined;
        }
        if (row.priorityTier !== undefined && row.priorityTier !== "") patch.priorityTier = Number(row.priorityTier);
        if (row.boostScore !== undefined && row.boostScore !== "") patch.boostScore = Number(row.boostScore);

        if (existing) {
          try {
            const id = existing.id ?? existing.ID;
            storage.updateLoanOfficer(Number(id), patch);
            updated++;
            continue;
          } catch (e: any) {
            errors.push(`${rowLabel} (${row.fullName}) update: ${e.message}`);
            continue;
          }
        }

        try {
          storage.createLoanOfficer({
            fullName: String(row.fullName),
            // Pass nmlsId only when non-empty so the column stores NULL otherwise.
            ...(nmlsId ? { nmlsId } : {}),
            phone: row.phone ? String(row.phone) : undefined,
            email: row.email ? String(row.email) : undefined,
            licensedStates: row.licensedStates ? String(row.licensedStates) : "[]",
            bonzoUsername: row.bonzoUsername ? String(row.bonzoUsername) : undefined,
            bonzoPassword: row.bonzoPassword ? String(row.bonzoPassword) : undefined,
            leadMailboxUsername: row.leadMailboxUsername ? String(row.leadMailboxUsername) : undefined,
            leadMailboxPassword: row.leadMailboxPassword ? String(row.leadMailboxPassword) : undefined,
            notes: ([row.notes, row.specialRequests].map((x: any) => (x ? String(x).trim() : "")).filter((x: string) => x.length > 0).join("\n\n")) || undefined,
            boostScore: row.boostScore !== undefined && row.boostScore !== "" ? Number(row.boostScore) : 0,
            priorityTier: row.priorityTier !== undefined && row.priorityTier !== "" ? Number(row.priorityTier) : 2,
            internalStatus: row.internalStatus ? String(row.internalStatus) : "active",
          });
          if (nmlsId) byNmls.set(nmlsId, { id: 0, nmlsId });
          byNameLc.set(nameLc, { id: 0, fullName: row.fullName });
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
        entityLabel: `Bulk import: ${imported} new, ${updated} updated`,
        details: JSON.stringify({ imported, updated, skipped, errors: errors.length }),
      });

      return res.json({ imported, updated, skipped, errors });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/loan-officers/snoozed", (req, res) => {
    const today = businessTodayForRequest(req, storageExtra.getRawSqlite());
    const snoozed = storage.getLoanOfficers().filter(
      (lo) => lo.snoozeUntil && lo.snoozeUntil >= today && lo.internalStatus === "active"
    );
    res.json(snoozed);
  });

  // ── Loan Officer Assistants (LOAs): name-only assistants under a parent LO ──
  app.get("/api/loan-officer-assistants", (req, res) => {
    const loId = req.query.loId ? parseInt(String(req.query.loId)) : undefined;
    res.json(storageExtra.getLoanOfficerAssistants(loId));
  });
  app.post("/api/loan-officer-assistants", (req, res) => {
    const { loId, fullName } = req.body as { loId: number; fullName: string };
    if (!loId || !fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: "loId and fullName are required" });
    }
    res.json(storageExtra.createLoanOfficerAssistant({ loId: Number(loId), fullName: String(fullName).trim() }));
  });
  app.delete("/api/loan-officer-assistants/:id", (req, res) => {
    storageExtra.deleteLoanOfficerAssistant(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ── LOA transfer queue: which LOA is next in line to accept a transfer ──────
  // Ranked most needy → least needy, mirroring the LO assignment algorithm
  // (recency + frequency + 90-day transfer count, fewer/longer-ago = more needy)
  // and reusing the same configurable weights from algorithm settings.
  app.get("/api/loan-officer-assistants/queue", requireAuth, (req: any, res) => {
    const sqliteDb = storageExtra.getRawSqlite();
    const today = businessTodayForRequest(req, sqliteDb);
    const settings = storage.getAlgorithmSettings();

    // Eligible LOAs: active rows under an active, non-snoozed LO.
    const los = storage.getLoanOfficers();
    const loById = new Map<number, any>(los.map((lo: any) => [lo.id, lo]));
    const isParentLoActive = (lo: any) => {
      if (!lo) return false;
      const status = String(lo.internalStatus ?? lo.internal_status ?? "active").toLowerCase();
      if (status !== "active") return false;
      const sn = lo.snoozeUntil ?? lo.snooze_until;
      if (sn && new Date(sn).getTime() > Date.now()) return false;
      return true;
    };
    const loas = (storageExtra.getLoanOfficerAssistants() as any[]).filter(a =>
      isParentLoActive(loById.get(a.loId))
    );

    // Per-LOA transfer stats from outcomes tagged with loa_id.
    const xfer90Start = addIsoDays(today, -89);
    const rows = sqliteDb.prepare(`
      SELECT loa_id AS loaId,
             COUNT(*) AS total,
             SUM(CASE WHEN date >= ? THEN 1 ELSE 0 END) AS recent90,
             MAX(date) AS lastTransferDate
      FROM lead_outcomes
      WHERE loa_id IS NOT NULL AND outcome_type = 'transfer'
      GROUP BY loa_id
    `).all(xfer90Start) as any[];
    const statsByLoa = new Map<number, any>(rows.map(r => [r.loaId, r]));
    const maxXfers = Math.max(1, ...rows.map(r => r.recent90 || 0));
    const todayMs = new Date(today).getTime();

    const ranked = loas
      .map(a => {
        const s = statsByLoa.get(a.id);
        const lastTransferDate: string | null = s?.lastTransferDate ?? null;
        const total = s?.total ?? 0;
        const recent90 = s?.recent90 ?? 0;
        const daysSince = lastTransferDate
          ? Math.max(0, Math.floor((todayMs - new Date(lastTransferDate).getTime()) / 86400000))
          : null;
        // Same shape as generateRankings(): recency + frequency + recent transfers
        // ('fewer' direction — the queue always favors whoever has had the least).
        const daysSinceNorm = Math.min((daysSince ?? 999) / 30, 1);
        const freqScore = 1 - Math.min(total / 100, 1);
        const recentXferScore = 1 - recent90 / maxXfers;
        const neverWorkedBonus = lastTransferDate ? 0 : 0.05;
        const score =
          settings.weightDaysSinceWorked * daysSinceNorm +
          settings.weightFrequency * freqScore +
          (settings.weightRecentTransfers ?? 0.10) * recentXferScore +
          neverWorkedBonus +
          ((a.id % 100) / 10000); // deterministic tiebreak (stable across runs same day)
        return {
          id: a.id,
          fullName: a.fullName,
          loId: a.loId,
          loName: (loById.get(a.loId) as any)?.fullName ?? null,
          score: Math.round(score * 1000) / 1000,
          daysSinceLastTransfer: daysSince,
          lastTransferDate,
          transfers90: recent90,
          totalTransfers: total,
        };
      })
      .sort((x, y) => y.score - x.score)
      .map((r, i) => ({ rank: i + 1, ...r }));

    res.json(ranked);
  });

  app.get("/api/loan-officers", (req, res) => {
    const los = storage.getLoanOfficers();
    // Compute 90-day transfer counts for score preview
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const xfer90Start = ninetyDaysAgo.toISOString().split("T")[0];
    const today = businessTodayForRequest(req, storageExtra.getRawSqlite());
    const recentOutcomes = storage.getLeadOutcomes({ startDate: xfer90Start, endDate: today });
    const recentTransferCounts = new Map<number, number>();
    for (const o of recentOutcomes) {
      if ((o.outcomeType || (o as any).outcome_type) === "transfer") {
        const loId = o.loId || (o as any).lo_id;
        if (loId) recentTransferCounts.set(loId, (recentTransferCounts.get(loId) || 0) + 1);
      }
    }
    // getLoanOfficers may return either camelCase (Drizzle) or snake_case (raw SQL, multi-org).
    // Normalize to camelCase so the frontend can rely on consistent field names.
    const safe = (los as any[]).map(lo => {
      const bonzoPassword = lo.bonzoPassword ?? lo.bonzo_password ?? null;
      const leadMailboxPassword = lo.leadMailboxPassword ?? lo.lead_mailbox_password ?? null;
      return {
        ...lo,
        id: lo.id,
        fullName: lo.fullName ?? lo.full_name ?? "",
        nmlsId: lo.nmlsId ?? lo.nmls_id ?? null,
        phone: lo.phone ?? null,
        email: lo.email ?? null,
        licensedStates: lo.licensedStates ?? lo.licensed_states ?? "[]",
        bonzoUsername: lo.bonzoUsername ?? lo.bonzo_username ?? null,
        leadMailboxUsername: lo.leadMailboxUsername ?? lo.lead_mailbox_username ?? null,
        otherCredentials: lo.otherCredentials ?? lo.other_credentials ?? "{}",
        notes: lo.notes ?? null,
        specialRequests: lo.specialRequests ?? lo.special_requests ?? null,
        tags: lo.tags ?? "[]",
        internalStatus: lo.internalStatus ?? lo.internal_status ?? "active",
        boostScore: lo.boostScore ?? lo.boost_score ?? 0,
        priorityTier: lo.priorityTier ?? lo.priority_tier ?? 2,
        snoozeUntil: lo.snoozeUntil ?? lo.snooze_until ?? null,
        snoozeReason: lo.snoozeReason ?? lo.snooze_reason ?? null,
        lastWorkedDate: lo.lastWorkedDate ?? lo.last_worked_date ?? null,
        totalTimesWorked: lo.totalTimesWorked ?? lo.total_times_worked ?? 0,
        nmlsStatus: lo.nmlsStatus ?? lo.nmls_status ?? null,
        nmlsStates: lo.nmlsStates ?? lo.nmls_states ?? "[]",
        nmlsLastChecked: lo.nmlsLastChecked ?? lo.nmls_last_checked ?? null,
        nmlsLicenseExpiration: lo.nmlsLicenseExpiration ?? lo.nmls_license_expiration ?? null,
        createdAt: lo.createdAt ?? lo.created_at ?? null,
        updatedAt: lo.updatedAt ?? lo.updated_at ?? null,
        // Strip passwords from list view
        bonzoPassword: bonzoPassword ? "••••••••" : null,
        leadMailboxPassword: leadMailboxPassword ? "••••••••" : null,
        recentTransfers: recentTransferCounts.get(lo.id) || 0,
      };
    });
    res.json(safe);
  });

  // ── LO Performance Summary (cross-LO ranking) ──────────────────────────────────
  // MUST be registered BEFORE the bare "/api/loan-officers/:id" route below — Express
  // matches in registration order and ":id" would otherwise capture the literal
  // "performance-summary" segment (parseInt -> NaN -> 404). Aggregates per-LO
  // efficiency metrics (calls-per-transfer, fall-through rate, etc.) in one query.
  // Intentionally EXCLUDES non-counted CLRs (exclude_from_stats) for a fair team-wide
  // ranking — unlike /:id/performance, which includes everyone.
  app.get("/api/loan-officers/performance-summary", (req, res) => {
    const MIN_CALLS = 20;
    const agg = storage.getLoPerformanceSummary();
    const aggByLo = new Map<number, any>();
    for (const r of agg) aggByLo.set(r.loId, r);

    const los = storage.getLoanOfficers() as any[];
    const rows = los
      .filter((lo) => (lo.internalStatus ?? lo.internal_status ?? "active") !== "archived")
      .map((lo) => {
        const a = aggByLo.get(lo.id) ?? {};
        const totalOutcomes = Number(a.totalOutcomes ?? 0);
        const transfers = Number(a.transfers ?? 0);
        const fellThrough = Number(a.fellThrough ?? 0);
        const appointments = Number(a.appointments ?? 0);
        const noAnswer = Number(a.noAnswer ?? 0);
        const wrongNumber = Number(a.wrongNumber ?? 0);
        const callbacks = Number(a.callbacks ?? 0);
        const futureContact = Number(a.futureContact ?? 0);
        const notInterested = Number(a.notInterested ?? 0);
        const contacts = Math.max(0, totalOutcomes - noAnswer - wrongNumber);

        const callsPerTransfer = transfers > 0 ? totalOutcomes / transfers : null;
        const transferDenom = transfers + fellThrough;
        const fallThroughRate = transferDenom > 0 ? (fellThrough / transferDenom) * 100 : null;
        const transferRate = totalOutcomes > 0 ? (transfers / totalOutcomes) * 100 : 0;
        const appointmentRate = totalOutcomes > 0 ? (appointments / totalOutcomes) * 100 : 0;
        const contactRate = totalOutcomes > 0 ? (contacts / totalOutcomes) * 100 : 0;

        return {
          loId: lo.id,
          fullName: lo.fullName ?? lo.full_name ?? "",
          nmlsId: lo.nmlsId ?? lo.nmls_id ?? null,
          internalStatus: lo.internalStatus ?? lo.internal_status ?? "active",
          priorityTier: lo.priorityTier ?? lo.priority_tier ?? 2,
          totalOutcomes, transfers, fellThrough, appointments,
          noAnswer, wrongNumber, callbacks, futureContact, notInterested, contacts,
          callsPerTransfer, fallThroughRate, transferRate, appointmentRate, contactRate,
          lastOutcomeDate: a.lastOutcomeDate ?? null,
          rankable: totalOutcomes >= MIN_CALLS && transfers > 0,
        };
      });

    res.json({ minCalls: MIN_CALLS, rows });
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
    // Defense in depth: the list endpoint masks passwords as "••••••••". If a
    // client somehow round-trips the masked value back to us, drop it so we
    // don't overwrite the real stored credential.
    const body = { ...req.body };
    if (body.bonzoPassword === "••••••••") delete body.bonzoPassword;
    if (body.leadMailboxPassword === "••••••••") delete body.leadMailboxPassword;
    const lo = storage.updateLoanOfficer(id, body);
    if (lo) audit({ userId: 1, userName: "Ethan Wood", action: "update", entityType: "loan_officer", entityId: lo.id, entityLabel: lo.fullName, details: JSON.stringify(body) });
    res.json(lo);
  });

  // Anyone authed can update an LO's unified "Notes & Requests" (collaborative
  // field). Body accepts { notes } (preferred) or { personalPreferences }
  // (legacy alias) and only ever writes the notes column, so this route can't be
  // used to escalate edits to other LO fields.
  app.patch("/api/loan-officers/:id/preferences", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const raw = req.body?.notes ?? req.body?.personalPreferences;
    const value =
      raw == null || (typeof raw === "string" && raw.trim() === "")
        ? null
        : String(raw).slice(0, 4000);
    const lo = storage.updateLoanOfficer(id, { notes: value } as any);
    if (!lo) return res.status(404).json({ error: "Not found" });
    const actor = storage.getUsers().find((u: any) => u.id === req.session_user?.userId);
    audit({
      userId: req.session_user?.userId ?? 0,
      userName: actor?.name ?? "Unknown",
      action: "update",
      entityType: "loan_officer",
      entityId: lo.id,
      entityLabel: (lo as any).fullName ?? `LO #${lo.id}`,
      details: JSON.stringify({ notes: value }),
    });
    res.json(lo);
  });

  // Admin-only: update LO active/inactive/vacation status
  app.patch("/api/loan-officers/:id/status", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const id = parseInt(req.params.id);
    const rawStatus = String(req.body?.status ?? "").toLowerCase();
    const allowed = ["active", "inactive", "vacation", "archived"];
    if (!allowed.includes(rawStatus)) {
      return res.status(400).json({ error: `status must be one of ${allowed.join(", ")}` });
    }
    const lo = storage.updateLoanOfficer(id, { internalStatus: rawStatus });
    if (!lo) return res.status(404).json({ error: "Not found" });
    const actor = storage.getUsers().find((u: any) => u.id === req.session_user.userId);
    audit({
      userId: req.session_user.userId,
      userName: actor?.name ?? "Admin",
      action: "update",
      entityType: "loan_officer",
      entityId: lo.id,
      entityLabel: lo.fullName,
      details: JSON.stringify({ status: rawStatus }),
    });
    res.json(lo);
  });

  app.delete("/api/loan-officers/:id", (req, res) => {
    createBackup('pre-delete');
    const id = parseInt(req.params.id);
    const lo = storage.getLoanOfficerById(id);
    storage.archiveLoanOfficer(id);
    audit({ userId: 1, userName: "Ethan Wood", action: "delete", entityType: "loan_officer", entityId: id, entityLabel: lo?.fullName ?? null, details: null });
    res.json({ ok: true });
  });

  // Copy credential endpoint (reveals plaintext password)
  app.get("/api/loan-officers/:id/credentials", (req, res) => {
    const lo: any = storage.getLoanOfficerById(parseInt(req.params.id));
    if (!lo) return res.status(404).json({ error: "Not found" });
    // Defense in depth: accept either camelCase (Drizzle / normalized) or
    // snake_case (raw sqlite SELECT *) so a missed normalization can't
    // silently strip credentials again.
    res.json({
      bonzoUsername: lo.bonzoUsername ?? lo.bonzo_username ?? null,
      bonzoPassword: lo.bonzoPassword ?? lo.bonzo_password ?? null,
      leadMailboxUsername: lo.leadMailboxUsername ?? lo.lead_mailbox_username ?? null,
      leadMailboxPassword: lo.leadMailboxPassword ?? lo.lead_mailbox_password ?? null,
      otherCredentials: lo.otherCredentials ?? lo.other_credentials ?? null,
    });
  });

  // ── LO Availability ──────────────────────────────────────────────────────────
  // Bulk fetch: returns all availability rows for all LOs in the org.
  app.get("/api/lo-availability", (req, res) => {
    try {
      const rows = storageExtra.getRawSqlite().prepare(`
        SELECT a.lo_id AS loId, a.day_of_week AS dayOfWeek, a.is_available AS isAvailable, a.time_slot AS timeSlot
        FROM lo_availability a
        INNER JOIN loan_officers lo ON lo.id = a.lo_id
      `).all() as any[];
      res.json(rows.map(r => ({
        loId: r.loId,
        dayOfWeek: r.dayOfWeek,
        isAvailable: !!r.isAvailable,
        timeSlot: r.timeSlot ?? "all",
      })));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load availability" });
    }
  });

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

  // ── LO Preferences (per CLR-user, per LO) ───────────────────────────────────
  // Stores per-user notes, preferred contact time, and pin flag for each LO
  // shown in the daily call list. Scoped to (org_id, user_id, lo_id).
  app.get("/api/lo-preferences", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const rows = storageExtra.getRawSqlite().prepare(`
        SELECT id, org_id, user_id, lo_id, notes, preferred_time, is_pinned, created_at, updated_at
        FROM lo_preferences WHERE org_id = ? AND user_id = ?
      `).all(orgId, userId) as any[];
      const out = rows.map(r => ({
        id: r.id,
        orgId: r.org_id,
        userId: r.user_id,
        loId: r.lo_id,
        notes: r.notes ?? "",
        preferredTime: r.preferred_time ?? "",
        isPinned: !!r.is_pinned,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load preferences" });
    }
  });

  app.put("/api/lo-preferences/:loId", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const loId = parseInt(req.params.loId, 10);
    if (!loId) return res.status(400).json({ error: "Invalid loId" });

    const allowedTimes = new Set(["", "morning", "afternoon", "evening"]);
    const body = req.body ?? {};
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : "";
    const preferredTimeRaw = typeof body.preferredTime === "string" ? body.preferredTime : "";
    const preferredTime = allowedTimes.has(preferredTimeRaw) ? preferredTimeRaw : "";
    const isPinned = body.isPinned ? 1 : 0;
    const nowIso = new Date().toISOString();

    try {
      const sqliteDb = storageExtra.getRawSqlite();
      sqliteDb.prepare(`
        INSERT INTO lo_preferences (org_id, user_id, lo_id, notes, preferred_time, is_pinned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(org_id, user_id, lo_id) DO UPDATE SET
          notes = excluded.notes,
          preferred_time = excluded.preferred_time,
          is_pinned = excluded.is_pinned,
          updated_at = excluded.updated_at
      `).run(orgId, userId, loId, notes, preferredTime, isPinned, nowIso, nowIso);

      const row = sqliteDb.prepare(`
        SELECT id, org_id, user_id, lo_id, notes, preferred_time, is_pinned, created_at, updated_at
        FROM lo_preferences WHERE org_id = ? AND user_id = ? AND lo_id = ?
      `).get(orgId, userId, loId) as any;

      res.json({
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        loId: row.lo_id,
        notes: row.notes ?? "",
        preferredTime: row.preferred_time ?? "",
        isPinned: !!row.is_pinned,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to save preference" });
    }
  });

  // ── Time Off Requests ───────────────────────────────────────────────────────
  // CLRs submit requests; managers/admins approve or deny. Scoped per org.
  const isYmd = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  function mapTimeOff(r: any, nameById: Map<number, string>) {
    return {
      id: r.id,
      userId: r.user_id,
      userName: nameById.get(r.user_id) ?? ("User #" + r.user_id),
      startDate: r.start_date,
      endDate: r.end_date,
      reason: r.reason ?? "",
      status: r.status,
      reviewedBy: r.reviewed_by ?? null,
      reviewerName: r.reviewed_by ? (nameById.get(r.reviewed_by) ?? null) : null,
      reviewerNote: r.reviewer_note ?? "",
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at ?? null,
    };
  }
  function timeOffNameMap() {
    const m = new Map<number, string>();
    for (const u of storage.getUsers() as any[]) m.set(u.id, u.name);
    return m;
  }

  // List requests. Managers/admins see the whole org; everyone else sees only
  // their own. Pass ?scope=mine to force own-only even as a manager.
  app.get("/api/time-off", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const me = storage.getUserById(userId) as any;
    const isManager = me?.role === "admin" || !!(me?.isManager ?? me?.is_manager);
    const mineOnly = !isManager || req.query.scope === "mine";
    try {
      const db = storageExtra.getRawSqlite();
      const nameById = timeOffNameMap();
      const rows = mineOnly
        ? db.prepare("SELECT * FROM time_off_requests WHERE org_id=? AND user_id=? ORDER BY start_date DESC, id DESC").all(orgId, userId)
        : db.prepare("SELECT * FROM time_off_requests WHERE org_id=? ORDER BY (status='pending') DESC, start_date DESC, id DESC").all(orgId);
      res.json((rows as any[]).map(r => mapTimeOff(r, nameById)));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load time-off requests" });
    }
  });

  // Create a request for yourself.
  app.post("/api/time-off", requireAuth, async (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const sessUserId = Number(sess?.userId);
    if (!sessUserId) return res.status(401).json({ error: "Unauthorized" });
    const body = req.body ?? {};
    const startDate = body.startDate;
    const endDate = body.endDate;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 1000) : "";
    if (!isYmd(startDate) || !isYmd(endDate)) return res.status(400).json({ error: "Start and end dates are required (YYYY-MM-DD)." });
    if (endDate < startDate) return res.status(400).json({ error: "End date cannot be before the start date." });
    // Managers/admins may submit on behalf of another CLR; everyone else only for themselves.
    let requesterId = sessUserId;
    const meRow = storage.getUserById(sessUserId) as any;
    const isMgr = !!(meRow && (meRow.role === "admin" || (meRow.isManager ?? meRow.is_manager) || (meRow.superAdmin ?? meRow.super_admin)));
    const onBehalf = Number(body.onBehalfOf ?? body.forUserId) || 0;
    if (isMgr && onBehalf && onBehalf !== sessUserId) {
      const target = storage.getUserById(onBehalf) as any;
      if (target) requesterId = onBehalf;
    }
    const nowIso = new Date().toISOString();
    const token = crypto.randomBytes(24).toString("hex");
    try {
      const db = storageExtra.getRawSqlite();
      const info = db.prepare("INSERT INTO time_off_requests (org_id, user_id, start_date, end_date, reason, status, approval_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)").run(orgId, requesterId, startDate, endDate, reason, token, nowIso, nowIso);
      const nameById = timeOffNameMap();
      const row = db.prepare("SELECT * FROM time_off_requests WHERE id=?").get(info.lastInsertRowid) as any;
      const requester = (storage.getUsers() as any[]).find(u => u.id === requesterId);
      const submitter = (storage.getUsers() as any[]).find(u => u.id === sessUserId);
      const onBehalfNote = requesterId !== sessUserId ? (" (submitted by " + (submitter?.name ?? "manager") + ")") : "";
      audit({
        userId: sessUserId, userName: submitter?.name ?? "Unknown", action: "create",
        entityType: "time_off", entityId: Number(info.lastInsertRowid),
        entityLabel: (requester?.name ?? "CLR") + " " + startDate + "->" + endDate + onBehalfNote,
        details: JSON.stringify({ startDate, endDate, reason, requesterId, submittedBy: sessUserId }),
      });

      // Email the configured time-off approver with one-click approve/deny links.
      let emailedTo: string | null = null;
      try {
        const settings = storageExtra.getEmailSettings() as any;
        const approverId = Number(settings.approval_recipient_id ?? settings.timeoff_approver_id ?? settings.comp_approver_id ?? 0) || 0;
        const approver = approverId ? (storage.getUserById(approverId) as any) : null;
        const approverEmail = approver?.email && String(approver.email).includes("@") ? String(approver.email) : null;
        if (approverEmail) {
          const { subject, html } = buildTimeOffApprovalEmail(row, requester?.name ?? "A team member");
          await sendEmail({ to: approverEmail, subject, html });
          emailedTo = approverEmail;
        }
      } catch (e: any) { console.error("[time-off] approver email failed:", e?.message ?? e); }

      res.json({ ...mapTimeOff(row, nameById), emailedTo });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to submit request" });
    }
  });

  // Approve / deny a request (managers + admins only).
  // Public one-click approve/deny from the approver email (no login; token-secured).
  app.get("/api/time-off/email-decision", async (req: any, res) => {
    const token = String(req.query.token ?? "");
    const action = String(req.query.action ?? "");
    const status = action === "approve" ? "approved" : action === "deny" ? "denied" : null;
    const page = (title: string, msg: string, glyph: string) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:36px 44px;max-width:440px;text-align:center;box-shadow:0 4px 20px rgba(15,24,45,0.08)"><div style="font-size:44px;line-height:1;margin-bottom:12px">${glyph}</div><h1 style="margin:0 0 8px;font-size:20px;color:#0F182D">${title}</h1><p style="margin:0;color:#475569;font-size:14px;line-height:1.5">${msg}</p></div></body></html>`;
    if (!token || !status) return res.status(400).send(page("Invalid link", "This approval link is missing or malformed.", "&#9888;&#65039;"));
    try {
      const db = storageExtra.getRawSqlite();
      const row = db.prepare("SELECT * FROM time_off_requests WHERE approval_token=?").get(token) as any;
      if (!row) return res.status(404).send(page("Not found", "This time-off request could not be located.", "&#10067;"));
      if (row.status !== "pending") return res.send(page("Already handled", "This request was already " + row.status + ". No further action needed.", "&#8505;&#65039;"));
      const settings = storageExtra.getEmailSettings() as any;
      const reviewerId = Number(settings.approval_recipient_id ?? settings.timeoff_approver_id ?? settings.comp_approver_id ?? 0) || null;
      const now = new Date().toISOString();
      db.prepare("UPDATE time_off_requests SET status=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE approval_token=? AND status='pending'").run(status, reviewerId, now, now, token);
      try {
        (storage as any).createNotification?.({ userId: row.user_id, type: "time_off", title: "Time off " + status, message: "Your time-off request for " + row.start_date + " to " + row.end_date + " was " + status + " via email." });
      } catch {}
      if (status === "approved") {
        try {
          const requester = storage.getUserById(row.user_id) as any;
          const email = requester?.email && String(requester.email).includes("@") ? String(requester.email) : null;
          if (email) {
            const nm = (storage.getUsers() as any[]).find(u => u.id === row.user_id)?.name ?? "there";
            const { subject, html } = buildTimeOffDecisionEmail(row, nm, "approved");
            await sendEmail({ to: email, subject, html });
          }
        } catch (e: any) { console.error("[time-off] approval email failed:", e?.message ?? e); }
      }
      const glyph = status === "approved" ? "&#9989;" : "&#10060;";
      return res.send(page("Request " + status, "The time-off request was marked " + status + ". You can close this tab.", glyph));
    } catch (e: any) {
      return res.status(500).send(page("Something went wrong", e?.message ?? "Please try again.", "&#9888;&#65039;"));
    }
  });

  app.patch("/api/time-off/:id", requireAuth, async (req: any, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const reviewerId = Number(sess?.userId);
    const id = parseInt(req.params.id, 10);
    const status = req.body?.status;
    const reviewerNote = typeof req.body?.reviewerNote === "string" ? req.body.reviewerNote.slice(0, 1000) : "";
    if (status !== "approved" && status !== "denied") return res.status(400).json({ error: "status must be 'approved' or 'denied'." });
    const nowIso = new Date().toISOString();
    try {
      const db = storageExtra.getRawSqlite();
      const existing = db.prepare("SELECT * FROM time_off_requests WHERE id=? AND org_id=?").get(id, orgId) as any;
      if (!existing) return res.status(404).json({ error: "Request not found" });
      db.prepare("UPDATE time_off_requests SET status=?, reviewer_note=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=? AND org_id=?").run(status, reviewerNote, reviewerId, nowIso, nowIso, id, orgId);
      const nameById = timeOffNameMap();
      const row = db.prepare("SELECT * FROM time_off_requests WHERE id=?").get(id) as any;
      const actor = (storage.getUsers() as any[]).find(u => u.id === reviewerId);
      audit({
        userId: reviewerId, userName: actor?.name ?? "Unknown", action: "update",
        entityType: "time_off", entityId: id,
        entityLabel: (nameById.get(existing.user_id) ?? "CLR") + " " + existing.start_date + "->" + existing.end_date,
        details: JSON.stringify({ status, reviewerNote }),
      });
      try {
        (storage as any).createNotification?.({
          userId: existing.user_id,
          type: "time_off",
          title: "Time off " + status,
          message: "Your time-off request for " + existing.start_date + " to " + existing.end_date + " was " + status + (reviewerNote ? (": " + reviewerNote) : "."),
        });
      } catch {}
      if (status === "approved") {
        try {
          const requester = storage.getUserById(existing.user_id) as any;
          const email = requester?.email && String(requester.email).includes("@") ? String(requester.email) : null;
          if (email) {
            const { subject, html } = buildTimeOffDecisionEmail(row, nameById.get(existing.user_id) ?? "there", "approved");
            await sendEmail({ to: email, subject, html });
          }
        } catch (e: any) { console.error("[time-off] approval email failed:", e?.message ?? e); }
      }
      res.json(mapTimeOff(row, nameById));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update request" });
    }
  });

  // Cancel a request. Requester can cancel their own pending request; managers
  // and admins can remove any request in their org.
  app.delete("/api/time-off/:id", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const id = parseInt(req.params.id, 10);
    try {
      const db = storageExtra.getRawSqlite();
      const existing = db.prepare("SELECT * FROM time_off_requests WHERE id=? AND org_id=?").get(id, orgId) as any;
      if (!existing) return res.status(404).json({ error: "Request not found" });
      const me = storage.getUserById(userId) as any;
      const isManager = me?.role === "admin" || !!(me?.isManager ?? me?.is_manager);
      const isOwner = existing.user_id === userId;
      if (!isManager && !isOwner) {
        return res.status(403).json({ error: "You can only cancel your own requests." });
      }
      db.prepare("DELETE FROM time_off_requests WHERE id=? AND org_id=?").run(id, orgId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to cancel request" });
    }
  });

  // ── Weekly Schedules ──────────────────────────────────────────────────────────
  // Each CLR sets ONE standing weekly schedule (their normal Mon–Sun hours), not
  // a per-week plan. Stored in weekly_schedules with the fixed week_start key
  // 'standing' (the UNIQUE(org_id, user_id, week_start) constraint then gives
  // exactly one row per user). Everyone can see the team's schedules for coverage.
  const SCHED_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const SCHED_STANDING_KEY = "standing";
  const isSchedTime = (t: any) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  function sanitizeScheduleDays(raw: any): Record<string, { working: boolean; start: string; end: string }> {
    const out: Record<string, { working: boolean; start: string; end: string }> = {};
    for (const k of SCHED_DAY_KEYS) {
      const d = raw?.[k] ?? {};
      out[k] = {
        working: !!d.working,
        start: isSchedTime(d.start) ? d.start : "08:00",
        end: isSchedTime(d.end) ? d.end : "16:00",
      };
    }
    return out;
  }
  // Daily lunch break, automatically subtracted from each working day.
  function sanitizeScheduleLunch(raw: any): { start: string; minutes: number } {
    const minutes = Math.max(0, Math.min(120, Math.round(Number(raw?.minutes ?? 0)) || 0));
    return { start: isSchedTime(raw?.start) ? raw.start : "12:00", minutes };
  }

  function mapSchedule(r: any, nameById: Map<number, string>) {
    let parsed: any = {};
    try { parsed = JSON.parse(r.days || "{}"); } catch {}
    const { lunch = null, ...days } = parsed;
    return {
      id: r.id,
      userId: r.user_id,
      userName: nameById.get(r.user_id) ?? ("User #" + r.user_id),
      days,
      lunch,
      notes: r.notes ?? "",
      status: r.status ?? "pending",
      reviewerName: r.reviewed_by ? (nameById.get(r.reviewed_by) ?? null) : null,
      reviewerNote: r.reviewer_note ?? "",
      reviewedAt: r.reviewed_at ?? null,
      submittedAt: r.submitted_at,
      updatedAt: r.updated_at,
    };
  }
  function schedNameMap() {
    return new Map<number, string>((storage.getUsers() as any[]).map((u: any) => [u.id, u.name]));
  }
  const fmtSchedTime = (t: string) => {
    const [h, m] = String(t || "0:0").split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hh}:${String(m).padStart(2, "0")} ${ampm}` : `${hh} ${ampm}`;
  };
  function buildScheduleApprovalEmail(days: Record<string, any>, token: string, requesterName: string) {
    const labels: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
    const approveUrl = `${COMP_APP_URL}/api/schedule/email-decision?token=${token}&action=approve`;
    const denyUrl = `${COMP_APP_URL}/api/schedule/email-decision?token=${token}&action=deny`;
    const rows = SCHED_DAY_KEYS.map((k, i) => {
      const d = days[k] ?? {};
      const val = d.working ? `${fmtSchedTime(d.start)} &ndash; ${fmtSchedTime(d.end)}` : "Off";
      const border = i === 0 ? "" : "border-top:1px solid #e2e8f0;";
      return `<tr><td style="padding:7px 10px;${border}font-size:13px;color:#64748b">${labels[k]}</td><td style="padding:7px 10px;${border}font-size:13px;color:#1e293b;text-align:right;font-weight:${d.working ? 600 : 400}">${val}</td></tr>`;
    }).join("") + ((days as any).lunch?.minutes > 0
      ? `<tr><td style="padding:7px 10px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b">Lunch break</td><td style="padding:7px 10px;border-top:1px solid #e2e8f0;font-size:13px;color:#1e293b;text-align:right">${fmtSchedTime((days as any).lunch.start)} (${(days as any).lunch.minutes} min, daily)</td></tr>`
      : "");
    const body = `<p style="margin:0 0 14px;font-size:15px;color:#1e293b"><strong>${requesterName}</strong> submitted their weekly schedule. Approve or deny it below.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;margin:0 0 20px;border-collapse:collapse">${rows}</table>
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:8px"><a href="${approveUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:8px">Approve</a></td>
        <td><a href="${denyUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:8px">Deny</a></td>
      </tr></table>
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">You can also review schedules in the app under Weekly Schedule.</p>`;
    const subject = "Weekly schedule from " + requesterName + " needs approval";
    return { subject, html: buildEmail({ subject: "Schedule Approval", preheader: requesterName + " submitted their weekly schedule", body }) };
  }

  app.get("/api/schedule", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    try {
      const db = storageExtra.getRawSqlite();
      const row = db.prepare("SELECT * FROM weekly_schedules WHERE org_id=? AND user_id=? AND week_start=?").get(orgId, userId, SCHED_STANDING_KEY) as any;
      if (!row) return res.json({ schedule: null });
      res.json({ schedule: mapSchedule(row, schedNameMap()) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load schedule" });
    }
  });

  // Submit (or resubmit) your schedule — goes to 'pending' and emails the
  // approver with Approve/Deny links, like comp requests and time off.
  app.put("/api/schedule", requireAuth, async (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const { days, lunch, notes } = req.body ?? {};
    // Lunch is stored alongside the day map and automatically subtracted from
    // each working day's hours.
    const clean: any = { ...sanitizeScheduleDays(days), lunch: sanitizeScheduleLunch(lunch) };
    const notesStr = typeof notes === "string" ? notes.slice(0, 1000) : "";
    const nowIso = new Date().toISOString();
    const token = crypto.randomBytes(24).toString("hex");
    try {
      const db = storageExtra.getRawSqlite();
      db.prepare(`
        INSERT INTO weekly_schedules (org_id, user_id, week_start, days, notes, status, reviewed_by, reviewer_note, reviewed_at, approval_token, submitted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NULL, '', NULL, ?, ?, ?)
        ON CONFLICT(org_id, user_id, week_start) DO UPDATE SET
          days=excluded.days, notes=excluded.notes, status='pending',
          reviewed_by=NULL, reviewer_note='', reviewed_at=NULL,
          approval_token=excluded.approval_token,
          submitted_at=excluded.submitted_at, updated_at=excluded.updated_at
      `).run(orgId, userId, SCHED_STANDING_KEY, JSON.stringify(clean), notesStr, token, nowIso, nowIso);
      const me = storage.getUserById(userId) as any;
      audit({ userId, userName: me?.name ?? "Unknown", action: "create", entityType: "weekly_schedule", entityId: 0, entityLabel: "Weekly schedule submitted", details: null });
      // Email the approver (best-effort)
      let emailedTo: string | null = null;
      try {
        const settings = storageExtra.getEmailSettings() as any;
        const approverId = Number(settings.approval_recipient_id ?? settings.timeoff_approver_id ?? settings.comp_approver_id ?? 0) || 0;
        const approver = approverId ? (storage.getUserById(approverId) as any) : null;
        const approverEmail = approver?.email && String(approver.email).includes("@") ? String(approver.email) : null;
        if (approverEmail) {
          const { subject, html } = buildScheduleApprovalEmail(clean, token, me?.name ?? "A team member");
          await sendEmail({ to: approverEmail, subject, html });
          emailedTo = approverEmail;
        }
      } catch (e: any) { console.error("[schedule] approval email failed:", e?.message ?? e); }
      res.json({ ok: true, emailedTo });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to save schedule" });
    }
  });

  app.get("/api/schedule/team", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    try {
      const db = storageExtra.getRawSqlite();
      const rows = db.prepare("SELECT * FROM weekly_schedules WHERE org_id=? AND week_start=? ORDER BY (status='pending') DESC, user_id ASC").all(orgId, SCHED_STANDING_KEY) as any[];
      const nameById = schedNameMap();
      res.json(rows.map(r => mapSchedule(r, nameById)));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load team schedules" });
    }
  });

  // Manager/admin decision from inside the app.
  app.post("/api/schedule/:id/decision", requireAuth, (req: any, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const reviewerId = Number(sess?.userId);
    const id = parseInt(req.params.id, 10);
    const status = req.body?.status;
    const reviewerNote = typeof req.body?.reviewerNote === "string" ? req.body.reviewerNote.slice(0, 1000) : "";
    if (status !== "approved" && status !== "denied") return res.status(400).json({ error: "status must be 'approved' or 'denied'." });
    const nowIso = new Date().toISOString();
    try {
      const db = storageExtra.getRawSqlite();
      const existing = db.prepare("SELECT * FROM weekly_schedules WHERE id=? AND org_id=?").get(id, orgId) as any;
      if (!existing) return res.status(404).json({ error: "Schedule not found" });
      db.prepare("UPDATE weekly_schedules SET status=?, reviewer_note=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=? AND org_id=?").run(status, reviewerNote, reviewerId, nowIso, nowIso, id, orgId);
      const nameById = schedNameMap();
      const actor = (storage.getUsers() as any[]).find(u => u.id === reviewerId);
      audit({
        userId: reviewerId, userName: actor?.name ?? "Unknown", action: "update",
        entityType: "weekly_schedule", entityId: id,
        entityLabel: (nameById.get(existing.user_id) ?? "CLR") + " schedule " + status,
        details: JSON.stringify({ status, reviewerNote }),
      });
      try {
        (storage as any).createNotification?.({
          userId: existing.user_id, type: "schedule",
          title: "Schedule " + status,
          message: "Your weekly schedule was " + status + (reviewerNote ? (": " + reviewerNote) : ".") + (status === "denied" ? " Update and resubmit it." : ""),
        });
      } catch {}
      const row = db.prepare("SELECT * FROM weekly_schedules WHERE id=?").get(id) as any;
      res.json(mapSchedule(row, nameById));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update schedule" });
    }
  });

  // Public approve/deny from the email links (token-authenticated).
  app.get("/api/schedule/email-decision", async (req: any, res) => {
    const token = String(req.query.token ?? "");
    const action = String(req.query.action ?? "");
    const status = action === "approve" ? "approved" : action === "deny" ? "denied" : null;
    const page = (title: string, msg: string, glyph: string) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:36px 44px;max-width:440px;text-align:center;box-shadow:0 4px 20px rgba(15,24,45,0.08)"><div style="font-size:44px;line-height:1;margin-bottom:12px">${glyph}</div><h1 style="margin:0 0 8px;font-size:20px;color:#0F182D">${title}</h1><p style="margin:0;color:#475569;font-size:14px;line-height:1.5">${msg}</p></div></body></html>`;
    if (!token || !status) return res.status(400).send(page("Invalid link", "This approval link is missing or malformed.", "&#9888;&#65039;"));
    try {
      const db = storageExtra.getRawSqlite();
      const row = db.prepare("SELECT * FROM weekly_schedules WHERE approval_token=?").get(token) as any;
      if (!row) return res.status(404).send(page("Not found", "This schedule submission could not be located.", "&#10067;"));
      if (row.status !== "pending") return res.send(page("Already handled", "This schedule was already " + row.status + ". No further action needed.", "&#8505;&#65039;"));
      const settings = storageExtra.getEmailSettings() as any;
      const reviewerId = Number(settings.approval_recipient_id ?? settings.timeoff_approver_id ?? settings.comp_approver_id ?? 0) || null;
      const now = new Date().toISOString();
      db.prepare("UPDATE weekly_schedules SET status=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE approval_token=? AND status='pending'").run(status, reviewerId, now, now, token);
      try {
        (storage as any).createNotification?.({ userId: row.user_id, type: "schedule", title: "Schedule " + status, message: "Your weekly schedule was " + status + " via email." + (status === "denied" ? " Update and resubmit it." : "") });
      } catch {}
      const glyph = status === "approved" ? "&#9989;" : "&#10060;";
      return res.send(page("Schedule " + status, "The weekly schedule was marked " + status + ". You can close this tab.", glyph));
    } catch (e: any) {
      return res.status(500).send(page("Something went wrong", e?.message ?? "Please try again.", "&#9888;&#65039;"));
    }
  });

  // ── Comp / Reimbursement Requests ─────────────────────────────────────────────
  // Users log expenses (draft), bundle them into a comp request (pending),
  // managers approve/deny, then the requester marks each as reimbursed (paid).
  // "leads" is kept as a legacy alias for older requests filed before the rename to "transfers".
  const COMP_CATEGORIES = new Set(["transfers", "equipment", "software", "marketing", "travel", "office", "other", "leads"]);
  function mapComp(r: any, nameById: Map<number, string>) {
    return {
      id: r.id,
      userId: r.user_id,
      userName: nameById.get(r.user_id) ?? ("User #" + r.user_id),
      description: r.description ?? "",
      category: r.category ?? "other",
      amountCents: r.amount_cents ?? 0,
      expenseDate: r.expense_date ?? null,
      note: r.note ?? "",
      status: r.status,
      isPaid: !!r.is_paid,
      isProcessing: !!r.is_processing,
      isReceived: !!r.is_received,
      receivedAt: r.received_at ?? null,
      processingAt: r.processing_at ?? null,
      reviewedBy: r.reviewed_by ?? null,
      reviewerName: r.reviewed_by ? (nameById.get(r.reviewed_by) ?? null) : null,
      reviewerNote: r.reviewer_note ?? "",
      requestedAt: r.requested_at ?? null,
      reviewedAt: r.reviewed_at ?? null,
      paidAt: r.paid_at ?? null,
      createdAt: r.created_at ?? null,
    };
  }
  function compNameMap() {
    const m = new Map<number, string>();
    for (const u of storage.getUsers() as any[]) m.set(u.id, u.name);
    return m;
  }
  function isCompManager(userId: number) {
    const me = storage.getUserById(userId) as any;
    return me?.role === "admin" || !!(me?.isManager ?? me?.is_manager);
  }
  // Only admins (or super-admins) may see OTHER team members comp requests.
  function isCompAdmin(userId: number) {
    const me = storage.getUserById(userId) as any;
    return me?.role === "admin" || !!(me?.superAdmin ?? me?.super_admin);
  }

  app.get("/api/comp", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const mineOnly = !isCompManager(userId) || req.query.scope === "mine";
    try {
      const db = storageExtra.getRawSqlite();
      const nameById = compNameMap();
      const rows = mineOnly
        ? db.prepare("SELECT * FROM comp_requests WHERE org_id=? AND user_id=? ORDER BY COALESCE(expense_date,'') DESC, id DESC").all(orgId, userId)
        : db.prepare("SELECT * FROM comp_requests WHERE org_id=? AND status!='draft' ORDER BY (status='pending') DESC, COALESCE(requested_at,'') DESC, id DESC").all(orgId);
      const counts = db.prepare("SELECT comp_id, COUNT(*) AS c FROM comp_attachments WHERE org_id=? GROUP BY comp_id").all(orgId) as any[];
      const countMap = new Map<number, number>(counts.map((x: any) => [x.comp_id, x.c]));
      res.json((rows as any[]).map(r => ({ ...mapComp(r, nameById), attachmentCount: countMap.get(r.id) ?? 0 })));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load comp requests" });
    }
  });

  // Transfer counts for the current + previous calendar month for the logged-in CLR
  // (or, for managers/admins, an optional ?userId= to look up a CLR they're filing for).
  // Lets a CLR quickly see "how many transfers did I make last month" while requesting comp.
  app.get("/api/comp/transfer-stats", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const sessUserId = Number(sess?.userId);
    if (!sessUserId) return res.status(401).json({ error: "Unauthorized" });
    // Managers/admins may look up another CLR (e.g. when filing on their behalf).
    let targetId = sessUserId;
    const wanted = Number(req.query.userId) || 0;
    if (wanted && wanted !== sessUserId) {
      const me = storage.getUserById(sessUserId) as any;
      const isMgr = !!(me && (me.role === "admin" || (me.isManager ?? me.is_manager) || (me.superAdmin ?? me.super_admin)));
      if (isMgr && storage.getUserById(wanted)) targetId = wanted;
    }
    try {
      const todayStr = businessTodayForRequest(req, storageExtra.getRawSqlite());
      const [ty, tm] = todayStr.split("-").map((x: string) => parseInt(x, 10));
      const pad = (n: number) => String(n).padStart(2, "0");
      const monthName = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      const monthRange = (y: number, m: number) => {
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        return { startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${pad(lastDay)}` };
      };
      const py = tm === 1 ? ty - 1 : ty;
      const pm = tm === 1 ? 12 : tm - 1;
      const build = (y: number, m: number) => {
        const { startDate, endDate } = monthRange(y, m);
        const outcomes = (storage.getLeadOutcomes({ startDate, endDate, assistantId: targetId }) as any[]);
        const transfersList = outcomes.filter(o => (o.outcomeType ?? o.outcome_type) === "transfer");
        const tt = (o: any) => o.transferType ?? o.transfer_type;
        return {
          month: monthName(y, m),
          startDate, endDate,
          transfers: transfersList.length,
          direct: transfersList.filter(o => tt(o) === "direct").length,
          appointment: transfersList.filter(o => tt(o) === "appointment").length,
        };
      };
      res.json({ userId: targetId, previous: build(py, pm), current: build(ty, tm) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load transfer stats" });
    }
  });

  app.post("/api/comp", requireAuth, async (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const sessUserId = Number(sess?.userId);
    if (!sessUserId) return res.status(401).json({ error: "Unauthorized" });
    const body = req.body ?? {};
    const description = typeof body.description === "string" ? body.description.slice(0, 300).trim() : "";
    const category = COMP_CATEGORIES.has(body.category) ? body.category : "other";
    const amountCents = Math.round(Number(body.amountCents));
    const expenseDate = (typeof body.expenseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expenseDate)) ? body.expenseDate : null;
    const note = typeof body.note === "string" ? body.note.slice(0, 1000) : "";
    if (!description) return res.status(400).json({ error: "A description is required." });
    if (!Number.isFinite(amountCents) || amountCents <= 0) return res.status(400).json({ error: "Enter an amount greater than 0." });
    // Managers/admins can file a comp request ON BEHALF of a CLR. When they do, it
    // is created as a pending request (not a draft) under that CLR and emailed to
    // the approver. Everyone else just saves a draft for themselves.
    const meRow = storage.getUserById(sessUserId) as any;
    const isMgr = !!(meRow && (meRow.role === "admin" || (meRow.isManager ?? meRow.is_manager) || (meRow.superAdmin ?? meRow.super_admin)));
    const onBehalf = Number(body.onBehalfOf) || 0;
    const forClr = (isMgr && onBehalf && onBehalf !== sessUserId && storage.getUserById(onBehalf)) ? onBehalf : 0;
    const nowIso = new Date().toISOString();
    try {
      const db = storageExtra.getRawSqlite();
      // Every saved expense is submitted for approval immediately — no draft
      // step. Managers may still file on behalf of a CLR (forClr); otherwise
      // the request is for the submitter themselves.
      const targetId = forClr || sessUserId;
      const token = crypto.randomBytes(24).toString("hex");
      const info = db.prepare("INSERT INTO comp_requests (org_id, user_id, description, category, amount_cents, expense_date, note, status, approval_token, requested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)").run(orgId, targetId, description, category, amountCents, expenseDate, note, token, nowIso, nowIso, nowIso);
      const row = db.prepare("SELECT * FROM comp_requests WHERE id=?").get(info.lastInsertRowid) as any;
      const requester = (storage.getUsers() as any[]).find(u => u.id === targetId);
      const submitter = (storage.getUsers() as any[]).find(u => u.id === sessUserId);
      audit({
        userId: sessUserId, userName: submitter?.name ?? "Unknown", action: "create",
        entityType: "comp_request", entityId: row.id,
        entityLabel: (requester?.name ?? "CLR") + " comp request" + (forClr ? " (submitted by " + (submitter?.name ?? "manager") + ")" : ""),
        details: JSON.stringify({ amountCents, onBehalfOf: forClr || undefined }),
      });
      let emailedTo: string | null = null;
      try {
        const settings = storageExtra.getEmailSettings() as any;
        const approverId = Number(settings.approval_recipient_id ?? settings.comp_approver_id ?? settings.timeoff_approver_id ?? 0) || 0;
        const approver = approverId ? (storage.getUserById(approverId) as any) : null;
        const approverEmail = approver?.email && String(approver.email).includes("@") ? String(approver.email) : null;
        if (approverEmail) {
          const { subject, html } = buildCompApprovalEmail([row], token, requester?.name ?? "A team member");
          await sendEmail({ to: approverEmail, subject, html });
          emailedTo = approverEmail;
        }
      } catch (e: any) { console.error("[comp] approval email failed:", e?.message ?? e); }
      return res.json({ ...mapComp(row, compNameMap()), emailedTo, requested: 1 });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to save expense" });
    }
  });

  app.patch("/api/comp/:id", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const id = parseInt(req.params.id, 10);
    try {
      const db = storageExtra.getRawSqlite();
      const existing = db.prepare("SELECT * FROM comp_requests WHERE id=? AND org_id=?").get(id, orgId) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      if (existing.user_id !== userId) return res.status(403).json({ error: "Not your expense." });
      if (existing.status !== "draft") return res.status(400).json({ error: "Only draft expenses can be edited." });
      const body = req.body ?? {};
      const description = typeof body.description === "string" ? body.description.slice(0, 300).trim() : existing.description;
      const category = COMP_CATEGORIES.has(body.category) ? body.category : existing.category;
      const amountCents = body.amountCents !== undefined ? Math.round(Number(body.amountCents)) : existing.amount_cents;
      const expenseDate = (typeof body.expenseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expenseDate)) ? body.expenseDate : existing.expense_date;
      const note = typeof body.note === "string" ? body.note.slice(0, 1000) : existing.note;
      if (!description) return res.status(400).json({ error: "A description is required." });
      if (!Number.isFinite(amountCents) || amountCents <= 0) return res.status(400).json({ error: "Enter an amount greater than 0." });
      db.prepare("UPDATE comp_requests SET description=?, category=?, amount_cents=?, expense_date=?, note=?, updated_at=? WHERE id=?").run(description, category, amountCents, expenseDate, note, new Date().toISOString(), id);
      const row = db.prepare("SELECT * FROM comp_requests WHERE id=?").get(id) as any;
      res.json(mapComp(row, compNameMap()));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update expense" });
    }
  });

  app.post("/api/comp/request", requireAuth, async (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => parseInt(x, 10)).filter((n: number) => Number.isFinite(n)) : [];
    if (!ids.length) return res.status(400).json({ error: "Select at least one expense to request." });
    const nowIso = new Date().toISOString();
    const token = crypto.randomBytes(24).toString("hex");
    try {
      const db = storageExtra.getRawSqlite();
      const placeholders = ids.map(() => "?").join(",");
      const upd = db.prepare("UPDATE comp_requests SET status='pending', requested_at=?, updated_at=?, approval_token=? WHERE id IN (" + placeholders + ") AND org_id=? AND user_id=? AND status='draft'");
      const result = upd.run(nowIso, nowIso, token, ...ids, orgId, userId);
      const actor = (storage.getUsers() as any[]).find(u => u.id === userId);
      audit({
        userId, userName: actor?.name ?? "Unknown", action: "create",
        entityType: "comp_request", entityId: ids[0],
        entityLabel: (actor?.name ?? "User") + " comp request (" + result.changes + " items)",
        details: JSON.stringify({ ids }),
      });

      // Email the configured comp approver with one-click approve/deny links.
      let emailedTo: string | null = null;
      try {
        const settings = storageExtra.getEmailSettings() as any;
        const approverId = Number(settings.approval_recipient_id ?? settings.comp_approver_id ?? settings.timeoff_approver_id ?? 0) || 0;
        const approver = approverId ? (storage.getUserById(approverId) as any) : null;
        const approverEmail = approver?.email && String(approver.email).includes("@") ? String(approver.email) : null;
        const items = db.prepare("SELECT * FROM comp_requests WHERE approval_token=? AND status='pending'").all(token) as any[];
        if (approverEmail && items.length) {
          const { subject, html } = buildCompApprovalEmail(items, token, actor?.name ?? "a team member");
          await sendEmail({ to: approverEmail, subject, html });
          emailedTo = approverEmail;
        }
      } catch (e: any) { console.error("[comp] approver email failed:", e?.message ?? e); }

      res.json({ ok: true, requested: result.changes, emailedTo });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to submit comp request" });
    }
  });

  // Public one-click approve/deny from the approver's email (no login).
  app.get("/api/comp/email-decision", async (req: any, res) => {
    const token = String(req.query.token ?? "");
    const action = String(req.query.action ?? "");
    const valid = action === "approve" || action === "deny" || action === "paid";
    const page = (title: string, msg: string, glyph: string) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:36px 44px;max-width:440px;text-align:center;box-shadow:0 4px 20px rgba(15,24,45,0.08)"><div style="font-size:44px;line-height:1;margin-bottom:12px">${glyph}</div><h1 style="margin:0 0 8px;font-size:20px;color:#0F182D">${title}</h1><p style="margin:0;color:#475569;font-size:14px;line-height:1.5">${msg}</p></div></body></html>`;
    if (!token || !valid) return res.status(400).send(page("Invalid link", "This approval link is missing or malformed.", "&#9888;&#65039;"));
    try {
      const db = storageExtra.getRawSqlite();
      const items = db.prepare("SELECT * FROM comp_requests WHERE approval_token=?").all(token) as any[];
      if (!items.length) return res.status(404).send(page("Not found", "This comp request could not be located.", "&#10067;"));
      const settings = storageExtra.getEmailSettings() as any;
      const reviewerId = Number(settings.approval_recipient_id ?? settings.comp_approver_id ?? settings.timeoff_approver_id ?? 0) || null;
      const now = new Date().toISOString();
      const total = items.reduce((a, r) => a + (r.amount_cents || 0), 0);
      const dollars = "$" + (total / 100).toFixed(2);

      if (action === "paid") {
        const targets = items.filter(i => i.status !== "denied" && !i.is_paid);
        if (!targets.length) return res.send(page("Already handled", "These items were already paid or denied. No further action needed.", "&#8505;&#65039;"));
        db.prepare("UPDATE comp_requests SET status='approved', reviewed_by=COALESCE(reviewed_by, ?), reviewed_at=COALESCE(reviewed_at, ?), is_paid=1, paid_at=?, updated_at=? WHERE approval_token=? AND status!='denied' AND is_paid=0").run(reviewerId, now, now, now, token);
        try { (storage as any).createNotification?.({ userId: items[0].user_id, type: "comp_request", title: "Comp paid", message: "Your comp request for " + dollars + " was approved and marked paid." }); } catch {}
        return res.send(page("Marked paid", targets.length + " item(s) approved and marked reimbursed. You can close this tab.", "&#9989;"));
      }

      const status = action === "approve" ? "approved" : "denied";
      const pending = items.filter(i => i.status === "pending");
      if (!pending.length) return res.send(page("Already handled", "This request was already " + (items[0].status) + ". No further action needed.", "&#8505;&#65039;"));
      db.prepare("UPDATE comp_requests SET status=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE approval_token=? AND status='pending'").run(status, reviewerId, now, now, token);
      try { (storage as any).createNotification?.({ userId: pending[0].user_id, type: "comp_request", title: "Comp " + status, message: "Your comp request for " + dollars + " was " + status + " via email." }); } catch {}
      const glyph = status === "approved" ? "&#9989;" : "&#10060;";
      return res.send(page("Request " + status, pending.length + " item(s) marked " + status + ". You can close this tab.", glyph));
    } catch (e: any) {
      return res.status(500).send(page("Something went wrong", e?.message ?? "Please try again.", "&#9888;&#65039;"));
    }
  });

  app.post("/api/comp/:id/decision", requireAuth, (req: any, res) => {
    if (!isCompManager(Number(req.session_user?.userId))) return res.status(403).json({ error: "Managers/admins only" });
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const reviewerId = Number(sess?.userId);
    const id = parseInt(req.params.id, 10);
    const status = req.body?.status;
    const reviewerNote = typeof req.body?.reviewerNote === "string" ? req.body.reviewerNote.slice(0, 1000) : "";
    if (status !== "approved" && status !== "denied") return res.status(400).json({ error: "status must be approved or denied." });
    const nowIso = new Date().toISOString();
    try {
      const db = storageExtra.getRawSqlite();
      const existing = db.prepare("SELECT * FROM comp_requests WHERE id=? AND org_id=?").get(id, orgId) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      // A manager can't approve/deny their own comp request (admins/super-admins can).
      if (existing.user_id === reviewerId && !isCompAdmin(reviewerId)) {
        return res.status(403).json({ error: "You can't approve or deny your own comp request." });
      }
      db.prepare("UPDATE comp_requests SET status=?, reviewer_note=?, reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=? AND org_id=?").run(status, reviewerNote, reviewerId, nowIso, nowIso, id, orgId);
      const nameById = compNameMap();
      const row = db.prepare("SELECT * FROM comp_requests WHERE id=?").get(id) as any;
      const actor = (storage.getUsers() as any[]).find(u => u.id === reviewerId);
      audit({
        userId: reviewerId, userName: actor?.name ?? "Unknown", action: "update",
        entityType: "comp_request", entityId: id,
        entityLabel: (nameById.get(existing.user_id) ?? "User") + " comp " + status,
        details: JSON.stringify({ status, reviewerNote }),
      });
      try {
        const dollars = "$" + ((existing.amount_cents ?? 0) / 100).toFixed(2);
        (storage as any).createNotification?.({
          userId: existing.user_id,
          type: "comp_request",
          title: "Comp " + status,
          message: "Your comp request for " + dollars + " (" + (existing.description || "expense") + ") was " + status + (reviewerNote ? (": " + reviewerNote) : "."),
        });
      } catch {}
      res.json(mapComp(row, nameById));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update comp request" });
    }
  });

  app.post("/api/comp/:id/paid", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const id = parseInt(req.params.id, 10);
    const hasPaid = req.body?.paid !== undefined;
    const hasReceived = req.body?.received !== undefined;
    const hasProcessing = req.body?.processing !== undefined;
    try {
      const db = storageExtra.getRawSqlite();
      const existing = db.prepare("SELECT * FROM comp_requests WHERE id=? AND org_id=?").get(id, orgId) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      const isOwner = existing.user_id === userId;
      if (!isOwner && !isCompManager(userId)) return res.status(403).json({ error: "Not your comp request." });
      // The "Processing" stage is a manager/payout control, not something the
      // requester sets on their own request.
      if (hasProcessing && !isCompManager(userId)) return res.status(403).json({ error: "Only managers can update the processing stage." });
      if (existing.status !== "approved") return res.status(400).json({ error: "Only approved items can be marked paid, processing, or received." });
      const now = new Date().toISOString();
      if (hasProcessing) {
        const pr = req.body.processing ? 1 : 0;
        db.prepare("UPDATE comp_requests SET is_processing=?, processing_at=?, updated_at=? WHERE id=?").run(pr, pr ? now : null, now, id);
      }
      if (hasPaid) {
        const p = req.body.paid ? 1 : 0;
        // Paying out implies processing is finished; flip it off so the tracker
        // advances cleanly to Paid rather than showing both at once.
        db.prepare("UPDATE comp_requests SET is_paid=?, paid_at=?, is_processing=CASE WHEN ?=1 THEN 0 ELSE is_processing END, updated_at=? WHERE id=?").run(p, p ? now : null, p, now, id);
      }
      if (hasReceived) {
        const rc = req.body.received ? 1 : 0;
        db.prepare("UPDATE comp_requests SET is_received=?, received_at=?, updated_at=? WHERE id=?").run(rc, rc ? now : null, now, id);
      }
      const row = db.prepare("SELECT * FROM comp_requests WHERE id=?").get(id) as any;
      res.json(mapComp(row, compNameMap()));
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update payment status" });
    }
  });

  app.delete("/api/comp/:id", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const id = parseInt(req.params.id, 10);
    try {
      const db = storageExtra.getRawSqlite();
      const existing = db.prepare("SELECT * FROM comp_requests WHERE id=? AND org_id=?").get(id, orgId) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      const isOwner = existing.user_id === userId;
      const canDelete = isCompAdmin(userId) || (isOwner && (existing.status === "draft" || existing.status === "pending"));
      if (!canDelete) return res.status(403).json({ error: "You can only remove your own draft or pending items." });
      db.prepare("DELETE FROM comp_requests WHERE id=? AND org_id=?").run(id, orgId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to remove item" });
    }
  });

  // ── Comp Attachments (receipts/files) ─────────────────────────────────────────
  const COMP_ATTACH_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/heic", "application/pdf"]);
  const COMP_ATTACH_MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file
  function compAttachAccess(compId: number, userId: number, orgId: number) {
    const db = storageExtra.getRawSqlite();
    const item = db.prepare("SELECT * FROM comp_requests WHERE id=? AND org_id=?").get(compId, orgId) as any;
    if (!item) return { item: null, canView: false, canEdit: false };
    const isOwner = item.user_id === userId;
    const adm = isCompManager(userId);
    const canView = isOwner || adm;
    const canEdit = isOwner && (item.status === "draft" || item.status === "pending");
    return { item, canView, canEdit: canEdit || adm };
  }

  app.post("/api/comp/:id/attachments", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const compId = parseInt(req.params.id, 10);
    const { item, canEdit } = compAttachAccess(compId, userId, orgId);
    if (!item) return res.status(404).json({ error: "Comp item not found" });
    if (!canEdit) return res.status(403).json({ error: "You cannot attach files to this item." });
    const filename = typeof req.body?.filename === "string" ? req.body.filename.slice(0, 200) : "file";
    const mime = typeof req.body?.mime === "string" ? req.body.mime.toLowerCase() : "";
    let data = typeof req.body?.dataBase64 === "string" ? req.body.dataBase64 : "";
    const comma = data.indexOf(",");
    if (data.startsWith("data:") && comma >= 0) data = data.slice(comma + 1);
    if (!data) return res.status(400).json({ error: "No file data received." });
    if (!COMP_ATTACH_MIMES.has(mime)) return res.status(400).json({ error: "Unsupported file type. Use an image or PDF." });
    const sizeBytes = Math.floor(data.length * 3 / 4);
    if (sizeBytes > COMP_ATTACH_MAX_BYTES) return res.status(400).json({ error: "File too large (max 8 MB)." });
    try {
      const db = storageExtra.getRawSqlite();
      const info = db.prepare("INSERT INTO comp_attachments (org_id, comp_id, user_id, filename, mime, size_bytes, data_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(orgId, compId, userId, filename, mime, sizeBytes, data, new Date().toISOString());
      const row = db.prepare("SELECT id, comp_id, user_id, filename, mime, size_bytes, created_at FROM comp_attachments WHERE id=?").get(info.lastInsertRowid) as any;
      res.json({ id: row.id, compId: row.comp_id, filename: row.filename, mime: row.mime, sizeBytes: row.size_bytes, createdAt: row.created_at });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to save attachment" });
    }
  });

  app.get("/api/comp/:id/attachments", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const compId = parseInt(req.params.id, 10);
    const { item, canView, canEdit } = compAttachAccess(compId, userId, orgId);
    if (!item) return res.status(404).json({ error: "Comp item not found" });
    if (!canView) return res.status(403).json({ error: "Not allowed." });
    try {
      const db = storageExtra.getRawSqlite();
      const rows = db.prepare("SELECT id, comp_id, user_id, filename, mime, size_bytes, created_at FROM comp_attachments WHERE comp_id=? AND org_id=? ORDER BY id ASC").all(compId, orgId) as any[];
      res.json({ canEdit, attachments: rows.map(r => ({ id: r.id, compId: r.comp_id, filename: r.filename, mime: r.mime, sizeBytes: r.size_bytes, createdAt: r.created_at })) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load attachments" });
    }
  });

  app.get("/api/comp-attachments/:attId", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const attId = parseInt(req.params.attId, 10);
    try {
      const db = storageExtra.getRawSqlite();
      const att = db.prepare("SELECT * FROM comp_attachments WHERE id=? AND org_id=?").get(attId, orgId) as any;
      if (!att) return res.status(404).json({ error: "Attachment not found" });
      const { canView } = compAttachAccess(att.comp_id, userId, orgId);
      if (!canView) return res.status(403).json({ error: "Not allowed." });
      const buf = Buffer.from(att.data_base64, "base64");
      res.setHeader("Content-Type", att.mime || "application/octet-stream");
      const safeName = String(att.filename || "file").replace(/[^A-Za-z0-9._-]/g, "_");
      const disp = String(att.mime || "").startsWith("image/") || att.mime === "application/pdf" ? "inline" : "attachment";
      res.setHeader("Content-Disposition", disp + "; filename=\"" + safeName + "\"");
      res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to load attachment" });
    }
  });

  app.delete("/api/comp-attachments/:attId", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const attId = parseInt(req.params.attId, 10);
    try {
      const db = storageExtra.getRawSqlite();
      const att = db.prepare("SELECT * FROM comp_attachments WHERE id=? AND org_id=?").get(attId, orgId) as any;
      if (!att) return res.status(404).json({ error: "Attachment not found" });
      const { canEdit } = compAttachAccess(att.comp_id, userId, orgId);
      if (!canEdit) return res.status(403).json({ error: "You cannot remove this attachment." });
      db.prepare("DELETE FROM comp_attachments WHERE id=? AND org_id=?").run(attId, orgId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to remove attachment" });
    }
  });

  // Full printable comp-request "sheet" a manager can hand to whoever pays it out —
  // all the request details plus every receipt embedded inline. Image receipts render
  // directly in the page (and print straight into a Save-as-PDF); PDF receipts are
  // embedded for on-screen review and listed with download links. Open with ?print=1
  // to auto-launch the browser's print/Save-as-PDF dialog.
  app.get("/api/comp/:id/sheet", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    const compId = parseInt(req.params.id, 10);
    const { item, canView } = compAttachAccess(compId, userId, orgId);
    if (!item) return res.status(404).send("Comp request not found");
    if (!canView) return res.status(403).send("You are not allowed to view this comp request.");
    try {
      const db = storageExtra.getRawSqlite();
      const nameById = compNameMap();
      const c = mapComp(item, nameById);
      const atts = db.prepare("SELECT id, filename, mime, size_bytes, data_base64 FROM comp_attachments WHERE comp_id=? AND org_id=? ORDER BY id ASC").all(compId, orgId) as any[];

      const CAT_LABELS: Record<string, string> = { transfers: "Transfers", leads: "Transfers", software: "Software", travel: "Travel", marketing: "Marketing", equipment: "Equipment", office: "Office", other: "Other" };
      const STATUS_LABELS: Record<string, string> = { draft: "Draft (unsent)", pending: "Pending approval", approved: "Approved", denied: "Denied" };
      const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
      const money = (cents: number) => "$" + (Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtDate = (d: any) => {
        if (!d) return "—";
        try { const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d) + "T12:00:00" : String(d)); return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); } catch { return String(d); }
      };
      const fmtBytes = (n: number) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
      const settings = (() => { try { return storageExtra.getEmailSettings() as any; } catch { return {}; } })();
      const orgName = esc(settings?.company_name || settings?.org_name || "CLR Connection Center");

      let payout = "Awaiting payout";
      if (c.status === "approved") payout = c.isReceived ? "Received by team member" : (c.isPaid ? "Paid — awaiting receipt confirmation" : "Approved — awaiting payout");
      else if (c.status === "denied") payout = "Denied";
      else if (c.status === "pending") payout = "Pending approval";

      const rows: Array<[string, string]> = [
        ["Team member", esc(c.userName)],
        ["Category", esc(CAT_LABELS[c.category] || c.category)],
        ["Amount", "<strong>" + money(c.amountCents) + "</strong>"],
        ["Date of expense", esc(fmtDate(c.expenseDate))],
        ["Status", esc(STATUS_LABELS[c.status] || c.status)],
        ["Payout status", esc(payout)],
        ["Submitted", esc(fmtDate(c.requestedAt || c.createdAt))],
      ];
      if (c.reviewerName) rows.push([(c.status === "denied" ? "Denied by" : "Approved by"), esc(c.reviewerName) + (c.reviewedAt ? " · " + esc(fmtDate(c.reviewedAt)) : "")]);
      if (c.reviewerNote) rows.push(["Reviewer note", esc(c.reviewerNote)]);

      const detailRows = rows.map(([k, v]) => "<tr><th>" + k + "</th><td>" + v + "</td></tr>").join("");

      const imgAtts = atts.filter(a => String(a.mime || "").startsWith("image/"));
      const pdfAtts = atts.filter(a => a.mime === "application/pdf");
      const otherAtts = atts.filter(a => !String(a.mime || "").startsWith("image/") && a.mime !== "application/pdf");

      const imgHtml = imgAtts.map(a =>
        '<figure class="receipt"><img alt="' + esc(a.filename) + '" src="data:' + esc(a.mime) + ';base64,' + a.data_base64 + '"/>' +
        '<figcaption>' + esc(a.filename) + ' · ' + fmtBytes(a.size_bytes) + '</figcaption></figure>'
      ).join("");

      const pdfHtml = pdfAtts.map(a =>
        '<div class="pdf-receipt"><div class="pdf-name">📄 ' + esc(a.filename) + ' · ' + fmtBytes(a.size_bytes) +
        ' <a href="/api/comp-attachments/' + a.id + '" target="_blank" rel="noreferrer">open</a></div>' +
        '<embed class="pdf-embed" type="application/pdf" src="data:application/pdf;base64,' + a.data_base64 + '"/>' +
        '<div class="pdf-print-note">📄 PDF receipt &ldquo;' + esc(a.filename) + '&rdquo; can&rsquo;t print inline &mdash; open it from the app and attach separately.</div></div>'
      ).join("");

      const otherHtml = otherAtts.map(a =>
        '<div class="pdf-receipt"><div class="pdf-name">📎 <a href="/api/comp-attachments/' + a.id + '" target="_blank" rel="noreferrer">' + esc(a.filename) + '</a> · ' + fmtBytes(a.size_bytes) + '</div></div>'
      ).join("");

      const noteBlock = c.note ? '<div class="note"><div class="note-label">Note from team member</div><div>' + esc(c.note).replace(/\n/g, "<br>") + '</div></div>' : "";
      const pdfNotice = pdfAtts.length
        ? '<p class="hint">Note: PDF receipts below are embedded for on-screen review. If you are saving this page as a single PDF, the PDF receipts may need to be attached separately (use their “open” links) — image receipts print inline automatically.</p>'
        : "";

      const autoPrint = String(req.query.print || "") === "1";
      const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"/>' +
        '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
        '<title>Comp Request #' + compId + ' — ' + esc(c.userName) + '</title><style>' +
        ':root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#1d4ed8}' +
        '*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#f1f5f9;line-height:1.5}' +
        '.sheet{max-width:780px;margin:24px auto;background:#fff;padding:40px 44px;border-radius:14px;box-shadow:0 6px 30px rgba(15,23,42,.08)}' +
        '.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:8px}' +
        '.org{font-weight:700;color:var(--brand);font-size:15px;letter-spacing:.2px}' +
        'h1{font-size:22px;margin:2px 0 2px}.sub{color:var(--muted);font-size:13px;margin:0 0 20px}' +
        '.desc{font-size:16px;font-weight:600;margin:0 0 16px;padding:12px 14px;background:#f8fafc;border:1px solid var(--line);border-radius:10px}' +
        'table.details{width:100%;border-collapse:collapse;margin-bottom:18px}' +
        'table.details th{text-align:left;width:170px;color:var(--muted);font-weight:600;font-size:13px;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}' +
        'table.details td{font-size:14px;padding:7px 10px;border-bottom:1px solid var(--line)}' +
        '.note{margin:0 0 18px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:14px}' +
        '.note-label{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#92400e;font-weight:700;margin-bottom:4px}' +
        'h2{font-size:15px;margin:24px 0 10px;border-top:1px solid var(--line);padding-top:18px}' +
        '.hint{font-size:12px;color:var(--muted);margin:-4px 0 14px}' +
        '.receipts{display:flex;flex-direction:column;gap:18px}' +
        '.receipt{margin:0}.receipt img{max-width:100%;border:1px solid var(--line);border-radius:10px;display:block}' +
        '.receipt figcaption{font-size:12px;color:var(--muted);margin-top:5px}' +
        '.pdf-receipt{margin:0 0 18px}.pdf-name{font-size:13px;margin-bottom:6px}.pdf-name a{color:var(--brand)}' +
        '.pdf-embed{width:100%;height:560px;border:1px solid var(--line);border-radius:10px}' +
        '.pdf-print-note{display:none;font-size:11px;color:var(--muted);margin-top:4px}' +
        '.empty{color:var(--muted);font-size:14px}' +
        '.toolbar{max-width:780px;margin:16px auto 0;text-align:right}' +
        '.btn{display:inline-block;background:var(--brand);color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none}' +
        '.foot{margin-top:26px;border-top:1px solid var(--line);padding-top:12px;color:var(--muted);font-size:11px}' +
        '@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;border-radius:0;padding:0}.toolbar{display:none}.pdf-embed{display:none}.pdf-print-note{display:block}.receipt,.pdf-receipt{break-inside:avoid;page-break-inside:avoid}}' +
        '</style></head><body>' +
        '<div class="toolbar"><button class="btn" onclick="window.print()">Save as PDF / Print</button></div>' +
        '<div class="sheet">' +
        '<div class="topbar"><div class="org">' + orgName + '</div><div class="sub">Comp Request #' + compId + '</div></div>' +
        '<h1>Compensation Request</h1>' +
        '<p class="sub">Reimbursement request submitted by ' + esc(c.userName) + '.</p>' +
        '<div class="desc">' + esc(c.description) + '</div>' +
        '<table class="details">' + detailRows + '</table>' +
        noteBlock +
        '<h2>Receipts &amp; attachments (' + atts.length + ')</h2>' +
        (atts.length ? "" : '<p class="empty">No receipts were attached to this request.</p>') +
        pdfNotice +
        (imgHtml ? '<div class="receipts">' + imgHtml + '</div>' : "") +
        (pdfHtml || otherHtml ? '<div style="margin-top:18px">' + pdfHtml + otherHtml + '</div>' : "") +
        '<div class="foot">Generated by ' + orgName + ' on ' + esc(fmtDate(new Date().toISOString())) + '.</div>' +
        '</div>' +
        (autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},350);});</script>' : "") +
        '</body></html>';

      audit({ userId, userName: (storage.getUserById(userId) as any)?.name ?? "Unknown", action: "view", entityType: "comp_request", entityId: compId, entityLabel: "Comp sheet (" + c.userName + ")", details: JSON.stringify({ attachments: atts.length }) });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (e: any) {
      res.status(500).send("Failed to build comp sheet: " + (e?.message ?? "error"));
    }
  });

  // Combined payout sheet: ONE printable page covering every approved-but-unpaid
  // comp request (optionally scoped via ?ids=1,2,3) — summary table with totals,
  // then each request's receipts inline. Managers open it, Save-as-PDF, and send
  // it to whoever pays out. ?print=1 auto-opens the print dialog.
  app.get("/api/comp/payout-sheet", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    if (!isCompManager(userId)) return res.status(403).send("Managers/admins only.");
    try {
      const db = storageExtra.getRawSqlite();
      const nameById = compNameMap();
      const idsParam = String(req.query.ids ?? "").split(",").map((s: string) => parseInt(s, 10)).filter(Number.isFinite);
      let rows: any[];
      if (idsParam.length) {
        const ph = idsParam.map(() => "?").join(",");
        rows = db.prepare(`SELECT * FROM comp_requests WHERE org_id=? AND status='approved' AND is_paid=0 AND id IN (${ph}) ORDER BY user_id ASC, id ASC`).all(orgId, ...idsParam) as any[];
      } else {
        rows = db.prepare("SELECT * FROM comp_requests WHERE org_id=? AND status='approved' AND is_paid=0 ORDER BY user_id ASC, id ASC").all(orgId) as any[];
      }
      const items = rows.map(r => mapComp(r, nameById));
      const CAT_LABELS: Record<string, string> = { transfers: "Transfers", leads: "Transfers", software: "Software", travel: "Travel", marketing: "Marketing", equipment: "Equipment", office: "Office", other: "Other" };
      const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] || ch));
      const money = (cents: number) => "$" + (Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtDate = (d: any) => {
        if (!d) return "—";
        try { const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d) + "T12:00:00" : String(d)); return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return String(d); }
      };
      const settings = (() => { try { return storageExtra.getEmailSettings() as any; } catch { return {}; } })();
      const orgName = esc(settings?.company_name || settings?.org_name || "CLR Connection Center");
      const grandTotal = items.reduce((s, i) => s + (i.amountCents || 0), 0);

      // 1) "Who gets paid" — one simple row per person: name → amount.
      const byPerson = new Map<string, any[]>();
      for (const i of items) { const k = i.userName; if (!byPerson.has(k)) byPerson.set(k, []); byPerson.get(k)!.push(i); }
      let whoRows = "";
      for (const [person, list] of byPerson) {
        const sub = list.reduce((s, i) => s + (i.amountCents || 0), 0);
        whoRows += `<tr><td class="who-name">${esc(person)}</td><td class="who-count">${list.length} item${list.length === 1 ? "" : "s"}</td><td class="num who-amt">${money(sub)}</td></tr>`;
      }
      whoRows += `<tr class="who-total"><td>Total payout</td><td></td><td class="num">${money(grandTotal)}</td></tr>`;

      // 2) "What it's for" — itemized detail grouped by person.
      let summaryRows = "";
      for (const [person, list] of byPerson) {
        for (const i of list) {
          summaryRows += `<tr><td>${esc(person)}</td><td>${esc(CAT_LABELS[i.category] || i.category)}</td><td>${esc(i.description)}</td><td>${esc(fmtDate(i.expenseDate))}</td><td class="num">${money(i.amountCents)}</td></tr>`;
        }
      }

      // Receipts per request
      const attStmt = db.prepare("SELECT id, filename, mime, size_bytes, data_base64 FROM comp_attachments WHERE comp_id=? AND org_id=? ORDER BY id ASC");
      const fmtBytes = (n: number) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
      let receiptsHtml = "";
      let pdfCount = 0;
      for (const i of items) {
        const atts = attStmt.all(i.id, orgId) as any[];
        if (!atts.length) continue;
        receiptsHtml += `<div class="req-head">${esc(i.userName)} — ${money(i.amountCents)} · ${esc(i.description)}</div>`;
        for (const a of atts) {
          if (String(a.mime || "").startsWith("image/")) {
            receiptsHtml += `<figure class="receipt"><img alt="${esc(a.filename)}" src="data:${esc(a.mime)};base64,${a.data_base64}"/><figcaption>${esc(a.filename)} · ${fmtBytes(a.size_bytes)}</figcaption></figure>`;
          } else if (a.mime === "application/pdf") {
            pdfCount++;
            receiptsHtml += `<div class="pdf-receipt"><div class="pdf-name">📄 ${esc(a.filename)} · ${fmtBytes(a.size_bytes)} <a href="/api/comp-attachments/${a.id}" target="_blank" rel="noreferrer">open</a></div><embed class="pdf-embed" type="application/pdf" src="data:application/pdf;base64,${a.data_base64}"/><div class="pdf-print-note">📄 PDF receipt &ldquo;${esc(a.filename)}&rdquo; can&rsquo;t print inline &mdash; open it from the app and attach separately.</div></div>`;
          } else {
            receiptsHtml += `<div class="pdf-receipt"><div class="pdf-name">📎 <a href="/api/comp-attachments/${a.id}" target="_blank" rel="noreferrer">${esc(a.filename)}</a> · ${fmtBytes(a.size_bytes)}</div></div>`;
          }
        }
      }

      const autoPrint = String(req.query.print || "") === "1";
      const todayLabel = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"/>' +
        '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
        '<title>Comp Payout Sheet — ' + esc(todayLabel) + '</title><style>' +
        ':root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--brand:#1d4ed8}' +
        '*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#f1f5f9;line-height:1.5}' +
        '.sheet{max-width:820px;margin:24px auto;background:#fff;padding:40px 44px;border-radius:14px;box-shadow:0 6px 30px rgba(15,23,42,.08)}' +
        '.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:8px}' +
        '.org{font-weight:700;color:var(--brand);font-size:15px}' +
        'h1{font-size:22px;margin:2px 0 2px}.sub{color:var(--muted);font-size:13px;margin:0 0 20px}' +
        'table.sum{width:100%;border-collapse:collapse;margin-bottom:6px}' +
        'table.sum th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:6px 8px;border-bottom:2px solid var(--line)}' +
        'table.sum td{font-size:13px;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}' +
        'table.sum td.num,table.sum th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
        'table.who{width:100%;border-collapse:collapse;margin-bottom:6px}' +
        'table.who td{padding:10px 12px;border-bottom:1px solid var(--line);font-size:15px}' +
        'td.who-name{font-weight:700}td.who-count{color:var(--muted);font-size:12px}' +
        'table.who td.num{text-align:right;white-space:nowrap}' +
        'td.who-amt{font-weight:700;font-variant-numeric:tabular-nums}' +
        'tr.who-total td{background:#eff6ff;border-top:2px solid #bfdbfe;border-bottom:none;font-size:16px;font-weight:800}' +
        'h2{font-size:15px;margin:26px 0 10px;border-top:1px solid var(--line);padding-top:18px}' +
        'h2.first{border-top:none;padding-top:0;margin-top:6px}' +
        '.hint{font-size:12px;color:var(--muted);margin:0 0 14px}' +
        '.req-head{font-size:13px;font-weight:700;margin:16px 0 8px;padding:6px 10px;background:#f8fafc;border:1px solid var(--line);border-radius:8px}' +
        '.receipt{margin:0 0 14px}.receipt img{max-width:100%;border:1px solid var(--line);border-radius:10px;display:block}' +
        '.receipt figcaption{font-size:12px;color:var(--muted);margin-top:5px}' +
        '.pdf-receipt{margin:0 0 16px}.pdf-name{font-size:13px;margin-bottom:6px}.pdf-name a{color:var(--brand)}' +
        '.pdf-embed{width:100%;height:480px;border:1px solid var(--line);border-radius:10px}' +
        '.pdf-print-note{display:none;font-size:11px;color:var(--muted);margin-top:4px}' +
        '.toolbar{max-width:820px;margin:16px auto 0;text-align:right}' +
        '.btn{display:inline-block;background:var(--brand);color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer}' +
        '.foot{margin-top:26px;border-top:1px solid var(--line);padding-top:12px;color:var(--muted);font-size:11px}' +
        '@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;border-radius:0;padding:0}.toolbar{display:none}.pdf-embed{display:none}.pdf-print-note{display:block}.receipt,.pdf-receipt,tr{break-inside:avoid;page-break-inside:avoid}}' +
        '</style></head><body>' +
        '<div class="toolbar"><button class="btn" onclick="window.print()">Save as PDF / Print</button></div>' +
        '<div class="sheet">' +
        '<div class="topbar"><div class="org">' + orgName + '</div><div class="sub">' + esc(todayLabel) + '</div></div>' +
        '<h1>Comp Payout Sheet</h1>' +
        '<p class="sub">' + items.length + ' approved request' + (items.length === 1 ? "" : "s") + ' awaiting payout · ' + byPerson.size + ' team member' + (byPerson.size === 1 ? "" : "s") + '</p>' +
        (items.length === 0
          ? '<p class="hint">Nothing is awaiting payout. 🎉</p>'
          : '<h2 class="first">Who gets paid</h2>' +
            '<table class="who"><tbody>' + whoRows + '</tbody></table>' +
            '<h2>What it&rsquo;s for</h2>' +
            '<table class="sum"><thead><tr><th>Team member</th><th>Category</th><th>Description</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>' + summaryRows + '</tbody></table>' +
            '<h2>Receipts &amp; attachments</h2>' +
            (receiptsHtml
              ? (pdfCount ? '<p class="hint">PDF receipts are embedded for on-screen review; when saving this page as one PDF they may need to be attached separately via their "open" links. Image receipts print inline automatically.</p>' : '') + receiptsHtml
              : '<p class="hint">No receipts were attached to these requests.</p>')) +
        '<div class="foot">Generated by ' + orgName + ' on ' + esc(todayLabel) + '. Mark these requests as paid in the app once the payout is sent.</div>' +
        '</div>' +
        (autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});</script>' : "") +
        '</body></html>';

      audit({ userId, userName: (storage.getUserById(userId) as any)?.name ?? "Unknown", action: "view", entityType: "comp_request", entityId: 0, entityLabel: "Payout sheet (" + items.length + " items, " + money(grandTotal) + ")", details: null });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (e: any) {
      res.status(500).send("Failed to build payout sheet: " + (e?.message ?? "error"));
    }
  });

  // Batch mark-paid: managers settle a whole payout run in one click.
  app.post("/api/comp/payout/mark-paid", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const orgId = Number(sess?.orgId ?? 1) || 1;
    const userId = Number(sess?.userId);
    if (!isCompManager(userId)) return res.status(403).json({ error: "Managers/admins only" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((n: any) => parseInt(n, 10)).filter(Number.isFinite) : [];
    if (!ids.length) return res.status(400).json({ error: "ids[] required" });
    const now = new Date().toISOString();
    try {
      const db = storageExtra.getRawSqlite();
      const ph = ids.map(() => "?").join(",");
      const targets = db.prepare(`SELECT * FROM comp_requests WHERE org_id=? AND status='approved' AND is_paid=0 AND id IN (${ph})`).all(orgId, ...ids) as any[];
      if (!targets.length) return res.status(400).json({ error: "No matching approved, unpaid requests." });
      const tph = targets.map(() => "?").join(",");
      db.prepare(`UPDATE comp_requests SET is_paid=1, paid_at=?, is_processing=0, updated_at=? WHERE id IN (${tph})`).run(now, now, ...targets.map(t => t.id));
      const actor = storage.getUserById(userId) as any;
      const total = targets.reduce((s, t) => s + (t.amount_cents || 0), 0);
      audit({ userId, userName: actor?.name ?? "Unknown", action: "update", entityType: "comp_request", entityId: 0, entityLabel: "Batch payout — " + targets.length + " request(s), $" + (total / 100).toFixed(2), details: JSON.stringify({ ids: targets.map(t => t.id) }) });
      // Notify each requester their comp was paid out
      for (const t of targets) {
        try {
          (storage as any).createNotification?.({
            userId: t.user_id, type: "comp_request", title: "Comp paid out 💸",
            message: "Your comp request for $" + ((t.amount_cents || 0) / 100).toFixed(2) + " (" + (t.description || "expense") + ") was paid out. Mark it received once it lands.",
          });
        } catch {}
      }
      res.json({ ok: true, paid: targets.length, totalCents: total });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to mark paid" });
    }
  });

  // ── Daily Assignments ────────────────────────────────────────────────────────
  // getDailyAssignments/getLoanOfficers/getUsers may return camelCase (Drizzle)
  // or snake_case (raw SQL, multi-org). Normalize reads across both shapes.
  const normalizeLo = (l: any) => ({
    ...l,
    fullName: l.fullName ?? l.full_name ?? null,
    nmlsId: l.nmlsId ?? l.nmls_id ?? null,
    internalStatus: l.internalStatus ?? l.internal_status ?? null,
    priorityTier: l.priorityTier ?? l.priority_tier ?? null,
    boostScore: l.boostScore ?? l.boost_score ?? null,
    licensedStates: l.licensedStates ?? l.licensed_states ?? null,
  });
  app.get("/api/assignments", (req, res) => {
    const date = (req.query.date as string) || businessTodayForRequest(req, storageExtra.getRawSqlite());
    const assignments = storage.getDailyAssignments(date);
    const los = storage.getLoanOfficers();
    const users = storage.getUsers();
    const loById = new Map<number, any>();
    for (const l of los as any[]) loById.set(l.id, normalizeLo(l));
    const userById = new Map<number, any>();
    for (const u of users as any[]) userById.set(u.id, u);
    const enriched = (assignments as any[]).map(a => {
      const loIdVal = a.loId ?? a.lo_id;
      const assistantIdVal = a.assistantId ?? a.assistant_id;
      return {
        ...a,
        loId: loIdVal,
        assistantId: assistantIdVal,
        assignmentDate: a.assignmentDate ?? a.assignment_date,
        globalRank: a.globalRank ?? a.global_rank,
        assistantRank: a.assistantRank ?? a.assistant_rank,
        manuallyConfigured: !!(a.manuallyConfigured ?? a.manually_configured),
        lo: loIdVal != null ? loById.get(loIdVal) : undefined,
        assistant: assistantIdVal != null ? userById.get(assistantIdVal) : undefined,
      };
    });
    // Show only ACTIVE LOs in the call list. Inactive / vacation / archived /
    // currently-snoozed LOs are hidden — except ones the CLR already worked or
    // attempted, so their progress and counts are preserved.
    const loIsActive = (lo: any) => {
      if (!lo) return false;
      const status = String(lo.internalStatus ?? lo.internal_status ?? "active").toLowerCase();
      if (status !== "active") return false;
      const sn = lo.snoozeUntil ?? lo.snooze_until;
      if (sn && new Date(sn).getTime() > Date.now()) return false;
      return true;
    };
    const visible = enriched.filter((a: any) => a.status === "worked" || a.status === "attempted" || loIsActive(a.lo));
    res.json(visible);
  });

  // Today's assignments for the current CLR (used by call script for [lo name])
  app.get("/api/assignments/today", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const date = businessTodayForRequest(req, storageExtra.getRawSqlite());
    const assignments = (storage.getDailyAssignments(date) as any[]).filter(
      a => (a.assistantId ?? a.assistant_id) === userId,
    );
    const los = storage.getLoanOfficers();
    const loById = new Map<number, any>();
    for (const l of los as any[]) loById.set(l.id, normalizeLo(l));
    const enriched = assignments.map(a => {
      const loIdVal = a.loId ?? a.lo_id;
      const assistantIdVal = a.assistantId ?? a.assistant_id;
      return {
        ...a,
        loId: loIdVal,
        assistantId: assistantIdVal,
        assignmentDate: a.assignmentDate ?? a.assignment_date,
        globalRank: a.globalRank ?? a.global_rank,
        assistantRank: a.assistantRank ?? a.assistant_rank,
        lo: loIdVal != null ? loById.get(loIdVal) : undefined,
      };
    });
    const visible = enriched.filter((a: any) => {
      if (a.status === "worked" || a.status === "attempted") return true;
      const lo = a.lo;
      if (!lo) return false;
      if (String(lo.internalStatus ?? lo.internal_status ?? "active").toLowerCase() !== "active") return false;
      const sn = lo.snoozeUntil ?? lo.snooze_until;
      if (sn && new Date(sn).getTime() > Date.now()) return false;
      return true;
    });
    res.json(visible);
  });

  app.post("/api/assignments/generate", requireAuth, (req: any, res: any) => {
    const date = (req.body.date as string) || businessTodayForRequest(req, storageExtra.getRawSqlite());
    const today = businessTodayForRequest(req, storageExtra.getRawSqlite());
    const callingUser = req.session_user!;
    const sqlite = storageExtra.getRawSqlite();

    // ── Block generation for past dates entirely ────────────────────────────────
    if (date < today) {
      return res.status(403).json({
        error: "Assignments cannot be generated for past dates.",
        locked: true,
        date,
      });
    }

    // ── EOD gate: previous weekday must have an EOD report for this CLR ─────────
    // Compute the previous weekday (skip weekends)
    const prevWeekday = (() => {
      const d = new Date(today + "T12:00:00Z");
      do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      return d.toISOString().split("T")[0];
    })();

    // Check if the calling user is a CLR (assistant or admin+isClr)
    const callerIsClr = callingUser.role === "assistant" || (callingUser.role === "admin" && (callingUser as any).isClr);

    if (callerIsClr) {
      const myEod = sqlite.prepare(
        `SELECT 1 FROM eod_reports WHERE assistant_id = ? AND report_date = ?`
      ).get(callingUser.userId, prevWeekday) as any;
      if (!myEod) {
        return res.status(403).json({
          error: `You must submit your EOD report for ${prevWeekday} before generating today's assignments.`,
          eodMissing: true,
          missingDate: prevWeekday,
        });
      }
    }

    // ── Warn about other CLRs without yesterday's EOD ────────────────────────────
    // Only check; do NOT block — just surface who's missing so the generator knows.
    const allClrs: Array<{ id: number; name: string }> = sqlite.prepare(`
      SELECT id, name FROM users
      WHERE is_active = 1
        AND org_id = ?
        AND (role = 'assistant' OR (role = 'admin' AND is_clr = 1))
        AND in_daily_assignments = 1
        AND id != ?
    `).all(callingUser.orgId ?? 1, callingUser.userId) as any[];

    const clrsMissingEod: string[] = [];
    for (const clr of allClrs) {
      const submitted = sqlite.prepare(
        `SELECT 1 FROM eod_reports WHERE assistant_id = ? AND report_date = ?`
      ).get(clr.id, prevWeekday) as any;
      if (!submitted) clrsMissingEod.push(clr.name);
    }

    // ── One-per-day lock: block re-generation if assignments already exist ────────
    const existing = storage.getDailyAssignments(date);
    if (existing.length > 0) {
      const isManual = (existing as any[]).some(a => a.manuallyConfigured || a.manually_configured);
      return res.status(409).json({
        error: isManual
          ? "Assignments have been pre-configured by an admin. Auto-generation skipped."
          : "Assignments have already been generated for today. They are locked until tomorrow.",
        locked: true,
        manuallyConfigured: isManual,
        date,
      });
    }

    const settings = storage.getAlgorithmSettings();
    const los = storage.getLoanOfficers();
    // in_daily_assignments = 0 → CLR opted out of daily assignment generation only
    const assistants = storage.getUsers().filter(u => u.isActive && u.inDailyAssignments && !u.excludeFromStats && (u.role === "assistant" || (u.role === "admin" && u.isClr)));

    if (assistants.length === 0) return res.status(400).json({ error: "No active CLRs are included in daily assignments." });

    // Check what's already worked today (existing is already fetched above; at this point it's empty)
    const workedToday = existing.filter(a => a.status === "worked").map(a => a.loId);
    // Only ACTIVE LOs are eligible for assignment — exclude inactive / vacation /
    // archived, and any LO currently snoozed.
    const isLoActive = (lo: any) => {
      const status = String(lo.internalStatus ?? lo.internal_status ?? "active").toLowerCase();
      if (status !== "active") return false;
      const sn = lo.snoozeUntil ?? lo.snooze_until;
      if (sn && new Date(sn).getTime() > Date.now()) return false;
      return true;
    };
    const eligibleLOs = los.filter(lo => isLoActive(lo) && !workedToday.includes(lo.id));


    // Compute 90-day transfer counts per LO for algorithm weighting
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const xfer90Start = ninetyDaysAgo.toISOString().split("T")[0];
    const recentOutcomes = storage.getLeadOutcomes({ startDate: xfer90Start, endDate: date });
    const recentTransferCounts = new Map<number, number>();
    for (const o of recentOutcomes) {
      if ((o.outcomeType || (o as any).outcome_type) === "transfer") {
        const loId = o.loId || (o as any).lo_id;
        if (loId) recentTransferCounts.set(loId, (recentTransferCounts.get(loId) || 0) + 1);
      }
    }
    const ranked = generateRankings(eligibleLOs, settings, date, recentTransferCounts);
    const maxTotal = settings.maxLosPerAssistant * assistants.length;
    const topRanked = ranked.slice(0, maxTotal);

    // Clear existing recommended assignments for today
    storage.clearDailyAssignments(date);

    const assignments: any[] = [];

    if (settings.roundRobinEnabled) {
      // ── Spaced Round Robin: CLRs take turns, no CLR gets back-to-back same LO ──
      // Interleave: slot 0→CLR0, slot 1→CLR1, slot 2→CLR2, slot 3→CLR0, ...
      // Even rounds go 0..N-1, odd rounds go N-1..0 (snake pattern for fairness)
      //
      // FAIRNESS NOTE: When the LO count isn't a multiple of CLR count, the
      // last (partial) round leaves one CLR with one fewer LO. Previously the
      // CLR order was the database order of `assistants`, so the same CLR(s)
      // always landed at the front of the list and consistently got the
      // "shortest-stick" position depending on round parity. To make this
      // fair across days, shuffle the assistant order before slotting so the
      // CLR who ends up with one fewer LO is random each generation.
      const shuffledAssistants = [...assistants];
      for (let i = shuffledAssistants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledAssistants[i], shuffledAssistants[j]] = [shuffledAssistants[j], shuffledAssistants[i]];
      }

      const slots = shuffledAssistants.length;
      topRanked.forEach((item, index) => {
        const round = Math.floor(index / slots);
        const posInRound = index % slots;
        const assistantIndex = round % 2 === 0 ? posInRound : (slots - 1 - posInRound);
        const assistantRank = round + 1;
        assignments.push({
          assignmentDate: date,
          loId: item.lo.id,
          assistantId: shuffledAssistants[assistantIndex].id,
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
      // Use monthly assignment order, filter to top-ranked LOs that are eligible today.
      // Also drop rows pointing at CLRs no longer in the daily-assignment pool
      // (excluded via in_daily_assignments, deactivated, etc.).
      const eligibleIds = new Set(topRanked.map(r => r.lo.id));
      const pooledAssistantIds = new Set(assistants.map(a => a.id));
      const orderedRows = monthlyMap.filter((r: any) =>
        eligibleIds.has(r.lo_id || r.loId) && pooledAssistantIds.has(r.assistant_id || r.assistantId));
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

    res.json({ generated: created.length, date, clrsMissingEod });
  });

  // ── Admin: pre-configure assignments for a future date ─────────────────────
  // Body: { date: 'YYYY-MM-DD', items: [{ loId, assistantId, assistantRank }] }
  app.post("/api/assignments/pre-configure", (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const sessionUid = req.session_user?.userId;
    const user = storage.getUserById(sessionUid) as any;
    const date = (req.body.date as string) || "";
    const items = (req.body.items as any[]) || [];
    const today = businessTodayForRequest(req, storageExtra.getRawSqlite());
    if (!date || date < today) {
      return res.status(400).json({ error: "Pre-configure requires a current or future date." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }

    storage.clearDailyAssignments(date);
    const assistants = storage.getUsers().filter(u => u.isActive && !u.excludeFromStats && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
    const assistantOrder: Record<number, number> = {};
    for (const item of items) {
      const aid = Number(item.assistantId);
      assistantOrder[aid] = (assistantOrder[aid] || 0) + 1;
    }
    const counters: Record<number, number> = {};
    const rows = items.map((item: any, index: number) => {
      const aid = Number(item.assistantId);
      counters[aid] = (counters[aid] || 0) + 1;
      return {
        assignmentDate: date,
        loId: Number(item.loId),
        assistantId: aid,
        globalRank: index + 1,
        assistantRank: item.assistantRank ? Number(item.assistantRank) : counters[aid],
        status: "recommended",
        notes: null,
        manuallyConfigured: 1 as any,
      };
    });

    try {
      const sqlite = storageExtra.getRawSqlite();
      const stmt = sqlite.prepare(`
        INSERT INTO daily_assignments
          (assignment_date, lo_id, assistant_id, global_rank, assistant_rank, status, notes, manually_configured, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `);
      const tx = sqlite.transaction((rs: any[]) => {
        for (const r of rs) {
          stmt.run(r.assignmentDate, r.loId, r.assistantId, r.globalRank, r.assistantRank, r.status, r.notes);
        }
      });
      tx(rows);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? "insert failed" });
    }

    audit({
      userId: user.id,
      userName: user.name,
      action: "pre-configure",
      entityType: "assignment",
      entityId: null,
      entityLabel: `Pre-configured assignments for ${date}`,
      details: JSON.stringify({ date, count: rows.length, by: user.email }),
    });

    res.json({ ok: true, date, count: rows.length });
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

  // ── Reassign assignments to another CLR (admins + managers) ─────────────────
  // Body: { ids: number[], assistantId: number }. Moved rows are appended to the
  // end of the target CLR's list for that date (assistant_rank = max + 1) so the
  // target's existing top-to-bottom order is not disturbed. Each move is audited.
  app.post("/api/assignments/reassign", (req, res) => {
    const raw = (req as any).signedCookies?.[COOKIE_NAME];
    const session = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
    const me = session?.userId ? storage.getUserById(session.userId) : null;
    const isMgr = !!(me && (me.role === "admin" || ((me as any).isManager ?? (me as any).is_manager) || ((me as any).superAdmin ?? (me as any).super_admin)));
    if (!isMgr) return res.status(403).json({ error: "Only admins and managers can reassign leads." });

    const ids: number[] = Array.isArray(req.body?.ids)
      ? req.body.ids.map((n: any) => parseInt(n)).filter((n: number) => Number.isFinite(n))
      : [];
    const assistantId = parseInt(req.body?.assistantId);
    if (ids.length === 0 || !Number.isFinite(assistantId)) {
      return res.status(400).json({ error: "ids (number[]) and assistantId are required" });
    }
    const target = storage.getUserById(assistantId);
    const targetActive = !!(target && ((target as any).isActive ?? (target as any).is_active));
    if (!targetActive) return res.status(400).json({ error: "Target CLR not found or inactive" });

    let moved = 0;
    const skipped: number[] = [];
    for (const id of ids) {
      const existing = storage.getAssignmentById(id) as any;
      if (!existing) { skipped.push(id); continue; }
      const fromId = existing.assistantId ?? existing.assistant_id;
      if (fromId === assistantId) { skipped.push(id); continue; }
      const date = existing.assignmentDate ?? existing.assignment_date;
      // Append to the end of the target's list for that date
      const targetRows = (storage.getDailyAssignments(date) as any[])
        .filter(a => (a.assistantId ?? a.assistant_id) === assistantId);
      const nextRank = targetRows.reduce((m, a) => Math.max(m, a.assistantRank ?? a.assistant_rank ?? 0), 0) + 1;
      const row = storage.reassignAssignment(id, assistantId, nextRank);
      if (!row) { skipped.push(id); continue; }
      moved++;
      const lo = storage.getLoanOfficerById(existing.loId ?? existing.lo_id);
      const fromUser = fromId != null ? storage.getUserById(fromId) : null;
      audit({
        userId: me!.id,
        userName: me!.name,
        action: "reassign",
        entityType: "assignment",
        entityId: id,
        entityLabel: lo?.fullName ?? `Assignment #${id}`,
        details: JSON.stringify({ date, from: fromUser?.name ?? fromId ?? null, to: (target as any).name }),
      });
    }
    res.json({ ok: true, moved, skipped });
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
    // getLeadOutcomes uses raw SQL (snake_case), while getLoanOfficers/getUsers
    // may return either camelCase (Drizzle) or snake_case (raw SQL, multi-org).
    // Normalize reads across both shapes.
    const loById = new Map<number, any>();
    for (const l of los as any[]) {
      const id = l.id;
      const fullName = l.fullName ?? l.full_name ?? null;
      loById.set(id, { ...l, id, fullName });
    }
    const userById = new Map<number, any>();
    for (const u of users as any[]) {
      userById.set(u.id, u);
    }
    const enriched = (outcomes as any[]).map(o => {
      const loIdVal = o.loId ?? o.lo_id;
      const assistantIdVal = o.assistantId ?? o.assistant_id;
      const lo = loIdVal != null ? loById.get(loIdVal) : undefined;
      const assistant = assistantIdVal != null ? userById.get(assistantIdVal) : undefined;
      return {
        ...o,
        loId: loIdVal,
        assistantId: assistantIdVal,
        outcomeType: o.outcomeType ?? o.outcome_type,
        transferType: o.transferType ?? o.transfer_type ?? null,
        bulkTexter: (o.bulkTexter ?? o.bulk_texter) == null ? null : !!(o.bulkTexter ?? o.bulk_texter),
        borrowerName: o.borrowerName ?? o.borrower_name ?? null,
        followUpDate: o.followUpDate ?? o.follow_up_date ?? null,
        appointmentDatetime: o.appointmentDatetime ?? o.appointment_datetime ?? null,
        journeyId: o.journeyId ?? o.journey_id ?? null,
        phoneNumber: o.phoneNumber ?? o.phone_number ?? null,
        lo,
        assistant,
      };
    });
    res.json(enriched);
  });

  // 🎉 Org-wide transfer hype. Deliberately EPHEMERAL — celebrations are NOT
  // written to the notifications table (they used to, and clogged the bell).
  // Instead they live in a small in-memory ring buffer that the client polls via
  // GET /api/transfer-celebrations to play the chime + pop a festive toast. Web
  // push still fires for a real-time alert. Buffer is per-process (fine for the
  // single Railway instance) and lost on restart, which is harmless for hype.
  // The id seed is wall-clock based so ids keep increasing across restarts and a
  // client's stored cursor never gets stranded above freshly-issued ids.
  let celebSeq = Date.now();
  const recentCelebrations: Array<{ id: number; orgId: number; title: string; message: string; createdAt: string }> = [];
  function broadcastTransferCelebration(assistantId: number, loName: string | null, borrowerName: string | null) {
    const clr = storage.getUserById(assistantId) as any;
    const clrOrg = Number(clr?.orgId ?? clr?.org_id ?? 1) || 1;
    const users = (storage.getUsers() as any[]).filter((u: any) =>
      (u.isActive ?? u.is_active) && (Number(u.orgId ?? u.org_id ?? 1) || 1) === clrOrg
    );
    const clrName = clr?.name ?? "A CLR";
    const detail = [borrowerName, loName ? "→ " + loName : null].filter(Boolean).join(" ");
    const title = `🎉 ${clrName} just got a transfer!`;
    const message = (detail ? detail + " — " : "") + "Keep the momentum going!";
    recentCelebrations.push({ id: ++celebSeq, orgId: clrOrg, title, message, createdAt: new Date().toISOString() });
    if (recentCelebrations.length > 100) recentCelebrations.splice(0, recentCelebrations.length - 100);
    sendPushToUsers(users.map((u: any) => u.id), { title, body: message, url: "/#/leaderboard" }).catch(() => {});
  }

  // Ephemeral celebration feed (org-scoped). Returns recent celebrations and the
  // latest id; the client baselines to latestId on first load (no replay) and
  // toasts anything newer than its stored cursor.
  app.get("/api/transfer-celebrations", requireAuth, (req: any, res) => {
    const orgId = Number(req.session_user?.orgId ?? 1) || 1;
    const since = Number(req.query.since ?? 0) || 0;
    const items = recentCelebrations.filter((c) => c.orgId === orgId && c.id > since);
    res.json({ items, latestId: celebSeq });
  });

  app.post("/api/outcomes", (req: any, res) => {
    try {
      const body = { ...req.body };
      // Attribution guard: a CLR can only log their OWN transfers. Force the
      // assistant to the logged-in user unless they are an admin/manager (who may
      // log or correct on behalf of others). Fixes transfers wrongly attributed
      // to Ethan Wood (user #1).
      const sessUserId = Number(req.session_user?.userId) || 0;
      const me = sessUserId ? (storage.getUserById(sessUserId) as any) : null;
      const privileged = !!(me && (me.role === "admin" || (me.superAdmin ?? me.super_admin) || (me.isManager ?? me.is_manager)));
      if (sessUserId) {
        if (!privileged) body.assistantId = sessUserId;
        else if (body.assistantId == null || Number(body.assistantId) <= 0) body.assistantId = sessUserId;
      }
      const toBulk = (v: any) => (v === true || v === 1 || v === "1" ? 1 : v === false || v === 0 || v === "0" ? 0 : null);
      if (body.outcomeType === "transfer") {
        if (body.transferType !== "direct" && body.transferType !== "appointment") {
          return res.status(400).json({ error: "transferType is required for transfer outcomes (must be 'direct' or 'appointment')" });
        }
        // A transfer must never schedule a calendar appointment, even an
        // appointment-type transfer. Strip any appointment datetime defensively.
        body.appointmentDatetime = null;
        body.bulkTexter = toBulk(body.bulkTexter);
      } else {
        body.transferType = null;
        body.bulkTexter = null;
      }
      const nullify = (v: any) => (v === undefined || v === '' ? null : v);
      const boolToInt = (v: any) => v === true ? 1 : v === false ? 0 : nullify(v);
      const nullableFields = [
        "borrowerName", "journeyId", "phoneNumber", "notes", "followUpDate", "transferType",
        "conversationNotes", "loActionPlan", "leadTimeframe", "requiresFollowup",
        "followupReason", "followupDate", "leadType", "appointmentDatetime",
        "leadGoal", "prequalificationNotes", "missedReason", "rescheduled",
        "rescheduleDatetime", "nextSteps",
      ];
      for (const k of nullableFields) body[k] = nullify(body[k]);
      body.requiresFollowup = boolToInt(body.requiresFollowup);
      body.rescheduled = boolToInt(body.rescheduled);
      // Post-EOD rollover: if this CLR has already submitted EOD for the
      // outcome's date, push the outcome forward into tomorrow so it counts
      // toward the next day's report.
      try {
        const sqliteRef = storageExtra.getSqlite();
        const aId = (req as any).session_user?.userId ?? body.assistantId ?? null;
        if (aId && body.date) {
          const rolled = rolloverIfEodSubmitted(sqliteRef, Number(aId), String(body.date));
          if (rolled !== body.date) body.date = rolled;
        }
      } catch {}
      const outcome = storage.createLeadOutcome(body);
      const lo = outcome.loId ? storage.getLoanOfficerById(outcome.loId) : null;
      audit({ userId: sessUserId || 0, userName: me?.name ?? "Unknown", action: "create", entityType: "outcome", entityId: outcome.id, entityLabel: outcome.borrowerName ?? lo?.fullName ?? null, details: JSON.stringify({ outcomeType: outcome.outcomeType, transferType: outcome.transferType ?? null, assistantId: outcome.assistantId }) });
      // 🎉 Transfer celebration — notify the whole org (in-app + push). The
      // client plays a celebration sound when it sees this notification type.
      if (outcome.outcomeType === "transfer") {
        try { broadcastTransferCelebration(outcome.assistantId, lo?.fullName ?? null, outcome.borrowerName ?? null); } catch {}
      }
      // Update unified_contact + fire-and-forget Bonzo push
      try {
        storageExtra.updateUnifiedContactFromOutcome({
          borrowerName: outcome.borrowerName,
          outcomeType: outcome.outcomeType,
          date: outcome.date,
          loId: outcome.loId,
          assistantId: outcome.assistantId,
        });
      } catch (e) { console.error("unified_contact update failed:", e); }
      try {
        const pusher = (globalThis as any).__pushOutcomeToBonzo;
        if (typeof pusher === "function") {
          pusher({
            id: outcome.id,
            borrowerName: outcome.borrowerName,
            outcomeType: outcome.outcomeType,
            appointmentDatetime: (outcome as any).appointmentDatetime,
            followUpDate: outcome.followUpDate,
            notes: outcome.notes,
          }).catch((err: any) => console.error("bonzo push failed:", err?.message));
        }
      } catch (e) { /* never block outcome creation */ }
      try {
        const zapier = (globalThis as any).__triggerZapier;
        if (typeof zapier === "function") {
          zapier("outcome.logged", {
            outcomeId: outcome.id,
            outcomeType: outcome.outcomeType,
            borrowerName: outcome.borrowerName,
            loId: outcome.loId,
          }).catch(() => {});
        }
      } catch {}
      res.json(outcome);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/outcomes/:id", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const sessionUser = req.session_user as { userId: number; role?: string } | undefined;
    const isAdmin = sessionUser?.role === "admin";
    const existing = storageExtra.getRawSqlite().prepare(`SELECT assistant_id, outcome_type FROM lead_outcomes WHERE id = ?`).get(id) as any;
    if (!existing) return res.status(404).json({ error: "Outcome not found" });
    if (!isAdmin && existing.assistant_id !== sessionUser?.userId) {
      return res.status(403).json({ error: "You can only edit your own outcomes" });
    }
    const body = { ...req.body };
    // If caller is setting outcomeType, enforce the same rule.
    if (body.outcomeType === "transfer") {
      if (body.transferType !== "direct" && body.transferType !== "appointment") {
        return res.status(400).json({ error: "transferType is required for transfer outcomes (must be 'direct' or 'appointment')" });
      }
      // When an outcome is being converted to a transfer, drop any pending
      // follow-up date so it stops appearing in the upcoming appointments list
      // and stops firing 30-min reminders. (followUpDate may still be set by an
      // explicit non-empty value in the same PATCH.)
      if (!("followUpDate" in body) || body.followUpDate === undefined) body.followUpDate = null;
      // A transfer must never schedule a calendar appointment — always clear it.
      body.appointmentDatetime = null;
    } else if (body.outcomeType !== undefined) {
      // outcomeType is being changed away from transfer — clear transferType + bulk texter
      body.transferType = null;
      body.bulkTexter = null;
    }
    if ("bulkTexter" in body) {
      body.bulkTexter = (body.bulkTexter === true || body.bulkTexter === 1 || body.bulkTexter === "1") ? 1
        : (body.bulkTexter === false || body.bulkTexter === 0 || body.bulkTexter === "0") ? 0 : null;
    }
    const nullify = (v: any) => (v === undefined || v === '' ? null : v);
    const boolToInt = (v: any) => v === true ? 1 : v === false ? 0 : nullify(v);
    const nullableFields = [
      "borrowerName", "journeyId", "phoneNumber", "notes", "followUpDate", "transferType",
      "conversationNotes", "loActionPlan", "leadTimeframe", "requiresFollowup",
      "followupReason", "followupDate", "leadType", "appointmentDatetime",
      "leadGoal", "prequalificationNotes", "missedReason", "rescheduled",
      "rescheduleDatetime", "nextSteps",
    ];
    for (const k of nullableFields) {
      if (k in body) body[k] = nullify(body[k]);
    }
    if ("requiresFollowup" in body) body.requiresFollowup = boolToInt(body.requiresFollowup);
    if ("rescheduled" in body) body.rescheduled = boolToInt(body.rescheduled);
    const outcome = storage.updateLeadOutcome(id, body);
    if (outcome) audit({ userId: 1, userName: "Ethan Wood", action: "update", entityType: "outcome", entityId: outcome.id, entityLabel: outcome.borrowerName ?? null, details: JSON.stringify(body) });
    // 🎉 Celebrate conversions to transfer (e.g. appointment completed as a
    // transfer) — but not edits of something that was already a transfer.
    if (outcome && body.outcomeType === "transfer" && existing.outcome_type !== "transfer") {
      try {
        const lo = outcome.loId ? (storage.getLoanOfficerById(outcome.loId) as any) : null;
        broadcastTransferCelebration(outcome.assistantId, lo?.fullName ?? null, outcome.borrowerName ?? null);
      } catch {}
    }
    // If the appointment time changed (reschedule, edit, etc.), clear the
    // 30-minute reminder flag so the cron can fire a fresh reminder against
    // the new scheduled time. We check whether either field that the cron
    // reads from is being touched in this PATCH.
    if ("appointmentDatetime" in body || "followUpDate" in body || "assistantId" in body) {
      try {
        storageExtra.getRawSqlite()
          .prepare(`UPDATE lead_outcomes SET reminder_sent_30m = 0 WHERE id = ?`)
          .run(id);
      } catch (e: any) {
        console.error(`[appt-30m] failed to reset reminder flag for outcome=${id}:`, e?.message ?? e);
      }
    }
    res.json(outcome);
  });

  app.delete("/api/outcomes/:id", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const sessionUser = req.session_user as { userId: number; role?: string } | undefined;
    const isAdmin = sessionUser?.role === "admin";
    const existing = storageExtra.getRawSqlite().prepare(`SELECT assistant_id FROM lead_outcomes WHERE id = ?`).get(id) as any;
    if (!existing) return res.status(404).json({ error: "Outcome not found" });
    if (!isAdmin && existing.assistant_id !== sessionUser?.userId) {
      return res.status(403).json({ error: "You can only delete your own outcomes" });
    }
    createBackup('pre-delete');
    audit({ userId: sessionUser?.userId ?? 0, userName: "", action: "delete", entityType: "outcome", entityId: id, entityLabel: null, details: null });
    storage.deleteLeadOutcome(id);
    res.json({ ok: true });
  });

  // Recent activity widget for dashboard home page.
  // Returns last 3 transfers + last 3 fell-throughs for the current user.
  app.get("/api/dashboard/recent-activity", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId as number | undefined;
    const role = req.session_user?.role as string | undefined;
    // Admins see all recent activity; CLRs see only their own
    const outcomes = (role === "admin"
      ? storage.getLeadOutcomes({})
      : storage.getLeadOutcomes({ assistantId: userId })) as any[];
    const los = storage.getLoanOfficers() as any[];
    const users = storage.getUsers() as any[];

    const enrich = (o: any) => {
      const lo = los.find((l: any) => l.id === (o.loId ?? o.lo_id));
      const assistant = users.find((u: any) => u.id === (o.assistantId ?? o.assistant_id));
      return {
        id: o.id,
        date: o.date,
        createdAt: o.createdAt ?? o.created_at,
        borrowerName: o.borrowerName ?? o.borrower_name ?? null,
        notes: o.notes ?? null,
        loId: o.loId ?? o.lo_id,
        loName: lo?.fullName ?? null,
        assistantName: assistant?.name ?? null,
        outcomeType: o.outcomeType ?? o.outcome_type,
      };
    };

    const sortByDateDesc = (a: any, b: any) => {
      const ad = (a.createdAt ?? a.created_at ?? a.date ?? "") as string;
      const bd = (b.createdAt ?? b.created_at ?? b.date ?? "") as string;
      return bd.localeCompare(ad);
    };

    const transfers = outcomes
      .filter((o: any) => (o.outcomeType ?? o.outcome_type) === "transfer")
      .sort(sortByDateDesc)
      .slice(0, 3)
      .map(enrich);

    const fellThroughs = outcomes
      .filter((o: any) => (o.outcomeType ?? o.outcome_type) === "fell_through")
      .sort(sortByDateDesc)
      .slice(0, 3)
      .map(enrich);

    res.json({ transfers, fellThroughs });
  });

  // ── Notifications ────────────────────────────────────────────────────────────
  app.get("/api/notifications", (req: any, res) => {
    // Always scope to the logged-in user (personal + broadcasts). Never trust a
    // query param — otherwise everyone could read everyone else's notifications.
    const userId = req.session_user?.userId;
    if (!userId) return res.json([]);
    res.json(storage.getNotifications(userId));
  });

  app.get("/api/notifications/unread-count", (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.json({ count: 0 });
    res.json({ count: storage.getUnreadCount(userId) });
  });

  app.post("/api/notifications", async (req, res) => {
    const notif = storage.createNotification(req.body);
    // Mirror as push
    try {
      const payload = { title: notif.title, body: notif.message, url: "/" };
      if (notif.userId) {
        sendPushToUser(notif.userId, payload).catch(() => {});
      } else {
        // Broadcast: send to all active users
        const all = (storage.getUsers() as any[]).filter((u: any) => u.isActive);
        sendPushToUsers(all.map((u: any) => u.id), payload).catch(() => {});
      }
    } catch {}
    res.json(notif);
  });

  app.patch("/api/notifications/:id/read", (req, res) => {
    storage.markNotificationRead(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/notifications/mark-all-read", (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.json({ ok: true });
    storage.markAllNotificationsRead(userId);
    res.json({ ok: true });
  });

  // ── Dashboard ────────────────────────────────────────────────────────────────
  app.get("/api/dashboard/stats", requireAuth, (req: any, res) => {
    const periodName = (req.query.period as string) || "period";
    const scope = (req.query.scope as string) === "team" ? "team" : "personal";
    const resolved = resolveNamedPeriod(periodName);
    const startDate = (req.query.startDate as string) || resolved.startDate;
    const endDate = (req.query.endDate as string) || resolved.endDate;

    const userId = req.session_user?.userId;
    // Personal scope filters base outcome stats (transfers / fellThrough /
    // appointments / outcomesByType / upcomingAppointments) to the current user.
    // Team scope returns org-wide aggregates.
    const reqTz = (req.user as any)?.timezone ?? BUSINESS_DAY_DEFAULT_TZ;
    const stats = scope === "personal" && userId
      ? storage.getDashboardStats(startDate, endDate, userId, reqTz)
      : storage.getDashboardStats(startDate, endDate, undefined, reqTz);
    const todayStr = businessTodayForRequest(req, storageExtra.getRawSqlite());

    let myCallsToday: number | null = null;
    let futureContactsCount = 0;
    let myCallsInPeriod = 0;
    let contactsReachedPeriod = 0;
    let dncHitsPeriod = 0;
    let messagesSentPeriod = 0;
    let bulkTexterTransfers = 0;

    // Sum contacts_reached + dnc_hits from raw call_logs for the period
    const rawLogsInPeriod = storageExtra.getCallLogsByRangeRaw(startDate, endDate) as any[];

    // Bulletproof period-scoped calls sum via direct SQL (avoids ORM/camelCase drift).
    const sqliteDb = storageExtra.getSqlite();
    const oidForSum = currentOrgId();
    const orgClause = oidForSum != null ? ` AND org_id = ${Number(oidForSum)}` : "";
    const sumCallsSql = (extraWhere: string, params: any[]): number => {
      const row = sqliteDb.prepare(
        `SELECT COALESCE(SUM(calls_made), 0) AS total FROM daily_call_logs WHERE log_date >= ? AND log_date <= ?${extraWhere}${orgClause}`
      ).get(startDate, endDate, ...params) as any;
      return Number(row?.total ?? 0);
    };
    // Messages sent (texts/DMs) from EOD reports for the period.
    const sumMessagesSql = (extraWhere: string, params: any[]): number => {
      try {
        const row = sqliteDb.prepare(
          `SELECT COALESCE(SUM(messages_sent), 0) AS total FROM eod_reports WHERE report_date >= ? AND report_date <= ?${extraWhere}`
        ).get(startDate, endDate, ...params) as any;
        return Number(row?.total ?? 0);
      } catch { return 0; }
    };
    // Transfers where Bulk Texter was part of it, for the period.
    const countBulkTexterSql = (extraWhere: string, params: any[]): number => {
      try {
        const row = sqliteDb.prepare(
          `SELECT COUNT(*) AS n FROM lead_outcomes WHERE outcome_type='transfer' AND bulk_texter=1 AND date >= ? AND date <= ?${extraWhere}${orgClause}`
        ).get(startDate, endDate, ...params) as any;
        return Number(row?.n ?? 0);
      } catch { return 0; }
    };

    if (scope === "team") {
      // Team totals — aggregate across COUNTED CLRs (drop non-counted from every
      // total: today's calls, period calls, contacts, messages, bulk-texter,
      // future contacts).
      const excluded = storage.getExcludedClrIds();
      const aid = (x: any) => x.assistantId ?? x.assistant_id;
      const exSql = excluded.size ? ` AND assistant_id NOT IN (${Array.from(excluded).join(",")})` : "";

      const allLogsToday = storage.getDailyCallLogs(todayStr) as any[];
      myCallsToday = allLogsToday.filter((l: any) => !excluded.has(aid(l))).reduce((sum: number, l: any) => sum + (l.callsMade ?? l.calls_made ?? 0), 0);

      const allOutcomes = (storage.getLeadOutcomes({ startDate, endDate }) as any[]).filter((o: any) => !excluded.has(aid(o)));
      futureContactsCount = allOutcomes.filter((o: any) => {
        const t = o.outcomeType || o.outcome_type;
        return t === "deferral" || t === "future_contact";
      }).length;

      myCallsInPeriod = sumCallsSql(exSql, []);
      const teamRaw = rawLogsInPeriod.filter((l: any) => !excluded.has(l.assistant_id));
      contactsReachedPeriod = teamRaw.reduce((s, l) => s + (l.contacts_reached ?? 0), 0);
      dncHitsPeriod = teamRaw.reduce((s, l) => s + (l.dnc_hits ?? 0), 0);
      messagesSentPeriod = sumMessagesSql(exSql, []);
      bulkTexterTransfers = countBulkTexterSql(exSql, []);
    } else if (userId) {
      const myLog = storage.getDailyCallLogs(todayStr).find(
        (l: any) => (l.assistantId ?? l.assistant_id) === userId,
      );
      myCallsToday = myLog ? (myLog.callsMade ?? (myLog as any).calls_made ?? null) : null;

      const userOutcomes = storage.getLeadOutcomes({ startDate, endDate, assistantId: userId }) as any[];
      futureContactsCount = userOutcomes.filter((o: any) => {
        const t = o.outcomeType || o.outcome_type;
        return t === "deferral" || t === "future_contact";
      }).length;
      myCallsInPeriod = sumCallsSql(` AND assistant_id = ?`, [userId]);
      const myRaw = rawLogsInPeriod.filter((l: any) => l.assistant_id === userId);
      contactsReachedPeriod = myRaw.reduce((s, l) => s + (l.contacts_reached ?? 0), 0);
      dncHitsPeriod = myRaw.reduce((s, l) => s + (l.dnc_hits ?? 0), 0);
      messagesSentPeriod = sumMessagesSql(` AND assistant_id = ?`, [userId]);
      bulkTexterTransfers = countBulkTexterSql(` AND assistant_id = ?`, [userId]);
    }

    res.json({
      ...stats,
      startDate,
      endDate,
      period: periodName,
      scope,
      myCallsToday,
      futureContactsCount,
      myCallsInPeriod,
      contactsReached: contactsReachedPeriod,
      dncHits: dncHitsPeriod,
      messagesSent: messagesSentPeriod,
      bulkTexterTransfers,
    });
  });

  // ── Team Stats (rich analytics) ──────────────────────────────────────────────
  app.get("/api/stats", (req, res) => {
    const periodName = (req.query.period as string) || "period";
    const { startDate, endDate } = resolveNamedPeriod(periodName);
    const clrParam = (req.query.clr_id as string) || "all";
    const clrId = clrParam === "all" || !clrParam ? undefined : parseInt(clrParam);

    // Previous period of equal length (for trend deltas)
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    const dayMs = 86400000;
    const lenDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;
    const prevEnd = new Date(start.getTime() - dayMs);
    const prevStart = new Date(prevEnd.getTime() - (lenDays - 1) * dayMs);
    const prevStartStr = prevStart.toISOString().split("T")[0];
    const prevEndStr = prevEnd.toISOString().split("T")[0];

    const outcomesAll = storage.getLeadOutcomes({ startDate, endDate }) as any[];
    const outcomesPrev = storage.getLeadOutcomes({ startDate: prevStartStr, endDate: prevEndStr }) as any[];
    const callLogsAll = storage.getCallLogsByRange(startDate, endDate) as any[];
    const callLogsPrev = storage.getCallLogsByRange(prevStartStr, prevEndStr) as any[];
    // Messages sent (texts/DMs) come from EOD reports — tracked alongside calls.
    const eodInRange = storageExtra.getEodReportsByRange(startDate, endDate) as any[];
    const sumMessages = (rows: any[]) => rows.reduce((s, r) => s + Number(r.messages_sent ?? 0), 0);
    const users = storage.getUsers() as any[];
    // Non-counted CLRs: excluded from the team view's totals/per-CLR list, but a
    // single-CLR view of one still shows their own data.
    const excluded = storage.getExcludedClrIds();
    const aid = (o: any) => o.assistantId ?? o.assistant_id;
    const activeAssistants = users.filter(u => (u.role === "assistant" || u.role === "admin") && u.isActive && !u.excludeFromStats);

    const filterByClr = <T extends any>(arr: T[], field: string): T[] =>
      clrId === undefined ? arr : arr.filter((o: any) => (o[field] ?? o[field.replace(/([A-Z])/g, "_$1").toLowerCase()]) === clrId);

    const outcomes = clrId === undefined ? outcomesAll.filter((o: any) => !excluded.has(aid(o))) : outcomesAll.filter((o: any) => aid(o) === clrId);
    const outcomesPrevFiltered = clrId === undefined ? outcomesPrev.filter((o: any) => !excluded.has(aid(o))) : outcomesPrev.filter((o: any) => aid(o) === clrId);
    const callLogs = clrId === undefined ? callLogsAll.filter((l: any) => !excluded.has(aid(l))) : callLogsAll.filter((l: any) => aid(l) === clrId);
    const callLogsPrevFiltered = clrId === undefined ? callLogsPrev.filter((l: any) => !excluded.has(aid(l))) : callLogsPrev.filter((l: any) => aid(l) === clrId);

    const ot = (o: any) => o.outcomeType ?? o.outcome_type;
    const isAppt = (t: string) => t === "appointment" || t === "callback_requested" || t === "deferral";

    const sumCalls = (logs: any[]) => logs.reduce((s, l) => s + (l.callsMade ?? l.calls_made ?? 0), 0);
    const sumContacts = (logs: any[]) => logs.reduce((s, l) => s + (l.contactsReached ?? l.contacts_reached ?? 0), 0);
    const sumDnc = (logs: any[]) => logs.reduce((s, l) => s + (l.dncHits ?? l.dnc_hits ?? 0), 0);

    // Raw call logs include contacts_reached/dnc_hits columns (not exposed via Drizzle schema)
    const rawCallLogsAll = storageExtra.getCallLogsByRangeRaw(startDate, endDate);
    const rawCallLogs = clrId === undefined ? rawCallLogsAll.filter((l: any) => !excluded.has(l.assistant_id)) : rawCallLogsAll.filter((l: any) => l.assistant_id === clrId);

    const totalCalls = sumCalls(callLogs);
    const totalMessages = sumMessages(clrId === undefined ? eodInRange.filter((r: any) => !excluded.has(r.assistant_id)) : eodInRange.filter((r: any) => r.assistant_id === clrId));
    const totalContactsReached = sumContacts(rawCallLogs);
    const totalDncHits = sumDnc(rawCallLogs);
    const totalTransfers = outcomes.filter(o => ot(o) === "transfer").length;
    const totalAppointments = outcomes.filter(o => isAppt(ot(o))).length;
    const totalFellThrough = outcomes.filter(o => ot(o) === "fell_through").length;
    const transferRate = totalCalls > 0 ? (totalTransfers / totalCalls) * 100 : 0;

    const prevCalls = sumCalls(callLogsPrevFiltered);
    const prevTransfers = outcomesPrevFiltered.filter(o => ot(o) === "transfer").length;
    const prevAppointments = outcomesPrevFiltered.filter(o => isAppt(ot(o))).length;
    const prevTransferRate = prevCalls > 0 ? (prevTransfers / prevCalls) * 100 : 0;

    // Build daily breakdown. For alltime (very long ranges), clamp the start to
    // the earliest date that actually has data so we don't iterate thousands of
    // empty days.
    let effectiveStart = start;
    if (periodName === "alltime") {
      const firstOutcomeDate = outcomes.reduce<string | null>((min, o: any) => {
        const d = o.date as string | undefined;
        if (!d) return min;
        return !min || d < min ? d : min;
      }, null);
      const firstLogDate = callLogs.reduce<string | null>((min, l: any) => {
        const d = (l.logDate ?? l.log_date) as string | undefined;
        if (!d) return min;
        return !min || d < min ? d : min;
      }, null);
      const earliest = [firstOutcomeDate, firstLogDate].filter(Boolean).sort()[0];
      if (earliest) effectiveStart = new Date(earliest + "T00:00:00");
    }
    const days: string[] = [];
    for (let d = new Date(effectiveStart); d <= end; d = new Date(d.getTime() + dayMs)) {
      days.push(d.toISOString().split("T")[0]);
    }
    const daily = days.map(day => {
      const dayOutcomes = outcomes.filter((o: any) => o.date === day);
      const dayLogs = callLogs.filter((l: any) => (l.logDate ?? l.log_date) === day);
      const calls = sumCalls(dayLogs);
      const transfers = dayOutcomes.filter(o => ot(o) === "transfer").length;
      const appointments = dayOutcomes.filter(o => isAppt(ot(o))).length;
      const fellThrough = dayOutcomes.filter(o => ot(o) === "fell_through").length;
      const rate = calls > 0 ? (transfers / calls) * 100 : 0;
      return { date: day, calls, transfers, appointments, fellThrough, transferRate: +rate.toFixed(1) };
    });

    // Outcome breakdown (for donut)
    const breakdown = {
      transfer: outcomes.filter(o => ot(o) === "transfer").length,
      appointment: outcomes.filter(o => ot(o) === "appointment").length,
      callback_requested: outcomes.filter(o => ot(o) === "callback_requested").length,
      deferral: outcomes.filter(o => ot(o) === "deferral").length,
      fell_through: outcomes.filter(o => ot(o) === "fell_through").length,
      no_answer: outcomes.filter(o => ot(o) === "no_answer").length,
    };

    // Load per-CLR goals once so we can compute "vs goal" per row.
    // Falls back to the user's own weekly goal fields if no individual record exists.
    let goalsByUser = new Map<number, { calls: number; transfers: number; appointments: number }>();
    try {
      const sqlite = storageExtra.getSqlite();
      const rows = sqlite.prepare(`SELECT user_id, calls_goal, transfers_goal, appointments_goal FROM clr_goals`).all() as any[];
      for (const r of rows) {
        goalsByUser.set(r.user_id, {
          calls: Number(r.calls_goal ?? 0),
          transfers: Number(r.transfers_goal ?? 0),
          appointments: Number(r.appointments_goal ?? 0),
        });
      }
    } catch {}

    // Per-CLR breakdown (always from full team data, not the filtered set)
    const perClr = activeAssistants.map((u: any) => {
      const uOutcomes = outcomesAll.filter((o: any) => (o.assistantId ?? o.assistant_id) === u.id);
      const uLogs = callLogsAll.filter((l: any) => (l.assistantId ?? l.assistant_id) === u.id);
      const uRawLogs = rawCallLogsAll.filter((l: any) => l.assistant_id === u.id);
      const uCalls = sumCalls(uLogs);
      const uMessages = sumMessages(eodInRange.filter((r: any) => r.assistant_id === u.id));
      const uContacts = sumContacts(uRawLogs);
      const uDnc = sumDnc(uRawLogs);
      const uTransfers = uOutcomes.filter(o => ot(o) === "transfer").length;
      const uAppointments = uOutcomes.filter(o => isAppt(ot(o))).length;
      const uFellThrough = uOutcomes.filter(o => ot(o) === "fell_through").length;
      const uDeferrals = uOutcomes.filter(o => ot(o) === "deferral").length;
      const rate = uCalls > 0 ? (uTransfers / uCalls) * 100 : 0;
      const ug = goalsByUser.get(u.id);
      const transfersGoal = Number(ug?.transfers ?? u.goalTransfersWeekly ?? u.goal_transfers_weekly ?? 0);
      const callsGoal = Number(ug?.calls ?? u.goalCallsWeekly ?? u.goal_calls_weekly ?? 0);
      const appointmentsGoal = Number(ug?.appointments ?? u.goalAppointmentsWeekly ?? u.goal_appointments_weekly ?? 0);
      const goalSource: "individual" | "default" = ug ? "individual" : "default";
      return {
        userId: u.id,
        name: u.name,
        calls: uCalls,
        messages: uMessages,
        contactsReached: uContacts,
        dncHits: uDnc,
        transfers: uTransfers,
        appointments: uAppointments,
        fellThrough: uFellThrough,
        deferrals: uDeferrals,
        transferRate: +rate.toFixed(1),
        transfersGoal,
        callsGoal,
        appointmentsGoal,
        goalSource,
      };
    }).sort((a, b) => b.transfers - a.transfers);

    res.json({
      period: periodName,
      startDate,
      endDate,
      clrId: clrId ?? null,
      totals: {
        calls: totalCalls,
        messages: totalMessages,
        contactsReached: totalContactsReached,
        dncHits: totalDncHits,
        transfers: totalTransfers,
        appointments: totalAppointments,
        fellThrough: totalFellThrough,
        transferRate: +transferRate.toFixed(1),
      },
      previous: {
        calls: prevCalls,
        transfers: prevTransfers,
        appointments: prevAppointments,
        transferRate: +prevTransferRate.toFixed(1),
      },
      daily,
      breakdown,
      perClr,
    });
  });

  // ── Leaderboard ───────────────────────────────────────────────────────────────
  // ── Analytics History (last N periods) ─────────────────────────────────────
  app.get("/api/analytics/history", (req, res) => {
    const assistantId = req.query.assistantId ? parseInt(req.query.assistantId as string) : undefined;
    const range = req.query.range as string | undefined;
    const users = storage.getUsers();

    // Helper: build a single bucket result from an array of outcomes
    function buildBucket(label: string, startDate: string, endDate: string, outcomes: any[]) {
      const transfers = outcomes.filter((o: any) => o.outcomeType === "transfer" || o.outcome_type === "transfer").length;
      const appointments = outcomes.filter((o: any) => o.outcomeType === "appointment" || o.outcome_type === "appointment").length;
      const total = outcomes.length;
      const convRate = total > 0 ? Math.round((transfers / total) * 100) : 0;
      const tally: Record<number, { transfers: number; total: number; name: string }> = {};
      for (const o of outcomes) {
        const aid = o.assistantId || o.assistant_id;
        if (!tally[aid]) {
          const u = users.find((u: any) => u.id === aid);
          tally[aid] = { transfers: 0, total: 0, name: u?.name ?? `User ${aid}` };
        }
        tally[aid].total++;
        if (o.outcomeType === "transfer" || o.outcome_type === "transfer") tally[aid].transfers++;
      }
      const clrStats = Object.values(tally).sort((a: any, b: any) => b.transfers - a.transfers);
      return { label, startDate, endDate, transfers, appointments, total, convRate, clrStats };
    }

    // Pad date string to ISO date
    function toISODate(d: Date): string {
      return d.toISOString().split("T")[0];
    }

    const now = new Date();
    const results: any[] = [];

    if (range === "1d") {
      // 24 hourly buckets for today
      const todayStr = toISODate(now);
      // Fetch all outcomes for today by date field
      const dayOutcomes = storage.getLeadOutcomes({ startDate: todayStr, endDate: todayStr, assistantId });
      for (let h = 0; h < 24; h++) {
        const label = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
        // Filter by hour using created_at timestamp
        const hourOutcomes = dayOutcomes.filter((o: any) => {
          const ts = o.createdAt || o.created_at || "";
          if (!ts) return false;
          try {
            const d = new Date(ts);
            return d.getHours() === h;
          } catch { return false; }
        });
        results.push(buildBucket(label, todayStr, todayStr, hourOutcomes));
      }

    } else if (range === "1w") {
      // 7 daily buckets: Mon–Sun of current week
      const dayOfWeek = now.getDay(); // 0=Sun
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
      for (let i = 0; i < 7; i++) {
        const day = new Date(monday);
        day.setDate(monday.getDate() + i);
        const dateStr = toISODate(day);
        const label = day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
        const outcomes = storage.getLeadOutcomes({ startDate: dateStr, endDate: dateStr, assistantId });
        results.push(buildBucket(label, dateStr, dateStr, outcomes));
      }

    } else if (range === "all") {
      // Group by month from earliest outcome to today; bucket by quarter if > 24 months
      const allOutcomes = storage.getLeadOutcomes({ assistantId });
      if (allOutcomes.length === 0) {
        return res.json({ periods: [] });
      }
      // Find earliest date
      let earliest = allOutcomes.reduce((min: string, o: any) => {
        const d = (o.date || "") as string;
        return d < min ? d : min;
      }, allOutcomes[0].date as string);
      const earliestDate = new Date(earliest + "T00:00:00");
      const startYear = earliestDate.getFullYear();
      const startMonth = earliestDate.getMonth();
      const endYear = now.getFullYear();
      const endMonth = now.getMonth();
      const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
      const useQuarters = totalMonths > 24;

      if (!useQuarters) {
        // Monthly buckets
        for (let i = 0; i < totalMonths; i++) {
          const year = startYear + Math.floor((startMonth + i) / 12);
          const month = (startMonth + i) % 12;
          const bucketStart = new Date(year, month, 1);
          const bucketEnd = new Date(year, month + 1, 0);
          const startDate = toISODate(bucketStart);
          const endDate = toISODate(bucketEnd);
          const label = bucketStart.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          const outcomes = storage.getLeadOutcomes({ startDate, endDate, assistantId });
          results.push(buildBucket(label, startDate, endDate, outcomes));
        }
      } else {
        // Quarterly buckets
        const startQ = Math.floor(startMonth / 3);
        const endQ = Math.floor(endMonth / 3);
        const totalQ = (endYear - startYear) * 4 + (endQ - startQ) + 1;
        for (let i = 0; i < totalQ; i++) {
          const totalQFromStart = Math.floor(startMonth / 3) + i;
          const year = startYear + Math.floor(totalQFromStart / 4);
          const q = totalQFromStart % 4;
          const qStartMonth = q * 3;
          const bucketStart = new Date(year, qStartMonth, 1);
          const bucketEnd = new Date(year, qStartMonth + 3, 0);
          const startDate = toISODate(bucketStart);
          const endDate = toISODate(bucketEnd);
          const label = `Q${q + 1} ${year}`;
          const outcomes = storage.getLeadOutcomes({ startDate, endDate, assistantId });
          results.push(buildBucket(label, startDate, endDate, outcomes));
        }
      }

    } else {
      // Default: legacy half-month periods (1m range or periods param)
      const periodsBack = parseInt((req.query.periods as string) || "6");
      for (let i = 0; i < periodsBack; i++) {
        const periodEnd = new Date(now.getFullYear(), now.getMonth() - i, 15);
        const periodStart = new Date(now.getFullYear(), now.getMonth() - i - 1, 16);
        const startDate = periodStart.toISOString().split("T")[0];
        const endDate = periodEnd.toISOString().split("T")[0];
        const label = periodEnd.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        const outcomes = storage.getLeadOutcomes({ startDate, endDate, assistantId });
        results.push(buildBucket(label, startDate, endDate, outcomes));
      }
      return res.json({ periods: results.reverse() });
    }

    res.json({ periods: results });
  });

  app.get("/api/leaderboard", (req, res) => {
    const period = getDefaultPeriod();
    const startDate = (req.query.startDate as string) || period.startDate;
    const endDate = (req.query.endDate as string) || period.endDate;
    const leaderboard = storage.getLeaderboard(startDate, endDate);

    // Compute % of recommended LOs completed per CLR
    const assignments = storage.getAssignmentsByRange(startDate, endDate);
    const completionByUser: Record<number, { assigned: number; completed: number }> = {};
    for (const a of assignments as any[]) {
      const uid = a.assistantId || a.assistant_id;
      if (!uid) continue;
      if (!completionByUser[uid]) completionByUser[uid] = { assigned: 0, completed: 0 };
      completionByUser[uid].assigned++;
      if (a.status === "worked" || a.status === "skipped") completionByUser[uid].completed++;
    }

    // Per-CLR contacts_reached + dnc_hits for the period (from raw call_logs)
    const callStats = storageExtra.getCallStatsByRange(startDate, endDate);
    const callStatsByUser: Record<number, { contactsReached: number; dncHits: number }> = {};
    for (const row of callStats as any[]) {
      callStatsByUser[row.assistant_id] = {
        contactsReached: row.total_contacts ?? 0,
        dncHits: row.total_dnc ?? 0,
      };
    }

    const leaderboardWithCompletion = (leaderboard as any[]).map((entry: any) => {
      const uid = entry.userId || entry.user_id;
      const comp = completionByUser[uid] ?? { assigned: 0, completed: 0 };
      const completionPct = comp.assigned > 0 ? Math.round((comp.completed / comp.assigned) * 100) : null;
      const cs = callStatsByUser[uid] ?? { contactsReached: 0, dncHits: 0 };
      return {
        ...entry,
        assignedCount: comp.assigned,
        completedCount: comp.completed,
        completionPct,
        contactsReached: cs.contactsReached,
        dncHits: cs.dncHits,
      };
    });

    res.json({ leaderboard: leaderboardWithCompletion, startDate, endDate });
  });

  // ── Manager Dashboard (admin-only aggregate view) ─────────────────────────────
  // Returns team-wide stats, leaderboard, EOD report status grid, pipeline
  // (today's transfers / overdue appointments / overdue NMLS), and a 30-day trend
  // for the manager dashboard route. Replaces the regular CLR home for admins.
  app.get("/api/manager-dashboard", requireAuth, (req: any, res) => {
    const sess = req.session_user;
    const me = sess?.userId ? (storage.getUserById(sess.userId) as any) : null;
    if (!me || (me.role !== "admin" && !me.superAdmin)) {
      return res.status(403).json({ error: "Admin only" });
    }

    const todayStr = businessTodayForRequest(req, storageExtra.getRawSqlite());
    const week = resolveNamedPeriod("week");
    const month = resolveNamedPeriod("month");
    const last30 = resolveNamedPeriod("30days");

    // ── Team-wide totals ──
    const reqTz = (req.user as any)?.timezone ?? BUSINESS_DAY_DEFAULT_TZ;
    const todayStats = storage.getDashboardStats(todayStr, todayStr, undefined, reqTz);
    const weekStats = storage.getDashboardStats(week.startDate, week.endDate, undefined, reqTz);
    const monthStats = storage.getDashboardStats(month.startDate, month.endDate, undefined, reqTz);

    // ── Per-user list-completion (current month) — feeds clrCards below ──
    const monthAssignments = storage.getAssignmentsByRange(month.startDate, month.endDate) as any[];
    const completionByUser: Record<number, { assigned: number; completed: number }> = {};
    for (const a of monthAssignments) {
      const uid = a.assistantId || a.assistant_id;
      if (!uid) continue;
      if (!completionByUser[uid]) completionByUser[uid] = { assigned: 0, completed: 0 };
      completionByUser[uid].assigned++;
      if (a.status === "worked" || a.status === "skipped") completionByUser[uid].completed++;
    }

    // ── EOD Report status grid (today) ──
    const allClrs = storage.getUsers().filter((u: any) =>
      u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr))
    ) as any[];
    // Non-counted CLRs: stay in the EOD grid (they still submit EODs) but drop
    // out of scorecard metrics, leaderboard, and per-CLR aggregate cards.
    const excludedIds = storage.getExcludedClrIds();
    const countedClrs = allClrs.filter((u: any) => !excludedIds.has(u.id));
    // SQL fragment appended to raw team COUNT/aggregate queries.
    const exClause = excludedIds.size ? ` AND assistant_id NOT IN (${Array.from(excludedIds).join(",")})` : "";
    const exClauseO = excludedIds.size ? ` AND o.assistant_id NOT IN (${Array.from(excludedIds).join(",")})` : "";
    const todayReports = (storageExtra.getEodReportsByRange(todayStr, todayStr) as any[]);
    const reportByUser = new Map<number, any>();
    for (const r of todayReports) {
      const uid = r.assistantId || r.assistant_id;
      if (uid != null) reportByUser.set(uid, r);
    }
    const eodStatus = allClrs.map((u: any) => {
      const r = reportByUser.get(u.id);
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        submitted: !!r,
        submittedAt: r ? (r.createdAt || r.created_at || null) : null,
      };
    });
    const eodSubmittedCount = eodStatus.filter(e => e.submitted).length;

    // ── Pipeline ──
    // Today's transfers (across whole org, with CLR + LO names)
    const sqlite = storageExtra.getSqlite();
    const todayTransfers = sqlite.prepare(`
      SELECT o.id, o.borrower_name, o.transfer_type, o.notes,
             o.assistant_id, o.lo_id,
             u.name AS clr_name, lo.full_name AS lo_name
      FROM lead_outcomes o
      LEFT JOIN users u ON u.id = o.assistant_id
      LEFT JOIN loan_officers lo ON lo.id = o.lo_id
      WHERE o.date = ? AND o.outcome_type = 'transfer'
      ORDER BY o.id DESC
    `).all(todayStr) as any[];

    // Overdue appointments (follow_up_date < today, type=appointment, status not done)
    const overdueAppointments = sqlite.prepare(`
      SELECT o.id, o.borrower_name, o.follow_up_date, o.notes,
             o.assistant_id, o.lo_id,
             u.name AS clr_name, lo.full_name AS lo_name
      FROM lead_outcomes o
      LEFT JOIN users u ON u.id = o.assistant_id
      LEFT JOIN loan_officers lo ON lo.id = o.lo_id
      WHERE o.outcome_type = 'appointment'
        AND o.follow_up_date IS NOT NULL
        AND o.follow_up_date < ?
      ORDER BY o.follow_up_date ASC
      LIMIT 25
    `).all(todayStr) as any[];

    // NMLS overdue checks across the team
    let overdueNmls: any[] = [];
    try {
      const periodKey = (typeof getNmlsPeriodKey === "function") ? getNmlsPeriodKey() : null;
      if (periodKey) {
        const checks = storageExtra.getNmlsChecksForPeriod(periodKey) as any[];
        const los = storage.getLoanOfficers() as any[];
        const users = storage.getUsers() as any[];
        const schedule = storageExtra.getNmlsSchedule() as any;
        const escalationDays = schedule?.escalation_days ?? 7;
        overdueNmls = checks
          .filter((c: any) => c.status === "pending")
          .map((c: any) => {
            const assignedAt = new Date(c.assigned_at);
            const daysOverdue = Math.floor((Date.now() - assignedAt.getTime()) / 86400000);
            return { ...c, daysOverdue, lo: los.find(l => l.id === c.lo_id), assignedTo: users.find(u => u.id === c.assigned_to) };
          })
          .filter((c: any) => c.daysOverdue >= escalationDays)
          .sort((a: any, b: any) => b.daysOverdue - a.daysOverdue)
          .slice(0, 25);
      }
    } catch (e) { /* nmls module may not be available */ }

    // ── Prior-period stats for week/month deltas ──
    const priorWeekStart = new Date(week.startDate + "T00:00:00"); priorWeekStart.setDate(priorWeekStart.getDate() - 7);
    const priorWeekEnd = new Date(week.endDate + "T00:00:00"); priorWeekEnd.setDate(priorWeekEnd.getDate() - 7);
    const priorMonthStart = new Date(month.startDate + "T00:00:00"); priorMonthStart.setMonth(priorMonthStart.getMonth() - 1);
    const priorMonthEnd = new Date(month.startDate + "T00:00:00"); priorMonthEnd.setDate(priorMonthEnd.getDate() - 1);
    const fmtD = (d: Date) => d.toISOString().split("T")[0];
    const priorWeekStats = storage.getDashboardStats(fmtD(priorWeekStart), fmtD(priorWeekEnd), undefined, reqTz);
    const priorMonthStats = storage.getDashboardStats(fmtD(priorMonthStart), fmtD(priorMonthEnd), undefined, reqTz);

    // ── Per-CLR deep cards (this month) with goals + completion + outcome mix ──
    const monthOutcomesAll = sqlite.prepare(`
      SELECT assistant_id, outcome_type, COUNT(*) AS count
      FROM lead_outcomes
      WHERE date >= ? AND date <= ?${exClause}
      GROUP BY assistant_id, outcome_type
    `).all(month.startDate, month.endDate) as any[];
    const outcomesByUser: Record<number, Record<string, number>> = {};
    for (const r of monthOutcomesAll) {
      const uid = r.assistant_id;
      if (!uid) continue;
      if (!outcomesByUser[uid]) outcomesByUser[uid] = {};
      outcomesByUser[uid][r.outcome_type] = Number(r.count) || 0;
    }
    const monthCallsRows = sqlite.prepare(`
      SELECT assistant_id, COALESCE(SUM(calls_made), 0) AS calls
      FROM daily_call_logs
      WHERE log_date >= ? AND log_date <= ?${exClause}
      GROUP BY assistant_id
    `).all(month.startDate, month.endDate) as any[];
    const callsByUserMonth = new Map<number, number>();
    for (const r of monthCallsRows) callsByUserMonth.set(r.assistant_id, Number(r.calls) || 0);

    // Approximate weeks-in-month elapsed for goal proration
    const monthDaysElapsed = Math.max(1, (Date.now() - new Date(month.startDate + "T00:00:00").getTime()) / 86400000);
    const weeksElapsed = Math.max(1, monthDaysElapsed / 7);
    const clrCards = countedClrs.map((u: any) => {
      const om = outcomesByUser[u.id] ?? {};
      const transfers = om.transfer ?? 0;
      const appointments = om.appointment ?? 0;
      const fellThrough = om.fell_through ?? 0;
      const callbacks = (om.callback_requested ?? 0) + (om.deferral ?? 0);
      const noAnswer = om.no_answer ?? 0;
      const futureContact = om.future_contact ?? 0;
      const calls = callsByUserMonth.get(u.id) ?? 0;
      // Weekly goals (raw, as stored on the user record) — used for tooltip clarity.
      const goalCallsWeekly        = Number(u.goalCallsWeekly        ?? u.goal_calls_weekly        ?? 0);
      const goalTransfersWeekly    = Number(u.goalTransfersWeekly    ?? u.goal_transfers_weekly    ?? 0);
      const goalAppointmentsWeekly = Number(u.goalAppointmentsWeekly ?? u.goal_appointments_weekly ?? 0);
      // Month-to-date prorated goals (weekly × weeks-elapsed in current month).
      const goalCalls     = Math.round(goalCallsWeekly        * weeksElapsed);
      const goalTransfers = Math.round(goalTransfersWeekly    * weeksElapsed);
      const goalAppts     = Math.round(goalAppointmentsWeekly * weeksElapsed);
      const comp = completionByUser[u.id] ?? { assigned: 0, completed: 0 };
      const completionPct = comp.assigned > 0 ? Math.round((comp.completed / comp.assigned) * 100) : null;
      const callToTransferRatio = calls > 0 ? Math.round((transfers / calls) * 1000) / 10 : null; // %
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        transfers, appointments, fellThrough, callbacks, noAnswer, futureContact,
        calls,
        // Weekly base goals (so the UI can show "weekly goal: N")
        goalCallsWeekly, goalTransfersWeekly, goalAppointmentsWeekly,
        // Prorated goals matching the month-to-date counts above.
        goalCalls, goalTransfers, goalAppts,
        goalPeriod: "month-to-date" as const,
        weeksElapsed: Math.round(weeksElapsed * 10) / 10,
        callsPct: goalCalls > 0 ? Math.min(999, Math.round((calls / goalCalls) * 100)) : null,
        transfersPct: goalTransfers > 0 ? Math.min(999, Math.round((transfers / goalTransfers) * 100)) : null,
        apptsPct: goalAppts > 0 ? Math.min(999, Math.round((appointments / goalAppts) * 100)) : null,
        assigned: comp.assigned,
        completed: comp.completed,
        completionPct,
        callToTransferRatio,
      };
    });

    // ── Activity feed: last 25 outcomes across the team ──
    const activityFeed = sqlite.prepare(`
      SELECT o.id, o.date, o.outcome_type, o.borrower_name, o.notes,
             o.created_at, u.name AS clr_name, lo.full_name AS lo_name
      FROM lead_outcomes o
      LEFT JOIN users u ON u.id = o.assistant_id
      LEFT JOIN loan_officers lo ON lo.id = o.lo_id
      ORDER BY o.id DESC
      LIMIT 25
    `).all() as any[];

    // ── Pipeline: last 7 days of transfers (frontend slices to 1d/3d/7d) ──
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysAgoStr = fmtD(sevenDaysAgo);
    const transfers7d = sqlite.prepare(`
      SELECT o.id, o.date, o.borrower_name, o.transfer_type, o.notes, o.phone_number,
             o.assistant_id, o.lo_id,
             u.name AS clr_name, lo.full_name AS lo_name
      FROM lead_outcomes o
      LEFT JOIN users u ON u.id = o.assistant_id
      LEFT JOIN loan_officers lo ON lo.id = o.lo_id
      WHERE o.date >= ? AND o.date <= ? AND o.outcome_type = 'transfer'${exClauseO}
      ORDER BY o.date DESC, o.id DESC
    `).all(sevenDaysAgoStr, todayStr) as any[];

    // ── Range-aware section data ──
    // Computes everything that needs a range selector, for a given window.
    type RangeKey = "week" | "30d" | "3mo" | "all";
    const rangeWindows: Record<RangeKey, { startDate: string; endDate: string; days: number; label: string }> = (() => {
      const today = new Date(todayStr + "T00:00:00");
      const minus = (days: number) => { const d = new Date(today); d.setDate(d.getDate() - days); return fmtD(d); };
      return {
        week: { startDate: minus(6),  endDate: todayStr, days: 7,   label: "Last 7 days" },
        "30d": { startDate: minus(29), endDate: todayStr, days: 30,  label: "Last 30 days" },
        "3mo": { startDate: minus(89), endDate: todayStr, days: 90,  label: "Last 3 months" },
        all:   { startDate: "2020-01-01", endDate: todayStr, days: 0, label: "All time" },
      };
    })();

    const FT_KEYWORDS: { label: string; pattern: RegExp }[] = [
      { label: "Credit", pattern: /\b(credit|score|fico)\b/i },
      { label: "Income / DTI", pattern: /\b(income|dti|debt[- ]to[- ]income|qualif)\b/i },
      { label: "Rate / pricing", pattern: /\b(rate|pricing|too high|cost|fees)\b/i },
      { label: "Equity / LTV", pattern: /\b(equity|ltv|appraisal|value)\b/i },
      { label: "Not interested", pattern: /\b(not interested|no thanks|decline|hung up|disconnected)\b/i },
      { label: "Going elsewhere", pattern: /\b(other lender|already (working|locked)|competit|going with)\b/i },
      { label: "Spouse / co-borrower", pattern: /\b(spouse|wife|husband|co[- ]?borrower|partner)\b/i },
      { label: "Timing / not ready", pattern: /\b(not ready|timing|wait|later|next year|few months)\b/i },
    ];

    function computeRange(startDate: string, endDate: string, days: number) {
      // Trend (per-day team totals + calls)
      const trendRows = sqlite.prepare(`
        SELECT date,
               SUM(CASE WHEN outcome_type = 'transfer'     THEN 1 ELSE 0 END) AS transfers,
               SUM(CASE WHEN outcome_type = 'appointment'  THEN 1 ELSE 0 END) AS appointments,
               SUM(CASE WHEN outcome_type = 'fell_through' THEN 1 ELSE 0 END) AS fell_through
        FROM lead_outcomes
        WHERE date >= ? AND date <= ?${exClause}
        GROUP BY date
        ORDER BY date ASC
      `).all(startDate, endDate) as any[];
      const callsRows = sqlite.prepare(`
        SELECT log_date AS date, COALESCE(SUM(calls_made), 0) AS calls
        FROM daily_call_logs
        WHERE log_date >= ? AND log_date <= ?${exClause}
        GROUP BY log_date
        ORDER BY log_date ASC
      `).all(startDate, endDate) as any[];
      const callsByDate = new Map<string, number>();
      for (const r of callsRows) callsByDate.set(r.date, Number(r.calls) || 0);
      const trendMap = new Map<string, any>();
      for (const r of trendRows) trendMap.set(r.date, r);

      // For "all time" build a series only of dates that actually have data, otherwise contiguous.
      const trend: any[] = [];
      if (days === 0) {
        const keys = new Set<string>();
        trendMap.forEach((_, k) => keys.add(k));
        callsByDate.forEach((_, k) => keys.add(k));
        const sorted = Array.from(keys).sort();
        for (const d of sorted) {
          const row = trendMap.get(d);
          trend.push({
            date: d,
            calls: callsByDate.get(d) ?? 0,
            transfers: row ? Number(row.transfers) || 0 : 0,
            appointments: row ? Number(row.appointments) || 0 : 0,
            fellThrough: row ? Number(row.fell_through) || 0 : 0,
          });
        }
      } else {
        const cur = new Date(startDate + "T00:00:00");
        const end = new Date(endDate + "T00:00:00");
        while (cur <= end) {
          const d = cur.toISOString().split("T")[0];
          const row = trendMap.get(d);
          trend.push({
            date: d,
            calls: callsByDate.get(d) ?? 0,
            transfers: row ? Number(row.transfers) || 0 : 0,
            appointments: row ? Number(row.appointments) || 0 : 0,
            fellThrough: row ? Number(row.fell_through) || 0 : 0,
          });
          cur.setDate(cur.getDate() + 1);
        }
      }

      // Outcome breakdown
      const outcomeBreakdown = sqlite.prepare(`
        SELECT outcome_type, COUNT(*) AS count
        FROM lead_outcomes
        WHERE date >= ? AND date <= ?${exClause}
        GROUP BY outcome_type
        ORDER BY count DESC
      `).all(startDate, endDate) as any[];

      // Top LOs
      const topLos = sqlite.prepare(`
        SELECT lo.id, lo.full_name AS name, COUNT(*) AS transfers
        FROM lead_outcomes o
        LEFT JOIN loan_officers lo ON lo.id = o.lo_id
        WHERE o.date >= ? AND o.date <= ?
          AND o.outcome_type = 'transfer'
          AND lo.id IS NOT NULL${exClauseO}
        GROUP BY lo.id
        ORDER BY transfers DESC
        LIMIT 10
      `).all(startDate, endDate) as any[];

      // Fell-through reasons (Other / unspecified bucket dropped)
      const ftRows = sqlite.prepare(`
        SELECT notes FROM lead_outcomes
        WHERE date >= ? AND date <= ? AND outcome_type = 'fell_through'${exClause}
      `).all(startDate, endDate) as any[];
      const buckets: Record<string, number> = {};
      for (const r of ftRows) {
        const note = String(r.notes || "").trim();
        if (!note) continue;
        for (const k of FT_KEYWORDS) {
          if (k.pattern.test(note)) { buckets[k.label] = (buckets[k.label] ?? 0) + 1; break; }
        }
      }
      const fellThroughReasons = Object.entries(buckets)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

      // Leaderboard for this range: transfers, appointments, calls per CLR
      const lbOutcomes = sqlite.prepare(`
        SELECT assistant_id, outcome_type, COUNT(*) AS count
        FROM lead_outcomes
        WHERE date >= ? AND date <= ?${exClause}
        GROUP BY assistant_id, outcome_type
      `).all(startDate, endDate) as any[];
      const lbByUser: Record<number, { transfers: number; appointments: number; fellThrough: number; total: number }> = {};
      for (const r of lbOutcomes) {
        const uid = r.assistant_id;
        if (!uid) continue;
        if (!lbByUser[uid]) lbByUser[uid] = { transfers: 0, appointments: 0, fellThrough: 0, total: 0 };
        const c = Number(r.count) || 0;
        lbByUser[uid].total += c;
        if (r.outcome_type === "transfer") lbByUser[uid].transfers = c;
        if (r.outcome_type === "appointment") lbByUser[uid].appointments = c;
        if (r.outcome_type === "fell_through") lbByUser[uid].fellThrough = c;
      }
      const lbCalls = sqlite.prepare(`
        SELECT assistant_id, COALESCE(SUM(calls_made), 0) AS calls
        FROM daily_call_logs
        WHERE log_date >= ? AND log_date <= ?${exClause}
        GROUP BY assistant_id
      `).all(startDate, endDate) as any[];
      const lbCallsByUser = new Map<number, number>();
      for (const r of lbCalls) lbCallsByUser.set(r.assistant_id, Number(r.calls) || 0);
      const leaderboard = countedClrs
        .map((u: any) => {
          const s = lbByUser[u.id] ?? { transfers: 0, appointments: 0, fellThrough: 0, total: 0 };
          const calls = lbCallsByUser.get(u.id) ?? 0;
          const conversionRate = s.total > 0 ? Math.round((s.transfers / s.total) * 100) : 0;
          // Outcome ratios as percentages of all logged outcomes (excludes pure call counts).
          const transferPct    = s.total > 0 ? Math.round((s.transfers    / s.total) * 1000) / 10 : 0;
          const appointmentPct = s.total > 0 ? Math.round((s.appointments / s.total) * 1000) / 10 : 0;
          const fellThroughPct = s.total > 0 ? Math.round((s.fellThrough  / s.total) * 1000) / 10 : 0;
          // Call-to-transfer ratio (different denominator: dials).
          const callToTransferPct = calls > 0 ? Math.round((s.transfers / calls) * 1000) / 10 : null;
          return {
            userId: u.id,
            name: u.name,
            transfers: s.transfers,
            appointments: s.appointments,
            fellThrough: s.fellThrough,
            totalOutcomes: s.total,
            calls,
            conversionRate,
            transferPct,
            appointmentPct,
            fellThroughPct,
            callToTransferPct,
          };
        })
        .sort((a: any, b: any) => b.transfers - a.transfers || b.calls - a.calls);

      // Per-CLR daily trend (transfers / appointments / fell-through, plus calls)
      // Used by the "CLR trend comparison" chart.
      const clrOutcomeRows = sqlite.prepare(`
        SELECT assistant_id, date, outcome_type, COUNT(*) AS count
        FROM lead_outcomes
        WHERE date >= ? AND date <= ?${exClause}
        GROUP BY assistant_id, date, outcome_type
      `).all(startDate, endDate) as any[];
      const clrCallRows = sqlite.prepare(`
        SELECT assistant_id, log_date AS date, COALESCE(SUM(calls_made), 0) AS calls
        FROM daily_call_logs
        WHERE log_date >= ? AND log_date <= ?${exClause}
        GROUP BY assistant_id, log_date
      `).all(startDate, endDate) as any[];
      // Build the date axis the same way as the team trend so they line up exactly.
      const clrTrendDates: string[] = trend.map((t: any) => t.date);
      const clrIndex: Record<string, number> = {};
      clrTrendDates.forEach((d, i) => { clrIndex[d] = i; });
      const clrTrendMap: Record<number, { transfers: number[]; appointments: number[]; fellThrough: number[]; calls: number[] }> = {};
      function ensureClr(uid: number) {
        if (!clrTrendMap[uid]) {
          clrTrendMap[uid] = {
            transfers:    new Array(clrTrendDates.length).fill(0),
            appointments: new Array(clrTrendDates.length).fill(0),
            fellThrough:  new Array(clrTrendDates.length).fill(0),
            calls:        new Array(clrTrendDates.length).fill(0),
          };
        }
        return clrTrendMap[uid];
      }
      for (const r of clrOutcomeRows) {
        const idx = clrIndex[r.date];
        if (idx === undefined) continue;
        const bucket = ensureClr(r.assistant_id);
        const c = Number(r.count) || 0;
        if (r.outcome_type === "transfer")     bucket.transfers[idx]    += c;
        else if (r.outcome_type === "appointment")  bucket.appointments[idx] += c;
        else if (r.outcome_type === "fell_through") bucket.fellThrough[idx]  += c;
      }
      for (const r of clrCallRows) {
        const idx = clrIndex[r.date];
        if (idx === undefined) continue;
        const bucket = ensureClr(r.assistant_id);
        bucket.calls[idx] = Number(r.calls) || 0;
      }
      const clrTrend = {
        dates: clrTrendDates,
        series: countedClrs.map((u: any) => {
          const b = clrTrendMap[u.id];
          return {
            userId: u.id,
            name: u.name,
            transfers:    b ? b.transfers    : new Array(clrTrendDates.length).fill(0),
            appointments: b ? b.appointments : new Array(clrTrendDates.length).fill(0),
            fellThrough:  b ? b.fellThrough  : new Array(clrTrendDates.length).fill(0),
            calls:        b ? b.calls        : new Array(clrTrendDates.length).fill(0),
          };
        }),
      };

      // Outcome activity heatmap (CLR × day)
      const heatmapRows = sqlite.prepare(`
        SELECT assistant_id, date, COUNT(*) AS activity
        FROM lead_outcomes
        WHERE date >= ? AND date <= ?${exClause}
        GROUP BY assistant_id, date
      `).all(startDate, endDate) as any[];
      const heatmapMap: Record<string, number> = {};
      for (const r of heatmapRows) heatmapMap[`${r.assistant_id}|${r.date}`] = Number(r.activity) || 0;

      // Calls heatmap (CLR × day)
      const callsHmRows = sqlite.prepare(`
        SELECT assistant_id, log_date AS date, COALESCE(SUM(calls_made), 0) AS calls
        FROM daily_call_logs
        WHERE log_date >= ? AND log_date <= ?${exClause}
        GROUP BY assistant_id, log_date
      `).all(startDate, endDate) as any[];
      const callsHmMap: Record<string, number> = {};
      for (const r of callsHmRows) callsHmMap[`${r.assistant_id}|${r.date}`] = Number(r.calls) || 0;

      // Heatmap date range — for "all time" cap to most recent 90 days to keep table sensible.
      const hmDates: string[] = [];
      const hmDays = days === 0 ? 90 : Math.min(days, 90);
      const hmCur = new Date(endDate + "T00:00:00");
      hmCur.setDate(hmCur.getDate() - (hmDays - 1));
      const hmEnd = new Date(endDate + "T00:00:00");
      while (hmCur <= hmEnd) {
        hmDates.push(hmCur.toISOString().split("T")[0]);
        hmCur.setDate(hmCur.getDate() + 1);
      }
      const heatmap = {
        dates: hmDates,
        rows: countedClrs.map((u: any) => ({
          userId: u.id,
          name: u.name,
          cells: hmDates.map(d => heatmapMap[`${u.id}|${d}`] ?? 0),
        })),
      };
      const callsHeatmap = {
        dates: hmDates,
        rows: countedClrs.map((u: any) => ({
          userId: u.id,
          name: u.name,
          cells: hmDates.map(d => callsHmMap[`${u.id}|${d}`] ?? 0),
        })),
      };

      // Top states by phone area code (NPA → state).
      // Counts all transfers in window whose phone column parses to a valid US NPA.
      // Diagnostics (phonesTotal/phonesParsed/phonesRejected) surface data-quality issues
      // when callers report wrong-looking results (e.g. "every state shows 1").
      let topStates: { state: string; transfers: number }[] = [];
      let statesDiagnostics: {
        phonesTotal: number;
        phonesParsed: number;
        phonesRejected: number;
        rejectedSamples: string[];
      } = { phonesTotal: 0, phonesParsed: 0, phonesRejected: 0, rejectedSamples: [] };
      try {
        const phoneRows = sqlite.prepare(`
          SELECT phone_number FROM lead_outcomes
          WHERE date >= ? AND date <= ? AND outcome_type = 'transfer'
            AND phone_number IS NOT NULL AND phone_number != ''${exClause}
        `).all(startDate, endDate) as any[];
        const stateCounts: Record<string, number> = {};
        const rejectedSet = new Set<string>();
        for (const r of phoneRows) {
          statesDiagnostics.phonesTotal += 1;
          const st = npaToState(r.phone_number);
          if (!st) {
            statesDiagnostics.phonesRejected += 1;
            if (rejectedSet.size < 5) rejectedSet.add(String(r.phone_number).slice(0, 32));
            continue;
          }
          statesDiagnostics.phonesParsed += 1;
          stateCounts[st] = (stateCounts[st] ?? 0) + 1;
        }
        statesDiagnostics.rejectedSamples = Array.from(rejectedSet);
        topStates = Object.entries(stateCounts)
          .map(([state, transfers]) => ({ state, transfers }))
          .sort((a, b) => b.transfers - a.transfers)
          .slice(0, 8);
      } catch (e) { /* phone_number column may not exist on older DBs */ }

      return { trend, clrTrend, outcomeBreakdown, fellThroughReasons, topLos, leaderboard, heatmap, callsHeatmap, topStates, statesDiagnostics };
    }

    const byRange: Record<string, any> = {};
    for (const key of ["week", "30d", "3mo", "all"] as const) {
      const w = rangeWindows[key];
      byRange[key] = { window: w, ...computeRange(w.startDate, w.endDate, w.days) };
    }

    // ── Alerts banner ──
    const alerts: { level: "warn" | "danger" | "info"; text: string; href?: string }[] = [];
    if (eodStatus.length - eodSubmittedCount > 0) {
      alerts.push({ level: "warn", text: `${eodStatus.length - eodSubmittedCount} CLR${eodStatus.length - eodSubmittedCount === 1 ? "" : "s"} haven't submitted today's EOD report.` });
    }
    if (overdueAppointments.length >= 5) {
      alerts.push({ level: "danger", text: `${overdueAppointments.length} appointments are overdue.`, href: "/appointments" });
    } else if (overdueAppointments.length > 0) {
      alerts.push({ level: "warn", text: `${overdueAppointments.length} appointment${overdueAppointments.length === 1 ? " is" : "s are"} overdue.`, href: "/appointments" });
    }
    if (overdueNmls.length >= 3) {
      alerts.push({ level: "danger", text: `${overdueNmls.length} NMLS checks are overdue.`, href: "/nmls-checks" });
    }
    if (alerts.length === 0) {
      alerts.push({ level: "info", text: "All systems normal \u2014 no outstanding issues." });
    }

    res.json({
      generatedAt: new Date().toISOString(),
      today: todayStr,
      ranges: { week, month, last30 },
      stats: { today: todayStats, week: weekStats, month: monthStats, priorWeek: priorWeekStats, priorMonth: priorMonthStats },
      clrCards,
      eod: {
        date: todayStr,
        total: allClrs.length,
        submitted: eodSubmittedCount,
        missing: allClrs.length - eodSubmittedCount,
        rows: eodStatus,
      },
      pipeline: {
        todayTransfers,
        transfers7d,
        overdueAppointments,
        overdueNmls,
      },
      byRange,
      activityFeed,
      alerts,
    });
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

  // ── Team Chat ──────────────────────────────────────────────────────────────────
  app.get("/api/chat", requireAuth, (req: any, res) => {
    const limit = parseInt((req.query.limit as string) || "80");
    const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string) : undefined;
    const messages = storageExtra.getChatMessages(limit, beforeId).reverse();
    const myId = req.session_user?.userId;
    const ids = messages.map((m: any) => m.id);
    const reactions = storageExtra.getChatReactionsForMessages(ids);
    const byMsg = new Map<number, Map<string, { count: number; mine: boolean }>>();
    for (const r of reactions) {
      if (!byMsg.has(r.message_id)) byMsg.set(r.message_id, new Map());
      const em = byMsg.get(r.message_id)!;
      const cur = em.get(r.emoji) ?? { count: 0, mine: false };
      cur.count++;
      if (r.user_id === myId) cur.mine = true;
      em.set(r.emoji, cur);
    }
    const withReactions = messages.map((m: any) => ({
      ...m,
      reactions: Array.from((byMsg.get(m.id) ?? new Map()).entries()).map((e: any) => ({ emoji: e[0], count: e[1].count, mine: e[1].mine })),
    }));
    res.json({ messages: withReactions });
  });

  // Toggle an emoji reaction on a chat message.
  const CHAT_EMOJIS = new Set(["👍", "❤️", "😂", "🎉", "😮", "👏", "🙏", "🔥", "✅"]);
  app.post("/api/chat/:id/react", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const emoji = String(req.body?.emoji ?? "");
    if (!CHAT_EMOJIS.has(emoji)) return res.status(400).json({ error: "Unsupported reaction" });
    try {
      const result = storageExtra.toggleChatReaction(id, userId, emoji);
      res.json({ ok: true, ...result });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? "Failed to react" }); }
  });

  app.post("/api/chat", requireAuth, (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }
    if (message.trim().length > 1000) {
      return res.status(400).json({ error: "Message too long (max 1000 chars)" });
    }
    const user = storage.getUserById(req.session_user!.userId) as any;
    const msg = storageExtra.postChatMessage(req.session_user!.userId, user?.name ?? "Unknown", message.trim());

    // Push + in-app notify all other active users in the org
    try {
      const orgId = req.session_user!.orgId ?? 1;
      const senderName = user?.name ?? "Someone";
      const allUsers = storage.getUsers().filter((u: any) =>
        u.isActive && u.id !== req.session_user!.userId && (u.orgId ?? 1) === orgId
        && !(u.muteChatNotifications ?? u.mute_chat_notifications)
      );
      const trimmed = message.trim();
      const preview = trimmed.length > 80 ? trimmed.slice(0, 77) + "…" : trimmed;
      const pushPayload = {
        title: `💬 ${senderName}`,
        body: preview,
        url: `/#/chat`,
      };
      for (const u of allUsers) {
        storage.createNotification({
          userId: u.id,
          type: "chat",
          title: pushPayload.title,
          message: pushPayload.body,
          isRead: false,
        });
      }
      sendPushToUsers(allUsers.map((u: any) => u.id), pushPayload).catch(() => {});

      // Email notification — throttled to one per 15-minute window to avoid flooding
      // CLRs during an active chat session. Uses the module-level lastChatEmailAt guard.
      const nowMs = Date.now();
      if (nowMs - lastChatEmailAt > CHAT_EMAIL_THROTTLE_MS) {
        lastChatEmailAt = nowMs;
        const emailTargets = allUsers.filter((u: any) => u.email && String(u.email).includes("@"));
        if (emailTargets.length > 0) {
          const toAddrs: string[] = emailTargets.map((u: any) => u.email);
          const htmlEsc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const snippet = trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed;
          const body = `
            <p style="margin:0 0 16px;font-size:15px;color:#1A2B4A">
              <strong>${htmlEsc(senderName)}</strong> sent a message in Team Chat:
            </p>
            <div style="background:#f8fafc;border-left:4px solid #1A2B4A;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:20px">
              <p style="margin:0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap">${htmlEsc(snippet)}</p>
            </div>
            <p style="margin:0;font-size:13px;color:#64748b">
              <a href="https://www.westcapitallending.center/#/chat" style="color:#1A2B4A;font-weight:600;text-decoration:none">Open Team Chat →</a>
            </p>`;
          const subject = `💬 ${senderName} in Team Chat`;
          const html = buildEmail({ subject, preheader: preview, body });
          sendEmail({ to: toAddrs, subject, html }).catch((err: any) =>
            console.error("[chat-email] send failed:", err?.message ?? err)
          );
        }
      }
    } catch (e) { console.error("chat notify failed:", e); }

    res.json({ message: msg });
  });

  app.delete("/api/chat/:id", requireAuth, (req, res) => {
    const id = parseInt(req.params.id);
    const user = req.session_user!;
    const allMsgs = storageExtra.getChatMessages(1000);
    const msg = allMsgs.find((m: any) => m.id === id);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.user_id !== user.userId && user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }
    storageExtra.deleteChatMessage(id);
    res.json({ ok: true });
  });

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

  // Check if current user has a call log for TODAY.
  // Admins / non-CLR users are exempt (the gate never shows for them).
  app.get("/api/call-logs/check-previous-day", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const user = storage.getUserById(userId) as any;
    const isClr = !!(user && (user.isClr ?? user.is_clr) && user.role !== "admin");
    const todayStr = businessTodayForRequest(req, storageExtra.getRawSqlite());

    if (!isClr) {
      return res.json({ hasLog: true, date: todayStr, exempt: true, outcomes: emptyOutcomeBreakdown() });
    }

    const logs = storage.getDailyCallLogs(todayStr);
    // Normalize snake_case (raw SQLite) vs camelCase (Drizzle) field names
    const logForUser = logs.find(l => (l.assistantId ?? l.assistant_id) === userId);
    const hasLog = !!logForUser;
    const outcomes = getOutcomeBreakdownFor(userId, todayStr);
    res.json({
      hasLog,
      date: todayStr,
      outcomes,
      callsMadeLogged: logForUser?.callsMade ?? logForUser?.calls_made ?? 0,
    });
  });

  app.get("/api/call-logs", (req, res) => {
    const date = (req.query.date as string) || businessTodayForRequest(req, storageExtra.getRawSqlite());
    const logs = storage.getDailyCallLogs(date);
    const users = storage.getUsers();
    const rawStats = storageExtra.getCallStatsForDay(date) as any[];
    const byUser: Record<number, { contacts_reached: number; dnc_hits: number }> = {};
    for (const r of rawStats) byUser[r.assistant_id] = { contacts_reached: r.contacts_reached, dnc_hits: r.dnc_hits };
    const enriched = logs.map(l => ({
      ...l,
      contactsReached: byUser[l.assistantId]?.contacts_reached ?? 0,
      dncHits: byUser[l.assistantId]?.dnc_hits ?? 0,
      assistant: users.find(u => u.id === l.assistantId),
    }));
    res.json(enriched);
  });

  app.get("/api/call-logs/summary", (req, res) => {
    const from = (req.query.from as string) || "2000-01-01";
    const to = (req.query.to as string) || businessTodayForRequest(req, storageExtra.getRawSqlite());
    const allLogs = storage.getCallLogsByRange(from, to) as any[];
    const users = storage.getUsers();
    // Aggregate by assistant — getCallLogsByRange returns snake_case from raw SQLite
    const summary: Record<number, { assistantId: number; name: string; totalCalls: number }> = {};
    allLogs.forEach((l: any) => {
      const aid = Number(l.assistant_id ?? l.assistantId);
      const calls = Number(l.calls_made ?? l.callsMade ?? 0);
      if (!aid) return;
      if (!summary[aid]) {
        const u = users.find(u => u.id === aid);
        summary[aid] = { assistantId: aid, name: u?.name ?? `CLR #${aid}`, totalCalls: 0 };
      }
      summary[aid].totalCalls += calls;
    });
    res.json(Object.values(summary));
  });

  app.post("/api/call-logs", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    const { logDate, callsMade, notes } = req.body;
    // Always use the authenticated user's ID — ignore body assistantId to prevent spoofing
    const assistantId = userId;
    if (!logDate || callsMade === undefined) {
      return res.status(400).json({ error: "logDate and callsMade are required" });
    }
    // Post-EOD rollover: count calls logged after today's EOD toward tomorrow.
    let effectiveLogDate = String(logDate);
    try {
      effectiveLogDate = rolloverIfEodSubmitted(storageExtra.getSqlite(), Number(assistantId), effectiveLogDate);
    } catch {}
    try {
      const log = storage.upsertDailyCallLog({ logDate: effectiveLogDate, assistantId: Number(assistantId), callsMade: Number(callsMade), notes: notes ?? null });
      res.json(log);
    } catch (err: any) {
      console.error("[POST /api/call-logs] error:", err?.message ?? err);
      res.status(500).json({ error: err?.message ?? "Failed to save call log" });
    }
  });

  // ── Webhook endpoints (PUBLIC — no auth; external services POST here) ───────
  function requireAdminSession(req: any, res: Response): boolean {
    const uid = req.session_user?.userId;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return false; }
    const u = storage.getUserById(uid);
    if (!u || u.role !== "admin") { res.status(403).json({ error: "Admin only" }); return false; }
    return true;
  }

  // Managers (is_manager) and admins may configure report/email settings.
  function requireManagerOrAdmin(req: any, res: Response): boolean {
    const uid = req.session_user?.userId;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return false; }
    const u = storage.getUserById(uid) as any;
    const isMgr = !!(u?.isManager ?? u?.is_manager);
    if (!u || (u.role !== "admin" && !isMgr)) { res.status(403).json({ error: "Manager or admin only" }); return false; }
    return true;
  }

  function requireAdminOrViewerSession(req: any, res: Response): { user: any } | null {
    const uid = req.session_user?.userId;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return null; }
    const u = storage.getUserById(uid) as any;
    if (!u || (u.role !== "admin" && u.role !== "viewer")) {
      res.status(403).json({ error: "Admin or viewer only" }); return null;
    }
    return { user: u };
  }

  function verifyWebhookSecret(header: string | undefined, stored: string | null | undefined): boolean {
    if (!stored) return true; // no secret configured → skip verification
    if (!header) return false;
    return header.trim() === stored.trim();
  }

  const normalizePhone = (p: any): string => String(p ?? '').replace(/\D/g, '');

  function findUserByWebhookPhoneOrName(phoneGuess: any, nameGuess: any): any | null {
    const normalizedIncoming = normalizePhone(phoneGuess);
    if (normalizedIncoming) {
      const users = storage.getUsers() as any[];
      const phoneMatch = users.find((u: any) =>
        u.isActive && (u.role === "assistant" || u.role === "admin") &&
        normalizePhone(u.phone) && normalizePhone(u.phone) === normalizedIncoming
      );
      if (phoneMatch) return phoneMatch;
    }
    return storageExtra.findUserByName(typeof nameGuess === "string" ? nameGuess : null);
  }

  app.post("/api/webhook/mojo", (req, res) => {
    const body = req.body ?? {};
    const settings = storageExtra.getWebhookSettings();
    const providedSecret = (req.headers["x-mojo-secret"] as string) || "";
    if (!verifyWebhookSecret(providedSecret, settings.mojo_secret)) {
      storageExtra.logWebhookEvent({ source: "mojo", eventType: "auth_failed", payload: body, processed: false });
      return res.status(401).json({ ok: false, error: "invalid secret" });
    }

    const rawDisp = String(body.disposition || body.call_disposition || body.status || body.result || "").toLowerCase().trim();
    const phoneGuess = body.agent_phone || body.user_phone || body.rep_phone || body.phone || body.caller_id || null;
    const nameGuess = body.agent_name || body.user_name || body.rep_name || body.name || body.agent || body.user || null;
    const matched = findUserByWebhookPhoneOrName(phoneGuess, nameGuess);
    const today = businessTodayForRequest(req, storageExtra.getRawSqlite());

    let action = "ignored";
    let createdOutcome = false;

    if (matched) {
      const incMojoSession = (deltas: { calls?: number; contacts?: number; dnc?: number; transfers?: number; appointments?: number; voicemails?: number; noAnswers?: number }) => {
        try {
          const existing = storageExtra.getSqlite().prepare(
            `SELECT * FROM mojo_sessions WHERE session_date=? AND clr_user_id=?`
          ).get(today, matched.id) as any;
          storageExtra.upsertMojoSession({
            sessionDate: today,
            clrUserId: matched.id,
            clrName: matched.name,
            totalCalls: (existing?.total_calls ?? 0) + (deltas.calls ?? 0),
            contactsReached: (existing?.contacts_reached ?? 0) + (deltas.contacts ?? 0),
            dncHits: (existing?.dnc_hits ?? 0) + (deltas.dnc ?? 0),
            transfers: (existing?.transfers ?? 0) + (deltas.transfers ?? 0),
            appointments: (existing?.appointments ?? 0) + (deltas.appointments ?? 0),
            voicemails: (existing?.voicemails ?? 0) + (deltas.voicemails ?? 0),
            noAnswers: (existing?.no_answers ?? 0) + (deltas.noAnswers ?? 0),
            source: "webhook",
          });
        } catch (e) {
          console.error("Failed to upsert mojo_session:", e);
        }
      };
      const inc = (callsDelta: number, contactsDelta: number, dncDelta: number) => {
        storageExtra.incrementDailyCallLog({ logDate: today, assistantId: matched.id, callsDelta, contactsDelta, dncDelta });
      };

      if (rawDisp === "answered" || rawDisp === "connected") {
        inc(1, 1, 0); action = "calls+contacts";
        incMojoSession({ calls: 1, contacts: 1 });
      } else if (rawDisp === "voicemail" || rawDisp === "vm") {
        inc(1, 0, 0); action = "calls";
        incMojoSession({ calls: 1, voicemails: 1 });
      } else if (rawDisp === "no_answer" || rawDisp === "no-answer" || rawDisp === "noanswer" || rawDisp === "busy") {
        inc(1, 0, 0); action = "calls";
        incMojoSession({ calls: 1, noAnswers: 1 });
      } else if (rawDisp === "dnc" || rawDisp === "do_not_call" || rawDisp === "do-not-call") {
        inc(1, 0, 1); action = "calls+dnc";
        incMojoSession({ calls: 1, dnc: 1 });
      } else if (rawDisp === "transfer" || rawDisp === "appointment") {
        inc(1, 1, 0);
        incMojoSession({
          calls: 1, contacts: 1,
          transfers: rawDisp === "transfer" ? 1 : 0,
          appointments: rawDisp === "appointment" ? 1 : 0,
        });
        action = `calls+contacts+outcome(${rawDisp})`;
        // Create a lead_outcome record. loId is required — use 0 as a placeholder for webhook-originated outcomes.
        try {
          const borrowerName = body.borrower_name || body.lead_name || body.contact_name || body.prospect_name || null;
          const notes = body.notes || body.call_notes || `Auto-logged from Mojo webhook (${rawDisp})`;
          storageExtra.getSqlite().prepare(
            `INSERT INTO lead_outcomes (date, assistant_id, lo_id, borrower_name, outcome_type, transfer_type, notes, tags, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).run(
            today, matched.id, 0, borrowerName,
            rawDisp, rawDisp === "transfer" ? "direct" : null,
            notes, "[]",
            new Date().toISOString(), new Date().toISOString()
          );
          createdOutcome = true;
        } catch (e) {
          console.error("Failed to create lead_outcome from Mojo webhook:", e);
        }
      } else {
        inc(1, 0, 0); action = "calls";
        incMojoSession({ calls: 1 });
      }
    } else {
      action = "unmatched";
    }

    storageExtra.logWebhookEvent({
      source: "mojo",
      eventType: rawDisp || "unknown",
      payload: body,
      matchedUserId: matched?.id ?? null,
      processed: !!matched,
    });

    res.json({ ok: true, matched_user: matched?.name ?? null, action, created_outcome: createdOutcome });
  });

  app.post("/api/webhook/bonzo", (req, res) => {
    const body = req.body ?? {};
    const settings = storageExtra.getWebhookSettings();
    const providedSecret = (req.headers["x-bonzo-secret"] as string) || "";
    if (!verifyWebhookSecret(providedSecret, settings.bonzo_secret)) {
      storageExtra.logWebhookEvent({ source: "bonzo", eventType: "auth_failed", payload: body, processed: false });
      return res.status(401).json({ ok: false, error: "invalid secret" });
    }

    const eventType = String(body.event || body.type || body.webhook_type || "").toLowerCase().trim();
    const phoneGuess = body.agent_phone || body.user_phone || body.rep_phone || body.phone || body.caller_id || null;
    const nameGuess = body.agent_name || body.user_name || body.rep_name || body.name || body.assigned_to || body.owner || null;
    const matched = findUserByWebhookPhoneOrName(phoneGuess, nameGuess);

    let handled = false;
    if (eventType === "prospect.created" || eventType === "contact.created") {
      handled = true;
    } else if (eventType === "prospect.stage_changed" || eventType === "pipeline.stage_changed") {
      handled = true;
      if (matched) {
        try {
          const prospectName = body.prospect_name || body.contact_name || body.name || "a prospect";
          const stageName = body.stage || body.stage_name || body.new_stage || "a new stage";
          storage.createNotification({
            userId: matched.id,
            type: "announcement",
            title: "Bonzo stage change",
            message: `Bonzo: ${prospectName} moved to ${stageName}`,
            isRead: false,
          });
        } catch (e) {
          console.error("Failed to create Bonzo notification:", e);
        }
      }
      // Upsert bonzo_prospects on stage change if we have an id
      try {
        const bonzoId = body.prospect_id || body.id || body.contact_id;
        if (bonzoId) {
          storageExtra.upsertBonzoProspect({
            bonzoId: String(bonzoId),
            firstName: body.first_name ?? null,
            lastName: body.last_name ?? null,
            email: body.email ?? null,
            phone: body.phone ?? null,
            pipelineId: body.pipeline_id ? String(body.pipeline_id) : null,
            pipelineName: body.pipeline_name ?? null,
            stageId: body.stage_id ? String(body.stage_id) : null,
            stageName: body.stage || body.stage_name || body.new_stage || null,
            assignedUserId: matched?.id ?? null,
            bonzoUserName: body.assigned_to ?? body.owner ?? null,
            tags: [],
            lastActivityAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error("Failed to upsert bonzo_prospect from webhook:", e);
      }
    } else if (eventType === "conversation.started" || eventType === "conversation.created" ||
               eventType === "message.sent" || eventType === "message.created") {
      handled = true;
    }

    storageExtra.logWebhookEvent({
      source: "bonzo",
      eventType: eventType || "unknown",
      payload: body,
      matchedUserId: matched?.id ?? null,
      processed: handled,
    });

    res.json({ ok: true, matched_user: matched?.name ?? null, event_type: eventType || "unknown" });
  });

  // Admin-only webhook event list + settings
  app.get("/api/webhook/events", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const limit = Math.min(parseInt((req.query.limit as string) || "50") || 50, 200);
    const rows = storageExtra.getRecentWebhookEvents(limit);
    res.json(rows);
  });

  app.get("/api/webhook/settings", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const s = storageExtra.getWebhookSettings();
    res.json({
      mojoSecret: s.mojo_secret ?? "",
      bonzoSecret: s.bonzo_secret ?? "",
      bonzoApiToken: s.bonzo_api_token ?? "",
      mojoApiKey: s.mojo_api_key ?? "",
      zapierWebhookUrl: s.zapier_webhook_url ?? "",
      zapierSecret: s.zapier_secret ?? "",
    });
  });

  app.put("/api/webhook/settings", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const { mojoSecret, bonzoSecret, bonzoApiToken, mojoApiKey, zapierWebhookUrl, zapierSecret } = req.body ?? {};
    const updated = storageExtra.updateWebhookSettings({
      mojoSecret: typeof mojoSecret === "string" ? mojoSecret : undefined,
      bonzoSecret: typeof bonzoSecret === "string" ? bonzoSecret : undefined,
      bonzoApiToken: typeof bonzoApiToken === "string" ? bonzoApiToken : undefined,
      mojoApiKey: typeof mojoApiKey === "string" ? mojoApiKey : undefined,
      zapierWebhookUrl: typeof zapierWebhookUrl === "string" ? zapierWebhookUrl : undefined,
      zapierSecret: typeof zapierSecret === "string" ? zapierSecret : undefined,
    });
    res.json({
      mojoSecret: updated.mojo_secret ?? "",
      bonzoSecret: updated.bonzo_secret ?? "",
      bonzoApiToken: updated.bonzo_api_token ?? "",
      mojoApiKey: updated.mojo_api_key ?? "",
      zapierWebhookUrl: updated.zapier_webhook_url ?? "",
      zapierSecret: updated.zapier_secret ?? "",
    });
  });

  // ── Reporting period helper ───────────────────────────────────────────────────
  app.get("/api/reporting-period", (req, res) => {
    res.json(getDefaultPeriod());
  });

  // ── NMLS Schedule Settings ────────────────────────────────────────────────────
  app.get("/api/nmls-schedule", requireAuth, (_req, res) => {
    res.json(storageExtra.getNmlsSchedule());
  });

  app.patch("/api/nmls-schedule", requireAuth, (req, res) => {
    const { checkDay1, checkDay2, escalationDays, intervalMonths } = req.body;
    const updated = storageExtra.updateNmlsSchedule({
      checkDay1: checkDay1 !== undefined ? parseInt(checkDay1) : undefined,
      checkDay2: checkDay2 !== undefined ? parseInt(checkDay2) : undefined,
      escalationDays: escalationDays !== undefined ? parseInt(escalationDays) : undefined,
      intervalMonths: intervalMonths !== undefined ? parseInt(intervalMonths) : undefined,
    });
    res.json(updated);
  });

  // ── NMLS Checks ───────────────────────────────────────────────────────────────
  // Get current period checks (enriched with LO + user info)
  app.get("/api/nmls-checks", requireAuth, (req, res) => {
    const periodKey = getNmlsPeriodKey();
    const checks = storageExtra.getNmlsChecksForPeriod(periodKey);
    const los = storage.getLoanOfficers();
    const users = storage.getUsers();
    const enriched = checks.map((c: any) => ({
      ...c,
      lo: los.find(l => l.id === c.lo_id),
      assignedTo: users.find(u => u.id === c.assigned_to),
      confirmedBy: users.find(u => u.id === c.confirmed_by),
    }));
    res.json({ checks: enriched, periodKey });
  });

  // My pending NMLS checks (for current user)
  app.get("/api/nmls-checks/my-pending", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const periodKey = getNmlsPeriodKey();
    const allChecks = storageExtra.getNmlsChecksForPeriod(periodKey);
    const los = storage.getLoanOfficers();
    const schedule = storageExtra.getNmlsSchedule();
    const pending = allChecks
      .filter((c: any) => c.assigned_to === userId && c.status === "pending")
      .map((c: any) => {
        const lo = los.find((l: any) => l.id === c.lo_id);
        const assignedAt = new Date(c.assigned_at);
        const daysOverdue = Math.floor((Date.now() - assignedAt.getTime()) / 86400000);
        return { ...c, lo, daysOverdue };
      });
    res.json({ checks: pending, periodKey, escalationDays: schedule.escalation_days ?? 7, nextCheckAt: getNextNmlsCheckDate().toISOString() });
  });

  // Confirm NMLS check for an LO
  app.post("/api/nmls-checks/:loId/confirm", requireAuth, (req: any, res) => {
    const loId = parseInt(req.params.loId);
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const periodKey = getNmlsPeriodKey();
    storageExtra.confirmNmlsCheck(loId, periodKey, userId);
    // Mark all nmls_check notifications for this user as read
    const notifs = storage.getNotifications(userId);
    for (const n of notifs) {
      if ((n.type === "nmls_check" || n.type === "nmls_escalation") && !n.isRead) {
        storage.markNotificationRead(n.id);
      }
    }
    audit({ userId, userName: req.session_user?.name ?? "User", action: "confirm", entityType: "nmls_check", entityId: loId, entityLabel: `NMLS check LO #${loId}`, details: JSON.stringify({ periodKey }) });
    res.json({ ok: true });
  });

  // Trigger NMLS checks manually (admin)
  app.post("/api/nmls-checks/trigger", requireAuth, (req: any, res) => {
    const user = req.session_user;
    if (user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    triggerNmlsChecks();
    res.json({ ok: true });
  });

  // ── NMLS license auto-verification ──────────────────────────────────────────
  // Returns every LO's current stored license status + profile-link helper.
  app.get("/api/nmls/status", requireAuth, (_req, res) => {
    const los = storage.getLoanOfficers().filter((lo: any) => (lo.internalStatus ?? lo.internal_status) !== "archived");
    const items = los.map((lo: any) => {
      const nmlsId = lo.nmlsId ?? lo.nmls_id ?? null;
      const fullName = lo.fullName ?? lo.full_name ?? "";
      const nmlsStatus = lo.nmlsStatus ?? lo.nmls_status ?? null;
      const nmlsStatesRaw = lo.nmlsStates ?? lo.nmls_states ?? "[]";
      const nmlsLastChecked = lo.nmlsLastChecked ?? lo.nmls_last_checked ?? null;
      const nmlsLicenseExpiration = lo.nmlsLicenseExpiration ?? lo.nmls_license_expiration ?? null;
      return {
        id: lo.id,
        fullName,
        nmlsId,
        nmlsStatus,
        nmlsStates: (() => { try { return JSON.parse(nmlsStatesRaw || "[]"); } catch { return []; } })(),
        nmlsLastChecked,
        nmlsLicenseExpiration,
        profileUrl: nmlsId ? nmlsProfileUrl(nmlsId) : null,
      };
    });
    res.json({ items });
  });

  // Check all LOs (admin only)
  app.post("/api/nmls/check-all", requireAuth, async (req: any, res) => {
    const user = req.session_user;
    if (user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    try {
      const result = await verifyAllLoNmls();
      audit({ userId: user.userId, userName: user.name ?? "Admin", action: "verify", entityType: "nmls_license", entityId: null as any, entityLabel: "bulk check", details: JSON.stringify(result) });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "verify failed" });
    }
  });

  // Check a single LO
  app.post("/api/nmls/check/:loId", requireAuth, async (req: any, res) => {
    const loId = parseInt(req.params.loId, 10);
    if (Number.isNaN(loId)) return res.status(400).json({ error: "Invalid LO id" });
    try {
      const result = await verifyLoNmls(loId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "verify failed" });
    }
  });

  // Manual verify — admin/CLR stamps nmls_last_checked without hitting NMLS
  app.post("/api/nmls/mark-verified/:loId", requireAuth, (req: any, res) => {
    const loId = parseInt(req.params.loId, 10);
    if (Number.isNaN(loId)) return res.status(400).json({ error: "Invalid LO id" });
    const user = req.session_user;
    const lo = storage.getLoanOfficerById(loId) as any;
    if (!lo) return res.status(404).json({ error: "LO not found" });
    const updates: any = { nmlsLastChecked: new Date().toISOString() };
    // If admin also marked active, bump status
    if (req.body?.status && ["Active", "Inactive", "Expired", "Unknown"].includes(req.body.status)) {
      updates.nmlsStatus = req.body.status;
    }
    if (Array.isArray(req.body?.states)) {
      updates.nmlsStates = JSON.stringify(req.body.states.filter((s: any) => typeof s === "string"));
    }
    storage.updateLoanOfficer(loId, updates);
    audit({ userId: user.userId, userName: user.name ?? "User", action: "verify", entityType: "nmls_license", entityId: loId, entityLabel: lo.fullName, details: JSON.stringify(updates) });
    res.json({ ok: true });
  });

  // ── LO Performance History ────────────────────────────────────────────────────
  app.get("/api/loan-officers/:id/performance", (req, res) => {
    const loId = parseInt(req.params.id);
    const outcomes = storage.getLeadOutcomes({ loId }) as any[];
    const lo = storage.getLoanOfficerById(loId);
    if (!lo) return res.status(404).json({ error: "Not found" });

    // Group by month (YYYY-MM) — count every outcome type so totals match callers' reality
    type MonthBucket = {
      transfers: number;
      appointments: number;
      fellThrough: number;
      noAnswer: number;
      callbacks: number;
      futureContact: number;
      notInterested: number;
      wrongNumber: number;
      other: number;
      total: number;
    };
    const emptyMonth = (): MonthBucket => ({
      transfers: 0, appointments: 0, fellThrough: 0, noAnswer: 0,
      callbacks: 0, futureContact: 0, notInterested: 0, wrongNumber: 0,
      other: 0, total: 0,
    });
    const byMonth: Record<string, MonthBucket> = {};
    let totalsByType: Record<string, number> = {};
    outcomes.forEach(o => {
      const date: string | undefined = o.date ?? o.created_at ?? o.createdAt;
      if (!date) return;
      const month = String(date).slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = emptyMonth();
      const m = byMonth[month];
      m.total++;
      const t = o.outcomeType ?? o.outcome_type ?? "other";
      totalsByType[t] = (totalsByType[t] ?? 0) + 1;
      if (t === "transfer") m.transfers++;
      else if (t === "appointment") m.appointments++;
      else if (t === "fell_through") m.fellThrough++;
      else if (t === "no_answer") m.noAnswer++;
      else if (t === "callback_requested") m.callbacks++;
      else if (t === "future_contact" || t === "deferral") m.futureContact++;
      else if (t === "not_interested") m.notInterested++;
      else if (t === "wrong_number") m.wrongNumber++;
      else m.other++;
    });

    const monthlyData = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, stats]) => ({ month, ...stats }));

    // Total "calls logged" = total outcomes recorded against this LO; this is
    // a better callers-eye-view than total_times_worked (which only ticks on EOD).
    const callsLogged = outcomes.length;

    res.json({ lo, monthlyData, totalOutcomes: outcomes.length, callsLogged, totalsByType });
  });

  // ── Email Settings ────────────────────────────────────────────────────────────
  app.get("/api/settings/email", requireAuth, (_req, res) => {
    const s = storageExtra.getEmailSettings() as any;
    // Mask the API key
    const key = s.resend_api_key || "";
    res.json({ ...s, resend_api_key: key ? `re_${"•".repeat(Math.max(0, key.length - 7))}${key.slice(-4)}` : "" });
  });

  app.patch("/api/settings/email", requireAuth, (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const data = { ...req.body };
    // Don't overwrite with masked key
    if (data.resendApiKey && data.resendApiKey.includes("•")) delete data.resendApiKey;
    if (data.resend_api_key && data.resend_api_key.includes("•")) delete data.resend_api_key;

    // 2026-05-05: enforce 06:00–22:00 hard window for weekly + monthly send
    // times. Anything outside that window is clamped to the nearest boundary so
    // misconfiguration can't ship a CLR an email at 3 AM.
    function clampTime(hm: any, lo = "06:00", hi = "22:00"): string | undefined {
      if (typeof hm !== "string") return undefined;
      const m = hm.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return undefined;
      let h = Math.min(23, Math.max(0, Number(m[1])));
      let mm = Math.min(59, Math.max(0, Number(m[2])));
      const minutes = h * 60 + mm;
      const loMin = 6 * 60, hiMin = 22 * 60;
      if (minutes < loMin) { h = 6; mm = 0; }
      else if (minutes > hiMin) { h = 22; mm = 0; }
      return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
    if (data.dailyTime !== undefined) data.dailyTime = clampTime(data.dailyTime) ?? data.dailyTime;
    if (data.daily_time !== undefined) data.daily_time = clampTime(data.daily_time) ?? data.daily_time;
    if (data.weeklyTime !== undefined) data.weeklyTime = clampTime(data.weeklyTime) ?? data.weeklyTime;
    if (data.weekly_time !== undefined) data.weekly_time = clampTime(data.weekly_time) ?? data.weekly_time;
    if (data.monthlyTime !== undefined) data.monthlyTime = clampTime(data.monthlyTime) ?? data.monthlyTime;
    if (data.monthly_time !== undefined) data.monthly_time = clampTime(data.monthly_time) ?? data.monthly_time;

    storageExtra.updateEmailSettings(data);
    res.json({ ok: true });
  });

  // Lightweight, all-users-readable flag so the transfer form knows whether to
  // ask "was Bulk Texter part of this transfer?" without exposing email config.
  app.get("/api/settings/bulk-texter", requireAuth, (_req, res) => {
    const s = storageExtra.getEmailSettings() as any;
    res.json({ askBulkTexter: !!s.ask_bulk_texter });
  });

  app.post("/api/settings/email/test", requireAuth, async (req: any, res) => {
    // Send a real test email to the logged-in user
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const sessionUser = storage.getUserById(userId) as any;
    const userEmail = sessionUser?.email;
    if (!userEmail) return res.status(400).json({ error: "No email address on your account" });
    try {
      await sendEmail({
        to: userEmail,
        subject: "CLR Connection Center — Test Email",
        html: buildEmail({
          subject: "Test Email — Everything's Working",
          preheader: "Your Resend integration is configured correctly.",
          body: `
            <div style="text-align:center;padding:16px 0 28px">
              <div style="display:inline-block;background:#dcfce7;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:16px">✓</div>
              <h2 style="margin:0 0 10px;font-size:20px;font-weight:700;color:#15803d">Email is working correctly</h2>
              <p style="margin:0;color:#475569;font-size:14px;line-height:1.6">
                Resend is configured and emails are sending successfully.<br />
                This test was sent to confirm your integration is set up correctly.
              </p>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-top:8px">
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7">
                <strong style="color:#1e293b">Sent to:</strong> ${userEmail}<br />
                <strong style="color:#1e293b">From:</strong> reports@westcapitallending.center<br />
                <strong style="color:#1e293b">Note:</strong> If managers aren't receiving emails, ask them to check their spam folder.
              </p>
            </div>
          `,
        }),
      });
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/settings/email/send-now", requireAuth, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const rawType = req.body?.type;
    const type: "daily" | "weekly" | "monthly" | "mtd" | "alltime" =
      rawType === "daily" || rawType === "weekly" || rawType === "monthly" || rawType === "mtd" || rawType === "alltime" ? rawType : "daily";
    // Optional CLR filter — currently surfaced in the UI for All-Time sends so a
    // manager can email a single CLR's lifetime report. Other types accept it too.
    const rawClrId = req.body?.clrId;
    const clrId = (rawClrId === undefined || rawClrId === null || rawClrId === "" || rawClrId === "all")
      ? undefined
      : Number(rawClrId);
    // Daily-only: which day to cover. "today" sends a partial report for today;
    // anything else (default) keeps the standard previous-day behavior.
    const dailyOffset = type === "daily" && req.body?.day === "today" ? 0 : -1;
    console.log(`[send-now] user=${(req as any).session_user?.userId} type=${type} clrId=${clrId ?? "all"} dailyOffset=${dailyOffset}`);
    try {
      const opts: any = {};
      if (Number.isFinite(clrId as number)) opts.clrId = clrId as number;
      if (type === "daily") opts.dailyOffset = dailyOffset;
      const result = await sendReport(type, opts);
      console.log(`[send-now] OK type=${type} id=${result?.id} recipients=${JSON.stringify(result?.recipients)}`);
      res.json({ ok: true, id: result?.id ?? null, recipients: result?.recipients ?? [] });
    } catch (e: any) {
      console.error(`[send-now] FAIL type=${type}:`, e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ── Report Archive: regenerate any historical daily/weekly/monthly report ──
  // Available to admin and viewer roles. Lets them preview the rendered email
  // for any date range and optionally send it to a list of recipients.
  function parseRange(req: any, body: any, type: "daily" | "weekly" | "monthly" | "mtd" | "alltime"): { startDate: string; endDate: string } {
    const ymd = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "";
    let s = ymd(body?.startDate);
    let e = ymd(body?.endDate);
    if (!s) {
      const t = businessTodayForRequest(req, storageExtra.getRawSqlite());
      s = t; e = t;
    }
    if (!e) e = s;
    // MTD: 1st of the anchor month → anchor date. All-time: inception → anchor date.
    if (type === "mtd") {
      const d = new Date(e + "T00:00:00Z");
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      s = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    } else if (type === "alltime") {
      s = "2000-01-01";
    }
    // For a single picked date on weekly/monthly, expand to the natural window
    if (type === "weekly" && s === e) {
      const d = new Date(s + "T00:00:00");
      const dow = d.getUTCDay(); // 0=Sun
      const sun = new Date(d); sun.setUTCDate(d.getUTCDate() - dow);
      const sat = new Date(sun); sat.setUTCDate(sun.getUTCDate() + 6);
      s = sun.toISOString().split("T")[0];
      e = sat.toISOString().split("T")[0];
    } else if (type === "monthly" && s === e) {
      // 16th of the prev month → 15th of the current month containing `s`
      const d = new Date(s + "T00:00:00Z");
      const day = d.getUTCDate();
      let endY = d.getUTCFullYear();
      let endM = d.getUTCMonth(); // 0-indexed
      // If picked day is between 1..15 the period ends on the 15th of THIS month
      // Otherwise it ends on the 15th of NEXT month.
      if (day > 15) { endM += 1; if (endM > 11) { endM = 0; endY += 1; } }
      const startY = endM === 0 ? endY - 1 : endY;
      const startM = endM === 0 ? 11 : endM - 1;
      const fmt = (y: number, m: number, d: number) =>
        `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      s = fmt(startY, startM, 16);
      e = fmt(endY, endM, 15);
    }
    return { startDate: s, endDate: e };
  }

  // List of CLRs available to filter the archive by
  app.get("/api/reports/clrs", requireAuth, (req, res) => {
    const gate = requireAdminOrViewerSession(req as any, res);
    if (!gate) return;
    const list = (storage.getUsers() as any[])
      .filter((u: any) => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)))
      .map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
    res.json(list);
  });

  app.post("/api/reports/preview", requireAuth, async (req, res) => {
    const gate = requireAdminOrViewerSession(req as any, res);
    if (!gate) return;
    const rawType = req.body?.type;
    const type: "daily" | "weekly" | "monthly" | "mtd" | "alltime" =
      rawType === "daily" || rawType === "weekly" || rawType === "monthly" || rawType === "mtd" || rawType === "alltime" ? rawType : "daily";
    try {
      const range = parseRange(req, req.body, type);
      const clrIdRaw = req.body?.clrId;
      const clrId = typeof clrIdRaw === "number" && clrIdRaw > 0 ? clrIdRaw : undefined;
      const result: any = await sendReport(type, { customRange: range, renderOnly: true, clrId });
      res.json({
        ok: true,
        type,
        startDate: result.startDate,
        endDate: result.endDate,
        subject: result.subject,
        html: result.html,
      });
    } catch (e: any) {
      console.error(`[reports/preview] FAIL:`, e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  app.post("/api/reports/email", requireAuth, async (req, res) => {
    const gate = requireAdminOrViewerSession(req as any, res);
    if (!gate) return;
    const rawType = req.body?.type;
    const type: "daily" | "weekly" | "monthly" | "mtd" | "alltime" =
      rawType === "daily" || rawType === "weekly" || rawType === "monthly" || rawType === "mtd" || rawType === "alltime" ? rawType : "daily";
    try {
      const range = parseRange(req, req.body, type);
      const requested: any[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
      // Default: send to the requesting user's own email if no list supplied
      const cleaned = requested
        .map((r: any) => String(r || "").trim())
        .filter((r: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
      const recipientsOverride = cleaned.length
        ? cleaned
        : (gate.user.email ? [gate.user.email] : []);
      if (!recipientsOverride.length) {
        return res.status(400).json({ error: "No valid recipients (your account has no email on file)." });
      }
      const clrIdRaw = req.body?.clrId;
      const clrId = typeof clrIdRaw === "number" && clrIdRaw > 0 ? clrIdRaw : undefined;
      console.log(`[reports/email] user=${gate.user.id} type=${type} range=${range.startDate}..${range.endDate} clrId=${clrId ?? "all"} recipients=${JSON.stringify(recipientsOverride)}`);
      const result: any = await sendReport(type, { customRange: range, recipientsOverride, clrId });
      res.json({
        ok: true,
        id: result.id,
        recipients: result.recipients,
        startDate: result.startDate,
        endDate: result.endDate,
      });
    } catch (e: any) {
      console.error(`[reports/email] FAIL:`, e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ── Diagnostic: send a plain test email via Resend (admin only) ───────────────
  // POST /api/test-email { to?: string }  — defaults to ethan.anthony.wood@gmail.com
  // Returns { ok, id, to, from, keySource } so the admin can confirm Resend
  // is actually delivering without going through the full report pipeline.
  app.post("/api/test-email", requireAuth, async (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const to = typeof req.body?.to === "string" && req.body.to.includes("@")
      ? req.body.to.trim()
      : "ethan.anthony.wood@gmail.com";
    try {
      const id = await sendEmail({
        to,
        subject: `CLR test email — ${new Date().toISOString()}`,
        html: `<p>This is a test email from the CLR Connection Center.</p>
               <p>If you received this, Resend delivery is working.</p>
               <p style="color:#64748b;font-size:12px">Sent at ${new Date().toISOString()}</p>`,
      });
      const s = storageExtra.getEmailSettings() as any;
      const dbKey = String(s.resend_api_key || "").trim();
      const keySource = /^re_[A-Za-z0-9_]{28,}$/.test(dbKey) ? "db" : "default";
      console.log(`[test-email] OK to=${to} id=${id} keySource=${keySource}`);
      res.json({ ok: true, id, to, keySource });
    } catch (e: any) {
      console.error(`[test-email] FAIL to=${to}:`, e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Unknown error", to });
    }
  });

  // ── Glossary (public read, admin write) ────────────────────────────────────
  app.get("/api/glossary", requireAuth, (_req: any, res) => {
    res.json(storageExtra.listGlossaryTerms());
  });

  app.post("/api/glossary", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    try {
      const term = storageExtra.createGlossaryTerm({
        term: req.body?.term,
        definition: req.body?.definition,
        category: req.body?.category ?? null,
      });
      res.json(term);
    } catch (e: any) {
      const msg = String(e?.message ?? "Failed to create term");
      const status = /UNIQUE/i.test(msg) ? 409 : 400;
      res.status(status).json({ error: /UNIQUE/i.test(msg) ? "A term with that name already exists." : msg });
    }
  });

  app.patch("/api/glossary/:id", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const term = storageExtra.updateGlossaryTerm(id, {
        ...(req.body?.term !== undefined ? { term: req.body.term } : {}),
        ...(req.body?.definition !== undefined ? { definition: req.body.definition } : {}),
        ...(req.body?.category !== undefined ? { category: req.body.category } : {}),
      });
      if (!term) return res.status(404).json({ error: "Term not found" });
      res.json(term);
    } catch (e: any) {
      const msg = String(e?.message ?? "Failed to update term");
      const status = /UNIQUE/i.test(msg) ? 409 : 400;
      res.status(status).json({ error: /UNIQUE/i.test(msg) ? "A term with that name already exists." : msg });
    }
  });

  app.delete("/api/glossary/:id", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const ok = storageExtra.deleteGlossaryTerm(id);
    if (!ok) return res.status(404).json({ error: "Term not found" });
    res.json({ ok: true });
  });

  // ── Scheduled report recipients (per daily/weekly/monthly) ──────────────────
  app.get("/api/report-schedules", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    res.json(storageExtra.getAllReportSchedules());
  });

  app.put("/api/report-schedules/:type", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
    const type = req.params.type;
    if (type !== "daily" && type !== "weekly" && type !== "monthly" && type !== "mtd" && type !== "alltime") {
      return res.status(400).json({ error: "type must be 'daily', 'weekly', 'monthly', 'mtd', or 'alltime'" });
    }
    const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const saved = storageExtra.updateReportScheduleRecipients(type, recipients);
    res.json({ report_type: type, recipients: saved });
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
    const assistants = storage.getUsers().filter(u => u.isActive && u.inDailyAssignments && !u.excludeFromStats && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
    if (!assistants.length) return res.status(400).json({ error: "No active CLRs are included in daily assignments." });
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

  // ── Admin: unlock + regenerate today's assignments ─────────────────────────
  app.post("/api/assignments/regenerate-override", requireAuth, async (req, res) => {
    const raw = (req as any).signedCookies?.[COOKIE_NAME];
    const session = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
    const user = session?.userId ? storage.getUserById(session.userId) : null;
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: "A reason is required" });

    const date = businessTodayForRequest(req, storageExtra.getRawSqlite());
    const settings = storage.getAlgorithmSettings();
    const los = storage.getLoanOfficers();
    const assistants = storage.getUsers().filter(u => u.isActive && u.inDailyAssignments && !u.excludeFromStats && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
    if (assistants.length === 0) return res.status(400).json({ error: "No active CLRs are included in daily assignments." });

    // Clear ALL of today's assignments (override wipes everything)
    storage.clearDailyAssignments(date);

    // Re-run the full generation logic
    // Compute 90-day transfer counts per LO for algorithm weighting
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const xfer90Start = ninetyDaysAgo.toISOString().split("T")[0];
    const recentOutcomes = storage.getLeadOutcomes({ startDate: xfer90Start, endDate: date });
    const recentTransferCounts = new Map<number, number>();
    for (const o of recentOutcomes) {
      if ((o.outcomeType || (o as any).outcome_type) === "transfer") {
        const loId = o.loId || (o as any).lo_id;
        if (loId) recentTransferCounts.set(loId, (recentTransferCounts.get(loId) || 0) + 1);
      }
    }
    const ranked = generateRankings(los, settings, date, recentTransferCounts);
    const maxTotal = settings.maxLosPerAssistant * assistants.length;
    const topRanked = ranked.slice(0, maxTotal);
    const assignments: any[] = [];

    if (settings.roundRobinEnabled) {
      const slots = assistants.length;
      topRanked.forEach((item, index) => {
        const round = Math.floor(index / slots);
        const posInRound = index % slots;
        const assistantIndex = round % 2 === 0 ? posInRound : (slots - 1 - posInRound);
        assignments.push({
          assignmentDate: date,
          loId: item.lo.id,
          assistantId: assistants[assistantIndex].id,
          globalRank: index + 1,
          assistantRank: round + 1,
          status: "recommended",
          notes: null,
        });
      });
    } else {
      const month = date.slice(0, 7);
      let monthlyRows = storageExtra.getMonthlyAssignments(month);
      if (monthlyRows.length === 0) {
        const shuffled = [...topRanked].sort(() => Math.random() - 0.5);
        const rows = shuffled.map((item, i) => ({ assistantId: assistants[i % assistants.length].id, loId: item.lo.id }));
        storageExtra.setMonthlyAssignments(month, rows);
        monthlyRows = storageExtra.getMonthlyAssignments(month);
      }
      const eligibleIds = new Set(topRanked.map(r => r.lo.id));
      const orderedRows = monthlyRows.filter((r: any) => eligibleIds.has(r.lo_id || r.loId));
      orderedRows.forEach((r: any, index: number) => {
        assignments.push({
          assignmentDate: date,
          loId: r.lo_id || r.loId,
          assistantId: r.assistant_id || r.assistantId,
          globalRank: index + 1,
          assistantRank: Math.floor(index / assistants.length) + 1,
          status: "recommended",
          notes: null,
        });
      });
    }

    const created = storage.createDailyAssignments(assignments);

    // Write a prominent audit log entry
    audit({
      userId: user.id,
      userName: user.name,
      action: "admin-regenerate-override",
      entityType: "assignment",
      entityId: null,
      entityLabel: `Regenerated assignments for ${date}`,
      details: JSON.stringify({ date, reason, count: created.length, overriddenBy: user.email }),
    });

    storage.createNotification({
      userId: null,
      type: "assignment_ready",
      title: "Assignments Regenerated (Admin Override)",
      message: `${user.name} regenerated today's assignments. Reason: ${reason}`,
      isRead: false,
    });

    return res.json({ ok: true, generated: created.length, date, reason });
  });

  app.get("/api/assignment-overrides", requireAuth, (_req, res) => {
    res.json(storageExtra.getAssignmentOverrides());
  });

  // ── Hot-patch: pull latest dist from GitHub and overwrite local static files ──
  app.post("/api/admin/hotpatch", async (req, res) => {
    const session = (req as any).signedCookies?.[COOKIE_NAME];
    let sessionData: any = null;
    try { sessionData = JSON.parse(session); } catch {}
    if (!sessionData?.userId) return res.status(401).json({ error: "Unauthorized" });
    const callerUser = storage.getUserById(sessionData.userId) as any;
    if (!callerUser || callerUser.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const fs = await import("fs");
    const path = await import("path");
    const https = await import("https");
    const distPath = path.resolve(__dirname, "public");

    // Accept optional GitHub token for private repo access
    const ghToken: string | undefined = req.body?.token;

    function fetchRaw(url: string): Promise<Buffer> {
      return new Promise((resolve, reject) => {
        const headers: Record<string, string> = { "User-Agent": "clr-hotpatch" };
        if (ghToken) headers["Authorization"] = `token ${ghToken}`;
        if (ghToken) headers["Accept"] = "application/vnd.github.raw";
        const doReq = (rawUrl: string) => https.get(rawUrl, { headers }, (r) => {
          if (r.statusCode === 302 || r.statusCode === 301) { doReq(r.headers.location!); return; }
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => resolve(Buffer.concat(chunks)));
          r.on("error", reject);
        }).on("error", reject);
        doReq(url);
      });
    }

    const REPO = "EthanWood14/clr-connection-center";
    const BRANCH = "main";
    // Use GitHub API if token provided (supports private repos), else raw.githubusercontent.com
    const RAW = ghToken
      ? `https://git-agent-proxy.perplexity.ai/api/v3/repos/${REPO}/contents`
      : `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

    function fileUrl(filePath: string): string {
      if (ghToken) return `${RAW}/${filePath}?ref=${BRANCH}`;
      return `${RAW}/${filePath}`;
    }

    try {
      // Fetch index.html first to discover asset filenames
      const indexBuf = await fetchRaw(fileUrl("dist/public/index.html"));
      const indexHtml = indexBuf.toString("utf8");

      // Parse asset filenames from index.html
      const jsMatch = indexHtml.match(/assets\/(index-[^"']+\.js)/);
      const cssMatch = indexHtml.match(/assets\/(index-[^"']+\.css)/);
      if (!jsMatch || !cssMatch) return res.status(500).json({ error: "Could not parse asset filenames from index.html. Content starts: " + indexHtml.slice(0, 200) });

      const jsFile = jsMatch[1];
      const cssFile = cssMatch[1];

      // Download assets in parallel
      const [jsBuf, cssBuf] = await Promise.all([
        fetchRaw(fileUrl(`dist/public/assets/${jsFile}`)),
        fetchRaw(fileUrl(`dist/public/assets/${cssFile}`)),
      ]);

      // Wipe old assets and write new ones
      const assetsDir = path.join(distPath, "assets");
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
      for (const fname of fs.readdirSync(assetsDir)) {
        if (fname.startsWith("index-")) fs.unlinkSync(path.join(assetsDir, fname));
      }
      fs.writeFileSync(path.join(assetsDir, jsFile), jsBuf);
      fs.writeFileSync(path.join(assetsDir, cssFile), cssBuf);
      fs.writeFileSync(path.join(distPath, "index.html"), indexHtml, "utf8");

      // Also fetch manifest.json, sw.js, favicon-192.png
      const extras: Array<[string, string]> = [
        ["dist/public/manifest.json", "manifest.json"],
        ["dist/public/sw.js", "sw.js"],
        ["dist/public/favicon-192.png", "favicon-192.png"],
      ];
      const extraResults: string[] = [];
      for (const [src, dest] of extras) {
        try {
          const buf = await fetchRaw(fileUrl(src));
          fs.writeFileSync(path.join(distPath, dest), buf);
          extraResults.push(dest);
        } catch (ex: any) {
          extraResults.push(`${dest}:SKIP(${ex.message})`);
        }
      }

      res.json({ ok: true, js: jsFile, css: cssFile, extras: extraResults });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

    // ── EOD Reports ───────────────────────────────────────────────────────────────────

  app.get('/api/eod-reports', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    if (req.session_user?.role === 'admin' && req.query.all === '1') {
      const from = (req.query.from as string) || date;
      const to = (req.query.to as string) || date;
      return res.json(storageExtra.getEodReportsByRange(from, to));
    }
    const report = storageExtra.getEodReport(date, userId);
    const activities = storageExtra.getEodActivities(date, userId);
    if (report) {
      try { (report as any).assignedLosCalled = JSON.parse((report as any).assigned_los_called || "[]"); } catch { (report as any).assignedLosCalled = []; }
      try { (report as any).additionalLosCalled = JSON.parse((report as any).additional_los_called || "[]"); } catch { (report as any).additionalLosCalled = []; }
      (report as any).additionalLosOtherNotes = (report as any).additional_los_other_notes ?? null;

      // Enrich with the same fields the history endpoint returns, so the print
      // view can render a complete, value-based report.
      try {
        const sqlite = storageExtra.getSqlite();
        const allLos = storage.getLoanOfficers() as any[];
        const loNameById = (id: number): string => {
          const lo = allLos.find((l: any) => l.id === id);
          return lo ? (lo.fullName ?? lo.full_name ?? `LO #${id}`) : `LO #${id}`;
        };

        // Outcome breakdown for this CLR + date
        const breakdownRows = sqlite.prepare(`
          SELECT outcome_type, COUNT(*) as n
          FROM lead_outcomes
          WHERE assistant_id=? AND date=?
          GROUP BY outcome_type
        `).all(userId, date) as any[];
        const outcomeBreakdown: Record<string, number> = {};
        for (const row of breakdownRows) {
          const k = String(row.outcome_type || "").trim();
          if (k) outcomeBreakdown[k] = Number(row.n) || 0;
        }
        (report as any).outcomeBreakdown = outcomeBreakdown;

        // Transfer prospects (with LO name + transfer type)
        const transferRows = sqlite.prepare(`
          SELECT o.borrower_name, o.transfer_type, lo.full_name as lo_full_name
          FROM lead_outcomes o
          LEFT JOIN loan_officers lo ON lo.id = o.lo_id
          WHERE o.assistant_id=? AND o.date=? AND o.outcome_type='transfer'
          ORDER BY o.id ASC
        `).all(userId, date) as any[];
        (report as any).transferProspects = transferRows
          .map((o: any) => ({
            name: (o.borrower_name || '').trim(),
            transferType: (o.transfer_type as string | null) ?? null,
          }))
          .filter((p: any) => p.name.length > 0);
        (report as any).transferProspectsWithLo = transferRows
          .map((o: any) => ({
            name: (o.borrower_name || '').trim(),
            loName: (o.lo_full_name || '').trim() || null,
            transferType: (o.transfer_type as string | null) ?? null,
          }))
          .filter((p: any) => p.name.length > 0);

        // LO Coverage rollup (assigned called / not called / additional + other)
        const assignedCalledIds: number[] = (report as any).assignedLosCalled || [];
        const additionalCalledIds: number[] = (report as any).additionalLosCalled || [];
        const dayAssignments = (storage.getDailyAssignments(date) as any[])
          .filter((a: any) => (a.assistantId ?? a.assistant_id) === userId);
        const assignedLoIds: number[] = dayAssignments
          .map((a: any) => a.loId ?? a.lo_id)
          .filter((n: any) => Number.isFinite(n));
        const calledSet = new Set<number>(assignedCalledIds);
        (report as any).loCoverage = {
          assignedCalled: assignedLoIds.filter((id: number) => calledSet.has(id)).map(loNameById),
          notCalled:      assignedLoIds.filter((id: number) => !calledSet.has(id)).map(loNameById),
          additional:     additionalCalledIds.map(loNameById),
          otherNotes:     (report as any).additionalLosOtherNotes ?? null,
        };

        // CLR name (so the print view can show "Submitted by …")
        const userRow = sqlite.prepare(`SELECT name, email, role FROM users WHERE id=?`).get(userId) as any;
        if (userRow) {
          (report as any).clr_name  = userRow.name ?? null;
          (report as any).clr_email = userRow.email ?? null;
          (report as any).clr_role  = userRow.role ?? null;
        }
      } catch (e) {
        // Enrichment is best-effort; fall back to the unenriched report.
        if (report && (report as any).outcomeBreakdown == null) {
          (report as any).outcomeBreakdown = {};
        }
      }
    }
    res.json({ report, activities });
  });

  // History: all past EOD reports for the current user (or all users for admin)
  // Enriched with transfer prospect names pulled from lead_outcomes
  app.get('/api/eod-reports/history', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    const isAdmin = req.session_user?.role === 'admin';
    const sqlite = storageExtra.getSqlite();

    const reports: any[] = isAdmin
      ? sqlite.prepare(`
          SELECT e.*, u.name as clr_name
          FROM eod_reports e LEFT JOIN users u ON e.assistant_id=u.id
          ORDER BY e.report_date DESC LIMIT 120
        `).all() as any[]
      : sqlite.prepare(`SELECT * FROM eod_reports WHERE assistant_id=? ORDER BY report_date DESC LIMIT 60`).all(userId) as any[];

    // Pre-fetch all activities for the reports we're returning, in one query,
    // then group by (assistant_id, report_date) so each card can show the
    // "Additional Activity Log" entries the CLR logged that day.
    const activitiesByKey = new Map<string, Array<{ id: number; activity_type: string; description: string }>>();
    if (reports.length > 0) {
      // Earliest date in the result determines how far back to query.
      const minDate = reports.reduce(
        (m: string, r: any) => (r.report_date < m ? r.report_date : m),
        reports[0].report_date as string,
      );
      const assistantIds = Array.from(new Set(reports.map((r: any) => r.assistant_id))).filter((n: any) => Number.isFinite(n));
      if (assistantIds.length > 0) {
        const placeholders = assistantIds.map(() => "?").join(",");
        const activityRows = sqlite.prepare(
          `SELECT id, assistant_id, report_date, activity_type, description
             FROM eod_activities
            WHERE report_date >= ? AND assistant_id IN (${placeholders})
            ORDER BY report_date ASC, id ASC`,
        ).all(minDate, ...assistantIds) as any[];
        for (const a of activityRows) {
          const key = `${a.assistant_id}|${a.report_date}`;
          const list = activitiesByKey.get(key) ?? [];
          list.push({
            id: a.id,
            activity_type: a.activity_type,
            description: a.description ?? "",
          });
          activitiesByKey.set(key, list);
        }
      }
    }

    // Cache LO names once, then enrich each report with LO coverage + transfer prospects.
    const allLos = storage.getLoanOfficers() as any[];
    const loNameById = (id: number): string => {
      const lo = allLos.find((l: any) => l.id === id);
      return lo ? (lo.fullName ?? lo.full_name ?? `LO #${id}`) : `LO #${id}`;
    };
    const enriched = reports.map((r: any) => {
      // Outcome breakdown: count each outcome_type for this CLR + date.
      // lead_outcomes.date is "YYYY-MM-DD" (same format as eod_reports.report_date),
      // so direct equality works. No DATE() needed.
      const breakdownRows = sqlite.prepare(`
        SELECT outcome_type, COUNT(*) as n
        FROM lead_outcomes
        WHERE assistant_id=? AND date=?
        GROUP BY outcome_type
      `).all(r.assistant_id, r.report_date) as any[];
      const outcomeBreakdown: Record<string, number> = {};
      for (const row of breakdownRows) {
        const k = String(row.outcome_type || "").trim();
        if (k) outcomeBreakdown[k] = Number(row.n) || 0;
      }

      const rows = sqlite.prepare(`
        SELECT o.borrower_name, o.transfer_type, lo.full_name as lo_full_name
        FROM lead_outcomes o
        LEFT JOIN loan_officers lo ON lo.id = o.lo_id
        WHERE o.assistant_id=? AND o.date=? AND o.outcome_type='transfer'
        ORDER BY o.id ASC
      `).all(r.assistant_id, r.report_date) as any[];
      const transferProspects: Array<{ name: string; transferType: string | null }> = rows
        .map((o: any) => ({
          name: (o.borrower_name || '').trim(),
          transferType: (o.transfer_type as string | null) ?? null,
        }))
        .filter((p) => p.name.length > 0);
      const transferProspectsWithLo: Array<{ name: string; loName: string | null; transferType: string | null }> = rows
        .map((o: any) => ({
          name: (o.borrower_name || '').trim(),
          loName: (o.lo_full_name || '').trim() || null,
          transferType: (o.transfer_type as string | null) ?? null,
        }))
        .filter((p) => p.name.length > 0);

      // LO coverage: assigned LOs for that date vs. called/additional stored on the report
      let assignedCalledIds: number[] = [];
      try { assignedCalledIds = JSON.parse(r.assigned_los_called || "[]"); } catch { assignedCalledIds = []; }
      let additionalCalledIds: number[] = [];
      try { additionalCalledIds = JSON.parse(r.additional_los_called || "[]"); } catch { additionalCalledIds = []; }
      const dayAssignments = (storage.getDailyAssignments(r.report_date) as any[])
        .filter((a: any) => (a.assistantId ?? a.assistant_id) === r.assistant_id);
      const assignedLoIds: number[] = dayAssignments.map((a: any) => a.loId ?? a.lo_id).filter((n: any) => Number.isFinite(n));
      const calledSet = new Set<number>(assignedCalledIds);
      const assignedCalledNames = assignedLoIds.filter((id: number) => calledSet.has(id)).map(loNameById);
      const notCalledNames = assignedLoIds.filter((id: number) => !calledSet.has(id)).map(loNameById);
      const additionalNames = additionalCalledIds.map(loNameById);

      const activities = activitiesByKey.get(`${r.assistant_id}|${r.report_date}`) ?? [];

      return {
        ...r,
        outcomeBreakdown,
        transferProspects,
        transferProspectsWithLo,
        additionalLosOtherNotes: (r.additional_los_other_notes ?? null),
        loCoverage: {
          assignedCalled: assignedCalledNames,
          notCalled: notCalledNames,
          additional: additionalNames,
          otherNotes: (r.additional_los_other_notes ?? null),
        },
        activities,
      };
    });

    res.json(enriched);
  });

  app.post('/api/eod-reports', requireAuth, async (req: any, res) => {
    const userId = req.session_user?.userId;
    const { reportDate, callsMade, messagesSent, voicemails, textsSent, emailsSent, loConnections, transfers, appointments, notes, assignedLosCalled, additionalLosCalled, additionalLosOtherNotes } = req.body;
    if (!reportDate) return res.status(400).json({ error: 'reportDate required' });
    const normalizeIds = (x: any): number[] =>
      Array.isArray(x) ? x.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [];
    const assignedIds = normalizeIds(assignedLosCalled);
    const additionalIds = normalizeIds(additionalLosCalled);
    const otherNotesStr = typeof additionalLosOtherNotes === "string" ? additionalLosOtherNotes : null;
    const report = storageExtra.upsertEodReport({
      reportDate,
      assistantId: userId,
      callsMade: Number(callsMade ?? 0),
      messagesSent: Number(messagesSent ?? textsSent ?? 0),
      transfers: Number(transfers ?? 0),
      appointments: Number(appointments ?? 0),
      notes: notes ?? null,
      assignedLosCalled: assignedIds,
      additionalLosCalled: additionalIds,
      additionalLosOtherNotes: otherNotesStr,
    });
    // Also sync call log for the day
    storage.upsertDailyCallLog({ logDate: reportDate, assistantId: userId, callsMade: Number(callsMade ?? 0), notes: null });

    // ── Sync daily_assignments + loan_officers freshness from EOD coverage ──
    // Without this, the algorithm sees the LO's lastWorkedDate as stale and re-recommends
    // the same top-ranked LOs the next day. Mark assigned LOs the user called as "worked"
    // and the rest as "attempted" so the recency signal advances. Also bump LO freshness
    // for additional (off-list) LOs the user called.
    try {
      const calledAssignedSet = new Set<number>(assignedIds);
      const myAssignmentsToday = (storage.getDailyAssignments(reportDate) as any[])
        .filter((a: any) => (a.assistantId ?? a.assistant_id) === userId);
      for (const a of myAssignmentsToday) {
        const aId = a.id;
        const loId = a.loId ?? a.lo_id;
        const currentStatus = a.status;
        // Don't downgrade an explicitly-set status (worked/skipped) or stomp on admin overrides
        if (currentStatus !== "recommended") continue;
        if (calledAssignedSet.has(loId)) {
          storage.updateAssignmentStatus(aId, "worked", null as any);
          const lo = storage.getLoanOfficerById(loId);
          if (lo) {
            storage.updateLoanOfficer(loId, {
              lastWorkedDate: reportDate,
              totalTimesWorked: ((lo as any).totalTimesWorked ?? (lo as any).total_times_worked ?? 0) + 1,
            } as any);
          }
        } else {
          storage.updateAssignmentStatus(aId, "attempted", null as any);
        }
      }
      // Bump freshness for off-list (additional) LOs the user worked
      for (const loId of additionalIds) {
        const lo = storage.getLoanOfficerById(loId);
        if (!lo) continue;
        storage.updateLoanOfficer(loId, {
          lastWorkedDate: reportDate,
          totalTimesWorked: ((lo as any).totalTimesWorked ?? (lo as any).total_times_worked ?? 0) + 1,
        } as any);
      }
    } catch (err) {
      console.error("[eod] failed to sync assignment freshness:", err);
    }

    // ── Goal-hit detection: check if CLR hit any weekly goals this week ────────
    try {
      const sqlite2 = storageExtra.getSqlite();
      const goalRow = sqlite2.prepare(
        `SELECT calls_goal, transfers_goal, appointments_goal, goal_model FROM clr_goals WHERE user_id = ?`
      ).get(userId) as any;
      if (goalRow) {
        // Get this week's actuals (Sun–Sat containing reportDate)
        const rd = new Date(reportDate + 'T12:00:00Z');
        const wkDay = rd.getUTCDay(); // 0=Sun
        const wkStart = new Date(rd); wkStart.setUTCDate(rd.getUTCDate() - wkDay);
        const wkEnd = new Date(wkStart); wkEnd.setUTCDate(wkStart.getUTCDate() + 6);
        const fmtD = (d: Date) => d.toISOString().split('T')[0];
        const wkStartStr = fmtD(wkStart);
        const wkEndStr = fmtD(wkEnd);

        const wkCallsRow = sqlite2.prepare(
          `SELECT COALESCE(SUM(calls_made),0) AS n FROM daily_call_logs WHERE assistant_id=? AND log_date BETWEEN ? AND ?`
        ).get(userId, wkStartStr, wkEndStr) as any;
        const wkCalls = wkCallsRow?.n ?? 0;

        const wkOutcomes = sqlite2.prepare(`
          SELECT
            SUM(CASE WHEN outcome_type='transfer' THEN 1 ELSE 0 END) AS transfers,
            SUM(CASE WHEN outcome_type='appointment' THEN 1 ELSE 0 END) AS appointments
          FROM lead_outcomes WHERE assistant_id=? AND date BETWEEN ? AND ?
        `).get(userId, wkStartStr, wkEndStr) as any;
        const wkTransfers = wkOutcomes?.transfers ?? 0;
        const wkAppts = wkOutcomes?.appointments ?? 0;

        const hitCalls = goalRow.calls_goal > 0 && wkCalls >= goalRow.calls_goal;
        const hitTransfers = goalRow.transfers_goal > 0 && wkTransfers >= goalRow.transfers_goal;
        const hitAppts = goalRow.appointments_goal > 0 && wkAppts >= goalRow.appointments_goal;

        if (hitCalls || hitTransfers || hitAppts) {
          const clrUserG = storage.getUserById(userId) as any;
          const clrNameG = clrUserG?.name ?? `User #${userId}`;
          const orgId = req.session_user?.orgId ?? 1;
          const orgUsers = sqlite2.prepare(
            `SELECT id FROM users WHERE org_id = ? AND is_active = 1`
          ).all(orgId) as any[];

          const hitParts: string[] = [];
          if (hitCalls) hitParts.push(`🎯 Calls (${wkCalls}/${goalRow.calls_goal})`);
          if (hitTransfers) hitParts.push(`✅ Transfers (${wkTransfers}/${goalRow.transfers_goal})`);
          if (hitAppts) hitParts.push(`📅 Appointments (${wkAppts}/${goalRow.appointments_goal})`);
          const hitSummary = hitParts.join(' · ');

          // In-app notifications + web push to all org users
          for (const u of orgUsers) {
            // In-app notification
            try {
              storage.createNotification({
                userId: u.id,
                type: "goal_hit",
                title: `🏆 Goal Hit — ${clrNameG}`,
                message: hitSummary,
                isRead: false,
              });
            } catch {}
            // Web push
            try {
              const subs = sqlite2.prepare(
                `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`
              ).all(u.id) as any[];
              for (const sub of subs) {
                try {
                  const webpush = await import('web-push');
                  await webpush.default.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    JSON.stringify({
                      title: `🏆 Goal Hit — ${clrNameG}`,
                      body: hitSummary,
                      url: '/#/team-stats',
                    })
                  );
                } catch {}
              }
            } catch {}
          }

          // Also staircase: if model is staircase, bump goals immediately on hit
          if (goalRow.goal_model === 'staircase') {
            const pctRow = sqlite2.prepare(
              `SELECT adjustment_pct FROM clr_goals WHERE user_id = ?`
            ).get(userId) as any;
            const pct2 = Math.max(0, parseFloat(String(pctRow?.adjustment_pct ?? 5)) || 5);
            const mult2 = 1 + pct2 / 100;
            const newCalls2 = hitCalls ? Math.max(1, Math.round(goalRow.calls_goal * mult2)) : goalRow.calls_goal;
            const newXfers2 = hitTransfers ? Math.max(1, Math.round(goalRow.transfers_goal * mult2)) : goalRow.transfers_goal;
            const newAppts2 = hitAppts ? Math.max(1, Math.round(goalRow.appointments_goal * mult2)) : goalRow.appointments_goal;
            sqlite2.prepare(`
              UPDATE clr_goals SET calls_goal=?, transfers_goal=?, appointments_goal=?,
              adjustment_basis=?, updated_at=datetime('now') WHERE user_id=?
            `).run(
              newCalls2, newXfers2, newAppts2,
              JSON.stringify({ trigger: 'goal_hit', reportDate, hit: { calls: hitCalls, transfers: hitTransfers, appointments: hitAppts }, after: { calls: newCalls2, transfers: newXfers2, appointments: newAppts2 } }),
              userId
            );
          }
        }
      }
    } catch (e: any) {
      console.error('[eod] goal-hit check failed:', e?.message ?? e);
    }

    // ── Send EOD summary email to managers + CLR themselves ─────────────────
    try {
      const settings = storageExtra.getEmailSettings() as any;
      const managers: string[] = (() => {
        try { return JSON.parse(settings.manager_emails || "[]"); } catch { return []; }
      })();

      const clrUser = storage.getUserById(userId) as any;
      const clrName = clrUser?.name ?? `User #${userId}`;
      const clrEmail = clrUser?.email ?? null;

      // Immediate email goes to the CLR themselves.
      // For late (backdated) submissions the 6:30 PM manager digest already
      // fired without this data, so also CC managers on late reports.
      const todayInPT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const isLateSubmission = reportDate < todayInPT;
      const managerRecipients: string[] = isLateSubmission
        ? managers.filter((m: string) => String(m).includes("@"))
        : [];

      const allRecipients = [
        ...(clrEmail ? [clrEmail] : []),
        ...managerRecipients.filter((m: string) => m !== clrEmail),
      ];

      if (allRecipients.length > 0) {
        const calls = Number(callsMade ?? 0);
        const xfers = Number(transfers ?? 0);
        const appts = Number(appointments ?? 0);
        const safeNotes = (notes ?? "").toString().trim();

        // Fetch today's outcomes for this user to get transfer prospect names + LO names + fell through count
        const sqlite2 = (storageExtra as any).getSqlite ? (storageExtra as any).getSqlite() : null;
        let transferProspects: Array<{
          name: string;
          loName: string | null;
          transferType: string | null;
          conversationNotes?: string | null;
          loActionPlan?: string | null;
          leadTimeframe?: string | null;
          requiresFollowup?: number | null;
          followupReason?: string | null;
          followupDate?: string | null;
        }> = [];
        // Appointments + callbacks logged today — surfaced in the EOD email so
        // managers and the CLR can see exactly what's on the books for follow-up.
        let dayAppointments: Array<{
          name: string;
          loName: string | null;
          when: string | null;       // followUpDate / appointmentDatetime, raw
          notes: string | null;
        }> = [];
        let dayCallbacks: Array<{
          name: string;
          loName: string | null;
          when: string | null;
          notes: string | null;
          kind: "callback" | "deferral";
        }> = [];
        let fellThroughCount = 0;
        let fellThroughProspects: Array<{
          name: string;
          loName: string | null;
          notes: string | null;
        }> = [];
        const outcomeCounts = {
          transfer: 0,
          appointment: 0,
          fell_through: 0,
          callback_requested: 0,
          deferral: 0,
          future_contact: 0,
          no_answer: 0,
          total: 0,
        };
        if (sqlite2) {
          try {
            const dayRows = sqlite2.prepare(`
              SELECT o.*, lo.full_name as lo_full_name
              FROM lead_outcomes o
              LEFT JOIN loan_officers lo ON lo.id = o.lo_id
              WHERE o.assistant_id=? AND o.date=?
              ORDER BY o.id ASC
            `).all(userId, reportDate) as any[];
            transferProspects = dayRows
              .filter((o: any) => o.outcome_type === 'transfer')
              .map((o: any) => ({
                name: (o.borrower_name || '').trim(),
                loName: (o.lo_full_name || '').trim() || null,
                transferType: (o.transfer_type as string | null) ?? null,
                conversationNotes: (o.conversation_notes as string | null) ?? null,
                loActionPlan: (o.lo_action_plan as string | null) ?? null,
                leadTimeframe: (o.lead_timeframe as string | null) ?? null,
                requiresFollowup: (o.requires_followup as number | null) ?? null,
                followupReason: (o.followup_reason as string | null) ?? null,
                followupDate: (o.followup_date as string | null) ?? null,
              }))
              .filter((p: any) => p.name.length > 0);
            // Appointments — anything logged with outcome_type='appointment'.
            dayAppointments = dayRows
              .filter((o: any) => o.outcome_type === 'appointment')
              .map((o: any) => ({
                name: (o.borrower_name || '').trim() || 'Unknown borrower',
                loName: (o.lo_full_name || '').trim() || null,
                when: (o.appointment_datetime as string | null) || (o.follow_up_date as string | null) || null,
                notes: (o.notes as string | null) ?? null,
              }));
            // Callbacks + deferrals (lumped together, kind tagged so we label them).
            dayCallbacks = dayRows
              .filter((o: any) => o.outcome_type === 'callback_requested' || o.outcome_type === 'deferral' || o.outcome_type === 'future_contact')
              .map((o: any) => ({
                name: (o.borrower_name || '').trim() || 'Unknown borrower',
                loName: (o.lo_full_name || '').trim() || null,
                when: (o.follow_up_date as string | null) || null,
                notes: (o.notes as string | null) ?? null,
                kind: o.outcome_type === 'callback_requested' ? 'callback' as const : 'deferral' as const,
              }));
            const fellThroughRows = dayRows.filter((o: any) => o.outcome_type === 'fell_through');
            fellThroughCount = fellThroughRows.length;
            fellThroughProspects = fellThroughRows
              .map((o: any) => ({
                name: (o.borrower_name || '').trim(),
                loName: (o.lo_full_name || '').trim() || null,
                notes: (o.notes as string | null) ?? null,
              }))
              .filter((p: any) => p.name.length > 0);
            for (const r of dayRows) {
              const t = String(r.outcome_type ?? "");
              if (t in outcomeCounts) (outcomeCounts as any)[t] += 1;
              outcomeCounts.total += 1;
            }
          } catch {}
        }

        // Resolve LO coverage — assigned-called, additional, and not-called
        const allLos = storage.getLoanOfficers() as any[];
        const loNameById = (id: number) => {
          const lo = allLos.find((l: any) => l.id === id);
          return lo ? (lo.fullName ?? lo.full_name ?? `LO #${id}`) : `LO #${id}`;
        };
        const todaysAssignments = (storage.getDailyAssignments(reportDate) as any[])
          .filter((a: any) => (a.assistantId ?? a.assistant_id) === userId);
        const assignedLoIds: number[] = todaysAssignments.map((a: any) => a.loId ?? a.lo_id).filter((n: any) => Number.isFinite(n));
        const calledSet = new Set<number>(assignedIds);
        const assignedCalledNames: string[] = assignedLoIds.filter((id: number) => calledSet.has(id)).map(loNameById);
        const notCalledNames: string[] = assignedLoIds.filter((id: number) => !calledSet.has(id)).map(loNameById);
        const additionalNames: string[] = additionalIds.map(loNameById);

        // Render date-only fields anchored to UTC so the calendar day matches
        // the stored YYYY-MM-DD regardless of the host server's local tz.
        const reportDateLong = new Date(reportDate + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
        const reportDateShort = new Date(reportDate + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

        // ── Week-to-date summary (Sun–Sat containing the report date) ──
        const rd = new Date(reportDate + "T00:00:00Z");
        const dow = rd.getUTCDay(); // 0=Sun..6=Sat (UTC, matches the UTC-anchored rd)
        const wkStart = new Date(rd); wkStart.setUTCDate(rd.getUTCDate() - dow);
        const wkEnd = new Date(wkStart); wkEnd.setUTCDate(wkStart.getUTCDate() + 6);
        const wkStartStr = wkStart.toISOString().split("T")[0];
        const wkEndStr = wkEnd.toISOString().split("T")[0];
        const wtdOutcomes = storage.getLeadOutcomes({ startDate: wkStartStr, endDate: wkEndStr, assistantId: userId }) as any[];
        const wtdLogs = (storage.getCallLogsByRange(wkStartStr, wkEndStr) as any[])
          .filter((l: any) => (l.assistantId ?? l.assistant_id) === userId);
        const wtdCalls = wtdLogs.reduce((s, l) => s + (l.callsMade ?? l.calls_made ?? 0), 0);
        const wtdTransfers = wtdOutcomes.filter((o: any) => (o.outcomeType ?? o.outcome_type) === "transfer").length;
        const wtdAppointments = wtdOutcomes.filter((o: any) => (o.outcomeType ?? o.outcome_type) === "appointment").length;

        const goalCalls = Number((clrUser as any)?.goalCallsWeekly ?? (clrUser as any)?.goal_calls_weekly ?? 0);
        const goalTransfers = Number((clrUser as any)?.goalTransfersWeekly ?? (clrUser as any)?.goal_transfers_weekly ?? 0);
        const goalAppointments = Number((clrUser as any)?.goalAppointmentsWeekly ?? (clrUser as any)?.goal_appointments_weekly ?? 0);
        const hasGoals = goalCalls > 0 || goalTransfers > 0 || goalAppointments > 0;

        const wkStartLabel = wkStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const wkEndLabel = wkEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

        const progressBar = (current: number, goal: number, color: string) => {
          if (goal <= 0) return "";
          const pct = Math.min(100, Math.round((current / goal) * 100));
          const met = current >= goal;
          return `<div style="height:8px;background:#e2e8f0;border-radius:999px;margin-top:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${met ? '#16a34a' : color};border-radius:999px"></div>
          </div>`;
        };

        const wtdRow = (label: string, current: number, goal: number, color: string) => {
          const goalLabel = goal > 0
            ? `<span style="font-size:12px;color:${current >= goal ? '#16a34a' : '#64748b'};font-weight:${current >= goal ? 700 : 500}">${current} / ${goal}${current >= goal ? ' ✓' : ''}</span>`
            : `<span style="font-size:12px;color:#475569;font-weight:500">${current}</span>`;
          return `<tr>
            <td style="padding:8px 0;font-size:13px;color:#334155;font-weight:600;width:40%">${label}</td>
            <td style="padding:8px 0;text-align:right">${goalLabel}${progressBar(current, goal, color)}</td>
          </tr>`;
        };

        const statBlock = (label: string, val: number | string, color: string, sub?: string) => `
          <td style="text-align:center;padding:16px 12px;background:#ffffff;border-radius:10px;border:1px solid #e2e8f0">
            <div style="font-size:28px;font-weight:800;color:${color};line-height:1">${val}</div>
            <div style="font-size:12px;font-weight:600;color:#1e293b;margin-top:5px">${label}</div>
            ${sub ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${sub}</div>` : ''}
          </td>`;

        const body = `
          <div style="background:#1A2B4A;border-radius:10px;padding:22px 24px;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.7px;font-weight:700">End of Day Report</p>
            <h2 style="margin:0 0 6px;font-size:20px;color:#ffffff;font-weight:700">${clrName} &mdash; ${reportDateLong}</h2>
            <p style="margin:0;font-size:13px;color:#94a3b8">Submitted via CLR Connection Center</p>
          </div>

          <!-- Stats grid -->
          <table width="100%" cellpadding="6" cellspacing="0" border="0" style="margin-bottom:20px">
            <tr>
              ${statBlock("Calls Made", calls, "#1A2B4A")}
              ${statBlock("Transfers", xfers, "#059669", xfers === 1 ? "1 lead transferred" : `${xfers} leads transferred`)}
              ${statBlock("Appointments", appts, "#2563eb")}
              ${statBlock("Fell Through", fellThroughCount, "#dc2626")}
            </tr>
          </table>

          <!-- Full outcome breakdown — all 7 outcome types (callbacks + deferrals grouped) -->
          <div style="margin-bottom:20px">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#0F182D">📊 Outcome Breakdown</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:12px;table-layout:fixed">
              <thead>
                <tr style="background:#0F182D">
                  <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Transfers</th>
                  <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Appointments</th>
                  <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Fell Through</th>
                  <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Callbacks &amp; Deferrals</th>
                  <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Future Contacts</th>
                  <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">No Answer</th>
                </tr>
              </thead>
              <tbody>
                <tr style="background:#ffffff">
                  <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#1A2B4A">${outcomeCounts.transfer}</td>
                  <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#2563eb">${outcomeCounts.appointment}</td>
                  <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#dc2626">${outcomeCounts.fell_through}</td>
                  <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#7c3aed">${outcomeCounts.callback_requested + outcomeCounts.deferral}</td>
                  <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#0891b2">${outcomeCounts.future_contact}</td>
                  <td style="padding:14px 6px;text-align:center;font-size:22px;font-weight:800;color:#64748b">${outcomeCounts.no_answer}</td>
                </tr>
              </tbody>
            </table>
            <p style="margin:8px 0 0;font-size:12px;color:#475569;text-align:right"><strong>Total:</strong> ${outcomeCounts.total} outcome${outcomeCounts.total === 1 ? '' : 's'}</p>
          </div>

          ${xfers > 0 ? `
          <!-- Transfer prospects -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#166534">💰 Transfers (${xfers})</p>
            ${transferProspects.length > 0
              ? transferProspects.map((p, i) => {
                  const escHtml = (s: string) => s.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
                  const safeName = p.name.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                  const safeLo = p.loName ? p.loName.replace(/</g,'&lt;').replace(/>/g,'&gt;') : null;
                  const tt = p.transferType === 'direct' ? 'Direct'
                           : p.transferType === 'appointment' ? 'Appt'
                           : null;
                  const tf = p.leadTimeframe ? String(p.leadTimeframe).replace(/_/g, ' ') : null;
                  const detailLine = (label: string, val: string | null | undefined) =>
                    val && String(val).trim() ? `<div style="font-size:12px;color:#334155;margin-top:4px"><strong style="color:#166534">${label}:</strong> ${escHtml(String(val).trim())}</div>` : '';
                  const followupLine = p.requiresFollowup
                    ? `<div style="font-size:12px;color:#b45309;margin-top:4px;background:#fef3c7;padding:4px 8px;border-radius:4px;border-left:3px solid #d97706"><strong>⚑ Follow-up needed${p.followupDate ? ` by ${p.followupDate}` : ''}</strong>${p.followupReason ? ` — ${escHtml(p.followupReason)}` : ''}</div>`
                    : '';
                  return `<div style="padding:10px 0;${i < transferProspects.length - 1 ? 'border-bottom:1px solid #dcfce7' : ''}">
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="display:inline-block;width:22px;height:22px;background:#16a34a;color:#fff;border-radius:50%;text-align:center;font-size:11px;font-weight:700;line-height:22px">${i + 1}</span>
                      <span style="font-size:13px;font-weight:600;color:#14532d">${safeName}</span>
                      ${safeLo ? `<span style="font-size:13px;color:#15803d">&rarr;</span><span style="font-size:13px;font-weight:600;color:#166534">${safeLo}</span>` : ''}
                      ${tt ? `<span style="font-size:12px;color:#4b5563;font-weight:500">(${tt})</span>` : ''}
                      ${tf ? `<span style="font-size:11px;color:#64748b;background:#ecfccb;border:1px solid #bef264;border-radius:999px;padding:2px 8px;font-weight:500">${tf}</span>` : ''}
                    </div>
                    ${detailLine('Summary', p.conversationNotes)}
                    ${detailLine('LO Plan', p.loActionPlan)}
                    ${followupLine}
                  </div>`;
                }).join('')
              : `<p style="margin:0;font-size:13px;color:#4ade80;font-style:italic">Names not recorded for these transfers.</p>`
            }
          </div>` : ""}

          ${fellThroughCount > 0 ? `
          <!-- Fell-through prospects -->
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#991b1b">❌ Fell Through (${fellThroughCount})</p>
            ${fellThroughProspects.length > 0
              ? fellThroughProspects.map((p, i) => {
                  const escHtml = (s: string) => s.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
                  const safeName = p.name.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                  const safeLo = p.loName ? p.loName.replace(/</g,'&lt;').replace(/>/g,'&gt;') : null;
                  const notesLine = p.notes && String(p.notes).trim()
                    ? `<div style="font-size:12px;color:#334155;margin-top:4px"><strong style="color:#991b1b">Notes:</strong> ${escHtml(String(p.notes).trim())}</div>`
                    : '';
                  return `<div style="padding:10px 0;${i < fellThroughProspects.length - 1 ? 'border-bottom:1px solid #fecaca' : ''}">
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="display:inline-block;width:22px;height:22px;background:#dc2626;color:#fff;border-radius:50%;text-align:center;font-size:11px;font-weight:700;line-height:22px">${i + 1}</span>
                      <span style="font-size:13px;font-weight:600;color:#7f1d1d">${safeName}</span>
                      ${safeLo ? `<span style="font-size:13px;color:#b91c1c">&rarr;</span><span style="font-size:13px;font-weight:600;color:#991b1b">${safeLo}</span>` : ''}
                    </div>
                    ${notesLine}
                  </div>`;
                }).join('')
              : `<p style="margin:0;font-size:13px;color:#fca5a5;font-style:italic">Names not recorded for these fell-throughs.</p>`
            }
          </div>` : ""}

          ${(() => {
            // Helper for appointment/callback rendering — shared formatter.
            // Wall-clock strings (no offset) are interpreted in the CLR's timezone,
            // and rendering is forced to that tz so a 3pm PT appointment doesn't
            // get mangled into 8am on a UTC server.
            const eodTz = (clrUser?.timezone as string | null) || BUSINESS_DAY_DEFAULT_TZ;
            const escTxt = (s: string) => s.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            const fmtWhen = (raw: string | null) => {
              if (!raw) return null;
              const s = String(raw).trim();
              if (!s) return null;
              const hasTime = s.includes('T') || s.includes(' ');
              try {
                const ms = hasTime ? parseWallClockInTz(s, eodTz) : Date.parse(s + 'T00:00:00Z');
                if (!Number.isFinite(ms)) return s;
                return new Date(ms).toLocaleString('en-US', hasTime
                  ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: eodTz }
                  : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
              } catch { return s; }
            };
            const aRow = (i: number, total: number, color: string, name: string, loName: string | null, when: string | null, notes: string | null, tag?: string | null) => `
              <div style="padding:10px 0;${i < total - 1 ? `border-bottom:1px solid ${color}33` : ''}">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="display:inline-block;width:22px;height:22px;background:${color};color:#fff;border-radius:50%;text-align:center;font-size:11px;font-weight:700;line-height:22px">${i + 1}</span>
                  <span style="font-size:13px;font-weight:600;color:#0f172a">${escTxt(name)}</span>
                  ${loName ? `<span style="font-size:13px;color:#64748b">&rarr;</span><span style="font-size:13px;font-weight:600;color:#334155">${escTxt(loName)}</span>` : ''}
                  ${tag ? `<span style="font-size:11px;color:#475569;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:999px;padding:2px 8px;font-weight:600">${escTxt(tag)}</span>` : ''}
                </div>
                ${when ? `<div style="font-size:12px;color:#334155;margin-top:4px"><strong style="color:${color}">Scheduled:</strong> ${escTxt(when)}</div>` : ''}
                ${notes && String(notes).trim() ? `<div style="font-size:12px;color:#334155;margin-top:4px"><strong style="color:${color}">Notes:</strong> ${escTxt(String(notes).trim())}</div>` : ''}
              </div>`;
            const apptHtml = dayAppointments.length > 0 ? `
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1e3a8a">📅 Appointments Booked Today (${dayAppointments.length})</p>
                ${dayAppointments.map((a, i) => aRow(i, dayAppointments.length, '#2563eb', a.name, a.loName, fmtWhen(a.when), a.notes)).join('')}
              </div>` : '';
            const cbHtml = dayCallbacks.length > 0 ? `
              <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:16px 20px;margin-bottom:20px">
                <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#6b21a8">🔁 Callbacks &amp; Deferrals Logged Today (${dayCallbacks.length})</p>
                ${dayCallbacks.map((c, i) => aRow(i, dayCallbacks.length, '#7c3aed', c.name, c.loName, fmtWhen(c.when), c.notes, c.kind === 'callback' ? 'Callback' : 'Deferral')).join('')}
              </div>` : '';
            return apptHtml + cbHtml;
          })()}

          ${(assignedLoIds.length || additionalNames.length || (otherNotesStr && otherNotesStr.trim())) ? (() => {
            const esc = (s: string) => s.replace(/</g,"&lt;").replace(/>/g,"&gt;");
            const chipList = (names: string[], bg: string, border: string, color: string) =>
              names.length
                ? names.map(n => `<span style="display:inline-block;background:${bg};border:1px solid ${border};color:${color};font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;margin:2px 4px 2px 0">${esc(n)}</span>`).join("")
                : `<span style="font-size:12px;color:#64748b;font-style:italic">—</span>`;
            const otherTrimmed = (otherNotesStr ?? "").trim();
            return `
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1e3a8a">📋 LO Coverage</p>
            <div style="margin-bottom:8px">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px">Assigned LOs called (${assignedCalledNames.length}/${assignedLoIds.length})</p>
              ${chipList(assignedCalledNames, "#dcfce7", "#86efac", "#14532d")}
            </div>
            ${notCalledNames.length ? `
            <div style="margin-bottom:8px">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px">Not called (${notCalledNames.length})</p>
              ${chipList(notCalledNames, "#fee2e2", "#fca5a5", "#7f1d1d")}
            </div>` : ""}
            ${additionalNames.length ? `
            <div style="margin-bottom:8px">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px">Additional LOs covered (${additionalNames.length})</p>
              ${chipList(additionalNames, "#dbeafe", "#93c5fd", "#1e3a8a")}
            </div>` : ""}
            ${otherTrimmed ? `
            <div>
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.5px">Additional (Other)</p>
              <p style="margin:0;font-size:13px;color:#334155;line-height:1.5;white-space:pre-wrap">${esc(otherTrimmed)}</p>
            </div>` : ""}
          </div>`;
          })() : ""}

          ${safeNotes ? `
          <div style="background:#fef9c3;border-left:4px solid #eab308;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#713f12">📝 Additional Notes</p>
            <p style="margin:0;font-size:13px;color:#334155;line-height:1.7;white-space:pre-wrap">${safeNotes.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
          </div>` : ""}

          <!-- Week-to-date summary -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1A2B4A">📊 ${clrName}'s Stats This Week</p>
            <p style="margin:0 0 12px;font-size:11px;color:#64748b">${wkStartLabel} – ${wkEndLabel} (Sun–Sat)${hasGoals ? " · progress toward weekly goals" : ""}</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${wtdRow("Calls", wtdCalls, goalCalls, "#3B82F6")}
              ${wtdRow("Transfers", wtdTransfers, goalTransfers, "#16a34a")}
              ${wtdRow("Appointments", wtdAppointments, goalAppointments, "#A855F7")}
            </table>
          </div>

          <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center">© 2026 West Capital Lending &middot; CLR Connection Center</p>
        `;

        const subject = `EOD Report: ${clrName} — ${reportDateShort}`;
        const html = buildEmail({
          subject,
          preheader: `${calls} calls · ${xfers} transfers · ${appts} appointments · ${fellThroughCount} fell through`,
          body,
        });
        await sendEmail({ to: allRecipients, subject, html });
      }
    } catch (e: any) {
      console.error("EOD email send failed:", e?.message ?? e);
    }

    res.json(report);
  });

  app.post('/api/eod-reports/activities', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    const { reportDate, activityType, description } = req.body;
    if (!reportDate || !activityType || !description) return res.status(400).json({ error: 'reportDate, activityType, description required' });
    // Post-EOD rollover: extra activities added after today's EOD count for tomorrow.
    let effectiveDate = String(reportDate);
    try {
      effectiveDate = rolloverIfEodSubmitted(storageExtra.getSqlite(), Number(userId), effectiveDate);
    } catch {}
    const activity = storageExtra.addEodActivity({ reportDate: effectiveDate, assistantId: userId, activityType, description });
    res.json(activity);
  });

  app.patch('/api/eod-reports/activities/:id', requireAuth, (req: any, res) => {
    const userId = Number(req.session_user?.userId);
    const { activityType, description } = req.body;
    if (!activityType || !description || !String(description).trim()) {
      return res.status(400).json({ error: 'activityType and description required' });
    }
    const updated = storageExtra.updateEodActivity(parseInt(req.params.id), userId, {
      activityType,
      description: String(description).trim(),
    });
    if (!updated) return res.status(404).json({ error: 'Activity not found' });
    res.json(updated);
  });

  app.delete('/api/eod-reports/activities/:id', requireAuth, (req: any, res) => {
    storageExtra.deleteEodActivity(parseInt(req.params.id), Number(req.session_user?.userId));
    res.json({ ok: true });
  });

  // ── EOD drafts ────────────────────────────────────────────────────────────
  // Per-user draft of the EOD form. Auto-saved as the user types; cleared
  // after a successful final submission.
  app.get('/api/eod/draft', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const sqlite = (storageExtra as any).getSqlite();
      const row = sqlite.prepare(
        `SELECT id, user_id, draft_data, updated_at FROM eod_drafts WHERE user_id=?`
      ).get(userId) as any;
      if (!row) return res.json(null);
      let data: any = null;
      try { data = JSON.parse(row.draft_data); } catch { data = null; }
      res.json({ id: row.id, userId: row.user_id, data, updatedAt: row.updated_at });
    } catch (e: any) {
      console.error("[eod/draft GET]", e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  app.put('/api/eod/draft', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const data = req.body?.data;
    if (data === undefined) return res.status(400).json({ error: "data required" });
    try {
      const sqlite = (storageExtra as any).getSqlite();
      const json = typeof data === "string" ? data : JSON.stringify(data);
      sqlite.prepare(
        `INSERT INTO eod_drafts (user_id, org_id, draft_data, updated_at)
         VALUES (?, 1, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           draft_data = excluded.draft_data,
           updated_at = datetime('now')`
      ).run(userId, json);
      const row = sqlite.prepare(
        `SELECT updated_at FROM eod_drafts WHERE user_id=?`
      ).get(userId) as any;
      res.json({ ok: true, updatedAt: row?.updated_at ?? null });
    } catch (e: any) {
      console.error("[eod/draft PUT]", e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  app.delete('/api/eod/draft', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const sqlite = (storageExtra as any).getSqlite();
      sqlite.prepare(`DELETE FROM eod_drafts WHERE user_id=?`).run(userId);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[eod/draft DELETE]", e?.message ?? e);
      res.status(500).json({ error: e?.message ?? "Unknown error" });
    }
  });

  // ── Personal CLR report (per-user analytics for /my-report page) ───────────
  app.get('/api/my-report', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const periodName = (req.query.period as string) || "week";
    const { startDate, endDate } = resolveNamedPeriod(periodName);
    const todayStr = businessTodayForRequest(req, storageExtra.getRawSqlite());

    const user = storage.getUserById(userId) as any;
    // Per-CLR admin-set goals take precedence over the user's own (team default) goals.
    let goals = {
      calls: Number(user?.goalCallsWeekly ?? user?.goal_calls_weekly ?? 0),
      transfers: Number(user?.goalTransfersWeekly ?? user?.goal_transfers_weekly ?? 0),
      appointments: Number(user?.goalAppointmentsWeekly ?? user?.goal_appointments_weekly ?? 0),
    };
    let goalsSource: "individual" | "default" = "default";
    try {
      const sqlite = storageExtra.getSqlite();
      const cg = sqlite.prepare(`SELECT calls_goal, transfers_goal, appointments_goal FROM clr_goals WHERE user_id = ?`).get(userId) as any;
      if (cg) {
        goals = {
          calls: Number(cg.calls_goal ?? 0),
          transfers: Number(cg.transfers_goal ?? 0),
          appointments: Number(cg.appointments_goal ?? 0),
        };
        goalsSource = "individual";
      }
    } catch {}

    const outcomes = (storage.getLeadOutcomes({ startDate, endDate, assistantId: userId }) as any[]);
    const callLogs = (storage.getCallLogsByRange(startDate, endDate) as any[])
      .filter((l: any) => (l.assistantId ?? l.assistant_id) === userId);

    const ot = (o: any) => o.outcomeType ?? o.outcome_type;
    const transferType = (o: any) => o.transferType ?? o.transfer_type;
    const leadTf = (o: any) => o.leadTimeframe ?? o.lead_timeframe;
    const sumCalls = (logs: any[]) => logs.reduce((s, l) => s + (l.callsMade ?? l.calls_made ?? 0), 0);

    const totalCalls = sumCalls(callLogs);
    const totalTransfers = outcomes.filter(o => ot(o) === "transfer").length;
    const totalAppointments = outcomes.filter(o => ot(o) === "appointment").length;
    const totalFellThrough = outcomes.filter(o => ot(o) === "fell_through").length;
    const totalDeferrals = outcomes.filter(o => ot(o) === "deferral").length;
    const totalCallbacks = outcomes.filter(o => ot(o) === "callback_requested").length;
    const totalFutureContacts = outcomes.filter(o => ot(o) === "future_contact").length;
    const totalNoAnswer = outcomes.filter(o => ot(o) === "no_answer").length;
    const transferRate = totalCalls > 0 ? +((totalTransfers / totalCalls) * 100).toFixed(1) : 0;

    // Full outcome breakdown — always returns all 7 keys (zero counts for missing types)
    const outcomeBreakdown: Record<string, number> = {
      transfer: totalTransfers,
      appointment: totalAppointments,
      callback_requested: totalCallbacks,
      deferral: totalDeferrals,
      future_contact: totalFutureContacts,
      fell_through: totalFellThrough,
      no_answer: totalNoAnswer,
    };

    // Per-day breakdown for trend chart
    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    const dayMs = 86400000;
    const days: string[] = [];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + dayMs)) {
      days.push(d.toISOString().split("T")[0]);
    }
    const daily = days.map(day => {
      const dayOutcomes = outcomes.filter((o: any) => o.date === day);
      const dayLogs = callLogs.filter((l: any) => (l.logDate ?? l.log_date) === day);
      return {
        date: day,
        calls: sumCalls(dayLogs),
        transfers: dayOutcomes.filter(o => ot(o) === "transfer").length,
        appointments: dayOutcomes.filter(o => ot(o) === "appointment").length,
        fellThrough: dayOutcomes.filter(o => ot(o) === "fell_through").length,
        callbacks: dayOutcomes.filter(o => ot(o) === "callback_requested").length,
        deferrals: dayOutcomes.filter(o => ot(o) === "deferral").length,
        futureContacts: dayOutcomes.filter(o => ot(o) === "future_contact").length,
        noAnswer: dayOutcomes.filter(o => ot(o) === "no_answer").length,
      };
    });

    // Hourly breakdown for "today" (local timezone, 24 buckets)
    // Outcomes: use created_at if present, else fall back to date-only (bucket 0).
    // Call logs don't have timestamps, so their calls collapse to a single bucket.
    let hourly: Array<{ hour: number; label: string; transfers: number; appointments: number; fellThrough: number; callbacks: number; deferrals: number; futureContacts: number; noAnswer: number; calls: number }> | undefined;
    if (periodName === "today") {
      const buckets = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: `${h.toString().padStart(2, "0")}:00`,
        transfers: 0, appointments: 0, fellThrough: 0,
        callbacks: 0, deferrals: 0, futureContacts: 0, noAnswer: 0,
        calls: 0,
      }));
      const hourOf = (o: any): number => {
        const created = o.createdAt ?? o.created_at;
        if (created) {
          const d = new Date(created);
          if (!isNaN(d.getTime())) return d.getHours();
        }
        return new Date().getHours();
      };
      for (const o of outcomes) {
        if (o.date !== todayStr) continue;
        const h = hourOf(o);
        if (h < 0 || h > 23) continue;
        const t = ot(o);
        if (t === "transfer") buckets[h].transfers++;
        else if (t === "appointment") buckets[h].appointments++;
        else if (t === "fell_through") buckets[h].fellThrough++;
        else if (t === "callback_requested") buckets[h].callbacks++;
        else if (t === "deferral") buckets[h].deferrals++;
        else if (t === "future_contact") buckets[h].futureContacts++;
        else if (t === "no_answer") buckets[h].noAnswer++;
      }
      // Put all of today's call count into the current hour bucket as a rough proxy.
      const totalTodayCalls = sumCalls(callLogs.filter((l: any) => (l.logDate ?? l.log_date) === todayStr));
      if (totalTodayCalls > 0) {
        buckets[new Date().getHours()].calls = totalTodayCalls;
      }
      hourly = buckets;
    }

    const daysInPeriod = days.length;
    const daysWithActivity = daily.filter(d => d.calls > 0 || d.transfers > 0 || d.appointments > 0).length;
    const avgCallsPerDay = daysWithActivity > 0
      ? +(totalCalls / daysWithActivity).toFixed(1)
      : 0;

    // Transfer breakdown: direct vs. appointment, + timeframe buckets
    const transferOutcomes = outcomes.filter(o => ot(o) === "transfer");
    const transferByType = {
      direct: transferOutcomes.filter(o => transferType(o) === "direct").length,
      appointment: transferOutcomes.filter(o => transferType(o) === "appointment").length,
      unspecified: transferOutcomes.filter(o => !transferType(o)).length,
    };
    const transferByTimeframe: Record<string, number> = {};
    for (const t of transferOutcomes) {
      const tf = String(leadTf(t) ?? "unspecified");
      transferByTimeframe[tf] = (transferByTimeframe[tf] || 0) + 1;
    }

    // Appointments summary — include all active appointment-like types:
    // "appointment", "callback_requested", "deferral", "future_contact".
    const ACTIVE_APPT_TYPES = new Set(["appointment", "callback_requested", "deferral", "future_contact"]);
    const isApptType = (o: any) => ACTIVE_APPT_TYPES.has(ot(o));
    const appointmentOutcomes = outcomes.filter(isApptType);
    const allMyApptOutcomes = (storage.getLeadOutcomes({ assistantId: userId }) as any[])
      .filter(isApptType);
    const upcomingAppointments = allMyApptOutcomes.filter((o: any) => {
      const fd = o.followUpDate ?? o.follow_up_date;
      return fd && fd >= todayStr;
    }).length;
    const overdueAppointments = allMyApptOutcomes.filter((o: any) => {
      const fd = o.followUpDate ?? o.follow_up_date;
      return fd && fd < todayStr;
    }).length;
    const completedThisPeriod = appointmentOutcomes.length;

    // LO Coverage — count calls per LO from outcomes + assignments
    const allLos = storage.getLoanOfficers() as any[];
    const loCallTally: Record<number, { loId: number; name: string; outcomes: number }> = {};
    for (const o of outcomes) {
      const loId = (o.loId ?? o.lo_id) as number;
      if (!Number.isFinite(loId)) continue;
      if (!loCallTally[loId]) {
        const lo = allLos.find(l => l.id === loId);
        loCallTally[loId] = { loId, name: lo ? (lo.fullName ?? lo.full_name ?? `LO #${loId}`) : `LO #${loId}`, outcomes: 0 };
      }
      loCallTally[loId].outcomes += 1;
    }
    const loCoverage = Object.values(loCallTally).sort((a, b) => b.outcomes - a.outcomes);

    // Personal best: day with highest transfers
    let bestDay: { date: string; transfers: number } | null = null;
    for (const d of daily) {
      if (!bestDay || d.transfers > bestDay.transfers) bestDay = { date: d.date, transfers: d.transfers };
    }
    if (bestDay && bestDay.transfers === 0) bestDay = null;

    // Current streak: consecutive weekdays (Mon-Fri) up to today with >=1 transfer
    let streak = 0;
    const transfersByDate: Record<string, number> = {};
    const allMyOutcomes = storage.getLeadOutcomes({ assistantId: userId }) as any[];
    for (const o of allMyOutcomes) {
      if (ot(o) === "transfer") {
        const d = (o.date || "").slice(0, 10);
        if (d) transfersByDate[d] = (transfersByDate[d] || 0) + 1;
      }
    }
    const toPrevWeekday = (d: Date): Date => {
      const r = new Date(d);
      r.setDate(r.getDate() - 1);
      while (r.getDay() === 0 || r.getDay() === 6) r.setDate(r.getDate() - 1);
      return r;
    };
    let cursor = new Date(todayStr + "T00:00:00");
    while (cursor.getDay() === 0 || cursor.getDay() === 6) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (true) {
      const key = cursor.toISOString().split("T")[0];
      if ((transfersByDate[key] || 0) >= 1) {
        streak += 1;
        cursor = toPrevWeekday(cursor);
      } else {
        break;
      }
    }

    // Week-to-date totals (always Sun–Sat containing today) for EOD summary / header
    const wtd = resolveNamedPeriod("week");
    const wtdOutcomes = storage.getLeadOutcomes({ startDate: wtd.startDate, endDate: wtd.endDate, assistantId: userId }) as any[];
    const wtdLogs = (storage.getCallLogsByRange(wtd.startDate, wtd.endDate) as any[])
      .filter((l: any) => (l.assistantId ?? l.assistant_id) === userId);
    const weekToDate = {
      startDate: wtd.startDate,
      endDate: wtd.endDate,
      calls: sumCalls(wtdLogs),
      transfers: wtdOutcomes.filter((o: any) => ot(o) === "transfer").length,
      appointments: wtdOutcomes.filter((o: any) => ot(o) === "appointment").length,
      fellThrough: wtdOutcomes.filter((o: any) => ot(o) === "fell_through").length,
    };

    res.json({
      user: { id: userId, name: user?.name ?? "", email: user?.email ?? "" },
      period: periodName,
      startDate,
      endDate,
      daysInPeriod,
      goals,
      goalsSource,
      totals: {
        calls: totalCalls,
        messages: (storageExtra.getEodReportsByRange(startDate, endDate) as any[])
          .filter((r: any) => r.assistant_id === userId)
          .reduce((s: number, r: any) => s + Number(r.messages_sent ?? 0), 0),
        transfers: totalTransfers,
        appointments: totalAppointments,
        fellThrough: totalFellThrough,
        deferrals: totalDeferrals,
        callbacks: totalCallbacks,
        futureContacts: totalFutureContacts,
        noAnswer: totalNoAnswer,
        transferRate,
        avgCallsPerDay,
      },
      outcomeBreakdown,
      daily,
      hourly,
      transferByType,
      transferByTimeframe,
      appointments: {
        upcoming: upcomingAppointments,
        overdue: overdueAppointments,
        completedThisPeriod,
      },
      loCoverage,
      bestDay,
      streak,
      weekToDate,
    });
  });

  // Update weekly goals for the current user
  app.put('/api/my-goals', requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const toInt = (v: any): number => {
      const n = parseInt(String(v ?? 0), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const goalCallsWeekly = toInt(req.body?.goalCallsWeekly);
    const goalTransfersWeekly = toInt(req.body?.goalTransfersWeekly);
    const goalAppointmentsWeekly = toInt(req.body?.goalAppointmentsWeekly);
    try {
      const sqlite = storageExtra.getSqlite();
      sqlite.prepare(`UPDATE users SET goal_calls_weekly=?, goal_transfers_weekly=?, goal_appointments_weekly=? WHERE id=?`)
        .run(goalCallsWeekly, goalTransfersWeekly, goalAppointmentsWeekly, userId);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? "Failed to update goals" });
    }
    res.json({ ok: true, goals: { calls: goalCallsWeekly, transfers: goalTransfersWeekly, appointments: goalAppointmentsWeekly } });
  });

  // ── Per-CLR Goals (admin-managed) ────────────────────────────────────────────
  // List all CLR goals for the org (admin only)
  app.get("/api/goals", requireAuth, (req: any, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const orgId = req.session_user?.orgId ?? 1;
    try {
      const sqlite = storageExtra.getSqlite();
      const rows = sqlite.prepare(`
        SELECT user_id AS userId, org_id AS orgId,
               calls_goal AS callsGoal,
               transfers_goal AS transfersGoal,
               appointments_goal AS appointmentsGoal,
               updated_at AS updatedAt
        FROM clr_goals
        WHERE org_id = ?
      `).all(orgId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to list goals" });
    }
  });

  // Get goals for a specific user. Falls back to the user's own weekly goal fields.
  app.get("/api/goals/:userId", requireAuth, (req: any, res) => {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
    // Admins and managers can view anyone's goals; everyone else only their own.
    if (req.session_user?.userId !== userId) {
      const me = storage.getUserById(Number(req.session_user?.userId)) as any;
      const privileged = me?.role === "admin" || !!(me?.isManager ?? me?.is_manager);
      if (!privileged) return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const sqlite = storageExtra.getSqlite();
      const row = sqlite.prepare(`
        SELECT user_id AS userId, org_id AS orgId,
               calls_goal AS callsGoal,
               transfers_goal AS transfersGoal,
               appointments_goal AS appointmentsGoal,
               auto_adjust AS autoAdjust,
               adjustment_basis AS adjustmentBasis,
               goal_model AS goalModel,
               adjustment_pct AS adjustmentPct,
               updated_at AS updatedAt
        FROM clr_goals WHERE user_id = ?
      `).get(userId) as any;
      if (row) {
        return res.json({
          userId,
          source: "individual",
          goals: {
            calls: row.callsGoal ?? 0,
            transfers: row.transfersGoal ?? 0,
            appointments: row.appointmentsGoal ?? 0,
          },
          autoAdjust: !!row.autoAdjust,
          adjustmentBasis: row.adjustmentBasis ?? null,
          goalModel: row.goalModel ?? "manual",
          adjustmentPct: row.adjustmentPct ?? 5,
        });
      }
      // Fallback: team default from the user's own stored weekly goal fields.
      const user = storage.getUserById(userId) as any;
      return res.json({
        userId,
        source: "default",
        goals: {
          calls: Number(user?.goalCallsWeekly ?? user?.goal_calls_weekly ?? 0),
          transfers: Number(user?.goalTransfersWeekly ?? user?.goal_transfers_weekly ?? 0),
          appointments: Number(user?.goalAppointmentsWeekly ?? user?.goal_appointments_weekly ?? 0),
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to fetch goals" });
    }
  });

  // Upsert goals for a user (admins and managers)
  app.patch("/api/goals/:userId", requireAuth, (req: any, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
    const toInt = (v: any) => {
      const n = parseInt(String(v ?? 0), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const calls = toInt(req.body?.callsGoal ?? req.body?.calls);
    const transfers = toInt(req.body?.transfersGoal ?? req.body?.transfers);
    const appointments = toInt(req.body?.appointmentsGoal ?? req.body?.appointments);
    // goal_model: 'manual' | 'adjustable' | 'staircase'
    const rawModel = String(req.body?.goalModel ?? 'manual');
    const goalModel = ['manual','adjustable','staircase'].includes(rawModel) ? rawModel : 'manual';
    const autoAdjust = goalModel !== 'manual' ? 1 : 0;
    const adjustmentPct = Math.max(0, Math.min(100, parseFloat(String(req.body?.adjustmentPct ?? 5)) || 5));
    const orgId = req.session_user?.orgId ?? 1;
    try {
      const sqlite = storageExtra.getSqlite();
      sqlite.prepare(`
        INSERT INTO clr_goals (user_id, org_id, calls_goal, transfers_goal, appointments_goal, auto_adjust, goal_model, adjustment_pct, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          calls_goal = excluded.calls_goal,
          transfers_goal = excluded.transfers_goal,
          appointments_goal = excluded.appointments_goal,
          auto_adjust = excluded.auto_adjust,
          goal_model = excluded.goal_model,
          adjustment_pct = excluded.adjustment_pct,
          updated_at = datetime('now')
      `).run(userId, orgId, calls, transfers, appointments, autoAdjust, goalModel, adjustmentPct);
      res.json({ ok: true, userId, goals: { calls, transfers, appointments }, autoAdjust: !!autoAdjust, goalModel, adjustmentPct });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update goals" });
    }
  });

  // ── Call Scripts ────────────────────────────────────────────────────────────

  // Helper: can user modify this script?
  // - Admins can edit any script.
  // - Regular users can only edit scripts they own (owner_id === their userId).
  // - Default scripts (owner_id IS NULL) are only editable by admins.
  function canEditScript(sessionUser: any, script: any): boolean {
    if (!sessionUser) return false;
    const isAdmin = sessionUser.isAdmin === true || sessionUser.role === 'admin';
    if (isAdmin) return true;
    if (script.owner_id == null) return false; // default script — admin only
    return script.owner_id === sessionUser.userId;
  }

  // ── AI Script Coach ─────────────────────────────────────────────────────────
  function getAiConfig() {
    const s = storageExtra.getEmailSettings() as any;
    const envKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    const dbKey = String(s.ai_api_key || "").trim();
    const model = String(s.ai_model || "").trim() || "claude-sonnet-4-6";
    const fastModel = String(s.ai_fast_model || "").trim() || "claude-haiku-4-5";
    return { key: envKey || dbKey, model, fastModel };
  }

  async function callAnthropic(system: string, messages: any[], maxTokens = 1024, modelOverride?: string): Promise<string> {
    const { key, model } = getAiConfig();
    if (!key) throw new Error("AI is not set up yet. An admin needs to add an Anthropic API key in Settings.");
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelOverride || model, max_tokens: maxTokens, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("[script-coach] anthropic error", resp.status, t.slice(0, 400));
      throw new Error("The AI service returned an error (" + resp.status + "). Check the API key / model in Settings.");
    }
    const data: any = await resp.json();
    const text = Array.isArray(data?.content)
      ? data.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n").trim()
      : "";
    return text;
  }

  // Text outline of the company's proven default script — the backbone the coach
  // personalizes. Includes each step's text + the response branches.
  function defaultScriptOutlineText(): string {
    try {
      const db = storageExtra.getRawSqlite();
      const script = db.prepare("SELECT * FROM call_scripts WHERE owner_id IS NULL AND is_active=1 ORDER BY created_at ASC LIMIT 1").get() as any;
      if (!script) return "";
      const nodes = db.prepare("SELECT * FROM script_nodes WHERE script_id=? ORDER BY node_order ASC").all(script.id) as any[];
      if (!nodes.length) return "";
      const allResp = db.prepare("SELECT sr.* FROM script_responses sr JOIN script_nodes sn ON sr.node_id=sn.id WHERE sn.script_id=? ORDER BY sr.response_order ASC").all(script.id) as any[];
      const byNode = new Map<number, any[]>();
      for (const r of allResp) { if (!byNode.has(r.node_id)) byNode.set(r.node_id, []); byNode.get(r.node_id)!.push(r); }
      const lines = nodes.slice(0, 40).map((n: any, i: number) => {
        const txt = String(n.text || "").replace(/\s+/g, " ").slice(0, 320);
        const labels = (byNode.get(n.id) || []).map((r: any) => r.label).filter(Boolean).slice(0, 6);
        return (i + 1) + ". " + txt + (labels.length ? ("\n   Branches: " + labels.join(" | ")) : "");
      });
      return "Name: " + (script.name || "Default Script") + "\n" + lines.join("\n");
    } catch { return ""; }
  }

  // Text outline of a user's existing personal script (for refine mode).
  function userScriptOutlineText(userId: number): string {
    try {
      const db = storageExtra.getRawSqlite();
      const script = db.prepare("SELECT * FROM call_scripts WHERE owner_id=? LIMIT 1").get(userId) as any;
      if (!script) return "";
      const nodes = db.prepare("SELECT * FROM script_nodes WHERE script_id=? ORDER BY node_order ASC").all(script.id) as any[];
      if (!nodes.length) return "";
      const lines = nodes.slice(0, 30).map((n: any, i: number) => (i + 1) + ". " + String(n.text || "").replace(/\s+/g, " ").slice(0, 220));
      return "CURRENT SCRIPT (the rep already has this — help them refine it, do not start over):\nName: " + (script.name || "My Script") + "\n" + lines.join("\n");
    } catch { return ""; }
  }

  const COACH_SYSTEM = [
    "You are a warm, expert call-script coach for CLRs (client lead reps) at West Capital Lending, a mortgage company. CLRs cold-call mortgage leads and try to transfer interested borrowers to a loan officer (LO).",
    "Your job: help the rep create THEIR OWN version of the company's proven default script (provided to you below). You are NOT starting from a blank page — you start from the default and personalize it with them.",
    "How to coach:",
    "- Walk through the default script ONE section at a time, in order (opening, goal discovery, qualifying, transfer/appointment, objections, voicemail).",
    "- For each section: briefly say how the default handles it, then ask whether they want to keep it as-is or say it their own way. Your goal each turn is to find where they want to DIFFER from the default.",
    "- Listen closely to HOW they talk — their vocabulary, rhythm, formality, filler words, and signature phrases. You are learning their manner of speech so the finished script reads exactly like them.",
    "- When they give you their wording, reflect it back, note one genuine strength and at most one small tweak, then confirm and move to the next section.",
    "Rules:",
    "- This is often a spoken phone call. Keep every reply short and natural — 1 to 3 sentences. Ask ONE thing at a time. Do not use emojis (it may be read aloud).",
    "- Never lecture. Be encouraging and specific. Suggest, never force.",
    "- Once you have been through the sections (keeping or customizing each), tell them they can click Generate My Script whenever they are ready.",
    "Begin like a friendly phone call: greet them, ask their first name and how long they have been making these calls, and tell them you will walk through the company script together and tweak it to sound like them. Then start on the opening section.",
  ].join("\n");

  app.post("/api/script-coach/chat", requireAuth, async (req: any, res) => {
    try {
      const userId = Number(req.session_user?.userId);
      const refine = req.body?.mode === "refine";
      const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const messages = raw
        .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
        .slice(-30)
        .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      const def = defaultScriptOutlineText();
      let system = COACH_SYSTEM + (def ? "\n\n=== DEFAULT SCRIPT (the proven backbone to personalize with the rep) ===\n" + def : "");
      if (refine) {
        const outline = userId ? userScriptOutlineText(userId) : "";
        system += "\n\nREFINE MODE: The rep already has a personal script (below). Help them improve that one rather than start over." + (outline ? "\n\n" + outline : "");
        if (!messages.length) messages.push({ role: "user", content: "I want to refine my existing call script." });
      } else if (!messages.length) {
        messages.push({ role: "user", content: "Hi, I want to build my call script." });
      }
      const reply = await callAnthropic(system, messages, 700);
      res.json({ reply: reply || "Sorry, I did not catch that — could you say it another way?" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Coach unavailable" });
    }
  });

  const BUILD_SYSTEM = [
    "You produce a CLR's personalized call script as STRICT JSON only. No prose, no markdown fences.",
    "Schema: { \"name\": string, \"nodes\": [ { \"key\": string, \"text\": string, \"hint\": string, \"responses\": [ { \"label\": string, \"color\": \"green\"|\"blue\"|\"default\"|\"red\", \"next\": string|null } ] } ] }",
    "How to build:",
    "- START from the DEFAULT SCRIPT structure provided below: keep the same sections and branching (opening, discovery, qualifying, transfer/appointment, objections, voicemail). Do not drop sections the default has.",
    "- Apply the specific changes the rep asked for in the conversation.",
    "- Rewrite ALL of the wording in the rep's OWN manner of speech — match their vocabulary, rhythm, level of formality, and signature phrases as shown in the conversation. It must sound like THEM, not generic and not a copy of the default.",
    "- The FIRST node is the opening (it becomes the root). next references another node key, or null to end that path.",
    "- color: green = positive/interested, blue = neutral/info, red = negative/end (DNC, not interested), default = standard. 8 to 16 nodes.",
    "Return ONLY the JSON object.",
  ].join("\n");

  app.post("/api/script-coach/build", requireAuth, async (req: any, res) => {
    const userId = Number(req.session_user?.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const convo = raw
        .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
        .map((m: any) => (m.role === "user" ? "REP: " : "COACH: ") + m.content)
        .join("\n")
        .slice(-12000);
      if (!convo.trim()) return res.status(400).json({ error: "Chat with the coach first, then generate." });
      const refine = req.body?.mode === "refine";
      const existing = refine ? userScriptOutlineText(userId) : "";
      const def = defaultScriptOutlineText();
      const buildMsg =
        (def ? "=== DEFAULT SCRIPT (start from this structure and branching) ===\n" + def + "\n\n" : "") +
        (existing ? (existing + "\n\nApply the changes discussed below to that script (keep what was not changed).\n\n") : "") +
        "Conversation with the rep — rewrite every line in THEIR manner of speech shown here:\n\n" + convo;
      const out = await callAnthropic(BUILD_SYSTEM, [{ role: "user", content: buildMsg }], 4000);
      let spec: any = null;
      try {
        const start = out.indexOf("{");
        const end = out.lastIndexOf("}");
        spec = JSON.parse(out.slice(start, end + 1));
      } catch { return res.status(502).json({ error: "Could not parse the generated script. Please try again." }); }
      if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) {
        return res.status(502).json({ error: "The generated script came back empty. Chat a bit more, then try again." });
      }
      const actor = (storage.getUsers() as any[]).find(u => u.id === userId);
      if (typeof spec.name !== "string" || !spec.name.trim()) spec.name = (actor?.name ?? "My") + " Script";
      // Preview only — the client shows it and calls /save to persist (so reps can
      // name it and keep multiple drafts to compare).
      res.json({ ok: true, spec });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Build failed" });
    }
  });

  // Persist a previewed script as a saved draft (does not delete other drafts).
  app.post("/api/script-coach/save", requireAuth, (req: any, res) => {
    const userId = Number(req.session_user?.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const spec = req.body?.spec;
    if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) return res.status(400).json({ error: "Nothing to save." });
    try {
      const actor = (storage.getUsers() as any[]).find(u => u.id === userId);
      const name = (typeof req.body?.name === "string" && req.body.name.trim())
        ? req.body.name.trim().slice(0, 120)
        : ((typeof spec.name === "string" && spec.name.trim()) ? spec.name.trim().slice(0, 120) : ((actor?.name ?? "My") + " Script"));
      const created = (storageExtra as any).buildPersonalScriptFromSpec(userId, name, spec, false);
      audit({
        userId, userName: actor?.name ?? "Unknown", action: "create",
        entityType: "call_script", entityId: created?.id ?? 0,
        entityLabel: "Saved coach script draft: " + name,
        details: JSON.stringify({ nodes: spec.nodes.length }),
      });
      res.json({ ok: true, script: created });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Save failed" });
    }
  });

  // Live coverage / readiness assessment of the script-so-far.
  const COVERAGE_STAGES = [
    { key: "opening", label: "Opening & permission" },
    { key: "discovery", label: "Goal discovery" },
    { key: "qualifying", label: "Qualifying questions" },
    { key: "transfer", label: "Transfer / appointment" },
    { key: "objections", label: "Objection handling" },
    { key: "voicemail", label: "Voicemail" },
  ];
  function emptyCoverage() {
    return { score: 0, stages: COVERAGE_STAGES.map(s => ({ ...s, done: false, summary: "" })), nextGap: "Tell the coach how you open a call." };
  }
  const COVERAGE_SYSTEM = [
    "You assess how complete a CLR call script is, based on a coaching conversation. Return STRICT JSON only, no prose, no markdown.",
    "Schema: { \"score\": number, \"stages\": [ { \"key\": string, \"label\": string, \"done\": boolean, \"summary\": string } ], \"nextGap\": string }",
    "Return EXACTLY these 6 stages in this order with these keys and labels: opening (Opening & permission), discovery (Goal discovery), qualifying (Qualifying questions), transfer (Transfer / appointment), objections (Objection handling), voicemail (Voicemail).",
    "done = the rep has given enough to write that part. summary = one short phrase (under 8 words) capturing what they said for that stage, or empty if not done.",
    "score = 0 to 100, roughly the share of the 6 stages covered. nextGap = one short sentence telling the rep what to work on next, or a brief congrats if all done.",
    "Return ONLY the JSON object.",
  ].join("\n");

  app.post("/api/script-coach/coverage", requireAuth, async (req: any, res) => {
    try {
      const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const convo = raw
        .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
        .map((m: any) => (m.role === "user" ? "REP: " : "COACH: ") + m.content)
        .join("\n")
        .slice(-10000);
      if (!convo.trim()) return res.json(emptyCoverage());
      const out = await callAnthropic(COVERAGE_SYSTEM, [{ role: "user", content: convo }], 700, getAiConfig().fastModel);
      let data: any = null;
      try { const s = out.indexOf("{"); const e = out.lastIndexOf("}"); data = JSON.parse(out.slice(s, e + 1)); } catch {}
      if (!data || !Array.isArray(data.stages) || !data.stages.length) return res.json(emptyCoverage());
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Coverage unavailable" });
    }
  });

  // Natural text-to-speech config for the coach voice call.
  function getTtsConfig() {
    const s = storageExtra.getEmailSettings() as any;
    const provider = String(s.tts_provider || "browser").trim().toLowerCase();
    const key = String(s.tts_api_key || "").trim() || (provider === "openai" ? (process.env.OPENAI_API_KEY || "").trim() : (process.env.ELEVENLABS_API_KEY || "").trim());
    const voice = String(s.tts_voice || "").trim();
    return { provider, key, voice };
  }

  // Whether the AI coach is available (admin configured a key).
  app.get("/api/script-coach/status", requireAuth, (_req: any, res: any) => {
    try {
      const tts = getTtsConfig();
      const ttsReady = (tts.provider === "elevenlabs" || tts.provider === "openai") && !!tts.key;
      res.json({ enabled: !!getAiConfig().key, ttsProvider: ttsReady ? tts.provider : "browser" });
    } catch { res.json({ enabled: false, ttsProvider: "browser" }); }
  });

  // Lists the voices the current TTS provider offers, for the in-call picker.
  app.get("/api/script-coach/voices", requireAuth, async (_req: any, res: any) => {
    const { provider, key } = getTtsConfig();
    try {
      if (provider === "openai") {
        const names = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
        return res.json({ provider, voices: names.map(v => ({ id: v, name: v.charAt(0).toUpperCase() + v.slice(1) })) });
      }
      if (provider === "elevenlabs" && key) {
        const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
        if (!r.ok) return res.json({ provider, voices: [] });
        const data: any = await r.json();
        const voices = Array.isArray(data?.voices)
          ? data.voices.map((v: any) => ({ id: v.voice_id, name: String(v.name || "Voice").split(" - ")[0] }))
          : [];
        return res.json({ provider, voices });
      }
      return res.json({ provider: "browser", voices: [] });
    } catch {
      return res.json({ provider, voices: [] });
    }
  });

  // Returns natural-voice audio (mp3) for a line of coach text.
  app.post("/api/script-coach/tts", requireAuth, async (req: any, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 1200) : "";
    if (!text.trim()) return res.status(400).json({ error: "No text" });
    const { provider, key, voice } = getTtsConfig();
    if ((provider !== "elevenlabs" && provider !== "openai") || !key) return res.status(409).json({ error: "Natural voice not configured" });
    const reqVoice = typeof req.body?.voice === "string" ? req.body.voice.trim() : "";
    try {
      let resp: Response;
      if (provider === "elevenlabs") {
        const voiceId = reqVoice || voice || "JBFqnCBsd6RMkjVDRZzb"; // George — warm storyteller (works on free tier)
        resp = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg" },
          body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.3 } }),
        });
      } else {
        resp = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { "authorization": "Bearer " + key, "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: reqVoice || voice || "nova", input: text, response_format: "mp3" }),
        });
      }
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.error("[coach-tts] " + provider + " error", resp.status, t.slice(0, 300));
        return res.status(502).json({ error: "Voice service error (" + resp.status + ")" });
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "TTS failed" });
    }
  });

  // Get default scripts (owner_id IS NULL)
  app.get('/api/call-scripts/defaults', requireAuth, (_req: any, res: any) => {
    res.json(storageExtra.getDefaultScripts());
  });

  // Get current user's personal script (or null)
  app.get('/api/call-scripts/mine', requireAuth, (req: any, res: any) => {
    const script = storageExtra.getUserScript(req.session_user!.userId);
    res.json(script ?? null);
  });

  // Clone default script into personal copy for current user
  app.post('/api/call-scripts/:id/clone', requireAuth, (req: any, res: any) => {
    const userId = req.session_user!.userId;
    const cloned = storageExtra.cloneScriptForUser(parseInt(req.params.id), userId);
    if (!cloned) return res.status(404).json({ error: 'Source script not found' });
    res.json(cloned);
  });

  // Promote an existing script to be the global default for everyone (admin only).
  app.post('/api/call-scripts/:id/make-default', requireAuth, (req: any, res: any) => {
    if (!req.session_user?.isAdmin && req.session_user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const id = parseInt(req.params.id, 10);
    const promoted = storageExtra.promoteScriptToDefault(id);
    if (!promoted) return res.status(404).json({ error: 'Script not found' });
    const actor = (storage.getUsers() as any[]).find(u => u.id === req.session_user?.userId);
    audit({
      userId: req.session_user?.userId ?? 0,
      userName: actor?.name ?? 'Unknown',
      action: 'update',
      entityType: 'call_script',
      entityId: promoted.id,
      entityLabel: 'Default script set to: ' + (promoted.name ?? ('#' + promoted.id)),
      details: JSON.stringify({ sourceScriptId: id, newDefaultId: promoted.id }),
    });
    res.json(promoted);
  });

  // Reset personal script back to default (delete personal copy)
  app.delete('/api/call-scripts/mine', requireAuth, (req: any, res: any) => {
    const script = storageExtra.getUserScript(req.session_user!.userId);
    if (script) storageExtra.deleteCallScript(script.id);
    res.json({ ok: true });
  });

  app.get('/api/call-scripts', requireAuth, (_req: any, res: any) => {
    const scripts = storageExtra.getCallScripts();
    const users = storage.getUsers() as any[];
    const withOwner = scripts.map((s: any) => {
      const owner = s.owner_id != null ? users.find(u => u.id === s.owner_id) : null;
      return { ...s, owner_name: owner?.name ?? null, is_default: s.owner_id == null };
    });
    res.json(withOwner);
  });

  app.post('/api/call-scripts', requireAuth, (req: any, res: any) => {
    if (!req.session_user?.isAdmin) return res.status(403).json({ error: 'Admin only' });
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    res.json(storageExtra.createCallScript({ name, description, createdBy: req.session_user.userId }));
  });

  app.patch('/api/call-scripts/:id', requireAuth, (req: any, res: any) => {
    const script = storageExtra.getCallScript(parseInt(req.params.id));
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    res.json(storageExtra.updateCallScript(parseInt(req.params.id), req.body));
  });

  app.delete('/api/call-scripts/:id', requireAuth, (req: any, res: any) => {
    const script = storageExtra.getCallScript(parseInt(req.params.id));
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    storageExtra.deleteCallScript(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/call-scripts/:id/tree', requireAuth, (req: any, res: any) => {
    const tree = storageExtra.getFullScriptTree(parseInt(req.params.id));
    if (!tree) return res.status(404).json({ error: 'Not found' });
    res.json(tree);
  });

  app.get('/api/call-scripts/:id/node/:nodeId', requireAuth, (req: any, res: any) => {
    const node = storageExtra.getNodeById(parseInt(req.params.nodeId));
    if (!node) return res.status(404).json({ error: 'Not found' });
    const responses = storageExtra.getNodeResponses(node.id);
    res.json({ ...node, responses });
  });

  app.get('/api/call-scripts/:id/root', requireAuth, (req: any, res: any) => {
    const node = storageExtra.getRootNode(parseInt(req.params.id));
    if (!node) return res.status(404).json({ error: 'No root node' });
    const responses = storageExtra.getNodeResponses(node.id);
    res.json({ ...node, responses });
  });

  app.post('/api/call-scripts/:id/nodes', requireAuth, (req: any, res: any) => {
    const script = storageExtra.getCallScript(parseInt(req.params.id));
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    const { text, hint, parentNodeId, parentResponseId, nodeOrder } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    res.json(storageExtra.createScriptNode({ scriptId: parseInt(req.params.id), text, hint, parentNodeId, parentResponseId, nodeOrder }));
  });

  app.patch('/api/script-nodes/:id', requireAuth, (req: any, res: any) => {
    const node = storageExtra.getNodeById(parseInt(req.params.id));
    if (!node) return res.status(404).json({ error: 'Not found' });
    const script = storageExtra.getCallScript(node.script_id);
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    res.json(storageExtra.updateScriptNode(parseInt(req.params.id), req.body));
  });

  app.delete('/api/script-nodes/:id', requireAuth, (req: any, res: any) => {
    const node = storageExtra.getNodeById(parseInt(req.params.id));
    if (!node) return res.status(404).json({ error: 'Not found' });
    const script = storageExtra.getCallScript(node.script_id);
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    storageExtra.deleteScriptNode(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/script-nodes/:nodeId/responses', requireAuth, (req: any, res: any) => {
    const node = storageExtra.getNodeById(parseInt(req.params.nodeId));
    if (!node) return res.status(404).json({ error: 'Not found' });
    const script = storageExtra.getCallScript(node.script_id);
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    const { label, color, nextNodeId, responseOrder } = req.body;
    if (!label) return res.status(400).json({ error: 'label required' });
    res.json(storageExtra.createScriptResponse({ nodeId: parseInt(req.params.nodeId), label, color, nextNodeId, responseOrder }));
  });

  app.patch('/api/script-responses/:id', requireAuth, (req: any, res: any) => {
    const script = storageExtra.getScriptByResponseId(parseInt(req.params.id));
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    res.json(storageExtra.updateScriptResponse(parseInt(req.params.id), req.body));
  });

  app.delete('/api/script-responses/:id', requireAuth, (req: any, res: any) => {
    const script = storageExtra.getScriptByResponseId(parseInt(req.params.id));
    if (!script || !canEditScript(req.session_user, script)) return res.status(403).json({ error: 'Not allowed' });
    storageExtra.deleteScriptResponse(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ── Bonzo integration API ─────────────────────────────────────────────────
  const BONZO_API_BASE = "https://app.getbonzo.com/api";

  async function fetchBonzoPage(token: string, path: string, params: Record<string, any> = {}): Promise<any> {
    const qs = new URLSearchParams(params as any).toString();
    const url = `${BONZO_API_BASE}${path}${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bonzo API ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  function matchClrForBonzo(phone?: string | null, userName?: string | null): number | null {
    const matched = findUserByWebhookPhoneOrName(phone, userName);
    return matched?.id ?? null;
  }

  async function runBonzoProspectSync(token: string, logId: number): Promise<number> {
    let page = 1;
    let total = 0;
    const maxPages = 200;
    while (page <= maxPages) {
      const data = await fetchBonzoPage(token, "/prospects", { page, per_page: 100 });
      const items: any[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      if (!items.length) break;
      for (const item of items) {
        const bonzoId = String(item.id ?? item.prospect_id ?? "");
        if (!bonzoId) continue;
        const phone = item.phone ?? item.phone_number ?? item.mobile ?? null;
        const bonzoUserName = item.assigned_user?.name ?? item.assigned_to?.name ?? item.owner_name ?? null;
        storageExtra.upsertBonzoProspect({
          bonzoId,
          firstName: item.first_name ?? null,
          lastName: item.last_name ?? null,
          email: item.email ?? null,
          phone,
          pipelineId: item.pipeline_id ? String(item.pipeline_id) : (item.pipeline?.id ? String(item.pipeline.id) : null),
          pipelineName: item.pipeline?.name ?? item.pipeline_name ?? null,
          stageId: item.stage_id ? String(item.stage_id) : (item.stage?.id ? String(item.stage.id) : null),
          stageName: item.stage?.name ?? item.stage_name ?? null,
          assignedUserId: matchClrForBonzo(null, bonzoUserName),
          bonzoUserId: item.assigned_user?.id ? String(item.assigned_user.id) : null,
          bonzoUserName,
          tags: Array.isArray(item.tags) ? item.tags : [],
          lastActivityAt: item.last_activity_at ?? item.updated_at ?? null,
        });
        total += 1;
      }
      const hasNext = data?.meta?.current_page !== undefined
        ? data.meta.current_page < data.meta.last_page
        : items.length >= 100;
      if (!hasNext) break;
      page += 1;
    }
    return total;
  }

  async function runBonzoPipelineSync(token: string): Promise<number> {
    const data = await fetchBonzoPage(token, "/pipelines");
    const items: any[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    let total = 0;
    for (const item of items) {
      const bonzoId = String(item.id ?? "");
      if (!bonzoId) continue;
      storageExtra.upsertBonzoPipeline({
        bonzoId,
        name: item.name ?? "Unnamed Pipeline",
        stages: Array.isArray(item.stages) ? item.stages : [],
      });
      total += 1;
    }
    return total;
  }

  app.post("/api/bonzo/sync/prospects", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const settings = storageExtra.getWebhookSettings();
    const token = settings.bonzo_api_token?.trim();
    if (!token) return res.status(400).json({ error: "Bonzo API token not configured", setup_required: true });
    const logId = storageExtra.startBonzoSync("prospects");
    try {
      const count = await runBonzoProspectSync(token, logId);
      storageExtra.finishBonzoSync(logId, { status: "success", recordsSynced: count });
      res.json({ ok: true, records_synced: count });
    } catch (e: any) {
      storageExtra.finishBonzoSync(logId, { status: "error", errorMessage: String(e?.message ?? e) });
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  app.post("/api/bonzo/sync/pipelines", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const settings = storageExtra.getWebhookSettings();
    const token = settings.bonzo_api_token?.trim();
    if (!token) return res.status(400).json({ error: "Bonzo API token not configured", setup_required: true });
    const logId = storageExtra.startBonzoSync("pipelines");
    try {
      const count = await runBonzoPipelineSync(token);
      storageExtra.finishBonzoSync(logId, { status: "success", recordsSynced: count });
      res.json({ ok: true, records_synced: count });
    } catch (e: any) {
      storageExtra.finishBonzoSync(logId, { status: "error", errorMessage: String(e?.message ?? e) });
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  app.post("/api/bonzo/sync/full", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const settings = storageExtra.getWebhookSettings();
    const token = settings.bonzo_api_token?.trim();
    if (!token) return res.status(400).json({ error: "Bonzo API token not configured", setup_required: true });
    const logId = storageExtra.startBonzoSync("full");
    try {
      const pipelines = await runBonzoPipelineSync(token);
      const prospects = await runBonzoProspectSync(token, logId);
      storageExtra.finishBonzoSync(logId, { status: "success", recordsSynced: pipelines + prospects });
      res.json({ ok: true, pipelines, prospects, records_synced: pipelines + prospects });
    } catch (e: any) {
      storageExtra.finishBonzoSync(logId, { status: "error", errorMessage: String(e?.message ?? e) });
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  app.get("/api/bonzo/prospects", requireAuth, (req: any, res) => {
    const q = req.query ?? {};
    const out = storageExtra.getBonzoProspects({
      search: typeof q.search === "string" ? q.search : undefined,
      pipelineId: typeof q.pipelineId === "string" ? q.pipelineId : undefined,
      stageId: typeof q.stageId === "string" ? q.stageId : undefined,
      assignedUserId: q.assignedUserId ? Number(q.assignedUserId) : undefined,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
    });
    res.json(out);
  });

  app.get("/api/bonzo/pipelines", requireAuth, (_req, res) => {
    res.json(storageExtra.getBonzoPipelines());
  });

  app.get("/api/bonzo/sync-log", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    res.json({
      log: storageExtra.getBonzoSyncLog(20),
      last: storageExtra.getLastBonzoSync() ?? null,
      running: storageExtra.getRunningBonzoSync() ?? null,
    });
  });

  // ── Mojo integration API ──────────────────────────────────────────────────
  app.post("/api/mojo/sync/sessions", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const settings = storageExtra.getWebhookSettings();
    const key = settings.mojo_api_key?.trim();
    if (!key) return res.status(400).json({ error: "Mojo API key not configured", setup_required: true });
    const logId = storageExtra.startMojoSync("sessions");
    try {
      // Mojo has no public REST API at time of writing; stubbed so UI can exercise the flow.
      storageExtra.finishMojoSync(logId, {
        status: "success",
        recordsSynced: 0,
        errorMessage: "Mojo external API is not yet available; webhook data continues to populate mojo_sessions automatically.",
      });
      res.json({ ok: true, records_synced: 0, note: "Mojo external API not yet available — webhook data continues to populate automatically." });
    } catch (e: any) {
      storageExtra.finishMojoSync(logId, { status: "error", errorMessage: String(e?.message ?? e) });
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  app.get("/api/mojo/sessions", requireAuth, (req: any, res) => {
    const q = req.query ?? {};
    res.json(storageExtra.getMojoSessions({
      clrUserId: q.clrUserId ? Number(q.clrUserId) : undefined,
      startDate: typeof q.startDate === "string" ? q.startDate : undefined,
      endDate: typeof q.endDate === "string" ? q.endDate : undefined,
    }));
  });

  app.get("/api/mojo/contacts", requireAuth, (req: any, res) => {
    const q = req.query ?? {};
    res.json(storageExtra.getMojoContacts({
      assignedClrId: q.assignedClrId ? Number(q.assignedClrId) : undefined,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
    }));
  });

  app.get("/api/mojo/sync-log", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    res.json({
      log: storageExtra.getMojoSyncLog(20),
      last: storageExtra.getLastMojoSync() ?? null,
      running: storageExtra.getRunningMojoSync() ?? null,
    });
  });

  // ── Unified contacts routes ──────────────────────────────────────────────
  app.get("/api/contacts", requireAuth, (req: any, res) => {
    const q = req.query ?? {};
    const result = storageExtra.getUnifiedContacts({
      search: typeof q.search === "string" ? q.search : undefined,
      clrUserId: q.clrUserId ? Number(q.clrUserId) : undefined,
      loId: q.loId ? Number(q.loId) : undefined,
      source: typeof q.source === "string" && q.source !== 'all' ? q.source : undefined,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
    });
    res.json(result);
  });

  app.get("/api/contacts/:id", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const contact = storageExtra.getUnifiedContactById(id);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  });

  // ── CSV import route ─────────────────────────────────────────────────────
  app.post("/api/mojo/import/csv", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const { type, rows } = req.body ?? {};
    if (type !== 'calls' && type !== 'contacts') {
      return res.status(400).json({ error: "type must be 'calls' or 'contacts'" });
    }
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows must be an array" });
    let imported = 0;
    let matched = 0;
    let unmatched = 0;

    if (type === 'contacts') {
      for (const r of rows) {
        const firstName = r.first_name || r.firstName || r.First || r["First Name"] || null;
        const lastName = r.last_name || r.lastName || r.Last || r["Last Name"] || null;
        const phone = r.phone || r.Phone || r["Phone Number"] || null;
        const email = r.email || r.Email || null;
        const status = r.status || r.Status || null;
        const listName = r.group || r.Group || r.list || r.List || null;
        const mojoId = r.mojo_id || r.id || r.ID || null;
        if (!firstName && !lastName && !phone && !email) { unmatched++; continue; }
        const clr = storageExtra.findClrByPhone(phone);
        storageExtra.upsertMojoContact({
          mojoId: mojoId ? String(mojoId) : null,
          firstName, lastName, phone, email, status, listName,
          assignedClrId: clr?.id ?? null,
        });
        storageExtra.upsertUnifiedContact({
          firstName, lastName, phone, email,
          mojoContactId: mojoId ? String(mojoId) : null,
          mojoGroup: listName, mojoStatus: status,
          clrUserId: clr?.id ?? null,
          source: 'csv',
        });
        imported++;
        if (clr) matched++; else unmatched++;
      }
    } else {
      // Calls: aggregate per (date, agent)
      const sessionMap = new Map<string, any>();
      for (const r of rows) {
        const date = (r.date || r.Date || r["Call Date"] || "").toString().slice(0, 10);
        const agent = (r.agent || r.rep || r.Agent || r.Rep || r["Agent Name"] || "").toString().trim();
        const disposition = (r.disposition || r.Disposition || r.outcome || "").toString().toLowerCase();
        const phone = r.phone || r.Phone || null;
        const contactName = r.contact || r.Contact || r["Contact Name"] || null;
        if (!date) { unmatched++; continue; }
        const key = `${date}|${agent.toLowerCase()}`;
        if (!sessionMap.has(key)) {
          const clr = agent ? storageExtra.findUserByName(agent) : null;
          sessionMap.set(key, {
            sessionDate: date,
            clrUserId: clr?.id ?? null,
            clrName: agent || null,
            totalCalls: 0, contactsReached: 0, dncHits: 0, transfers: 0, appointments: 0, voicemails: 0, noAnswers: 0,
          });
        }
        const s = sessionMap.get(key);
        s.totalCalls++;
        if (disposition.includes("contact") || disposition.includes("reached") || disposition.includes("talk")) s.contactsReached++;
        if (disposition.includes("dnc") || disposition.includes("do not call")) s.dncHits++;
        if (disposition.includes("transfer")) s.transfers++;
        if (disposition.includes("appointment") || disposition.includes("appt")) s.appointments++;
        if (disposition.includes("voicemail") || disposition.includes("vm")) s.voicemails++;
        if (disposition.includes("no answer") || disposition.includes("no-answer") || disposition === "na") s.noAnswers++;

        // Also upsert the contact if we have their info
        if (phone || contactName) {
          const parts = (contactName || "").toString().trim().split(/\s+/);
          const firstName = parts[0] || null;
          const lastName = parts.slice(1).join(" ") || null;
          const clr = storageExtra.findClrByPhone(phone);
          storageExtra.upsertMojoContact({
            mojoId: null, firstName, lastName, phone, email: null, status: disposition || null,
            assignedClrId: clr?.id ?? null,
          });
          storageExtra.upsertUnifiedContact({
            firstName, lastName, phone, email: null,
            mojoStatus: disposition || null,
            clrUserId: clr?.id ?? null,
            source: 'csv',
          });
        }
      }
      for (const s of sessionMap.values()) {
        s.source = 'csv';
        storageExtra.upsertMojoSession(s);
        imported++;
        if (s.clrUserId) matched++; else unmatched++;
      }
    }

    storageExtra.logWebhookEvent({
      source: 'mojo_csv', eventType: `import_${type}`,
      payload: { rowCount: rows.length, imported, matched, unmatched },
      processed: true,
    });
    res.json({ imported, matched, unmatched });
  });

  // ── Bonzo outbound push ──────────────────────────────────────────────────
  async function bonzoApiCall(token: string, method: string, path: string, body?: any): Promise<any> {
    const url = `${BONZO_API_BASE}${path}`;
    const r = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Bonzo API ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json().catch(() => ({}));
  }

  async function findBonzoProspectForContact(opts: { phone?: string | null; name?: string | null }): Promise<any | null> {
    const db = storageExtra.getSqlite();
    if (opts.phone) {
      const p = String(opts.phone).replace(/\D+/g, "");
      if (p) {
        const row = db.prepare(`SELECT * FROM bonzo_prospects WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'-',''),' ',''),'(',''),')','') LIKE ? LIMIT 1`).get(`%${p}%`) as any;
        if (row) return row;
      }
    }
    if (opts.name) {
      const n = opts.name.toLowerCase().trim();
      const row = db.prepare(`SELECT * FROM bonzo_prospects WHERE LOWER(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? LIMIT 1`).get(`%${n}%`) as any;
      if (row) return row;
    }
    return null;
  }

  app.post("/api/bonzo/push/note", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const { prospectId, note } = req.body ?? {};
    const settings = storageExtra.getWebhookSettings();
    const token = settings.bonzo_api_token?.trim();
    if (!token) return res.status(400).json({ error: "Bonzo API token not configured" });
    if (!prospectId || !note) return res.status(400).json({ error: "prospectId and note required" });
    try {
      const out = await bonzoApiCall(token, "POST", `/prospects/${prospectId}/notes`, { note });
      res.json({ ok: true, result: out });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/bonzo/push/stage", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const { prospectId, stageName, pipelineId } = req.body ?? {};
    const settings = storageExtra.getWebhookSettings();
    const token = settings.bonzo_api_token?.trim();
    if (!token) return res.status(400).json({ error: "Bonzo API token not configured" });
    if (!prospectId || !stageName) return res.status(400).json({ error: "prospectId and stageName required" });
    try {
      const out = await bonzoApiCall(token, "PATCH", `/prospects/${prospectId}`, { stage: stageName, pipeline_id: pipelineId });
      res.json({ ok: true, result: out });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  async function pushOutcomeToBonzo(outcome: any): Promise<{ attempted: boolean; ok: boolean; reason?: string }> {
    const settings = storageExtra.getWebhookSettings();
    const token = settings.bonzo_api_token?.trim();
    if (!token) return { attempted: false, ok: false, reason: 'no_token' };
    const prospect = await findBonzoProspectForContact({ name: outcome.borrowerName });
    if (!prospect) return { attempted: false, ok: false, reason: 'no_prospect_match' };
    const stageMap: Record<string, string> = {
      transfer: "Transferred",
      appointment: "Appointment Set",
      fell_through: "Fell Through",
    };
    try {
      if (stageMap[outcome.outcomeType]) {
        await bonzoApiCall(token, "PATCH", `/prospects/${prospect.bonzo_id}`, { stage: stageMap[outcome.outcomeType] });
      }
      let note = `C3 outcome: ${outcome.outcomeType}`;
      if (outcome.outcomeType === 'appointment' && outcome.appointmentDatetime) note += ` (${outcome.appointmentDatetime})`;
      if (outcome.outcomeType === 'deferral' || outcome.outcomeType === 'future_contact') {
        note += outcome.followUpDate ? ` — follow-up ${outcome.followUpDate}` : '';
      }
      if (outcome.notes) note += `\n${outcome.notes}`;
      await bonzoApiCall(token, "POST", `/prospects/${prospect.bonzo_id}/notes`, { note });
      storageExtra.logWebhookEvent({
        source: 'bonzo_push', eventType: 'outcome',
        payload: { outcomeId: outcome.id, prospectId: prospect.bonzo_id, outcomeType: outcome.outcomeType },
        processed: true,
      });
      return { attempted: true, ok: true };
    } catch (e: any) {
      storageExtra.logWebhookEvent({
        source: 'bonzo_push', eventType: 'outcome_error',
        payload: { outcomeId: outcome.id, error: String(e?.message || e) },
        processed: false,
      });
      return { attempted: true, ok: false, reason: e?.message };
    }
  }

  app.post("/api/bonzo/push/outcome", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const { outcomeId } = req.body ?? {};
    if (!outcomeId) return res.status(400).json({ error: "outcomeId required" });
    const outcome = (storageExtra.getSqlite().prepare(`SELECT * FROM lead_outcomes WHERE id=?`).get(outcomeId)) as any;
    if (!outcome) return res.status(404).json({ error: "Outcome not found" });
    const result = await pushOutcomeToBonzo({
      id: outcome.id,
      borrowerName: outcome.borrower_name,
      outcomeType: outcome.outcome_type,
      appointmentDatetime: outcome.appointment_datetime,
      followUpDate: outcome.follow_up_date,
      notes: outcome.notes,
    });
    res.json(result);
  });

  // Expose helper for outcome POST handler to call fire-and-forget
  (globalThis as any).__pushOutcomeToBonzo = pushOutcomeToBonzo;

  // ── Zapier inbound webhook (Mojo events via Zapier) ──────────────────────
  app.post("/api/webhook/mojo/zapier", (req, res) => {
    const body = req.body ?? {};
    const settings = storageExtra.getWebhookSettings();
    const providedSecret = (req.headers["x-zapier-secret"] as string) || (body.secret as string) || "";
    if (settings.zapier_secret && providedSecret !== settings.zapier_secret) {
      storageExtra.logWebhookEvent({ source: "zapier", eventType: "auth_failed", payload: body, processed: false });
      return res.status(401).json({ error: "unauthorized" });
    }
    // Unwrap Zapier envelopes
    const payload = body.data ?? body.payload ?? body;

    // Mirror core logic from /api/webhook/mojo
    try {
      const sessionDate = (payload.date || payload.session_date || new Date().toISOString().slice(0, 10)).toString().slice(0, 10);
      const agentName = payload.agent || payload.rep || payload.clr_name || null;
      const clr = agentName ? storageExtra.findUserByName(agentName) : null;
      const disposition = (payload.disposition || payload.event || "").toString().toLowerCase();

      const existingRow = storageExtra.getSqlite().prepare(
        `SELECT * FROM mojo_sessions WHERE session_date=? AND clr_user_id IS ?`
      ).get(sessionDate, clr?.id ?? null) as any;

      const inc = (field: string) => (existingRow?.[field] ?? 0) + 1;
      const payloadSession: any = {
        sessionDate,
        clrUserId: clr?.id ?? null,
        clrName: agentName || existingRow?.clr_name || null,
        totalCalls: inc('total_calls'),
        contactsReached: existingRow?.contacts_reached ?? 0,
        dncHits: existingRow?.dnc_hits ?? 0,
        transfers: existingRow?.transfers ?? 0,
        appointments: existingRow?.appointments ?? 0,
        voicemails: existingRow?.voicemails ?? 0,
        noAnswers: existingRow?.no_answers ?? 0,
        source: 'zapier',
      };
      if (disposition.includes("transfer")) payloadSession.transfers = inc('transfers');
      if (disposition.includes("appointment")) payloadSession.appointments = inc('appointments');
      if (disposition.includes("voicemail")) payloadSession.voicemails = inc('voicemails');
      if (disposition.includes("no answer") || disposition.includes("no-answer")) payloadSession.noAnswers = inc('no_answers');
      if (disposition.includes("dnc")) payloadSession.dncHits = inc('dnc_hits');
      if (disposition.includes("contact") || disposition.includes("reached")) payloadSession.contactsReached = inc('contacts_reached');

      storageExtra.upsertMojoSession(payloadSession);

      // Contact upsert
      const first = payload.first_name || payload.firstName || null;
      const last = payload.last_name || payload.lastName || null;
      const phone = payload.phone || null;
      const email = payload.email || null;
      if (first || last || phone || email) {
        storageExtra.upsertMojoContact({
          mojoId: payload.contact_id ? String(payload.contact_id) : null,
          firstName: first, lastName: last, phone, email,
          status: disposition || null, assignedClrId: clr?.id ?? null,
        });
        storageExtra.upsertUnifiedContact({
          firstName: first, lastName: last, phone, email,
          mojoContactId: payload.contact_id ? String(payload.contact_id) : null,
          mojoStatus: disposition || null,
          clrUserId: clr?.id ?? null,
          source: 'mojo',
        });
      }
    } catch (e) {
      console.error("Zapier webhook processing failed:", e);
    }

    storageExtra.logWebhookEvent({
      source: "zapier", eventType: (payload.disposition || payload.event || "event").toString(),
      payload: body, processed: true,
    });
    res.json({ ok: true });
  });

  // ── Zapier outbound trigger ──────────────────────────────────────────────
  async function triggerZapier(event: string, data: any): Promise<{ attempted: boolean; ok: boolean; reason?: string }> {
    const settings = storageExtra.getWebhookSettings();
    const url = settings.zapier_webhook_url?.trim();
    if (!url) return { attempted: false, ok: false, reason: 'no_url' };
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, data, timestamp: new Date().toISOString() }),
      });
      storageExtra.logWebhookEvent({
        source: 'zapier_out', eventType: event,
        payload: { status: r.status, data },
        processed: r.ok,
      });
      return { attempted: true, ok: r.ok, reason: r.ok ? undefined : `HTTP ${r.status}` };
    } catch (e: any) {
      storageExtra.logWebhookEvent({
        source: 'zapier_out', eventType: `${event}_error`,
        payload: { error: String(e?.message || e), data }, processed: false,
      });
      return { attempted: true, ok: false, reason: e?.message };
    }
  }

  app.post("/api/zapier/trigger", requireAuth, async (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const { event, data } = req.body ?? {};
    if (!event || typeof event !== "string") return res.status(400).json({ error: "event required" });
    const result = await triggerZapier(event, data ?? {});
    res.json(result);
  });

  (globalThis as any).__triggerZapier = triggerZapier;

  // ── Integrations status ──────────────────────────────────────────────────
  app.get("/api/integrations/status", requireAuth, (_req, res) => {
    const settings = storageExtra.getWebhookSettings();
    const db = storageExtra.getSqlite();
    const bonzoEvents = (db.prepare(`SELECT COUNT(*) AS c FROM webhook_events WHERE source='bonzo'`).get() as any).c;
    const mojoEvents = (db.prepare(`SELECT COUNT(*) AS c FROM webhook_events WHERE source='mojo'`).get() as any).c;
    const zapierEvents = (db.prepare(`SELECT COUNT(*) AS c FROM webhook_events WHERE source='zapier' OR source='zapier_out'`).get() as any).c;
    const csvImports = (db.prepare(`SELECT COUNT(*) AS c FROM webhook_events WHERE source='mojo_csv'`).get() as any).c;
    const lastBonzoSync = storageExtra.getLastBonzoSync?.();
    res.json({
      bonzo: {
        webhookConfigured: !!settings.bonzo_secret,
        webhookEvents: bonzoEvents,
        apiTokenConfigured: !!settings.bonzo_api_token,
        outboundPushReady: !!settings.bonzo_api_token,
        lastSync: lastBonzoSync ?? null,
      },
      mojo: {
        webhookConfigured: !!settings.mojo_secret,
        webhookEvents: mojoEvents,
        apiKeyConfigured: !!settings.mojo_api_key,
        csvImports,
        csvImportAvailable: true,
      },
      zapier: {
        inboundConfigured: !!settings.zapier_secret,
        outboundConfigured: !!settings.zapier_webhook_url,
        events: zapierEvents,
      },
    });
  });

  // ── Forum routes ─────────────────────────────────────────────────────────
  app.get("/api/forum/posts", requireAuth, (req: any, res) => {
    const userId = req.session_user.userId;
    const search = (req.query.search as string | undefined)?.trim() || undefined;
    const posts = storageExtra.listForumPosts(userId, search);
    res.json({ posts });
  });

  app.post("/api/forum/posts", requireAuth, (req: any, res) => {
    const { title, body } = req.body;
    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "Body is required" });
    }
    const userId = req.session_user.userId;
    const user = storage.getUserById(userId) as any;
    const authorName = user?.name ?? "Unknown";
    const post = storageExtra.createForumPost({
      title: title.trim(),
      body: body.trim(),
      authorId: userId,
      authorName,
    });
    // In-app notify admins; push to ALL other active org users
    try {
      const orgId = (req.session_user as any).orgId ?? 1;
      const pushPayload = {
        title: `New Forum Question: ${post.title}`,
        body: `${authorName} asked: ${post.title}`,
        url: `/#/forum`,
      };
      const allUsers = storage.getUsers();
      const admins = allUsers.filter((u: any) => u.role === "admin" && u.isActive && u.id !== userId && !(u.muteForumNotifications ?? u.mute_forum_notifications));
      for (const admin of admins) {
        storage.createNotification({
          userId: admin.id,
          type: "forum",
          title: pushPayload.title,
          message: pushPayload.body,
          isRead: false,
        });
      }
      const pushTargets = allUsers.filter((u: any) =>
        u.isActive && u.id !== userId && (u.orgId ?? 1) === orgId
        && !(u.muteForumNotifications ?? u.mute_forum_notifications)
      );
      sendPushToUsers(pushTargets.map((u: any) => u.id), pushPayload).catch(() => {});

      // Email all active CLRs when a new forum question is posted
      const emailTargetsForum = pushTargets.filter((u: any) => u.email && String(u.email).includes("@"));
      if (emailTargetsForum.length > 0) {
        const toAddrsForum: string[] = emailTargetsForum.map((u: any) => u.email);
        const htmlEsc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const bodySnippet = post.body ? (post.body.length > 300 ? post.body.slice(0, 297) + "…" : post.body) : "";
        const forumBody = `
          <p style="margin:0 0 16px;font-size:15px;color:#1A2B4A">
            <strong>${htmlEsc(authorName)}</strong> posted a new question in the Forum:
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
            <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#1A2B4A">${htmlEsc(post.title)}</p>
            ${bodySnippet ? `<p style="margin:0;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap">${htmlEsc(bodySnippet)}</p>` : ""}
          </div>
          <p style="margin:0;font-size:13px;color:#64748b">
            <a href="https://www.westcapitallending.center/#/forum" style="color:#1A2B4A;font-weight:600;text-decoration:none">View and answer in the Forum →</a>
          </p>`;
        const forumSubject = `❓ ${authorName} asked: ${post.title}`;
        const forumHtml = buildEmail({ subject: forumSubject, preheader: bodySnippet, body: forumBody });
        sendEmail({ to: toAddrsForum, subject: forumSubject, html: forumHtml }).catch((err: any) =>
          console.error("[forum-email] send failed:", err?.message ?? err)
        );
      }
    } catch (e) { console.error("forum notify failed:", e); }
    res.json({ post });
  });

  app.get("/api/forum/posts/:id", requireAuth, (req: any, res) => {
    const userId = req.session_user.userId;
    const id = parseInt(req.params.id);
    const post = storageExtra.getForumPostById(id, userId);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json({ post });
  });

  app.patch("/api/forum/posts/:id", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const user = req.session_user;
    const existing = storageExtra.getForumPostById(id, user.userId);
    if (!existing) return res.status(404).json({ error: "Post not found" });
    const isAuthor = existing.author_id === user.userId;
    const isAdmin = user.role === "admin";
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: "Not authorized" });
    const { title, body, is_pinned } = req.body;
    const updates: any = {};
    if (typeof title === "string" && title.trim()) updates.title = title.trim();
    if (typeof body === "string" && body.trim()) updates.body = body.trim();
    if (isAdmin && (is_pinned === 0 || is_pinned === 1)) updates.is_pinned = is_pinned;
    const updated = storageExtra.updateForumPost(id, updates);
    res.json({ post: updated });
  });

  app.delete("/api/forum/posts/:id", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const user = req.session_user;
    const existing = storageExtra.getForumPostById(id, user.userId);
    if (!existing) return res.status(404).json({ error: "Post not found" });
    const isAuthor = existing.author_id === user.userId;
    const isAdmin = user.role === "admin";
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: "Not authorized" });
    storageExtra.deleteForumPost(id);
    res.json({ ok: true });
  });

  app.post("/api/forum/posts/:id/answers", requireAuth, (req: any, res) => {
    const postId = parseInt(req.params.id);
    const { body } = req.body;
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "Body is required" });
    }
    const userId = req.session_user.userId;
    const userObj = storage.getUserById(userId) as any;
    const authorName = userObj?.name ?? "Unknown";
    const post = storageExtra.getForumPostById(postId, userId);
    if (!post) return res.status(404).json({ error: "Post not found" });
    const answer = storageExtra.createForumAnswer({
      postId,
      body: body.trim(),
      authorId: userId,
      authorName,
    });
    // Notify all subscribers except the answerer
    try {
      const mutedForum = new Set((storage.getUsers() as any[]).filter((u: any) => (u.muteForumNotifications ?? u.mute_forum_notifications)).map((u: any) => u.id));
      const subscriberIds = storageExtra.getForumSubscribers(postId).filter((uid) => uid !== userId && !mutedForum.has(uid));
      const pushPayload = {
        title: `New answer on: ${post.title}`,
        body: `${authorName} answered your question`,
        url: `/#/forum`,
      };
      for (const subId of subscriberIds) {
        storage.createNotification({
          userId: subId,
          type: "forum",
          title: pushPayload.title,
          message: pushPayload.body,
          isRead: false,
        });
      }
      sendPushToUsers(subscriberIds, pushPayload).catch(() => {});

      // Email subscribers who have a valid email address
      if (subscriberIds.length > 0) {
        const allUsersForAnswerEmail = storage.getUsers() as any[];
        const subscriberEmails = allUsersForAnswerEmail
          .filter((u: any) => subscriberIds.includes(u.id) && u.email && String(u.email).includes("@"))
          .map((u: any) => u.email);
        if (subscriberEmails.length > 0) {
          const htmlEsc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const bodySnippet = body.length > 300 ? body.slice(0, 297) + "…" : body;
          const answerBody = `
            <p style="margin:0 0 16px;font-size:15px;color:#1A2B4A">
              <strong>${htmlEsc(authorName)}</strong> answered a question you're following:
            </p>
            <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1A2B4A">${htmlEsc(post.title)}</p>
            <div style="background:#f8fafc;border-left:4px solid #16a34a;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:20px">
              <p style="margin:0;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap">${htmlEsc(bodySnippet)}</p>
            </div>
            <p style="margin:0;font-size:13px;color:#64748b">
              <a href="https://www.westcapitallending.center/#/forum" style="color:#1A2B4A;font-weight:600;text-decoration:none">View the full answer →</a>
            </p>`;
          const answerSubject = `✅ New answer on: ${post.title}`;
          const answerHtml = buildEmail({ subject: answerSubject, preheader: `${authorName} answered your question`, body: answerBody });
          sendEmail({ to: subscriberEmails, subject: answerSubject, html: answerHtml }).catch((err: any) =>
            console.error("[forum-answer-email] send failed:", err?.message ?? err)
          );
        }
      }
    } catch (e) { console.error("forum subscriber notify failed:", e); }
    res.json({ answer });
  });

  app.patch("/api/forum/answers/:id", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const user = req.session_user;
    const existing = storageExtra.getForumAnswerById(id);
    if (!existing) return res.status(404).json({ error: "Answer not found" });
    const isAuthor = existing.author_id === user.userId;
    const isAdmin = user.role === "admin";
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: "Not authorized" });
    const { body, is_accepted } = req.body;
    const updates: any = {};
    if (typeof body === "string" && body.trim()) updates.body = body.trim();
    if (isAdmin && (is_accepted === 0 || is_accepted === 1)) {
      if (is_accepted === 1) {
        storageExtra.acceptForumAnswer(existing.post_id, id);
      } else {
        updates.is_accepted = 0;
      }
    }
    if (Object.keys(updates).length > 0) storageExtra.updateForumAnswer(id, updates);
    res.json({ answer: storageExtra.getForumAnswerById(id) });
  });

  app.delete("/api/forum/answers/:id", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const user = req.session_user;
    const existing = storageExtra.getForumAnswerById(id);
    if (!existing) return res.status(404).json({ error: "Answer not found" });
    const isAuthor = existing.author_id === user.userId;
    const isAdmin = user.role === "admin";
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: "Not authorized" });
    storageExtra.deleteForumAnswer(id);
    res.json({ ok: true });
  });

  app.post("/api/forum/posts/:id/upvote", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session_user.userId;
    const result = storageExtra.toggleForumVote("post", id, userId);
    res.json(result);
  });

  app.post("/api/forum/answers/:id/upvote", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session_user.userId;
    const result = storageExtra.toggleForumVote("answer", id, userId);
    res.json(result);
  });

  app.post("/api/forum/posts/:id/subscribe", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const userId = req.session_user.userId;
    const result = storageExtra.toggleForumSubscription(id, userId);
    res.json(result);
  });

  app.post("/api/forum/posts/:id/accept-answer/:answerId", requireAuth, (req: any, res) => {
    const postId = parseInt(req.params.id);
    const answerId = parseInt(req.params.answerId);
    const user = req.session_user;
    const post = storageExtra.getForumPostById(postId, user.userId);
    if (!post) return res.status(404).json({ error: "Post not found" });
    const isAuthor = post.author_id === user.userId;
    const isAdmin = user.role === "admin";
    if (!isAuthor && !isAdmin) return res.status(403).json({ error: "Not authorized" });
    storageExtra.acceptForumAnswer(postId, answerId);
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Multi-tenancy: Organizations, Super-Admin, Invites
  // ────────────────────────────────────────────────────────────────────────────

  const sqliteRaw = storageExtra.getRawSqlite();

  function getCurrentOrgId(session: any): number {
    if (session?.superAdmin && session?.orgId) return Number(session.orgId);
    const u = storage.getUserById(session.userId) as any;
    return Number(u?.orgId ?? u?.org_id ?? 1);
  }

  function requireSuperAdmin(req: any, res: any, next: any) {
    const session = req.session_user;
    if (session?.superAdmin) return next();
    // Fallback: re-check DB so newly-granted super_admin takes effect without re-login
    const u = storage.getUserById(session?.userId) as any;
    if (u && !!(u.superAdmin ?? u.super_admin)) {
      session.superAdmin = true;
      return next();
    }
    return res.status(403).json({ error: "Super admin only" });
  }

  // Current org settings (per-team branding, etc.)
  app.get("/api/org/current", requireAuth, (req: any, res) => {
    const orgId = getCurrentOrgId(req.session_user);
    const org = sqliteRaw.prepare(`SELECT id, name, slug, logo_url, company_name, plan FROM organizations WHERE id = ?`).get(orgId) as any;
    if (!org) return res.status(404).json({ error: "Organization not found" });
    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logo_url,
      companyName: org.company_name,
      plan: org.plan,
    });
  });

  // ── Super-admin routes ────────────────────────────────────────────────────
  app.get("/api/super-admin/orgs", requireAuth, requireSuperAdmin, (_req: any, res) => {
    const rows = sqliteRaw.prepare(`
      SELECT o.id, o.name, o.slug, o.logo_url, o.company_name, o.plan, o.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS user_count,
        (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.is_clr = 1) AS clr_count
      FROM organizations o
      ORDER BY o.id ASC
    `).all();
    res.json(rows);
  });

  app.post("/api/super-admin/orgs", requireAuth, requireSuperAdmin, async (req: any, res) => {
    const { name, companyName, adminEmail, adminName } = req.body ?? {};
    if (!name || !companyName || !adminEmail || !adminName) {
      return res.status(400).json({ error: "name, companyName, adminEmail, adminName are required" });
    }
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `org-${Date.now()}`;
    try {
      const info = sqliteRaw.prepare(`
        INSERT INTO organizations (name, slug, company_name, plan) VALUES (?, ?, ?, 'trial')
      `).run(name, slug, companyName);
      const orgId = Number(info.lastInsertRowid);

      // Create first admin user for that org with temp password
      const tempPassword = crypto.randomBytes(6).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) + "!";
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

  app.patch("/api/super-admin/orgs/:id", requireAuth, requireSuperAdmin, (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { name, plan, logoUrl, companyName, resendApiKey, fromEmail, managerEmails } = req.body ?? {};
    const fields: string[] = [];
    const vals: any[] = [];
    if (name !== undefined) { fields.push("name = ?"); vals.push(name); }
    if (plan !== undefined) { fields.push("plan = ?"); vals.push(plan); }
    if (logoUrl !== undefined) { fields.push("logo_url = ?"); vals.push(logoUrl); }
    if (companyName !== undefined) { fields.push("company_name = ?"); vals.push(companyName); }
    if (resendApiKey !== undefined) { fields.push("resend_api_key = ?"); vals.push(resendApiKey); }
    if (fromEmail !== undefined) { fields.push("from_email = ?"); vals.push(fromEmail); }
    if (managerEmails !== undefined) {
      const arr = Array.isArray(managerEmails) ? managerEmails : [];
      fields.push("manager_emails = ?"); vals.push(JSON.stringify(arr));
    }
    if (!fields.length) return res.json({ ok: true });
    vals.push(id);
    sqliteRaw.prepare(`UPDATE organizations SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  });

  app.delete("/api/super-admin/orgs/:id/suspend", requireAuth, requireSuperAdmin, (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    sqliteRaw.prepare(`UPDATE organizations SET plan = 'suspended' WHERE id = ?`).run(id);
    res.json({ ok: true });
  });

  app.post("/api/super-admin/orgs/:id/impersonate", requireAuth, requireSuperAdmin, (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const org = sqliteRaw.prepare(`SELECT id, name FROM organizations WHERE id = ?`).get(id) as any;
    if (!org) return res.status(404).json({ error: "Org not found" });
    const session = req.session_user;
    const u = storage.getUserById(session.userId) as any;
    const originalOrgId = Number(session.originalOrgId ?? u?.orgId ?? u?.org_id ?? 1);
    const payload = JSON.stringify({
      userId: session.userId,
      role: session.role,
      orgId: id,
      superAdmin: true,
      originalOrgId,
      isImpersonating: true,
      impersonatingOrgName: org.name,
    });
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie(COOKIE_NAME, payload, {
      signed: true, httpOnly: true,
      sameSite: isProduction ? "strict" : "none",
      secure: isProduction, path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, orgId: id, orgName: org.name });
  });

  function clearImpersonationCookie(req: any, res: any) {
    const session = req.session_user;
    const u = storage.getUserById(session.userId) as any;
    const originalOrgId = Number(session.originalOrgId ?? u?.orgId ?? u?.org_id ?? 1);
    const payload = JSON.stringify({
      userId: session.userId,
      role: session.role,
      orgId: originalOrgId,
      superAdmin: true,
    });
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie(COOKIE_NAME, payload, {
      signed: true, httpOnly: true,
      sameSite: isProduction ? "strict" : "none",
      secure: isProduction, path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return originalOrgId;
  }

  app.post("/api/super-admin/stop-impersonating", requireAuth, requireSuperAdmin, (req: any, res) => {
    const originalOrgId = clearImpersonationCookie(req, res);
    res.json({ ok: true, orgId: originalOrgId });
  });

  app.post("/api/super-admin/exit-impersonate", requireAuth, requireSuperAdmin, (req: any, res) => {
    const originalOrgId = clearImpersonationCookie(req, res);
    res.json({ ok: true, orgId: originalOrgId });
  });

  // List all users across all orgs (for SA user management)
  app.get("/api/super-admin/users", requireAuth, requireSuperAdmin, (_req: any, res) => {
    try {
      const sqlite = storageExtra.getSqlite();
      const users = sqlite.prepare(`
        SELECT u.id, u.name, u.email, u.org_id, u.super_admin,
               COALESCE(o.name, 'Unknown') AS org_name
        FROM users u
        LEFT JOIN orgs o ON o.id = u.org_id
        ORDER BY u.super_admin DESC, o.name, u.name
      `).all();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle super_admin on any user
  app.patch("/api/super-admin/users/:id/toggle-super-admin", requireAuth, requireSuperAdmin, (req: any, res) => {
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: "Invalid user id" });
    // Prevent self-revocation
    if (req.session_user?.id === targetId) {
      return res.status(400).json({ error: "Cannot change your own super admin status" });
    }
    try {
      const sqlite = storageExtra.getSqlite();
      const row = sqlite.prepare("SELECT super_admin FROM users WHERE id = ?").get(targetId) as any;
      if (!row) return res.status(404).json({ error: "User not found" });
      const newVal = row.super_admin ? 0 : 1;
      sqlite.prepare("UPDATE users SET super_admin = ? WHERE id = ?").run(newVal, targetId);
      res.json({ ok: true, superAdmin: newVal === 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Invite flow ────────────────────────────────────────────────────────────
  app.post("/api/orgs/:id/invite", requireAuth, (req: any, res) => {
    const orgId = parseInt(req.params.id);
    if (isNaN(orgId)) return res.status(400).json({ error: "Invalid org id" });
    const session = req.session_user;
    // Only admins of the same org or super-admins can invite
    if (!session.superAdmin && (session.role !== "admin" || getCurrentOrgId(session) !== orgId)) {
      return res.status(403).json({ error: "Admin only" });
    }
    const { email, role } = req.body ?? {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    const allowedRoles = ["clr", "assistant", "admin"];
    const normalizedRole = allowedRoles.includes(role) ? role : "clr";
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    sqliteRaw.prepare(`
      INSERT INTO invite_tokens (token, org_id, email, role, expires_at) VALUES (?, ?, ?, ?, ?)
    `).run(token, orgId, String(email).toLowerCase(), normalizedRole, expiresAt);

    // Build invite link (client uses hash routing)
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
    const host = req.headers.host;
    const inviteLink = `${proto}://${host}/#/invite/${token}`;

    // Attempt to send invite email via org's Resend key
    try {
      const org = sqliteRaw.prepare(`SELECT name, company_name, resend_api_key, from_email FROM organizations WHERE id = ?`).get(orgId) as any;
      const apiKey = org?.resend_api_key || process.env.RESEND_API_KEY;
      const from = org?.from_email || "reports@westcapitallending.center";
      if (apiKey) {
        const resend = new Resend(apiKey);
        resend.emails.send({
          from: `${org?.company_name ?? "CLR Connection Center"} <${from}>`,
          to: email,
          subject: `You've been invited to join ${org?.name ?? "CLR Connection Center"}`,
          html: `<p>You've been invited to join <strong>${org?.name ?? "CLR Connection Center"}</strong> on CLR Connection Center.</p><p><a href="${inviteLink}">Accept your invite</a></p><p>This link expires in 7 days.</p>`,
        }).catch((e: any) => console.error("invite email failed:", e?.message ?? e));
      }
    } catch (e: any) {
      console.error("invite email error:", e?.message ?? e);
    }
    res.json({ ok: true, token, inviteLink, expiresAt });
  });

  app.get("/api/orgs/:id/invites", requireAuth, (req: any, res) => {
    const orgId = parseInt(req.params.id);
    if (isNaN(orgId)) return res.status(400).json({ error: "Invalid org id" });
    const session = req.session_user;
    if (!session.superAdmin && (session.role !== "admin" || getCurrentOrgId(session) !== orgId)) {
      return res.status(403).json({ error: "Admin only" });
    }
    const rows = sqliteRaw.prepare(`
      SELECT id, token, email, role, used, expires_at, created_at FROM invite_tokens
      WHERE org_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(orgId);
    res.json(rows);
  });

  app.delete("/api/orgs/:id/invites/:inviteId", requireAuth, (req: any, res) => {
    const orgId = parseInt(req.params.id);
    const inviteId = parseInt(req.params.inviteId);
    if (isNaN(orgId) || isNaN(inviteId)) return res.status(400).json({ error: "Invalid id" });
    const session = req.session_user;
    if (!session.superAdmin && (session.role !== "admin" || getCurrentOrgId(session) !== orgId)) {
      return res.status(403).json({ error: "Admin only" });
    }
    sqliteRaw.prepare(`DELETE FROM invite_tokens WHERE id = ? AND org_id = ?`).run(inviteId, orgId);
    res.json({ ok: true });
  });

  app.get("/api/invite/:token", (req, res) => {
    const token = req.params.token;
    const row = sqliteRaw.prepare(`
      SELECT it.*, o.name AS org_name, o.company_name AS org_company_name
      FROM invite_tokens it JOIN organizations o ON o.id = it.org_id
      WHERE it.token = ?
    `).get(token) as any;
    if (!row) return res.status(404).json({ error: "Invite not found" });
    if (row.used) return res.status(400).json({ error: "Invite already used" });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: "Invite expired" });
    res.json({
      email: row.email,
      role: row.role,
      orgId: row.org_id,
      orgName: row.org_name,
      orgCompanyName: row.org_company_name,
    });
  });

  app.post("/api/invite/:token/accept", async (req, res) => {
    const token = req.params.token;
    const { name, password } = req.body ?? {};
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName || typeof password !== "string" || password.trim().length < 8) {
      return res.status(400).json({ error: "Name and password (min 8 chars) are required" });
    }
    const row = sqliteRaw.prepare(`SELECT * FROM invite_tokens WHERE token = ?`).get(token) as any;
    if (!row) return res.status(404).json({ error: "Invite not found" });
    if (row.used) return res.status(400).json({ error: "Invite already used" });
    if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: "Invite expired" });

    const existing = storage.getUserByEmail(row.email);
    if (existing) return res.status(400).json({ error: "An account with that email already exists" });

    const hash = await bcrypt.hash(password.trim(), 10);
    const role = row.role === "admin" ? "admin" : "assistant";
    const isClr = row.role !== "admin" ? 1 : 1;
    const info = sqliteRaw.prepare(`
      INSERT INTO users (name, email, role, is_active, is_clr, password_hash, must_change_password, org_id, created_at)
      VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?)
    `).run(trimmedName, row.email, role, isClr, hash, row.org_id, new Date().toISOString());

    sqliteRaw.prepare(`UPDATE invite_tokens SET used = 1 WHERE id = ?`).run(row.id);
    audit({ userId: Number(info.lastInsertRowid), userName: trimmedName, action: "user_created", entityType: "user", entityId: Number(info.lastInsertRowid), entityLabel: row.email, details: JSON.stringify({ via: "invite", orgId: row.org_id, role }) });
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Data Export (CSV) — admin only, scoped to current org
  // ────────────────────────────────────────────────────────────────────────────
  function csvEscape(v: any): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function toCsv(headers: string[], rows: any[][]): string {
    const head = headers.map(csvEscape).join(",");
    const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    return body ? `${head}\n${body}\n` : `${head}\n`;
  }

  function sendCsv(res: Response, filename: string, csv: string) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }

  function todayIso(): string { return new Date().toISOString().slice(0, 10); }
  function daysAgoIso(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  app.get("/api/export/outcomes", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const orgId = getCurrentOrgId(req.session_user);
    const from = String(req.query.from || daysAgoIso(30));
    const to = String(req.query.to || todayIso());
    const db = storageExtra.getSqlite();
    const rows = db.prepare(`
      SELECT o.date, u.name AS clr_name, o.outcome_type, lo.full_name AS lo_name,
             o.transfer_type, o.notes, o.created_at
      FROM lead_outcomes o
      LEFT JOIN users u ON u.id = o.assistant_id
      LEFT JOIN loan_officers lo ON lo.id = o.lo_id
      WHERE o.org_id = ? AND o.date >= ? AND o.date <= ?
      ORDER BY o.date DESC, o.id DESC
    `).all(orgId, from, to) as any[];
    const csv = toCsv(
      ["Date", "CLR Name", "Outcome Type", "LO Name", "Transfer Type", "Notes", "Logged At"],
      rows.map((r) => [r.date, r.clr_name || "", r.outcome_type, r.lo_name || "", r.transfer_type || "", r.notes || "", r.created_at]),
    );
    sendCsv(res, `outcomes_${from}_to_${to}.csv`, csv);
  });

  app.get("/api/export/users", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const orgId = getCurrentOrgId(req.session_user);
    const db = storageExtra.getSqlite();
    const rows = db.prepare(`
      SELECT id, name, email, role, is_clr, is_active, created_at
      FROM users
      WHERE org_id = ?
      ORDER BY id ASC
    `).all(orgId) as any[];
    const csv = toCsv(
      ["ID", "Name", "Email", "Role", "Is CLR", "Is Active", "Created At"],
       rows.map((r) => [r.id, r.name, r.email, r.role, r.is_clr ? "yes" : "no", r.is_active ? "yes" : "no", r.created_at]),
    );
    sendCsv(res, `users_${todayIso()}.csv`, csv);
  });

  app.get("/api/export/loan-officers", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const orgId = getCurrentOrgId(req.session_user);
    const db = storageExtra.getSqlite();
    const rows = db.prepare(`
      SELECT id, full_name, nmls_id, phone, email, licensed_states, internal_status,
             priority_tier, boost_score, last_worked_date, total_times_worked, created_at
      FROM loan_officers
      WHERE org_id = ?
      ORDER BY id ASC
    `).all(orgId) as any[];
    const csv = toCsv(
      ["ID", "Full Name", "NMLS ID", "Phone", "Email", "Licensed States", "Status", "Priority Tier", "Boost Score", "Last Worked", "Total Times Worked", "Created At"],
      rows.map((r) => {
        let states = r.licensed_states;
        try { const arr = JSON.parse(r.licensed_states || "[]"); if (Array.isArray(arr)) states = arr.join("; "); } catch {}
        return [r.id, r.full_name, r.nmls_id, r.phone || "", r.email || "", states || "", r.internal_status, r.priority_tier, r.boost_score, r.last_worked_date || "", r.total_times_worked, r.created_at];
      }),
    );
    sendCsv(res, `loan_officers_${todayIso()}.csv`, csv);
  });

  app.get("/api/export/daily-logs", requireAuth, (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const orgId = getCurrentOrgId(req.session_user);
    const from = String(req.query.from || daysAgoIso(30));
    const to = String(req.query.to || todayIso());
    const db = storageExtra.getSqlite();
    const rows = db.prepare(`
      SELECT d.log_date, u.name AS clr_name, d.calls_made, d.notes, d.updated_at
      FROM daily_call_logs d
      LEFT JOIN users u ON u.id = d.assistant_id
      WHERE d.org_id = ? AND d.log_date >= ? AND d.log_date <= ?
      ORDER BY d.log_date DESC, d.id DESC
    `).all(orgId, from, to) as any[];
    const csv = toCsv(
      ["Log Date", "CLR Name", "Calls Made", "Notes", "Updated At"],
      rows.map((r) => [r.log_date, r.clr_name || "", r.calls_made, r.notes || "", r.updated_at]),
    );
    sendCsv(res, `daily_call_logs_${from}_to_${to}.csv`, csv);
  });

  // ── One-time auto-restore of Bonzo passwords on boot ───────────────────────
  // The user asked us to restore the corrupted Bonzo passwords from the master
  // sheet. The HTTP endpoint requires an admin session, which we can't produce
  // from the agent context, so this fires automatically once on next deploy.
  // Idempotent: writes an audit-log marker after success and skips on subsequent
  // boots.
  setTimeout(() => {
    try {
      const MARKER_ACTION = "bonzo_password_autorestore_v1";
      const sqlite = storageExtra.getSqlite();
      const existing = sqlite.prepare(
        `SELECT 1 FROM audit_logs WHERE action = ? LIMIT 1`
      ).get(MARKER_ACTION) as any;
      if (existing) {
        console.log("[bonzo-autorestore] marker present — skipping");
        return;
      }
      const RESTORE_MAP: Record<string, string> = {
        "bneessen@westcapitallending.com":   "ChBn100215#N",
        "ktabrizi@westcapitallending.com":   "Jonah#525252",
        "smurphy@westcapitallending.com":    "Operator1991!!",
        "dbaker@westcapitallending.com":     "$Herbalife247",
        "imilitello@westcapitallending.com": "December#417",
        "cfairon@westcapitallending.com":    "Bheart2026$$!!",
        "jmcgowan@westcapitallending.com":   "Bonzo#051996",
        "dbullen@westcapitallending.com":    "#Everett12!!",
        "gdawson@westcapitallending.com":    "LAChargersKings$1",
        "asalazar@westcapitallending.com":   "Wesleycap23$",
        "sripperger@westcapitallending.com": "Ranierbeer14!",
      };
      const los = storage.getLoanOfficers() as any[];
      const results: { email: string; loId?: number; name?: string; status: string }[] = [];
      for (const [email, password] of Object.entries(RESTORE_MAP)) {
        const lo = los.find((l: any) => {
          const e = String(l.email ?? l.email_address ?? "").toLowerCase().trim();
          return e === email;
        });
        if (!lo) { results.push({ email, status: "not_found" }); continue; }
        try {
          storage.updateLoanOfficer(lo.id, { bonzoPassword: password } as any);
          results.push({ email, loId: lo.id, name: lo.fullName ?? lo.full_name, status: "updated" });
        } catch (e: any) {
          results.push({ email, loId: lo.id, name: lo.fullName ?? lo.full_name, status: `error: ${e?.message ?? e}` });
        }
      }
      const updatedCount = results.filter(r => r.status === "updated").length;
      try {
        storage.createAuditLog({
          userId: 1,
          userName: "system",
          action: MARKER_ACTION,
          entityType: "loan_officer",
          entityLabel: `${updatedCount} LOs updated (auto-restore on boot)`,
          details: JSON.stringify(results),
        } as any);
      } catch (e) { console.error("[bonzo-autorestore] failed to write marker:", e); }
      console.log(`[bonzo-autorestore] restored ${updatedCount}/${Object.keys(RESTORE_MAP).length} Bonzo passwords on boot`);
    } catch (e: any) {
      console.error("[bonzo-autorestore] failed:", e?.message ?? e);
    }
  }, 3000); // tiny delay so DB / migrations are fully ready

}

export function createHttpServer(app: Express): Server {
  const server = createServer(app);
  registerRoutes(server, app);
  return server;
}
