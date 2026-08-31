/**
 * Which addresses can actually receive mail.
 *
 * Resend discards the ENTIRE message when any one recipient is undeliverable.
 * So a single dead address on a fifteen-person notification silently takes the
 * mail away from all fifteen — which is exactly what happened: every "in Team
 * Chat" email bounced for sixteen real people because two non-mailbox system
 * accounts were on the list.
 *
 * These are structural rules, not a guess at whether a person's mailbox is
 * full. An address is refused only when its DOMAIN cannot receive mail at all.
 */

/**
 * Domains that exist but run no mail service, and reserved TLDs that can never
 * resolve. westcapitallending.center is C3's own web host — it has no MX
 * records, so lap-shared@westcapitallending.center could never be delivered,
 * and never was: 0 delivered against 9 bounces.
 */
export const NON_MAIL_DOMAINS = new Set([
  "westcapitallending.center",
  "c3.internal",
  "localhost",
]);

/** RFC 2606 / RFC 6761 reserved suffixes, plus the usual private-network ones. */
export const NON_MAIL_SUFFIXES = [
  ".internal",
  ".local",
  ".invalid",
  ".test",
  ".example",
  ".localhost",
];

export function emailDomain(address: string): string {
  const at = String(address ?? "").lastIndexOf("@");
  return at < 0 ? "" : String(address).slice(at + 1).trim().toLowerCase();
}

/** A shape check only — deliberately permissive about what a local part may be. */
export function looksLikeEmail(address: string): boolean {
  const v = String(address ?? "").trim();
  if (!v || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  const parts = v.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  // A domain must have a dot and a plausible TLD.
  return /^[^.]+(\.[^.]+)+$/.test(domain) && /^[A-Za-z]{2,}$/.test(domain.split(".").pop() ?? "");
}

/**
 * True when this address cannot receive mail, whoever it belongs to. Used to
 * drop it from a recipient list rather than to delete anybody's account —
 * these are real logins (a shared LAP portal account, the auto-review system
 * actor); they simply are not mailboxes.
 */
export function isUndeliverable(address: string): boolean {
  const v = String(address ?? "").trim().toLowerCase();
  if (!looksLikeEmail(v)) return true;
  const domain = emailDomain(v);
  if (NON_MAIL_DOMAINS.has(domain)) return true;
  return NON_MAIL_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}

export interface FilterResult {
  /** Addresses worth sending to, de-duplicated, order preserved. */
  to: string[];
  /** Addresses removed, so the drop is logged rather than silent. */
  dropped: string[];
}

/**
 * Strip undeliverable recipients so one dead address cannot cost everyone else
 * the message. Returns an empty `to` when nothing is left — the caller must
 * treat that as "do not send" rather than sending to nobody.
 */
export function filterRecipients(list: Array<string | null | undefined>): FilterResult {
  const to: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isUndeliverable(v)) dropped.push(v);
    else to.push(v);
  }
  return { to, dropped };
}
