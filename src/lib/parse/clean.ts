/**
 * Text-cleaning helpers shared by the transcript parser.
 */

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const LOCAL_COMMAND_CAVEAT_RE = /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g;
const COMMAND_NAME_RE = /<command-name>[\s\S]*?<\/command-name>/g;
const COMMAND_MESSAGE_RE = /<command-message>[\s\S]*?<\/command-message>/g;
const COMMAND_ARGS_RE = /<command-args>[\s\S]*?<\/command-args>/g;

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
 * markers (`<local-command-caveat>`, `<command-name>`, `<command-message>`,
 * `<command-args>`), then trims. A line that was *only* one of these
 * wrappers collapses to an empty string, which the caller treats as "not a
 * real prompt" and skips.
 */
export function cleanPromptText(raw: string): string {
  return raw
    .replace(SYSTEM_REMINDER_RE, ' ')
    .replace(LOCAL_COMMAND_CAVEAT_RE, ' ')
    .replace(COMMAND_NAME_RE, ' ')
    .replace(COMMAND_MESSAGE_RE, ' ')
    .replace(COMMAND_ARGS_RE, ' ')
    .trim();
}

/** Cleans assistant reply text: collapse whitespace, cap at ~600 chars. */
export function cleanReplyText(raw: string): string {
  return truncateWithEllipsis(collapseWhitespace(raw), 600);
}

/** Cleans text destined for a title/chapter-title: collapse, cap at 80 chars, no ellipsis. */
export function cleanTitleText(raw: string): string {
  return truncatePlain(collapseWhitespace(raw), 80);
}
