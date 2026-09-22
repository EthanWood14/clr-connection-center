/**
 * "What just landed for the LOs I am calling today" — the C3 half.
 *
 * LeadVault holds every lead and knows which Bonzo user owns it. C3 knows who
 * is signed in and which loan officers they were assigned this morning. This
 * module is the join: it takes the addresses of a CLR's LOs, asks LeadVault
 * for the newest lead on each, and caches the answer hard enough that a
 * fifteen-second poll from every CLR on the floor costs LeadVault a couple of
 * requests a minute.
 *
 * Modelled on Shotgun, which is what Ethan asked for (9 Sep 2026): a short
 * poll against a small payload, not a socket and not a push. Shotgun polls
 * every five seconds because a lead offer expires; nothing here expires, so
 * the poll is slower and the cache does the work.
 *
 * ── THE CACHE IS KEYED ON THE SET OF LOAN OFFICERS ────────────────────────
 * Two CLRs assigned the same three LOs share one upstream call. A CLR whose
 * list differs by one name gets their own entry, which is correct and cheap:
 * the key is the sorted addresses, so it is stable across a reordering of the
 * same list and only misses when the list genuinely changes — once a morning,
 * when assignments are generated.
 *
 * ── STALE BEATS NOTHING, AND NEITHER BLOCKS ──────────────────────────────
 * Fresh inside the TTL. Past it, the cached copy is served immediately and a
 * refresh runs behind it, so nobody waits on LeadVault mid-poll. Only a cold
 * cache waits, and only once — concurrent callers share the in-flight promise
 * rather than each opening their own upstream request.
 *
 * ── UNCONFIGURED IS QUIET ────────────────────────────────────────────────
 * No token means the feature is off, not broken: the caller gets
 * `configured: false` and the page says nothing. That is the state on any
 * environment where the shared secret was never set, and it must not fill logs
 * or show an error to a CLR who cannot do anything about it.
 */

import { hasPipelineStage } from "@shared/new-lead-stage";

export type NewestLead = {
  externalId: string;
  bonzoId: string | null;
  borrowerName: string | null;
  phone: string | null;
  state: string | null;
  city: string | null;
  loanPurpose: string | null;
  source: string | null;
  campaign: string | null;
  pipeline: string | null;
  stage: string | null;
  landedAt: string | null;
  bonzoCreatedAt: string | null;
  receivedAt: string | null;
};

export type NewestLeadsByLo = { email: string; name: string | null; leads: NewestLead[] };

/**
 * Fresh enough to serve without asking again.
 *
 * Five seconds, down from twenty (14 Sep 2026: "can we make this faster").
 * Affordable because of the fan-in below: however many CLRs are polling,
 * the floor costs LeadVault one request per TTL — twelve a minute.
 */
export const NEWEST_LEADS_TTL_MS = 5_000;
/** How long an address stays in the floor-wide fan-in set after it was last asked for. */
export const NEWEST_LEADS_FANIN_WINDOW_MS = 15 * 60_000;
/** LeadVault caps one request at forty addresses; past that, callers fall back to their own set. */
export const NEWEST_LEADS_FANIN_MAX = 40;
/** Past this the cached copy is too old to show at all, and a caller waits. */
export const NEWEST_LEADS_STALE_MAX_MS = 10 * 60_000;

/**
 * The cache key for a set of loan officers.
 *
 * Sorted and lowercased, so the same three LOs in a different order are one
 * entry rather than six. Exported for the test that pins that property — a
 * key that varied with order would quietly multiply the upstream traffic by
 * the number of ways a list can be arranged.
 */
export function newestLeadsCacheKey(emails: string[], hours: number, per: number): string {
  const set = Array.from(new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean))).sort();
  return `${hours}|${per}|${set.join(",")}`;
}

/**
 * The addresses to ask about, from whatever the loan-officer rows carry.
 *
 * bonzo_username is the Bonzo LOGIN and is the only field that can be matched
 * upstream — leads are owned by a Bonzo user, and Bonzo display names are not
 * people's names ("Billy" is Bill Neessen). An LO's contact `email` is NOT a
 * fallback: it is frequently a different address, and matching on it would
 * either find nothing or, worse, find somebody else's leads.
 */
export function loEmailsFor(los: Array<Record<string, any>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lo of los ?? []) {
    const raw = String(lo?.bonzoUsername ?? lo?.bonzo_username ?? "").trim().toLowerCase();
    if (!raw || !raw.includes("@") || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/** Rows the upstream payload actually contained, defended against shape drift. */
export function losFromPayload(payload: unknown): NewestLeadsByLo[] {
  const rows = (payload as any)?.los;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r.email === "string")
    .map((r) => ({
      email: String(r.email).toLowerCase(),
      name: r.name ?? null,
      leads: Array.isArray(r.leads) ? (r.leads as NewestLead[]).filter(hasPipelineStage) : [],
    }));
}

type Entry = { at: number; los: NewestLeadsByLo[] };

/** Saved floor cards need current stage evidence from their own LO's feed. */
export function stageQualifiedFloorLeads<T extends { lo_email?: string; external_id: string }>(rows: T[], snapshot: { stale: boolean; los: NewestLeadsByLo[] }): T[] {
  if (snapshot.stale) return [];
  const eligible = new Map(snapshot.los.map(row => [row.email.trim().toLowerCase(), new Set(row.leads.filter(hasPipelineStage).map(lead => String(lead.externalId)))]));
  return rows.filter(row => eligible.get(String(row.lo_email ?? "").trim().toLowerCase())?.has(String(row.external_id)));
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<NewestLeadsByLo[] | null>>();

/** Test seam. The route passes the real token getter. */
export type NewestLeadsDeps = {
  token: () => string;
  baseUrl: () => string;
  now?: () => number;
  /**
   * Called with every successful upstream read — the whole fetched set, not a
   * diff. The route uses it to push "new lead for your LO" notifications, and
   * does its own dedupe, because whether a lead is NEW to a person depends on
   * who they are, not on this cache.
   */
  onFresh?: (los: NewestLeadsByLo[]) => void;
};

/**
 * The floor-wide set the fan-in is currently asking about — every address
 * polled in the last fifteen minutes. The route's ticker refreshes this set
 * on its own clock so a lead is noticed (and pushed) even when every C3 tab
 * on the floor is in the background and the browser has throttled its poll.
 */
export function newestLeadsFanInEmails(now: number = Date.now()): string[] {
  const out: string[] = [];
  for (const [email, at] of Array.from(askedRecently.entries())) {
    if (now - at <= NEWEST_LEADS_FANIN_WINDOW_MS) out.push(email);
  }
  return out.sort();
}

async function fetchUpstream(
  key: string, emails: string[], hours: number, per: number, deps: NewestLeadsDeps,
): Promise<NewestLeadsByLo[] | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const token = deps.token();
  if (!token) return null;
  const base = deps.baseUrl().replace(/\/+$/, "");
  const run = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const url = `${base}/api/clr/newest-leads?emails=${encodeURIComponent(emails.join(","))}&hours=${hours}&per=${per}`;
      const upstream = await fetch(url, {
        // The token travels in the header only, never in the URL — a query
        // string ends up in access logs and in anything that proxies this.
        headers: { "x-api-token": token, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!upstream.ok) return null;
      const json: any = await upstream.json().catch(() => null);
      const los = losFromPayload(json);
      // An empty array is a failed read, not "no loan officers": we asked
      // about a specific list and the contract is that every address comes
      // back, so nothing back means the shape changed.
      if (!los.length) return null;
      cache.set(key, { at: (deps.now ?? Date.now)(), los });
      try { deps.onFresh?.(los); } catch { /* a listener must never break the read */ }
      return los;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}

export type NewestLeadsResult = {
  configured: boolean;
  los: NewestLeadsByLo[];
  /** When the served copy was fetched, so the page can say how old it is. */
  fetchedAt: string | null;
  stale: boolean;
};

/**
 * ── FAN-IN: ONE UPSTREAM CALL FOR THE WHOLE FLOOR ──────────────────────────
 * Every CLR asks about a different handful of loan officers, so a cache keyed
 * on each CLR's own set still cost LeadVault one call per CLR per TTL. The
 * fan-in remembers every address asked for in the last fifteen minutes and,
 * when a caller arrives, asks upstream about the UNION — one request, one
 * cache entry, every CLR served a filtered slice of it. LeadVault caps a
 * request at forty addresses; today's floor is around twenty, and a floor
 * that outgrows the cap simply drops back to the per-set path.
 */
const askedRecently = new Map<string, number>();

function fanInSet(requested: string[], hours: number, per: number, now: number): string[] {
  for (const e of requested) askedRecently.set(e, now);
  const union: string[] = [];
  for (const [email, at] of Array.from(askedRecently.entries())) {
    if (now - at > NEWEST_LEADS_FANIN_WINDOW_MS) { askedRecently.delete(email); continue; }
    union.push(email);
  }
  // per/hours are part of the cache key, so a caller asking for a different
  // burst shape shares the addresses but not the entry; that is fine.
  void hours; void per;
  return union.length <= NEWEST_LEADS_FANIN_MAX ? union.sort() : requested;
}

export async function newestLeadsForLos(
  emails: string[], opts: { hours: number; per: number }, deps: NewestLeadsDeps,
): Promise<NewestLeadsResult> {
  const now = (deps.now ?? Date.now)();
  if (!deps.token()) return { configured: false, los: [], fetchedAt: null, stale: false };
  const requested = Array.from(new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean)));
  if (!requested.length) return { configured: true, los: [], fetchedAt: null, stale: false };
  const set = fanInSet(requested, opts.hours, opts.per, now);
  const result = await newestLeadsForSet(set, opts, deps);
  if (set.length === requested.length) return result;
  const mine = new Set(requested);
  return { ...result, los: result.los.filter((row) => mine.has(row.email)) };
}

async function newestLeadsForSet(
  emails: string[], opts: { hours: number; per: number }, deps: NewestLeadsDeps,
): Promise<NewestLeadsResult> {
  const now = (deps.now ?? Date.now)();
  if (!emails.length) return { configured: true, los: [], fetchedAt: null, stale: false };

  const key = newestLeadsCacheKey(emails, opts.hours, opts.per);
  const hit = cache.get(key);
  const age = hit ? now - hit.at : Infinity;

  if (hit && age < NEWEST_LEADS_TTL_MS) {
    return { configured: true, los: hit.los, fetchedAt: new Date(hit.at).toISOString(), stale: false };
  }
  if (hit && age < NEWEST_LEADS_STALE_MAX_MS) {
    // Serve what we have and refresh behind it. Nobody waits mid-poll.
    void fetchUpstream(key, emails, opts.hours, opts.per, deps).catch(() => {});
    return { configured: true, los: hit.los, fetchedAt: new Date(hit.at).toISOString(), stale: true };
  }
  const fresh = await fetchUpstream(key, emails, opts.hours, opts.per, deps);
  if (fresh) {
    const entry = cache.get(key);
    return { configured: true, los: fresh, fetchedAt: new Date(entry?.at ?? now).toISOString(), stale: false };
  }
  // Nothing usable. Say so rather than showing an empty list that reads as
  // "no new leads" — those are different answers and a CLR would act on them
  // differently.
  if (hit) return { configured: true, los: hit.los, fetchedAt: new Date(hit.at).toISOString(), stale: true };
  return { configured: true, los: [], fetchedAt: null, stale: true };
}

/** Test seam: the module-level cache is process-wide by design. */
export function resetNewestLeadsCache(): void {
  cache.clear();
  inFlight.clear();
  askedRecently.clear();
}
