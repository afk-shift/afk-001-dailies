/**
 * GET /s/[slug].json — the resolved Supercut as raw JSON, for tooling/scripts
 * that want the data the replay page renders without scraping its HTML.
 * Shares `resolveSupercut` with `[slug].astro`, so `demo` resolves the same
 * fixture-backed supercut here too. Never cached — a supercut can be
 * republished in place (see `--update` on the CLI), so a stale response
 * would be wrong, not just slow.
 */

import type { APIRoute } from 'astro';
import { resolveSupercut } from '../../lib/get-supercut';

const NO_STORE_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  const supercut = slug ? await resolveSupercut(slug) : null;

  if (!supercut) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: NO_STORE_HEADERS,
    });
  }

  return new Response(JSON.stringify(supercut), {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
};
