/**
 * POST /api/publish — accepts a Supercut produced by the local CLI
 * (`scripts/dailies.ts`), assigns it a server-generated slug, stores it in
 * Netlify Blobs, and returns its published URL.
 */

import type { Config } from '@netlify/functions';
import { narrate } from '../../src/lib/narrate';
import { deepRedact } from '../../src/lib/parse/redact';
import { generateSlug, putSupercut } from '../../src/lib/store';
import { checkAuthToken, jsonResponse } from './_shared/auth';
import { validateSupercutShape } from './_shared/validate';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

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

  // Defense in depth: the local CLI already redacts before publishing, but
  // never trust a client-submitted payload — redact the full object again
  // server-side before it's narrated or persisted.
  const { value: redacted } = deepRedact(supercut);

  try {
    redacted.narration = await narrate(redacted);
  } catch (err) {
    // Narration is best-effort — never let it block publish.
    console.error('narrate() failed, publishing without narration:', err);
  }

  await putSupercut(redacted);

  const url = `${new URL(req.url).origin}/s/${redacted.slug}`;
  return jsonResponse({ slug: redacted.slug, url }, 201);
};

export const config: Config = {
  path: '/api/publish',
  method: ['POST'],
};
