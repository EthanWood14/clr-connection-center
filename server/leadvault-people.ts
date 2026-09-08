/**
 * The people a Bonzo prospect may be moved between, taken from LeadVault.
 *
 * The reassign tool used to take two typed email addresses. Typing an address
 * is the one step of that job with no safety net: everything downstream —
 * which record is meant, whether the move is allowed, whether it landed — is
 * checked, and then the whole thing rests on somebody spelling
 * "credoble@westcapitallending.com" correctly at four in the afternoon. A
 * dropdown removes the only unguarded step.
 *
 * LEADVAULT IS THE SOURCE, per Ethan. It is where loan officers are actually
 * administered, so it is the list that is right when somebody joins or leaves;
 * C3's own loan_officers rows drift because nothing forces them to be updated.
 *
 * KEPT WARM, NOT FETCHED PER KEYSTROKE. The roster changes when somebody is
 * hired, which is not often, but it must not be stale for a day either. So:
 * cached with a short TTL, served stale while a refresh runs behind the
 * request, and refreshed on a timer so the first person of the morning does
 * not pay for it.
 */

export interface LeadVaultPerson {
  /** The address Bonzo knows them by. The only field the reassign tool needs. */
  email: string;
  name: string;
  role: string | null;
  /** Their Bonzo user id when LeadVault knows it — useful for diagnosis. */
  bonzoUserId: number | null;
}

export interface PeopleResult {
  people: LeadVaultPerson[];
  /** Where the list came from, so the screen can be honest about it. */
  source: "leadvault" | "c3-fallback" | "none";
  /** When the underlying data was fetched, for a "last updated" line. */
  fetchedAt: string | null;
  /** Set when LeadVault could not be reached and this is the fallback. */
  notice: string | null;
}

/** How long a fetched roster is served without asking again. */
export const PEOPLE_TTL_MS = 10 * 60_000;

/**
 * How long a stale roster may still be served while a refresh runs behind it.
 *
 * Beyond this the list is old enough that somebody who left could still be a
 * dropdown option, so a slow request is preferable to a wrong one.
 */
export const PEOPLE_STALE_MAX_MS = 6 * 60 * 60_000;

/** How often the background refresh runs, so the cache is warm on arrival. */
export const PEOPLE_REFRESH_MS = 10 * 60_000;

/**
 * Shape one LeadVault user row.
 *
 * Anything without a usable email is dropped rather than shown: an option that
 * cannot be moved to is worse than a shorter list, because the person picking
 * it has no way to know it will fail.
 */
export function normalizePerson(row: any): LeadVaultPerson | null {
  const email = String(row?.email ?? "").trim().toLowerCase();
  if (!email.includes("@") || /\s/.test(email)) return null;
  const bonzo = Number(row?.bonzoUserId ?? row?.bonzo_user_id);
  return {
    email,
    name: String(row?.fullName ?? row?.full_name ?? row?.name ?? "").trim() || email,
    role: String(row?.role ?? "").trim() || null,
    bonzoUserId: Number.isFinite(bonzo) && bonzo > 0 ? bonzo : null,
  };
}

/**
 * Turn whatever LeadVault sent into a sorted, de-duplicated roster.
 *
 * Tolerant of the envelope on purpose — {users:[…]}, {los:[…]} or a bare array
 * — because the endpoint on the other side is C3's to consume, not to dictate,
 * and a shape change should degrade to an empty list rather than a 500 on a
 * page somebody is trying to use.
 */
export function peopleFromPayload(payload: unknown): LeadVaultPerson[] {
  const body: any = payload ?? {};
  const rows: unknown[] =
    Array.isArray(body) ? body
    : Array.isArray(body.users) ? body.users
    : Array.isArray(body.los) ? body.los
    : Array.isArray(body.people) ? body.people
    : [];

  const seen = new Set<string>();
  const out: LeadVaultPerson[] = [];
  for (const row of rows) {
    const person = normalizePerson(row);
    if (!person || seen.has(person.email)) continue;
    seen.add(person.email);
    out.push(person);
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  return out;
}

/**
 * The list C3 can build alone, for when LeadVault cannot be reached.
 *
 * Deliberately marked as a fallback wherever it is shown. It is C3's own
 * loan-officer rows, which are the same people but are not maintained with the
 * same care — somebody who left may still be here. Better than an empty
 * dropdown on a tool somebody opened to fix something; not good enough to
 * present as the roster.
 *
 * bonzo_username wins over email where both exist: it is the address Bonzo
 * actually knows the person by, which is the whole point of the field.
 */
export function fallbackPeopleFromLos(los: ReadonlyArray<any>): LeadVaultPerson[] {
  const seen = new Set<string>();
  const out: LeadVaultPerson[] = [];
  for (const lo of los ?? []) {
    for (const candidate of [lo?.bonzoUsername ?? lo?.bonzo_username, lo?.email]) {
      const email = String(candidate ?? "").trim().toLowerCase();
      if (!email.includes("@") || /\s/.test(email) || seen.has(email)) continue;
      seen.add(email);
      out.push({
        email,
        name: String(lo?.fullName ?? lo?.full_name ?? "").trim() || email,
        role: "lo",
        bonzoUserId: null,
      });
      break; // one address per person — the first is the one Bonzo uses
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  return out;
}
