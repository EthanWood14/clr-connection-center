export type LapDocumentType = "credit_report" | "aus" | "formal_quote";
export type LapFileKey = "creditReport" | "aus" | "formalQuote";

export interface LapResultFile {
  id: number;
  documentType?: LapDocumentType;
  filename: string;
  mime: string | null;
  sizeBytes: number;
  sha256?: string | null;
  uploadedBy?: number | null;
  uploadedByName?: string | null;
  uploadedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  version?: number | null;
}

export interface LapResult {
  id: number;
  borrowerName: string;
  dealReference: string | null;
  loanOfficerId: number | null;
  loanOfficerName: string | null;
  notes: string | null;
  resultDate: string | null;
  status: string;
  createdBy: number | null;
  createdByName: string | null;
  updatedBy: number | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  files: Record<LapFileKey, LapResultFile | null>;
  complete: boolean;
}

export interface LapResultPayload {
  borrowerName: string;
  dealReference?: string | null;
  loanOfficerId?: number | null;
  notes?: string | null;
  resultDate?: string | null;
}

export interface LapPeriodStats {
  total: number;
  complete: number;
  incomplete: number;
  creditReports: number;
  aus: number;
  formalQuotes: number;
}

export const LAP_DOCUMENTS: Array<{
  type: LapDocumentType;
  key: LapFileKey;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    type: "credit_report",
    key: "creditReport",
    label: "Credit Report",
    shortLabel: "Credit",
    description: "Borrower credit report or tri-merge PDF",
  },
  {
    type: "aus",
    key: "aus",
    label: "AUS",
    shortLabel: "AUS",
    description: "Current underwriting findings",
  },
  {
    type: "formal_quote",
    key: "formalQuote",
    label: "Formal Quote",
    shortLabel: "Quote",
    description: "Final borrower-facing quote package",
  },
];

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(body?.error || body?.message || response.statusText || "Request failed");
}

export async function lapRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function unwrapLapResults(value: unknown): LapResult[] {
  if (Array.isArray(value)) return value as LapResult[];
  const record = value as any;
  if (Array.isArray(record?.results)) return record.results;
  if (Array.isArray(record?.items)) return record.items;
  return [];
}

export function unwrapLapResult(value: unknown): LapResult {
  return ((value as any)?.result ?? value) as LapResult;
}

export async function uploadLapResultFile(
  resultId: number,
  documentType: LapDocumentType,
  file: File,
): Promise<unknown> {
  const safeFilename = file.name.replace(/[^\x20-\x7E]/g, "_").slice(0, 220) || "document";
  const response = await fetch(`/api/lap/results/${resultId}/files/${documentType}`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": safeFilename,
    },
    body: file,
  });
  if (!response.ok) throw await responseError(response);
  return response.status === 204 ? undefined : response.json();
}

export async function deleteLapResultFile(fileId: number): Promise<void> {
  const response = await fetch(`/api/lap/result-files/${fileId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw await responseError(response);
}

export async function downloadLapResultFile(file: LapResultFile): Promise<void> {
  const response = await fetch(`/api/lap/result-files/${file.id}/download`, {
    credentials: "include",
  });
  if (!response.ok) throw await responseError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename || "document";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function formatLapBytes(value?: number | null): string {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function formatLapDate(value?: string | null, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", withTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" }
  ).format(date);
}

function numberFrom(source: any, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

export function normalizeLapPeriodStats(source: unknown): LapPeriodStats {
  const value = source as any;
  const total = numberFrom(value, "total", "packages", "resultCount", "results");
  const complete = numberFrom(value, "complete", "completed", "completePackages");
  return {
    total,
    complete,
    incomplete: numberFrom(value, "incomplete", "incompletePackages") || Math.max(0, total - complete),
    creditReports: numberFrom(value, "creditReports", "creditReport", "credit_report"),
    aus: numberFrom(value, "aus", "ausFiles", "ausCount"),
    formalQuotes: numberFrom(value, "formalQuotes", "formalQuote", "formal_quote"),
  };
}

export function getLapStatsPeriod(source: unknown, period: "today" | "week" | "month" | "allTime"): LapPeriodStats {
  const value = source as any;
  const periods = value?.periods && typeof value.periods === "object" ? value.periods : value;
  const aliases: Record<typeof period, string[]> = {
    today: ["today", "day"],
    week: ["week", "thisWeek", "weekly"],
    month: ["month", "thisMonth", "monthly"],
    allTime: ["allTime", "all_time", "overall", "total"],
  };
  for (const key of aliases[period]) {
    if (periods?.[key] && typeof periods[key] === "object") return normalizeLapPeriodStats(periods[key]);
  }
  return normalizeLapPeriodStats(value);
}
