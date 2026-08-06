// Redaction for anything written into audit_logs.details.
//
// This exists because PATCH /api/loan-officers/:id serialised the raw request
// body into the audit row, which put live Bonzo and lead-mailbox passwords into
// the table in plaintext — 45 rows of them. The same credentials are masked
// everywhere else they surface (maskLoCredentials, the role-gated /credentials
// endpoint), so the audit log had quietly become the way around that control.
//
// Nothing may serialise a request body into an audit row except through here.

/** Same placeholder maskLoCredentials uses: eight U+2022 BULLET characters. */
export const AUDIT_MASK = "••••••••";

const norm = (k: string) => k.toLowerCase().replace(/[_-]/g, "");

/** Masked to the placeholder — presence is still reported, the value never is. */
export const AUDIT_SECRET_KEYS = new Set([
  "bonzopassword", "leadmailboxpassword", "password", "newpassword",
  "currentpassword", "confirmpassword", "temppassword", "passwordhash",
  "resettoken", "resettokenexpiry", "welcometoken", "token", "accesscode",
  "resendapikey", "portalcode", "smtppass", "aiapikey", "ttsapikey",
  "mojosecret", "bonzosecret", "bonzoapitoken", "mojoapikey", "zapiersecret",
  "zapierwebhookurl", "leadvaultreportingtoken", "callsyncsecret",
  "twilioauthtoken", "twilioaccountsid", "sessionsecret", "secret", "apikey",
].map(norm));

/**
 * Dropped entirely rather than masked.
 *
 * Free-form credential bags and binary payloads. There is no useful or safe
 * truncation of an 8MB base64 receipt or a push subscription's key material
 * into an audit row, and express.json accepts bodies up to 10MB.
 */
export const AUDIT_DROP_KEYS = new Set([
  "othercredentials", "database64", "subscription", "keys", "image", "filedata",
  "filebase64", "attachment", "databuffer",
].map(norm));

const MAX_DETAILS = 4000;
const MAX_DEPTH = 4;
const MAX_ARRAY = 25;

/**
 * Serialise a value for audit_logs.details with secrets removed.
 *
 * A set secret becomes the placeholder and an absent one becomes null — the
 * distinction matters, because "a password was changed" and "a password was
 * cleared" are different events and the audit row is the only witness to which.
 */
export function auditDetails(input: unknown): string | null {
  if (input == null) return null;
  const walk = (v: any, depth: number): any => {
    if (v == null || typeof v !== "object" || depth >= MAX_DEPTH) return v;
    if (Array.isArray(v)) return v.slice(0, MAX_ARRAY).map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const n = norm(k);
      if (AUDIT_DROP_KEYS.has(n)) continue;
      if (AUDIT_SECRET_KEYS.has(n)) { out[k] = val ? AUDIT_MASK : null; continue; }
      out[k] = walk(val, depth + 1);
    }
    return out;
  };
  let s: string;
  try { s = JSON.stringify(walk(input, 0)); } catch { return null; }
  if (s == null) return null;
  return s.length > MAX_DETAILS ? s.slice(0, MAX_DETAILS - 3) + "..." : s;
}

/**
 * For settings routes that rotate secrets: record which fields moved, never the
 * values. A before/after diff of a rotated token is as damaging as the token.
 */
export function auditChangedFields(before: any, after: any): string {
  // Array.from, not for-of over the Set — the repo's tsc target predates
  // downlevel iteration and rejects iterating a Set directly.
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changed: string[] = [];
  const wasSet: Record<string, boolean> = {};
  const nowSet: Record<string, boolean> = {};
  for (const k of keys) {
    const b = before?.[k], a = after?.[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    changed.push(k);
    if (AUDIT_SECRET_KEYS.has(norm(k))) { wasSet[k] = !!b; nowSet[k] = !!a; }
  }
  return JSON.stringify({ changed, wasSet, nowSet });
}

/**
 * Whether a stored details string still carries an unmasked secret.
 * Used by the one-time scrub of rows written before redaction existed.
 */
export function detailsHasPlaintextSecret(details: string | null | undefined): boolean {
  if (!details) return false;
  let parsed: any;
  try { parsed = JSON.parse(details); } catch { return false; }
  const scan = (v: any, depth: number): boolean => {
    if (v == null || typeof v !== "object" || depth >= MAX_DEPTH) return false;
    if (Array.isArray(v)) return v.some((x) => scan(x, depth + 1));
    for (const [k, val] of Object.entries(v)) {
      const n = norm(k);
      if (AUDIT_DROP_KEYS.has(n) && val != null) return true;
      // An empty string is an absent credential, not a leaked one.
      if (AUDIT_SECRET_KEYS.has(n) && typeof val === "string" && val !== "" && val !== AUDIT_MASK) return true;
      if (scan(val, depth + 1)) return true;
    }
    return false;
  };
  return scan(parsed, 0);
}
