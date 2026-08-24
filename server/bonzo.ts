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

// The ORG-level token (an RSU/manager seat). Cross-TEAM reassignment goes
// through POST /prospects/{id}/reassign, and that call runs under this token;
// everything else stays on the standard token. Falls back to the standard
// token when no org token is stored.
function orgToken(): string {
  try {
    const s = getWebhookSettings() as any;
    if (s?.bonzo_org_token) return String(s.bonzo_org_token).trim();
  } catch {}
  return token();
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
  assignedUserEmail: string | null;
  loMatches: boolean;
  /** How this prospect was chosen, for notes and logs. */
  matchedBy: "email" | "name" | "only-candidate" | "newest";
};

/**
 * Who the C3 form says the lead is going to.
 *
 * Both identity fields are tried because neither is populated for everyone:
 * of 22 active LOs, 9 have a bonzo_username and 9 more only have an email.
 * bonzo_username wins where it exists — Chris Redoble's Bonzo seat is
 * credoble+1@…, which is not his contact email.
 */
export type PreferredLo =
  | { loName?: string | null; bonzoUsername?: string | null; email?: string | null }
  | string | null | undefined;

export type ProspectMatch = {
  prospect: BonzoProspect | null;
  /** Everyone sharing the phone, newest first — for logging an ambiguous miss. */
  candidates: Array<{ id: number; name: string; assignedUserName: string | null; assignedUserEmail: string | null }>;
  /** Why `prospect` is null: nothing on that phone, or nothing that is this LO's. */
  reason: "none" | "ambiguous" | null;
};

// Look UP (never create) the prospect for a phone number.
//
// Several prospects routinely share a phone — the same borrower sits in more
// than one loan officer's book. Picking the wrong one writes a client's
// appointment into a stranger's CRM, so identity beats resemblance:
//
//   1. the assigned Bonzo user's EMAIL equals the LO's stored bonzo_username.
//      This is exact. Display names are not: Bill Neessen's Bonzo account is
//      literally called "Billy", which namesMatch could never match against
//      "Bill Neessen" — so a real transfer fell through to whatever prospect
//      Bonzo happened to return first and landed in another LO's account.
//   2. failing that, the loose display-name match.
//   3. failing that, DO NOT GUESS. When the CLR named an LO and none of the
//      candidates belong to them, return ambiguous rather than writing to
//      someone else's record. A single candidate is not a guess, so it still
//      goes through (with loMatches false, which the caller warns about).
export async function findProspectByPhone(phone: string, prefer?: PreferredLo): Promise<ProspectMatch> {
  const empty: ProspectMatch = { prospect: null, candidates: [], reason: "none" };
  const digits = phoneDigits(phone);
  if (!digits || digits.length < 10) return empty;
  const list = await req("GET", `/prospects?search=${encodeURIComponent(digits)}&per_page=10`);
  if (!list.ok) return empty;
  // No slice: the right record is not always in the first three. Bounded by
  // per_page above, so this is at most ten detail reads.
  const candidates = (Array.isArray(list.json?.data) ? list.json.data : [])
    .filter((p: any) => phoneDigits(p.phone) === digits);
  if (!candidates.length) return empty;

  const wanted = typeof prefer === "string" ? { loName: prefer, bonzoUsername: null, email: null } : (prefer ?? {});
  const wantEmails = [wanted.bonzoUsername, wanted.email]
    .map((e) => String(e ?? "").trim().toLowerCase())
    .filter(Boolean);
  const wantName = wanted.loName ?? null;

  const detailed: Array<BonzoProspect & { createdAt: string }> = [];
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
      assignedUserEmail: d.assigned_user?.email ?? null,
      loMatches: false,
      matchedBy: "newest",
      createdAt: String(d.created_at ?? ""),
    });
  }
  if (!detailed.length) return empty;
  // The old comment promised "otherwise the newest" but nothing ever sorted, so
  // the fallback was really "whatever Bonzo listed first".
  detailed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const summary = detailed.map((p) => ({
    id: p.id, name: p.name, assignedUserName: p.assignedUserName, assignedUserEmail: p.assignedUserEmail,
  }));
  const pick = (p: typeof detailed[number], how: BonzoProspect["matchedBy"], matched: boolean): ProspectMatch => {
    const { createdAt, ...rest } = p;
    return { prospect: { ...rest, loMatches: matched, matchedBy: how }, candidates: summary, reason: null };
  };

  // bonzo_username first, then the LO's email — in that order, deliberately.
  for (const want of wantEmails) {
    const byEmail = detailed.find((p) => String(p.assignedUserEmail ?? "").trim().toLowerCase() === want);
    if (byEmail) return pick(byEmail, "email", true);
  }
  if (wantName) {
    const byName = detailed.find((p) => namesMatch(p.assignedUserName, wantName));
    if (byName) return pick(byName, "name", true);
  }
  if (!wantEmails.length && !wantName) return pick(detailed[0], "newest", false);
  if (detailed.length === 1) return pick(detailed[0], "only-candidate", false);
  return { prospect: null, candidates: summary, reason: "ambiguous" };
}

// "YYYY-MM-DDTHH:MM[..]" wall clock → Bonzo's {date, time}. Bonzo validates
// time as Laravel "h:i a" — 12-hour WITH a leading zero ("09:00 am"; a bare
// "9:00 am" is rejected with a 422 — caught by the live pressure test).
export function wallClockToBonzo(dt: string): { date: string; time: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(String(dt ?? "").trim());
  if (!m) return null;
  const [, date, hh, mm] = m;
  let h = parseInt(hh, 10);
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return { date, time: `${String(h).padStart(2, "0")}:${mm} ${ap}` };
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
  // Bonzo renders notes as HTML, so a blind .slice() can cut mid-tag and leave
  // the note visibly broken. Trim on a paragraph boundary when it looks like
  // markup; fall back to a plain cut for prose.
  let body = content;
  if (body.length > 2000) {
    const cut = body.lastIndexOf("</p>", 2000);
    body = cut > 0 ? body.slice(0, cut + 4) : body.slice(0, 2000);
  }
  const r = await req("POST", `/prospects/${prospectId}/notes`, { content: body });
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

// Names + current tags — what the transfer sync needs before renaming/tagging.
export async function getProspectSnapshot(prospectId: number): Promise<{
  firstName: string; lastName: string; tags: string[];
  pipelineId: number | null; stageId: number | null; stageName: string | null;
  assignedTo: number | null; assignedUserName: string | null; assignedUserEmail: string | null;
} | null> {
  const r = await req("GET", `/prospects/${prospectId}`);
  const d = r.json?.data ?? r.json;
  if (!r.ok || !d?.id) return null;
  return {
    firstName: String(d.first_name ?? ""),
    lastName: String(d.last_name ?? ""),
    tags: (Array.isArray(d.tags) ? d.tags : []).map((t: any) => String(t?.name ?? t)).filter(Boolean),
    // Stage is writable ONLY via moveProspectStage below — never via PUT.
    pipelineId: d.pipeline?.id != null ? Number(d.pipeline.id) : (d.pipeline_id != null ? Number(d.pipeline_id) : null),
    stageId: d.pipeline_stage?.id != null ? Number(d.pipeline_stage.id) : null,
    stageName: d.pipeline_stage?.name != null ? String(d.pipeline_stage.name) : null,
    assignedTo: d.assigned_to != null ? Number(d.assigned_to) : null,
    assignedUserName: d.assigned_user?.name != null ? String(d.assigned_user.name) : null,
    assignedUserEmail: d.assigned_user?.email != null ? String(d.assigned_user.email) : null,
  };
}

// Reassign a prospect to another Bonzo user.
//
// Two mechanisms, verified live 2026-08-14:
// - Same team: PUT /prospects/{id} { assigned_to } works.
// - Cross TEAM: that PUT 422s ("This person doesn't belong to your team")
//   regardless of token — including the org token. The real route is
//   POST /prospects/{id}/reassign { user_email }, run under the org token — it
//   moves the prospect's business entity along with the assignee (which also
//   resets its pipeline, so a stage move must come after).
// Every path is read-back verified; 200s from this API do not prove anything.
export async function reassignProspect(
  prospectId: number,
  bonzoUserId: number,
  userEmail?: string | null,
): Promise<{ ok: boolean; verified: boolean; via: "assigned_to" | "reassign_email" | "none"; error?: string }> {
  const r = await req("PUT", `/prospects/${prospectId}`, { assigned_to: bonzoUserId });
  if (r.ok) {
    const now = await getProspectAssignee(prospectId);
    if (now === bonzoUserId) return { ok: true, verified: true, via: "assigned_to" };
  }
  const firstError = `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`;
  if (!userEmail) {
    return { ok: r.ok, verified: false, via: r.ok ? "assigned_to" : "none", error: firstError };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${BASE}/prospects/${prospectId}/reassign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orgToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_email: userEmail }),
      signal: ctrl.signal,
    });
    let json: any = null;
    try { json = await res.json(); } catch {}
    if (!res.ok) return { ok: false, verified: false, via: "reassign_email", error: `${res.status} ${JSON.stringify(json).slice(0, 160)}` };
    const now = await getProspectAssignee(prospectId);
    return { ok: true, verified: now === bonzoUserId, via: "reassign_email" };
  } catch (e: any) {
    return { ok: false, verified: false, via: "reassign_email", error: String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

// The prospect's note feed — used to avoid double-posting transfer notes when a
// CLR has already pasted the same text by hand.
export async function getProspectNotes(prospectId: number): Promise<{ id: number; content: string }[]> {
  const r = await req("GET", `/prospects/${prospectId}/notes`);
  const list = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : [];
  return list.map((n: any) => ({ id: Number(n?.id), content: String(n?.content ?? "") })).filter((n: any) => Number.isFinite(n.id));
}

// Move a prospect into a pipeline stage.
//
// POST /prospects/{id}/pipeline-stage/{stageId} — the one route the 2026-07-21
// probe never tried. BrokerBot moves stages with exactly this call in
// production, and its hard-won rule ships with it: a 2xx does NOT prove the
// move landed, so always read the stage back. Moving a prospect that is in no
// pipeline places it into the stage's pipeline.
export async function moveProspectStage(prospectId: number, stageId: number): Promise<{ ok: boolean; verified: boolean; error?: string }> {
  const r = await req("POST", `/prospects/${prospectId}/pipeline-stage/${stageId}`, {});
  if (!r.ok) return { ok: false, verified: false, error: `${r.status} ${JSON.stringify(r.json).slice(0, 200)}` };
  const snap = await getProspectSnapshot(prospectId);
  return { ok: true, verified: snap?.stageId === Number(stageId) };
}

// The ordered stage list for a pipeline, or [] when the token can't see it
// (pipelines are per-seat: an org token only sees its own LOs' pipelines).
// ⚠️ /pipelines is PAGINATED and the default page is 25. The account has 402
// pipelines (17 default pages) as of 2026-08-14 — reading only page one hid 94%
// of them, so stage resolution found nothing and every transfer on a pipeline
// outside that first page silently fell back to the automation tag. Page through
// at per_page=100 and stop as soon as the pipeline is found.
export async function getPipelineStages(pipelineId: number): Promise<{ id: number; name: string; order: number }[]> {
  const want = Number(pipelineId);
  for (let page = 1; page <= 25; page++) {
    const r = await req("GET", `/pipelines?per_page=100&page=${page}`);
    const list = Array.isArray(r.json?.data) ? r.json.data : [];
    const p = list.find((x: any) => Number(x?.id) === want);
    if (p) {
      const stages = Array.isArray(p.stages) ? p.stages : [];
      return stages
        .map((s: any) => ({ id: Number(s.id), name: String(s.name ?? ""), order: Number(s.order ?? 0) }))
        .sort((a: any, b: any) => a.order - b.order);
    }
    const lastPage = Number(r.json?.meta?.last_page ?? 1);
    if (!r.ok || !list.length || page >= lastPage) break;
  }
  return [];
}

// PUT /prospects/{id} — partial update with FLAT keys (PATCH is rejected).
// ⚠️ `tags` REPLACES the prospect's whole tag set (verified live) — callers
// must merge with the existing tags, never send just the new one.
// ⚠️ The pipeline STAGE cannot be written here. Re-verified live 2026-07-21
// across 15 endpoint/param variants: PUT returns 200 and echoes the OLD stage
// back for pipeline_stage_id / stage_id / stage / pipelineStageId /
// pipeline_stage{} / pipeline_stage_name; PATCH /prospects/{id} is 405; and
// /prospects/{id}/stage, /move-stage, /pipeline, plus every
// /pipelines/{id}/stages/... move route, are 404. The one route that DOES work
// is POST /prospects/{id}/pipeline-stage/{stageId} — use moveProspectStage.
export async function updateProspect(prospectId: number, payload: Record<string, any>): Promise<{ ok: boolean; error?: string }> {
  const r = await req("PUT", `/prospects/${prospectId}`, payload);
  return r.ok ? { ok: true } : { ok: false, error: `${r.status} ${JSON.stringify(r.json).slice(0, 200)}` };
}
