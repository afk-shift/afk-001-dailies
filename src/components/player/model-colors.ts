/**
 * Model identity: every cast member gets a hue from its model family, and
 * that hue is the only thing on the page that identifies *who* did a piece
 * of work — tool pills, cast chips, and spawn chips all borrow it.
 *
 * The hex values live in src/styles/global.css as `--color-cast-*`.
 */

import type { CastMember } from '../../lib/types';

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'gpt' | 'other';

/** Buckets a raw model id (`claude-sonnet-5`, `gpt-5.2`) into a family. */
export function modelFamily(model: string): ModelFamily {
  const id = model.toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('gpt') || id.includes('openai') || /\bo[1-9]\b/.test(id)) {
    return 'gpt';
  }
  return 'other';
}

/** The CSS colour reference for a model — usable anywhere a colour is. */
export function modelHue(model: string): string {
  return `var(--color-cast-${modelFamily(model)})`;
}

/** A translucent wash of a hue, for badge backgrounds and soft borders. */
export function tint(hue: string, percent: number): string {
  return `color-mix(in srgb, ${hue} ${percent}%, transparent)`;
}

/** Drops the vendor prefix and any date stamp: `claude-sonnet-5` → `sonnet-5`. */
export function shortModel(model: string): string {
  if (!model) return 'unknown';
  return model
    .replace(/^(claude|anthropic|openai|models)[-/]/, '')
    .replace(/-\d{8}$/, '');
}

/** Maps `ToolEvent.actor` / `SpawnEvent.castId` to the actor's hue. */
export function buildHueMap(cast: CastMember[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const member of cast) {
    map.set(member.id, modelHue(member.model));
  }
  return map;
}

/** Hue for an actor id, falling back to the neutral family. */
export function hueFor(map: Map<string, string>, actorId: string): string {
  return map.get(actorId) ?? 'var(--color-cast-other)';
}
