/**
 * Read path shared by `/s/[slug]` (and, later, any other page that needs a
 * Supercut by slug): resolves the special `demo` slug from the checked-in
 * fixture, otherwise reads a published supercut from Netlify Blobs.
 */

import { parseSession } from './parse';
import { getSupercut } from './store';
import type { Supercut } from './types';

// Vite `?raw` imports — bundled at build time, no filesystem access at
// runtime. See src/env.d.ts for the `*.jsonl?raw` module declaration.
import demoSessionRaw from '../../tests/fixtures/session.jsonl?raw';
import demoSubagentRaw from '../../tests/fixtures/subagents/agent-abc123.jsonl?raw';
import demoSubagentMeta from '../../tests/fixtures/subagents/agent-abc123.meta.json';

const DEMO_SLUG = 'demo';

let demoSupercut: Supercut | undefined;

function buildDemoSupercut(): Supercut {
  if (!demoSupercut) {
    const supercut = parseSession({
      sessionId: 'demo',
      project: 'dailies',
      lines: demoSessionRaw.split(/\r?\n/),
      subagents: [
        {
          id: 'abc123',
          meta: demoSubagentMeta,
          lines: demoSubagentRaw.split(/\r?\n/),
        },
      ],
    });
    supercut.slug = DEMO_SLUG;
    demoSupercut = supercut;
  }
  return demoSupercut;
}

/** Resolves a Supercut by slug: the fixture-backed demo, or a published one from Blobs. */
export async function resolveSupercut(slug: string): Promise<Supercut | null> {
  if (slug === DEMO_SLUG) {
    return buildDemoSupercut();
  }
  return getSupercut(slug);
}
