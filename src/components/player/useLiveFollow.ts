/**
 * Following a session that is still being written.
 *
 * The CLI's `--watch` mode republishes a growing session over the same slug
 * every twenty seconds or so, so the page re-reads `/s/<slug>.json` on a timer
 * and hands the whole document back whenever it has more events than what's on
 * screen. The JSON is the source of truth — nothing here diffs it.
 *
 * Polling only runs while the tab is visible, and a failed read backs off
 * rather than hammering a server that's already unhappy. It also doesn't run
 * forever: `nextPollDecision` below stops it for good once the session looks
 * over (or polling has stopped being useful), rather than hammering
 * `/s/<slug>.json` every 15s indefinitely.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Supercut } from '../../lib/types';

/** Poll interval, then the two backoff steps a failing poll walks up. */
const INTERVALS = [15_000, 30_000, 60_000];

/** How recently a session must have ended to still count as "probably live". */
const RUNNING_WINDOW_MS = 30 * 60_000;

/** Consecutive no-growth polls before the session is considered stale (~7.5 min at the 15s base interval). */
const MAX_NO_GROWTH_POLLS = 30;

/** Total time a single follow run is allowed to keep polling. */
const MAX_FOLLOW_MS = 2 * 60 * 60_000;

/** Why polling stopped itself — drives the "session ended" vs "stopped following" copy. */
export type PollStopReason = 'narrated' | 'stale' | 'timeout';

export interface PollState {
  /** Consecutive polls since the transcript last grew. */
  noGrowthPolls: number;
  /** Ms elapsed since this follow run started (or was last resumed). */
  elapsedMs: number;
  /** Whether the most recently fetched supercut carries narration. */
  narrated: boolean;
}

export type PollDecision = { action: 'continue' } | { action: 'stop'; reason: PollStopReason };

/**
 * Whether the poll loop should keep going, given how a follow run has
 * behaved so far. Checked in order of precedence:
 *   1. Narration means the watcher's final publish already landed (the
 *      session is over) — wins over the other two regardless of counters.
 *   2. 30 consecutive polls with no growth means the session looks stalled.
 *   3. 2 hours total is a hard cap so a forgotten tab can't poll forever.
 */
export function nextPollDecision(state: PollState): PollDecision {
  if (state.narrated) return { action: 'stop', reason: 'narrated' };
  if (state.noGrowthPolls >= MAX_NO_GROWTH_POLLS) return { action: 'stop', reason: 'stale' };
  if (state.elapsedMs >= MAX_FOLLOW_MS) return { action: 'stop', reason: 'timeout' };
  return { action: 'continue' };
}

export interface LiveFollow {
  /** True once a poll has failed and the next one is on a longer fuse. */
  reconnecting: boolean;
  /** Epoch ms of the last time the supercut changed under us. */
  updatedAt: number | null;
  /** Events that have arrived since the page opened. */
  added: number;
  /** Set once polling has stopped itself; null while still following. */
  stopped: PollStopReason | null;
  /** Restarts polling with fresh counters, without touching `?live=1`. */
  resume: () => void;
}

export function useLiveFollow(
  slug: string,
  enabled: boolean,
  count: number,
  onGrow: (next: Supercut) => void,
): LiveFollow {
  const [reconnecting, setReconnecting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stopped, setStopped] = useState<PollStopReason | null>(null);
  // Bumped by `resume()` to force the effect below to re-run with a fresh
  // closure — which is where `noGrowthPolls`/`startedAt` actually reset.
  const [resumeToken, setResumeToken] = useState(0);

  const baseline = useRef(count).current;

  // Read inside the poll loop, which outlives the render that armed it.
  const countRef = useRef(count);
  countRef.current = count;
  const growRef = useRef(onGrow);
  growRef.current = onGrow;

  const resume = useCallback(() => {
    setStopped(null);
    setResumeToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !slug || typeof window === 'undefined') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let noGrowthPolls = 0;
    const startedAt = Date.now();

    const schedule = () => {
      if (cancelled || timer) return;
      const wait = INTERVALS[Math.min(failures, INTERVALS.length - 1)]!;
      timer = setTimeout(poll, wait);
    };

    const haltPolling = (reason: PollStopReason) => {
      if (timer) clearTimeout(timer);
      timer = null;
      setStopped(reason);
    };

    const poll = async () => {
      timer = null;
      if (cancelled || document.hidden) return;

      try {
        const response = await fetch(`/s/${encodeURIComponent(slug)}.json`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = (await response.json()) as Supercut;
        if (cancelled) return;

        failures = 0;
        setReconnecting(false);

        const grew = Array.isArray(next.events) && next.events.length > countRef.current;
        if (grew) {
          noGrowthPolls = 0;
          growRef.current(next);
          setUpdatedAt(Date.now());
        } else {
          noGrowthPolls += 1;
        }

        const decision = nextPollDecision({
          noGrowthPolls,
          elapsedMs: Date.now() - startedAt,
          narrated: Boolean(next.narration),
        });
        if (decision.action === 'stop') {
          haltPolling(decision.reason);
          return;
        }
      } catch {
        if (cancelled) return;
        failures = Math.min(failures + 1, INTERVALS.length - 1);
        setReconnecting(true);
      }

      schedule();
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (!timer) void poll();
    };

    setUpdatedAt(Date.now());
    setReconnecting(false);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, slug, resumeToken]);

  return {
    reconnecting,
    updatedAt: enabled ? updatedAt : null,
    added: Math.max(0, count - baseline),
    stopped: enabled ? stopped : null,
    resume,
  };
}

/**
 * Whether this supercut looks like a session still in progress: nothing has
 * narrated it yet (narration is written once, at the end) and it stopped
 * recently enough that more could still be coming.
 */
export function useLikelyRunning(supercut: Supercut): boolean {
  const { endedAt, narration } = supercut;
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (narration) {
      setRunning(false);
      return;
    }
    const ended = Date.parse(endedAt);
    const check = () =>
      setRunning(
        Number.isFinite(ended) && Date.now() - ended < RUNNING_WINDOW_MS,
      );
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [endedAt, narration]);

  return running;
}
