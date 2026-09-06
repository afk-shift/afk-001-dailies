/**
 * The loudest object on the page, because this is a player. The track is
 * indexed by event, not by time — a tick marks where each chapter opens and a
 * diamond marks each narration highlight — while the left-hand clock keeps
 * reporting the session's real elapsed time.
 */

import type { Chapter, Event } from '../../lib/types';
import { formatClock, padIndex } from './format';
import { PauseGlyph, PlayGlyph } from './glyphs';
import { HighlightMarkers } from './HighlightMarkers';
import type { HighlightWindow, PlaybackMode } from './usePlayback';

interface TransportProps {
  index: number;
  lastIndex: number;
  playing: boolean;
  speed: number;
  chapters: Chapter[];
  current: Event | undefined;
  mode: PlaybackMode;
  hasSupercut: boolean;
  highlights: HighlightWindow[];
  onToggle: () => void;
  onSeek: (index: number) => void;
  onCycleSpeed: () => void;
  onToggleMode: () => void;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

export function Transport({
  index,
  lastIndex,
  playing,
  speed,
  chapters,
  current,
  mode,
  hasSupercut,
  highlights,
  onToggle,
  onSeek,
  onCycleSpeed,
  onToggleMode,
}: TransportProps) {
  const cutting = mode === 'supercut';
  const percent = (value: number) =>
    lastIndex > 0 ? `${(value / lastIndex) * 100}%` : '0%';

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-ink transition-colors hover:bg-accent-dim ${FOCUS}`}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>

        {hasSupercut && (
          <button
            type="button"
            onClick={onToggleMode}
            aria-label={cutting ? 'Exit supercut' : 'Play supercut'}
            aria-pressed={cutting}
            className={`flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 font-mono text-xs transition-colors ${FOCUS} ${
              cutting
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line text-paper hover:border-accent/60'
            }`}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rotate-45 bg-accent"
            />
            supercut
          </button>
        )}

        <button
          type="button"
          onClick={onCycleSpeed}
          aria-label={`Playback speed ${speed} times. Change speed.`}
          className={`h-10 shrink-0 rounded-md border border-line px-3 font-mono text-xs text-paper tabular-nums transition-colors hover:border-accent/60 ${FOCUS}`}
        >
          {speed}&#215;
        </button>

        <div className="relative order-last flex h-10 w-full min-w-0 items-center md:order-none md:w-auto md:flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(0, lastIndex)}
            step={1}
            value={index}
            onChange={(event) => onSeek(Number(event.target.value))}
            aria-label="Timeline position"
            aria-valuetext={`Event ${index} of ${lastIndex}${current ? `, ${current.kind}` : ''}`}
            className="peer absolute inset-0 z-10 w-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
          <div className="pointer-events-none relative h-1.5 w-full rounded-full bg-line peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-4 peer-focus-visible:ring-offset-ink">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              style={{ width: percent(index) }}
            />
            {chapters.map((chapter) => (
              <span
                key={chapter.id}
                className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-paper/30"
                style={{ left: percent(chapter.startIndex) }}
              />
            ))}
            <span
              className="absolute top-1/2 z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-accent"
              style={{ left: percent(index) }}
            />
            <HighlightMarkers
              highlights={highlights}
              lastIndex={lastIndex}
              activeIndex={index}
              onSeek={onSeek}
            />
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-baseline gap-3 font-mono text-xs tabular-nums md:ml-0">
          <span className="text-paper">
            {formatClock(current?.dtMs ?? 0)}
          </span>
          <span className="text-muted">
            {padIndex(index, lastIndex)} / {lastIndex}
          </span>
        </div>
      </div>

      <p className="mt-2 hidden font-mono text-[10px] text-muted/70 lg:block">
        space plays · arrows step one event · brackets jump a chapter
        {hasSupercut && ' · s cuts to the highlights'}
      </p>
    </div>
  );
}
