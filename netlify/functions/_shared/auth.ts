/**
 * Shared bearer-token auth for the Dailies publish/feature endpoints.
 */

import { timingSafeEqual } from 'node:crypto';
// Pulls in the ambient `Netlify` global declaration used below.
import type {} from '@netlify/functions';

/**
 * Checks the `Authorization: Bearer <token>` header against the
 * `DAILIES_PUBLISH_TOKEN` env var, using a constant-time comparison.
 *
 * Returns a `Response` to send immediately — 503 if the token isn't
 * configured, 401 on a missing/mismatched header — or `null` when the
 * request is authorized and the caller should proceed.
 */
export function checkAuthToken(req: Request): Response | null {
  const expected = Netlify.env.get('DAILIES_PUBLISH_TOKEN');
  if (!expected) {
    return jsonResponse({ error: 'DAILIES_PUBLISH_TOKEN is not configured' }, 503);
  }

  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  const provided = match?.[1] ?? '';

  if (!provided || !constantTimeEqual(provided, expected)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  return null;
}

/**
 * Constant-time string comparison. A length mismatch short-circuits (this
 * leaks length via timing, an accepted tradeoff for comparing against a
 * fixed-format random token) before falling back to `timingSafeEqual` for
 * equal-length buffers.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
