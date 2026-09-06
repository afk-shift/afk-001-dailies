/**
 * A run of consecutive tool calls collapses into one horizontal strip of
 * pills. A session is mostly tool calls, so giving each its own row would
 * bury everything else — as a strip they read as texture, and the eye still
 * catches a red ring or a change of actor hue.
 */

import type { ToolEvent } from '../../lib/types';
import { ToolGlyph } from './glyphs';
import { hueFor } from './model-colors';

/** Above this many pills the strip truncates. */
const COLLAPSE_AT = 24;
/** How many survive the truncation. */
const KEEP = 20;

interface ToolStripProps {
  events: ToolEvent[];
  hues: Map<string, string>;
}

function ToolPill({ event, hue }: { event: ToolEvent; hue: string }) {
  const failed = event.isError === true;

  return (
    <span
      title={`${event.tool} — ${event.label}`}
      className={`inline-flex max-w-[20rem] items-center gap-1.5 rounded-sm border border-line/70 bg-ink-raised px-2 py-1 font-mono text-[11px] ${
        failed ? 'text-danger ring-1 ring-danger/80' : 'text-muted'
      }`}
      style={{ borderLeftColor: hue, borderLeftWidth: '2px' }}
    >
      <span style={failed ? undefined : { color: hue }}>
        <ToolGlyph tool={event.tool} />
      </span>
      <span className="truncate">{event.label || event.tool}</span>
    </span>
  );
}

export function ToolStrip({ events, hues }: ToolStripProps) {
  const truncated = events.length > COLLAPSE_AT;
  const shown = truncated ? events.slice(0, KEEP) : events;
  const remaining = events.length - shown.length;

  return (
    <div className="reel-enter-fade flex flex-wrap items-center gap-1.5">
      {shown.map((event) => (
        <ToolPill
          key={event.i}
          event={event}
          hue={hueFor(hues, event.actor)}
        />
      ))}
      {remaining > 0 && (
        <span className="px-1 font-mono text-[11px] text-muted/70 tabular-nums">
          +{remaining} more
        </span>
      )}
    </div>
  );
}
