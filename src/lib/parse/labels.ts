/**
 * Tool-call label building and small helpers for turning raw `tool_use`
 * blocks into the human-readable bits the Supercut wants.
 */

import { truncatePlain } from './clean';

/** File-touching tool names — counted into `Supercut.files`. */
export const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

/** Makes an absolute path relative to `cwd` (string-prefix based, POSIX-style). */
export function relativePath(cwd: string, filePath: string): string {
  if (!filePath) return filePath;
  if (!cwd) return filePath;
  const normalizedCwd = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
  if (filePath === normalizedCwd) return '.';
  if (filePath.startsWith(`${normalizedCwd}/`)) {
    return filePath.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

/** Resolves the file path a file-touching tool_use block acted on, relative to cwd. */
export function resolveFilePath(name: string, input: Record<string, unknown>, cwd: string): string {
  const raw =
    name === 'NotebookEdit' ? str(input, 'notebook_path') || str(input, 'file_path') : str(input, 'file_path');
  return raw ? relativePath(cwd, raw) : '';
}

/**
 * Replaces the contents of single- and double-quoted spans with a neutral
 * placeholder (keeping the quote characters and overall length) so a
 * `&&`/`;`/`||`/`|` or `git commit` that only appears inside a quoted string
 * — an echoed message, a `--grep` pattern, a commit body — can't be mistaken
 * for a real shell operator or invocation.
 */
function maskQuotedSpans(command: string): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  for (const ch of command) {
    if (quote) {
      out += ch === quote ? ch : '_';
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Matches a `git commit` invocation only at the start of the (unquoted)
 * command, or immediately after a `&&`, `;`, `||`, or `|` operator — so
 * `cd repo && git commit ...` still counts, but `echo "please git commit"`
 * or `git log --grep="git commit"` does not.
 */
const GIT_COMMIT_INVOCATION_RE = /(?:^|&&|\|\||;|\|)\s*git\s+commit\b/;

/** A Bash command counts as a `git commit` invocation — see `GIT_COMMIT_INVOCATION_RE`. */
export function isGitCommitCommand(command: string): boolean {
  return GIT_COMMIT_INVOCATION_RE.test(maskQuotedSpans(command));
}

/**
 * A real transcript often commits with a bash heredoc so the message can span
 * multiple lines:
 *
 *   git commit -m "$(cat <<'EOF'
 *   Subject line
 *
 *   Body…
 *   EOF
 *   )"
 *
 * The naive `-m "..."` capture grabs that whole blob, whose first line is
 * just the heredoc opener (`$(cat <<'EOF'`) — not a usable message.
 */
function isHeredocOpener(value: string): boolean {
  return /^\$\(cat <<-?'?EOF'?\s*$/.test(value.trimStart().split(/\r?\n/)[0] ?? '');
}

/** First non-empty line after the heredoc opener line — the real subject. */
function firstLineAfterHeredocOpener(value: string): string {
  const lines = value.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim().length > 0) return line;
  }
  return '';
}

/** Extracts the raw value of the first `-m`/`--message` flag on a command line. */
function extractRawMessageValue(command: string): string | null {
  const equals = command.match(/--message=(?:"([^"]*)"|'([^']*)'|(\S+))/);
  if (equals) return equals[1] ?? equals[2] ?? equals[3] ?? '';

  const match =
    command.match(/(?:-m|--message)\s+"([^"]*)"/) ||
    command.match(/(?:-m|--message)\s+'([^']*)'/) ||
    command.match(/(?:-m|--message)\s+(\S+)/);
  return match?.[1] ?? null;
}

/** True when `flag` (e.g. `-F`, `--amend`) appears as its own token in `command`. */
function hasFlag(command: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(=|\\s|$)`).test(command);
}

/**
 * Extracts the commit message from a `git commit` command — the first
 * `-m`/`--message` flag (later ones, e.g. a `-m subject -m body` pair, are
 * ignored — only the first is taken), unwrapping a heredoc-style value if
 * present.
 *
 * A real commit can omit `-m` entirely and still have no usable text to
 * show: `-F`/`--file`/`-C`/`--reuse-message` pull the message from a file or
 * another commit, and `--amend` (typically with `--no-edit`) reuses the
 * previous commit's message unchanged. Those get a descriptive placeholder
 * instead of an empty string; a command with none of these that still has
 * no extractable message falls back to `''`.
 */
export function extractCommitMessage(command: string): string {
  const raw = extractRawMessageValue(command);
  if (raw) {
    if (isHeredocOpener(raw)) return firstLineAfterHeredocOpener(raw);
    return raw.split(/\r?\n/)[0] ?? '';
  }

  if (hasFlag(command, '-F') || hasFlag(command, '--file') || hasFlag(command, '-C') || hasFlag(command, '--reuse-message')) {
    return '(commit message from file)';
  }
  if (hasFlag(command, '--amend')) {
    return '(amend)';
  }

  return '';
}

/** Builds the short human label shown on a ToolEvent, per tool kind. */
export function buildToolLabel(name: string, input: Record<string, unknown>, cwd: string): string {
  switch (name) {
    case 'Bash': {
      const command = str(input, 'command');
      const firstLine = command.split('\n')[0] ?? '';
      return truncatePlain(firstLine, 100);
    }
    case 'Read':
    case 'Edit':
    case 'Write':
      return relativePath(cwd, str(input, 'file_path'));
    case 'NotebookEdit':
      return resolveFilePath(name, input, cwd);
    case 'Grep':
    case 'Glob':
      return str(input, 'pattern') || name;
    case 'Agent':
      return str(input, 'description') || name;
    case 'Skill':
      return str(input, 'skill') || name;
    default:
      return name;
  }
}
