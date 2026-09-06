import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonl, parseSession, type SessionInput } from '../src/lib/parse';
import { cleanPromptText } from '../src/lib/parse/clean';
import { redactSecrets } from '../src/lib/parse/redact';
import type { CommitEvent, MilestoneEvent, PromptEvent, SpawnEvent, ToolEvent } from '../src/lib/types';

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
      // Listed out of spawn order on purpose (xyz789 spawned *after* abc123) —
      // cast order must come from spawn timestamps, not this array's order.
      {
        id: 'xyz789',
        meta: JSON.parse(readFileSync(fixturePath('subagents/agent-xyz789.meta.json'), 'utf8')),
        lines: readLines('subagents/agent-xyz789.jsonl'),
      },
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
      'commit',
      'milestone',
      'milestone',
      'prompt',
      'tool',
      'spawn',
      'prompt',
      'reply',
    ]);
  });

  it('assigns sequential i and dtMs relative to the first event', () => {
    result.events.forEach((e, idx) => {
      expect(e.i).toBe(idx);
    });
    expect(result.events[0]!.dtMs).toBe(0);
    // Last event (final reply) is 90s after the first (first real prompt).
    expect(result.events[result.events.length - 1]!.dtMs).toBe(90000);
  });

  it('keeps dtMs monotonically non-decreasing after interleaving the subagent commit', () => {
    for (let k = 1; k < result.events.length; k++) {
      expect(result.events[k]!.dtMs).toBeGreaterThanOrEqual(result.events[k - 1]!.dtMs);
    }
  });

  it('counts prompts, tool calls, and errors correctly (main only in events)', () => {
    const toolEvents = result.events.filter((e): e is ToolEvent => e.kind === 'tool');
    expect(toolEvents).toHaveLength(7);
    expect(toolEvents.every((e) => e.actor === 'main')).toBe(true);

    const promptEvents = result.events.filter((e) => e.kind === 'prompt');
    expect(promptEvents).toHaveLength(5);

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
    // The subagent's commit-issuing Bash call must not appear as a `tool`
    // event either — only its `commit` event (see below) reaches `events`.
    const bashToolEvents = result.events.filter((e): e is ToolEvent => e.kind === 'tool' && e.tool === 'Bash');
    expect(bashToolEvents).toHaveLength(3); // git status, curl, main git commit
  });

  it('builds chapters from prompt events, including the scheduled prompt', () => {
    expect(result.chapters).toEqual([
      { id: 'c0', title: 'Set up the repo and read the README', startIndex: 0, endIndex: 4 },
      { id: 'c5', title: 'Add a helper function and commit it', startIndex: 5, endIndex: 13 },
      { id: 'c14', title: 'Now spin up a subagent to explore the repo structure', startIndex: 14, endIndex: 20 },
      {
        id: 'c21',
        title: 'SCHEDULED BUILD — SESSION 2 of 4 (7pm). Resume the unattended build and continue',
        startIndex: 21,
        endIndex: 23,
      },
      { id: 'c24', title: 'Great, ship it', startIndex: 24, endIndex: 25 },
    ]);
  });

  it('strips system-reminder wrappers from prompt text', () => {
    const secondPrompt = result.events[5] as PromptEvent;
    expect(secondPrompt.kind).toBe('prompt');
    expect(secondPrompt.text).toBe('Add a helper function and commit it');
    expect(secondPrompt.text).not.toContain('system-reminder');
  });

  it('skips a local-command-only user line entirely (no prompt, no chapter)', () => {
    const texts = result.events.map((e) => ('text' in e ? e.text : ''));
    expect(texts.join(' ')).not.toContain('local-command');
    expect(texts.join(' ')).not.toContain('Installed netlify-skills');
    // First real event is the actual first prompt, not the local-command line.
    expect(result.events[0]!.kind).toBe('prompt');
    expect((result.events[0] as PromptEvent).text).toBe('Set up the repo and read the README');
  });

  it('turns a task-notification user line into a milestone, never a prompt or chapter', () => {
    const milestone = result.events[19] as MilestoneEvent;
    expect(milestone.kind).toBe('milestone');
    expect(milestone.text).toBe('Task finished: Agent "Survey repo structure" finished');
    // It must not have become a 5th-and-a-half prompt/chapter.
    expect(result.chapters.some((c) => c.title.includes('task-notification'))).toBe(false);
    expect(result.chapters.some((c) => c.title.includes('Task finished'))).toBe(false);
  });

  it('emits a scheduled prompt with source "scheduled" that starts its own chapter', () => {
    const scheduledPrompt = result.events.find(
      (e): e is PromptEvent => e.kind === 'prompt' && e.source === 'scheduled',
    );
    expect(scheduledPrompt).toBeDefined();
    expect(scheduledPrompt!.text).toBe(
      'SCHEDULED BUILD — SESSION 2 of 4 (7pm). Resume the unattended build and continue the slice queue.',
    );
    expect(result.chapters.some((c) => c.startIndex === scheduledPrompt!.i)).toBe(true);

    // Every other prompt is a normal (typed) one, with no `source` field.
    const otherPrompts = result.events.filter((e): e is PromptEvent => e.kind === 'prompt' && e !== scheduledPrompt);
    expect(otherPrompts.every((e) => e.source === undefined)).toBe(true);
  });

  it('builds cast in spawn order (orchestrator, then subagents by first appearance)', () => {
    expect(result.cast).toHaveLength(3);
    expect(result.cast[0]).toEqual({
      id: 'main',
      kind: 'orchestrator',
      model: 'claude-sonnet-5',
      label: 'Orchestrator',
      toolCalls: 7,
      outputTokens: 152,
    });
    // abc123 spawned at 15:11:10, xyz789 at 15:11:23 — abc123 must come
    // first in cast despite being listed second in `SessionInput.subagents`.
    expect(result.cast[1]).toEqual({
      id: 'abc123',
      kind: 'subagent',
      model: 'claude-haiku-5',
      label: 'Survey repo structure',
      toolCalls: 3,
      outputTokens: 170,
    });
    expect(result.cast[2]).toEqual({
      id: 'xyz789',
      kind: 'subagent',
      model: 'claude-opus-5',
      label: 'Second helper',
      toolCalls: 0,
      outputTokens: 8,
    });
  });

  it('emits a spawn event linked to each subagent cast member', () => {
    const spawnEvents = result.events.filter((e): e is SpawnEvent => e.kind === 'spawn');
    expect(spawnEvents.map((e) => e.castId)).toEqual(['abc123', 'xyz789']);
    expect(spawnEvents[0]!.description).toBe('Survey repo structure');
    expect(spawnEvents[1]!.description).toBe('Second helper');
  });

  it('emits milestone events with the expected text and order', () => {
    const milestones = result.events.filter((e) => e.kind === 'milestone').map((e) => (e as { text: string }).text);
    expect(milestones).toEqual([
      'Context compacted',
      'Task finished: Agent "Survey repo structure" finished',
      'Scheduled task fired',
    ]);
  });

  it('records files touched, relative to cwd', () => {
    expect(result.files).toEqual([{ path: 'src/helper.ts', edits: 1 }]);
  });

  it('extracts the commit message from the main-thread git commit Bash call', () => {
    const commitEvents = result.events.filter((e): e is CommitEvent => e.kind === 'commit');
    const mainCommit = commitEvents.find((e) => e.actor === undefined);
    expect(mainCommit).toBeDefined();
    expect(mainCommit!.message).toBe('Add helper function');
  });

  it('includes a subagent commit event in the main stream, interleaved by timestamp, with its actor', () => {
    const commitEvents = result.events.filter((e): e is CommitEvent => e.kind === 'commit');
    expect(commitEvents).toHaveLength(2);
    const subagentCommit = commitEvents.find((e) => e.actor === 'abc123');
    expect(subagentCommit).toBeDefined();
    expect(subagentCommit!.message).toBe('Add exploration notes');
    // It falls chronologically between the abc123 spawn (15:11:10) and the
    // task-notification milestone (15:11:17) — i.e. right after the spawn.
    const spawnEvent = result.events.find((e): e is SpawnEvent => e.kind === 'spawn' && e.castId === 'abc123')!;
    expect(subagentCommit!.i).toBe(spawnEvent.i + 1);
  });

  it('computes stats across main + subagents, excluding cache-read tokens from inputTokens', () => {
    expect(result.stats).toEqual({
      durationMs: 90000,
      turns: 5,
      toolCalls: 10,
      toolErrors: 1,
      filesTouched: 1,
      commits: 2,
      subagents: 2,
      inputTokens: 425,
      outputTokens: 330,
      cacheReadTokens: 2410,
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

describe('notification handling (isolated, minimal sessions)', () => {
  function tinySession(id: string, lines: unknown[]): SessionInput {
    return {
      sessionId: id,
      project: 'dailies',
      lines: lines.map((l) => JSON.stringify(l)),
      subagents: [],
    };
  }

  it('treats a "[SYSTEM NOTIFICATION" user line as a milestone, not a prompt', () => {
    const result = parseSession(
      tinySession('sess-sys', [
        {
          type: 'user',
          uuid: 'n1',
          parentUuid: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          sessionId: 'sess-sys',
          message: { role: 'user', content: 'Kick things off' },
        },
        {
          type: 'user',
          uuid: 'n2',
          parentUuid: 'n1',
          timestamp: '2026-01-01T00:00:05.000Z',
          sessionId: 'sess-sys',
          message: { role: 'user', content: '[SYSTEM NOTIFICATION] Background sync completed without incident.' },
        },
      ]),
    );

    expect(result.events.map((e) => e.kind)).toEqual(['prompt', 'milestone']);
    expect((result.events[1] as MilestoneEvent).text).toBe('Background task finished');
    expect(result.chapters).toHaveLength(1);
  });

  it('detects a task-notification even when wrapped in a system-reminder', () => {
    const wrapped =
      '<system-reminder>Background context the harness injected.</system-reminder>\n' +
      '<task-notification>\n<summary>Agent "Helper" finished</summary>\n</task-notification>';

    const result = parseSession(
      tinySession('sess-wrap', [
        {
          type: 'user',
          uuid: 'w1',
          parentUuid: null,
          timestamp: '2026-01-01T00:00:00.000Z',
          sessionId: 'sess-wrap',
          message: { role: 'user', content: 'Get started' },
        },
        {
          type: 'user',
          uuid: 'w2',
          parentUuid: 'w1',
          timestamp: '2026-01-01T00:00:05.000Z',
          sessionId: 'sess-wrap',
          message: { role: 'user', content: wrapped },
        },
      ]),
    );

    expect(result.events.map((e) => e.kind)).toEqual(['prompt', 'milestone']);
    expect((result.events[1] as MilestoneEvent).text).toBe('Task finished: Agent "Helper" finished');
  });
});

describe('cleanPromptText', () => {
  it('strips a <local-command-stdout> tag (with contents) entirely', () => {
    expect(cleanPromptText('<local-command-stdout>✓ Installed netlify-skills. Plugin is now active.</local-command-stdout>')).toBe(
      '',
    );
  });

  it('strips a <local-command-caveat> tag (with contents) entirely', () => {
    expect(
      cleanPromptText(
        '<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>',
      ),
    ).toBe('');
  });

  it('strips local-command markers but keeps real surrounding text', () => {
    expect(
      cleanPromptText(
        '<local-command-stdout>reloaded plugins</local-command-stdout>\nGo ahead and build the feature',
      ),
    ).toBe('Go ahead and build the feature');
  });

  it('strips <command-name>/<command-message>/<command-args> markers', () => {
    expect(cleanPromptText('<command-name>/plugin</command-name>\n<command-message>plugin</command-message>\n<command-args></command-args>')).toBe(
      '',
    );
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
