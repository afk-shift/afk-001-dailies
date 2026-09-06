/**
 * The running tally. Counters climb as the reel advances and files appear
 * the moment they're first touched, so the panel reads as a record of what
 * has happened so far — not a summary of the finished session.
 *
 * Narration is optional: a supercut published without it simply loses the
 * bottom two blocks.
 */

import type { Supercut } from '../../lib/types';
import { padIndex } from './format';

export interface RevealedFile {
  path: string;
  edits: number;
  /** Event index at which this file is first touched. */
  at: number;
}

export interface SoFar {
  toolCalls: number;
  files: number;
  commits: number;
}

interface SidePanelProps {
  supercut: Supercut;
  index: number;
  lastIndex: number;
  soFar: SoFar;
  files: RevealedFile[];
  onSeek: (index: number) => void;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ink';

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="font-mono text-[10px] tracking-wider text-muted uppercase">
      {children}
    </h2>
  );
}

function Counter({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  return (
    <div className="bg-ink-raised px-3 py-2.5">
      <p className="font-mono text-[10px] tracking-wider text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-paper tabular-nums">
        <span className="text-lg">{value}</span>
        <span className="text-[11px] text-muted"> / {total}</span>
      </p>
    </div>
  );
}

export function SidePanel({
  supercut,
  index,
  lastIndex,
  soFar,
  files,
  onSeek,
}: SidePanelProps) {
  const revealed = files.filter((file) => file.at <= index);
  const narration = supercut.narration;
  const highlights = narration?.highlights ?? [];

  return (
    <aside className="space-y-6 lg:sticky lg:top-28">
      <section>
        <SectionLabel>So far</SectionLabel>
        <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
          <Counter
            label="tools"
            value={soFar.toolCalls}
            total={supercut.stats.toolCalls}
          />
          <Counter
            label="files"
            value={soFar.files}
            total={supercut.stats.filesTouched}
          />
          <Counter
            label="commits"
            value={soFar.commits}
            total={supercut.stats.commits}
          />
        </div>
      </section>

      <section>
        <SectionLabel>Files touched</SectionLabel>
        {revealed.length === 0 ? (
          <p className="mt-2 font-mono text-[11px] text-muted/70">
            nothing touched yet
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {revealed.map((file) => (
              <li
                key={file.path}
                className="flex items-baseline gap-2 font-mono text-[11px]"
              >
                <span
                  className="min-w-0 flex-1 truncate text-paper"
                  title={file.path}
                >
                  {file.path}
                </span>
                <span className="shrink-0 text-muted tabular-nums">
                  {file.edits}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {narration?.synopsis && (
        <section>
          <SectionLabel>Synopsis</SectionLabel>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {narration.synopsis}
          </p>
        </section>
      )}

      {highlights.length > 0 && (
        <section>
          <SectionLabel>Highlights</SectionLabel>
          <ul className="mt-2 space-y-1">
            {highlights.map((highlight, i) => {
              const target = Math.min(
                Math.max(0, highlight.eventIndex),
                lastIndex,
              );
              return (
                <li key={`${target}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSeek(target)}
                    className={`group flex w-full gap-2 rounded-sm py-1 pr-1 text-left ${FOCUS}`}
                  >
                    <span className="pt-0.5 font-mono text-[10px] text-accent tabular-nums">
                      {padIndex(target, lastIndex)}
                    </span>
                    <span className="text-xs leading-snug text-muted transition-colors group-hover:text-paper">
                      {highlight.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}
