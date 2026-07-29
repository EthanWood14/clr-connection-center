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
  return Array.from(new Set(input.map(normalizeIpAddress).filter((ip): ip is string => !!ip))).slice(0, 50);
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

  const ipAllowed = normalizedAllowed.includes(ipAddress) ? 1 : 0;
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
