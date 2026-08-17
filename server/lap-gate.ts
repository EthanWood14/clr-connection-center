// LAP shared-access gate.
//
// LAP is entered with one shared password instead of individual logins. That
// deliberately trades per-person identity for convenience, so the gate issues
// every browser a durable DEVICE id and stamps it on everything that browser
// does. The audit trail then names a device ("LAP device · Kitchen iPad")
// rather than a person — which is the only attribution a shared credential can
// honestly provide.
//
// Security notes, because a shared password on a public URL is the weak part:
// - only the bcrypt hash is stored, never the password
// - attempts are rate limited per IP, since the URL is reachable by anyone
// - the device cookie is signed, httpOnly and Secure
// - a device can be revoked without changing the password for everyone else
import crypto from "crypto";

export const LAP_DEVICE_COOKIE = "lap_device";
export const LAP_DEVICE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Per-IP throttle. A shared password on a public URL is guessable otherwise. */
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; first: number }>();

export function gateAttemptAllowed(ip: string, now = Date.now()): boolean {
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > ATTEMPT_WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return true;
  }
  rec.count += 1;
  return rec.count <= MAX_ATTEMPTS;
}

export function gateAttemptSucceeded(ip: string): void {
  attempts.delete(ip);
}

/** Only for tests — the throttle is process-wide state. */
export function resetGateAttempts(): void {
  attempts.clear();
}

export function newDeviceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * A friendly, non-identifying label for a device, derived from its user agent.
 * Deliberately coarse: it names the kind of machine so an admin can tell rows
 * apart, and does not attempt to fingerprint a person.
 */
export function deviceLabelFrom(userAgent: string | null | undefined, deviceId: string): string {
  const ua = String(userAgent ?? "");
  const os = /iPhone/i.test(ua) ? "iPhone"
    : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? "Android"
    : /Macintosh|Mac OS/i.test(ua) ? "Mac"
    : /Windows/i.test(ua) ? "Windows"
    : /Linux/i.test(ua) ? "Linux"
    : "Device";
  const browser = /Edg\//i.test(ua) ? "Edge"
    : /OPR\//i.test(ua) ? "Opera"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : /Firefox\//i.test(ua) ? "Firefox"
    : "";
  return `${os}${browser ? ` ${browser}` : ""} · ${deviceId.slice(0, 6)}`;
}

/** How a device appears in the audit trail. */
export function deviceAuditName(label: string): string {
  return `LAP device · ${label}`;
}
