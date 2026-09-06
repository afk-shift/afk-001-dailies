/**
 * The whole player's state lives here: where we are in the reel, whether
 * it's rolling, and how fast.
 *
 * Playback is *event-cadenced*, not real time — a 40-minute session replays
 * in a couple of minutes because each event kind gets a dwell time chosen
 * for readability, not for fidelity to the clock. The session clock in the
 * transport still reports the real elapsed time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event } from '../../lib/types';

/** Dwell time per event kind at 1×, in ms. Divided by the current speed. */
const DWELL: Record<Event['kind'], number> = {
  prompt: 1400,
  reply: 900,
  tool: 220,
  commit: 1200,
  spawn: 900,
  milestone: 700,
};

export const SPEEDS = [1, 4, 16] as const;

/** How often, at most, the `?at=` deep link is rewritten. */
const URL_THROTTLE_MS = 400;

export interface Playback {
  index: number;
  playing: boolean;
  speed: number;
  /** True once playback has run off the end and auto-paused. */
  ended: boolean;
  /** True when the last move came from the timer — gates entrance motion. */
  animating: boolean;
  lastIndex: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (index: number) => void;
  step: (delta: number) => void;
  cycleSpeed: () => void;
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), max);
}

/** Rewrites `?at=` in place as the position changes, at most every 400ms. */
function useDeepLink(index: number): void {
  const pending = useRef<number | null>(null);
  const lastWrite = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const write = (value: number) => {
      lastWrite.current = Date.now();
      pending.current = null;
      const url = new URL(window.location.href);
      url.searchParams.set('at', String(value));
      window.history.replaceState(window.history.state, '', url);
    };

    const elapsed = Date.now() - lastWrite.current;
    if (elapsed >= URL_THROTTLE_MS) {
      write(index);
      return;
    }

    pending.current = index;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current !== null) write(pending.current);
    }, URL_THROTTLE_MS - elapsed);
  }, [index]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
}

export function usePlayback(events: Event[], initialIndex = 0): Playback {
  const last = Math.max(0, events.length - 1);
  const [index, setIndex] = useState(() => clamp(initialIndex, last));
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const speed = SPEEDS[speedIdx] ?? 1;
  const ended = !playing && index >= last && last > 0;

  useDeepLink(index);

  // The cadence loop. One timeout per event: the event at `index` holds the
  // screen for its dwell time, then the next one arrives.
  useEffect(() => {
    if (!playing || events.length === 0) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const kind = events[index]?.kind ?? 'reply';
    const delay = Math.max(40, DWELL[kind] / speed);
    const timer = setTimeout(() => {
      setAnimating(true);
      setIndex((i) => Math.min(i + 1, last));
    }, delay);
    return () => clearTimeout(timer);
  }, [playing, index, speed, events, last]);

  const play = useCallback(() => {
    setAnimating(true);
    // Rolling past the end and hitting play again starts the reel over.
    setIndex((i) => (i >= last ? 0 : i));
    setPlaying(true);
  }, [last]);

  const pause = useCallback(() => setPlaying(false), []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const seek = useCallback(
    (next: number) => {
      setAnimating(false);
      setIndex(clamp(next, last));
    },
    [last],
  );

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setAnimating(false);
      setIndex((i) => clamp(i + delta, last));
    },
    [last],
  );

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);

  return {
    index,
    playing,
    speed,
    ended,
    animating,
    lastIndex: last,
    play,
    pause,
    toggle,
    seek,
    step,
    cycleSpeed,
  };
}
