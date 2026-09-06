/**
 * Pure logic for `dailies --watch` — interval clamping, the "did the
 * transcript change since the last publish" comparison, and the watch-tick
 * state machine. No I/O: `scripts/dailies.ts` supplies the actual file reads
 * and network publishes and drives this module's functions from its loop and
 * its SIGINT handler.
 */

export const DEFAULT_INTERVAL_SECONDS = 20;
export const MIN_INTERVAL_SECONDS = 5;

/**
 * Resolves a requested `--interval <seconds>` value: defaults to
 * `DEFAULT_INTERVAL_SECONDS` when unset (or not a finite number), otherwise
 * clamps up to `MIN_INTERVAL_SECONDS`.
 */
export function resolveIntervalSeconds(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_INTERVAL_SECONDS;
  return Math.max(MIN_INTERVAL_SECONDS, requested);
}

/** The subset of a parsed Supercut that determines whether it changed since the last publish. */
export interface WatchSnapshot {
  eventsLength: number;
  toolCalls: number;
}

/** True when `next` differs from `prev` in either tracked field. */
export function hasChanged(prev: WatchSnapshot, next: WatchSnapshot): boolean {
  return next.eventsLength !== prev.eventsLength || next.toolCalls !== prev.toolCalls;
}

/** Watch-loop state: the snapshot as of the last successful publish. */
export interface WatchState {
  last: WatchSnapshot;
}

/** Seeds watch state from the snapshot published on the first tick. */
export function initWatchState(initial: WatchSnapshot): WatchState {
  return { last: initial };
}

export type WatchCommand =
  | { kind: 'skip' }
  | { kind: 'republish'; narrate: boolean; final: boolean; deltaEvents: number };

export interface WatchTransition {
  state: WatchState;
  command: WatchCommand;
}

/**
 * One interval tick: compares `snapshot` (the freshly re-parsed transcript)
 * against the last published snapshot. Unchanged -> `skip` (state
 * untouched). Changed -> `republish` with `narrate: false` (interval ticks
 * never narrate) and the event-count delta since the last publish, and the
 * state advances to `snapshot`.
 */
export function tick(state: WatchState, snapshot: WatchSnapshot): WatchTransition {
  if (!hasChanged(state.last, snapshot)) {
    return { state, command: { kind: 'skip' } };
  }
  const deltaEvents = snapshot.eventsLength - state.last.eventsLength;
  return {
    state: { last: snapshot },
    command: { kind: 'republish', narrate: false, final: false, deltaEvents },
  };
}

/**
 * SIGINT: always republishes exactly once — regardless of whether anything
 * changed since the last tick — narrating unless `noNarrate` (the CLI's
 * `--no-narrate`) is set. This is the one place `narrate` can be `true`.
 */
export function stop(state: WatchState, snapshot: WatchSnapshot, noNarrate: boolean): WatchTransition {
  const deltaEvents = snapshot.eventsLength - state.last.eventsLength;
  return {
    state: { last: snapshot },
    command: { kind: 'republish', narrate: !noNarrate, final: true, deltaEvents },
  };
}

/**
 * SIGINT sequencing: waits out a tick that's already in flight (if any) —
 * swallowing whatever it throws, since a failed tick must never block the
 * final publish — before running `publishFinal`. Without this, a SIGINT
 * that lands mid-tick can let that tick's own (non-narrated) publish
 * complete *after* the final narrated publish and clobber it. Callers
 * (`scripts/dailies.ts`) supply the in-flight tick promise they're tracking
 * and a `publishFinal` closure that re-reads the transcript and does the
 * final narrated publish, so this stays pure I/O-wise and testable.
 */
export async function finalizeWatch(
  activeTick: Promise<unknown> | null,
  publishFinal: () => Promise<void>,
): Promise<void> {
  if (activeTick) {
    await activeTick.catch(() => {});
  }
  await publishFinal();
}

/** Formats the compact per-update line: `hh:mm:ss  +N events · tools T · commits C`. */
export function formatTickLine(now: Date, deltaEvents: number, toolCalls: number, commits: number): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const hhmmss = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${hhmmss}  +${deltaEvents} events · tools ${toolCalls} · commits ${commits}`;
}
