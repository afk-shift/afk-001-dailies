import { describe, expect, it } from 'vitest';
import { buildNarrationInput, buildNarrationPrompt, parseNarration } from '../src/lib/narration';
import type { Event, Supercut } from '../src/lib/types';

function baseSupercut(events: Event[]): Supercut {
  return {
    version: 1,
    slug: 'abc123',
    title: 'A test session',
    sessionId: 'sess-1',
    project: 'dailies',
    startedAt: '2026-09-06T00:00:00.000Z',
    endedAt: '2026-09-06T00:10:00.000Z',
    stats: {
      durationMs: 600_000,
      turns: 3,
      toolCalls: events.filter((e) => e.kind === 'tool').length,
      toolErrors: 0,
      filesTouched: 2,
      commits: events.filter((e) => e.kind === 'commit').length,
      subagents: 1,
      inputTokens: 1000,
      outputTokens: 500,
    },
    cast: [
      { id: 'main', kind: 'orchestrator', model: 'claude-sonnet-5', label: 'Orchestrator', toolCalls: 5, outputTokens: 300 },
      { id: 'sub-1', kind: 'subagent', model: 'claude-haiku-4-5', label: 'Explore', toolCalls: 2, outputTokens: 200 },
    ],
    chapters: [{ id: 'c0', title: 'Build the thing', startIndex: 0, endIndex: events.length - 1 }],
    events,
    files: [
      { path: 'src/index.ts', edits: 5 },
      { path: 'src/util.ts', edits: 1 },
    ],
  };
}

/** Builds `count` alternating reply/tool events, with distinct labels, starting at index `startI`. */
function fillerEvents(count: number, startI: number): Event[] {
  const out: Event[] = [];
  for (let n = 0; n < count; n++) {
    const i = startI + n;
    if (n % 2 === 0) {
      out.push({ kind: 'tool', i, t: '2026-09-06T00:00:00.000Z', dtMs: 0, tool: 'Bash', label: `command ${i}`, actor: 'main' });
    } else {
      out.push({ kind: 'reply', i, t: '2026-09-06T00:00:00.000Z', dtMs: 0, text: `reply text ${i}` });
    }
  }
  return out;
}

describe('buildNarrationInput — event sampling', () => {
  it('keeps every prompt/commit/spawn/milestone event and caps the total at 350', () => {
    const always: Event[] = [
      { kind: 'prompt', i: 0, t: 't', dtMs: 0, text: 'do the thing' },
      { kind: 'commit', i: 1, t: 't', dtMs: 0, message: 'feat: add thing' },
      { kind: 'spawn', i: 2, t: 't', dtMs: 0, castId: 'sub-1', description: 'Explore the repo' },
      { kind: 'milestone', i: 3, t: 't', dtMs: 0, text: 'Context compacted' },
    ];
    const filler = fillerEvents(600, 4); // 600 reply/tool events — far over budget
    const events = [...always, ...filler];

    const input = buildNarrationInput(baseSupercut(events));

    expect(input.events.length).toBeLessThanOrEqual(350);
    expect(input.totalEventCount).toBe(events.length);

    // Every always-kept event survived sampling.
    const outputIndexes = new Set(input.events.map((e) => e.i));
    for (const e of always) {
      expect(outputIndexes.has(e.i)).toBe(true);
    }

    // Output stays sorted by original index.
    const indexes = input.events.map((e) => e.i);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it('keeps everything when the session is small (no sampling needed)', () => {
    const events: Event[] = [
      { kind: 'prompt', i: 0, t: 't', dtMs: 0, text: 'do the thing' },
      { kind: 'tool', i: 1, t: 't', dtMs: 0, tool: 'Bash', label: 'ls', actor: 'main' },
      { kind: 'reply', i: 2, t: 't', dtMs: 0, text: 'done' },
    ];
    const input = buildNarrationInput(baseSupercut(events));
    expect(input.events).toHaveLength(3);
  });

  it('truncates an overlong label to 100 characters', () => {
    const longText = 'x'.repeat(500);
    const events: Event[] = [{ kind: 'prompt', i: 0, t: 't', dtMs: 0, text: longText }];
    const input = buildNarrationInput(baseSupercut(events));
    expect(input.events[0]!.label.length).toBeLessThanOrEqual(100);
  });
});

describe('buildNarrationPrompt', () => {
  it('includes the title and formatted event lines in the user prompt', () => {
    const events: Event[] = [
      { kind: 'prompt', i: 0, t: 't', dtMs: 0, text: 'build the narration feature' },
      { kind: 'tool', i: 1, t: 't', dtMs: 0, tool: 'Edit', label: 'src/lib/narration/parse.ts', actor: 'main' },
    ];
    const supercut = baseSupercut(events);
    const input = buildNarrationInput(supercut);
    const { system, user } = buildNarrationPrompt(input);

    expect(system).toContain('STRICT JSON');
    expect(user).toContain(supercut.title);
    expect(user).toContain('0 · prompt · build the narration feature');
    expect(user).toContain('1 · tool · src/lib/narration/parse.ts');
  });
});

describe('parseNarration', () => {
  const EVENT_COUNT = 10;

  it('accepts a response fenced in a ```json code block', () => {
    const fenced = [
      '```json',
      JSON.stringify({
        title: 'Building Dailies',
        synopsis: 'Built the narration pipeline end to end.',
        highlights: [
          { eventIndex: 2, text: 'Wired up the AI Gateway call' },
          { eventIndex: 3, text: 'Parsed the reply' },
          { eventIndex: 4, text: 'Stored the narration' },
        ],
      }),
      '```',
    ].join('\n');

    const result = parseNarration(fenced, EVENT_COUNT);
    expect(result.narration?.synopsis).toBe('Built the narration pipeline end to end.');
    expect(result.narration?.highlights).toHaveLength(3);
    expect(result.narration?.generatedBy).toBe('claude-sonnet-5');
    expect(result.title).toBe('Building Dailies');
    expect(result.warnings).toEqual([]);
  });

  it('rejects garbage (not JSON, or missing required fields)', () => {
    expect(parseNarration('not json at all', EVENT_COUNT).narration).toBeUndefined();
    expect(parseNarration('{"title": "only a title"}', EVENT_COUNT).narration).toBeUndefined();
    expect(parseNarration('{"synopsis": "ok", "highlights": "not an array"}', EVENT_COUNT).narration).toBeUndefined();
  });

  it('warns when the reply is not a JSON object', () => {
    const result = parseNarration('not json at all', EVENT_COUNT);
    expect(result.warnings).toEqual(['reply did not parse as a JSON object']);
  });

  it('drops highlights with an out-of-range or non-integer eventIndex', () => {
    const response = JSON.stringify({
      synopsis: 'A session summary.',
      highlights: [
        { eventIndex: 3, text: 'valid — in range' },
        { eventIndex: 999, text: 'invalid — out of range' },
        { eventIndex: -1, text: 'invalid — negative' },
        { eventIndex: 1.5, text: 'invalid — not an integer' },
      ],
    });

    const result = parseNarration(response, EVENT_COUNT);
    expect(result.narration?.highlights).toEqual([{ eventIndex: 3, text: 'valid — in range' }]);
  });

  it('dedupes repeated eventIndex values, keeping the first', () => {
    const response = JSON.stringify({
      synopsis: 'A session summary.',
      highlights: [
        { eventIndex: 1, text: 'first' },
        { eventIndex: 1, text: 'second (duplicate index)' },
      ],
    });
    const result = parseNarration(response, EVENT_COUNT);
    expect(result.narration?.highlights).toEqual([{ eventIndex: 1, text: 'first' }]);
  });

  it('returns the title even when the narration itself is unusable', () => {
    const response = JSON.stringify({ title: 'A short title', synopsis: '', highlights: [] });
    const result = parseNarration(response, EVENT_COUNT);
    expect(result.narration).toBeUndefined();
    expect(result.title).toBe('A short title');
  });

  it('drops the title when missing, empty, or over 80 characters', () => {
    expect(parseNarration(JSON.stringify({ synopsis: 'x', highlights: [] }), EVENT_COUNT).title).toBeUndefined();
    expect(parseNarration(JSON.stringify({ title: '', synopsis: 'x', highlights: [] }), EVENT_COUNT).title).toBeUndefined();
    const overlong = parseNarration(JSON.stringify({ title: 'y'.repeat(81), synopsis: 'x', highlights: [] }), EVENT_COUNT);
    expect(overlong.title).toBeUndefined();
    expect(overlong.warnings.some((w) => w.includes('over the 80 cap'))).toBe(true);
  });

  describe('synopsis word-count boundary', () => {
    it('leaves exactly 60 words untouched', () => {
      const synopsis = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
      const response = JSON.stringify({
        synopsis,
        highlights: [{ eventIndex: 0, text: 'x' }, { eventIndex: 1, text: 'y' }, { eventIndex: 2, text: 'z' }],
      });
      const result = parseNarration(response, EVENT_COUNT);
      expect(result.narration?.synopsis).toBe(synopsis);
    });

    it('trims 61 words down to 60, appending "…"', () => {
      const words = Array.from({ length: 61 }, (_, i) => `word${i}`);
      const synopsis = words.join(' ');
      const response = JSON.stringify({
        synopsis,
        highlights: [{ eventIndex: 0, text: 'x' }, { eventIndex: 1, text: 'y' }, { eventIndex: 2, text: 'z' }],
      });
      const result = parseNarration(response, EVENT_COUNT);
      expect(result.narration?.synopsis).toBe(`${words.slice(0, 60).join(' ')}…`);
    });
  });

  describe('highlight-count boundary', () => {
    function responseWith(count: number): string {
      const highlights = Array.from({ length: count }, (_, i) => ({ eventIndex: i, text: `highlight ${i}` }));
      return JSON.stringify({ synopsis: 'A session summary.', highlights });
    }

    it('returns no narration when 0 highlights survive', () => {
      const result = parseNarration(responseWith(0), EVENT_COUNT);
      expect(result.narration).toBeUndefined();
      expect(result.warnings).toContain('no valid highlights survived filtering');
    });

    it('accepts 1 highlight, with a warning', () => {
      const result = parseNarration(responseWith(1), EVENT_COUNT);
      expect(result.narration?.highlights).toHaveLength(1);
      expect(result.warnings).toContain('only 1 highlight');
    });

    it('accepts 3 highlights with no highlight-count warning', () => {
      const result = parseNarration(responseWith(3), EVENT_COUNT);
      expect(result.narration?.highlights).toHaveLength(3);
      expect(result.warnings).toEqual([]);
    });

    it('accepts 6 highlights (the cap) with no warning', () => {
      const result = parseNarration(responseWith(6), EVENT_COUNT);
      expect(result.narration?.highlights).toHaveLength(6);
      expect(result.warnings).toEqual([]);
    });

    it('caps 7 supplied highlights at 6', () => {
      const result = parseNarration(responseWith(7), EVENT_COUNT);
      expect(result.narration?.highlights).toHaveLength(6);
      expect(result.warnings).toEqual([]);
    });
  });
});
