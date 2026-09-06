/**
 * Anthropic model used to generate supercut narration, called through the
 * Netlify AI Gateway (see `netlify/functions/narrate-background.mts`).
 *
 * Kept as a single constant so the prompt-response contract (this module)
 * and the actual API call agree on which model produced a given
 * `Narration.generatedBy`.
 */
export const NARRATION_MODEL = 'claude-sonnet-5';
