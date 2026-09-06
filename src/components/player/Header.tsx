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
  return (
    <div className="min-w-0 lg:flex lg:flex-wrap lg:items-baseline lg:gap-x-4">
      <h1 className="text-xl font-semibold tracking-tight text-balance text-paper sm:text-2xl lg:text-[1.375rem] lg:leading-snug">
        {supercut.title || supercut.sessionId}
      </h1>
      <p className="mt-1.5 font-mono text-xs text-muted lg:mt-0">
        {supercut.project} · {formatDate(supercut.startedAt)} ·{' '}
        {formatDuration(supercut.stats.durationMs)}
      </p>
    </div>
  );
}

export function StatGrid({ supercut }: { supercut: Supercut }) {
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
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-6">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="bg-ink-raised px-3 py-2"
          title={cell.title}
        >
          <dt className="font-mono text-[10px] tracking-wider text-muted uppercase">
            {cell.label}
          </dt>
          <dd className="mt-0.5 font-mono text-sm text-paper tabular-nums">
            {cell.value}
            {cell.extra && (
              <span className="ml-1.5 text-xs text-danger">{cell.extra}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
