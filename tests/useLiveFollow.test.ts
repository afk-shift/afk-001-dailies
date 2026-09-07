import { describe, expect, it } from 'vitest';
import {
  hasLiveChange,
  nextPollDecision,
  snapshotOf,
  type FollowSnapshot,
} from '../src/components/player/useLiveFollow';
import type { Supercut } from '../src/lib/types';

const HOUR = 60 * 60_000;

function makeSupercut(overrides: Partial<Supercut> = {}): Supercut {
  return {
    version: 1,
    slug: 'abcdefghij',
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

describe('nextPollDecision (unbounded live polling stop conditions)', () => {
  it('continues when nothing has tripped', () => {
    expect(nextPollDecision({ noChangePolls: 0, elapsedMs: 0, narrated: false })).toEqual({
      action: 'continue',
    });
  });

  it('continues just under every threshold', () => {
    expect(
      nextPollDecision({ noChangePolls: 29, elapsedMs: 2 * HOUR - 1, narrated: false }),
    ).toEqual({ action: 'continue' });
  });

  it('stops for narration — the watcher\'s final publish means the session ended', () => {
    expect(nextPollDecision({ noChangePolls: 0, elapsedMs: 0, narrated: true })).toEqual({
      action: 'stop',
      reason: 'narrated',
    });
  });

  it('stops as stale after 30 consecutive no-change polls', () => {
    expect(nextPollDecision({ noChangePolls: 30, elapsedMs: 0, narrated: false })).toEqual({
      action: 'stop',
      reason: 'stale',
    });
  });

  it('stops on timeout after 2 hours total', () => {
    expect(nextPollDecision({ noChangePolls: 0, elapsedMs: 2 * HOUR, narrated: false })).toEqual({
      action: 'stop',
      reason: 'timeout',
    });
  });

  it('narration takes precedence over stale and timeout when all three have tripped', () => {
    expect(
      nextPollDecision({ noChangePolls: 30, elapsedMs: 2 * HOUR, narrated: true }),
    ).toEqual({ action: 'stop', reason: 'narrated' });
  });

  it('staleness takes precedence over timeout when both have tripped', () => {
    expect(
      nextPollDecision({ noChangePolls: 30, elapsedMs: 2 * HOUR, narrated: false }),
    ).toEqual({ action: 'stop', reason: 'stale' });
  });

  it('resume path: fresh counters (as set right after resume()) continue polling again', () => {
    // This is the state `useLiveFollow`'s effect re-seeds when `resume()` is
    // called: noChangePolls and elapsedMs reset to zero for a brand new
    // follow run, so polling should pick back up rather than immediately
    // re-stopping.
    const freshAfterResume = { noChangePolls: 0, elapsedMs: 0, narrated: false };
    expect(nextPollDecision(freshAfterResume)).toEqual({ action: 'continue' });
  });
});

describe('snapshotOf', () => {
  it('keys narration by generatedBy + synopsis, and is null when there is no narration', () => {
    expect(snapshotOf(makeSupercut()).narrationKey).toBeNull();
    const narrated = makeSupercut({
      narration: { synopsis: 'Did a thing', highlights: [], generatedBy: 'claude-sonnet-5' },
    });
    expect(snapshotOf(narrated).narrationKey).toBe('claude-sonnet-5::Did a thing');
  });
});

describe('hasLiveChange (the "final narrated publish" fix — apply before stop)', () => {
  it('is true when events grew, regardless of last', () => {
    const next = makeSupercut({ events: [{ i: 0, t: 't', dtMs: 0, kind: 'milestone', text: 'x' }] });
    expect(hasLiveChange(next, 0, snapshotOf(makeSupercut()))).toBe(true);
  });

  it("catches the watcher's final publish: narration appears with zero new events", () => {
    const next = makeSupercut({
      narration: { synopsis: 'Wrapped up', highlights: [], generatedBy: 'claude-sonnet-5' },
    });
    const last: FollowSnapshot = snapshotOf(makeSupercut());
    expect(hasLiveChange(next, 0, last)).toBe(true);
  });

  it('is true when narration content changes on a later pass (same generator, new synopsis)', () => {
    const prev = makeSupercut({
      narration: { synopsis: 'First cut', highlights: [], generatedBy: 'claude-sonnet-5' },
    });
    const next = makeSupercut({
      narration: { synopsis: 'Revised cut', highlights: [], generatedBy: 'claude-sonnet-5' },
    });
    expect(hasLiveChange(next, 0, snapshotOf(prev))).toBe(true);
  });

  it('is true when only the title changed', () => {
    const last = snapshotOf(makeSupercut({ title: 'Working title' }));
    const next = makeSupercut({ title: 'Refined title' });
    expect(hasLiveChange(next, 0, last)).toBe(true);
  });

  it('is true when only endedAt changed', () => {
    const last = snapshotOf(makeSupercut({ endedAt: '2026-09-06T00:01:00.000Z' }));
    const next = makeSupercut({ endedAt: '2026-09-06T00:05:00.000Z' });
    expect(hasLiveChange(next, 0, last)).toBe(true);
  });

  it('is false when nothing changed at all', () => {
    const supercut = makeSupercut();
    expect(hasLiveChange(supercut, 0, snapshotOf(supercut))).toBe(false);
  });

  it("a first poll seeded from the rendered (unnarrated) supercut still catches a final publish that lands with the same events already narrated, and that stops polling as 'narrated'", () => {
    // The rendered doc has no narration yet — this is what `useLiveFollow`
    // now seeds its comparison snapshot with instead of `null`, so the very
    // first poll has something real to compare against.
    const rendered = makeSupercut();
    const seeded = snapshotOf(rendered);

    // The first poll's response: same events, but the watcher's final
    // (narrated) publish already landed.
    const next = makeSupercut({
      narration: { synopsis: 'Wrapped up', highlights: [], generatedBy: 'claude-sonnet-5' },
    });

    expect(hasLiveChange(next, rendered.events.length, seeded)).toBe(true);
    expect(nextPollDecision({ noChangePolls: 0, elapsedMs: 0, narrated: Boolean(next.narration) })).toEqual({
      action: 'stop',
      reason: 'narrated',
    });
  });
});
