// The emailed Transfer Scorecard: four scheduled snapshots — mid-day and end
// of day covering that day, mid-week and end of week covering week-to-date.
//
// Pure functions only (window math, ranking, rendering); the caller supplies
// the rows. Ranking mirrors the dashboard scorecard exactly: transfers, then
// appointments as the tiebreaker, then calls — an emailed snapshot and the
// on-screen board must never disagree about who is on top.
import { addIsoDays } from "./business-day";

export type ScorecardDigestKind = "midday" | "eod" | "midweek" | "eow";

export type ScorecardRow = {
  name: string;
  calls: number;
  transfers: number;
  appointments: number;
  fellThrough: number;
};

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

export function buildScorecardDigestHtml(windowLabel: string, dateLabel: string, rows: ScorecardRow[]): string {
  const ranked = rankScorecardRows(rows);
  const tot = (f: keyof Omit<ScorecardRow, "name">) => ranked.reduce((s, r) => s + r[f], 0);
  const pct = (r: { transfers: number; calls: number }) =>
    r.calls > 0 ? `${Math.round((r.transfers / r.calls) * 1000) / 10}%` : "—";

  const body = ranked.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : "#f8fafc"}">
      <td style="padding:8px 12px;font-size:13px;color:#64748b">${i + 1}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#1e293b">${esc(r.name)}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#0369a1">${r.calls}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;font-weight:700;color:#16a34a">${r.transfers}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#2563eb">${r.appointments}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#dc2626">${r.fellThrough}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center;color:#64748b">${pct(r)}</td>
    </tr>`).join("");

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
        <td style="padding:8px 12px;font-size:13px;text-align:center">${tot("transfers")}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${tot("appointments")}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${tot("fellThrough")}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:center">${pct({ transfers: tot("transfers"), calls: tot("calls") })}</td>
      </tr></tfoot>
    </table>`;
}
