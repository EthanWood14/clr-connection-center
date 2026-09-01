/**
 * The training walkthrough, once it stopped being source code.
 *
 * The words were a constant in shared/clr-training.ts, so the only way to fix a
 * typo in Matt Lane's own training plan was to open a pull request. This module
 * is what lets him edit it himself: the shape of a saved document, the rules a
 * save has to satisfy, and the seed the first version is built from.
 *
 * Validation is strict on STRUCTURE and permissive on WORDS. It is his
 * document; the limits exist only to stop a paste accident wrecking the page
 * for everybody else, not to police how he writes. Every string is rendered as
 * text by React, never as markup, so escaping is not this module's job.
 */
import { TRAINING_DAYS, type TrainingDay } from "./clr-training";

/** Generous, and a very long way past anything a real day needs. */
export const TRAINING_LIMITS = {
  maxDays: 30,
  maxStepsPerHalf: 40,
  maxStepChars: 4_000,
  maxShortChars: 500,
} as const;

export interface TrainingManual {
  days: TrainingDay[];
  /** Who last saved it, for the byline on the page. */
  authorName: string;
}

export interface TrainingVersion extends TrainingManual {
  id: number;
  savedAt: string;
  savedByName: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** One editable field, trimmed and capped. */
function cleanLine(v: unknown, max: number): string {
  return str(v).replace(/\r\n?/g, "\n").trim().slice(0, max);
}

/** A list of steps: blanks dropped, because an empty bullet renders as a dot. */
function cleanSteps(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => cleanLine(s, TRAINING_LIMITS.maxStepChars))
    .filter((s) => s.length > 0)
    .slice(0, TRAINING_LIMITS.maxStepsPerHalf);
}

export interface ParseResult {
  ok: boolean;
  days: TrainingDay[];
  error?: string;
}

/**
 * Turn whatever arrived over the wire into days worth saving.
 *
 * Rejects rather than repairs when the shape is wrong: silently saving a
 * half-understood document would lose work without telling anyone. Within a
 * day that IS the right shape, empty steps are dropped quietly — that is
 * someone clearing a line, not an error.
 */
export function parseTrainingDays(input: unknown): ParseResult {
  if (!Array.isArray(input)) return { ok: false, days: [], error: "Expected a list of days." };
  if (!input.length) return { ok: false, days: [], error: "A training plan needs at least one day." };
  if (input.length > TRAINING_LIMITS.maxDays) {
    return { ok: false, days: [], error: `That is more than ${TRAINING_LIMITS.maxDays} days.` };
  }

  const days: TrainingDay[] = [];
  const seen = new Set<number>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { ok: false, days: [], error: "Every day must be an object." };
    const r = raw as Record<string, unknown>;
    const day = Number(r.day);
    if (!Number.isInteger(day) || day < 1 || day > TRAINING_LIMITS.maxDays) {
      return { ok: false, days: [], error: `"${String(r.day)}" is not a valid day number.` };
    }
    if (seen.has(day)) return { ok: false, days: [], error: `Day ${day} appears twice.` };
    seen.add(day);
    const week = Number(r.week) === 2 ? 2 : 1;
    const morning = cleanSteps(r.morning);
    const afternoon = cleanSteps(r.afternoon);
    if (!morning.length && !afternoon.length) {
      return { ok: false, days: [], error: `Day ${day} has nothing in it.` };
    }
    days.push({
      day,
      week: week as 1 | 2,
      morning,
      afternoon,
      lunchNote: cleanLine(r.lunchNote, TRAINING_LIMITS.maxShortChars),
      eod: cleanLine(r.eod, TRAINING_LIMITS.maxShortChars),
    });
  }

  // Day order is the reading order; a save must not be able to shuffle it.
  days.sort((a, b) => a.day - b.day);
  return { ok: true, days };
}

/** Parse a stored row, falling back to the seed rather than an empty page. */
export function readStoredManual(content: unknown): TrainingDay[] {
  const raw = typeof content === "string" ? safeJson(content) : content;
  const parsed = parseTrainingDays(raw);
  return parsed.ok ? parsed.days : TRAINING_DAYS;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Who may change it.
 *
 * A per-user grant rather than a role, mirroring can_publish_shotgun: Matt Lane
 * owns this document and is an assistant, so tying it to manager rights would
 * mean handing him the rest of the manager surface to let him fix a typo.
 */
export function canEditTraining(user: unknown): boolean {
  const u = (user ?? {}) as Record<string, any>;
  if (u.role === "admin") return true;
  if (u.superAdmin ?? u.super_admin) return true;
  return !!(u.canEditTraining ?? u.can_edit_training);
}
