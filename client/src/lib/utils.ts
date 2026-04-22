import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// SQLite stores timestamps without a 'Z' suffix, so JS parses them as local
// time. Normalize to UTC before calling new Date().
export function parseDbTimestamp(ts: string | number | Date | null | undefined): Date | null {
  if (ts == null || ts === "") return null;
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  if (typeof ts === "number") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = ts.trim();
  if (!s) return null;
  const normalized = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
    ? s
    : s.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}
