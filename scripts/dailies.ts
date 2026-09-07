#!/usr/bin/env tsx
/**
 * Dailies CLI — reads a Claude Code session transcript, parses it into a
 * Supercut, and either writes it locally (`--dry-run`) or publishes it to a
 * Dailies site via `POST /api/publish`.
 *
 * Usage:
 *   npm run dailies -- <sessionId|path/to/session.jsonl> [--dry-run] [--title "..."] [--feature] [--update <slug>] [--site https://...] [--no-narrate]
 *   npm run dailies -- <sessionId|path/to/session.jsonl> --watch [--interval 20] [--update <slug>] [--no-narrate] [--site https://...]
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MAX_BODY_BYTES } from '../netlify/functions/_shared/validate';
import { parseSessionWithRedactions, type SessionInput } from '../src/lib/parse';
import type { Supercut } from '../src/lib/types';
import {
  finalizeWatch,
  formatPublishFailedLine,
  formatTickLine,
  initWatchState,
  resolveIntervalSeconds,
  stop,
  tick,
  type WatchSnapshot,
} from './lib/watch';

const DEFAULT_SITE_URL = 'https://surprise-me-001.netlify.app';
const MAX_OUTPUT_FILENAME_LENGTH = 80;

interface CliArgs {
  input: string;
  dryRun: boolean;
  title?: string;
  feature: boolean;
  site?: string;
  noNarrate: boolean;
  update?: string;
  watch: boolean;
  interval?: number;
}

function usage(): string {
  return (
    'Usage: npm run dailies -- <sessionId|path/to/session.jsonl> [--dry-run] [--title "..."] [--feature] [--update <slug>] [--site https://...] [--no-narrate]\n' +
    '       npm run dailies -- <sessionId|path/to/session.jsonl> --watch [--interval 20] [--update <slug>] [--no-narrate] [--site https://...]'
  );
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const args: CliArgs = { input: '', dryRun: false, feature: false, noNarrate: false, watch: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--feature') {
      args.feature = true;
    } else if (arg === '--no-narrate') {
      args.noNarrate = true;
    } else if (arg === '--watch') {
      args.watch = true;
    } else if (arg === '--title') {
      args.title = argv[++i];
    } else if (arg === '--site') {
      args.site = argv[++i];
    } else if (arg === '--update') {
      args.update = argv[++i];
    } else if (arg === '--interval') {
      const raw = argv[++i];
      const parsed = raw === undefined ? Number.NaN : Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new Error(`--interval requires a numeric value (seconds)\n${usage()}`);
      }
      args.interval = parsed;
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

/**
 * Best-effort scan for `cwd` and `sessionId`: a transcript's very first line
 * is often a sidecar line (e.g. a `mode`/`bridge-session` line) that carries
 * neither field, so this keeps scanning until it finds a line with a string
 * `cwd` and, separately, a line with a string `sessionId` — they need not be
 * the same line — rather than trusting whatever the first parseable line
 * happens to have.
 */
export function parseFirstLine(lines: string[]): { cwd: string; sessionId: string } {
  let cwd = '';
  let sessionId = '';
  for (const line of lines) {
    if (cwd && sessionId) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd;
    if (!sessionId && typeof obj.sessionId === 'string') sessionId = obj.sessionId;
  }
  return { cwd, sessionId };
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

/** POSTs an already-serialized JSON string — used by `publishSupercut`, which needs the exact byte length before sending. */
async function postSerializedJson(url: string, token: string, serializedBody: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: serializedBody,
  });
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Checks a serialized publish body against `MAX_BODY_BYTES` — the same 2 MB
 * cap `publish.mts` enforces server-side — and returns a clear, user-facing
 * message when it's over, or `null` when it's within bounds. Checked before
 * sending so an oversized session fails fast on the CLI instead of getting a
 * 413 back from the server.
 */
export function publishSizeError(serializedBody: string): string | null {
  const byteLength = new TextEncoder().encode(serializedBody).length;
  if (byteLength <= MAX_BODY_BYTES) return null;
  return (
    `Publish payload is ${formatMegabytes(byteLength)}, over the server's ${formatMegabytes(MAX_BODY_BYTES)} limit. ` +
    'Trim the session (fewer subagents or a shorter transcript) before publishing.'
  );
}

interface LoadedSession {
  supercut: Supercut;
  redactionCount: number;
  sessionId: string;
}

/**
 * Resolves `input` to a transcript, parses it (main file + subagents dir,
 * both read fresh off disk on every call), and redacts. Called once for the
 * one-shot path and repeatedly — main + subagents dir re-read each time, so
 * newly-appeared subagent files are picked up — by the `--watch` loop.
 */
function loadSession(input: string, titleOverride?: string): LoadedSession {
  const resolved = resolveInput(input);
  const mainLines = readLines(resolved.mainFile);
  const { cwd, sessionId: firstLineSessionId } = parseFirstLine(mainLines);
  const sessionId = firstLineSessionId || path.basename(resolved.mainFile, '.jsonl');
  const project = cwd ? path.basename(cwd) : 'unknown';
  const subagents = loadSubagents(resolved.subagentsDir);

  const { supercut, redactionCount } = parseSessionWithRedactions({ sessionId, project, lines: mainLines, subagents });
  if (titleOverride) supercut.title = titleOverride;

  return { supercut, redactionCount, sessionId };
}

interface PublishOptions {
  site: string;
  token: string;
  /** Omitted from the wire body (server default is on) unless explicitly false. */
  narrate: boolean;
  /** Publish over an existing slug (`--update`, or the watch loop's own slug) instead of minting a new one. */
  slug?: string;
}

/**
 * POSTs a Supercut to `/api/publish` and returns its published `{ slug, url }`.
 * Checks the serialized body against `MAX_BODY_BYTES` (the same 2 MB cap the
 * server enforces) before sending, so an oversized session fails fast with a
 * clear message instead of a 413 from the server.
 */
async function publishSupercut(supercut: Supercut, opts: PublishOptions): Promise<{ slug: string; url: string }> {
  const publishBody: Record<string, unknown> = { ...supercut };
  if (!opts.narrate) publishBody.narrate = false;
  if (opts.slug) publishBody.slug = opts.slug;

  const serialized = JSON.stringify(publishBody);
  const sizeError = publishSizeError(serialized);
  if (sizeError) throw new Error(sizeError);

  const publishRes = await postSerializedJson(`${opts.site}/api/publish`, opts.token, serialized);
  if (!publishRes.ok) {
    const body = await publishRes.text();
    throw new Error(`Publish failed: ${publishRes.status}\n${body}`);
  }
  return (await publishRes.json()) as { slug: string; url: string };
}

function requireToken(): string {
  const token = process.env.DAILIES_PUBLISH_TOKEN;
  if (!token) {
    throw new Error(
      'DAILIES_PUBLISH_TOKEN is not set. Add it to .env in the repo root, or export it before running.',
    );
  }
  return token;
}

function resolveSite(args: CliArgs): string {
  return (args.site || process.env.DAILIES_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

function snapshotOf(supercut: Supercut): WatchSnapshot {
  return { eventsLength: supercut.events.length, toolCalls: supercut.stats.toolCalls };
}

/**
 * `npm run dailies -- <sessionId|path> --watch [--interval 20]` — follows a
 * still-running session and republishes over the same slug as it grows. See
 * `scripts/lib/watch.ts` for the pure change-detection / tick logic driven
 * from this loop.
 */
async function runWatch(args: CliArgs, token: string, site: string): Promise<void> {
  const intervalMs = resolveIntervalSeconds(args.interval) * 1000;

  const first = loadSession(args.input, args.title);
  printSummary(first.supercut, first.redactionCount);

  const published = await publishSupercut(first.supercut, {
    site,
    token,
    narrate: false,
    slug: args.update,
  });
  const slug = published.slug;

  console.log(`\n${published.url}?live=1`);
  console.log('Watching… (Ctrl-C to stop)');

  let state = initWatchState(snapshotOf(first.supercut));
  let stopping = false;
  let busy = false;
  // The currently in-flight tick's publish, if any — SIGINT waits for this
  // before doing the final publish, so an older non-narrated publish can
  // never land after (and clobber) the final narrated one.
  let activeTick: Promise<void> | null = null;

  const runTick = async (): Promise<void> => {
    try {
      const loaded = loadSession(args.input, args.title);
      const { state: nextState, command } = tick(state, snapshotOf(loaded.supercut));
      if (command.kind === 'republish') {
        // Only commit `nextState` once the publish it authorizes has
        // actually landed — if it throws, keep the old `state` so the next
        // tick's comparison covers the same (or a larger) delta instead of
        // silently skipping the transcript that never got published.
        try {
          await publishSupercut(loaded.supercut, { site, token, narrate: false, slug });
        } catch (err) {
          console.error(formatPublishFailedLine(new Date(), err instanceof Error ? err.message : String(err)));
          return;
        }
        state = nextState;
        console.log(
          formatTickLine(new Date(), command.deltaEvents, loaded.supercut.stats.toolCalls, loaded.supercut.stats.commits),
        );
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => {
    if (stopping || busy) return;
    busy = true;
    activeTick = runTick();
  }, intervalMs);

  /**
   * Re-reads the transcript and does the final narrated publish. Only
   * called from `finish()`, after any in-flight tick has settled — so this
   * is always the last write for the slug.
   */
  const publishFinal = async (): Promise<void> => {
    const loaded = loadSession(args.input, args.title);
    const { narrate } = stop(args.noNarrate);
    const finalPublished = await publishSupercut(loaded.supercut, {
      site,
      token,
      narrate,
      slug,
    });
    console.log(`Final publish with narration: ${finalPublished.url}`);
  };

  const finish = async (): Promise<void> => {
    try {
      await finalizeWatch(activeTick, publishFinal);
      process.exit(0);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    if (stopping) {
      // A second SIGINT while the final publish is still in flight: bail
      // immediately rather than let it interleave with another attempt.
      process.exit(130);
    }
    stopping = true;
    clearInterval(timer);
    void finish();
  });

  // Keep the process alive; `finish()` calls `process.exit` explicitly.
  await new Promise<void>(() => {});
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.watch && args.dryRun) {
    throw new Error(`--watch cannot be combined with --dry-run\n${usage()}`);
  }

  loadRepoEnv();

  if (args.watch) {
    const token = requireToken();
    const site = resolveSite(args);
    await runWatch(args, token, site);
    return;
  }

  const loaded = loadSession(args.input, args.title);
  printSummary(loaded.supercut, loaded.redactionCount);

  if (args.dryRun) {
    const outDir = path.join(process.cwd(), 'dailies-out');
    fs.mkdirSync(outDir, { recursive: true });
    const resolvedOutDir = path.resolve(outDir);
    const outFilename = `${safeFilenameFromSessionId(loaded.sessionId)}.json`;
    const outPath = path.resolve(outDir, outFilename);
    // Defense in depth: outFilename is already sanitized to [A-Za-z0-9_-],
    // but assert the resolved path can't have escaped outDir before writing.
    if (!outPath.startsWith(resolvedOutDir + path.sep)) {
      throw new Error(`Refusing to write outside of output directory: ${outPath}`);
    }
    // Compact (not pretty-printed) so the output matches exactly what
    // `/api/publish` receives — e.g. a `"version":1` substring check.
    fs.writeFileSync(outPath, JSON.stringify(loaded.supercut));
    console.log(`\nWrote ${path.relative(process.cwd(), outPath)} (dry run — nothing published)`);
    return;
  }

  const token = requireToken();
  const site = resolveSite(args);

  const published = await publishSupercut(loaded.supercut, {
    site,
    token,
    narrate: !args.noNarrate,
    slug: args.update,
  });
  console.log(`\nPublished: ${published.url}`);
  if (!args.noNarrate) {
    console.log('Narration is generating in the background (~30s); refresh the page.');
  }

  if (args.feature) {
    const featureRes = await postJson(`${site}/api/feature`, token, { slug: published.slug });
    if (!featureRes.ok) {
      const body = await featureRes.text();
      throw new Error(`Feature failed: ${featureRes.status}\n${body}`);
    }
    console.log(`Featured: ${published.slug}`);
  }
}

// Only run the CLI when this file is executed directly (`tsx scripts/dailies.ts`
// / `npm run dailies`) — not when a test imports it for its pure helpers
// (e.g. `parseFirstLine`), which would otherwise trigger `main()` as a
// module-load side effect.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
