/**
 * Minimal, permissive shapes for raw Claude Code transcript JSONL lines, plus
 * type guards to narrow `unknown` parsed JSON into them. See
 * docs/autopilot/transcript-format.md for the on-disk format this mirrors.
 *
 * These are intentionally loose (lots of `unknown`/optional fields) — the
 * parser is meant to tolerate lines that don't match exactly rather than
 * throw, per the "pure, dependency-free, tolerant" brief.
 */

export interface RawUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

export interface RawTextBlock {
  type: 'text';
  text: string;
}

export interface RawThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface RawToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}

export interface RawToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}

export type RawContentBlock =
  | RawTextBlock
  | RawThinkingBlock
  | RawToolUseBlock
  | RawToolResultBlock
  | { type: string; [key: string]: unknown };

export interface RawMessage {
  role?: string;
  content?: string | RawContentBlock[];
  model?: string;
  usage?: RawUsage;
}

export interface RawLine {
  type: string;
  subtype?: string;
  message?: RawMessage;
  content?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  agentId?: string;
  /** Set (with `scheduledFireId`) on the `user` line a cron/scheduled task
   *  fires as its prompt — present even though the line is also `isMeta:true`. */
  scheduledTaskId?: string;
  scheduledFireId?: string;
  /** `"system"` on a harness-injected turn (scheduled fires, task
   *  notifications); `"typed"` for an ordinary human-typed prompt. */
  promptSource?: string;
  [key: string]: unknown;
}

export function asRawLine(value: unknown): RawLine | null {
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== 'string') return null;
  return obj as unknown as RawLine;
}

export function isTextBlock(block: unknown): block is RawTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

export function isToolUseBlock(block: unknown): block is RawToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_use' &&
    typeof (block as { id?: unknown }).id === 'string' &&
    typeof (block as { name?: unknown }).name === 'string'
  );
}

export function isToolResultBlock(block: unknown): block is RawToolResultBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'tool_result' &&
    typeof (block as { tool_use_id?: unknown }).tool_use_id === 'string'
  );
}
