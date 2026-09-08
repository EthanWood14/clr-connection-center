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
export function filterRecipients(
  list: Array<string | null | undefined>,
  suppressed: ReadonlySet<string> = EMPTY_SUPPRESSION,
): FilterResult {
  const to: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Structural first, then learned. Both end in the same place, but the
    // reasons are different and the log should be able to say which.
    if (isUndeliverable(v) || suppressed.has(key)) dropped.push(v);
    else to.push(v);
  }
  return { to, dropped };
}

/** Shared empty set, so the common call site allocates nothing. */
const EMPTY_SUPPRESSION: ReadonlySet<string> = new Set<string>();


/**
 * ── The learned half ────────────────────────────────────────────────────────
 *
 * The rules above catch addresses that could NEVER work: a domain with no mail
 * service, a reserved TLD. They cannot catch an address that looks perfectly
 * ordinary and is simply dead — somebody left the company, a mailbox was
 * closed, a letter was typed wrong when the account was made.
 *
 * C3 already learns this and then forgets it. reconcileEmailStatuses() polls
 * Resend every ten minutes, writes the outcome to email_sends, and tells the
 * admins when a message reached nobody. Nothing acts on that: the next group
 * email addressed to the same dead mailbox bounces exactly the same way, and
 * takes everyone else's copy with it again.
 *
 * So: an address that has bounced repeatedly and has NEVER ONCE delivered
 * stops being addressed.
 *
 * "Never once delivered" is the load-bearing half of that sentence, not a
 * detail. Resend reports one outcome per MESSAGE, not per recipient, so when a
 * send bounces every address on it is recorded as bounced — including sixteen
 * people whose mail was fine and who were merely standing next to a dead
 * address. Suppressing on bounce count alone would have removed the entire
 * team from their own chat notifications after two bad sends. A single
 * delivery anywhere in the window is proof the mailbox is real, and clears it.
 */

/** Bounces, with no delivery ever, before C3 stops addressing a mailbox. */
export const SUPPRESS_AFTER_BOUNCES = 3;

/** How far back the evidence is read. */
export const SUPPRESS_WINDOW_DAYS = 90;

/**
 * The evidence. Both outcomes are needed, not just the bounces — a delivery is
 * what exonerates an address that was on somebody else's failed send.
 */
export const SUPPRESSION_HISTORY_SQL = `
  SELECT recipients, last_event
    FROM email_sends
   WHERE accepted_at >= datetime('now', ?)
     AND last_event IN ('bounced', 'delivered')
`;

/** The window argument for SUPPRESSION_HISTORY_SQL. */
export function suppressionWindowArg(days: number = SUPPRESS_WINDOW_DAYS): string {
  return `-${Math.max(1, Math.floor(days))} days`;
}

export interface SuppressionEvidence {
  recipients?: unknown;
  last_event?: unknown;
}

/**
 * Fold send history into the set of addresses not worth trying again.
 *
 * Returns lowercased addresses. An empty set is the safe answer whenever the
 * history cannot be read: unknown must mean "send it", never "send nothing".
 */
export function suppressionFromHistory(
  rows: ReadonlyArray<SuppressionEvidence> | null | undefined,
  threshold: number = SUPPRESS_AFTER_BOUNCES,
): Set<string> {
  const bounced = new Map<string, number>();
  const delivered = new Set<string>();

  for (const row of rows ?? []) {
    let list: unknown[];
    try {
      const parsed = JSON.parse(String(row?.recipients ?? "[]"));
      if (!Array.isArray(parsed)) continue;
      list = parsed;
    } catch { continue; }
    const event = String(row?.last_event ?? "").trim().toLowerCase();
    if (event !== "bounced" && event !== "delivered") continue;
    for (const entry of list) {
      const addr = String(entry ?? "").trim().toLowerCase();
      if (!addr) continue;
      if (event === "delivered") delivered.add(addr);
      else bounced.set(addr, (bounced.get(addr) ?? 0) + 1);
    }
  }

  // forEach rather than for-of: the build targets a pre-ES2015 lib, where
  // iterating a Map is a type error. The error budget is fixed at 32 and this
  // file is not the place to spend one.
  const out = new Set<string>();
  bounced.forEach((count, addr) => {
    if (count >= threshold && !delivered.has(addr)) out.add(addr);
  });
  return out;
}
