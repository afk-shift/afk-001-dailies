import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonl, parseSession, type SessionInput } from '../src/lib/parse';
import { redactSecrets } from '../src/lib/parse/redact';
import type { CommitEvent, PromptEvent, SpawnEvent, ToolEvent } from '../src/lib/types';

function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`./fixtures/${relative}`, import.meta.url));
}

function readLines(relative: string): string[] {
  return readFileSync(fixturePath(relative), 'utf8').split(/\r?\n/);
}

function buildSessionInput(): SessionInput {
  return {
    sessionId: 'sess-0001',
    project: 'dailies',
    lines: readLines('session.jsonl'),
    subagents: [
      {
        id: 'abc123',
        meta: JSON.parse(readFileSync(fixturePath('subagents/agent-abc123.meta.json'), 'utf8')),
        lines: readLines('subagents/agent-abc123.jsonl'),
      },
    ],
  };
}

describe('parseSession', () => {
  const result = parseSession(buildSessionInput());

  it('produces the expected sequence of event kinds', () => {
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'prompt',
      'reply',
      'tool',
      'reply',
      'tool',
      'prompt',
      'reply',
      'tool',
      'reply',
      'tool',
      'reply',
      'tool',
      'commit',
      'milestone',
      'prompt',
      'reply',
      'tool',
      'spawn',
      'milestone',
      'prompt',
      'reply',
    ]);
  });

  it('assigns sequential i and dtMs relative to the first event', () => {
    result.events.forEach((e, idx) => {
      expect(e.i).toBe(idx);
    });
    expect(result.events[0]!.dtMs).toBe(0);
    // Last event is 90s after the first (18 fixture lines, 5s apart).
    expect(result.events[result.events.length - 1]!.dtMs).toBe(90000);
  });

  it('counts prompts, tool calls, and errors correctly (main only in events)', () => {
    const toolEvents = result.events.filter((e): e is ToolEvent => e.kind === 'tool');
    expect(toolEvents).toHaveLength(6);
    expect(toolEvents.every((e) => e.actor === 'main')).toBe(true);

    const promptEvents = result.events.filter((e) => e.kind === 'prompt');
    expect(promptEvents).toHaveLength(4);

    const erroredTools = toolEvents.filter((e) => e.isError === true);
    expect(erroredTools).toHaveLength(1);
    expect(erroredTools[0]!.tool).toBe('Bash');
  });

  it('does not leak subagent-internal tool calls into the main event stream', () => {
    const toolNames = result.events.filter((e): e is ToolEvent => e.kind === 'tool').map((e) => e.tool);
    expect(toolNames).not.toContain('Glob');
    // The subagent's Read (package.json) must not show up as a main-thread event.
    const readEvents = result.events.filter((e): e is ToolEvent => e.kind === 'tool' && e.tool === 'Read');
    expect(readEvents).toHaveLength(1);
    expect(readEvents[0]!.label).toBe('README.md');
  });

  it('builds chapters from prompt events', () => {
    expect(result.chapters).toEqual([
      { id: 'c0', title: 'Set up the repo and read the README', startIndex: 0, endIndex: 4 },
      { id: 'c5', title: 'Add a helper function and commit it', startIndex: 5, endIndex: 13 },
      { id: 'c14', title: 'Now spin up a subagent to explore the repo structure', startIndex: 14, endIndex: 18 },
      { id: 'c19', title: 'Great, ship it', startIndex: 19, endIndex: 20 },
    ]);
  });

  it('strips system-reminder wrappers from prompt text', () => {
    const secondPrompt = result.events[5] as PromptEvent;
    expect(secondPrompt.kind).toBe('prompt');
    expect(secondPrompt.text).toBe('Add a helper function and commit it');
    expect(secondPrompt.text).not.toContain('system-reminder');
  });

  it('builds cast: orchestrator + one subagent, models correct, subagent calls counted not in events', () => {
    expect(result.cast).toHaveLength(2);
    expect(result.cast[0]).toEqual({
      id: 'main',
      kind: 'orchestrator',
      model: 'claude-sonnet-5',
      label: 'Orchestrator',
      toolCalls: 6,
      outputTokens: 142,
    });
    expect(result.cast[1]).toEqual({
      id: 'abc123',
      kind: 'subagent',
      model: 'claude-haiku-5',
      label: 'Survey repo structure',
      toolCalls: 2,
      outputTokens: 125,
    });
  });

  it('emits a spawn event linked to the subagent cast member', () => {
    const spawnEvent = result.events.find((e): e is SpawnEvent => e.kind === 'spawn');
    expect(spawnEvent).toBeDefined();
    expect(spawnEvent!.castId).toBe('abc123');
    expect(spawnEvent!.description).toBe('Survey repo structure');
  });

  it('emits two milestone events with the expected text', () => {
    const milestones = result.events.filter((e) => e.kind === 'milestone').map((e) => (e as { text: string }).text);
    expect(milestones).toEqual(['Context compacted', 'Scheduled task fired']);
  });

  it('records files touched, relative to cwd', () => {
    expect(result.files).toEqual([{ path: 'src/helper.ts', edits: 1 }]);
  });

  it('extracts the commit message from the git commit Bash call', () => {
    const commitEvent = result.events.find((e): e is CommitEvent => e.kind === 'commit');
    expect(commitEvent).toBeDefined();
    expect(commitEvent!.message).toBe('Add helper function');
  });

  it('computes stats across main + subagents', () => {
    expect(result.stats).toEqual({
      durationMs: 90000,
      turns: 4,
      toolCalls: 8,
      toolErrors: 1,
      filesTouched: 1,
      commits: 1,
      subagents: 1,
      inputTokens: 2195,
      outputTokens: 267,
    });
  });

  it('sets title/slug/session metadata', () => {
    expect(result.title).toBe('Set up the repo and read the README');
    expect(result.slug).toBe('');
    expect(result.sessionId).toBe('sess-0001');
    expect(result.project).toBe('dailies');
    expect(result.startedAt).toBe('2026-09-06T15:10:00.000Z');
    expect(result.endedAt).toBe('2026-09-06T15:11:30.000Z');
  });

  it('redacts the fake API key everywhere and never leaks tool_result bodies', () => {
    const json = JSON.stringify(result);
    expect(json).not.toContain('FAKEFAKE');
    expect(json).not.toContain('sk-ant-api03');
    expect(json).toContain('[redacted]');

    // Tool result content (e.g. "401 Unauthorized", README body) never lands in the Supercut.
    expect(json).not.toContain('401 Unauthorized');
    expect(json).not.toContain('Supercuts for Claude Code sessions');
  });
});

describe('redactSecrets', () => {
  it('masks an Anthropic-style key', () => {
    expect(redactSecrets('key is sk-ant-api03-FAKEFAKE here')).toBe('key is [redacted] here');
  });

  it('masks a Bearer token, keeping the scheme', () => {
    expect(redactSecrets('Authorization: Bearer abc123.def456')).toBe('Authorization: Bearer [redacted]');
  });

  it('masks KEY=value style assignments, keeping the variable name', () => {
    expect(redactSecrets('DAILIES_PUBLISH_TOKEN=supersecretvalue')).toBe('DAILIES_PUBLISH_TOKEN=[redacted]');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('nothing sensitive here')).toBe('nothing sensitive here');
  });
});

describe('parseJsonl', () => {
  it('tolerantly skips blank and malformed lines', () => {
    const text = ['{"a":1}', '', '   ', '{not valid json', '{"b":2}', ''].join('\n');
    expect(parseJsonl(text)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseJsonl('')).toEqual([]);
  });
});
