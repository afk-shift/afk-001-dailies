/**
 * Secret redaction for Dailies supercuts.
 *
 * Applied as the final step of `parseSession` (see `index.ts`), walking the
 * fully-assembled `Supercut` and masking every string leaf. Tool result
 * bodies are never captured in the first place (see the parser), so this
 * only needs to catch secrets that leak into things we *do* keep: Bash
 * command labels, commit messages, prompt/reply text, etc.
 */

type Replacement = string | ((...args: string[]) => string);

/**
 * Ordered list of (pattern, replacement) pairs. Order matters a little: the
 * more specific `sk-ant-` pattern runs before the generic `sk-` pattern so
 * both bullets from the spec are satisfied independently, but since both
 * replace with the same literal it wouldn't actually matter if they were
 * swapped.
 */
const PATTERNS: [RegExp, Replacement][] = [
  // Anthropic API keys, e.g. sk-ant-api03-...
  [/\bsk-ant-[A-Za-z0-9_-]{6,}\b/g, '[redacted]'],
  // Generic sk-prefixed keys (OpenAI-style), 20+ chars after the prefix.
  [/\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g, '[redacted]'],
  // GitHub tokens.
  [/\bghp_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  [/\bgho_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted]'],
  // Netlify personal access tokens.
  [/\bnfp_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  // Slack tokens (xoxa-, xoxp-, xoxb-).
  [/\bxox[abp]-[A-Za-z0-9-]+\b/g, '[redacted]'],
  // AWS access key IDs.
  [/\bAKIA[A-Z0-9]{16}\b/g, '[redacted]'],
  // Bearer <token> headers — keep the scheme, mask the token.
  [/\bBearer\s+[A-Za-z0-9._-]+\b/g, 'Bearer [redacted]'],
  // Long hex blobs (e.g. raw hex-encoded secrets), 40+ chars.
  [/\b[0-9a-fA-F]{40,}\b/g, '[redacted]'],
  // KEY=value / TOKEN=value / SECRET=value style assignments — keep the
  // variable name, mask the value.
  [
    /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET)[A-Za-z0-9_]*)\s*=\s*(\S+)/gi,
    (_match, name) => `${name}=[redacted]`,
  ],
];

/** Masks common secret shapes in a single string. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PATTERNS) {
    result =
      typeof replacement === 'string'
        ? result.replace(pattern, replacement)
        : result.replace(pattern, replacement as (substring: string, ...args: unknown[]) => string);
  }
  return result;
}

/**
 * Recursively walks a value, running `redactSecrets` over every string it
 * finds (in arrays, plain objects, and nested combinations of both).
 * Non-string primitives pass through untouched.
 */
export function deepRedact<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepRedact(val);
    }
    return out as T;
  }
  return value;
}
