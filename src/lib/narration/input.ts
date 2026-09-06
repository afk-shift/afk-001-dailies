/**
 * Builds a compact digest of a `Supercut` for the narration prompt — small
 * enough to stay well under the AI Gateway's context cap, but with enough
 * texture (cast, files, an evenly-sampled event list) for the model to write
 * a grounded synopsis instead of a generic one.
 */

import type { Event, Stats, Supercut } from '../types';

/** Hard cap on how many event lines go into the prompt. */
const MAX_EVENTS = 350;

/** Event kinds that are always kept in full — the narrative backbone. */
const ALWAYS_KEEP_KINDS: ReadonlySet<Event['kind']> = new Set(['prompt', 'commit', 'spawn', 'milestone']);

const MAX_FILES = 15;
const MAX_LABEL_LEN = 100;

export interface NarrationEventLine {
  i: number;
  kind: Event['kind'];
  label: string;
}

export interface NarrationInput {
  title: string;
  project: string;
  durationMs: number;
  stats: Stats;
  cast: { label: string; model: string }[];
  chapterTitles: string[];
  /** Up to `MAX_FILES` file paths, most-edited first. */
  files: string[];
  /** Up to `MAX_EVENTS` event lines, sampled from `totalEventCount`. */
  events: NarrationEventLine[];
  /** The full (pre-sampling) event count — used to validate `eventIndex` on the model's reply. */
  totalEventCount: number;
}

function eventText(event: Event): string {
  switch (event.kind) {
    case 'prompt':
    case 'reply':
    case 'milestone':
      return event.text;
    case 'tool':
      return event.label;
    case 'commit':
      return event.message;
    case 'spawn':
      return event.description;
  }
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Picks `limit` evenly-spaced items from `items`, preserving relative order. */
function sampleEvenly<T>(items: readonly T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (items.length <= limit) return [...items];
  const result: T[] = [];
  for (let i = 0; i < limit; i++) {
    result.push(items[Math.floor((i * items.length) / limit)]!);
  }
  return result;
}

/**
 * Selects which events go into the digest: every prompt/commit/spawn/
 * milestone event is always kept (they carry the story), and the remaining
 * reply/tool events are sampled evenly to fill whatever budget is left,
 * capped overall at `MAX_EVENTS`. Output stays in original event order.
 */
function selectEvents(events: Event[]): NarrationEventLine[] {
  const always = events.filter((e) => ALWAYS_KEEP_KINDS.has(e.kind));
  const rest = events.filter((e) => !ALWAYS_KEEP_KINDS.has(e.kind));
  const budget = Math.max(0, MAX_EVENTS - always.length);
  const sampledRest = sampleEvenly(rest, budget);

  return [...always, ...sampledRest]
    .sort((a, b) => a.i - b.i)
    .map((e) => ({ i: e.i, kind: e.kind, label: truncate(eventText(e), MAX_LABEL_LEN) }));
}

function selectFiles(supercut: Supercut): string[] {
  return [...supercut.files]
    .sort((a, b) => b.edits - a.edits)
    .slice(0, MAX_FILES)
    .map((f) => f.path);
}

export function buildNarrationInput(supercut: Supercut): NarrationInput {
  return {
    title: supercut.title,
    project: supercut.project,
    durationMs: supercut.stats.durationMs,
    stats: supercut.stats,
    cast: supercut.cast.map((c) => ({ label: c.label, model: c.model })),
    chapterTitles: supercut.chapters.map((c) => c.title),
    files: selectFiles(supercut),
    events: selectEvents(supercut.events),
    totalEventCount: supercut.events.length,
  };
}
