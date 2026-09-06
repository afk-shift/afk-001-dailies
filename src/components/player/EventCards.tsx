/**
 * How each kind of event looks. The rule down the left of the reel is the
 * film edge; every row hangs off it with its session timecode, and the
 * accent lozenge marks the frame you're parked on.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { formatClock, padIndex } from './format';
import { tint } from './model-colors';

interface ReelRowProps {
  dtMs: number;
  isCurrent: boolean;
  children: ReactNode;
}

export function ReelRow({ dtMs, isCurrent, children }: ReelRowProps) {
  return (
    <li className="grid w-full min-w-0 max-w-full grid-cols-[3.25rem_1.25rem_minmax(0,1fr)]">
      <span className="pt-1 pr-1 text-right font-mono text-[10px] text-muted/60 tabular-nums">
        {formatClock(dtMs)}
      </span>
      <span className="relative" aria-hidden="true">
        <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-line/70" />
        {isCurrent && (
          <span className="absolute top-1.5 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-accent" />
        )}
      </span>
      <div className="min-w-0 pb-5">{children}</div>
    </li>
  );
}

/**
 * Reveals `text` character by character over ~0.3–1.2s. Disabled entirely
 * when stepping, scrubbing, or when the reader prefers reduced motion — in
 * those cases the full text is there on first paint.
 */
function useTypewriter(text: string, enabled: boolean): string {
  const [shown, setShown] = useState(() => (enabled ? '' : text));

  useEffect(() => {
    if (!enabled) {
      setShown(text);
      return;
    }
    const total = Math.min(1200, Math.max(320, text.length * 16));
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / total);
      setShown(text.slice(0, Math.ceil(text.length * progress)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [text, enabled]);

  return shown;
}

interface PromptCardProps {
  text: string;
  chapterNumber: number;
  chapterTotal: number;
  typing: boolean;
}

export function PromptCard({
  text,
  chapterNumber,
  chapterTotal,
  typing,
}: PromptCardProps) {
  const shown = useTypewriter(text, typing);
  const complete = shown.length >= text.length;

  return (
    <div className="reel-enter rounded-r-md border-l-2 border-accent bg-ink-raised px-4 py-3">
      {chapterNumber > 0 && (
        <p className="font-mono text-[10px] text-accent tabular-nums">
          {padIndex(chapterNumber, chapterTotal)}
        </p>
      )}
      <p className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-wrap text-paper">
        {shown}
        {!complete && <span className="caret text-accent">&#9612;</span>}
      </p>
    </div>
  );
}

export function ReplyCard({ text }: { text: string }) {
  return (
    <div className="reel-enter-fade border-l border-line pl-3">
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted">
        {text}
      </p>
    </div>
  );
}

export function CommitLine({ message }: { message: string }) {
  return (
    <div className="reel-enter flex w-full items-center gap-3 border-y border-accent/30 bg-accent/[0.06] px-3 py-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="shrink-0 font-mono text-[10px] tracking-wider text-accent uppercase">
        commit
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-paper">
        {message || 'no message'}
      </span>
    </div>
  );
}

export function SpawnChip({
  description,
  hue,
}: {
  description: string;
  hue: string;
}) {
  return (
    <div
      className="reel-enter-spawn inline-flex max-w-full items-center gap-2 rounded-md border bg-ink-raised px-3 py-1.5"
      style={
        {
          borderColor: tint(hue, 45),
          '--spawn-hue': hue,
        } as CSSProperties
      }
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rotate-45"
        style={{ backgroundColor: hue }}
      />
      <span className="shrink-0 font-mono text-[11px]" style={{ color: hue }}>
        spawned
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-muted">
        · {description || 'subagent'}
      </span>
    </div>
  );
}

export function MilestoneDivider({ text }: { text: string }) {
  return (
    <div className="reel-enter-fade flex items-center gap-3 pt-1">
      <span className="h-px w-5 shrink-0 bg-line" />
      <span className="min-w-0 truncate font-mono text-[10px] tracking-wider text-muted uppercase">
        {text}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
