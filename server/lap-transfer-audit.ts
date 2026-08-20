// LAP transfer audit: every Chris Redoble transfer logged in C3, its exact LAP
// package link when one has been chosen, and which optional documents exist.
//
// Until an LOA confirms a link, the two sides are suggested by borrower name.
// Once confirmed, lap_result_transfer_links is authoritative. Pure functions
// here; the caller supplies the rows.

export const AUDIT_WINDOWS = [3, 7, 30, 0] as const; // 0 = all time
export type AuditWindow = (typeof AUDIT_WINDOWS)[number];

export const AUDIT_DOC_TYPES = ["credit_report", "aus", "formal_quote"] as const;
export type AuditDocType = (typeof AUDIT_DOC_TYPES)[number];

export const AUDIT_DOC_LABELS: Record<AuditDocType, string> = {
  credit_report: "Credit report",
  aus: "AUS",
  formal_quote: "Formal quote",
};

export type TransferRow = {
  outcomeId: number;
  date: string;
  borrowerName: string;
  clrName: string | null;
  loaName: string | null;
};

export type PackageRow = {
  packageId: number;
  borrowerName: string;
  resultDate: string;
  documentTypes: string[]; // current (non-removed) documents on the package
  linkedOutcomeIds?: number[];
};

export type AuditRow = TransferRow & {
  packageId: number | null;
  docs: Record<AuditDocType, boolean>;
  submittedCount: number;
  complete: boolean;
  matchType: "linked" | "suggested" | "none";
};

/**
 * Names are typed twice by two different people, so compare them loosely:
 * case, punctuation, honorifics and suffixes all vary ("Jasper Leaven Jr." vs
 * "jasper leaven"). Reduced to alphabetic words, sorted, so word order does not
 * matter either.
 */
export function nameKey(name: string | null | undefined): string {
  const words = String(name ?? "")
    .toLowerCase()
    // Apostrophes are DELETED rather than treated as a separator: "O'Brien" and
    // "OBrien" are the same person, and splitting on the quote would make them
    // two different keys ("brien o" vs "obrien").
    .replace(/['’]/g, "")
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !["mr", "mrs", "ms", "dr", "jr", "sr", "ii", "iii", "iv"].includes(w));
  return words.sort().join(" ");
}

/** ISO date N days back from `todayIso`, inclusive. 0 days = no lower bound. */
export function windowStart(todayIso: string, days: AuditWindow): string | null {
  if (!days) return null;
  const d = new Date(`${todayIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export function windowLabel(days: AuditWindow): string {
  return days === 0 ? "All time" : `Last ${days} days`;
}

/**
 * Join transfers to explicitly linked packages first. Before a link exists,
 * suggest a package by borrower name; for repeat borrowers, the one closest in
 * time wins so a new transfer does not inherit old paperwork.
 */
export function buildAuditRows(transfers: TransferRow[], packages: PackageRow[]): AuditRow[] {
  const byName = new Map<string, PackageRow[]>();
  for (const p of packages) {
    const k = nameKey(p.borrowerName);
    if (!k) continue;
    const list = byName.get(k);
    if (list) list.push(p); else byName.set(k, [p]);
  }

  const dayGap = (a: string, b: string) =>
    Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

  return transfers.map((t) => {
    const linked = packages.find((p) => p.linkedOutcomeIds?.includes(t.outcomeId)) ?? null;
    const candidates = linked ? [] : (byName.get(nameKey(t.borrowerName)) ?? []);
    let match: PackageRow | null = linked;
    for (const candidate of candidates) {
      if (!match || dayGap(candidate.resultDate, t.date) < dayGap(match.resultDate, t.date)) match = candidate;
    }
    const docs = {} as Record<AuditDocType, boolean>;
    for (const d of AUDIT_DOC_TYPES) docs[d] = !!match?.documentTypes.includes(d);
    const submittedCount = AUDIT_DOC_TYPES.filter((d) => docs[d]).length;
    return {
      ...t,
      packageId: match?.packageId ?? null,
      docs,
      submittedCount,
      complete: submittedCount === AUDIT_DOC_TYPES.length,
      matchType: linked ? "linked" : match ? "suggested" : "none",
    };
  });
}

export function auditSummary(rows: AuditRow[]): {
  transfers: number; complete: number; partial: number; missing: number; completionPct: number;
} {
  const complete = rows.filter((r) => r.complete).length;
  const missing = rows.filter((r) => r.submittedCount === 0).length;
  return {
    transfers: rows.length,
    complete,
    partial: rows.length - complete - missing,
    missing,
    completionPct: rows.length ? Math.round((complete / rows.length) * 100) : 0,
  };
}
