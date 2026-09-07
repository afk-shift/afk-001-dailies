/**
 * The supercut player — one React island for the whole of /s/[slug].
 *
 * Everything below is a view of a single piece of state: the event index.
 * `usePlayback` owns it; the transport, the chapter rail, the reel, and the
 * side panel all read from it and seek it.
 *
 * The supercut itself is state too, because `?live=1` lets a session keep
 * growing under the playhead while you watch it.
 *
 * From `lg` up the player owns the viewport: slate band on top, transport
 * welded to the bottom edge, and the reel the only thing that scrolls. Below
 * that it is an ordinary document.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Supercut } from '../../lib/types';
import { ChapterRail, currentChapterIndex } from './ChapterRail';
import { EndCard, LiveEndCard } from './EndCard';
import { HighlightCaption } from './HighlightCaption';
import { LivePill } from './LivePill';
import { buildHueMap } from './model-colors';
import { Reel } from './Reel';
import { SidePanel, type RevealedFile } from './SidePanel';
import { SlateBand } from './SlateBand';
import { Transport } from './Transport';
import { useLikelyRunning, useLiveFollow } from './useLiveFollow';
import { usePlayback, type PlaybackMode } from './usePlayback';
import { useReducedMotion } from './useReducedMotion';

/** Tools whose label is the path they wrote to — how files get revealed. */
const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

interface PlayerProps {
  supercut: Supercut;
  /** Starting position, from `?at=` on the server. Always starts paused. */
  initialIndex?: number;
  /** Starting cut, from `?cut=` on the server. */
  initialMode?: PlaybackMode;
  /** Follow a still-running session, from `?live=1` on the server. */
  initialLive?: boolean;
}

export function Player({
  supercut: published,
  initialIndex = 0,
  initialMode = 'linear',
  initialLive = false,
}: PlayerProps) {
  // A followed session grows, so the document the page renders is state, not
  // the prop. Each poll replaces it whole.
  const [supercut, setSupercut] = useState(published);
  const [live, setLive] = useState(initialLive);

  const { events, chapters } = supercut;

  // Live follow can replace `supercut` with a refreshed publish whose title
  // changed — the `<h1>` already re-renders off state, but `document.title`
  // needs its own push to stay in sync. Matches the separator Base.astro uses.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = `${supercut.title} — Dailies`;
  }, [supercut.title]);

  const follow = useLiveFollow(supercut.slug, live, events.length, supercut, setSupercut);
  const likelyRunning = useLikelyRunning(supercut);

  // `live` alone isn't "still actively following" — `useLiveFollow` can stop
  // itself (narration landed, or the session looks stalled/timed out)
  // without `live` ever going false, so the pill and the reel would
  // otherwise disagree about whether the session is still live. This is the
  // one signal both the end card and the deep-link writer key off of.
  const activelyFollowing = live && follow.stopped === null;

  const playback = usePlayback(
    events,
    supercut.narration?.highlights,
    initialIndex,
    initialMode,
    activelyFollowing,
  );
  const { index, lastIndex, seek, step, toggle, toggleMode } = playback;
  const reducedMotion = useReducedMotion();

  const toggleLive = useCallback(() => {
    setLive((on) => !on);
  }, []);

  // `live` joins `?at=`/`?cut=` in the URL so the followed view is shareable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('live') === live) return;
    if (live) url.searchParams.set('live', '1');
    else url.searchParams.delete('live');
    window.history.replaceState(window.history.state, '', url);
  }, [live]);

  const hues = useMemo(() => buildHueMap(supercut.cast), [supercut.cast]);

  // A file is revealed the first time a file-touching tool names it. Files
  // only ever touched inside a subagent never appear as events, so they
  // surface at the end of the reel instead of never.
  const files: RevealedFile[] = useMemo(() => {
    const firstTouch = new Map<string, number>();
    for (const event of events) {
      if (event.kind !== 'tool' || !FILE_TOOLS.has(event.tool)) continue;
      if (!firstTouch.has(event.label)) firstTouch.set(event.label, event.i);
    }
    return supercut.files.map((file) => ({
      ...file,
      at: firstTouch.get(file.path) ?? lastIndex,
    }));
  }, [events, supercut.files, lastIndex]);

  const soFar = useMemo(() => {
    let toolCalls = 0;
    let commits = 0;
    for (let i = 0; i <= index && i < events.length; i++) {
      const event = events[i]!;
      if (event.kind === 'tool') toolCalls++;
      else if (event.kind === 'commit') commits++;
    }
    return {
      toolCalls,
      commits,
      files: files.filter((file) => file.at <= index).length,
    };
  }, [index, events, files]);

  const jumpChapter = useCallback(
    (direction: -1 | 1) => {
      if (chapters.length === 0) return;
      const current = currentChapterIndex(chapters, index);
      // Going back from mid-chapter restarts the chapter first, the way a
      // track-back button works.
      if (direction === -1 && current >= 0) {
        const start = chapters[current]!.startIndex;
        if (index > start) {
          seek(start);
          return;
        }
      }
      const target = Math.min(
        Math.max(current + direction, 0),
        chapters.length - 1,
      );
      seek(chapters[target]!.startIndex);
    },
    [chapters, index, seek],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      const onControl =
        tag === 'INPUT' ||
        tag === 'BUTTON' ||
        tag === 'A' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable === true;
      const typing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable === true;

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          // A focused button gets to handle its own space press.
          if (onControl) return;
          event.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          // The scrubber already steps by one on its own.
          if (tag === 'INPUT') return;
          event.preventDefault();
          step(-1);
          break;
        case 'ArrowRight':
          if (tag === 'INPUT') return;
          event.preventDefault();
          step(1);
          break;
        case '[':
          event.preventDefault();
          jumpChapter(-1);
          break;
        case ']':
          event.preventDefault();
          jumpChapter(1);
          break;
        case 's':
        case 'S':
          if (typing) return;
          event.preventDefault();
          toggleMode();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle, step, jumpChapter, toggleMode]);

  const atEnd = events.length > 0 && index >= lastIndex;

  return (
    <div
      id="supercut-player"
      className="w-full max-w-full overflow-x-clip lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden"
    >
      <SlateBand
        supercut={supercut}
        badge={
          <LivePill
            live={live}
            offer={likelyRunning}
            reconnecting={follow.reconnecting}
            updatedAt={follow.updatedAt}
            added={follow.added}
            stopped={follow.stopped}
            onToggle={toggleLive}
            onResume={follow.resume}
          />
        }
      />

      <div className="mx-auto grid w-full max-w-7xl min-w-0 gap-x-8 gap-y-6 px-4 py-4 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)] lg:min-h-0 lg:flex-1 lg:grid-cols-[13rem_minmax(0,1fr)_17rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-y-0 lg:py-0">
        <ChapterRail chapters={chapters} index={index} onSeek={seek} />

        <Reel
          events={events}
          chapters={chapters}
          index={index}
          playing={playback.playing}
          animating={playback.animating}
          dissolving={playback.dissolving}
          reducedMotion={reducedMotion}
          hues={hues}
          endCard={
            atEnd ? (
              activelyFollowing ? (
                <LiveEndCard />
              ) : (
                <EndCard supercut={supercut} onReplay={playback.play} />
              )
            ) : null
          }
        />

        <div className="md:col-span-2 lg:col-span-1 lg:min-h-0">
          <SidePanel
            supercut={supercut}
            index={index}
            lastIndex={lastIndex}
            soFar={soFar}
            files={files}
            onSeek={seek}
          />
        </div>
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-line bg-ink/90 backdrop-blur">
        <HighlightCaption
          active={playback.activeHighlight}
          next={playback.nextHighlight}
        />
        <Transport
          index={index}
          lastIndex={lastIndex}
          playing={playback.playing}
          speed={playback.speed}
          chapters={chapters}
          current={events[index]}
          mode={playback.mode}
          hasSupercut={playback.hasSupercut}
          highlights={playback.highlights}
          onToggle={toggle}
          onSeek={seek}
          onCycleSpeed={playback.cycleSpeed}
          onToggleMode={toggleMode}
        />
      </div>
    </div>
  );
}
