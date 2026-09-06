/**
 * POST /api/publish — accepts a Supercut produced by the local CLI
 * (`scripts/dailies.ts`), assigns it a server-generated slug, stores it in
 * Netlify Blobs, and returns its published URL.
 */

import type { Config } from '@netlify/functions';
import { narrate } from '../../src/lib/narrate';
import { generateSlug, putSupercut } from '../../src/lib/store';
import type { Supercut } from '../../src/lib/types';
import { checkAuthToken, jsonResponse } from './_shared/auth';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_EVENTS = 5000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authError = checkAuthToken(req);
  if (authError) return authError;

  const contentLength = req.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Payload too large' }, 413);
  }

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Payload too large' }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validation = validateSupercutShape(body);
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 400);
  }

  const supercut = validation.value;
  // Server-assigned, never trust a client-provided slug.
  supercut.slug = generateSlug();

  try {
    supercut.narration = await narrate(supercut);
  } catch (err) {
    // Narration is best-effort — never let it block publish.
    console.error('narrate() failed, publishing without narration:', err);
  }

  await putSupercut(supercut);

  const url = `${new URL(req.url).origin}/s/${supercut.slug}`;
  return jsonResponse({ slug: supercut.slug, url }, 201);
};

export const config: Config = {
  path: '/api/publish',
  method: ['POST'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ValidationResult = { ok: true; value: Supercut } | { ok: false; error: string };

const STRING_FIELDS = ['title', 'sessionId', 'project', 'startedAt', 'endedAt'] as const;
const ARRAY_FIELDS = ['events', 'chapters', 'cast', 'files'] as const;

/**
 * Validates the top-level shape the spec requires (version, string fields,
 * array fields, a stats object) and caps `events` at `MAX_EVENTS`. Does not
 * deep-validate individual event/cast/chapter/file shapes — the parser is
 * the only trusted producer of those, and this endpoint only needs to keep
 * out obviously-malformed payloads.
 */
function validateSupercutShape(body: unknown): ValidationResult {
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

  const supercut: Supercut = {
    version: 1,
    slug: '', // assigned server-side below
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
