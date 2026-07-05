// Daily sync of the Shark Tank pool — cold, re-workable mortgage leads pulled
// from LeadVault's token-auth /api/clr/shark-feed. C3 keeps a read-only mirror
// in shark_tank_leads; the feed has already scrubbed opt-outs, responders,
// engaged stages, CA/CO, and the out-of-inquiry-window.
// Configure with CLR_SHARK_FEED_TOKEN (+ optional LEADVAULT_BASE_URL).
import { upsertSharkTankLeads, pruneSharkTankLeads, setSharkTankSyncMeta } from "./storage";

const BASE_URL = (process.env.LEADVAULT_BASE_URL || "https://www.leadvault.cloud").replace(/\/+$/, "");
const FEED_TOKEN = (process.env.CLR_SHARK_FEED_TOKEN || "").trim();
const PAGE_SIZE = 1000;
const MAX_PAGES = 30;
let running = false;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

export function sharkTankSyncConfigured(): boolean {
  return FEED_TOKEN.length > 0;
}

export async function runSharkTankSync(trigger: string = "cron"): Promise<{ ok: boolean; synced: number; pruned: number; error?: string }> {
  if (running) return { ok: false, synced: 0, pruned: 0, error: "already running" };
  if (!FEED_TOKEN) {
    setSharkTankSyncMeta({ status: "skipped_no_token" });
    console.warn("[shark-tank-sync] CLR_SHARK_FEED_TOKEN not set — skipping");
    return { ok: false, synced: 0, pruned: 0, error: "CLR_SHARK_FEED_TOKEN not set" };
  }
  running = true;
  const startedMs = Date.now();
  const runIso = new Date().toISOString();
  try {
    let offset = 0, synced = 0, pages = 0, total = -1;
    for (;;) {
      const url = `${BASE_URL}/api/clr/shark-feed?limit=${PAGE_SIZE}&offset=${offset}`;
      const resp = await fetchWithTimeout(url, { headers: { "x-api-token": FEED_TOKEN, Accept: "application/json" } }, 45_000);
      if (!resp.ok) throw new Error(`feed HTTP ${resp.status}`);
      const data: any = await resp.json();
      const leads = Array.isArray(data.leads) ? data.leads : [];
      if (typeof data.total === "number") total = data.total;
      if (leads.length) {
        const mapped = leads.map((L: any) => ({
          external_id: String(L.externalId),
          borrower_name: L.borrowerName ?? null,
          phone: L.phone ?? null,
          state: L.state ?? null,
          city: L.city ?? null,
          loan_purpose: L.loanPurpose ?? null,
          owner_name: L.ownerName ?? null,
          stage: L.stage ?? null,
          bucket: L.bucket ?? null,
          source_created_at: L.createdAt ?? null,
        }));
        synced += upsertSharkTankLeads(mapped, runIso);
      }
      pages++;
      offset += PAGE_SIZE;
      if (leads.length < PAGE_SIZE || pages >= MAX_PAGES || (total >= 0 && offset >= total)) break;
    }
    const pruned = pruneSharkTankLeads(runIso);
    setSharkTankSyncMeta({ status: "ok", synced, pruned, durationMs: Date.now() - startedMs });
    console.log(`[shark-tank-sync] ${trigger}: synced=${synced} pruned=${pruned} pages=${pages}`);
    return { ok: true, synced, pruned };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 200);
    setSharkTankSyncMeta({ status: "error", error: msg, durationMs: Date.now() - startedMs });
    console.error(`[shark-tank-sync] error: ${msg}`);
    return { ok: false, synced: 0, pruned: 0, error: msg };
  } finally {
    running = false;
  }
}
