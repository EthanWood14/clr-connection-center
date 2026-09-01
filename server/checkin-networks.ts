/**
 * Which networks people check in from.
 *
 * Every check-in already records the IP it arrived on and whether that IP was
 * approved AT THE TIME. This turns those rows into the question an admin
 * actually asks: which addresses are the office wifi, and which are not.
 *
 * Two deliberate choices:
 *
 * 1. `allowed` is recomputed against the CURRENT allowlist rather than read
 *    from the stored flag. The stored flag answers "was this approved when it
 *    happened", which is the right thing for an audit trail and the wrong thing
 *    for "is this the office". Adding an address to the allowlist has to make
 *    every past check-in from it read as office immediately, or the screen
 *    contradicts the setting that was just saved.
 *
 * 2. Both are returned. Where they disagree the row is worth looking at: an IP
 *    that used to be approved and no longer is means somebody's check-ins
 *    silently changed status, and that is exactly what an admin wants flagged.
 */
import { parseAllowEntry, ipMatchesEntry, normalizeAllowedIps, type AllowEntry } from "./checkin-ip";

export interface NetworkObservation {
  ip: string | null;
  /** 1/0/null as recorded at the time of the check-in. */
  wasAllowed: number | null;
  /** Display name of whoever checked in, when it can be resolved. */
  person: string | null;
  /** "clr" for the morning check-in, "external" for the portal one. */
  source: "clr" | "external";
  at: string | null;
}

export interface NetworkRow {
  ip: string;
  /** Matches the allowlist as it stands right now. */
  allowed: boolean;
  /** True when the stored flag disagrees with the allowlist today. */
  changed: boolean;
  checkins: number;
  clrCheckins: number;
  externalCheckins: number;
  people: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface NetworkSummary {
  /** Addresses matching the allowlist — the in-house wifi. */
  office: NetworkRow[];
  /** Everything else, busiest first. */
  offNetwork: NetworkRow[];
  totals: { checkins: number; office: number; offNetwork: number; addresses: number };
  /** Allowlist entries no check-in has ever matched. */
  unusedEntries: string[];
}

const laterOf = (a: string | null, b: string | null) => (!a ? b : !b ? a : (a > b ? a : b));
const earlierOf = (a: string | null, b: string | null) => (!a ? b : !b ? a : (a < b ? a : b));

/**
 * Group observations by address and mark each against the allowlist.
 *
 * Rows with no IP are dropped rather than bucketed as "unknown": an absent
 * address means recording was off, which is a property of the settings and is
 * reported separately, not a network anyone connected from.
 */
export function summarizeNetworks(rows: NetworkObservation[], allowedIps: unknown): NetworkSummary {
  const list = normalizeAllowedIps(allowedIps);
  const entries = list.map(parseAllowEntry).filter((e): e is AllowEntry => !!e);
  const isOffice = (ip: string) => entries.some((e) => ipMatchesEntry(ip, e));

  const byIp = new Map<string, NetworkRow & { _people: Set<string>; _changed: boolean }>();
  let total = 0;

  for (const r of rows) {
    const ip = String(r.ip ?? "").trim();
    if (!ip) continue;
    total += 1;
    let row = byIp.get(ip);
    if (!row) {
      row = {
        ip,
        allowed: isOffice(ip),
        changed: false,
        checkins: 0,
        clrCheckins: 0,
        externalCheckins: 0,
        people: [],
        firstSeen: null,
        lastSeen: null,
        _people: new Set<string>(),
        _changed: false,
      };
      byIp.set(ip, row);
    }
    row.checkins += 1;
    if (r.source === "external") row.externalCheckins += 1;
    else row.clrCheckins += 1;
    const who = String(r.person ?? "").trim();
    if (who) row._people.add(who);
    row.firstSeen = earlierOf(row.firstSeen, r.at ?? null);
    row.lastSeen = laterOf(row.lastSeen, r.at ?? null);
    // A stored flag of null predates enforcement and says nothing either way.
    if (r.wasAllowed != null && !!r.wasAllowed !== row.allowed) row._changed = true;
  }

  const finish = (r: NetworkRow & { _people: Set<string>; _changed: boolean }): NetworkRow => ({
    ip: r.ip,
    allowed: r.allowed,
    changed: r._changed,
    checkins: r.checkins,
    clrCheckins: r.clrCheckins,
    externalCheckins: r.externalCheckins,
    people: Array.from(r._people).sort((a, b) => a.localeCompare(b)),
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
  });

  // Busiest first within each group: the address 200 check-ins came from is the
  // one worth recognising, and a one-off is the one worth questioning.
  const byBusiest = (a: NetworkRow, b: NetworkRow) =>
    b.checkins - a.checkins || String(b.lastSeen ?? "").localeCompare(String(a.lastSeen ?? ""));

  const all = Array.from(byIp.values()).map(finish);
  const office = all.filter((r) => r.allowed).sort(byBusiest);
  const offNetwork = all.filter((r) => !r.allowed).sort(byBusiest);

  return {
    office,
    offNetwork,
    totals: {
      checkins: total,
      office: office.reduce((n, r) => n + r.checkins, 0),
      offNetwork: offNetwork.reduce((n, r) => n + r.checkins, 0),
      addresses: all.length,
    },
    // An approved entry nothing has ever come from is usually a typo or a
    // network that has since changed, and it is invisible without saying so.
    unusedEntries: list.filter((label) => {
      const e = parseAllowEntry(label);
      return !!e && !all.some((r) => ipMatchesEntry(r.ip, e));
    }),
  };
}
