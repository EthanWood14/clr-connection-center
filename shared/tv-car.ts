export type TvCarAppearance = {
  bodyColor: string;
  accentColor: string;
  livery: "stripe" | "double-stripe" | "solid";
};

// Preserve the TV's existing assigned colors until a CLR chooses their own.
export const TV_CAR_COLORS = [
  "#ef6a35", "#49b8ec", "#f1d552", "#97d765", "#a993ff", "#ef5e84",
  "#56d4ba", "#e998ee", "#e8ebe7", "#688bef", "#d6b571", "#67b99a",
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const isColor = (value: unknown): value is string => typeof value === "string" && HEX_COLOR.test(value);
const isLivery = (value: unknown): value is TvCarAppearance["livery"] =>
  value === "stripe" || value === "double-stripe" || value === "solid";

export function defaultTvCarAppearance(userId: number): TvCarAppearance {
  const id = Number.isSafeInteger(userId) ? Math.abs(userId) : 0;
  return { bodyColor: TV_CAR_COLORS[id % TV_CAR_COLORS.length], accentColor: "#f4f2e8", livery: "stripe" };
}

/** Reads are resilient to absent or older stored values; no write is implied. */
export function normalizeTvCarAppearance(raw: unknown, userId: number): TvCarAppearance {
  const fallback = defaultTvCarAppearance(userId);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const value = raw as Record<string, unknown>;
  return {
    bodyColor: isColor(value.bodyColor) ? value.bodyColor.toLowerCase() : fallback.bodyColor,
    accentColor: isColor(value.accentColor) ? value.accentColor.toLowerCase() : fallback.accentColor,
    livery: isLivery(value.livery) ? value.livery : fallback.livery,
  };
}

/** Saves accept only a complete appearance, never an identity or arbitrary CSS. */
export function validateTvCarAppearance(raw: unknown): TvCarAppearance | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys.join(",") !== "accentColor,bodyColor,livery") return null;
  if (!isColor(value.bodyColor) || !isColor(value.accentColor) || !isLivery(value.livery)) return null;
  return { bodyColor: value.bodyColor.toLowerCase(), accentColor: value.accentColor.toLowerCase(), livery: value.livery };
}
