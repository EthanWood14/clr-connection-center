/**
 * "A new lead just landed in LeadVault" — the notice on the office wall.
 *
 * LeadVault POSTs one line when a lead arrives; the TV slides a strip up along
 * the bottom of the screen for a few seconds and drops it again. That is the
 * whole feature, and it is why none of this goes near the database:
 *
 *  - These are notices, not records. C3 does not own LeadVault's leads and has
 *    no business keeping a second copy of them. The wall needs a name, roughly
 *    where the lead came from, and when — for the next few minutes.
 *  - So the buffer is in memory and deliberately tiny: the last few, and
 *    nothing older than ten minutes. A retry storm, or somebody pointing a
 *    backfill script at the webhook, can therefore replay at most the last ten
 *    minutes rather than the whole morning.
 *  - A restart loses it, on purpose. A wall notice that survives a deploy is
 *    just an old notice.
 *
 * The id is monotonic, so the board can tell two leads with the same name apart
 * and show each of them exactly once. It is seeded from the clock rather than
 * from zero: a board that has already shown id 41 must not be handed a fresh
 * id 41 after a restart and quietly skip it.
 *
 * There is no organisation on the wire and none here. The secret is one per C3
 * install, and the only reader is a token-gated wallboard in that same install,
 * so the buffer is install-wide by construction.
 */

/** Everything the wall is given about a lead. Nothing else is kept. */
export interface NewLead {
  id: number;
  name: string;
  source: string | null;
  at: string;
}

/**
 * What LeadVault may send. `state` and `campaign` are accepted so LeadVault
 * does not have to build a different body for C3 than it sends anywhere else —
 * and then dropped, because the strip shows a name and a source and nothing
 * here earns a copy of the rest.
 */
export interface NewLeadInput {
  name?: unknown;
  source?: unknown;
  state?: unknown;
  campaign?: unknown;
  at?: unknown;
}

/** About a screenful of arrivals. Older ones fall off the back. */
export const NEW_LEAD_KEEP = 20;
/** Anything older than this is not news, and is never shown or stored. */
export const NEW_LEAD_MAX_AGE_MS = 10 * 60 * 1000;

/** Seconds since the epoch at start, so ids climb across restarts too. */
const seed = () => Math.floor(Date.now() / 1000);
let seq = seed();
let leads: NewLead[] = [];

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const stampMs = (iso: string) => Date.parse(iso);

/**
 * When it happened, in milliseconds.
 *
 * A stamp we cannot read — and one from the future, which is a clock skew on
 * the sender — is treated as "now". The arrival IS the event, and a sender an
 * hour fast must not be able to park a notice at the top of the buffer.
 */
function arrivedAt(at: unknown, now: number): number {
  const t = Date.parse(String(at ?? ""));
  return Number.isFinite(t) && t <= now ? t : now;
}

/** Drop anything past its ten minutes. Called on every read and every write. */
function prune(now: number): void {
  leads = leads.filter((l) => now - stampMs(l.at) <= NEW_LEAD_MAX_AGE_MS);
}

/**
 * Remember a lead worth a notice, or return null if it is too old to be one.
 *
 * Returning null rather than throwing is the point: a retry of a delivery from
 * this morning is not an error on LeadVault's side, it is simply not news, and
 * answering 200 keeps it from being retried forever.
 */
export function recordNewLead(input: NewLeadInput, now = Date.now()): NewLead | null {
  const ms = arrivedAt(input.at, now);
  if (now - ms > NEW_LEAD_MAX_AGE_MS) return null;
  seq += 1;
  const lead: NewLead = {
    id: seq,
    name: clean(input.name, 60) || "A new lead",
    source: clean(input.source, 40) || null,
    at: new Date(ms).toISOString(),
  };
  prune(now);
  leads = [...leads, lead].slice(-NEW_LEAD_KEEP);
  return lead;
}

/**
 * The leads the board has not been shown yet.
 *
 * Same rule as the event feed in routes.ts: no cursor means the TV has just
 * booted, and a board coming up does not replay what it missed. With a cursor
 * it gets strictly what arrived after it, so a poll that catches nothing new
 * returns nothing at all.
 */
export function newLeadsSince(since: string | null | undefined, now = Date.now()): NewLead[] {
  prune(now);
  if (!since) return [];
  const cut = Date.parse(String(since));
  if (!Number.isFinite(cut)) return [];
  return leads.filter((l) => stampMs(l.at) > cut);
}

/** Tests only — a fresh process without having to start one. */
export function resetNewLeads(): void {
  leads = [];
  seq = seed();
}
