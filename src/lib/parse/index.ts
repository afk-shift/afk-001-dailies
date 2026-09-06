/**
 * Pure, dependency-free parser from Claude Code transcript JSONL to a
 * `Supercut` (see ../types.ts for the output contract, and
 * docs/autopilot/transcript-format.md for the input format).
 *
 * Entry points: `parseSession` and `parseJsonl`.
 */

import type {
  CastMember,
  Chapter,
  CommitEvent,
  Event,
  FileTouch,
  MilestoneEvent,
  PromptEvent,
  ReplyEvent,
  SpawnEvent,
  Stats,
  Supercut,
  ToolEvent,
} from '../types';
import { cleanPromptText, cleanReplyText, cleanTitleText, collapseWhitespace } from './clean';
import { buildToolLabel, FILE_TOOLS, extractCommitMessage, isGitCommitCommand, resolveFilePath } from './labels';
import { asRawLine, isTextBlock, isToolResultBlock, isToolUseBlock, type RawLine } from './raw';
import { deepRedact } from './redact';

export interface SessionInput {
  sessionId: string;
  project: string;
  /** Raw lines (not yet JSON-parsed) from the main session transcript file. */
  lines: string[];
  /** One entry per subagent (Task/Agent tool) transcript. */
  subagents: { id: string; meta: unknown; lines: string[] }[];
}

/** Line types that are UI/session-management sidecars — always skipped. */
const SKIP_TYPES = new Set([
  'attachment',
  'mode',
  'permission-mode',
  'bridge-session',
  'atis-latch',
  'ai-title',
  'last-prompt',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'agent-name',
  'agent-color',
  'custom-title',
  'pr-link',
  // Not observed in sampled files, but documented as compaction leftovers /
  // transient heartbeats that shouldn't be persisted.
  'summary',
  'progress',
]);

/** Tolerantly parses JSONL text: one JSON value per non-blank line, malformed lines skipped. */
export function parseJsonl(text: string): unknown[] {
  return parseLinesTolerant(text.split(/\r?\n/));
}

function parseLinesTolerant(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // tolerate malformed lines — skip them
    }
  }
  return out;
}

/**
 * A cron/scheduled task's fired prompt is a `user` line the harness marks
 * `isMeta:true` (like a caveat), but it carries a real instruction that
 * should become a prompt — `scheduledTaskId`/`scheduledFireId` are the
 * explicit signal that distinguish it from an actual meta/caveat line.
 */
function isScheduledPromptLine(line: RawLine): boolean {
  return (
    line.type === 'user' && (typeof line.scheduledTaskId === 'string' || typeof line.scheduledFireId === 'string')
  );
}

function isUsableLine(line: RawLine): boolean {
  if (line.isMeta === true && !isScheduledPromptLine(line)) return false;
  if (SKIP_TYPES.has(line.type)) return false;
  return true;
}

/**
 * Scopes raw lines to the requested sessionId. A `--resume`'d transcript
 * file can carry more than one sessionId; when it does, keep only the lines
 * for the requested one, falling back to all lines if none match.
 */
function selectSessionLines(rawLines: RawLine[], sessionId: string): RawLine[] {
  const ids = new Set(rawLines.map((l) => l.sessionId).filter((v): v is string => typeof v === 'string'));
  if (ids.size <= 1) return rawLines;
  const filtered = rawLines.filter((l) => l.sessionId === sessionId);
  return filtered.length > 0 ? filtered : rawLines;
}

function parseMainLines(rawTextLines: string[], sessionId: string): RawLine[] {
  const parsed = parseLinesTolerant(rawTextLines)
    .map(asRawLine)
    .filter((l): l is RawLine => l !== null);
  const scoped = selectSessionLines(parsed, sessionId);
  // The SDK no longer inlines subagent content into the main file, but skip
  // any isSidechain:true line defensively — it belongs to a subagent file.
  return scoped.filter((l) => isUsableLine(l) && l.isSidechain !== true);
}

function parseSubagentLines(rawTextLines: string[]): RawLine[] {
  const parsed = parseLinesTolerant(rawTextLines)
    .map(asRawLine)
    .filter((l): l is RawLine => l !== null);
  return parsed.filter(isUsableLine);
}

/** Builds a `tool_use.id -> is_error` map from every tool_result block in a line set. */
function buildErrorMap(lines: RawLine[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const line of lines) {
    if (line.type !== 'user') continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (isToolResultBlock(block)) {
        map.set(block.tool_use_id, block.is_error === true);
      }
    }
  }
  return map;
}

interface ToolUseOccurrence {
  id: string;
  name: string;
  input: Record<string, unknown>;
  cwd: string;
  t: string;
}

/** Walks every assistant line's content blocks and returns each tool_use block found. */
function collectToolUses(lines: RawLine[]): ToolUseOccurrence[] {
  const out: ToolUseOccurrence[] = [];
  for (const line of lines) {
    if (line.type !== 'assistant') continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    const cwd = typeof line.cwd === 'string' ? line.cwd : '';
    const t = typeof line.timestamp === 'string' ? line.timestamp : '';
    for (const block of content) {
      if (isToolUseBlock(block)) {
        out.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
          cwd,
          t,
        });
      }
    }
  }
  return out;
}

function countErrors(errorMap: Map<string, boolean>): number {
  let count = 0;
  for (const isError of errorMap.values()) {
    if (isError) count++;
  }
  return count;
}

/** Extracts a `user` line's raw text content (pre-cleaning), or '' if it has none. */
function extractRawUserText(line: RawLine): string {
  const content = line.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.filter(isTextBlock).map((b) => b.text);
    // A line with only tool_result blocks (no text) is a pure tool-result
    // turn, not a real prompt.
    if (texts.length === 0) return '';
    return texts.join('\n');
  }
  return '';
}

const SUMMARY_TAG_RE = /<summary>([\s\S]*?)<\/summary>/;

/**
 * A `<task-notification>` fires when a subagent/background task finishes —
 * checked on the *raw* (pre-clean) text because it's sometimes nested inside
 * a `<system-reminder>` wrapper, which `cleanPromptText` strips wholesale.
 */
function isTaskNotificationText(raw: string): boolean {
  return raw.includes('<task-notification>');
}

/** A generic harness notification line, detected on the *cleaned* text. */
function looksLikeSystemNotification(cleaned: string): boolean {
  return cleaned.startsWith('[SYSTEM NOTIFICATION');
}

/** Builds the milestone text for a task/system notification: its `<summary>`, or a fallback. */
function buildNotificationMilestoneText(raw: string): string {
  const match = raw.match(SUMMARY_TAG_RE);
  const summary = match ? collapseWhitespace(match[1] ?? '') : '';
  return summary ? `Task finished: ${summary}` : 'Background task finished';
}

/**
 * Sums usage fields for a set of assistant lines. `inputTokens` is
 * `input_tokens + cache_creation_input_tokens` only — `cache_read_input_tokens`
 * is reported separately as `cacheReadTokens` rather than folded in, since a
 * long session can re-read the same cached context hundreds of times and
 * summing those in wildly inflates the number (a real 6.75h session came out
 * as 68.8M "input tokens" with cache reads counted in).
 */
function sumUsage(
  lines: RawLine[],
): { inputTokens: number; outputTokens: number; cacheReadTokens: number; firstModel: string } {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let firstModel = '';
  for (const line of lines) {
    if (line.type !== 'assistant') continue;
    if (!firstModel && typeof line.message?.model === 'string') {
      firstModel = line.message.model;
    }
    const usage = line.message?.usage;
    if (usage) {
      outputTokens += usage.output_tokens ?? 0;
      inputTokens += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    }
  }
  return { inputTokens, outputTokens, cacheReadTokens, firstModel };
}

function buildToolUseIdToSubagentId(subagents: SessionInput['subagents']): Map<string, string> {
  const map = new Map<string, string>();
  for (const sa of subagents) {
    const meta = sa.meta;
    const toolUseId =
      meta !== null && typeof meta === 'object' && typeof (meta as Record<string, unknown>).toolUseId === 'string'
        ? ((meta as Record<string, unknown>).toolUseId as string)
        : undefined;
    if (toolUseId) map.set(toolUseId, sa.id);
  }
  return map;
}

function subagentLabel(meta: unknown, fallback: string): string {
  if (meta !== null && typeof meta === 'object' && typeof (meta as Record<string, unknown>).description === 'string') {
    return (meta as Record<string, unknown>).description as string;
  }
  return fallback;
}

/** Builds the un-redacted `Supercut` for a session. Shared by `parseSession` and `parseSessionWithRedactions`. */
function assembleSupercut(input: SessionInput): Supercut {
  const mainLines = parseMainLines(input.lines, input.sessionId);
  const toolUseIdToSubagent = buildToolUseIdToSubagentId(input.subagents);
  const errorMap = buildErrorMap(mainLines);

  const events: Event[] = [];
  const files = new Map<string, number>();
  /** castId -> ISO timestamp of the `Agent` tool_use that spawned it (cast display order). */
  const spawnTimestampsByCastId = new Map<string, string>();

  let mainToolCalls = 0;
  let mainToolErrors = 0;
  let mainCommits = 0;

  for (const line of mainLines) {
    const t = typeof line.timestamp === 'string' ? line.timestamp : '';

    if (line.type === 'user') {
      const raw = extractRawUserText(line);

      // Subagent/background-task completion pings — never a prompt, never a
      // chapter. Checked on the raw text since these are sometimes nested
      // inside a `<system-reminder>` wrapper that cleaning would strip whole.
      if (isTaskNotificationText(raw)) {
        const event: MilestoneEvent = { kind: 'milestone', i: -1, t, dtMs: -1, text: buildNotificationMilestoneText(raw) };
        events.push(event);
        continue;
      }

      const text = cleanPromptText(raw);

      if (looksLikeSystemNotification(text)) {
        const event: MilestoneEvent = { kind: 'milestone', i: -1, t, dtMs: -1, text: buildNotificationMilestoneText(raw) };
        events.push(event);
        continue;
      }

      if (text) {
        const event: PromptEvent = {
          kind: 'prompt',
          i: -1,
          t,
          dtMs: -1,
          text,
          ...(isScheduledPromptLine(line) ? { source: 'scheduled' as const } : {}),
        };
        events.push(event);
      }
      continue;
    }

    if (line.type === 'assistant') {
      const content = line.message?.content;
      if (!Array.isArray(content)) continue;
      const cwd = typeof line.cwd === 'string' ? line.cwd : '';

      for (const block of content) {
        if (isTextBlock(block)) {
          const cleaned = cleanReplyText(block.text);
          if (cleaned) {
            const event: ReplyEvent = { kind: 'reply', i: -1, t, dtMs: -1, text: cleaned };
            events.push(event);
          }
          continue;
        }

        if (isToolUseBlock(block)) {
          mainToolCalls++;
          const toolInput = (block.input ?? {}) as Record<string, unknown>;
          const label = buildToolLabel(block.name, toolInput, cwd);
          const isError = errorMap.get(block.id) === true;
          if (isError) mainToolErrors++;

          const toolEvent: ToolEvent = {
            kind: 'tool',
            i: -1,
            t,
            dtMs: -1,
            tool: block.name,
            label,
            actor: 'main',
            ...(isError ? { isError: true } : {}),
          };
          events.push(toolEvent);

          if (block.name === 'Bash') {
            const command = typeof toolInput.command === 'string' ? toolInput.command : '';
            if (isGitCommitCommand(command)) {
              mainCommits++;
              const commitEvent: CommitEvent = {
                kind: 'commit',
                i: -1,
                t,
                dtMs: -1,
                message: extractCommitMessage(command),
              };
              events.push(commitEvent);
            }
          }

          if (FILE_TOOLS.has(block.name)) {
            const path = resolveFilePath(block.name, toolInput, cwd);
            if (path) files.set(path, (files.get(path) ?? 0) + 1);
          }

          if (block.name === 'Agent') {
            const castId = toolUseIdToSubagent.get(block.id) ?? block.id;
            const description = typeof toolInput.description === 'string' ? toolInput.description : '';
            const spawnEvent: SpawnEvent = { kind: 'spawn', i: -1, t, dtMs: -1, castId, description };
            events.push(spawnEvent);
            if (!spawnTimestampsByCastId.has(castId) && t) spawnTimestampsByCastId.set(castId, t);
          }
        }
        // thinking blocks and anything else are ignored
      }
      continue;
    }

    if (line.type === 'system') {
      if (line.subtype === 'compact_boundary') {
        const event: MilestoneEvent = { kind: 'milestone', i: -1, t, dtMs: -1, text: 'Context compacted' };
        events.push(event);
      } else if (line.subtype === 'scheduled_task_fire') {
        const event: MilestoneEvent = { kind: 'milestone', i: -1, t, dtMs: -1, text: 'Scheduled task fired' };
        events.push(event);
      }
      continue;
    }
  }

  const mainUsage = sumUsage(mainLines);

  // --- Subagent cast + aggregate counting (internals never become events,
  // except `commit` events — see below — which are interleaved into the
  // main stream by timestamp.) ---
  const subagentCast: CastMember[] = [];
  const subagentCommitEvents: CommitEvent[] = [];
  const subagentFirstTimestamps = new Map<string, string>();
  let subagentToolCalls = 0;
  let subagentToolErrors = 0;
  let subagentCommits = 0;
  let subagentOutputTokens = 0;
  let subagentInputTokens = 0;
  let subagentCacheReadTokens = 0;

  for (const sa of input.subagents) {
    const saLines = parseSubagentLines(sa.lines);
    const toolUses = collectToolUses(saLines);
    const saErrorMap = buildErrorMap(saLines);
    const saErrors = countErrors(saErrorMap);

    subagentToolCalls += toolUses.length;
    subagentToolErrors += saErrors;

    const firstSaTimestamp = saLines.find((l) => typeof l.timestamp === 'string')?.timestamp;
    if (firstSaTimestamp) subagentFirstTimestamps.set(sa.id, firstSaTimestamp);

    for (const tu of toolUses) {
      if (tu.name === 'Bash') {
        const command = typeof tu.input.command === 'string' ? tu.input.command : '';
        if (isGitCommitCommand(command)) {
          subagentCommits++;
          subagentCommitEvents.push({
            kind: 'commit',
            i: -1,
            t: tu.t,
            dtMs: -1,
            message: extractCommitMessage(command),
            actor: sa.id,
          });
        }
      }
      if (FILE_TOOLS.has(tu.name)) {
        const path = resolveFilePath(tu.name, tu.input, tu.cwd);
        if (path) files.set(path, (files.get(path) ?? 0) + 1);
      }
    }

    const saUsage = sumUsage(saLines);
    subagentOutputTokens += saUsage.outputTokens;
    subagentInputTokens += saUsage.inputTokens;
    subagentCacheReadTokens += saUsage.cacheReadTokens;

    subagentCast.push({
      id: sa.id,
      kind: 'subagent',
      model: saUsage.firstModel,
      label: subagentLabel(sa.meta, sa.id),
      toolCalls: toolUses.length,
      outputTokens: saUsage.outputTokens,
    });
  }

  // Cast order: orchestrator first, then subagents by first appearance —
  // the `Agent` tool_use that spawned them, or (if none matched) their own
  // first line's timestamp.
  const castOrderKey = (castId: string): number => {
    const spawnT = spawnTimestampsByCastId.get(castId) ?? subagentFirstTimestamps.get(castId);
    return spawnT ? new Date(spawnT).getTime() : Number.MAX_SAFE_INTEGER;
  };
  subagentCast.sort((a, b) => castOrderKey(a.id) - castOrderKey(b.id));

  const orchestrator: CastMember = {
    id: 'main',
    kind: 'orchestrator',
    model: mainUsage.firstModel,
    label: 'Orchestrator',
    toolCalls: mainToolCalls,
    outputTokens: mainUsage.outputTokens,
  };
  const cast: CastMember[] = [orchestrator, ...subagentCast];

  // Interleave subagent `commit` events into the main stream by timestamp,
  // then assign final sequential `i` / `dtMs` across the merged, sorted list.
  events.push(...subagentCommitEvents);
  events.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  const firstT = events.length > 0 ? new Date(events[0]!.t).getTime() : 0;
  events.forEach((event, idx) => {
    event.i = idx;
    event.dtMs = event.t ? new Date(event.t).getTime() - firstT : 0;
  });

  const filesArr: FileTouch[] = Array.from(files.entries()).map(([path, edits]) => ({ path, edits }));

  const promptIndexes = events.filter((e): e is PromptEvent => e.kind === 'prompt').map((e) => e.i);
  const chapters: Chapter[] = promptIndexes.map((startIndex, idx) => {
    const endIndex = idx + 1 < promptIndexes.length ? promptIndexes[idx + 1]! - 1 : events.length - 1;
    const promptEvent = events[startIndex] as PromptEvent;
    return {
      id: `c${startIndex}`,
      title: cleanTitleText(promptEvent.text),
      startIndex,
      endIndex,
    };
  });

  const startedAt = events.length > 0 ? events[0]!.t : new Date(0).toISOString();
  const endedAt = events.length > 0 ? events[events.length - 1]!.t : startedAt;
  const durationMs = events.length > 0 ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : 0;

  const stats: Stats = {
    durationMs,
    turns: chapters.length,
    toolCalls: mainToolCalls + subagentToolCalls,
    toolErrors: mainToolErrors + subagentToolErrors,
    filesTouched: filesArr.length,
    commits: mainCommits + subagentCommits,
    subagents: subagentCast.length,
    inputTokens: mainUsage.inputTokens + subagentInputTokens,
    outputTokens: mainUsage.outputTokens + subagentOutputTokens,
    cacheReadTokens: mainUsage.cacheReadTokens + subagentCacheReadTokens,
  };

  const firstPrompt = events.find((e): e is PromptEvent => e.kind === 'prompt');
  const title = firstPrompt ? cleanTitleText(firstPrompt.text) : '';

  const supercut: Supercut = {
    version: 1,
    slug: '',
    title,
    sessionId: input.sessionId,
    project: input.project,
    startedAt,
    endedAt,
    stats,
    cast,
    chapters,
    events,
    files: filesArr,
  };

  return supercut;
}

/**
 * Parses a session and redacts secrets from the resulting `Supercut` (see
 * `redact.ts`). This is the entry point every consumer should use — the
 * unredacted `assembleSupercut` above is not exported.
 */
export function parseSession(input: SessionInput): Supercut {
  return deepRedact(assembleSupercut(input)).value;
}

/**
 * Same as `parseSession`, but also reports how many redactions were applied
 * — used by the Dailies CLI to print a "Redactions applied: N" line so a
 * human knows to double-check the output before publishing.
 */
export function parseSessionWithRedactions(input: SessionInput): { supercut: Supercut; redactionCount: number } {
  const { value, count } = deepRedact(assembleSupercut(input));
  return { supercut: value, redactionCount: count };
}
