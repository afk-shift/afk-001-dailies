#!/usr/bin/env tsx
/**
 * Dailies CLI — reads a Claude Code session transcript, parses it into a
 * Supercut, and either writes it locally (`--dry-run`) or publishes it to a
 * Dailies site via `POST /api/publish`.
 *
 * Usage:
 *   npm run dailies -- <sessionId|path/to/session.jsonl> [--dry-run] [--title "..."] [--feature] [--site https://...]
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseSessionWithRedactions, type SessionInput } from '../src/lib/parse';
import type { Supercut } from '../src/lib/types';

const DEFAULT_SITE_URL = 'https://surprise-me-001.netlify.app';
const MAX_OUTPUT_FILENAME_LENGTH = 80;

interface CliArgs {
  input: string;
  dryRun: boolean;
  title?: string;
  feature: boolean;
  site?: string;
}

function usage(): string {
  return 'Usage: npm run dailies -- <sessionId|path/to/session.jsonl> [--dry-run] [--title "..."] [--feature] [--site https://...]';
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const args: CliArgs = { input: '', dryRun: false, feature: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--feature') {
      args.feature = true;
    } else if (arg === '--title') {
      args.title = argv[++i];
    } else if (arg === '--site') {
      args.site = argv[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}\n${usage()}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    throw new Error(usage());
  }
  args.input = positional[0]!;
  return args;
}

interface ResolvedInput {
  mainFile: string;
  subagentsDir: string | null;
}

/** Finds a session file under `~/.claude/projects/<project-dir>/<sessionId>.jsonl`. */
function findSessionFile(sessionId: string): string | null {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolves the CLI's positional arg to a main transcript file and (if any)
 * a subagents directory. Three shapes are supported:
 *   - An explicit path to a `.jsonl` file. If it's literally named
 *     `session.jsonl` (the tests/fixtures layout), its sibling `subagents/`
 *     dir is used directly; otherwise the real on-disk convention applies —
 *     `<dir>/<sessionId>/subagents/`.
 *   - A directory containing `session.jsonl` + `subagents/`.
 *   - A bare sessionId, resolved by searching `~/.claude/projects`.
 */
function resolveInput(arg: string): ResolvedInput {
  const stat = fs.existsSync(arg) ? fs.statSync(arg) : null;

  if (stat?.isFile()) {
    const dir = path.dirname(arg);
    const base = path.basename(arg);
    const subagentsDir =
      base === 'session.jsonl'
        ? path.join(dir, 'subagents')
        : path.join(dir, path.basename(arg, '.jsonl'), 'subagents');
    return { mainFile: arg, subagentsDir: fs.existsSync(subagentsDir) ? subagentsDir : null };
  }

  if (stat?.isDirectory()) {
    const mainFile = path.join(arg, 'session.jsonl');
    if (!fs.existsSync(mainFile)) {
      throw new Error(`No session.jsonl found in directory: ${arg}`);
    }
    const subagentsDir = path.join(arg, 'subagents');
    return { mainFile, subagentsDir: fs.existsSync(subagentsDir) ? subagentsDir : null };
  }

  const found = findSessionFile(arg);
  if (!found) {
    throw new Error(
      `Could not resolve "${arg}" to a session file.\n` +
        `Pass a path to a .jsonl file, a directory containing session.jsonl, ` +
        `or a sessionId that exists under ~/.claude/projects/*/<sessionId>.jsonl.`,
    );
  }
  const subagentsDir = path.join(path.dirname(found), arg, 'subagents');
  return { mainFile: found, subagentsDir: fs.existsSync(subagentsDir) ? subagentsDir : null };
}

/**
 * Derives a filesystem-safe base filename from a (potentially attacker- or
 * transcript-controlled) sessionId: only `[A-Za-z0-9_-]` survives, anything
 * else becomes `_`, capped at 80 chars, falling back to `session` if that
 * leaves nothing usable.
 */
function safeFilenameFromSessionId(sessionId: string): string {
  const sanitized = sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, MAX_OUTPUT_FILENAME_LENGTH);
  return sanitized || 'session';
}

function readLines(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

/** Best-effort parse of the first JSON line, for `cwd` and `sessionId`. */
function parseFirstLine(lines: string[]): { cwd: string; sessionId: string } {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        cwd: typeof obj.cwd === 'string' ? obj.cwd : '',
        sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
      };
    } catch {
      continue;
    }
  }
  return { cwd: '', sessionId: '' };
}

function loadSubagents(subagentsDir: string | null): SessionInput['subagents'] {
  if (!subagentsDir) return [];

  const files = fs
    .readdirSync(subagentsDir)
    .filter((name) => name.startsWith('agent-') && name.endsWith('.jsonl'));

  return files.map((file) => {
    const id = file.slice('agent-'.length, -'.jsonl'.length);
    const jsonlPath = path.join(subagentsDir, file);
    const metaPath = path.join(subagentsDir, `agent-${id}.meta.json`);
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : undefined;
    return { id, meta, lines: readLines(jsonlPath) };
  });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function printSummary(supercut: Supercut, redactionCount: number): void {
  console.log(supercut.title || '(untitled session)');
  console.log(`  duration:    ${formatDuration(supercut.stats.durationMs)}`);
  console.log(`  turns:       ${supercut.stats.turns}`);
  console.log(`  tool calls:  ${supercut.stats.toolCalls} (${supercut.stats.toolErrors} errors)`);
  console.log(`  files:       ${supercut.stats.filesTouched}`);
  console.log(`  commits:     ${supercut.stats.commits}`);
  const cast = supercut.cast.map((c) => `${c.label} (${c.model || 'unknown model'})`).join(', ');
  console.log(`  cast:        ${cast || '(none)'}`);
  console.log(`  tokens:      ${supercut.stats.inputTokens.toLocaleString()} in / ${supercut.stats.outputTokens.toLocaleString()} out`);
  console.log(`Redactions applied: ${redactionCount}`);
  if (redactionCount > 0) {
    console.log('  hint: secrets were found and masked — review the output with --dry-run before publishing.');
  }
}

/** Loads .env from the repo root only — never any other .env file. */
function loadRepoEnv(): void {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

async function postJson(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  loadRepoEnv();

  const resolved = resolveInput(args.input);
  const mainLines = readLines(resolved.mainFile);
  const { cwd, sessionId: firstLineSessionId } = parseFirstLine(mainLines);
  const sessionId = firstLineSessionId || path.basename(resolved.mainFile, '.jsonl');
  const project = cwd ? path.basename(cwd) : 'unknown';
  const subagents = loadSubagents(resolved.subagentsDir);

  const { supercut, redactionCount } = parseSessionWithRedactions({ sessionId, project, lines: mainLines, subagents });
  if (args.title) supercut.title = args.title;

  printSummary(supercut, redactionCount);

  if (args.dryRun) {
    const outDir = path.join(process.cwd(), 'dailies-out');
    fs.mkdirSync(outDir, { recursive: true });
    const resolvedOutDir = path.resolve(outDir);
    const outFilename = `${safeFilenameFromSessionId(sessionId)}.json`;
    const outPath = path.resolve(outDir, outFilename);
    // Defense in depth: outFilename is already sanitized to [A-Za-z0-9_-],
    // but assert the resolved path can't have escaped outDir before writing.
    if (!outPath.startsWith(resolvedOutDir + path.sep)) {
      throw new Error(`Refusing to write outside of output directory: ${outPath}`);
    }
    // Compact (not pretty-printed) so the output matches exactly what
    // `/api/publish` receives — e.g. a `"version":1` substring check.
    fs.writeFileSync(outPath, JSON.stringify(supercut));
    console.log(`\nWrote ${path.relative(process.cwd(), outPath)} (dry run — nothing published)`);
    return;
  }

  const token = process.env.DAILIES_PUBLISH_TOKEN;
  if (!token) {
    throw new Error(
      'DAILIES_PUBLISH_TOKEN is not set. Add it to .env in the repo root, or export it before running.',
    );
  }

  const site = (args.site || process.env.DAILIES_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');

  const publishRes = await postJson(`${site}/api/publish`, token, supercut);
  if (!publishRes.ok) {
    const body = await publishRes.text();
    throw new Error(`Publish failed: ${publishRes.status}\n${body}`);
  }
  const published = (await publishRes.json()) as { slug: string; url: string };
  console.log(`\nPublished: ${published.url}`);

  if (args.feature) {
    const featureRes = await postJson(`${site}/api/feature`, token, { slug: published.slug });
    if (!featureRes.ok) {
      const body = await featureRes.text();
      throw new Error(`Feature failed: ${featureRes.status}\n${body}`);
    }
    console.log(`Featured: ${published.slug}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
