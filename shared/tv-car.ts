import { validateTvCarSkin, type TvCarSkin } from "./tv-car-skin";

export type TvCarAppearance = {
  bodyColor: string;
  accentColor: string;
  livery: "stripe" | "double-stripe" | "solid";
  /** Read-only, server-issued authenticated image URL. Never supplied by color saves. */
  wrapUrl?: string;
  /** Authored pixel panels take visual precedence without deleting a saved photo. */
  skin?: TvCarSkin;
};

export const TV_CAR_WRAP_MAX_BYTES = 1024 * 1024;
export const TV_CAR_WRAP_MAX_EDGE = 1024;

/** Only our self-service or revocable-TV image routes may become a texture. */
export function isSafeTvCarWrapUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256
    && /^\/api\/(?:me\/tv-car\/wrap|tv\/[A-Za-z0-9_-]{16,64}\/cars\/[1-9][0-9]{0,15}\/wrap)\?v=[a-f0-9]{64}$/.test(value);
}

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
  const skin = validateTvCarSkin(value.skin);
  return {
    bodyColor: isColor(value.bodyColor) ? value.bodyColor.toLowerCase() : fallback.bodyColor,
    accentColor: isColor(value.accentColor) ? value.accentColor.toLowerCase() : fallback.accentColor,
    livery: isLivery(value.livery) ? value.livery : fallback.livery,
    ...(isSafeTvCarWrapUrl(value.wrapUrl) ? { wrapUrl: value.wrapUrl } : {}),
    ...(skin ? { skin } : {}),
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
