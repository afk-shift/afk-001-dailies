/**
 * Text-cleaning helpers shared by the transcript parser.
 */

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
// Matches any `<local-command-X>...</local-command-X>` pair (X may be
// `caveat`, `stdout`, or any future variant) — the backreference keeps a
// stray unmatched open/close tag from swallowing unrelated text.
const LOCAL_COMMAND_RE = /<local-command-([a-zA-Z-]+)>[\s\S]*?<\/local-command-\1>/g;
const COMMAND_NAME_RE = /<command-name>[\s\S]*?<\/command-name>/g;
const COMMAND_MESSAGE_RE = /<command-message>[\s\S]*?<\/command-message>/g;
const COMMAND_ARGS_RE = /<command-args>[\s\S]*?<\/command-args>/g;

// --- Minimal markdown-to-plain-text conversion, used only by `cleanReplyText`
// (never `cleanPromptText` — Sean's typed prompts stay verbatim). ---

/** A fenced code block: ```lang\n...body...\n``` (language tag optional). */
const FENCED_CODE_RE = /```[^\n`]*\r?\n?([\s\S]*?)```/g;
/** A markdown link: `[text](url)`. */
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
/** A heading (`#`..`######`), bullet (`-`/`*`), or ordered-list (`1.`) marker at the start of a line. */
const LEADING_MARKUP_RE = /^[ \t]*(?:#{1,6}[ \t]+|[-*][ \t]+|\d+\.[ \t]+)/gm;

/**
 * Converts a minimal subset of markdown in assistant reply text to plain
 * text, so raw formatting (`**bold**`, single backticks, fenced code, links,
 * heading/list markers) never shows up literally in a rendered replay:
 *   - a fenced code block collapses to its first line, prefixed `code: `
 *     (an empty block becomes just `code:`)
 *   - `[text](url)` becomes `text`
 *   - backtick characters are dropped, keeping their content
 *   - `**`/`__` bold markers are dropped, keeping their content
 *   - a leading `#`/`-`/`*`/`1.` heading or list marker at a line's start is
 *     dropped
 */
export function stripReplyMarkdown(raw: string): string {
  let text = raw.replace(FENCED_CODE_RE, (_match, body: string) => {
    const firstLine = (body.split(/\r?\n/)[0] ?? '').trim();
    return firstLine ? `code: ${firstLine}` : 'code:';
  });
  text = text.replace(MARKDOWN_LINK_RE, '$1');
  text = text.replace(/`/g, '');
  text = text.replace(/\*\*/g, '').replace(/__/g, '');
  text = text.replace(LEADING_MARKUP_RE, '');
  return text;
}

/** Collapses all runs of whitespace (including newlines) to a single space. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Cuts a string to `max` characters with no added suffix. */
export function truncatePlain(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** Cuts a string to `max` characters, appending an ellipsis when trimmed. */
export function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * Cleans raw `user`-turn text into what a human actually typed: strips
 * `<system-reminder>` wrappers (harness-injected context) and local-command
 * markers (`<local-command-caveat>`, `<local-command-stdout>`, and any other
 * `<local-command-X>` variant, plus `<command-name>`, `<command-message>`,
 * `<command-args>`), then trims. A line that was *only* one of these
 * wrappers collapses to an empty string, which the caller treats as "not a
 * real prompt" and skips.
 */
export function cleanPromptText(raw: string): string {
  return raw
    .replace(SYSTEM_REMINDER_RE, ' ')
    .replace(LOCAL_COMMAND_RE, ' ')
    .replace(COMMAND_NAME_RE, ' ')
    .replace(COMMAND_MESSAGE_RE, ' ')
    .replace(COMMAND_ARGS_RE, ' ')
    .trim();
}

/**
 * Cleans assistant reply text: converts minimal markdown to plain text (see
 * `stripReplyMarkdown`), collapses whitespace, and caps at ~600 chars.
 */
export function cleanReplyText(raw: string): string {
  return truncateWithEllipsis(collapseWhitespace(stripReplyMarkdown(raw)), 600);
}

/** Cleans text destined for a title/chapter-title: collapse, cap at 80 chars, no ellipsis. */
export function cleanTitleText(raw: string): string {
  return truncatePlain(collapseWhitespace(raw), 80);
}
