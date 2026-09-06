/**
 * The card the reel runs out onto. Playback auto-pauses here, so this is the
 * last thing on screen — it recaps what the session actually produced and
 * offers the only two things worth doing next.
 */

import type { Supercut } from '../../lib/types';
import { formatCompact, formatDuration } from './format';
import { ReplayGlyph } from './glyphs';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

export function EndCard({
  supercut,
  onReplay,
}: {
  supercut: Supercut;
  onReplay: () => void;
}) {
  const { stats } = supercut;
  const rows: [string, string][] = [
    ['ran for', formatDuration(stats.durationMs)],
    ['events', String(supercut.events.length)],
    [
      'tool calls',
      stats.toolErrors > 0
        ? `${stats.toolCalls} · ${stats.toolErrors} failed`
        : String(stats.toolCalls),
    ],
    ['files touched', String(stats.filesTouched)],
    ['commits', String(stats.commits)],
    ['cast', `${stats.subagents + 1}`],
    ['tokens', formatCompact(stats.inputTokens + stats.outputTokens)],
  ];

  return (
    <div className="reel-enter mt-1 mb-3 ml-[4.5rem] rounded-md border border-line bg-ink-raised px-5 py-5">
      <p className="font-mono text-[10px] tracking-wider text-accent uppercase">
        End of reel
      </p>
      <p className="mt-2 text-lg leading-snug text-balance text-paper">
        {supercut.title || supercut.sessionId}
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-line/60 pb-1"
          >
            <dt className="font-mono text-[11px] text-muted">{label}</dt>
            <dd className="font-mono text-[11px] text-paper tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onReplay}
          className={`inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-mono text-xs font-medium text-ink transition-colors hover:bg-accent-dim ${FOCUS}`}
        >
          <ReplayGlyph />
          Watch again
        </button>
        <a
          href="/"
          className={`rounded-md border border-line px-4 py-2 font-mono text-xs text-paper transition-colors hover:border-accent/60 ${FOCUS}`}
        >
          Back to dailies
        </a>
      </div>
    </div>
  );
}
