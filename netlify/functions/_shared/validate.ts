/**
 * Pure shape validation for a submitted Supercut payload — shared between
 * `publish.mts` and its tests (no Netlify runtime dependencies, so it's
 * directly unit-testable with vitest).
 */

import type { Event, Supercut } from '../../../src/lib/types';

const MAX_EVENTS = 5000;

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

/**
 * Validates the top-level shape the spec requires (version, string fields,
 * array fields, a stats object), rejects the request if any event doesn't
 * pass `isValidEventShape`, and caps `events` at `MAX_EVENTS`. Does not
 * deep-validate cast/chapter/file shapes — the parser is the only trusted
 * producer of those, and this endpoint only needs to keep out obviously
 * malformed payloads.
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

  const events = (body.events as unknown[]).slice(0, MAX_EVENTS);
  for (const event of events) {
    if (!isValidEventShape(event)) {
      return { ok: false, error: 'events contains a malformed entry' };
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
