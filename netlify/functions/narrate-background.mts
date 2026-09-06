/**
 * POST /api/narrate — generates AI narration (synopsis, highlights, and a
 * refined title) for an already-published supercut, via the Netlify AI
 * Gateway's Anthropic provider, and writes it back to Blobs.
 *
 * Runs as a Netlify **background function** (see the `-background` filename
 * suffix and `config.background` below) because a synchronous function call
 * can hit the 60s timeout on a slow LLM response — `publish.mts` fires this
 * with a bearer-authenticated `fetch` and doesn't wait for it. The client
 * that triggered it already has its response; this function's return value
 * is discarded, so every error is logged (`[narrate]` prefix) and swallowed
 * rather than thrown.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '@netlify/functions';
import { buildNarrationInput, buildNarrationPrompt, parseNarrationResponse, parseNarrationTitle } from '../../src/lib/narration';
import { getSupercut, putSupercut } from '../../src/lib/store';
import { checkAuthToken } from './_shared/auth';

const NARRATION_MAX_TOKENS = 2048;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method !== 'POST') {
      return new Response(null, { status: 405 });
    }

    const authError = checkAuthToken(req);
    if (authError) return authError;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      console.error('[narrate] invalid JSON body');
      return new Response(null, { status: 202 });
    }

    const slug = isPlainObject(body) && typeof body.slug === 'string' ? body.slug : '';
    if (!slug) {
      console.error('[narrate] missing slug in request body');
      return new Response(null, { status: 202 });
    }

    const supercut = await getSupercut(slug);
    if (!supercut) {
      console.error(`[narrate] no supercut found for slug "${slug}"`);
      return new Response(null, { status: 202 });
    }

    const input = buildNarrationInput(supercut);
    const { system, user } = buildNarrationPrompt(input);

    // Initialize the SDK client inside the handler, not at module scope —
    // AI Gateway env vars (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL) are
    // injected at request time and may not exist when the module loads.
    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: NARRATION_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const replyText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const narration = parseNarrationResponse(replyText, supercut.events.length);
    if (!narration) {
      console.error(`[narrate] could not parse a valid narration for slug "${slug}"`);
      return new Response(null, { status: 202 });
    }

    supercut.narration = narration;

    const suggestedTitle = parseNarrationTitle(replyText);
    if (suggestedTitle) {
      supercut.title = suggestedTitle;
    }

    await putSupercut(supercut);
    return new Response(null, { status: 202 });
  } catch (err) {
    console.error('[narrate] failed:', err);
    return new Response(null, { status: 202 });
  }
};

export const config: Config = {
  path: '/api/narrate',
  method: ['POST'],
  background: true,
};
