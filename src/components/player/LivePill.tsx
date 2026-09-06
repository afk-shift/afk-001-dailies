/**
 * The live badge in the slate band: a pulsing dot, how long ago the reel last
 * grew, and how much of it arrived while you were watching. Clicking it stops
 * following; when the session looks like it's still running, the same control
 * offers to start.
 */

import { useEffect, useState } from 'react';
import { formatAgo } from './format';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

/** A once-a-second clock, so the "ago" text stays honest. Zero until mounted. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

interface LivePillProps {
  live: boolean;
  /** Show the "go live" affordance — the session is probably still running. */
  offer: boolean;
  reconnecting: boolean;
  updatedAt: number | null;
  added: number;
  onToggle: () => void;
}

export function LivePill({
  live,
  offer,
  reconnecting,
  updatedAt,
  added,
  onToggle,
}: LivePillProps) {
  const now = useTick(live && !reconnecting);

  if (!live) {
    if (!offer) return null;
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`flex shrink-0 items-center gap-2 rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:border-accent/60 hover:text-paper ${FOCUS}`}
      >
        <span
          aria-hidden="true"
          className="block h-1.5 w-1.5 rounded-full bg-muted"
        />
        go live
      </button>
    );
  }

  const status = reconnecting
    ? 'reconnecting'
    : now > 0 && updatedAt !== null
      ? `updated ${formatAgo(now - updatedAt)}`
      : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={true}
      aria-label="Following this session live. Stop following."
      className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${FOCUS} ${
        reconnecting
          ? 'border-line text-muted'
          : 'border-accent/60 bg-accent/10 text-accent hover:border-accent'
      }`}
    >
      <span
        aria-hidden="true"
        className={`block h-1.5 w-1.5 rounded-full ${
          reconnecting ? 'bg-muted' : 'live-dot bg-accent'
        }`}
      />
      <span className="tracking-wider">LIVE</span>
      {status && <span className="text-muted tabular-nums">{status}</span>}
      {added > 0 && (
        <span className="text-muted tabular-nums">
          +{added} since you opened
        </span>
      )}
    </button>
  );
}
