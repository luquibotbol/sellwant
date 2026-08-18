/**
 * Shared formatters.
 *
 * These lived as copy-pasted locals in four screens (money) and two components
 * (local-date). Copies drift, and two screens disagreeing about a price is a
 * trust bug on a marketplace, not a cosmetic one.
 */

/** 3800 -> "$38", 3850 -> "$38.50". Cents in, display string out. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Today as YYYY-MM-DD in LOCAL time.
 *
 * Not toISOString() -- that converts to UTC first, so anywhere west of
 * Greenwich reports yesterday all evening. Austin is UTC-5/6, which is
 * precisely when students post party tickets.
 */
export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses YYYY-MM-DD as a local date, avoiding the same UTC shift on the way back. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
}

/** "Tonight" / "Tomorrow" / "Friday" / "Aug 15" -- relative while it matters. */
export function relativeDate(date: string): string {
  const d = fromISODate(date);
  const today = new Date(new Date().toDateString());
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days === 0) return 'Tonight';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Tonight · Sig Ep house". Either part may be missing. */
export function whenAndWhere(date: string | null, location: string | null): string {
  const parts: string[] = [];
  if (date) parts.push(relativeDate(date));
  if (location) parts.push(location);
  return parts.join(' · ');
}

/**
 * How long ago something happened.
 *
 * Deliberately not relativeDate, which answers "when is this party" and says
 * "Tonight" or "Tomorrow". That vocabulary points forwards, so a report filed
 * "Tonight" reads as though it has not happened yet -- and relativeDate parses
 * a plain YYYY-MM-DD, so handing it a timestamptz shifts the day.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
