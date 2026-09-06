/**
 * AI narration for a published Supercut — synopsis, highlights, and a
 * refined title generated via the Netlify AI Gateway.
 *
 * This is a stub for slice 3. Slice 5 fills in the real Netlify AI Gateway
 * call (Anthropic provider); until then this always resolves to `undefined`
 * so `publish` stores supercuts without narration.
 */

import type { Narration, Supercut } from './types';

export async function narrate(_supercut: Supercut): Promise<Narration | undefined> {
  return undefined;
}
