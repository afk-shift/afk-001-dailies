/**
 * A run of consecutive tool calls collapses into one horizontal strip of
 * pills. A session is mostly tool calls, so giving each its own row would
 * bury everything else — as a strip they read as texture, and the eye still
 * catches a red ring or a change of actor hue.
 */

import { useState } from 'react';
import type { ToolEvent } from '../../lib/types';
import { ToolGlyph } from './glyphs';
import { hueFor } from './model-colors';

/** Above this many pills the strip truncates. */
const COLLAPSE_AT = 24;
/** How many survive the truncation. */
const KEEP = 20;

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

interface ToolStripProps {
  events: ToolEvent[];
  hues: Map<string, string>;
}

function ToolPill({ event, hue }: { event: ToolEvent; hue: string }) {
  const failed = event.isError === true;

  return (
    <span
      title={`${event.tool} — ${event.label}`}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm border border-line/70 bg-ink-raised px-2 py-1 font-mono text-[11px] ${
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
  const [expanded, setExpanded] = useState(false);
  const truncated = events.length > COLLAPSE_AT;
  const shown = truncated && !expanded ? events.slice(0, KEEP) : events;
  const remaining = events.length - KEEP;

  return (
    <div className="reel-enter-fade flex flex-wrap items-center gap-1.5">
      {shown.map((event) => (
        <ToolPill
          key={event.i}
          event={event}
          hue={hueFor(hues, event.actor)}
        />
      ))}
      {truncated && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`rounded-sm px-1 font-mono text-[11px] text-muted/70 tabular-nums underline decoration-dotted underline-offset-2 hover:text-muted ${FOCUS}`}
        >
          +{remaining} more
        </button>
      )}
      {truncated && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={`rounded-sm px-1 font-mono text-[11px] text-muted/70 tabular-nums underline decoration-dotted underline-offset-2 hover:text-muted ${FOCUS}`}
        >
          collapse
        </button>
      )}
    </div>
  );
}
