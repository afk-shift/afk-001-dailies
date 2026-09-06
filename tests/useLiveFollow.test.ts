import { describe, expect, it } from 'vitest';
import { nextPollDecision } from '../src/components/player/useLiveFollow';

const HOUR = 60 * 60_000;

describe('nextPollDecision (unbounded live polling stop conditions)', () => {
  it('continues when nothing has tripped', () => {
    expect(nextPollDecision({ noGrowthPolls: 0, elapsedMs: 0, narrated: false })).toEqual({
      action: 'continue',
    });
  });

  it('continues just under every threshold', () => {
    expect(
      nextPollDecision({ noGrowthPolls: 29, elapsedMs: 2 * HOUR - 1, narrated: false }),
    ).toEqual({ action: 'continue' });
  });

  it('stops for narration — the watcher\'s final publish means the session ended', () => {
    expect(nextPollDecision({ noGrowthPolls: 0, elapsedMs: 0, narrated: true })).toEqual({
      action: 'stop',
      reason: 'narrated',
    });
  });

  it('stops as stale after 30 consecutive no-growth polls', () => {
    expect(nextPollDecision({ noGrowthPolls: 30, elapsedMs: 0, narrated: false })).toEqual({
      action: 'stop',
      reason: 'stale',
    });
  });

  it('stops on timeout after 2 hours total', () => {
    expect(nextPollDecision({ noGrowthPolls: 0, elapsedMs: 2 * HOUR, narrated: false })).toEqual({
      action: 'stop',
      reason: 'timeout',
    });
  });

  it('narration takes precedence over stale and timeout when all three have tripped', () => {
    expect(
      nextPollDecision({ noGrowthPolls: 30, elapsedMs: 2 * HOUR, narrated: true }),
    ).toEqual({ action: 'stop', reason: 'narrated' });
  });

  it('staleness takes precedence over timeout when both have tripped', () => {
    expect(
      nextPollDecision({ noGrowthPolls: 30, elapsedMs: 2 * HOUR, narrated: false }),
    ).toEqual({ action: 'stop', reason: 'stale' });
  });

  it('resume path: fresh counters (as set right after resume()) continue polling again', () => {
    // This is the state `useLiveFollow`'s effect re-seeds when `resume()` is
    // called: noGrowthPolls and elapsedMs reset to zero for a brand new
    // follow run, so polling should pick back up rather than immediately
    // re-stopping.
    const freshAfterResume = { noGrowthPolls: 0, elapsedMs: 0, narrated: false };
    expect(nextPollDecision(freshAfterResume)).toEqual({ action: 'continue' });
  });
});
