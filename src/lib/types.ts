/**
 * Shared type contract for Dailies supercuts.
 *
 * A "supercut" is the compact JSON artifact produced by the (future) local
 * CLI parser from a Claude Code transcript, published to Netlify Blobs, and
 * rendered by the (future) player at /s/<slug>.
 *
 * These types are the contract between the parser, the publish function,
 * and the player. Keep the names exactly as defined here across slices.
 */

export interface Supercut {
  version: 1;
  slug: string;
  title: string;
  sessionId: string;
  project: string;
  startedAt: string;
  endedAt: string;
  stats: Stats;
  cast: CastMember[];
  chapters: Chapter[];
  events: Event[];
  files: FileTouch[];
  narration?: Narration;
}

export interface Stats {
  durationMs: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  filesTouched: number;
  commits: number;
  subagents: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of `cache_read_input_tokens` — reported separately since it's not
   *  counted in `inputTokens` (cache reads are near-free, and summing them
   *  in wildly inflates the number over a long session). */
  cacheReadTokens?: number;
}

export interface CastMember {
  id: string;
  kind: 'orchestrator' | 'subagent';
  model: string;
  label: string;
  toolCalls: number;
  outputTokens: number;
}

export interface Chapter {
  id: string;
  title: string;
  startIndex: number;
  endIndex: number;
  summary?: string;
}

interface EventBase {
  i: number;
  t: string; // ISO timestamp
  dtMs: number; // ms since session start
}

export interface PromptEvent extends EventBase {
  kind: 'prompt';
  text: string;
  /** Set when this prompt was fired by a cron/scheduled task rather than
   *  typed by a human. */
  source?: 'scheduled';
}

export interface ReplyEvent extends EventBase {
  kind: 'reply';
  text: string;
}

export interface ToolEvent extends EventBase {
  kind: 'tool';
  tool: string;
  label: string;
  isError?: boolean;
  actor: string;
}

export interface CommitEvent extends EventBase {
  kind: 'commit';
  message: string;
  /** Cast id of the actor that made the commit, when it came from a
   *  subagent rather than the orchestrator. */
  actor?: string;
}

export interface SpawnEvent extends EventBase {
  kind: 'spawn';
  castId: string;
  description: string;
}

export interface MilestoneEvent extends EventBase {
  kind: 'milestone';
  text: string;
}

export type Event =
  | PromptEvent
  | ReplyEvent
  | ToolEvent
  | CommitEvent
  | SpawnEvent
  | MilestoneEvent;

export interface FileTouch {
  path: string;
  edits: number;
}

export interface Narration {
  synopsis: string;
  highlights: { eventIndex: number; text: string }[];
  generatedBy: string;
}
