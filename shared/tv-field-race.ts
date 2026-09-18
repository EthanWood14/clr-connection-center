import type { RankRow } from "./tv-overtake";
import { buildDayRaceTimeline, dayRaceStartingGrid, filterDayRaceField, type DayRaceHourCredit } from "./tv-day-race";

/** Every real transfer gets a race; event IDs still own polling/reload deduplication. */
export function showsFieldRace(eventId: string): boolean {
  return eventId.trim().length > 0;
}

export interface TransferRaceEvent {
  id: string;
  kind: string;
  who: string;
  assistantId?: number | null;
  /** Actual current-day credit, including split halves; an old-date edit has none. */
  raceCredits?: { userId: number; credit: number }[];
}

export interface TransferRaceMoment<T extends TransferRaceEvent> {
  event: T;
  focusId?: number;
  people: RankRow[];
  before: RankRow[] | null;
}

/** Polls can repeat a row while its moment is queued or already on screen. */
export function appendTvMoments<T extends { key: string }>(queued: T[], incoming: T[], played: ReadonlySet<string>): T[] {
  const have = new Set(queued.map(moment => moment.key));
  const result = [...queued];
  for (const moment of incoming) {
    if (have.has(moment.key) || played.has(moment.key)) continue;
    have.add(moment.key);
    result.push(moment);
  }
  return result;
}

export function racePreviewStatus(
  current: { type: string; preview?: boolean } | null,
  queued: { type: string; preview?: boolean }[],
): "playing" | "queued" | null {
  if (current?.type === "event" && current.preview) return "playing";
  if (queued.some(moment => moment.type === "event" && moment.preview)) return "queued";
  return null;
}

/** Local display-only replay: snapshot today's real grid, never add a score. */
export function createTvRacePreview(people: RankRow[], key: string, at: string) {
  return {
    type: "event" as const, key, preview: true, raceBefore: null,
    fieldRace: people.map(person => ({ ...person })),
    event: { id: key, kind: "transfer" as const, at, borrower: "", who: "", lo: null, detail: null },
  };
}

/**
 * Play-button day replay: one frame per non-empty office hour, Elleine off the
 * field. Falls back to a still of today's grid when no hourly credits exist.
 */
export function createTvDayRacePreview(
  people: RankRow[],
  hourCredits: readonly DayRaceHourCredit[],
  key: string,
  at: string,
) {
  const field = filterDayRaceField(people);
  const frames = buildDayRaceTimeline(field, hourCredits);
  if (!frames.length) {
    return { ...createTvRacePreview(field, key, at) };
  }
  // Start on the zeroed grid so the first transfer minute can land on its own
  // clock instead of applying a whole hour of credits the instant Play is hit.
  const grid = dayRaceStartingGrid(field);
  return {
    type: "event" as const,
    key,
    preview: true,
    dayFrames: frames,
    raceBefore: grid,
    fieldRace: grid,
    event: { id: key, kind: "transfer" as const, at, borrower: "", who: "", lo: null, detail: null },
  };
}


/**
 * One scene per transfer, even when several arrive in the same poll. Rebuild
 * intermediate standings only when the event credits exactly explain the
 * observed increase. Edits, missing history, a new roster, or an incomplete
 * feed still get a celebration, but never an invented pass.
 */
export function planTransferRaces<T extends TransferRaceEvent>(
  previous: RankRow[] | null,
  current: RankRow[],
  events: T[],
  played: ReadonlySet<string> = new Set(),
): TransferRaceMoment<T>[] {
  const seen = new Set<string>();
  const transfers = events.filter(event => {
    if (event.kind !== "transfer" || !showsFieldRace(event.id) || seen.has(event.id) || played.has(event.id)) return false;
    // No celebration when there is no actual transfer credit for today —
    // metadata edits, old-date rows, and empty feeds must not fire the race.
    const creditRows = event.raceCredits ?? [];
    if (!creditRows.some(row => Number(row.credit) > 0)) return false;
    seen.add(event.id);
    return true;
  });
  const unique = (rows: RankRow[]) => Array.from(new Map(rows.map(row => [row.id, row])).values());
  const final = unique(current);
  const was = new Map((previous ?? []).map(row => [row.id, row]));
  const sameRoster = previous != null && was.size === final.length && final.every(row => was.has(row.id));
  const validIds = new Set(final.map(row => row.id));
  const credits = transfers.map(event => {
    const rows = event.raceCredits ?? [];
    const ids = new Set<number>();
    let total = 0;
    for (const row of rows) {
      if (!Number.isSafeInteger(row.userId) || !Number.isFinite(row.credit) || row.credit <= 0 || row.credit > 1 || ids.has(row.userId)) return [];
      ids.add(row.userId);
      total += row.credit;
    }
    if (total > 1.000001) return [];
    return rows.filter(row => validIds.has(row.userId));
  });
  const totals = new Map<number, number>();
  for (const rows of credits) for (const row of rows) totals.set(row.userId, (totals.get(row.userId) ?? 0) + row.credit);
  const earned = new Set(final.filter(row => {
    const amount = totals.get(row.id) ?? 0;
    return sameRoster && amount > 0 && Math.abs(row.transfersToday - was.get(row.id)!.transfersToday - amount) < .000001;
  }).map(row => row.id));
  let position = final.map(row => ({ ...row, transfersToday: row.transfersToday - (earned.has(row.id) ? totals.get(row.id)! : 0) }));
  return transfers.map((event, index) => {
    const before = sameRoster ? position.map(row => ({ ...row })) : null;
    const increments = new Map(credits[index].filter(row => earned.has(row.userId)).map(row => [row.userId, row.credit]));
    position = position.map(row => ({ ...row, transfersToday: row.transfersToday + (increments.get(row.id) ?? 0) }));
    const named = final.filter(row => row.name === event.who);
    const focusId = event.assistantId != null && validIds.has(event.assistantId)
      ? event.assistantId : named.length === 1 ? named[0].id : undefined;
    return { event, focusId, people: position.map(row => ({ ...row })), before };
  });
}

export function cornerPosition(t: number, lane = 0) {
  const u = Math.max(0, Math.min(1, t));
  const angle = Math.atan2(700 * u, 910);
  return { x: 90 + 910*u - Math.sin(angle)*lane, y: 245 + 350*u*u + Math.cos(angle)*lane,
    angle: angle*180/Math.PI, scale: .45+.8*u };
}

export function fieldStandings<T extends { id: number; name: string; transfersToday: number }>(people: T[]) {
  const sorted = [...people].sort((a,b) => b.transfersToday-a.transfersToday || a.name.localeCompare(b.name));
  const high = sorted[0]?.transfersToday ?? 0;
  const span = Math.max(2, high-(sorted.at(-1)?.transfersToday ?? 0));
  return sorted.map((p,i) => ({ ...p, rank: sorted.findIndex(r=>r.transfersToday===p.transfersToday)+1,
    gap: high-p.transfersToday, depth: 12 + (high-p.transfersToday)/span*54,
    color: `hsl(${(p.id*67)%360} 82% 62%)`, index:i }));
}
