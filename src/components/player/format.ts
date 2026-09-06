/**
 * Number and time formatting for the player. Everything here is
 * deterministic (no locale/timezone drift) so the server-rendered island and
 * its hydrated counterpart always agree.
 */

function oneDecimal(value: number): string {
  const s = value.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** 1_234_567 → "1.2M", 12_400 → "12.4k", 950 → "950". */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${oneDecimal(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${oneDecimal(n / 1_000)}k`;
  return String(Math.round(n));
}

/** Wall-clock length of the session: "2h 14m", "1m 30s", "42s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Session clock for a single event: "0:01:30". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** How long ago something happened: "12s ago", "3m ago", "2h ago". */
export function formatAgo(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s ago`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

/** "Sep 6, 2026" — fixed to UTC so SSR and hydration render the same string. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_FORMAT.format(date);
}

/** Zero-padded position counter, sized to the largest index in the reel. */
export function padIndex(value: number, max: number): string {
  return String(value).padStart(String(Math.max(0, max)).length, '0');
}
