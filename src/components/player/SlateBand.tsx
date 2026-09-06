/**
 * The band above the picture: what this session was, the numbers, and who was
 * in the room. It folds down to a single title line so the reel can have the
 * whole screen.
 *
 * Whether it's folded is carried on `<html data-slate>` rather than in React
 * state, so the inline script in the layout can apply the remembered choice
 * before the first paint and the island hydrates against unchanged markup.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Supercut } from '../../lib/types';
import { CastStrip } from './CastStrip';
import { Header, StatGrid } from './Header';

const STORAGE_KEY = 'dailies:slate';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

function readCollapsed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.slate === 'collapsed';
}

export function SlateBand({ supercut }: { supercut: Supercut }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setCollapsed(readCollapsed()), []);

  const toggle = useCallback(() => {
    const next = !readCollapsed();
    if (next) document.documentElement.dataset.slate = 'collapsed';
    else delete document.documentElement.dataset.slate;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'open');
    } catch {
      // A browser refusing storage costs the memory, not the feature.
    }
  }, []);

  return (
    <div className="shrink-0 border-b border-line/60">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:py-3">
        <div className="flex items-start gap-4">
          <Header supercut={supercut} />
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="slate-details"
            className={`ml-auto flex shrink-0 items-center gap-2 rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] text-muted transition-colors hover:border-accent/60 hover:text-paper ${FOCUS}`}
          >
            <span className="slate-open">Hide details</span>
            <span className="slate-closed">Show details</span>
            <span
              aria-hidden="true"
              className="slate-chevron block h-1.5 w-1.5 rotate-45 border-t border-l border-current"
            />
          </button>
        </div>

        <div id="slate-details" className="slate-details mt-3 space-y-3">
          <StatGrid supercut={supercut} />
          <CastStrip cast={supercut.cast} />
        </div>
      </div>
    </div>
  );
}
