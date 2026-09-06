/**
 * Narration for the fixture-backed demo so supercut mode can be driven in
 * development. Published supercuts carry their own narration from the AI
 * gateway; the demo has none, and this stand-in is stripped from the
 * production bundle by the `import.meta.env.DEV` branch that calls it.
 */

import type { Narration, Supercut } from '../../lib/types';

const TEXTS = [
  'The repo comes up clean and the README sets the shape of the work.',
  'A helper lands, the first commit goes in, and an auth call comes back 401.',
  'A subagent goes out to map the tree and reports back twelve files.',
];

/** Places one highlight per third of the reel, spaced far enough to dissolve. */
export function withDevNarration(supercut: Supercut): Supercut {
  if (supercut.narration) return supercut;

  const lastIndex = Math.max(0, supercut.events.length - 1);
  if (lastIndex < 8) return supercut;

  const narration: Narration = {
    synopsis:
      'A short scripted session: set up the repo, add a helper, commit it, then send a subagent out to map the tree.',
    highlights: TEXTS.map((text, i) => ({
      eventIndex: Math.round(lastIndex * (0.15 + i * 0.35)),
      text,
    })),
    generatedBy: 'dev fixture',
  };

  return { ...supercut, narration };
}
