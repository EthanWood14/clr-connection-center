/**
 * The "Vintage lead" branch on the default calling script.
 *
 * A vintage lead is an inquiry that is months old. The standard opener
 * ("we received an inquiry under your name…") reads wrong to someone who
 * asked in June, so the root node gets a first option — "Vintage lead
 * (months old)" — that swaps in Ethan's opener for them:
 *
 *   "A couple of months ago you were looking at taking out some cash via a
 *    HELOC or refinancing? What made you decide not to move in that
 *    direction?"
 *
 * Their answer then routes into the branches the script already has (cash
 * out, rates, future, selling, another lender, wrong person…), so nothing
 * downstream is duplicated.
 *
 * Additive, not a re-seed. The default script was seeded once
 * (ethan_wcl_script_v5) and since then lives in the database, where admins
 * edit it. Wiping and re-seeding would throw those edits away, so this finds
 * the existing default script and adds one node and its responses. Targets
 * are located by the opening words of their text; a branch an admin has
 * rewritten past recognition is simply skipped rather than mis-wired.
 * Runs once, recorded in migrations_applied. Personal CLR copies of the
 * script are untouched, as with every default-script change.
 *
 * Takes the database handle so it can be exercised against an in-memory
 * SQLite in tests without loading storage.ts.
 */
import type Database from "better-sqlite3";

export const VINTAGE_LEAD_MIGRATION = "ethan_wcl_script_v5_vintage_lead";
export const VINTAGE_LEAD_LABEL = "Vintage lead (months old)";

export const VINTAGE_LEAD_TEXT =
  "Hi, is this [Borrower Name]? Great — this is [Your Name] with West Capital Lending. " +
  "A couple of months ago you were looking at taking out some cash via a HELOC or refinancing? " +
  "What made you decide not to move in that direction?";

export const VINTAGE_LEAD_HINT =
  "Vintage = the inquiry is months old. Don't re-pitch and don't apologise for the gap — " +
  "ask why they paused and let the answer route the call. The reason they inquired usually still exists.";

/**
 * Where each answer goes: the label the CLR clicks, its colour, and the
 * opening words of the existing node it should lead to. Order is the order
 * on screen.
 */
export const VINTAGE_LEAD_RESPONSES: ReadonlyArray<{ label: string; color: string; targetStartsWith: string | null }> = [
  { label: "Still want the cash out", color: "green", targetStartsWith: "Awesome! Can you confirm a few quick things" },
  { label: "Rates too high", color: "yellow", targetStartsWith: "Okay, I mean I understand that stuff like that happens" },
  { label: "Looking in the future", color: "blue", targetStartsWith: "Alright, well, I understand" },
  { label: "Planning to sell / move", color: "yellow", targetStartsWith: "Okay. Are you looking to buy another house" },
  { label: "Went with another lender", color: "yellow", targetStartsWith: "Have you closed or completed the deal yet" },
  { label: "Not sure / no real reason", color: "yellow", targetStartsWith: "Okay. What made you make the inquiry in the first place" },
  { label: "Changed their mind", color: "yellow", targetStartsWith: "Okay, I mean I totally understand that things change" },
  { label: "Wrong person", color: "gray", targetStartsWith: "Okay. Could [Borrower Name] be someone in the family" },
  { label: "Wrong number / hostile", color: "red", targetStartsWith: "Hey, what did I do?" },
  { label: "Busy right now", color: "yellow", targetStartsWith: "Totally get it — I'll be two minutes" },
  { label: "No answer — voicemail", color: "gray", targetStartsWith: "[VOICEMAIL" },
  { label: "Not interested", color: "gray", targetStartsWith: null },
];

export type VintageLeadResult =
  | { applied: false; reason: "already_applied" | "no_default_script" | "no_root_node" }
  | { applied: true; nodeId: number; responseId: number; wired: number; skipped: string[] };

export function ensureVintageLeadBranch(sqlite: Database.Database): VintageLeadResult {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  if (sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = ?`).get(VINTAGE_LEAD_MIGRATION)) {
    return { applied: false, reason: "already_applied" };
  }
  const script = sqlite.prepare(
    `SELECT id FROM call_scripts WHERE owner_id IS NULL AND is_active = 1 ORDER BY created_at ASC LIMIT 1`,
  ).get() as { id: number } | undefined;
  if (!script) return { applied: false, reason: "no_default_script" };
  const root = sqlite.prepare(
    `SELECT id FROM script_nodes WHERE script_id = ? AND parent_node_id IS NULL ORDER BY node_order ASC, id ASC LIMIT 1`,
  ).get(script.id) as { id: number } | undefined;
  if (!root) return { applied: false, reason: "no_root_node" };

  const nodes = sqlite.prepare(`SELECT id, text FROM script_nodes WHERE script_id = ?`).all(script.id) as { id: number; text: string }[];
  const find = (startsWith: string): number | null => {
    const hit = nodes.find((n) => String(n.text ?? "").replace(/\s+/g, " ").trimStart().startsWith(startsWith));
    return hit ? hit.id : null;
  };

  return sqlite.transaction((): VintageLeadResult => {
    // First on screen: a CLR calling a vintage lead picks it before reading
    // the standard opener, so it goes ahead of everything already there.
    const minOrder = (sqlite.prepare(`SELECT MIN(response_order) AS m FROM script_responses WHERE node_id = ?`).get(root.id) as any)?.m;
    const responseOrder = Number.isFinite(Number(minOrder)) ? Number(minOrder) - 1 : 0;
    const responseId = Number(sqlite.prepare(
      `INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?, ?, 'blue', NULL, ?)`,
    ).run(root.id, VINTAGE_LEAD_LABEL, responseOrder).lastInsertRowid);

    const maxOrder = (sqlite.prepare(`SELECT MAX(node_order) AS m FROM script_nodes WHERE script_id = ? AND parent_node_id = ?`).get(script.id, root.id) as any)?.m;
    const nodeId = Number(sqlite.prepare(
      `INSERT INTO script_nodes (script_id, parent_node_id, parent_response_id, text, hint, node_order) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(script.id, root.id, responseId, VINTAGE_LEAD_TEXT, VINTAGE_LEAD_HINT, (Number(maxOrder) || 0) + 1).lastInsertRowid);
    sqlite.prepare(`UPDATE script_responses SET next_node_id = ? WHERE id = ?`).run(nodeId, responseId);

    let wired = 0;
    const skipped: string[] = [];
    VINTAGE_LEAD_RESPONSES.forEach((r, i) => {
      const target = r.targetStartsWith ? find(r.targetStartsWith) : null;
      if (r.targetStartsWith && target == null) { skipped.push(r.label); return; }
      sqlite.prepare(
        `INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?, ?, ?, ?, ?)`,
      ).run(nodeId, r.label, r.color, target, i);
      wired++;
    });

    sqlite.prepare(`INSERT INTO migrations_applied (name, applied_at) VALUES (?, datetime('now'))`).run(VINTAGE_LEAD_MIGRATION);
    return { applied: true, nodeId, responseId, wired, skipped };
  })();
}
