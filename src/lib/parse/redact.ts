/**
 * Secret redaction for Dailies supercuts.
 *
 * Applied as the final step of `parseSession` (see `index.ts`), walking the
 * fully-assembled `Supercut` and masking every string leaf. Tool result
 * bodies are never captured in the first place (see the parser), so this
 * only needs to catch secrets that leak into things we *do* keep: Bash
 * command labels, commit messages, prompt/reply text, etc.
 *
 * It's also run again server-side in `netlify/functions/publish.mts` as a
 * defense-in-depth measure — never trust a client-submitted payload to have
 * actually been through this CLI.
 */

type Replacement = string | ((...args: string[]) => string);

/**
 * Ordered list of (pattern, replacement) pairs. Order matters a little:
 *   - More specific prefixed-token patterns (sk-ant-, sk_live_, ghp_, ...)
 *     run before the generic `sk-` and long-hex-blob catch-alls so a
 *     specific match isn't partially clobbered by a broader one first.
 *   - The PEM block pattern runs first since it spans multiple lines and we
 *     don't want a later single-line pattern to partially match inside it.
 *   - The URL query-param pattern (`?key=`/`&token=`) runs before the
 *     generic KEY/TOKEN/... assignment pattern so it can stop at the next
 *     `&` instead of the assignment pattern greedily eating the rest of the
 *     query string.
 */
const PATTERNS: [RegExp, Replacement][] = [
  // PEM private key blocks, e.g. -----BEGIN RSA PRIVATE KEY----- ... -----END RSA PRIVATE KEY-----
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[redacted private key]'],

  // Anthropic API keys, e.g. sk-ant-api03-...
  [/\bsk-ant-[A-Za-z0-9_-]{6,}\b/g, '[redacted]'],
  // Stripe secret/restricted keys.
  [/\b(?:sk_live_|sk_test_|rk_live_)[A-Za-z0-9]{10,}\b/g, '[redacted]'],
  // Generic sk-prefixed keys (OpenAI-style), 20+ chars after the prefix.
  [/\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b/g, '[redacted]'],
  // GitHub tokens.
  [/\bghp_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  [/\bgho_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted]'],
  // Netlify personal access / deploy tokens.
  [/\bnf[pd]_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  // npm tokens.
  [/\bnpm_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  // Slack tokens (xoxa-, xoxp-, xoxb-, xapp-).
  [/\bxox[abp]-[A-Za-z0-9-]+\b/g, '[redacted]'],
  [/\bxapp-[A-Za-z0-9-]+/g, '[redacted]'],
  // AWS access key IDs.
  [/\bAKIA[A-Z0-9]{16}\b/g, '[redacted]'],
  // Google API keys.
  [/\bAIza[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  // JWTs: three dot-separated base64url segments, header always starts "eyJ".
  [/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[redacted]'],
  // Authorization: Basic <b64> / bare "Basic <b64>" tokens — keep the scheme, mask the token.
  [/\bBasic\s+[A-Za-z0-9+/=]+/g, 'Basic [redacted]'],
  // Bearer <token> headers — keep the scheme, mask the token.
  [/\bBearer\s+[A-Za-z0-9._-]+\b/g, 'Bearer [redacted]'],
  // Long hex blobs (e.g. raw hex-encoded secrets), 40+ chars.
  [/\b[0-9a-fA-F]{40,}\b/g, '[redacted]'],

  // URLs with embedded credentials, e.g. https://user:pass@host — mask just
  // the user:pass part, keep the scheme and host.
  [/\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/g, '$1[redacted]@'],

  // Generic key=/token= query params in URLs, e.g. ?key=abc&token=def.
  // Bounded to the next `&`/`#`/whitespace so it doesn't swallow sibling
  // query params the way the looser assignment pattern below would.
  [
    /([?&])(key|token)=([^&\s#]+)/gi,
    (_match, sep, name) => `${sep}${name}=[redacted]`,
  ],

  // KEY=value / TOKEN=value / SECRET=value / PASSWORD=value / etc. style
  // assignments — keep the variable name (and quotes, if any), mask the
  // value. `=` or `:` separators, case-insensitive key match. The value
  // stops at `&` too (not just whitespace/quotes) so a `?key=...&foo=bar`
  // query string doesn't get swallowed whole by this broader pattern —
  // that's the dedicated query-param pattern's job, above.
  [
    /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|DATABASE_URL|CONNECTION_STRING)[A-Za-z0-9_]*)(\s*[:=]\s*)(['"]?)([^\s'"&]+)\3/gi,
    (_match, name, sep, quote) => `${name}${sep}${quote}[redacted]${quote}`,
  ],
];

/**
 * Runs every pattern over `text` once, tracking how many total matches were
 * redacted along the way (used by `deepRedact` to report a count to the
 * CLI's summary output).
 */
function redactWithCount(text: string): { result: string; count: number } {
  let result = text;
  let count = 0;
  for (const [pattern, replacement] of PATTERNS) {
    const matches = result.match(pattern);
    if (matches) count += matches.length;
    result =
      typeof replacement === 'string'
        ? result.replace(pattern, replacement)
        : result.replace(pattern, replacement as (substring: string, ...args: unknown[]) => string);
  }
  return { result, count };
}

/** Masks common secret shapes in a single string. */
export function redactSecrets(text: string): string {
  return redactWithCount(text).result;
}

/**
 * Recursively walks a value, running `redactSecrets` over every string it
 * finds (in arrays, plain objects, and nested combinations of both).
 * Non-string primitives pass through untouched. Returns both the redacted
 * value and the total number of redactions applied, so callers (the Dailies
 * CLI) can report a count to the user.
 */
export function deepRedact<T>(value: T): { value: T; count: number } {
  if (typeof value === 'string') {
    const { result, count } = redactWithCount(value);
    return { value: result as unknown as T, count };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const out = value.map((item) => {
      const redacted = deepRedact(item);
      count += redacted.count;
      return redacted.value;
    });
    return { value: out as unknown as T, count };
  }
  if (value !== null && typeof value === 'object') {
    let count = 0;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const redacted = deepRedact(val);
      count += redacted.count;
      out[key] = redacted.value;
    }
    return { value: out as T, count };
  }
  return { value, count: 0 };
}
