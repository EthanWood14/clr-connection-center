// Dialpad call statistics → C3 EOD stats.
//
// Transfers and appointments already fill themselves in on the EOD report,
// because CallTools dispositions arrive as lead_outcomes rows and the form
// tallies them. Calls made was the one number a CLR still had to count by hand.
//
// The data comes from LeadVault's outbound-summary feed, which already
// aggregates Dialpad (and Mojo) call logs and which C3 already proxies for the
// Outbound Calls page — so there is no second vendor account, no Dialpad OAuth
// and no separate rate limit to manage. What was missing was identity: the feed
// reports an agent as a display-name string, and only some of those strings are
// spelled the way C3 spells them ("Matthew Lane" vs "Matt Lane").
//
// Pure functions only, so the matching rules can be tested without a database
// or a live upstream.

export type DialpadAgentRow = {
  agent: string;
  calls_total?: number;
  calls_connected?: number;
  talk_seconds?: number;
  by_day?: { date: string; calls: number }[];
};

export type Identity = { id: number; name: string };

export type AgentMatch =
  | { agent: string; userId: number; via: "link" | "name" }
  | { agent: string; userId: null; via: "unmatched" };

/**
 * Comparison key for a person's display name.
 *
 * Letters only, lowercased. Collapses the spelling noise the feed actually
 * contains — "Bill  Neessen" carries a double space, and punctuation varies —
 * without being so loose that different people collide.
 */
export function agentKey(name: unknown): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Resolve one Dialpad agent to a C3 user.
 *
 * Explicit links win over name matching, always: a link is somebody's recorded
 * decision, and it must not be silently overridden by a coincidental rename.
 */
export function matchAgent(
  agent: string,
  users: Identity[],
  links: Map<string, number>,
): AgentMatch {
  const key = agentKey(agent);
  if (!key) return { agent, userId: null, via: "unmatched" };

  const linked = links.get(key);
  if (linked != null) return { agent, userId: linked, via: "link" };

  const byName = users.find((u) => agentKey(u.name) === key);
  if (byName) return { agent, userId: byName.id, via: "name" };

  return { agent, userId: null, via: "unmatched" };
}

/**
 * Per-day call counts for one agent, keyed by date.
 *
 * by_day is what makes this usable for EOD at all — calls_total is a rolling
 * window total and would overstate any single day.
 */
export function dailyCallsByDate(row: DialpadAgentRow): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of Array.isArray(row.by_day) ? row.by_day : []) {
    const date = String(d?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const calls = Number(d?.calls);
    if (!Number.isFinite(calls) || calls < 0) continue;
    // Two entries for one date should add, not overwrite.
    out.set(date, (out.get(date) ?? 0) + Math.trunc(calls));
  }
  return out;
}

/**
 * Flatten the feed into per-agent-per-day rows ready to upsert.
 *
 * Unmatched agents are still returned, with userId null. They are a real part
 * of the picture — the feed carries loan officers dialling for themselves and
 * staff who are not in C3 at all — and dropping them here would make the
 * mapping screen unable to show what is waiting to be mapped.
 */
export function flattenAgentStats(
  agents: DialpadAgentRow[],
  users: Identity[],
  links: Map<string, number>,
): Array<{ agent: string; userId: number | null; via: AgentMatch["via"]; date: string; calls: number }> {
  const out: Array<{ agent: string; userId: number | null; via: AgentMatch["via"]; date: string; calls: number }> = [];
  for (const row of Array.isArray(agents) ? agents : []) {
    const name = String(row?.agent ?? "").trim();
    if (!name) continue;
    const m = matchAgent(name, users, links);
    for (const [date, calls] of Array.from(dailyCallsByDate(row).entries())) {
      out.push({ agent: name, userId: m.userId, via: m.via, date, calls });
    }
  }
  return out;
}
