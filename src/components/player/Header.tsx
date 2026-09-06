/**
 * The slate: what this session was, and the six numbers that size it up.
 * Every figure is monospaced — on this page mono means "machine fact" and
 * the sans face is reserved for things a human or the agent actually said.
 */

import type { Supercut } from '../../lib/types';
import { formatCompact, formatDate, formatDuration } from './format';

interface StatCell {
  label: string;
  value: string;
  extra?: string;
  title?: string;
}

export function Header({ supercut }: { supercut: Supercut }) {
  const { stats } = supercut;
  const tokens = stats.inputTokens + stats.outputTokens;

  const cells: StatCell[] = [
    { label: 'turns', value: String(stats.turns) },
    {
      label: 'tool calls',
      value: String(stats.toolCalls),
      extra: stats.toolErrors > 0 ? `${stats.toolErrors} err` : undefined,
    },
    { label: 'files', value: String(stats.filesTouched) },
    { label: 'commits', value: String(stats.commits) },
    { label: 'subagents', value: String(stats.subagents) },
    {
      label: 'tokens',
      value: formatCompact(tokens),
      title: `${stats.inputTokens.toLocaleString('en-US')} in · ${stats.outputTokens.toLocaleString('en-US')} out`,
    },
  ];

  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-balance text-paper sm:text-[2rem] sm:leading-tight">
        {supercut.title || supercut.sessionId}
      </h1>
      <p className="mt-2 font-mono text-xs text-muted">
        {supercut.project} · {formatDate(supercut.startedAt)} ·{' '}
        {formatDuration(supercut.stats.durationMs)}
      </p>

      <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-6">
        {cells.map((cell) => (
          <div key={cell.label} className="bg-ink-raised px-3 py-2.5" title={cell.title}>
            <dt className="font-mono text-[10px] tracking-wider text-muted uppercase">
              {cell.label}
            </dt>
            <dd className="mt-1 font-mono text-sm text-paper tabular-nums">
              {cell.value}
              {cell.extra && (
                <span className="ml-1.5 text-xs text-danger">{cell.extra}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
