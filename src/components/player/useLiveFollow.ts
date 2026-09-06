/**
 * Following a session that is still being written.
 *
 * The CLI's `--watch` mode republishes a growing session over the same slug
 * every twenty seconds or so, so the page re-reads `/s/<slug>.json` on a timer
 * and hands the whole document back whenever it has more events than what's on
 * screen. The JSON is the source of truth — nothing here diffs it.
 *
 * Polling only runs while the tab is visible, and a failed read backs off
 * rather than hammering a server that's already unhappy.
 */

import { useEffect, useRef, useState } from 'react';
import type { Supercut } from '../../lib/types';

/** Poll interval, then the two backoff steps a failing poll walks up. */
const INTERVALS = [15_000, 30_000, 60_000];

/** How recently a session must have ended to still count as "probably live". */
const RUNNING_WINDOW_MS = 30 * 60_000;

export interface LiveFollow {
  /** True once a poll has failed and the next one is on a longer fuse. */
  reconnecting: boolean;
  /** Epoch ms of the last time the supercut changed under us. */
  updatedAt: number | null;
  /** Events that have arrived since the page opened. */
  added: number;
}

export function useLiveFollow(
  slug: string,
  enabled: boolean,
  count: number,
  onGrow: (next: Supercut) => void,
): LiveFollow {
  const [reconnecting, setReconnecting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const baseline = useRef(count).current;

  // Read inside the poll loop, which outlives the render that armed it.
  const countRef = useRef(count);
  countRef.current = count;
  const growRef = useRef(onGrow);
  growRef.current = onGrow;

  useEffect(() => {
    if (!enabled || !slug || typeof window === 'undefined') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const schedule = () => {
      if (cancelled || timer) return;
      const wait = INTERVALS[Math.min(failures, INTERVALS.length - 1)]!;
      timer = setTimeout(poll, wait);
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
        if (Array.isArray(next.events) && next.events.length > countRef.current) {
          growRef.current(next);
          setUpdatedAt(Date.now());
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
  }, [enabled, slug]);

  return {
    reconnecting,
    updatedAt: enabled ? updatedAt : null,
    added: Math.max(0, count - baseline),
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
