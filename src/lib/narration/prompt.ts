/**
 * Builds the system + user prompt sent to the narration model. Kept pure
 * (string in, strings out) so it's unit-testable without touching the
 * network — see `parse.ts` for the matching response side.
 */

import type { NarrationInput } from './input';

const SYSTEM_PROMPT = `You are writing the narration for a "daily" — a short highlight reel of an AI coding agent's work session. Write like a film editor's daily notes, not marketing copy.

Style rules:
- Concrete and past tense: "built", "fixed", "refactored" — never "amazing", "seamlessly", "powerful", or other hype words.
- Name the specific tools, files, or commands that mattered rather than describing actions abstractly.
- If the digest shows a failure that was later recovered from, include exactly one highlight for it.
- Do not invent details that aren't present in the digest.

Respond with STRICT JSON only — no prose before or after, no markdown code fences — matching exactly this shape:

{
  "title": string,       // a short, punchy title for the session, <= 80 characters
  "synopsis": string,    // a synopsis of the session, <= 60 words
  "highlights": [
    { "eventIndex": number, "text": string } // 3 to 6 items; text <= 20 words
  ]
}

Rules for "highlights":
- "eventIndex" must be one of the "i" values from the event list in the digest — the exact integer, not a guess.
- Every highlight must reference a different eventIndex.`;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatUserPrompt(input: NarrationInput): string {
  const lines: string[] = [];

  lines.push(`Title: ${input.title || '(untitled)'}`);
  lines.push(`Project: ${input.project}`);
  lines.push(`Duration: ${formatDuration(input.durationMs)}`);
  lines.push(
    `Stats: ${input.stats.turns} turns, ${input.stats.toolCalls} tool calls (${input.stats.toolErrors} errors), ` +
      `${input.stats.filesTouched} files touched, ${input.stats.commits} commits, ${input.stats.subagents} subagents, ` +
      `${input.stats.inputTokens} input / ${input.stats.outputTokens} output tokens`,
  );

  if (input.cast.length > 0) {
    lines.push(`Cast: ${input.cast.map((c) => `${c.label} (${c.model || 'unknown model'})`).join(', ')}`);
  }
  if (input.chapterTitles.length > 0) {
    lines.push(`Chapters: ${input.chapterTitles.join(' | ')}`);
  }
  if (input.files.length > 0) {
    lines.push(`Files touched, most-edited first: ${input.files.join(', ')}`);
  }

  lines.push('');
  lines.push(
    `Events (${input.events.length} of ${input.totalEventCount} total shown, format "i · kind · label"):`,
  );
  for (const event of input.events) {
    lines.push(`${event.i} · ${event.kind} · ${event.label}`);
  }

  return lines.join('\n');
}

/** Builds the `{ system, user }` prompt pair sent to the narration model. */
export function buildNarrationPrompt(input: NarrationInput): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: formatUserPrompt(input) };
}
