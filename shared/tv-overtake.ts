/**
 * The race-car moment: one CLR passing another on the office TV.
 *
 * The wallboard polls its feed every ten seconds and gets back a people list
 * already sorted by today's transfers. Comparing one poll to the next tells us
 * who climbed — but "the list reordered" and "somebody actually passed
 * somebody" are not the same thing, and the difference is the whole file:
 *
 *  1. **The passer must have scored.** A board reshuffles for boring reasons —
 *     a transfer logged to the wrong CLR gets corrected, the person above you
 *     drops two, and suddenly you are ahead of them without lifting the phone.
 *     That is not a moment, so a pass only counts when the passer's own
 *     `transfersToday` went UP in this poll.
 *
 *  2. **One moment per passer, not one per person passed.** Jumping four
 *     places at once is one story — "she went past Linda" — not four cars in a
 *     row. We name the highest-ranked person they got past and say nothing
 *     about the rest. A quiet board is better than six cars.
 *
 *  3. **Keys are stable and carry the day**, the same rule the milestones in
 *     `server/tv-board.ts` follow: the screen remembers which keys it has
 *     played, so the same pass must produce the same key on every poll — and a
 *     different one tomorrow, when it is worth celebrating again.
 *
 * Pure and prev/next-shaped so the whole thing is testable without a DB, a
 * server, or ten seconds of waiting.
 */

/** The part of the scorecard's Person row the ranking cares about. */
export interface RankRow {
  id: number;
  name: string;
  transfersToday: number;
}

export interface Overtake {
  /** Stable per pass, per day — the screen plays a key exactly once. */
  key: string;
  passerId: number;
  passerName: string;
  /** The highest-ranked CLR they got past, and the only one named. */
  passedName: string;
  /** The passer's transfer count now, i.e. what they climbed to. */
  count: number;
  /** The passer's new 1-based position on the board. */
  rank: number;
}

/** "Elleine Asuncion" → "elleine-asuncion", so the key survives a URL and a log line. */
function slug(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "clr";
}

/**
 * Who just passed whom, comparing the previous poll to this one.
 *
 * `prev` is null on the first poll after a load — the board never replays
 * history, so that is silence, not a dozen cars at once.
 */
export function detectOvertakes(prev: RankRow[] | null, next: RankRow[], today: string): Overtake[] {
  if (!prev || !prev.length || !next.length) return [];

  // Last poll's numbers, and last poll's order. Both lists arrive sorted, so a
  // row's index IS its rank; nothing here re-sorts, or "rank" would stop
  // meaning what the screen shows. First entry wins if an id somehow repeats.
  const was = new Map<number, number>();
  const wasRank = new Map<number, number>();
  prev.forEach((p, i) => {
    if (was.has(p.id)) return;
    was.set(p.id, p.transfersToday);
    wasRank.set(p.id, i);
  });

  const out: Overtake[] = [];

  next.forEach((passer, i) => {
    const before = was.get(passer.id);
    // Nobody's first appearance is a climb — they were not below anyone, they
    // simply were not there. (And someone who LEFT is not in `next` at all,
    // so this loop never considers them either way.)
    if (before === undefined) return;
    // Rule 1: their own number has to have moved. Without this, one downward
    // correction above them fires a car they did not earn.
    if (passer.transfersToday <= before) return;
    // Nobody at zero overtakes anybody.
    if (passer.transfersToday <= 0) return;

    // Of everyone they were at-or-behind and are now strictly ahead of, keep
    // only the one who stood highest — the biggest name they got past.
    let passed: RankRow | null = null;
    let passedRank = Infinity;

    for (const other of next) {
      if (other.id === passer.id) continue;
      const otherBefore = was.get(other.id);
      // Someone who was not on the board last poll cannot have been passed on
      // it, however far down they land now.
      if (otherBefore === undefined) continue;
      // And nobody is overtaken at zero either. At 9am the whole floor is on
      // nothing, so every first transfer of the day would otherwise fire a car
      // for "passing" everyone who has not started — six cars before the
      // coffee is cold. Clearing someone genuinely on the board still counts,
      // so a climber who gets past both a 0 and a 2 is named against the 2.
      if (other.transfersToday <= 0) continue;
      // Was at-or-behind them...
      if (before > otherBefore) continue;
      // ...and is now strictly ahead. Level pegging is not a pass, in either
      // direction, so the tie is excluded here rather than celebrated.
      if (passer.transfersToday <= other.transfersToday) continue;

      const rank = wasRank.get(other.id) ?? Infinity;
      if (rank < passedRank) {
        passedRank = rank;
        passed = other;
      }
    }

    if (!passed) return;

    out.push({
      key: `overtake-${today}-${passer.id}-${slug(passed.name)}-${passer.transfersToday}`,
      passerId: passer.id,
      passerName: passer.name,
      passedName: passed.name,
      count: passer.transfersToday,
      rank: i + 1,
    });
  });

  // Best rank first. Walking `next` in order already produces that; the sort
  // states it as a promise the caller can rely on rather than a side effect of
  // how this loop happens to be written.
  return out.sort((a, b) => a.rank - b.rank);
}
