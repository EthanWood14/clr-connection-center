// Bonzo CRM client — powers the appointment → Bonzo task/notes sync.
//
// API facts verified LIVE against app.getbonzo.com/api/v3 (2026-07-13):
// - Auth: Bearer token. Stored in webhook_settings.bonzo_api_token (editable on
//   the Integrations page), BONZO_API_TOKEN env as fallback.
// - GET /prospects?search=… matches names/emails/phones in any format; list is
//   newest-first, Laravel-paginated {data, meta}. Only `search` filters.
// - GET /prospects/{id} carries assigned_to (user id) + assigned_user{id,name,email}.
// - POST /tasks {prospect_id, assignee_id, title, details, date:"YYYY-MM-DD",
//   time:"h:mm am", type:"none", frequency:"none", priority, length,
//   remind_before:[5,60], notification_channels:["email"]} → 200 {data:{id}}.
//   (time MUST be "h:i a"; remind_before/notification_channels MUST be arrays.)
// - DELETE /tasks/{id} → 200. POST /prospects/{id}/notes {content} → 201 {data:{id}}.
// - Rate limit 2500/window; requests here are low-volume so no pacing needed.
import { getWebhookSettings } from "./storage";

const BASE = (process.env.BONZO_API_BASE || "https://app.getbonzo.com/api/v3").replace(/\/+$/, "");

function token(): string {
  try {
    const s = getWebhookSettings() as any;
    if (s?.bonzo_api_token) return String(s.bonzo_api_token).trim();
  } catch {}
  return (process.env.BONZO_API_TOKEN || "").trim();
}

export function bonzoConfigured(): boolean {
  return token().length > 0;
}

async function req(method: string, path: string, body?: any): Promise<{ status: number; ok: boolean; json: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let json: any = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, ok: res.ok, json };
  } catch (e: any) {
    return { status: 0, ok: false, json: { error: String(e?.message ?? e) } };
  } finally {
    clearTimeout(t);
  }
}

function phoneDigits(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = String(p).replace(/\D+/g, "");
  if (!d) return null;
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

// Loose person-name match: every word of one name appears in the other
// (handles "Chris Redoble" vs "Chris Redoble Retail (Team Members Only)").
function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: any) => String(s ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
  const wa = norm(a), wb = norm(b);
  if (!wa.length || !wb.length) return false;
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return small.every(w => big.includes(w));
}

export type BonzoProspect = {
  id: number;
  name: string;
  phone: string | null;
  assignedTo: number | null;
  assignedUserName: string | null;
  loMatches: boolean;
};

// Look UP (never create) the prospect for a phone number. When several
// prospects share the phone, prefer the one whose assigned Bonzo user matches
// the LO from the C3 form; otherwise the newest.
export async function findProspectByPhone(phone: string, preferLoName?: string | null): Promise<BonzoProspect | null> {
  const digits = phoneDigits(phone);
  if (!digits || digits.length < 10) return null;
  const list = await req("GET", `/prospects?search=${encodeURIComponent(digits)}&per_page=10`);
  if (!list.ok) return null;
  const candidates = (Array.isArray(list.json?.data) ? list.json.data : [])
    .filter((p: any) => phoneDigits(p.phone) === digits)
    .slice(0, 3);
  if (!candidates.length) return null;

  const detailed: BonzoProspect[] = [];
  for (const c of candidates) {
    const det = await req("GET", `/prospects/${c.id}`);
    const d = det.json?.data ?? det.json;
    if (!det.ok || !d?.id) continue;
    detailed.push({
      id: Number(d.id),
      name: String(d.full_name || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Prospect"),
      phone: d.phone ?? null,
      assignedTo: d.assigned_to != null ? Number(d.assigned_to) : null,
      assignedUserName: d.assigned_user?.name ?? null,
      loMatches: namesMatch(d.assigned_user?.name, preferLoName),
    });
  }
  if (!detailed.length) return null;
  return detailed.find(p => p.loMatches) ?? detailed[0];
}

// "YYYY-MM-DDTHH:MM[..]" wall clock → Bonzo's {date, time("h:mm am")}.
export function wallClockToBonzo(dt: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(dt ?? "").trim());
  if (!m) return null;
  const [, date, hh, mm] = m;
  let h = parseInt(hh, 10);
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return { date, time: `${h}:${mm} ${ap}` };
}

export async function createProspectTask(opts: {
  prospectId: number; assigneeId: number; title: string; details: string;
  date: string; time: string;
}): Promise<{ ok: boolean; id: number | null; error?: string }> {
  const r = await req("POST", "/tasks", {
    prospect_id: opts.prospectId,
    assignee_id: opts.assigneeId,
    title: opts.title.slice(0, 200),
    details: opts.details.slice(0, 1000),
    date: opts.date,
    time: opts.time,
    type: "none",
    frequency: "none",
    priority: 2,
    length: 30,
    remind_before: [5, 60],
    notification_channels: ["email"],
  });
  const id = Number(r.json?.data?.id ?? r.json?.id) || null;
  return r.ok && id
    ? { ok: true, id }
    : { ok: false, id: null, error: `${r.status} ${JSON.stringify(r.json).slice(0, 200)}` };
}

export async function deleteTask(taskId: number): Promise<boolean> {
  const r = await req("DELETE", `/tasks/${taskId}`);
  return r.ok;
}

export async function addProspectNote(prospectId: number, content: string): Promise<{ ok: boolean; id: number | null; error?: string }> {
  const r = await req("POST", `/prospects/${prospectId}/notes`, { content: content.slice(0, 2000) });
  const id = Number(r.json?.data?.id ?? r.json?.id) || null;
  return r.ok ? { ok: true, id } : { ok: false, id: null, error: `${r.status} ${JSON.stringify(r.json).slice(0, 200)}` };
}

export async function deleteProspectNote(prospectId: number, noteId: number): Promise<boolean> {
  const r = await req("DELETE", `/prospects/${prospectId}/notes/${noteId}`);
  return r.ok;
}

// Re-fetch just the assigned user of a known prospect (used when moving a
// task after a reschedule).
export async function getProspectAssignee(prospectId: number): Promise<number | null> {
  const r = await req("GET", `/prospects/${prospectId}`);
  const d = r.json?.data ?? r.json;
  return r.ok && d?.assigned_to != null ? Number(d.assigned_to) : null;
}
