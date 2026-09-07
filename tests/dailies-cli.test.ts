import { describe, expect, it } from 'vitest';
import { buildPublishBody, parseFirstLine, publishSizeError } from '../scripts/dailies';
import type { Supercut } from '../src/lib/types';

describe('parseFirstLine', () => {
  it('finds cwd and sessionId even when the very first line is a sidecar line without either', () => {
    const lines = [
      JSON.stringify({ type: 'mode', mode: 'default' }), // sidecar: no cwd, no sessionId
      JSON.stringify({ type: 'user', cwd: '/Users/sean/workspace/surprise-me', sessionId: 'sess-real' }),
      JSON.stringify({ type: 'assistant', cwd: '/Users/sean/workspace/surprise-me', sessionId: 'sess-real' }),
    ];
    expect(parseFirstLine(lines)).toEqual({
      cwd: '/Users/sean/workspace/surprise-me',
      sessionId: 'sess-real',
    });
  });

  it('takes cwd and sessionId from different lines when neither single line has both', () => {
    const lines = [
      JSON.stringify({ type: 'mode' }),
      JSON.stringify({ type: 'user', sessionId: 'sess-only-id' }), // sessionId, no cwd
      JSON.stringify({ type: 'assistant', cwd: '/Users/sean/workspace/surprise-me' }), // cwd, no sessionId
    ];
    expect(parseFirstLine(lines)).toEqual({
      cwd: '/Users/sean/workspace/surprise-me',
      sessionId: 'sess-only-id',
    });
  });

  it('tolerates blank and malformed lines while scanning', () => {
    const lines = ['', '   ', 'not json at all', JSON.stringify({ type: 'user', cwd: '/repo', sessionId: 'abc' })];
    expect(parseFirstLine(lines)).toEqual({ cwd: '/repo', sessionId: 'abc' });
  });

  it('returns empty strings when no line has either field', () => {
    const lines = [JSON.stringify({ type: 'mode' }), JSON.stringify({ type: 'attachment' })];
    expect(parseFirstLine(lines)).toEqual({ cwd: '', sessionId: '' });
  });
});

describe('publishSizeError (CLI-side guard against the server\'s 2 MB payload cap)', () => {
  it('returns null for a small payload', () => {
    expect(publishSizeError(JSON.stringify({ hello: 'world' }))).toBeNull();
  });

  it('returns a clear message — not a network call — for a payload over 2 MB', () => {
    // 2 MB = 2 * 1024 * 1024 bytes; pad well past it.
    const oversized = JSON.stringify({ events: 'x'.repeat(3 * 1024 * 1024) });
    const message = publishSizeError(oversized);
    expect(message).not.toBeNull();
    expect(message).toMatch(/over the server's 2\.00 MB limit/);
    expect(message).toMatch(/Trim the session/);
  });

  it('is right at the boundary: exactly 2 MB passes, one byte over fails', () => {
    const TWO_MB = 2 * 1024 * 1024;
    const exact = 'x'.repeat(TWO_MB);
    expect(publishSizeError(exact)).toBeNull();
    expect(publishSizeError(`${exact}x`)).not.toBeNull();
  });
});

function fixtureSupercut(overrides: Partial<Supercut> = {}): Supercut {
  return {
    version: 1,
    slug: '', // always empty coming out of the parser — assigned server-side
    title: 'A session',
    sessionId: 'sess-1',
    project: 'dailies',
    startedAt: '2026-09-06T00:00:00.000Z',
    endedAt: '2026-09-06T00:01:00.000Z',
    stats: {
      durationMs: 0,
      turns: 0,
      toolCalls: 0,
      toolErrors: 0,
      filesTouched: 0,
      commits: 0,
      subagents: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    cast: [],
    chapters: [],
    events: [],
    files: [],
    ...overrides,
  };
}

describe('buildPublishBody (regression: a fresh publish must never send the parser\'s empty slug)', () => {
  it('strips slug entirely for a fresh publish (no --update)', () => {
    const body = buildPublishBody(fixtureSupercut(), { narrate: true });
    expect(body).not.toHaveProperty('slug');
  });

  it('keeps the rest of the document intact when stripping slug', () => {
    const supercut = fixtureSupercut({ title: 'My session' });
    const body = buildPublishBody(supercut, { narrate: true });
    expect(body).toMatchObject({
      version: 1,
      title: 'My session',
      sessionId: 'sess-1',
      project: 'dailies',
    });
    expect(body).not.toHaveProperty('slug');
  });

  it('includes slug only when --update was given', () => {
    const body = buildPublishBody(fixtureSupercut(), { narrate: true, slug: 'abcdefghij' });
    expect(body.slug).toBe('abcdefghij');
  });

  it('omits narrate when narration is on (server default), includes narrate: false when off', () => {
    const onBody = buildPublishBody(fixtureSupercut(), { narrate: true });
    expect(onBody).not.toHaveProperty('narrate');

    const offBody = buildPublishBody(fixtureSupercut(), { narrate: false });
    expect(offBody.narrate).toBe(false);
  });
});
