/**
 * Always-on poll: Chris Redoble Retail pool-seat leads → Shotgun immediately.
 *
 * Wired from server/index.ts (not routes.ts) so it does not depend on today's
 * CLR assignments. The existing Shotgun timer assigns anything left `queued`.
 */
import { loNewLeadIsFresh } from "@shared/lo-new-leads";
import {
  RETAIL_DESK_BONZO_EMAIL,
  isRetailDeskShotgunLead,
} from "@shared/retail-bonzo-shotgun";
import { normalizeStateCode } from "./shotgun-bonzo";
import { newestLeadsForLos, type NewestLeadsByLo } from "./leadvault-newest-leads";
import * as storage from "./storage";
import * as storageExtra from "./storage";
import { getWebhookSettings } from "./storage";
import { runWithOrg } from "./orgContext";

const POLL_MS = 5_000;
const POLL_HOURS = 72;
const POLL_PER = 5;

const US_STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

function leadvaultReportingToken(): string {
  try {
    const s = getWebhookSettings() as any;
    if (s?.leadvault_reporting_token) return String(s.leadvault_reporting_token).trim();
  } catch {}
  return (process.env.LEADVAULT_REPORTING_TOKEN || "").trim();
}

function shotgunPhoneKey(value: string): string {
  const d = String(value ?? "").replace(/\D+/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

function shotgunEmailKey(value: string): string {
  return value.trim().toLowerCase();
}

/** Insert a queued Shotgun lead; the 1s rotation timer offers it to Ready CLRs. */
function insertQueuedShotgunLead(orgId: number, publisherId: number, raw: {
  leadName: string; phone: string; email: string; stateCode: string; source: string; managerNotes: string;
}): { ok: true; leadId: number } | { ok: false; error: string } {
  const db = storageExtra.getRawSqlite();
  const leadName = String(raw.leadName ?? "").trim().slice(0, 140);
  const phone = String(raw.phone ?? "").trim().slice(0, 40);
  const email = String(raw.email ?? "").trim().slice(0, 200);
  const phoneKey = shotgunPhoneKey(phone);
  const emailKey = shotgunEmailKey(email);
  const stateCode = String(raw.stateCode ?? "").trim().toUpperCase();
  const source = String(raw.source ?? "").trim().slice(0, 120);
  const managerNotes = String(raw.managerNotes ?? "").trim().slice(0, 3000);
  if (leadName.length < 2) return { ok: false, error: "Enter the lead's name." };
  if (!phone && !email) return { ok: false, error: "Enter a phone number or email address." };
  if (phone && (phoneKey.length < 10 || phoneKey.length > 15)) return { ok: false, error: "Enter a valid phone number with 10 to 15 digits." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailKey)) return { ok: false, error: "Enter a valid email address." };
  if (phone && !stateCode) return { ok: false, error: "Select the lead's state so the CLR can check calling hours." };
  if (stateCode && !US_STATE_CODES.has(stateCode)) return { ok: false, error: "Select a valid U.S. state." };
  const now = new Date().toISOString();
  const active = db.prepare(`SELECT id,lead_name,phone,email,phone_key,email_key FROM shotgun_leads
    WHERE org_id=? AND status IN ('queued','offered','claimed')`).all(orgId) as any[];
  const duplicate = active.find((lead) =>
    (phoneKey && (String(lead.phone_key ?? "") || shotgunPhoneKey(String(lead.phone ?? ""))) === phoneKey)
    || (emailKey && (String(lead.email_key ?? "") || shotgunEmailKey(String(lead.email ?? ""))) === emailKey));
  if (duplicate) return { ok: false, error: `${String(duplicate.lead_name)} is already active in Shotgun (lead #${Number(duplicate.id)}).` };
  try {
    const info = db.prepare(`INSERT INTO shotgun_leads
      (org_id,lead_name,phone,phone_key,email,email_key,state_code,source,manager_notes,status,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(
      orgId, leadName, phone, phoneKey || null, email, emailKey || null, stateCode, source, managerNotes, publisherId, now, now,
    );
    return { ok: true, leadId: Number(info.lastInsertRowid) };
  } catch (error: any) {
    if (String(error?.code ?? "").includes("CONSTRAINT") || /unique/i.test(String(error?.message ?? ""))) {
      return { ok: false, error: "This phone number or email is already active in Shotgun." };
    }
    throw error;
  }
}

export function publishRetailDeskShotgunLeads(orgId: number, los: NewestLeadsByLo[]): void {
  const now = Date.now();
  const publisher = (storage.getUsers() as any[]).find(
    (u) => u.role === "admin" && (u.isActive ?? u.is_active) && (u.portal == null || u.portal === "c3"),
  );
  if (!publisher) {
    console.error("[retail-bonzo] no active admin to publish Shotgun under");
    return;
  }
  for (const row of los) {
    for (const lead of row.leads) {
      if (!lead.externalId || !loNewLeadIsFresh(lead.landedAt, now)) continue;
      if (!isRetailDeskShotgunLead(row.email, row.name)) continue;
      const { inserted, row: recorded } = storageExtra.recordLoNewLead({
        orgId,
        externalId: String(lead.externalId),
        loId: null,
        loEmail: String(row.email).toLowerCase(),
        loName: row.name || "Chris Redoble Retail",
        borrowerName: lead.borrowerName ?? null,
        phone: lead.phone ?? null,
        email: null,
        state: lead.state ?? null,
        source: lead.source ?? null,
        landedAt: lead.landedAt ?? null,
        assignedUserIds: [],
      });
      if (!inserted || !recorded) continue;
      if (!storageExtra.takeLoNewLeadForEscalation(Number(recorded.id))) {
        console.log(`[retail-bonzo] ${lead.externalId} skipped — already taken`);
        continue;
      }
      const stateCode = normalizeStateCode(lead.state || "");
      const pipeline = String(lead.pipeline || "").trim();
      const landed = lead.landedAt
        ? new Date(lead.landedAt).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })
        : "just now";
      const result = insertQueuedShotgunLead(orgId, Number(publisher.id), {
        leadName: lead.borrowerName || "New retail lead",
        phone: lead.phone || "",
        email: "",
        stateCode,
        source: lead.source ? `Chris Redoble Retail — ${lead.source}` : "Chris Redoble Retail",
        managerNotes: `New Chris Redoble Retail lead at ${landed}${pipeline ? ` (${pipeline})` : ""}. Pool seat — published to Shotgun immediately.`,
      });
      storageExtra.finishLoNewLeadEscalation(
        Number(recorded.id),
        result.ok ? result.leadId : null,
        result.ok ? null : result.error,
      );
      console.log(`[retail-bonzo] ${lead.externalId} ${result.ok ? `→ Shotgun #${result.leadId}` : `NOT published: ${result.error}`}`);
    }
  }
}

async function tick(): Promise<void> {
  const token = leadvaultReportingToken();
  if (!token) return;
  const orgs = (storageExtra.getRawSqlite().prepare(`SELECT DISTINCT org_id FROM users WHERE is_active=1`).all() as any[])
    .map((r) => Number(r.org_id)).filter(Number.isFinite);
  for (const orgId of orgs) {
    await runWithOrg({ orgId, superAdmin: false }, async () => {
      const result = await newestLeadsForLos(
        [RETAIL_DESK_BONZO_EMAIL],
        { hours: POLL_HOURS, per: POLL_PER },
        {
          token: leadvaultReportingToken,
          baseUrl: () => process.env.LEADVAULT_BASE_URL || "https://www.leadvault.cloud",
          onFresh: (los) => {
            try { publishRetailDeskShotgunLeads(orgId, los); }
            catch (e: any) { console.error("[retail-bonzo] publish failed:", e?.message ?? e); }
          },
        },
      );
      // Cold/stale path still surfaces rows — publish from the served copy too.
      if (result.los?.length) {
        try { publishRetailDeskShotgunLeads(orgId, result.los); }
        catch (e: any) { console.error("[retail-bonzo] publish failed:", e?.message ?? e); }
      }
    });
  }
}

/** Start the five-second Retail desk → Shotgun watcher. Safe to call once at boot. */
export function startRetailBonzoShotgunWatcher(): void {
  const timer = setInterval(() => {
    void tick().catch((e: any) => console.error("[retail-bonzo] watcher failed:", e?.message ?? e));
  }, POLL_MS);
  timer.unref?.();
  // First pass soon after boot so a deploy does not wait a full interval.
  setTimeout(() => { void tick().catch(() => {}); }, 8_000).unref?.();
  console.log("[retail-bonzo] Shotgun watcher started (Chris Redoble Retail pool seat)");
}
