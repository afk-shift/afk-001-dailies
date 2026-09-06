/**
 * The reel itself: everything that has happened up to the playhead, oldest
 * at the top. It follows the playhead on its own, but the moment you scroll
 * back to read something it lets go — and picks the thread up again when you
 * press play.
 *
 * On the theatre layout this is the only thing on the page that scrolls.
 */

import { useMemo, useRef, type ReactNode } from 'react';
import type { Chapter, Event, ToolEvent } from '../../lib/types';
import {
  CommitLine,
  MilestoneDivider,
  PromptCard,
  ReelRow,
  ReplyCard,
  SpawnChip,
} from './EventCards';
import { hueFor } from './model-colors';
import { ToolStrip } from './ToolStrip';
import { useFollowPlayhead } from './useFollowPlayhead';

type ReelItem =
  | { type: 'tools'; key: number; dtMs: number; events: ToolEvent[]; endsAt: number }
  | { type: 'event'; key: number; event: Event };

/** Splits the played-so-far events into rows, folding tool runs together. */
function buildItems(events: Event[], index: number): ReelItem[] {
  const items: ReelItem[] = [];
  const upTo = Math.min(index, events.length - 1);

  for (let i = 0; i <= upTo; i++) {
    const event = events[i]!;
    if (event.kind === 'tool') {
      const previous = items[items.length - 1];
      if (previous && previous.type === 'tools') {
        previous.events.push(event);
        previous.endsAt = event.i;
        continue;
      }
      items.push({
        type: 'tools',
        key: event.i,
        dtMs: event.dtMs,
        events: [event],
        endsAt: event.i,
      });
      continue;
    }
    items.push({ type: 'event', key: event.i, event });
  }

  return items;
}

interface ReelProps {
  events: Event[];
  chapters: Chapter[];
  index: number;
  playing: boolean;
  animating: boolean;
  dissolving: boolean;
  reducedMotion: boolean;
  hues: Map<string, string>;
  endCard: ReactNode;
}

export function Reel({
  events,
  chapters,
  index,
  playing,
  animating,
  dissolving,
  reducedMotion,
  hues,
  endCard,
}: ReelProps) {
  const scroller = useRef<HTMLDivElement>(null);

  const items = useMemo(() => buildItems(events, index), [events, index]);

  const chapterNumbers = useMemo(() => {
    const map = new Map<number, number>();
    chapters.forEach((chapter, i) => map.set(chapter.startIndex, i + 1));
    return map;
  }, [chapters]);

  const onScroll = useFollowPlayhead(scroller, index, playing);

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Session reel"
      className={`reel thin-scroll pt-3 pr-1 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-10 ${
        animating ? 'reel-animate' : ''
      } ${dissolving ? 'reel-dissolve' : ''}`}
    >
      {items.length === 0 && (
        <p className="pl-[4.5rem] font-mono text-xs text-muted">
          This supercut has no events to replay.
        </p>
      )}
      <ol>
        {items.map((item) => {
          if (item.type === 'tools') {
            return (
              <ReelRow
                key={`t${item.key}`}
                dtMs={item.dtMs}
                isCurrent={item.endsAt === index}
              >
                <ToolStrip events={item.events} hues={hues} />
              </ReelRow>
            );
          }

          const { event } = item;
          const isCurrent = event.i === index;

          return (
            <ReelRow key={event.i} dtMs={event.dtMs} isCurrent={isCurrent}>
              {event.kind === 'prompt' && (
                <PromptCard
                  text={event.text}
                  chapterNumber={chapterNumbers.get(event.i) ?? 0}
                  chapterTotal={chapters.length}
                  typing={animating && isCurrent && !reducedMotion}
                />
              )}
              {event.kind === 'reply' && <ReplyCard text={event.text} />}
              {event.kind === 'commit' && <CommitLine message={event.message} />}
              {event.kind === 'spawn' && (
                <SpawnChip
                  description={event.description}
                  hue={hueFor(hues, event.castId)}
                />
              )}
              {event.kind === 'milestone' && (
                <MilestoneDivider text={event.text} />
              )}
            </ReelRow>
          );
        })}
      </ol>
      {endCard}
    </div>
  );
}
