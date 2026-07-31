import { isIP } from "node:net";

export type CheckinIpMode = "enforce" | "record" | "off";

export function normalizeIpAddress(value: unknown): string | null {
  let ip = String(value ?? "").trim().toLowerCase();
  if (!ip) return null;
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/**
 * An office is not one address.
 *
 * IPv6 is the reason: an ISP delegates a stable prefix (typically a /64) and the
 * host portion rotates by design under privacy extensions — often daily. Pinning
 * the full address means the allowlist stops matching within a day. IPv4 has a
 * milder version of the same problem when the ISP lease changes.
 *
 * So an entry may be a bare address (implicitly /32 or /128) or CIDR notation,
 * and matching is done on the leading bits.
 */
export function ipToBytes(ip: string): Uint8Array | null {
  const value = normalizeIpAddress(ip);
  if (!value) return null;
  if (isIP(value) === 4) {
    const parts = value.split(".").map((p) => Number(p));
    return Uint8Array.from(parts);
  }
  // IPv6, possibly compressed and possibly ending in dotted-quad notation.
  let head = value;
  let tailBytes: number[] = [];
  const lastColon = head.lastIndexOf(":");
  const maybeV4 = head.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    if (isIP(maybeV4) !== 4) return null;
    tailBytes = maybeV4.split(".").map((p) => Number(p));
    head = head.slice(0, lastColon + 1) + "0:0";
  }
  const [left, right] = head.split("::");
  const toGroups = (part: string) => (part ? part.split(":").filter((g) => g !== "") : []);
  const leftGroups = toGroups(left ?? "");
  const rightGroups = right === undefined ? [] : toGroups(right);
  const total = 8 - (tailBytes.length ? 1 : 0) * 0; // groups always total 8
  const missing = total - leftGroups.length - rightGroups.length;
  if (right === undefined && missing !== 0) return null; // no "::" so it must be full
  if (missing < 0) return null;
  const groups = [...leftGroups, ...new Array(missing).fill("0"), ...rightGroups];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = parseInt(groups[i] ?? "0", 16);
    if (!Number.isFinite(g) || g < 0 || g > 0xffff) return null;
    bytes[i * 2] = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  }
  if (tailBytes.length === 4) {
    bytes[12] = tailBytes[0]; bytes[13] = tailBytes[1];
    bytes[14] = tailBytes[2]; bytes[15] = tailBytes[3];
  }
  return bytes;
}

/**
 * Canonical text for an address, derived from its bytes (RFC 5952 for IPv6:
 * lowercase, longest zero-run compressed). Labels are built from this so that
 * 2600:1700:0:0::/64 and 2600:1700::/64 are stored as one entry rather than two
 * that look different but mean the same thing.
 */
export function bytesToIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");
  const groups: number[] = [];
  for (let i = 0; i < 8; i++) groups.push((bytes[i * 2] << 8) | bytes[i * 2 + 1]);
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) { curStart = i; curLen = 0; }
      curLen++;
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
    } else { curStart = -1; curLen = 0; }
  }
  if (bestLen < 2) return groups.map((g) => g.toString(16)).join(":");
  const head = groups.slice(0, bestStart).map((g) => g.toString(16)).join(":");
  const tail = groups.slice(bestStart + bestLen).map((g) => g.toString(16)).join(":");
  return `${head}::${tail}`;
}

export type AllowEntry = { bytes: Uint8Array; bits: number; label: string };

/** Parse one allowlist entry: a bare address or CIDR. */
export function parseAllowEntry(value: unknown): AllowEntry | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const slash = raw.indexOf("/");
  const addrPart = slash >= 0 ? raw.slice(0, slash) : raw;
  const bytes = ipToBytes(addrPart);
  if (!bytes) return null;
  const maxBits = bytes.length * 8;
  let bits = maxBits;
  if (slash >= 0) {
    const n = Number(raw.slice(slash + 1));
    if (!Number.isInteger(n) || n < 0 || n > maxBits) return null;
    bits = n;
  }
  const canonical = bytesToIp(bytes);
  return { bytes, bits, label: slash >= 0 ? `${canonical}/${bits}` : canonical };
}

/** Whether an address falls inside an allowlist entry's prefix. */
export function ipMatchesEntry(ip: string, entry: AllowEntry): boolean {
  const bytes = ipToBytes(ip);
  // An IPv4 address never matches an IPv6 prefix, or vice versa.
  if (!bytes || bytes.length !== entry.bytes.length) return false;
  const whole = entry.bits >> 3;
  for (let i = 0; i < whole; i++) if (bytes[i] !== entry.bytes[i]) return false;
  const rem = entry.bits & 7;
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (bytes[whole] & mask) === (entry.bytes[whole] & mask);
}

export function normalizeAllowedIps(value: unknown): string[] {
  let input: unknown = value;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      input = input.split(/[\s,;]+/);
    }
  }
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(
    input.map((v) => parseAllowEntry(v)?.label).filter((s): s is string => !!s),
  )).slice(0, 50);
}

export function evaluateCheckinIp(
  mode: CheckinIpMode,
  allowedIps: string[],
  requestIp: unknown,
):
  | { ok: true; ipAddress: string | null; ipAllowed: number | null }
  | { ok: false; status: number; code: string; error: string; ipAddress: string | null; ipAllowed: number | null } {
  if (mode === "off") return { ok: true, ipAddress: null, ipAllowed: null };

  const ipAddress = normalizeIpAddress(requestIp);
  const normalizedAllowed = normalizeAllowedIps(allowedIps);
  if (!ipAddress) {
    if (mode === "record") return { ok: true, ipAddress: null, ipAllowed: null };
    return {
      ok: false,
      status: 422,
      code: "IP_UNAVAILABLE",
      error: "C3 could not verify this connection's IP address. Refresh and try again.",
      ipAddress: null,
      ipAllowed: null,
    };
  }

  // An empty allowlist records the server-observed IP without locking the whole
  // team out. Enforcement begins as soon as an admin saves at least one office IP.
  if (!normalizedAllowed.length) return { ok: true, ipAddress, ipAllowed: null };

  const entries = normalizedAllowed.map(parseAllowEntry).filter((e): e is AllowEntry => !!e);
  const ipAllowed = entries.some((e) => ipMatchesEntry(ipAddress, e)) ? 1 : 0;
  if (mode === "enforce" && !ipAllowed) {
    return {
      ok: false,
      status: 403,
      code: "IP_NOT_ALLOWED",
      error: "This check-in must be submitted from an approved office network.",
      ipAddress,
      ipAllowed,
    };
  }
  return { ok: true, ipAddress, ipAllowed };
}
