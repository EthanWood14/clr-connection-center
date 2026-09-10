/**
 * A read-only statistics feed a Claude session can consume.
 *
 * Every "how are we doing" question in this repo has so far been answered by
 * someone with a database shell writing a one-off query, and half of those
 * questions were answered WRONG on the first attempt because the traps are
 * not visible in the numbers: nested windows read as a collapse that is not
 * real, Elleine is excluded from every team total, a partial week looks like
 * a spike. So this endpoint does not just return figures. It returns the
 * figures AND the caveats that make them readable, in the same payload, in a
 * `definitions` block written for a machine that has no other context.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CONTAIN ─────────────────────────────────
 * NO BORROWER DATA. No names, no phone numbers, no addresses, no notes,
 * nothing from a write-up. Only counts, and the names of staff and loan
 * officers who appear in them.
 *
 * That is the whole security design, not a detail. A token handed to an
 * automated session will eventually end up somewhere it should not be — in a
 * transcript, a log, a config file, a screenshot. The question to answer
 * first is therefore not "how do we stop the token leaking" but "what does a
 * leaked token get". Here it gets internal performance statistics, which are
 * embarrassing rather than reportable, and it gets nothing that belongs to a
 * borrower. Any future addition to this file has to keep that true.
 */

export type ClrPeriod = {
  period: string;
  transfers: number;
  clrsWorking: number;
  clrDays: number;
  avgPerClr: number;
  avgPerClrDay: number;
  helperTransfers: number;
  /** False while the period is still running — a partial week is not a dip. */
  complete: boolean;
};

export type OutcomeRow = {
  date: string;
  assistantId: number;
  outcomeType: string;
  loId?: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monday of the week a YYYY-MM-DD falls in. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  // getUTCDay: 0 = Sunday. Monday-start weeks match every other window in C3.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export const monthStartOf = (date: string) => String(date ?? "").slice(0, 7);

/**
 * Roll outcomes up per period.
 *
 * `helperId` is counted SEPARATELY and left out of every team figure, which
 * mirrors what the rest of C3 does with an exclude_from_stats CLR. Reporting
 * her inside the average would move it by a factor of two and describe
 * nobody: she does five to six times what an average CLR does.
 *
 * The denominator is CLR-DAYS, not headcount — days somebody actually logged
 * work. Headcount flatters a month somebody joined halfway through and
 * punishes a week with a holiday in it.
 */
export function rollUp(
  rows: OutcomeRow[],
  bucket: (date: string) => string,
  helperId: number | null,
  isComplete: (period: string) => boolean,
): ClrPeriod[] {
  type Acc = { transfers: number; helper: number; days: Map<number, Set<string>> };
  const byPeriod = new Map<string, Acc>();

  for (const r of rows ?? []) {
    const period = bucket(String(r.date ?? ""));
    if (!period) continue;
    const acc = byPeriod.get(period) ?? { transfers: 0, helper: 0, days: new Map() };
    const isHelper = helperId != null && Number(r.assistantId) === helperId;
    if (r.outcomeType === "transfer") {
      if (isHelper) acc.helper += 1;
      else acc.transfers += 1;
    }
    if (!isHelper) {
      const seen = acc.days.get(Number(r.assistantId)) ?? new Set<string>();
      seen.add(String(r.date));
      acc.days.set(Number(r.assistantId), seen);
    }
    byPeriod.set(period, acc);
  }

  return Array.from(byPeriod.entries())
    .map(([period, acc]) => {
      const clrsWorking = acc.days.size;
      const clrDays = Array.from(acc.days.values()).reduce((n, s) => n + s.size, 0);
      return {
        period,
        transfers: acc.transfers,
        clrsWorking,
        clrDays,
        avgPerClr: clrsWorking ? round1(acc.transfers / clrsWorking) : 0,
        avgPerClrDay: clrDays ? round2(acc.transfers / clrDays) : 0,
        helperTransfers: acc.helper,
        complete: isComplete(period),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * The caveats, shipped with the numbers.
 *
 * Each one is here because it has already been got wrong by somebody reading
 * these figures — including me. A reader with no other context should be able
 * to answer "is this dropping?" correctly from the payload alone.
 */
export function definitionsFor(helperName: string, helperExcluded: boolean) {
  return {
    transfers: "A logged outcome of type 'transfer': the CLR got the borrower onto the phone with a loan officer, or booked a time for one to call them back.",
    avgPerClr: "transfers / the number of CLRs who logged anything in the period. Moves with headcount, which has grown from 2 to 13 since April — do not read it as productivity.",
    avgPerClrDay:
      "transfers / CLR-days, where a CLR-day is one CLR logging anything on one day. THIS IS THE FIGURE TO COMPARE ACROSS PERIODS: it is unaffected by headcount, holidays, part-timers or a period being partly elapsed.",
    complete:
      "False when the period has not finished. An incomplete period's totals are a floor, never a trend. The most common mistake with this data is reading the current partial week as a fall.",
    helperTransfers: helperExcluded
      ? `${helperName} is flagged exclude_from_stats and is NOT in any team figure above. She is reported separately here because she is not one CLR among many — she runs at roughly five to six times an average CLR, and folding her in would describe nobody.`
      : `${helperName} could not be resolved to a single active user, so no separate figure is available and everyone is counted together.`,
    nestedWindows:
      "If you compare windows of different lengths (last 7 days vs last 90), shorter windows contain younger records that have had less time to convert, and the rate will look like it is collapsing when it is not. Compare like-for-like periods from this feed instead.",
    shotgunCredit:
      "A shotgun lead can be shared between two CLRs, in which case C3 records half a transfer each. These are whole row counts. On production no transfer has ever carried a shotgun sender, so the two agree today — but do not assume that holds.",
    privacy: "This feed contains no borrower data of any kind: no names, phone numbers, addresses or write-up text. Only counts, and the names of staff and loan officers.",
  };
}
