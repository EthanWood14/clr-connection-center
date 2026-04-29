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

// Resolve a named period to date range.
// Supported: today | week | month | 30days | 90days | alltime | period
function resolveNamedPeriod(name: string): { startDate: string; endDate: string } {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  if (name === "today") {
    return { startDate: todayStr, endDate: todayStr };
  }
  if (name === "week") {
    const dow = now.getDay();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - dow);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return {
      startDate: sunday.toISOString().split("T")[0],
      endDate: saturday.toISOString().split("T")[0],
    };
  }
  if (name === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    };
  }
  if (name === "30days") {
    const start = new Date(now);
    start.setDate(now.getDate() - 29);
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: todayStr,
    };
  }
  if (name === "90days") {
    const start = new Date(now);
    start.setDate(now.getDate() - 89);
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: todayStr,
    };
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

      const score =
        settings.weightDaysSinceWorked * daysSinceNorm +
        settings.weightFrequency * freqScore +
        settings.weightAvailability * availScore +
        settings.weightBoost * boostNorm +
        settings.weightPriorityTier * tierScore +
        weightRecentTransfers * recentXferScore +
        Math.random() * 0.01; // tiny tiebreak noise

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
  const now = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
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
};

async function sendReport(
  type: "daily" | "weekly" | "monthly",
  opts: ReportOptions = {},
) {
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
  //   weekly  → Sun–Sat containing today
  //   monthly → 16th of prev month → 15th of current (billing period)
  const period = opts.customRange
    ? opts.customRange
    : type === "daily"
    ? (() => { const t = new Date().toISOString().split("T")[0]; return { startDate: t, endDate: t }; })()
    : type === "weekly"
    ? resolveNamedPeriod("week")
    : getDefaultPeriod();
  const { startDate, endDate } = period;

  const outcomes   = storage.getLeadOutcomes({ startDate, endDate });
  const los        = storage.getLoanOfficers();
  const users      = storage.getUsers();
  const callLogs   = storage.getCallLogsByRange(startDate, endDate);
  const assignments = storage.getAssignmentsByRange(startDate, endDate);

  // CLR list — assistants + admin-CLRs. When clrId is set, scope to that CLR.
  const clrs = users.filter((u: any) =>
    u.isActive
    && (u.role === "assistant" || (u.role === "admin" && u.isClr))
    && (opts.clrId ? u.id === opts.clrId : true)
  );

  // Per-CLR aggregates
  interface ClrStats {
    name: string;
    calls: number;
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

  const clrStats: ClrStats[] = clrs.map((u: any) => {
    const uid = u.id;

    // Calls from call logs
    const myCallsFromLogs = callLogs
      .filter((l: any) => l.assistantId === uid)
      .reduce((sum: number, l: any) => sum + (l.callsMade || 0), 0);

    // Outcomes
    const myOutcomes = outcomes.filter((o: any) => (o.assistantId || o.assistant_id) === uid);
    const outcomeTypeOf = (o: any) => (o.outcomeType || o.outcome_type) as string;
    const myTransfers       = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "transfer").length;
    const myAppointments    = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "appointment").length;
    const myFellThrough     = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "fell_through").length;
    const myCallbacks       = myOutcomes.filter((o: any) => outcomeTypeOf(o) === "callback_requested").length;
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

    // EOD report notes (one per day in period)
    const myEodReports = storageExtra.getEodReportsByRange(startDate, endDate)
      .filter((r: any) => r.assistant_id === uid && r.notes && r.notes.trim());
    const eodNotes = myEodReports.map((r: any) => `[${r.report_date}] ${r.notes.trim()}`);

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
  }).sort((a, b) => b.transfers - a.transfers);

  // Team totals
  const teamCalls          = clrStats.reduce((s, r) => s + r.calls, 0);
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
      r.calls > 0 || r.transfers > 0 || r.appointments > 0 || r.fellThrough > 0 ||
      r.callbacks > 0 || r.futureContacts > 0 || r.noAnswers > 0,
    );
    if (visibleRows.length === 0) return "";
    const title = type === "weekly" ? "Weekly Outcome Breakdown" : "Outcome Breakdown";
    const cellHead = (label: string) =>
      `<th style="padding:9px 10px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap">${label}</th>`;
    const cell = (v: number | string, color = "#334155", bold = false) =>
      `<td style="padding:9px 10px;text-align:center;font-size:13px;color:${color};${bold ? "font-weight:700" : ""}">${v}</td>`;

    const rowsHtml = visibleRows.map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      return `<tr style="background:${bg}">
        <td style="padding:9px 12px;font-size:13px;font-weight:600;color:#1e293b">${r.name}</td>
        ${cell(r.calls, "#0369a1", true)}
        ${cell(r.transfers, "#1A2B4A", true)}
        ${cell(r.appointments, "#0f766e")}
        ${cell(r.fellThrough, "#b45309")}
        ${cell(r.callbacks, "#7c3aed")}
        ${cell(r.futureContacts, "#0891b2")}
        ${cell(r.noAnswers, "#64748b")}
      </tr>`;
    }).join("");

    const totalsRow = type === "weekly" ? `<tr style="background:#f0f4ff;border-top:2px solid #e2e8f0">
      <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0F182D">Team Totals</td>
      ${cell(teamCalls, "#0369a1", true)}
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
            ${cellHead("Transfers")}
            ${cellHead("Appointments")}
            ${cellHead("Fell Throughs")}
            ${cellHead("Callbacks")}
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

  const subject = `CLR ${type.charAt(0).toUpperCase() + type.slice(1)} Report — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

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
    const missedStyle = row.missed > 0 ? "color:#dc2626;font-weight:600" : "color:#64748b";
    const ratioColor  = row.ratio === "—" ? "#94a3b8" : parseFloat(row.ratio) >= 10 ? "#15803d" : parseFloat(row.ratio) >= 5 ? "#b45309" : "#dc2626";
    return `<tr style="background:${bg}">
      <td style="padding:10px 12px;font-size:13px">${medal}</td>
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b">${row.name}</td>
      <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#1A2B4A;text-align:center">${row.transfers}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;color:#0369a1">${row.calls}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;font-weight:600;color:${ratioColor}">${row.ratio}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;color:#0f766e">${row.appointments}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;color:#b45309">${row.fellThrough}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center">${row.assigned}</td>
      <td style="padding:10px 12px;font-size:13px;text-align:center;${missedStyle}">${row.missed}</td>
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
    transfers: number;
    appointments: number;
    fellThrough: number;
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
          transfers: eod.transfers || 0,
          appointments: eod.appointments || 0,
          fellThrough: dayFellThroughFromOutcomes,
        };
      }
      if (dayOutcomes.length === 0) {
        return { name: u.name, calls: 0, transfers: 0, appointments: 0, fellThrough: 0 };
      }
      return {
        name: u.name,
        calls: dayOutcomes.length,
        transfers: dayTransfersFromOutcomes,
        appointments: dayApptsFromOutcomes,
        fellThrough: dayFellThroughFromOutcomes,
      };
    })
    .filter(r => r.calls > 0 || r.transfers > 0 || r.appointments > 0 || r.fellThrough > 0)
    .sort((a, b) => b.transfers - a.transfers || b.calls - a.calls);

    const heading = new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
    });
    return { date: dateStr, heading, rows };
  }).filter(s => s.rows.length > 0);

  const perDayHtml = daySections.map(section => {
    const rowsHtml = section.rows.map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      return `<tr style="background:${bg}">
        <td style="padding:9px 12px;font-size:13px;font-weight:600;color:#1e293b">${r.name}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0369a1">${r.calls}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;font-weight:700;color:#1A2B4A">${r.transfers}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#0f766e">${r.appointments}</td>
        <td style="padding:9px 12px;font-size:13px;text-align:center;color:#b45309">${r.fellThrough}</td>
      </tr>`;
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
  const teamMissedStyle = teamMissed > 0 ? "color:#dc2626;font-weight:700" : "color:#64748b;font-weight:700";
  const totalsRow = `<tr style="background:#f0f4ff;border-top:2px solid #e2e8f0">
    <td style="padding:10px 12px;font-size:12px;color:#94a3b8"></td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0F182D">Team Total</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#1A2B4A;text-align:center">${teamTransfers}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0369a1;text-align:center">${teamCalls}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;text-align:center;color:${teamRatioColor}">${teamRatio}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#0f766e;text-align:center">${teamAppointments}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#b45309;text-align:center">${teamFellThrough}</td>
    <td style="padding:10px 12px;font-size:13px;font-weight:700;text-align:center">${teamAssigned}</td>
    <td style="padding:10px 12px;font-size:13px;text-align:center;${teamMissedStyle}">${teamMissed}</td>
  </tr>`;

  const body = `
    <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6">
      Here is the ${type} performance summary for the CLR Connection Center team.
      Reporting period: <strong style="color:#1e293b">${startDate}</strong> &rarr; <strong style="color:#1e293b">${endDate}</strong>.
    </p>

    <!-- Team summary stat cards -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px">
      <tr>
        ${statCard(teamTransfers, "Transfers", "#1A2B4A")}
        ${statCard(teamCalls, "Total Calls", "#0369a1")}
        ${statCard(teamRatio, "Transfer / Call %", teamRatioColor)}
        ${statCard(teamMissed > 0 ? "⚠ " + teamMissed : teamMissed, "LOs Missed", teamMissed > 0 ? "#dc2626" : "#15803d")}
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
            <th style="padding:8px 6px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Callbacks</th>
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

    <!-- Divider -->
    <div style="border-top:1px solid #e2e8f0;margin-bottom:24px"></div>

    ${type === "weekly" ? `
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
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Xfer/Call%</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Appts</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Fell Thru</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Assigned</th>
          <th style="padding:9px 12px;text-align:center;color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Missed</th>
        </tr>
      </thead>
      <tbody>
        ${clrRows}
        ${totalsRow}
      </tbody>
    </table>
    <p style="margin:8px 0 0;font-size:11px;color:#94a3b8">
      * <em>Missed = LOs assigned but status never updated (still &ldquo;recommended&rdquo;)</em>
    </p>` : `<p style="color:#94a3b8;font-size:13px;font-style:italic">No CLR data for this period.</p>`}
    `}

    ${outcomeBreakdownHtml}

    ${transferDetailsHtml}

    <!-- Active LOs callout -->
    <div style="margin-top:28px;padding:14px 18px;background:#eff6ff;border-left:4px solid #1A2B4A;border-radius:0 8px 8px 0">
      <p style="margin:0;font-size:13px;color:#1e40af">
        <strong>Active LOs this period:</strong> ${los.filter((l: any) => l.internalStatus === "active").length} loan officers available for assignment.
      </p>
    </div>

    <!-- CLR EOD Notes & Activity Log -->
    ${clrStats.some(r => r.eodNotes.length > 0 || r.activityNotes.length > 0) ? `
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
          <p style="margin:${row.eodNotes.length > 0 ? '10px' : '0'} 0 8px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Activity Log</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:12px">
            ${row.activityNotes.map((a, ai) => `
            <tr style="background:${ai % 2 === 0 ? '#f8fafc' : '#ffffff'}">
              <td style="padding:5px 8px;color:#94a3b8;white-space:nowrap">${a.date}</td>
              <td style="padding:5px 8px;color:#64748b;font-style:italic;white-space:nowrap">${a.type.replace(/_/g, ' ')}</td>
              <td style="padding:5px 8px;color:#334155">${a.description}</td>
            </tr>`).join('')}
          </table>
          ` : ''}
        </div>
      </div>`).join('')}
    </div>` : ''}
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
    loName: string | null;
    note: string;
  }
  const clrNotes: Array<{ clrId: number; clrName: string; entries: NoteEntry[] }> = clrs.map((u: any) => {
    const uid = u.id;
    const entries: NoteEntry[] = outcomes
      .filter((o: any) => {
        const aid = o.assistantId ?? o.assistant_id;
        const n = o.notes;
        return aid === uid && typeof n === "string" && n.trim().length > 0;
      })
      .map((o: any) => {
        const loId = o.loId ?? o.lo_id;
        const lo = los.find((l: any) => l.id === loId);
        const loName = lo ? ((lo as any).fullName ?? (lo as any).full_name ?? null) : null;
        return {
          date: (o.date ?? o.report_date) as string,
          outcomeType: (o.outcomeType ?? o.outcome_type) as string,
          loName: (o.outcomeType ?? o.outcome_type) === "transfer" || (o.outcomeType ?? o.outcome_type) === "appointment" ? loName : null,
          note: String(o.notes).trim(),
        };
      });
    return { clrId: uid, clrName: u.name, entries };
  }).filter(c => c.entries.length > 0);

  let callNotesHtml = "";
  if (clrNotes.length > 0) {
    if (type === "weekly") {
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
          const items = byDate.get(dateStr)!.map(e => {
            const loPart = e.loName ? ` &mdash; <span style="color:#334155">${escNote(e.loName)}</span>` : "";
            return `<li style="margin:0 0 6px;font-size:13px;color:#334155;line-height:1.5">
              <strong style="color:#1A2B4A">${formatOutcomeType(e.outcomeType)}</strong>${loPart}
              <span style="color:#64748b;font-style:italic"> &mdash; ${escNote(e.note)}</span>
            </li>`;
          }).join("");
          return `<div style="margin:8px 0 4px">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#475569">${heading}</p>
            <ul style="margin:0 0 0 16px;padding:0;list-style:disc">${items}</ul>
          </div>`;
        }).join("");
        return `<div style="margin-bottom:${idx < clrNotes.length - 1 ? '18px' : '0'};padding-bottom:${idx < clrNotes.length - 1 ? '14px' : '0'};${idx < clrNotes.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''}">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0F182D">${escNote(c.clrName)}</p>
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
        const items = c.entries.map(e => {
          const loPart = e.loName ? ` &mdash; <span style="color:#334155">${escNote(e.loName)}</span>` : "";
          return `<li style="margin:0 0 6px;font-size:13px;color:#334155;line-height:1.5">
            <strong style="color:#1A2B4A">${formatOutcomeType(e.outcomeType)}</strong>${loPart}
            <span style="color:#64748b;font-style:italic"> &mdash; ${escNote(e.note)}</span>
          </li>`;
        }).join("");
        return `<div style="margin-bottom:${idx < clrNotes.length - 1 ? '14px' : '0'};padding-bottom:${idx < clrNotes.length - 1 ? '12px' : '0'};${idx < clrNotes.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''}">
          <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0F182D">${escNote(c.clrName)}</p>
          <ul style="margin:0 0 0 16px;padding:0;list-style:disc">${items}</ul>
        </div>`;
      }).join("");
      callNotesHtml = `
      <div style="margin-top:28px">
        <h2 style="margin:0 0 14px;font-size:15px;font-weight:700;color:#0F182D;letter-spacing:-0.2px">Call Notes</h2>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px">
          ${clrBlocks}
        </div>
      </div>`;
    }
  }

  const html = buildEmail({ subject, preheader: `${teamTransfers} transfers · ${teamRatio} transfer/call ratio · ${teamMissed} LOs missed`, body: body + callNotesHtml });
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

function triggerNmlsChecks() {
  const periodKey = getNmlsPeriodKey();
  const activeLos = storage.getLoanOfficers().filter((lo: any) => lo.internalStatus === "active" && lo.nmlsId);
  const assistants = storage.getUsers().filter((u: any) => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
  if (!assistants.length) return;

  for (const lo of activeLos) {
    // Skip if already exists for this period
    const existing = storageExtra.getNmlsCheckForLo(lo.id, periodKey);
    if (existing) continue;

    // Assign a random CLR
    const assignee = assistants[Math.floor(Math.random() * assistants.length)];
    storageExtra.createNmlsCheck({ loId: lo.id, assignedTo: assignee.id, periodKey });

    // Notify the assigned CLR
    storage.createNotification({
      userId: assignee.id,
      type: "nmls_check",
      title: "NMLS License Check Due",
      message: `Please verify ${lo.fullName}'s NMLS license (${lo.nmlsId ?? "no NMLS"}) is still active in all licensed states. Go to Directory to confirm.`,
      isRead: false,
    });
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
      message: `${lo.fullName}'s NMLS license check has not been confirmed in ${schedule.escalation_days} days. Someone needs to verify it now.`,
      isRead: false,
    });
  }
}

// Run NMLS checks on the 1st of every other month (Jan, Mar, May, Jul, Sep, Nov) at 8am UTC.
// Default interval is 2 months; the period key logic handles other intervals automatically.
cron.schedule("0 8 1 1,3,5,7,9,11 *", () => {
  try { triggerNmlsChecks(); } catch (e) { console.error("NMLS check trigger error:", e); }
});

// Check for escalations every morning at 9am
cron.schedule("0 9 * * *", () => {
  try { runNmlsEscalations(); } catch (e) { console.error("NMLS escalation error:", e); }
});

// Re-notify pending NMLS checks every morning at 8:30am so they surface daily
cron.schedule("30 8 * * *", () => {
  try {
    const periodKey = getNmlsPeriodKey();
    const allChecks = storageExtra.getNmlsChecksForPeriod(periodKey);
    const los = storage.getLoanOfficers();
    const pending = allChecks.filter((c: any) => c.status === "pending");
    for (const check of pending) {
      if (!check.assigned_to) continue;
      const lo = los.find((l: any) => l.id === check.lo_id);
      if (!lo) continue;
      const title = "NMLS License Check Reminder";
      const message = `Reminder: Please verify ${lo.fullName}'s NMLS license is still active. Click here to confirm.`;
      // Create a fresh unread notification so it appears daily
      storage.createNotification({
        userId: check.assigned_to,
        type: "nmls_check",
        title,
        message,
        isRead: false,
      });
      sendPushToUser(check.assigned_to, { title, body: message, url: "/nmls-checks" }).catch(() => {});
    }
  } catch (e) { console.error("NMLS daily reminder error:", e); }
});

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

// Nightly NMLS license check — 2am UTC
cron.schedule("0 2 * * *", async () => {
  try {
    console.log("[nmls] starting nightly license verification");
    const result = await verifyAllLoNmls();
    console.log(`[nmls] nightly verify complete: checked=${result.checked} blocked=${result.blocked} flagged=${result.flagged}`);
  } catch (e) { console.error("NMLS nightly verify error:", e); }
});

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
// three reports should be dispatched. Uses configurable daily_time (HH:MM),
// fires weekly on Monday at the daily_time, monthly on the 16th at daily_time.
let lastReportFiredAt: Record<"daily" | "weekly" | "monthly", string> = { daily: "", weekly: "", monthly: "" };
cron.schedule("* * * * *", async () => {
  try {
    const s = storageExtra.getEmailSettings() as any;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const nowHM = `${hh}:${mm}`;
    const nowDateKey = now.toISOString().split("T")[0];
    const dailyTime = s.daily_time || "08:00";
    if (nowHM !== dailyTime) return;

    // daily
    if (s.daily_enabled && lastReportFiredAt.daily !== nowDateKey) {
      lastReportFiredAt.daily = nowDateKey;
      try { await sendReport("daily"); } catch (e: any) { console.error("Scheduled daily report failed:", e?.message ?? e); }
    }
    // weekly — Monday
    if (s.weekly_enabled && now.getDay() === 1 && lastReportFiredAt.weekly !== nowDateKey) {
      lastReportFiredAt.weekly = nowDateKey;
      try { await sendReport("weekly"); } catch (e: any) { console.error("Scheduled weekly report failed:", e?.message ?? e); }
    }
    // monthly — 1st of the month
    if (s.monthly_enabled && now.getDate() === 1 && lastReportFiredAt.monthly !== nowDateKey) {
      lastReportFiredAt.monthly = nowDateKey;
      try { await sendReport("monthly"); } catch (e: any) { console.error("Scheduled monthly report failed:", e?.message ?? e); }
    }
  } catch (e: any) { console.error("Scheduled report cron error:", e?.message ?? e); }
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
    const rows = sqlite.prepare(`
      SELECT lo.id, lo.assistant_id, lo.borrower_name, lo.appointment_datetime,
             u.email AS clr_email, u.name AS clr_name, u.reminder_email_enabled,
             loff.full_name AS lo_name
      FROM lead_outcomes lo
      JOIN users u ON u.id = lo.assistant_id
      LEFT JOIN loan_officers loff ON loff.id = lo.lo_id
      WHERE lo.outcome_type = 'appointment'
        AND lo.appointment_datetime IS NOT NULL
        AND lo.appointment_datetime <> ''
        AND COALESCE(lo.reminder_sent_30m, 0) = 0
    `).all() as any[];

    for (const r of rows) {
      const t = Date.parse(r.appointment_datetime);
      if (!Number.isFinite(t)) continue;
      if (t <= nowMs || t > cutoffMs) continue;

      const borrower = r.borrower_name?.trim() || "Unknown";
      const loName = r.lo_name || "Unknown LO";
      const when = (() => {
        try { return new Date(r.appointment_datetime).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }); }
        catch { return r.appointment_datetime; }
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
              <p style="margin-top:18px"><a href="https://www.wlc.it.com/#/outcomes" style="background:#1A2B4A;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:500">Open CLR Connection Center</a></p>
            </body></html>`,
          });
        } catch (e: any) { console.error(`[appt-30m] email failed outcome=${r.id}:`, e?.message ?? e); }
      }

      // Push (best-effort)
      try {
        await sendPushToUser(r.assistant_id, {
          title: "⏰ Appointment in 30 minutes",
          body: `${borrower} — ${loName}`,
          url: "/outcomes",
        });
      } catch {}

      try { sqlite.prepare(`UPDATE lead_outcomes SET reminder_sent_30m = 1 WHERE id = ?`).run(r.id); } catch {}
      console.log(`[appt-30m] reminder fired outcome=${r.id} to=${r.clr_email}`);
    }
  } catch (e: any) { console.error("[appt-30m] cron error:", e?.message ?? e); }
});

export function registerRoutes(httpServer: Server, app: Express) {
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
      return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, isClr: !!u.isClr, isManager: !!(u.isManager ?? u.is_manager), hasSeenIntro: !!u.hasSeenIntro, mustChangePassword: !!u.mustChangePassword, hasDismissedSample: !!(u.hasDismissedSample ?? u.has_dismissed_sample), createdAt: u.createdAt ?? u.created_at ?? null, phone: u.phone ?? null, scriptCompanyName: u.scriptCompanyName ?? u.script_company_name ?? null, scriptNameOverride: u.scriptNameOverride ?? u.script_name_override ?? null, scriptLoOverride: u.scriptLoOverride ?? u.script_lo_override ?? null, goalCallsWeekly: u.goalCallsWeekly ?? u.goal_calls_weekly ?? 0, goalTransfersWeekly: u.goalTransfersWeekly ?? u.goal_transfers_weekly ?? 0, goalAppointmentsWeekly: u.goalAppointmentsWeekly ?? u.goal_appointments_weekly ?? 0, smsRemindersEnabled: !!(u.smsRemindersEnabled ?? u.sms_reminders_enabled), timezone: u.timezone ?? "America/Los_Angeles", superAdmin, orgId, isImpersonating, impersonatingOrgName } });
    } catch {
      return res.status(401).json({ error: "Not authenticated" });
    }
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
      return res.json(genericResponse);
    }

    const user = storage.getUserByEmail(email);
    if (!user) {
      return res.json(genericResponse);
    }

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
    } catch (e) {
      console.error("Forgot password flow failed:", e);
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

  // ── Auth guard for all /api/* routes except /api/auth/* and /api/invite/* ──
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/auth")) return next();
    if (req.path.startsWith("/invite")) return next();
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
    try {
      const hash = await bcrypt.hash(tempPassword, 10);
      storage.setUserPassword(newUser.id, hash);
      storage.setMustChangePassword(newUser.id, true);
    } catch (e) {
      console.error("Failed to set temp password for new user:", e);
    }

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
        <div style="text-align:center;margin-bottom:24px">
          <a href="https://www.westcapitallending.center" style="display:inline-block;background:#0F182D;color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px">
            Log In to CLR Connection Center
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
      <div style="text-align:center;margin-bottom:24px">
        <a href="https://www.westcapitallending.center" style="display:inline-block;background:#0F182D;color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px">
          Log In to CLR Connection Center
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

  app.delete("/api/users/:id", requireAuth, (req: any, res) => {
    const requesterId = req.session_user?.userId;
    const requesterRole = req.session_user?.role;
    if (requesterRole !== "admin") return res.status(403).json({ error: "Admins only" });
    const id = parseInt(req.params.id);
    if (id === requesterId) return res.status(400).json({ error: "You cannot delete your own account" });
    if (id === 1) return res.status(400).json({ error: "The primary admin account cannot be deleted" });
    try {
      storageExtra.deleteUserCascade(id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message ?? "Delete failed" });
    }
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
    // Compute 90-day transfer counts for score preview
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const xfer90Start = ninetyDaysAgo.toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
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

  // Anyone authed can update an LO's personal preferences (collaborative field).
  // Body shape is locked to { personalPreferences: string | null } so this route
  // can't be used to escalate edits to other LO fields.
  app.patch("/api/loan-officers/:id/preferences", requireAuth, (req: any, res) => {
    const id = parseInt(req.params.id);
    const raw = req.body?.personalPreferences;
    const value =
      raw == null || (typeof raw === "string" && raw.trim() === "")
        ? null
        : String(raw).slice(0, 4000);
    const lo = storage.updateLoanOfficer(id, { personalPreferences: value } as any);
    if (!lo) return res.status(404).json({ error: "Not found" });
    const actor = storage.getUsers().find((u: any) => u.id === req.session_user?.userId);
    audit({
      userId: req.session_user?.userId ?? 0,
      userName: actor?.name ?? "Unknown",
      action: "update",
      entityType: "loan_officer",
      entityId: lo.id,
      entityLabel: (lo as any).fullName ?? `LO #${lo.id}`,
      details: JSON.stringify({ personalPreferences: value }),
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
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
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
    res.json(enriched);
  });

  // Today's assignments for the current CLR (used by call script for [lo name])
  app.get("/api/assignments/today", requireAuth, (req: any, res) => {
    const userId = req.session_user?.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const date = new Date().toISOString().split("T")[0];
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
    res.json(enriched);
  });

  app.post("/api/assignments/generate", (req, res) => {
    const date = (req.body.date as string) || new Date().toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];

    // ── Block generation for past dates entirely ────────────────────────────────
    if (date < today) {
      return res.status(403).json({
        error: "Assignments cannot be generated for past dates.",
        locked: true,
        date,
      });
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
    const assistants = storage.getUsers().filter(u => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)));

    if (assistants.length === 0) return res.status(400).json({ error: "No active assistants" });

    // Check what's already worked today (existing is already fetched above; at this point it's empty)
    const workedToday = existing.filter(a => a.status === "worked").map(a => a.loId);
    const eligibleLOs = los.filter(lo => !workedToday.includes(lo.id));


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

  // ── Admin: pre-configure assignments for a future date ─────────────────────
  // Body: { date: 'YYYY-MM-DD', items: [{ loId, assistantId, assistantRank }] }
  app.post("/api/assignments/pre-configure", (req: any, res) => {
    if (!requireAdminSession(req, res)) return;
    const sessionUid = req.session_user?.userId;
    const user = storage.getUserById(sessionUid) as any;
    const date = (req.body.date as string) || "";
    const items = (req.body.items as any[]) || [];
    const today = new Date().toISOString().split("T")[0];
    if (!date || date < today) {
      return res.status(400).json({ error: "Pre-configure requires a current or future date." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }

    storage.clearDailyAssignments(date);
    const assistants = storage.getUsers().filter(u => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
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
        borrowerName: o.borrowerName ?? o.borrower_name ?? null,
        followUpDate: o.followUpDate ?? o.follow_up_date ?? null,
        journeyId: o.journeyId ?? o.journey_id ?? null,
        phoneNumber: o.phoneNumber ?? o.phone_number ?? null,
        lo,
        assistant,
      };
    });
    res.json(enriched);
  });

  app.post("/api/outcomes", (req, res) => {
    try {
      const body = { ...req.body };
      if (body.outcomeType === "transfer") {
        if (body.transferType !== "direct" && body.transferType !== "appointment") {
          return res.status(400).json({ error: "transferType is required for transfer outcomes (must be 'direct' or 'appointment')" });
        }
      } else {
        body.transferType = null;
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
      const outcome = storage.createLeadOutcome(body);
      const lo = outcome.loId ? storage.getLoanOfficerById(outcome.loId) : null;
      audit({ userId: 1, userName: "Ethan Wood", action: "create", entityType: "outcome", entityId: outcome.id, entityLabel: outcome.borrowerName ?? lo?.fullName ?? null, details: JSON.stringify({ outcomeType: outcome.outcomeType, transferType: outcome.transferType ?? null }) });
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
    const existing = storageExtra.getRawSqlite().prepare(`SELECT assistant_id FROM lead_outcomes WHERE id = ?`).get(id) as any;
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
    } else if (body.outcomeType !== undefined) {
      // outcomeType is being changed away from transfer — clear transferType
      body.transferType = null;
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
  app.get("/api/notifications", (req, res) => {
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    res.json(storage.getNotifications(userId));
  });

  app.get("/api/notifications/unread-count", (req, res) => {
    const userId = req.query.userId ? parseInt(req.query.userId as string) : 1;
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

  app.post("/api/notifications/mark-all-read", (req, res) => {
    const { userId } = req.body;
    storage.markAllNotificationsRead(userId || 1);
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
    const stats = scope === "personal" && userId
      ? storage.getDashboardStats(startDate, endDate, userId)
      : storage.getDashboardStats(startDate, endDate);
    const todayStr = new Date().toISOString().split("T")[0];

    let myCallsToday: number | null = null;
    let futureContactsCount = 0;
    let myCallsInPeriod = 0;
    let contactsReachedPeriod = 0;
    let dncHitsPeriod = 0;

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

    if (scope === "team") {
      // Team totals — aggregate across all active CLRs
      const allLogsToday = storage.getDailyCallLogs(todayStr) as any[];
      myCallsToday = allLogsToday.reduce((sum: number, l: any) => sum + (l.callsMade ?? l.calls_made ?? 0), 0);

      const allOutcomes = storage.getLeadOutcomes({ startDate, endDate }) as any[];
      futureContactsCount = allOutcomes.filter((o: any) => {
        const t = o.outcomeType || o.outcome_type;
        return t === "deferral" || t === "future_contact";
      }).length;

      myCallsInPeriod = sumCallsSql("", []);
      contactsReachedPeriod = rawLogsInPeriod.reduce((s, l) => s + (l.contacts_reached ?? 0), 0);
      dncHitsPeriod = rawLogsInPeriod.reduce((s, l) => s + (l.dnc_hits ?? 0), 0);
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
    const users = storage.getUsers() as any[];
    const activeAssistants = users.filter(u => (u.role === "assistant" || u.role === "admin") && u.isActive);

    const filterByClr = <T extends any>(arr: T[], field: string): T[] =>
      clrId === undefined ? arr : arr.filter((o: any) => (o[field] ?? o[field.replace(/([A-Z])/g, "_$1").toLowerCase()]) === clrId);

    const outcomes = clrId === undefined ? outcomesAll : outcomesAll.filter((o: any) => (o.assistantId ?? o.assistant_id) === clrId);
    const outcomesPrevFiltered = clrId === undefined ? outcomesPrev : outcomesPrev.filter((o: any) => (o.assistantId ?? o.assistant_id) === clrId);
    const callLogs = clrId === undefined ? callLogsAll : callLogsAll.filter((l: any) => (l.assistantId ?? l.assistant_id) === clrId);
    const callLogsPrevFiltered = clrId === undefined ? callLogsPrev : callLogsPrev.filter((l: any) => (l.assistantId ?? l.assistant_id) === clrId);

    const ot = (o: any) => o.outcomeType ?? o.outcome_type;
    const isAppt = (t: string) => t === "appointment" || t === "callback_requested" || t === "deferral";

    const sumCalls = (logs: any[]) => logs.reduce((s, l) => s + (l.callsMade ?? l.calls_made ?? 0), 0);
    const sumContacts = (logs: any[]) => logs.reduce((s, l) => s + (l.contactsReached ?? l.contacts_reached ?? 0), 0);
    const sumDnc = (logs: any[]) => logs.reduce((s, l) => s + (l.dncHits ?? l.dnc_hits ?? 0), 0);

    // Raw call logs include contacts_reached/dnc_hits columns (not exposed via Drizzle schema)
    const rawCallLogsAll = storageExtra.getCallLogsByRangeRaw(startDate, endDate);
    const rawCallLogs = clrId === undefined ? rawCallLogsAll : rawCallLogsAll.filter((l: any) => l.assistant_id === clrId);

    const totalCalls = sumCalls(callLogs);
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
  app.get("/api/chat", requireAuth, (req, res) => {
    const limit = parseInt((req.query.limit as string) || "80");
    const beforeId = req.query.beforeId ? parseInt(req.query.beforeId as string) : undefined;
    const messages = storageExtra.getChatMessages(limit, beforeId).reverse();
    res.json({ messages });
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
    const todayStr = new Date().toISOString().split("T")[0];

    if (!isClr) {
      return res.json({ hasLog: true, date: todayStr, exempt: true, outcomes: emptyOutcomeBreakdown() });
    }

    const logs = storage.getDailyCallLogs(todayStr);
    const logForUser = logs.find(l => l.assistantId === userId);
    const hasLog = !!logForUser;
    const outcomes = getOutcomeBreakdownFor(userId, todayStr);
    res.json({
      hasLog,
      date: todayStr,
      outcomes,
      callsMadeLogged: logForUser?.callsMade ?? 0,
    });
  });

  app.get("/api/call-logs", (req, res) => {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
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

  // ── Webhook endpoints (PUBLIC — no auth; external services POST here) ───────
  function requireAdminSession(req: any, res: Response): boolean {
    const uid = req.session_user?.userId;
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return false; }
    const u = storage.getUserById(uid);
    if (!u || u.role !== "admin") { res.status(403).json({ error: "Admin only" }); return false; }
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
    const today = new Date().toISOString().split("T")[0];

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
    res.json({ checks: pending, periodKey, escalationDays: schedule.escalation_days ?? 7 });
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
    const s = storageExtra.getEmailSettings() as any;
    // Mask the API key
    const key = s.resend_api_key || "";
    res.json({ ...s, resend_api_key: key ? `re_${"•".repeat(Math.max(0, key.length - 7))}${key.slice(-4)}` : "" });
  });

  app.patch("/api/settings/email", requireAuth, (req, res) => {
    const data = { ...req.body };
    // Don't overwrite with masked key
    if (data.resendApiKey && data.resendApiKey.includes("•")) delete data.resendApiKey;
    if (data.resend_api_key && data.resend_api_key.includes("•")) delete data.resend_api_key;
    storageExtra.updateEmailSettings(data);
    res.json({ ok: true });
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
    const rawType = req.body?.type;
    const type: "daily" | "weekly" | "monthly" =
      rawType === "daily" || rawType === "weekly" || rawType === "monthly" ? rawType : "daily";
    console.log(`[send-now] user=${(req as any).session_user?.userId} type=${type}`);
    try {
      const result = await sendReport(type);
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
  function parseRange(body: any, type: "daily" | "weekly" | "monthly"): { startDate: string; endDate: string } {
    const ymd = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "";
    let s = ymd(body?.startDate);
    let e = ymd(body?.endDate);
    if (!s) {
      const t = new Date().toISOString().split("T")[0];
      s = t; e = t;
    }
    if (!e) e = s;
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
    const type: "daily" | "weekly" | "monthly" =
      rawType === "daily" || rawType === "weekly" || rawType === "monthly" ? rawType : "daily";
    try {
      const range = parseRange(req.body, type);
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
    const type: "daily" | "weekly" | "monthly" =
      rawType === "daily" || rawType === "weekly" || rawType === "monthly" ? rawType : "daily";
    try {
      const range = parseRange(req.body, type);
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
    if (type !== "daily" && type !== "weekly" && type !== "monthly") {
      return res.status(400).json({ error: "type must be 'daily', 'weekly', or 'monthly'" });
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
    const assistants = storage.getUsers().filter(u => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
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

  // ── Admin: unlock + regenerate today's assignments ─────────────────────────
  app.post("/api/assignments/regenerate-override", requireAuth, async (req, res) => {
    const raw = (req as any).signedCookies?.[COOKIE_NAME];
    const session = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
    const user = session?.userId ? storage.getUserById(session.userId) : null;
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });

    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: "A reason is required" });

    const date = new Date().toISOString().split("T")[0];
    const settings = storage.getAlgorithmSettings();
    const los = storage.getLoanOfficers();
    const assistants = storage.getUsers().filter(u => u.isActive && (u.role === "assistant" || (u.role === "admin" && u.isClr)));
    if (assistants.length === 0) return res.status(400).json({ error: "No active assistants" });

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
      };
    });

    res.json(enriched);
  });

  app.post('/api/eod-reports', requireAuth, async (req: any, res) => {
    const userId = req.session_user?.userId;
    const { reportDate, callsMade, voicemails, textsSent, emailsSent, loConnections, transfers, appointments, notes, assignedLosCalled, additionalLosCalled, additionalLosOtherNotes } = req.body;
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

    // ── Send EOD summary email to managers + CLR themselves ─────────────────
    try {
      const settings = storageExtra.getEmailSettings() as any;
      const managers: string[] = (() => {
        try { return JSON.parse(settings.manager_emails || "[]"); } catch { return []; }
      })();

      const clrUser = storage.getUserById(userId) as any;
      const clrName = clrUser?.name ?? `User #${userId}`;
      const clrEmail = clrUser?.email ?? null;

      // Build recipient list: managers + CLR themselves
      const allRecipients = [...new Set([...managers, ...(clrEmail ? [clrEmail] : [])])];

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
        let fellThroughCount = 0;
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
            fellThroughCount = dayRows.filter((o: any) => o.outcome_type === 'fell_through').length;
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

        const reportDateLong = new Date(reportDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        const reportDateShort = new Date(reportDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

        // ── Week-to-date summary (Sun–Sat containing the report date) ──
        const rd = new Date(reportDate + "T00:00:00");
        const dow = rd.getDay(); // 0=Sun..6=Sat
        const wkStart = new Date(rd); wkStart.setDate(rd.getDate() - dow);
        const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6);
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

        const wkStartLabel = wkStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const wkEndLabel = wkEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });

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
            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#166534">💰 Transfer Prospects (${xfers})</p>
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
    const activity = storageExtra.addEodActivity({ reportDate, assistantId: userId, activityType, description });
    res.json(activity);
  });

  app.delete('/api/eod-reports/activities/:id', requireAuth, (req: any, res) => {
    storageExtra.deleteEodActivity(parseInt(req.params.id));
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
    const todayStr = new Date().toISOString().split("T")[0];

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
    const transferRate = totalCalls > 0 ? +((totalTransfers / totalCalls) * 100).toFixed(1) : 0;

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
        transfers: totalTransfers,
        appointments: totalAppointments,
        fellThrough: totalFellThrough,
        deferrals: totalDeferrals,
        transferRate,
        avgCallsPerDay,
      },
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
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admins only" });
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
    // Non-admins can only view their own goals
    if (req.session_user?.role !== "admin" && req.session_user?.userId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const sqlite = storageExtra.getSqlite();
      const row = sqlite.prepare(`
        SELECT user_id AS userId, org_id AS orgId,
               calls_goal AS callsGoal,
               transfers_goal AS transfersGoal,
               appointments_goal AS appointmentsGoal,
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

  // Upsert goals for a user (admin only)
  app.patch("/api/goals/:userId", requireAuth, (req: any, res) => {
    if (req.session_user?.role !== "admin") return res.status(403).json({ error: "Admins only" });
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: "Invalid user id" });
    const toInt = (v: any) => {
      const n = parseInt(String(v ?? 0), 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const calls = toInt(req.body?.callsGoal ?? req.body?.calls);
    const transfers = toInt(req.body?.transfersGoal ?? req.body?.transfers);
    const appointments = toInt(req.body?.appointmentsGoal ?? req.body?.appointments);
    const orgId = req.session_user?.orgId ?? 1;
    try {
      const sqlite = storageExtra.getSqlite();
      sqlite.prepare(`
        INSERT INTO clr_goals (user_id, org_id, calls_goal, transfers_goal, appointments_goal, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
          calls_goal = excluded.calls_goal,
          transfers_goal = excluded.transfers_goal,
          appointments_goal = excluded.appointments_goal,
          updated_at = datetime('now')
      `).run(userId, orgId, calls, transfers, appointments);
      res.json({ ok: true, userId, goals: { calls, transfers, appointments } });
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
    // Notify admins
    try {
      const admins = storage.getUsers().filter((u: any) => u.role === "admin" && u.isActive && u.id !== userId);
      const pushPayload = {
        title: `New Forum Question: ${post.title}`,
        body: `${authorName} asked: ${post.title}`,
        url: `/forum`,
      };
      for (const admin of admins) {
        storage.createNotification({
          userId: admin.id,
          type: "announcement",
          title: pushPayload.title,
          message: pushPayload.body,
          isRead: false,
        });
      }
      sendPushToUsers(admins.map((a: any) => a.id), pushPayload).catch(() => {});
    } catch (e) { console.error("forum admin notify failed:", e); }
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
      const subscriberIds = storageExtra.getForumSubscribers(postId).filter((uid) => uid !== userId);
      const pushPayload = {
        title: `New answer on: ${post.title}`,
        body: `${authorName} answered your question`,
        url: `/forum`,
      };
      for (const subId of subscriberIds) {
        storage.createNotification({
          userId: subId,
          type: "announcement",
          title: pushPayload.title,
          message: pushPayload.body,
          isRead: false,
        });
      }
      sendPushToUsers(subscriberIds, pushPayload).catch(() => {});
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

}

export function createHttpServer(app: Express): Server {
  const server = createServer(app);
  registerRoutes(server, app);
  return server;
}
