/**
 * Parses and validates the narration model's reply. Never throws — a
 * malformed or garbage reply just yields `undefined`, and the caller
 * publishes without narration (see `netlify/functions/narrate-background.mts`).
 */

import type { Narration } from '../types';
import { NARRATION_MODEL } from './model';

const MAX_HIGHLIGHTS = 6;
const MAX_TITLE_LEN = 80;

/** Strips a ```json ... ``` or ``` ... ``` fence, if the whole reply is wrapped in one. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shared JSON.parse + fence-strip step used by both exports below. */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return undefined;
  }
  return isPlainObject(parsed) ? parsed : undefined;
}

/**
 * Validates the model's reply into a `Narration`. Requires a non-empty
 * `synopsis` and a `highlights` array; each highlight's `eventIndex` is
 * clamped to `[0, eventCount)` (out-of-range entries are dropped),
 * duplicate `eventIndex` values are deduped (first wins), and the result is
 * capped at `MAX_HIGHLIGHTS` entries. Returns `undefined` for anything that
 * doesn't parse as JSON, isn't an object, or is missing a usable synopsis.
 */
export function parseNarrationResponse(text: string, eventCount: number): Narration | undefined {
  const obj = parseJsonObject(text);
  if (!obj) return undefined;

  const synopsis = typeof obj.synopsis === 'string' ? obj.synopsis.trim() : '';
  if (!synopsis) return undefined;

  if (!Array.isArray(obj.highlights)) return undefined;

  const seen = new Set<number>();
  const highlights: Narration['highlights'] = [];

  for (const raw of obj.highlights) {
    if (highlights.length >= MAX_HIGHLIGHTS) break;
    if (!isPlainObject(raw)) continue;

    const eventIndex = raw.eventIndex;
    const highlightText = raw.text;

    if (typeof eventIndex !== 'number' || !Number.isInteger(eventIndex)) continue;
    if (eventIndex < 0 || eventIndex >= eventCount) continue;
    if (seen.has(eventIndex)) continue;
    if (typeof highlightText !== 'string' || !highlightText.trim()) continue;

    seen.add(eventIndex);
    highlights.push({ eventIndex, text: highlightText.trim() });
  }

  return { synopsis, highlights, generatedBy: NARRATION_MODEL };
}

/**
 * Pulls the model's suggested title out of the same reply, independently of
 * `parseNarrationResponse` — the caller applies it to `Supercut.title`
 * directly (it isn't part of the `Narration` type). Returns `undefined` if
 * the reply doesn't parse, or the title is missing, empty, or over 80 chars.
 */
export function parseNarrationTitle(text: string): string | undefined {
  const obj = parseJsonObject(text);
  if (!obj) return undefined;

  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LEN) return undefined;
  return title;
}
