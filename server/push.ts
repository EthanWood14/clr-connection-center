import webpush from "web-push";
import { getSqlite, getWebhookSettings } from "./storage";

let initialized = false;
let publicKey: string | null = null;

// ── Quiet hours ─────────────────────────────────────────────────────────────
// No C3 notifications between 9 PM and 8 AM in the recipient's local timezone
// (falling back to Pacific). Keeps the app from buzzing people late at night.
const QUIET_START_HOUR = 21; // 9 PM — quiet from here…
const QUIET_END_HOUR = 8;    // …until 8 AM

export function inQuietHours(userId: number, now: Date = new Date()): boolean {
  try {
    const sqlite = getSqlite();
    const row = sqlite.prepare(`SELECT timezone FROM users WHERE id=?`).get(userId) as any;
    const tz = (row?.timezone && String(row.timezone).trim()) || "America/Los_Angeles";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).formatToParts(now);
    const raw = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
    const hour = Number.isNaN(raw) ? 0 : (raw === 24 ? 0 : raw);
    return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
  } catch {
    return false; // never suppress on error
  }
}

export function initPush() {
  const sqlite = getSqlite();
  const settings = getWebhookSettings() as any;
  let pub = settings.vapid_public_key as string | null | undefined;
  let priv = settings.vapid_private_key as string | null | undefined;

  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    const now = new Date().toISOString();
    sqlite.prepare(
      `UPDATE webhook_settings SET vapid_public_key=?, vapid_private_key=?, updated_at=? WHERE id=1`
    ).run(pub, priv, now);
    console.log("[push] Generated new VAPID key pair");
  }

  try {
    webpush.setVapidDetails("mailto:reports@westcapitallending.center", pub!, priv!);
    publicKey = pub!;
    initialized = true;
    console.log("[push] Web Push initialized");
  } catch (e: any) {
    console.error("[push] Failed to init VAPID:", e?.message ?? e);
  }
}

export function getVapidPublicKey(): string | null {
  if (!initialized) return null;
  return publicKey;
}

export function saveSubscription(userId: number, orgId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const sqlite = getSqlite();
  const now = new Date().toISOString();
  try {
    sqlite.prepare(
      `INSERT INTO push_subscriptions (user_id, org_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`
    ).run(userId, orgId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, now);
  } catch (e: any) {
    console.error("[push] saveSubscription error:", e?.message ?? e);
    throw e;
  }
}

export function removeSubscription(userId: number, endpoint: string) {
  const sqlite = getSqlite();
  sqlite.prepare(`DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?`).run(userId, endpoint);
}

export function removeAllUserSubscriptions(userId: number) {
  const sqlite = getSqlite();
  sqlite.prepare(`DELETE FROM push_subscriptions WHERE user_id=?`).run(userId);
}

export function getUserSubscriptions(userId: number): Array<{ id: number; endpoint: string; p256dh: string; auth: string }> {
  const sqlite = getSqlite();
  return sqlite.prepare(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?`
  ).all(userId) as any[];
}

export async function sendPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string }
): Promise<{ sent: number; failed: number }> {
  if (!initialized) return { sent: 0, failed: 0 };
  // Respect quiet hours — no pushes between 9 PM and 8 AM (recipient's tz).
  if (inQuietHours(userId)) return { sent: 0, failed: 0 };
  const sqlite = getSqlite();
  const subs = getUserSubscriptions(userId);
  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);
  for (const s of subs) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(sub, body);
      sent++;
    } catch (err: any) {
      failed++;
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        // Subscription expired / unsubscribed — remove it
        try {
          sqlite.prepare(`DELETE FROM push_subscriptions WHERE id=?`).run(s.id);
        } catch {}
      } else {
        console.error(`[push] send failed user=${userId} status=${status}:`, err?.message ?? err);
      }
    }
  }
  return { sent, failed };
}

export async function sendPushToUsers(
  userIds: number[],
  payload: { title: string; body: string; url?: string }
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const id of userIds) {
    const r = await sendPushToUser(id, payload);
    sent += r.sent;
    failed += r.failed;
  }
  return { sent, failed };
}
