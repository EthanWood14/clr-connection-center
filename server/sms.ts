import twilio from "twilio";
import { getRawSqlite } from "./storage";

export type TwilioCreds = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

/**
 * Normalize a phone number to E.164 (+1XXXXXXXXXX). Assumes US when 10 digits.
 * Returns null if we can't produce a valid-looking E.164 number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Load Twilio creds for the given org from webhook_settings.
 * Returns null if not configured.
 */
export function getTwilioCreds(_orgId: number): TwilioCreds | null {
  try {
    const row = getRawSqlite()
      .prepare(
        `SELECT twilio_account_sid, twilio_auth_token, twilio_from_number FROM webhook_settings WHERE id=1`
      )
      .get() as any;
    const accountSid = String(row?.twilio_account_sid || "").trim();
    const authToken = String(row?.twilio_auth_token || "").trim();
    const fromNumber = String(row?.twilio_from_number || "").trim();
    if (!accountSid || !authToken || !fromNumber) return null;
    return { accountSid, authToken, fromNumber };
  } catch {
    return null;
  }
}

export function isTwilioConfigured(orgId: number): boolean {
  return getTwilioCreds(orgId) !== null;
}

/**
 * Send an SMS via Twilio. Silently no-ops if Twilio is not configured for the
 * org or if the destination phone number cannot be normalized.
 */
export async function sendSms(
  to: string,
  body: string,
  orgId: number
): Promise<{ ok: boolean; sid?: string; error?: string; skipped?: boolean }> {
  const creds = getTwilioCreds(orgId);
  if (!creds) {
    console.warn(`[sms] Twilio not configured for org=${orgId}; skipping send`);
    return { ok: false, skipped: true, error: "twilio_not_configured" };
  }
  const normalized = normalizePhone(to);
  if (!normalized) {
    console.warn(`[sms] invalid phone number "${to}"; skipping send`);
    return { ok: false, skipped: true, error: "invalid_phone" };
  }
  const fromNormalized = normalizePhone(creds.fromNumber) || creds.fromNumber;
  try {
    const client = twilio(creds.accountSid, creds.authToken);
    const msg = await client.messages.create({
      to: normalized,
      from: fromNormalized,
      body,
    });
    console.log(`[sms] sent to=${normalized} sid=${msg.sid}`);
    return { ok: true, sid: msg.sid };
  } catch (e: any) {
    console.error(`[sms] send failed to=${normalized}:`, e?.message ?? e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}
