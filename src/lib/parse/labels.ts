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

/** A Bash command counts as a git commit if it contains `git commit` as a word boundary. */
export function isGitCommitCommand(command: string): boolean {
  return /\bgit commit\b/.test(command);
}

/** Extracts the first line of the `-m` message from a `git commit` command. */
export function extractCommitMessage(command: string): string {
  const match =
    command.match(/-m\s+"([^"]*)"/) || command.match(/-m\s+'([^']*)'/) || command.match(/-m\s+(\S+)/);
  const message = match?.[1] ?? '';
  return message.split('\n')[0] ?? '';
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
