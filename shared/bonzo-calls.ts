/**
 * Calls placed from inside Bonzo, as seen by the C3 Shotgun extension.
 *
 * Not every call goes through Dialpad: Bonzo places some itself, and those
 * never reach LeadVault's Dialpad feed. The extension already watches Bonzo's
 * own API traffic (that is how it knows which prospect is on screen), so it
 * also reports the requests that look like a call being placed, plus clicks
 * on Bonzo's call controls. C3 records them against the signed-in CLR —
 * which is the whole point: WHO is calling on Bonzo.
 *
 * Two patterns, both on the request PATH (no host, no query):
 *   - BONZO_CALL_PATH: the strict shape that COUNTS (a non-GET to /call,
 *     /calls, /dial, /dialer).
 *   - BONZO_CALL_CANDIDATE: the wide net that is only RECORDED, so the exact
 *     shape Bonzo uses can be pinned from real traffic (Integrations → Bonzo
 *     calls) instead of guessed. Candidates never count.
 * The regex SOURCES are plain strings because the extension's page-hook.js
 * embeds the same two literally (it cannot import this file); a test keeps
 * them identical.
 *
 * One call = one (CLR, prospect, minute). A click on "Call" and the request
 * it fires arrive as two events; the dedup folds them into one.
 */
export const BONZO_CALL_PATH_SOURCE = "/(?:calls?|dial(?:er)?)(?:/|$)";
export const BONZO_CALL_CANDIDATE_SOURCE = "(?:^|[/_-])(?:calls?|dial(?:er)?|voice|phone|twilio|telephony)(?:[/_?.-]|$)";

export const BONZO_CALL_PATH_RE = new RegExp(BONZO_CALL_PATH_SOURCE, "i");
export const BONZO_CALL_CANDIDATE_RE = new RegExp(BONZO_CALL_CANDIDATE_SOURCE, "i");

export type BonzoCallKind = "network" | "click";
export const BONZO_CALL_KINDS: readonly BonzoCallKind[] = ["network", "click"];

/** Whether an event counts as a call, is kept only for pattern discovery, or is noise. */
export function classifyBonzoCallEvent(kind: string, path: string, method: string): "call" | "candidate" | null {
  const p = String(path ?? "");
  if (kind === "click") return "call";
  if (kind !== "network") return null;
  const m = String(method ?? "GET").toUpperCase();
  if (m !== "GET" && BONZO_CALL_PATH_RE.test(p)) return "call";
  if (BONZO_CALL_CANDIDATE_RE.test(p)) return "candidate";
  return null;
}

/** Strip a URL down to what the patterns look at: the path only. */
export function bonzoRequestPath(url: string, origin = "https://platform.getbonzo.com"): string {
  try { return new URL(String(url ?? ""), origin).pathname; } catch { return String(url ?? "").split("?")[0]; }
}

/** Per CLR per business day, deduped to one call per prospect per minute. Columns: org_id, assistant_id, d, calls. */
export const BONZO_CALLS_BY_DAY_SQL = `(
  SELECT org_id, user_id AS assistant_id, business_date AS d, COUNT(*) AS calls
    FROM (SELECT DISTINCT org_id, user_id, business_date, prospect_id, substr(occurred_at, 1, 16) AS minute
            FROM bonzo_call_events WHERE counts = 1)
   GROUP BY org_id, user_id, business_date
)`;

export const BONZO_CALL_EVENT_BATCH_MAX = 50;
