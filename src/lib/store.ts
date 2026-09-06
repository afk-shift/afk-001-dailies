/**
 * Netlify Blobs storage for published Supercuts.
 *
 * One store (`dailies`) holds every published supercut plus the featured
 * slug pointer:
 *   - `supercuts/<slug>` — a Supercut, stored as JSON.
 *   - `featured`         — the currently-featured slug, stored as plain text.
 *
 * Strong consistency is used throughout: publish/feature are low-volume,
 * admin-gated writes, and readers (the homepage, `/s/[slug]`) should always
 * see the latest write rather than something eventually-consistent.
 */

import { getStore } from '@netlify/blobs';
import type { Supercut } from './types';

const STORE_NAME = 'dailies';
const FEATURED_KEY = 'featured';

/** Lowercase base32 (RFC 4648) alphabet — 32 symbols, no padding needed. */
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const SLUG_LENGTH = 10;

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function supercutKey(slug: string): string {
  return `supercuts/${slug}`;
}

/**
 * Generates a random 10-character lowercase base32 slug. Server-side only —
 * relies on the platform's `crypto.getRandomValues` (available globally in
 * Netlify Functions / Node 24), never derived from user input.
 */
export function generateSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  }
  return slug;
}

/** Reads a published supercut by slug, or `null` if it doesn't exist. */
export async function getSupercut(slug: string): Promise<Supercut | null> {
  const data = await store().get(supercutKey(slug), { type: 'json' });
  return (data as Supercut | null) ?? null;
}

/** Persists a supercut under `supercuts/<supercut.slug>`. */
export async function putSupercut(supercut: Supercut): Promise<void> {
  await store().setJSON(supercutKey(supercut.slug), supercut);
}

/** Reads the currently-featured slug, or `null` if none is set. */
export async function getFeaturedSlug(): Promise<string | null> {
  // The `type: 'text'` overload is typed as non-nullable, but a missing key
  // still resolves to `null` at runtime (same as the untyped overload).
  return (await store().get(FEATURED_KEY, { type: 'text' })) as string | null;
}

/** Sets the currently-featured slug. */
export async function setFeaturedSlug(slug: string): Promise<void> {
  await store().set(FEATURED_KEY, slug);
}
