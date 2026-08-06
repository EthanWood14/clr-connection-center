// The 10am manager check-in digest.
//
// Pure rendering only: the caller supplies rows already built by
// buildCheckinBoard(), so this file never touches the database and can be
// tested directly. Classification lives here rather than in the email template
// because "late" and "missing" are judgements the whole digest depends on.

import { BUSINESS_DAY_DEFAULT_TZ } from "./business-day";

export type DigestSubject = {
  name: string;
  /** Secondary line — the LO an assistant belongs to. Null for CLRs. */
  sub: string | null;
  expectedStart: string | null;
  checkin: {
    checked_in_at?: string | null;
    on_time?: number | null;
    minutes_late?: number | null;
    late_excused?: boolean | number | null;
  } | null;
  lateCount: number;
  lateOverLimit: boolean;
  scheduledOff: boolean;
  noSchedule: boolean;
  absenceExcused: boolean;
  startPassed: boolean;
};

export type DigestStatus =
  | "on_time" | "late" | "missing" | "excused" | "off" | "unjudged" | "pending";

/**
 * Which bucket a person falls into.
 *
 * on_time is `on_time === 1` and late is `on_time === 0` — deliberately not
 * truthiness. A check-in with on_time null was recorded against no schedule, so
 * there was no start time to judge it by; calling that "late" would invent a
 * fact. Same reason "missing" requires startPassed: before someone is due, not
 * having checked in yet is not a failure.
 */
export function digestStatus(s: DigestSubject): DigestStatus {
  if (s.checkin) {
    if (s.checkin.on_time === 1) return "on_time";
    if (s.checkin.on_time === 0) return "late";
    return "unjudged";
  }
  if (s.scheduledOff) return "off";
  if (s.absenceExcused) return "excused";
  if (s.noSchedule) return "unjudged";
  return s.startPassed ? "missing" : "pending";
}

/** Whether anyone was actually due in — false on weekends and holidays. */
export function anyoneExpected(subjects: DigestSubject[]): boolean {
  return subjects.some((s) => !!s.checkin || (!s.scheduledOff && !s.noSchedule));
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("en-US", {
        timeZone: BUSINESS_DAY_DEFAULT_TZ, hour: "numeric", minute: "2-digit",
      });
}

export function buildCheckinDigestHtml(date: string, subjects: DigestSubject[]): string {
  const count = (k: DigestStatus) => subjects.filter((s) => digestStatus(s) === k).length;

  const tile = (n: number, label: string, color: string) =>
    `<div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:${color}">${n}</div>`
    + `<div style="font-size:11px;color:#64748b;margin-top:2px">${label}</div></div>`;

  // Late and missing lead — that is the part a manager acts on.
  const attention = subjects.filter((s) => {
    const st = digestStatus(s);
    return st === "late" || st === "missing";
  });
  const attentionRows = attention.map((s) => {
    const late = digestStatus(s) === "late";
    const detail = late
      ? `${s.checkin?.minutes_late ?? 0} min late — in at ${clock(s.checkin?.checked_in_at)}`
      : "No check-in";
    const excused = late && s.checkin?.late_excused
      ? ` <span style="color:#0d9488;font-weight:600">(excused)</span>` : "";
    const repeat = s.lateOverLimit
      ? ` <span style="display:inline-block;background:#fef2f2;color:#b91c1c;font-size:10px;font-weight:700;padding:2px 8px;border-radius:9999px">${s.lateCount} lates / 90d</span>`
      : "";
    return `<tr style="border-top:1px solid #e2e8f0">
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1A2B4A">${esc(s.name)}${s.sub ? `<span style="color:#94a3b8;font-weight:400"> · ${esc(s.sub)}</span>` : ""}</td>
      <td style="padding:10px 12px;font-size:12px;color:#64748b">${esc(s.expectedStart ?? "—")}</td>
      <td style="padding:10px 12px;font-size:12px;color:${late ? "#b45309" : "#b91c1c"};font-weight:600">${detail}${excused}${repeat}</td>
    </tr>`;
  }).join("");

  const named = (list: DigestSubject[]) => list.map((s) => esc(s.name)).join(" · ");
  const onTime = subjects.filter((s) => digestStatus(s) === "on_time");
  const excusedList = subjects.filter((s) => digestStatus(s) === "excused");
  const noSched = subjects.filter((s) => s.noSchedule);

  const onTimeList = onTime.length
    ? `<p style="margin:18px 0 0;font-size:12px;color:#64748b;line-height:1.7"><strong style="color:#16a34a">On time:</strong> ${onTime.map((s) => `${esc(s.name)} (${clock(s.checkin?.checked_in_at)})`).join(" · ")}</p>`
    : "";
  const excusedNote = excusedList.length
    ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b"><strong style="color:#0d9488">Excused:</strong> ${named(excusedList)}</p>`
    : "";
  const noSchedNote = noSched.length
    ? `<p style="margin:8px 0 0;font-size:12px;color:#94a3b8"><strong>No schedule on file</strong> (cannot be judged late): ${named(noSched)}</p>`
    : "";

  return `
    <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#1A2B4A">Check-ins — ${esc(date)}</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:20px;display:flex;gap:18px">
      ${tile(count("on_time"), "On time", "#16a34a")}
      ${tile(count("late"), "Late", "#b45309")}
      ${tile(count("missing"), "No check-in", "#b91c1c")}
      ${tile(count("excused"), "Excused", "#0d9488")}
      ${tile(count("off"), "Off today", "#94a3b8")}
    </div>
    ${attention.length ? `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#f8fafc">
        <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Name</th>
        <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Due</th>
        <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">What happened</th>
      </tr></thead>
      <tbody>${attentionRows}</tbody>
    </table>`
    : `<p style="margin:0;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;color:#166534">Everyone due in today checked in on time.</p>`}
    ${onTimeList}${excusedNote}${noSchedNote}
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;text-align:center">Sent each morning at 10:00 Pacific. Lates can be excused from the Check-Ins board.</p>`;
}
