import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  formatTickLine,
  hasChanged,
  initWatchState,
  resolveIntervalSeconds,
  stop,
  tick,
  type WatchSnapshot,
} from '../scripts/lib/watch';

describe('resolveIntervalSeconds', () => {
  it('defaults to 20 when no interval is given', () => {
    expect(resolveIntervalSeconds(undefined)).toBe(DEFAULT_INTERVAL_SECONDS);
  });

  it('defaults to 20 when the value is not finite (e.g. NaN)', () => {
    expect(resolveIntervalSeconds(Number.NaN)).toBe(DEFAULT_INTERVAL_SECONDS);
  });

  it('passes through a value at or above the minimum', () => {
    expect(resolveIntervalSeconds(30)).toBe(30);
    expect(resolveIntervalSeconds(MIN_INTERVAL_SECONDS)).toBe(MIN_INTERVAL_SECONDS);
  });

  it('clamps a value below the minimum up to 5', () => {
    expect(resolveIntervalSeconds(1)).toBe(MIN_INTERVAL_SECONDS);
    expect(resolveIntervalSeconds(0)).toBe(MIN_INTERVAL_SECONDS);
    expect(resolveIntervalSeconds(-10)).toBe(MIN_INTERVAL_SECONDS);
  });
});

describe('hasChanged', () => {
  const base: WatchSnapshot = { eventsLength: 10, toolCalls: 4 };

  it('is false when both tracked fields are identical', () => {
    expect(hasChanged(base, { eventsLength: 10, toolCalls: 4 })).toBe(false);
  });

  it('is true when eventsLength differs', () => {
    expect(hasChanged(base, { eventsLength: 11, toolCalls: 4 })).toBe(true);
  });

  it('is true when toolCalls differs', () => {
    expect(hasChanged(base, { eventsLength: 10, toolCalls: 5 })).toBe(true);
  });

  it('is true when both differ', () => {
    expect(hasChanged(base, { eventsLength: 12, toolCalls: 6 })).toBe(true);
  });
});

describe('tick (watch-loop state machine, interval ticks)', () => {
  it('skips and leaves state untouched when nothing changed', () => {
    const state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const { state: next, command } = tick(state, { eventsLength: 10, toolCalls: 4 });
    expect(command).toEqual({ kind: 'skip' });
    expect(next).toEqual(state);
  });

  it('republishes without narration when events grew, and advances state', () => {
    const state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const { state: next, command } = tick(state, { eventsLength: 16, toolCalls: 6 });
    expect(command).toEqual({ kind: 'republish', narrate: false, final: false, deltaEvents: 6 });
    expect(next).toEqual({ last: { eventsLength: 16, toolCalls: 6 } });
  });

  it('republishes when only toolCalls changed (deltaEvents can be 0)', () => {
    const state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const { command } = tick(state, { eventsLength: 10, toolCalls: 7 });
    expect(command).toEqual({ kind: 'republish', narrate: false, final: false, deltaEvents: 0 });
  });

  it('a skip followed by a real change still diffs against the original last-published snapshot', () => {
    let state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const first = tick(state, { eventsLength: 10, toolCalls: 4 });
    expect(first.command).toEqual({ kind: 'skip' });
    state = first.state;

    const second = tick(state, { eventsLength: 13, toolCalls: 4 });
    expect(second.command).toEqual({ kind: 'republish', narrate: false, final: false, deltaEvents: 3 });
  });
});

describe('stop (final-publish-on-stop, SIGINT)', () => {
  it('always republishes even when nothing changed since the last tick', () => {
    const state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const { command } = stop(state, { eventsLength: 10, toolCalls: 4 }, false);
    expect(command.kind).toBe('republish');
    expect(command).toMatchObject({ final: true, deltaEvents: 0 });
  });

  it('narrates by default (noNarrate: false)', () => {
    const state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const { command } = stop(state, { eventsLength: 12, toolCalls: 5 }, false);
    expect(command).toMatchObject({ narrate: true, final: true, deltaEvents: 2 });
  });

  it('suppresses narration when noNarrate is true (--no-narrate)', () => {
    const state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const { command } = stop(state, { eventsLength: 12, toolCalls: 5 }, true);
    expect(command).toMatchObject({ narrate: false, final: true, deltaEvents: 2 });
  });

  it('is marked final even though a regular tick with the same snapshot would not be', () => {
    const state = initWatchState({ eventsLength: 10, toolCalls: 4 });
    const stopped = stop(state, { eventsLength: 16, toolCalls: 6 }, false);
    const ticked = tick(state, { eventsLength: 16, toolCalls: 6 });
    expect(stopped.command).toMatchObject({ final: true });
    expect(ticked.command).toMatchObject({ final: false });
  });
});

describe('formatTickLine', () => {
  it('formats hh:mm:ss with zero-padding, plus event/tool/commit counts', () => {
    const now = new Date(2026, 8, 6, 9, 4, 7);
    expect(formatTickLine(now, 3, 12, 2)).toBe('09:04:07  +3 events · tools 12 · commits 2');
  });

  it('handles double-digit time components without extra padding', () => {
    const now = new Date(2026, 8, 6, 23, 59, 59);
    expect(formatTickLine(now, 0, 100, 10)).toBe('23:59:59  +0 events · tools 100 · commits 10');
  });
});
