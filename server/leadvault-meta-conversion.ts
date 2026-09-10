/**
 * Meta lead -> transfer conversion, read from LeadVault.
 *
 * Two unrelated Meta pipes feed the Retail desk and they convert differently:
 *
 *   established_meta   - tagged `meta` in Bonzo, running since Jan 2024.
 *   desync_retail_meta - the Google-Sheet importer path, live since Jul 2026,
 *                        landing in the `Retail Intake | Meta` pipeline.
 *
 * LeadVault owns both halves (the leads and its mirror of C3's transfers), so
 * it does the whole calculation and we just cache the answer. See
 * server/dialer/meta-conversion.ts over there for why the two flows are kept
 * disjoint and why the transfer join is date-guarded.
 *
 * Shaped after server/leadvault-newest-leads.ts — module-level TTL cache,
 * stale-while-revalidate, in-flight dedupe, a `deps` seam for tests — with ONE
 * deliberate difference: newest-leads treats an empty payload as a failed read
 * (`if (!los.length) return null`). That rule is wrong here. A flow that
 * genuinely received zero leads is a real and interesting answer — a Meta pipe
 * going silent is exactly the thing this card exists to surface — so emptiness
 * is only a failure when the `flows` array itself is missing.
 */

/** Windows LeadVault accepts. Anything else it clamps to 28. */
export const META_CONVERSION_WINDOWS = [7, 14, 28, 30, 90] as const;
export const META_CONVERSION_DEFAULT_DAYS = 28;

/** Conversion moves slowly and the upstream mirror only refreshes every ~6h,
 *  so a short TTL would buy nothing but load. */
export const META_CONVERSION_TTL_MS = 30 * 60_000;
/** Past this, stop serving the stale copy and admit we have nothing. */
export const META_CONVERSION_STALE_MAX_MS = 12 * 60 * 60_000;
/**
 * How often a person may force a re-read past the TTL.
 *
 * The Refresh button exists because a thirty-minute cache is the wrong answer
 * when somebody has just changed something in Bonzo and wants to see it land
 * (owner 10 Sep 2026). It is not a reason to let a held-down button hammer
 * LeadVault: one forced read per window per minute, and everyone else in that
 * minute gets the copy it just fetched.
 */
export const META_CONVERSION_MIN_FORCE_MS = 60_000;

export type MetaConversionFlow = {
  flow: string;
  label: string;
  leads: number;
  transferred: number;
  rate: number;
};

export type MetaConversionResult = {
  configured: boolean;
  days: number;
  flows: MetaConversionFlow[];
  /** When the served copy was fetched, so the card can say how old it is. */
  fetchedAt: string | null;
  stale: boolean;
  /**
   * A forced refresh that was refused for coming too soon. The answer is
   * still correct — it is just the same answer — and the card says so rather
   * than flashing a spinner over an unchanged number, which reads as broken.
   */
  throttled?: boolean;
  /**
   * A forced refresh that was attempted and failed upstream. Distinct from
   * `stale`: the copy being served may be well inside its TTL and perfectly
   * good, and saying it is stale would be a lie. What went wrong is the
   * REFRESH, and that is what the person who pressed the button needs told.
   */
  refreshFailed?: boolean;
};

const FLOW_LABELS: Record<string, string> = {
  established_meta: "Meta (established)",
  desync_retail_meta: "Meta via Retail Intake",
};

export function parseMetaConversionDays(raw: unknown): number {
  const n = Number(raw);
  return (META_CONVERSION_WINDOWS as readonly number[]).includes(n)
    ? n
    : META_CONVERSION_DEFAULT_DAYS;
}

export function flowsFromPayload(json: any): MetaConversionFlow[] | null {
  // Missing/!array => the shape changed or the read failed. An EMPTY array is
  // still a failure (LeadVault always emits a row per flow), but a flow with
  // zero leads inside it is not.
  if (!json || !Array.isArray(json.flows) || json.flows.length === 0) return null;
  const out: MetaConversionFlow[] = [];
  for (const r of json.flows) {
    const flow = typeof r?.flow === "string" ? r.flow : "";
    if (!flow) continue;
    const leads = Number(r?.leads);
    const transferred = Number(r?.transferred);
    if (!Number.isFinite(leads) || !Number.isFinite(transferred)) continue;
    const rate = Number.isFinite(Number(r?.rate))
      ? Number(r.rate)
      : leads > 0
        ? Math.round((transferred / leads) * 1000) / 10
        : 0;
    out.push({ flow, label: FLOW_LABELS[flow] ?? flow, leads, transferred, rate });
  }
  return out.length ? out : null;
}

type Entry = { at: number; flows: MetaConversionFlow[] };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<MetaConversionFlow[] | null>>();
/** When each window was last force-refreshed by a person. */
const lastForced = new Map<string, number>();

/** Test seam. The route passes the real token getter. */
export type MetaConversionDeps = {
  token: () => string;
  baseUrl: () => string;
  now?: () => number;
};

async function fetchUpstream(
  days: number,
  deps: MetaConversionDeps,
): Promise<MetaConversionFlow[] | null> {
  const key = String(days);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const token = deps.token();
  if (!token) return null;
  const base = deps.baseUrl().replace(/\/+$/, "");
  const run = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const url = `${base}/api/clr/meta-conversion?days=${days}`;
      const upstream = await fetch(url, {
        // The token travels in the header only, never in the URL — a query
        // string ends up in access logs and in anything that proxies this.
        headers: { "x-api-token": token, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!upstream.ok) return null;
      const json: any = await upstream.json().catch(() => null);
      const flows = flowsFromPayload(json);
      if (!flows) return null;
      cache.set(key, { at: (deps.now ?? Date.now)(), flows });
      return flows;
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

export async function metaConversion(
  rawDays: unknown,
  deps: MetaConversionDeps,
  opts: { force?: boolean } = {},
): Promise<MetaConversionResult> {
  const days = parseMetaConversionDays(rawDays);
  const now = (deps.now ?? Date.now)();
  // No token is "feature off", not "broken" — the card renders nothing.
  if (!deps.token()) {
    return { configured: false, days, flows: [], fetchedAt: null, stale: false };
  }

  const key = String(days);
  const hit = cache.get(key);
  const age = hit ? now - hit.at : Infinity;
  let refreshFailed = false;

  // Somebody pressed Refresh. Go upstream regardless of the TTL, unless the
  // last forced read was under a minute ago — in which case the honest answer
  // is "this IS the fresh copy", not another round trip.
  if (opts.force) {
    const sinceForced = now - (lastForced.get(key) ?? -Infinity);
    if (sinceForced >= META_CONVERSION_MIN_FORCE_MS) {
      lastForced.set(key, now);
      const forced = await fetchUpstream(days, deps);
      if (forced) {
        const entry = cache.get(key);
        return { configured: true, days, flows: forced, fetchedAt: new Date(entry?.at ?? now).toISOString(), stale: false };
      }
      // The forced read failed. Fall through to the normal path — a cached
      // copy is better than nothing — but remember that the refresh itself
      // did not happen, so the button can say so.
      refreshFailed = true;
    } else if (hit) {
      return { configured: true, days, flows: hit.flows, fetchedAt: new Date(hit.at).toISOString(), stale: false, throttled: true };
    }
  }

  if (hit && age < META_CONVERSION_TTL_MS) {
    return { configured: true, days, flows: hit.flows, fetchedAt: new Date(hit.at).toISOString(), stale: false, refreshFailed };
  }
  if (hit && age < META_CONVERSION_STALE_MAX_MS) {
    // Serve what we have and refresh behind it. Nobody waits on the dashboard.
    void fetchUpstream(days, deps).catch(() => {});
    return { configured: true, days, flows: hit.flows, fetchedAt: new Date(hit.at).toISOString(), stale: true, refreshFailed };
  }
  const fresh = await fetchUpstream(days, deps);
  if (fresh) {
    const entry = cache.get(key);
    return { configured: true, days, flows: fresh, fetchedAt: new Date(entry?.at ?? now).toISOString(), stale: false };
  }
  // Nothing usable. `stale: true` with no rows is how the card knows to say
  // "couldn't reach LeadVault" rather than drawing a chart of zeroes, which
  // would read as "Meta stopped converting".
  if (hit) return { configured: true, days, flows: hit.flows, fetchedAt: new Date(hit.at).toISOString(), stale: true, refreshFailed };
  return { configured: true, days, flows: [], fetchedAt: null, stale: true, refreshFailed };
}

/** Test seam: the module-level cache is process-wide by design. */
export function resetMetaConversionCache(): void {
  cache.clear();
  inFlight.clear();
  lastForced.clear();
}
