/**
 * POST /api/feature — marks an already-published supercut as the homepage's
 * featured one.
 */

import type { Config } from '@netlify/functions';
import { getSupercut, setFeaturedSlug } from '../../src/lib/store';
import { checkAuthToken, jsonResponse } from './_shared/auth';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authError = checkAuthToken(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const slug = isPlainObject(body) && typeof body.slug === 'string' ? body.slug : '';
  if (!slug) {
    return jsonResponse({ error: 'slug is required' }, 400);
  }

  const supercut = await getSupercut(slug);
  if (!supercut) {
    return jsonResponse({ error: 'No supercut found for that slug' }, 404);
  }

  await setFeaturedSlug(slug);
  return jsonResponse({ slug }, 200);
};

export const config: Config = {
  path: '/api/feature',
  method: ['POST'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
