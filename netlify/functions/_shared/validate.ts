/**
 * Pure shape validation for a submitted Supercut payload — shared between
 * `publish.mts` and its tests (no Netlify runtime dependencies, so it's
 * directly unit-testable with vitest).
 */

import type { Event, Supercut } from '../../../src/lib/types';

/**
 * The publish payload's real size limit — enforced by `publish.mts` against
 * the raw request body before it's even parsed as JSON, and checked by the
 * CLI (`scripts/dailies.ts`) against the serialized body before it sends, so
 * an oversized payload fails fast with a clear message instead of a 413.
 * There is no separate event-count cap — see `validateSupercutShape`.
 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

/** The server's slug shape: 10 lowercase base32 (RFC 4648, no padding) characters — see `generateSlug` in `src/lib/store.ts`. */
const SLUG_RE = /^[a-z2-7]{10}$/;

/** True when `value` is a string matching the required slug shape (used to validate a client-supplied `--update` slug). */
export function isValidSlugShape(value: unknown): value is string {
  return typeof value === 'string' && SLUG_RE.test(value);
}

const STRING_FIELDS = ['title', 'sessionId', 'project', 'startedAt', 'endedAt'] as const;
const ARRAY_FIELDS = ['events', 'chapters', 'cast', 'files'] as const;

/** The full set of `Event['kind']` values (see src/lib/types.ts). */
const KNOWN_EVENT_KINDS = new Set<Event['kind']>(['prompt', 'reply', 'tool', 'commit', 'spawn', 'milestone']);

export type ValidationResult = { ok: true; value: Supercut } | { ok: false; error: string };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Minimal per-event shape check: every event must be an object with a
 * numeric `i`, a string `t`, and a `kind` in the known set. This does not
 * validate kind-specific fields (e.g. a `tool` event's `label`) — the
 * parser remains the trusted producer of those; this endpoint only needs to
 * reject obviously-malformed or forged events.
 */
export function isValidEventShape(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.i !== 'number') return false;
  if (typeof value.t !== 'string') return false;
  if (typeof value.kind !== 'string' || !KNOWN_EVENT_KINDS.has(value.kind as Event['kind'])) return false;
  return true;
}

/** True when `value` is an integer event index within `[0, eventCount)`. */
function isValidEventIndex(value: unknown, eventCount: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < eventCount;
}

/**
 * Validates the top-level shape the spec requires (version, string fields,
 * array fields, a stats object), rejects the request if any event doesn't
 * pass `isValidEventShape`, and guards that every chapter's `startIndex`/
 * `endIndex` and every narration highlight's `eventIndex` (when a
 * `narration` is present) fall within `[0, events.length)`: referenced
 * chapter and highlight indexes must fit the submitted events. Payload size
 * is capped by `MAX_BODY_BYTES`, not an event count. Does not otherwise
 * deep-validate cast/chapter/file shapes — the parser is the only trusted
 * producer of those, and this endpoint only needs to keep out obviously
 * malformed or internally-inconsistent payloads.
 */
export function validateSupercutShape(body: unknown): ValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }

  if (body.version !== 1) {
    return { ok: false, error: 'version must be 1' };
  }

  for (const field of STRING_FIELDS) {
    if (typeof body[field] !== 'string') {
      return { ok: false, error: `${field} must be a string` };
    }
  }

  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(body[field])) {
      return { ok: false, error: `${field} must be an array` };
    }
  }

  if (!isPlainObject(body.stats)) {
    return { ok: false, error: 'stats must be an object' };
  }

  const events = body.events as unknown[];
  for (const event of events) {
    if (!isValidEventShape(event)) {
      return { ok: false, error: 'events contains a malformed entry' };
    }
  }

  const eventCount = events.length;

  for (const chapter of body.chapters as unknown[]) {
    if (!isPlainObject(chapter)) {
      return { ok: false, error: 'chapters contains a malformed entry' };
    }
    if (!isValidEventIndex(chapter.startIndex, eventCount) || !isValidEventIndex(chapter.endIndex, eventCount)) {
      return { ok: false, error: 'chapter startIndex/endIndex out of range' };
    }
  }

  if (body.narration !== undefined) {
    if (!isPlainObject(body.narration) || !Array.isArray(body.narration.highlights)) {
      return { ok: false, error: 'narration must be an object with a highlights array' };
    }
    for (const highlight of body.narration.highlights) {
      if (!isPlainObject(highlight) || !isValidEventIndex(highlight.eventIndex, eventCount)) {
        return { ok: false, error: 'narration highlight eventIndex out of range' };
      }
    }
  }

  const supercut: Supercut = {
    version: 1,
    slug: '', // assigned server-side by the caller
    title: body.title as string,
    sessionId: body.sessionId as string,
    project: body.project as string,
    startedAt: body.startedAt as string,
    endedAt: body.endedAt as string,
    stats: body.stats as unknown as Supercut['stats'],
    cast: body.cast as Supercut['cast'],
    chapters: body.chapters as Supercut['chapters'],
    events: events as Supercut['events'],
    files: body.files as Supercut['files'],
  };

  return { ok: true, value: supercut };
}
