/**
 * Chapters are the session's prompts — the points where a human stepped in
 * and redirected the work. They're numbered because they genuinely are a
 * sequence, and clicking one seeks the reel to that prompt.
 */

import type { Chapter } from '../../lib/types';
import { padIndex } from './format';

interface ChapterRailProps {
  chapters: Chapter[];
  index: number;
  onSeek: (index: number) => void;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

/** Index of the chapter containing `index`, or -1 before the first one. */
export function currentChapterIndex(chapters: Chapter[], index: number): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i]!.startIndex <= index) found = i;
  }
  return found;
}

function ChapterList({ chapters, index, onSeek }: ChapterRailProps) {
  const active = currentChapterIndex(chapters, index);

  return (
    <ol className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
      {chapters.map((chapter, i) => {
        const isActive = i === active;
        return (
          <li key={chapter.id} className="shrink-0 md:shrink">
            <button
              type="button"
              onClick={() => onSeek(chapter.startIndex)}
              aria-current={isActive ? 'true' : undefined}
              className={`flex w-56 items-baseline gap-2.5 border-l-2 py-1.5 pr-2 pl-2.5 text-left transition-colors md:w-full ${FOCUS} ${
                isActive
                  ? 'border-accent bg-ink-raised text-paper'
                  : 'border-transparent text-muted hover:border-line hover:text-paper'
              }`}
            >
              <span
                className={`font-mono text-[10px] tabular-nums ${isActive ? 'text-accent' : 'text-muted/60'}`}
              >
                {padIndex(i + 1, chapters.length)}
              </span>
              <span className="line-clamp-2 text-xs leading-snug">
                {chapter.title || 'Untitled'}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function ChapterRail(props: ChapterRailProps) {
  const { chapters, index } = props;
  if (chapters.length === 0) return null;

  const active = currentChapterIndex(chapters, index);
  const activeTitle = chapters[active]?.title ?? 'Opening';

  return (
    <nav aria-label="Chapters">
      {/* Mobile: a strip that stays out of the way until you want it. */}
      <details className="group md:hidden">
        <summary
          className={`flex cursor-pointer list-none items-center gap-2 rounded-md border border-line bg-ink-raised px-3 py-2 [&::-webkit-details-marker]:hidden ${FOCUS}`}
        >
          <span className="font-mono text-[10px] tracking-wider text-muted uppercase">
            {padIndex(Math.max(active + 1, 1), chapters.length)}/
            {chapters.length}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-paper">
            {activeTitle}
          </span>
          <span className="text-muted transition-transform group-open:rotate-90">
            &#8250;
          </span>
        </summary>
        <div className="mt-2">
          <ChapterList {...props} />
        </div>
      </details>

      <div className="hidden md:sticky md:top-28 md:block">
        <ChapterList {...props} />
      </div>
    </nav>
  );
}
