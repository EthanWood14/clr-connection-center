/**
 * Transfers per loan officer, split by who sent them.
 *
 * The question this answers (Ethan, 10 Sep 2026): how many transfers has each
 * LO been given today, this week, this month and ever — and how much of that
 * is Elleine rather than the rest of the floor.
 *
 * It matters because Elleine is not one CLR among fifteen. Since 1 August she
 * has logged 579 transfers; the next busiest CLR logged 238. An LO who looks
 * well fed can be well fed BY ONE PERSON, and that is a different fact from
 * being well fed by the team — it is a single point of failure, and it is
 * invisible in a plain top-LOs list.
 *
 * ── WHO COUNTS AS THE HELPER ──────────────────────────────────────────────
 * The name comes from the org setting (email_settings.helper_name, default
 * "Elleine"), never a hard-coded id, because the person in that seat can
 * change and a hard-coded 15 would keep pointing at her after she moved.
 *
 * The name is resolved to exactly ONE active user or to nobody. A partial
 * match that hits two people is treated as no match at all: attributing half
 * the floor's work to the wrong person is worse than saying the split is
 * unavailable, and the caller can say which it is.
 *
 * ── WHAT IS COUNTED ───────────────────────────────────────────────────────
 * ROWS, not credit. One transfer is one transfer to the LO who received it,
 * however it was shared between CLRs — a shotgun lead that is half Elleine's
 * and half somebody else's is still ONE borrower who reached that LO, and
 * splitting the row into halves here would make the LO's own total stop
 * matching the number of people who called them. The split therefore keys on
 * who LOGGED the transfer, which is also who was on the phone.
 */

export const LO_SPLIT_WINDOWS = ["today", "week", "month", "all"] as const;
export type LoSplitWindow = (typeof LO_SPLIT_WINDOWS)[number];

export const LO_SPLIT_WINDOW_LABELS: Record<LoSplitWindow, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

export type LoSplitRow = {
  loId: number;
  name: string;
  /** Transfers logged by the named helper. */
  helper: number;
  /** Transfers logged by everybody else. */
  others: number;
  total: number;
};

export type LoSplitWindows = Record<LoSplitWindow, LoSplitRow[]>;

export type LoSplitResult = {
  /** The helper's display name, whether or not one was resolved. */
  helperName: string;
  /** Null when the name matched nobody, or matched more than one person. */
  helperUserId: number | null;
  /**
   * Why there is no split, in words, or null when there is one. Shown instead
   * of a column of zeroes — "Elleine sent none of these" and "we could not
   * work out who Elleine is" must not look the same.
   */
  helperNotice: string | null;
  windows: LoSplitWindows;
};

type UserLike = { id: number; name?: string | null; isActive?: unknown; is_active?: unknown };

const active = (u: UserLike) => {
  const v = u.isActive ?? u.is_active;
  return v === undefined || v === null || v === 1 || v === true;
};

const normalise = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The one active user the helper name refers to, or null.
 *
 * Full name first, then first name — "Elleine" is what the setting holds and
 * "Elleine Asuncion" is what the user row holds. Two matches is null, not a
 * coin toss.
 */
export function resolveHelperUserId(users: UserLike[], helperName: unknown): number | null {
  const wanted = normalise(helperName);
  if (!wanted) return null;
  const pool = (users ?? []).filter(active);

  const exact = pool.filter((u) => normalise(u.name) === wanted);
  if (exact.length === 1) return Number(exact[0].id);
  if (exact.length > 1) return null;

  // First name, matched as a whole word so "Elle" cannot claim "Elleine".
  const byFirst = pool.filter((u) => normalise(u.name).split(" ")[0] === wanted);
  return byFirst.length === 1 ? Number(byFirst[0].id) : null;
}

/** The sentence to show when there is no split to show. */
export function helperNoticeFor(helperName: string, helperUserId: number | null): string | null {
  if (helperUserId != null) return null;
  return `No active user matches "${helperName}", so these cannot be split. Set the helper's name in Settings.`;
}

type RawRow = {
  lo_id: unknown;
  name: unknown;
  window: unknown;
  assistant_id: unknown;
};

/**
 * Fold the flat "one row per transfer per window" result into the four lists.
 *
 * The SQL emits a row per (loan officer, window) pair rather than four
 * separate queries: the all-time window has no date bound, so running it four
 * times over would read the whole transfer table four times for three answers
 * that are subsets of it.
 */
export function foldLoSplitRows(rows: RawRow[], helperUserId: number | null): LoSplitWindows {
  const out: LoSplitWindows = { today: [], week: [], month: [], all: [] };
  const byWindow = new Map<LoSplitWindow, Map<number, LoSplitRow>>();
  for (const w of LO_SPLIT_WINDOWS) byWindow.set(w, new Map());

  for (const r of rows ?? []) {
    const window = String(r.window ?? "") as LoSplitWindow;
    const bucket = byWindow.get(window);
    if (!bucket) continue;
    const loId = Number(r.lo_id);
    if (!Number.isFinite(loId) || loId <= 0) continue;
    const existing = bucket.get(loId) ?? {
      loId, name: String(r.name ?? "") || `LO #${loId}`, helper: 0, others: 0, total: 0,
    };
    const isHelper = helperUserId != null && Number(r.assistant_id) === helperUserId;
    if (isHelper) existing.helper += 1;
    else existing.others += 1;
    existing.total += 1;
    bucket.set(loId, existing);
  }

  for (const w of LO_SPLIT_WINDOWS) {
    out[w] = Array.from(byWindow.get(w)!.values())
      // Busiest first, then by name so equal totals do not shuffle between
      // refreshes — a table that reorders itself under the cursor is unusable.
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }
  return out;
}

/** Column totals, so the table can foot itself without the client re-adding. */
export function totalsFor(rows: LoSplitRow[]): { helper: number; others: number; total: number } {
  return (rows ?? []).reduce(
    (acc, r) => ({ helper: acc.helper + r.helper, others: acc.others + r.others, total: acc.total + r.total }),
    { helper: 0, others: 0, total: 0 },
  );
}
