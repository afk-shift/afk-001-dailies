/**
 * Pure, testable narration prompt/response module — no Netlify runtime
 * dependencies, so it's directly unit-testable with vitest (see
 * tests/narration.test.ts). The actual AI Gateway call lives in
 * netlify/functions/narrate-background.mts.
 */

export { buildNarrationInput } from './input';
export type { NarrationEventLine, NarrationInput } from './input';
export { buildNarrationPrompt } from './prompt';
export { NARRATION_MODEL } from './model';
export { parseNarration } from './parse';
export type { ParseNarrationResult } from './parse';
