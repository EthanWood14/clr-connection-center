import crypto from "crypto";
import { agentKey } from "./dialpad-stats";

export type DialpadSmsObservation = {
  externalId: string;
  agentKey: string;
  agentName: string;
  dialpadUserId: string;
  messageDate: string;
  occurredAt: string;
  status: string | null;
};

/**
 * The business day a text belongs to. Texts used to be filed under the UTC
 * date of the event, so everything sent after 5 PM Pacific landed on
 * TOMORROW's scorecard — and "today" on the scorecard was short by the whole
 * evening (Ethan, 15 Sep 2026: "why are dialpad texts for today off so
 * much?"). The floor works in Pacific; so does this.
 */
export const DIALPAD_SMS_TZ = "America/Los_Angeles";
const smsDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: DIALPAD_SMS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export function smsMessageDate(occurredAtIso: string): string {
  const ms = Date.parse(occurredAtIso);
  return smsDayFormat.format(Number.isFinite(ms) ? new Date(ms) : new Date());
}

function decodePart(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Verify Dialpad's HS256 JWT before looking at any event fields. */
export function verifyDialpadJwt(token: string, secret: string): any {
  const parts = token.trim().replace(/^"|"$/g, "").split(".");
  if (parts.length !== 3) throw new Error("Invalid Dialpad webhook token");
  const header = JSON.parse(decodePart(parts[0]).toString("utf8"));
  if (header?.alg !== "HS256") throw new Error("Unexpected Dialpad webhook algorithm");
  const actual = decodePart(parts[2]);
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Invalid Dialpad webhook signature");
  }
  return JSON.parse(decodePart(parts[1]).toString("utf8"));
}

export function normalizeOutboundSms(payload: any): DialpadSmsObservation | null {
  if (!payload || payload.direction !== "outbound" || payload.id == null) return null;
  const target = payload.target ?? {};
  // For a user target, target.id is the sender. For office/department targets,
  // sender_id is the actual user; keep it unmapped until that ID is linked.
  const isUser = String(target.type ?? "").toLowerCase() === "user";
  const senderId = payload.sender_id ?? (isUser ? target.id : null);
  if (senderId == null) return null;
  const agentName = isUser ? String(target.name ?? `Dialpad ${senderId}`) : `Dialpad user ${senderId}`;
  const createdMs = Number(payload.created_date);
  const occurredAt = Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : new Date().toISOString();
  return {
    externalId: String(payload.id),
    agentKey: isUser ? agentKey(agentName) : `dialpad-id:${senderId}`,
    agentName,
    dialpadUserId: String(senderId),
    messageDate: smsMessageDate(occurredAt),
    occurredAt,
    status: payload.message_status == null ? null : String(payload.message_status),
  };
}
