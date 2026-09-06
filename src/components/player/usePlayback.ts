/**
 * The whole player's state lives here: where we are in the reel, whether
 * it's rolling, how fast, and which cut is playing.
 *
 * Playback is *event-cadenced*, not real time — a 40-minute session replays
 * in a couple of minutes because each event kind gets a dwell time chosen
 * for readability, not for fidelity to the clock. The session clock in the
 * transport still reports the real elapsed time.
 *
 * Supercut mode plays only the narration's highlights: a short run-up into
 * each one, the highlight itself, a short run-out, then a dissolve to the
 * next. It falls back to linear whenever a supercut has no narration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Event, Narration } from '../../lib/types';

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

/** How often, at most, the deep link is rewritten. */
const URL_THROTTLE_MS = 400;

/** Events of run-up and run-out around each highlight in the condensed cut. */
const LEAD = 3;
const TAIL = 2;

/** Length of the fade between one highlight and the next. */
export const DISSOLVE_MS = 400;

export type PlaybackMode = 'linear' | 'supercut';

export interface HighlightWindow {
  eventIndex: number;
  text: string;
  /** First event of the run-up. */
  from: number;
  /** Last event of the run-out. */
  to: number;
}

/** One continuous stretch of the condensed cut. */
interface CutSegment {
  from: number;
  to: number;
  /** The highlight this stretch opens on. */
  lead: HighlightWindow;
}

export interface Playback {
  index: number;
  playing: boolean;
  speed: number;
  /** True when the last move came from the timer — gates entrance motion. */
  animating: boolean;
  /** Highest reachable index: `events.length - 1`, or 0 when empty. */
  lastIndex: number;
  mode: PlaybackMode;
  /** True for the beat between two highlights, while the reel fades. */
  dissolving: boolean;
  /** True when the narration carries enough to build a condensed cut. */
  hasSupercut: boolean;
  /** Every highlight, clamped and windowed — markers read from this. */
  highlights: HighlightWindow[];
  /** The highlight the playhead currently sits inside, in either mode. */
  activeHighlight: HighlightWindow | null;
  /** Where a dissolve in progress is heading. */
  nextHighlight: HighlightWindow | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (index: number) => void;
  step: (delta: number) => void;
  cycleSpeed: () => void;
  toggleMode: () => void;
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), max);
}

/** Highlights in event order, deduped, each grown into a playable window. */
function buildWindows(
  highlights: Narration['highlights'],
  lastIndex: number,
): HighlightWindow[] {
  const seen = new Set<number>();
  const windows: HighlightWindow[] = [];

  for (const highlight of [...highlights].sort(
    (a, b) => a.eventIndex - b.eventIndex,
  )) {
    const at = clamp(highlight.eventIndex, lastIndex);
    if (seen.has(at) || !highlight.text) continue;
    seen.add(at);
    windows.push({
      eventIndex: at,
      text: highlight.text,
      from: Math.max(0, at - LEAD),
      to: Math.min(lastIndex, at + TAIL),
    });
  }

  return windows;
}

/** Windows close enough to touch play as one stretch rather than dissolving. */
function buildSegments(windows: HighlightWindow[]): CutSegment[] {
  const segments: CutSegment[] = [];

  for (const window of windows) {
    const previous = segments[segments.length - 1];
    if (previous && window.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, window.to);
      continue;
    }
    segments.push({ from: window.from, to: window.to, lead: window });
  }

  return segments;
}

/** The segment holding `index`, or the next one due after it. */
function segmentAt(segments: CutSegment[], index: number): number {
  for (let i = 0; i < segments.length; i++) {
    if (index <= segments[i]!.to) return i;
  }
  return Math.max(0, segments.length - 1);
}

/**
 * Rewrites `?at=` and `?cut=` in place as the position changes, at most every
 * 400ms.
 *
 * Stays hands-off until playback actually diverges from where it started — a
 * fresh page load must not stamp `?at=0` onto a clean URL just because
 * playback starts at position 0. Once it has diverged, every subsequent
 * position gets written, including a trip back down to 0 — except that if the
 * URL had no `at` param to begin with, returning to 0 removes the param again
 * rather than leaving a stray `?at=0` behind.
 */
function useDeepLink(
  index: number,
  initialIndex: number,
  mode: PlaybackMode,
  initialMode: PlaybackMode,
): void {
  const pending = useRef<number | null>(null);
  const lastWrite = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtied = useRef(false);
  const hadAtParam = useRef<boolean | null>(null);

  // Read inside the throttled write, which can fire after a mode change.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (hadAtParam.current === null) {
      hadAtParam.current = new URL(window.location.href).searchParams.has('at');
    }

    if (!dirtied.current) {
      if (index === initialIndex && mode === initialMode) return;
      dirtied.current = true;
    }

    const write = (value: number) => {
      lastWrite.current = Date.now();
      pending.current = null;
      const url = new URL(window.location.href);
      if (value === 0 && !hadAtParam.current) {
        url.searchParams.delete('at');
      } else {
        url.searchParams.set('at', String(value));
      }
      if (modeRef.current === 'supercut') {
        url.searchParams.set('cut', '1');
      } else {
        url.searchParams.delete('cut');
      }
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
  }, [index, initialIndex, mode, initialMode]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
}

export function usePlayback(
  events: Event[],
  highlights: Narration['highlights'] | undefined,
  initialIndex = 0,
  initialMode: PlaybackMode = 'linear',
): Playback {
  const last = Math.max(0, events.length - 1);

  const windows = useMemo(
    () => buildWindows(highlights ?? [], last),
    [highlights, last],
  );
  const segments = useMemo(() => buildSegments(windows), [windows]);
  const hasSupercut = segments.length > 0;

  const [index, setIndex] = useState(() => clamp(initialIndex, last));
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [mode, setMode] = useState<PlaybackMode>(
    hasSupercut ? initialMode : 'linear',
  );
  const cutStep = useMemo(
    () => segmentAt(segments, index),
    [segments, index],
  );
  const [dissolving, setDissolving] = useState(false);
  const speed = SPEEDS[speedIdx] ?? 1;

  // Captured once — the position and cut playback actually started from — so
  // the deep-link writer can tell "still at the start" apart from "moved, then
  // came back".
  const startIndex = useRef(index).current;
  const startMode = useRef(mode).current;
  useDeepLink(index, startIndex, mode, startMode);

  // The cadence loop. One timeout per event: the event at `index` holds the
  // screen for its dwell time, then the next one arrives. In supercut mode the
  // same loop also handles the jumps — running out of a segment starts a
  // dissolve, and the dissolve lands on the next segment's run-up.
  useEffect(() => {
    if (!playing || events.length === 0) return;

    if (mode === 'supercut') {
      const segment = segments[cutStep];
      if (!segment) {
        setPlaying(false);
        return;
      }

      if (dissolving) {
        const timer = setTimeout(() => {
          const next = segments[cutStep + 1];
          setDissolving(false);
          if (!next) {
            setPlaying(false);
            return;
          }
          setAnimating(true);
          setIndex(next.from);
        }, DISSOLVE_MS);
        return () => clearTimeout(timer);
      }

      // Landing short of the segment — after a scrub, say — skips the gap
      // rather than crawling through it.
      if (index < segment.from) {
        setAnimating(false);
        setIndex(segment.from);
        return;
      }

      if (index >= segment.to) {
        if (cutStep + 1 >= segments.length) {
          setAnimating(false);
          setIndex(last);
          setPlaying(false);
          return;
        }
        setDissolving(true);
        return;
      }
    } else if (index >= last) {
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
  }, [
    playing,
    index,
    speed,
    events,
    last,
    mode,
    segments,
    cutStep,
    dissolving,
  ]);

  const play = useCallback(() => {
    setAnimating(true);
    // Rolling past the end and hitting play again starts the reel over.
    if (index >= last) {
      if (mode === 'supercut' && segments[0]) {
        setIndex(segments[0].from);
      } else {
        setIndex(0);
      }
    }
    setPlaying(true);
  }, [index, last, mode, segments]);

  const pause = useCallback(() => {
    setPlaying(false);
    setDissolving(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const moveTo = useCallback(
    (next: number) => {
      const target = clamp(next, last);
      setDissolving(false);
      setAnimating(false);
      setIndex(target);
    },
    [last],
  );

  const seek = useCallback((next: number) => moveTo(next), [moveTo]);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      moveTo(index + delta);
    },
    [index, moveTo],
  );

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);

  const toggleMode = useCallback(() => {
    if (mode === 'supercut') {
      setMode('linear');
      setDissolving(false);
      return;
    }
    const first = segments[0];
    if (!first) return;
    setMode('supercut');
    setDissolving(false);
    setAnimating(true);
    setIndex(first.from);
    setPlaying(true);
  }, [mode, segments]);

  const activeHighlight = useMemo(() => {
    let best: HighlightWindow | null = null;
    for (const window of windows) {
      if (index < window.from || index > window.to) continue;
      const closer =
        !best ||
        Math.abs(window.eventIndex - index) < Math.abs(best.eventIndex - index);
      if (closer) best = window;
    }
    return best;
  }, [windows, index]);

  const nextHighlight = dissolving
    ? (segments[cutStep + 1]?.lead ?? null)
    : null;

  return {
    index,
    playing,
    speed,
    animating,
    lastIndex: last,
    mode,
    dissolving,
    hasSupercut,
    highlights: windows,
    activeHighlight,
    nextHighlight,
    play,
    pause,
    toggle,
    seek,
    step,
    cycleSpeed,
    toggleMode,
  };
}
