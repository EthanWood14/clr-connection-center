// The emailed Transfer Scorecard: six weekday snapshots from 8 AM through
// 6 PM Pacific, plus the separate mid-week/end-of-week summaries.
//
// Pure functions only (window math, ranking, rendering); the caller supplies
// the rows. Ranking mirrors the dashboard scorecard exactly: transfers, then
// appointments as the tiebreaker, then calls — an emailed snapshot and the
// on-screen board must never disagree about who is on top.
import { addIsoDays } from "./business-day";
import { formatTransferCount } from "@shared/transfer-credit";
import type { ScorecardDigestContext } from "./scorecard-digest-context";

export type ScorecardDigestKind = "intraday" | "midday" | "eod" | "midweek" | "eow";

export const SCORECARD_INTRADAY_CRON = "0 8,10,12,14,16,18 * * 1-5";

/** Explicit PT timestamp keeps each cumulative snapshot distinct, including DST. */
export function scorecardSnapshotLabel(now: Date): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(now);
  return `${time} PT · Today so far`;
}

export type ScorecardRow = {
  name: string;
  calls: number;
  /**
   * Transfer CREDIT, not a row count: a transfer off a shotgun lead is half for
   * the CLR who published it and half for the one who claimed it, so this is a
   * multiple of 0.5 and prints through formatTransferCount. The ranking and the
   * ratio below are unaffected — they only ever compare and divide.
   */
  transfers: number;
  appointments: number;
  fellThrough: number;
};

export type ScorecardDigestHelperAssisted = {
  /** Display name from email_settings.helper_name (default Elleine). */
  name: string;
  /** lead_outcomes rows in the window with helper_assisted=1. */
  count: number;
};

/**
 * Elleine (and whoever currently sits in the configured helper seat) still
 * belongs on the emailed Transfer Scorecard even when exclude_from_stats is
 * set. TV race, tournament, and manager MTD boards keep excluding her — only
 * this digest path opts her back in.
 *
 * Match either the hard-coded Elleine whole-word (historical seat) or the
 * resolved helper user id / configured helper name.
 */
export function isScorecardDigestHelperException(
  name: string,
  opts?: { userId?: number; helperUserId?: number | null; helperName?: string },
): boolean {
  if (/\belleine\b/i.test(name)) return true;
  const helperUserId = opts?.helperUserId;
  const userId = opts?.userId;
  if (helperUserId != null && userId != null && Number(helperUserId) === Number(userId)) return true;
  const helperName = String(opts?.helperName ?? "").trim();
  if (!helperName) return false;
  // Whole-word on the helper setting so "Elle" cannot claim "Elleine".
  const escaped = helperName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(name);
}

/** Monday of the week containing `date` (ISO YYYY-MM-DD, weeks start Monday). */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun
  const back = dow === 0 ? 6 : dow - 1;
  return addIsoDays(date, -back);
}

export function scorecardWindow(kind: ScorecardDigestKind, todayPT: string): {
  from: string; to: string; label: string;
} {
  switch (kind) {
    case "intraday": return { from: todayPT, to: todayPT, label: "Today so far" };
    case "midday":  return { from: todayPT, to: todayPT, label: "Mid-Day" };
    case "eod":     return { from: todayPT, to: todayPT, label: "End of Day" };
    case "midweek": return { from: mondayOf(todayPT), to: todayPT, label: "Mid-Week · Week to Date" };
    case "eow":     return { from: mondayOf(todayPT), to: todayPT, label: "End of Week · Week to Date" };
  }
}

/** Same order as the dashboard scorecard: transfers → appointments → calls. */
export function rankScorecardRows(rows: ScorecardRow[]): ScorecardRow[] {
  return [...rows].sort((a, b) =>
    (b.transfers - a.transfers)
    || (b.appointments - a.appointments)
    || (b.calls - a.calls));
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildScorecardDigestHtml(
  windowLabel: string,
  dateLabel: string,
  rows: ScorecardRow[],
  extras?: { helperAssisted?: ScorecardDigestHelperAssisted; helperName?: string; context?: ScorecardDigestContext },
): string {
  const helperName = extras?.helperName ?? extras?.helperAssisted?.name;
  const isHelper = (r: ScorecardRow) => isScorecardDigestHelperException(r.name, { helperName });
  const helperRows = rows.filter(isHelper);
  const ranked = rankScorecardRows(rows.filter((r) => !isHelper(r)));
  // Team totals intentionally include helper rows even though they are not in
  // the CLR ranking above.
  const tot = (f: keyof Omit<ScorecardRow, "name">) => rows.reduce((s, r) => s + r[f], 0);
  const pct = (r: { transfers: number; calls: number }) =>
    r.calls > 0 ? `${Math.round((r.transfers / r.calls) * 1000) / 10}%` : "—";

  const body = ranked.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"}">
      <td style="padding:8px 12px;font-size:13px;color:#64748b">${i + 1}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#1e293b">${esc(r.name)}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#0369a1">${r.calls}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;font-weight:700;color:#16a34a">${formatTransferCount(r.transfers)}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#2563eb">${r.appointments}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#dc2626">${r.fellThrough}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#64748b">${pct(r)}</td>
    </tr>`).join("");

  const helperBody = helperRows.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"}">
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#1e293b">${esc(r.name)}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#0369a1">${r.calls}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;font-weight:700;color:#16a34a">${formatTransferCount(r.transfers)}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#2563eb">${r.appointments}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#dc2626">${r.fellThrough}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#64748b">${pct(r)}</td>
    </tr>`).join("");

  const helperSection = helperRows.length ? `
    <p style="margin:16px 0 6px;font-size:13px;font-weight:700;color:#1A2B4A">Other CLRs</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Name</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Calls</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Transfers</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Appts</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Fell Through</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">C&gt;T%</th>
      </tr></thead>
      <tbody>${helperBody}</tbody>
    </table>` : "";

  const assisted = extras?.helperAssisted;
  const assistedLine = assisted
    ? `
    <p style="margin:12px 0 0;font-size:12px;color:#64748b">${esc(assisted.name)} assisted: ${Number(assisted.count) || 0}</p>`
    : "";

  const context = extras?.context;
  const contextHtml = context ? `
    <h3 style="margin:22px 0 8px;color:#1A2B4A;font-size:15px">Time off / sick</h3>
    ${context.attendance.length ? context.attendance.map(r => `<p style="font-size:13px;margin:6px 0"><strong>${esc(r.name)}</strong> · ${esc(r.label)} · ${esc(r.from)}${r.from !== r.to ? ` → ${esc(r.to)}` : ""}</p>`).join("") : '<p style="font-size:12px;color:#64748b">No approved time off or excused absences in this window.</p>'}
    <h3 style="margin:22px 0 8px;color:#1A2B4A;font-size:15px">EOD notes</h3>
    ${context.eodNotes.length ? context.eodNotes.map(r => `<div style="padding:10px 12px;margin:8px 0;background:#f8fafc;border:1px solid #e2e8f0"><strong style="font-size:13px">${esc(r.name)} · ${esc(r.date)}</strong><p style="white-space:pre-wrap;font-size:13px;margin:6px 0 0">${esc(r.notes)}</p></div>`).join("") : '<p style="font-size:12px;color:#64748b">No EOD notes submitted for this window yet.</p>'}
  ` : "";

  return `
    <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#1A2B4A">Transfer Scorecard — ${esc(windowLabel)}</p>
    <p style="margin:0 0 14px;font-size:12px;color:#64748b">${esc(dateLabel)} · ranked by transfers, appointments break ties</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">#</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">CLR</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Calls</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Transfers</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Appts</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Fell Through</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">C&gt;T%</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr style="background:#f8fafc;font-weight:700">
        <td style="padding:8px 12px"></td>
        <td style="padding:8px 12px;font-size:13px">Team</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${tot("calls")}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${formatTransferCount(tot("transfers"))}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${tot("appointments")}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${tot("fellThrough")}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${pct({ transfers: tot("transfers"), calls: tot("calls") })}</td>
      </tr></tfoot>
    </table>${helperSection}${assistedLine}${contextHtml}`;
}
