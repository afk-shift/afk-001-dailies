/**
 * Subtitles. While the playhead sits inside a highlight, what the narration
 * said about it floats over the bottom of the picture; during a dissolve the
 * same band announces where the cut is heading.
 */

import type { HighlightWindow } from './usePlayback';

interface HighlightCaptionProps {
  active: HighlightWindow | null;
  next: HighlightWindow | null;
}

export function HighlightCaption({ active, next }: HighlightCaptionProps) {
  const showing = next ?? active;
  if (!showing) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full bg-gradient-to-t from-ink via-ink/85 to-transparent pt-10 pb-3">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <p
          key={`${next ? 'next' : 'at'}-${showing.eventIndex}`}
          className="caption-in flex max-w-[62ch] items-start gap-2.5"
        >
          {next ? (
            <span className="mt-0.5 shrink-0 font-mono text-[11px] whitespace-nowrap text-accent">
              &#8594; next highlight
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="mt-[0.4rem] h-2 w-2 shrink-0 rotate-45 bg-accent"
            />
          )}
          <span className="text-sm leading-snug text-paper">
            {showing.text}
          </span>
        </p>
      </div>
    </div>
  );
}
