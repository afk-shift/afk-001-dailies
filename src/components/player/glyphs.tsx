/**
 * Hand-drawn 12×12 glyphs. Inline SVG rather than an icon font or a library:
 * the set is tiny, and drawing them keeps every pill legible at 11px on the
 * dark stage without pulling a dependency into the island.
 */

import type { JSX } from 'react';

type Shape =
  | 'read'
  | 'edit'
  | 'write'
  | 'shell'
  | 'search'
  | 'agent'
  | 'web'
  | 'list'
  | 'dot';

const SHAPES: Record<Shape, JSX.Element> = {
  read: (
    <>
      <rect x="2.5" y="1.5" width="7" height="9" rx="1" />
      <path d="M4.3 4.2h3.4M4.3 6h3.4M4.3 7.8h2.2" />
    </>
  ),
  edit: (
    <>
      <path d="M2.2 9.8l.7-2.2 5-5 1.5 1.5-5 5z" />
      <path d="M7.4 3.1l1.5 1.5" />
    </>
  ),
  write: (
    <>
      <rect x="2.5" y="1.5" width="7" height="9" rx="1" />
      <path d="M6 4v4M4 6h4" />
    </>
  ),
  shell: <path d="M2.6 3.4L5.4 6 2.6 8.6M6.4 9h3.2" />,
  search: (
    <>
      <circle cx="5.2" cy="5.2" r="3.1" />
      <path d="M7.5 7.5l2.2 2.2" />
    </>
  ),
  agent: <path d="M6 1.4L10.6 6 6 10.6 1.4 6z" />,
  web: (
    <>
      <circle cx="6" cy="6" r="4.1" />
      <path d="M1.9 6h8.2M6 1.9c1.7 1.9 1.7 6.3 0 8.2M6 1.9c-1.7 1.9-1.7 6.3 0 8.2" />
    </>
  ),
  list: <path d="M2.5 3.2h7M2.5 6h7M2.5 8.8h4.2" />,
  dot: <circle cx="6" cy="6" r="1.6" />,
};

const TOOL_SHAPES: Record<string, Shape> = {
  Read: 'read',
  Edit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
  Bash: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',
  Grep: 'search',
  Glob: 'search',
  Agent: 'agent',
  Task: 'agent',
  Skill: 'agent',
  WebFetch: 'web',
  WebSearch: 'web',
  TodoWrite: 'list',
  ExitPlanMode: 'list',
};

/** The glyph for a tool name, falling back to a neutral dot. */
export function ToolGlyph({ tool }: { tool: string }) {
  const shape = TOOL_SHAPES[tool] ?? 'dot';
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {SHAPES[shape]}
    </svg>
  );
}

export function PlayGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="13" height="13" aria-hidden="true">
      <path d="M3 1.6l7 4.4-7 4.4z" fill="currentColor" />
    </svg>
  );
}

export function PauseGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="13" height="13" aria-hidden="true">
      <path d="M3 1.8h2.2v8.4H3zM6.8 1.8H9v8.4H6.8z" fill="currentColor" />
    </svg>
  );
}

export function ReplayGlyph() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M9.8 6a3.8 3.8 0 1 1-1.3-2.9" />
      <path d="M9.9 1.5v2.8H7.1" />
    </svg>
  );
}
