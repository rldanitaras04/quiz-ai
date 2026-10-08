/**
 * Shared date/number formatting so every screen renders the same timestamp
 * the same way. Locales are pinned to 'en-US' so server and client render
 * identical strings (no hydration mismatches) and the copy stays consistent
 * with the rest of the English-only UI.
 */

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Aug 1, 2026" — table cells, detail rows. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_FMT.format(date) : '—';
}

/** "Aug 1, 2026, 2:30 PM" — schedules, deploy windows, audit detail. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_TIME_FMT.format(date) : '—';
}

/** "2:30 PM" — time-of-day columns. */
export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? TIME_FMT.format(date) : '—';
}

/**
 * "Just now" / "5 minutes ago" / "3 hours ago" / "2 days ago" / "4 months
 * ago" — activity feeds and audit logs where exact timestamps are noise.
 */
export function formatRelative(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return formatDateTime(date);

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** 1234567 → "1,234,567". */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat('en-US', options).format(value);
}

/** 0.837 → "84%"; pass `digits` for "83.7%". Non-finite input → "—". */
export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}
