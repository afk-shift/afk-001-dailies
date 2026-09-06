/**
 * Who was in the room. Each cast member's hue comes from its model family,
 * and that same hue is reused on every tool pill that actor is responsible
 * for.
 */

import type { CastMember } from '../../lib/types';
import { modelHue, shortModel, tint } from './model-colors';

function CastChip({ member }: { member: CastMember }) {
  const hue = modelHue(member.model);
  const primary = member.kind === 'orchestrator';

  return (
    <div
      className={`flex items-center gap-3 rounded-md border py-1.5 pr-3.5 pl-3 ${
        primary
          ? 'border-line bg-ink-raised'
          : 'border-line/60 bg-ink-raised/40'
      }`}
      style={{ borderLeft: `3px solid ${primary ? hue : tint(hue, 55)}` }}
    >
      <div className="min-w-0">
        <p
          className={`truncate text-sm ${
            primary ? 'font-medium text-paper' : 'text-muted'
          }`}
        >
          {member.label}
        </p>
        <p className="mt-1 flex items-center gap-2 font-mono text-[10px]">
          <span
            className="rounded-sm px-1.5 py-0.5"
            style={{ color: hue, backgroundColor: tint(hue, 14) }}
          >
            {shortModel(member.model)}
          </span>
          <span className="text-muted tabular-nums">
            {member.toolCalls} {member.toolCalls === 1 ? 'call' : 'calls'}
          </span>
        </p>
      </div>
    </div>
  );
}

export function CastStrip({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;

  // `cast` already arrives orchestrator-first, spawn-ordered from the parser.
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {cast.map((member) => (
        <li key={member.id}>
          <CastChip member={member} />
        </li>
      ))}
    </ul>
  );
}
