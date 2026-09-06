/**
 * The narration's highlights, pinned to the track as diamonds — the same
 * shape the reel uses for the frame you're parked on. Hovering or focusing
 * one reads out what happens there; clicking seeks to it.
 */

import type { HighlightWindow } from './usePlayback';

interface HighlightMarkersProps {
  highlights: HighlightWindow[];
  lastIndex: number;
  activeIndex: number;
  onSeek: (index: number) => void;
}

export function HighlightMarkers({
  highlights,
  lastIndex,
  activeIndex,
  onSeek,
}: HighlightMarkersProps) {
  if (highlights.length === 0) return null;

  return (
    <>
      {highlights.map((highlight) => {
        const isActive =
          activeIndex >= highlight.from && activeIndex <= highlight.to;
        const left =
          lastIndex > 0 ? `${(highlight.eventIndex / lastIndex) * 100}%` : '0%';

        return (
          <button
            key={highlight.eventIndex}
            type="button"
            onClick={() => onSeek(highlight.eventIndex)}
            aria-label={`Highlight at event ${highlight.eventIndex}: ${highlight.text}`}
            style={{ left }}
            className="group pointer-events-auto absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 p-1.5 focus-visible:outline-none"
          >
            <span
              className={`block h-2.5 w-2.5 rotate-45 bg-accent ring-1 transition-transform group-hover:scale-125 group-focus-visible:scale-150 group-focus-visible:ring-2 group-focus-visible:ring-paper motion-reduce:transition-none ${
                isActive ? 'ring-paper' : 'ring-ink'
              }`}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden w-max max-w-[16rem] -translate-x-1/2 rounded-md border border-line bg-ink-raised px-2.5 py-1.5 text-left text-xs leading-snug text-paper shadow-lg shadow-ink/60 group-hover:block group-focus-visible:block">
              {highlight.text}
            </span>
          </button>
        );
      })}
    </>
  );
}
