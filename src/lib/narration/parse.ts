/**
 * Parses and validates the narration model's reply. Never throws — a
 * malformed or garbage reply just yields an empty result, and the caller
 * publishes without narration (see `netlify/functions/narrate-background.mts`).
 */

import type { Narration } from '../types';
import { NARRATION_MODEL } from './model';

const MAX_HIGHLIGHTS = 6;
const MIN_EXPECTED_HIGHLIGHTS = 3;
const MAX_TITLE_LEN = 80;
const MAX_SYNOPSIS_WORDS = 60;

/** Strips a ```json ... ``` or ``` ... ``` fence, if the whole reply is wrapped in one. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shared JSON.parse + fence-strip step. */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    return undefined;
  }
  return isPlainObject(parsed) ? parsed : undefined;
}

/** Trims a synopsis over `MAX_SYNOPSIS_WORDS` words at a word boundary, appending "…". */
function trimSynopsis(synopsis: string): string {
  const words = synopsis.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_SYNOPSIS_WORDS) return synopsis;
  return `${words.slice(0, MAX_SYNOPSIS_WORDS).join(' ')}…`;
}

export interface ParseNarrationResult {
  /** Present only when the reply had a usable synopsis and at least one valid highlight. */
  narration?: Narration;
  /** The model's suggested title, applied by the caller to `Supercut.title`. */
  title?: string;
  /** Non-fatal issues worth logging — e.g. "only 2 highlights". Always present, possibly empty. */
  warnings: string[];
}

/**
 * Parses the narration model's raw reply into a `Narration` and a suggested
 * title in one pass.
 *
 * `narration` is set only when the reply parses as a JSON object with a
 * non-empty `synopsis` and at least one highlight survives validation: each
 * highlight's `eventIndex` must be an integer in `[0, eventCount)`, duplicate
 * `eventIndex` values are deduped (first wins), and the list is capped at
 * `MAX_HIGHLIGHTS`. An over-long synopsis is trimmed to `MAX_SYNOPSIS_WORDS`
 * words at a word boundary rather than rejected.
 *
 * `title` is set independently — it's usable even when `narration` isn't —
 * when the reply has a non-empty `title` no longer than `MAX_TITLE_LEN`.
 */
export function parseNarration(text: string, eventCount: number): ParseNarrationResult {
  const warnings: string[] = [];

  const obj = parseJsonObject(text);
  if (!obj) {
    warnings.push('reply did not parse as a JSON object');
    return { warnings };
  }

  const rawSynopsis = typeof obj.synopsis === 'string' ? obj.synopsis.trim() : '';
  const synopsis = rawSynopsis ? trimSynopsis(rawSynopsis) : '';

  const rawHighlights = Array.isArray(obj.highlights) ? obj.highlights : [];
  const seen = new Set<number>();
  const highlights: Narration['highlights'] = [];

  for (const raw of rawHighlights) {
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

  const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
  const title = rawTitle && rawTitle.length <= MAX_TITLE_LEN ? rawTitle : undefined;
  if (rawTitle && rawTitle.length > MAX_TITLE_LEN) {
    warnings.push(`title is ${rawTitle.length} characters, over the ${MAX_TITLE_LEN} cap — ignored`);
  }

  if (!synopsis) {
    warnings.push('synopsis missing or empty');
    return { title, warnings };
  }
  if (highlights.length === 0) {
    warnings.push('no valid highlights survived filtering');
    return { title, warnings };
  }
  if (highlights.length < MIN_EXPECTED_HIGHLIGHTS) {
    warnings.push(`only ${highlights.length} highlight${highlights.length === 1 ? '' : 's'}`);
  }

  return { narration: { synopsis, highlights, generatedBy: NARRATION_MODEL }, title, warnings };
}
