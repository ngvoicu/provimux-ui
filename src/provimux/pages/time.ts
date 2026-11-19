/**
 * Times on Provimux's pages. The server's times carry fractions of a second and are compared as times. Countdowns
 * and "ago" use the server's clock: `observed_at` against the moment the answer arrived gives the offset.
 */

/** Milliseconds of a timestamp, or null when it is not a time. */
export const timeMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** Server clock minus browser clock, from an answer's `observed_at` and the browser time it arrived. */
export const clockOffset = (observedAt: string | null, receivedAtMs: number): number => {
  const observed = timeMs(observedAt);
  return observed === null ? 0 : observed - receivedAtMs;
};

/** The server's "now" for a browser instant. */
export const serverNow = (browserNowMs: number, offsetMs: number): number =>
  browserNowMs + offsetMs;

/** Whole parts of a duration, rounded up to the second so a running countdown never shows 0 before the end. */
export function durationParts(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/** "45 s", "26 min", "1 h 05 min", "3 d 4 h". */
export function formatDuration(ms: number): string {
  const { h, m, s } = durationParts(ms);
  if (h >= 48) return `${Math.floor(h / 24)} d ${h % 24} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return s > 0 && m < 2 ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

/** A clock time for today, a date and time otherwise, in the reader's language and zone. */
export function formatClock(ms: number, language: string, nowMs: number = Date.now()): string {
  const date = new Date(ms);
  const sameDay = new Date(nowMs).toDateString() === date.toDateString();
  try {
    return sameDay
      ? date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleString(language, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  } catch {
    return date.toISOString();
  }
}

/** The full time, seconds included, for a tooltip. */
export function formatExact(ms: number, language: string): string {
  try {
    return new Date(ms).toLocaleString(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

/** "2 hours ago", "in 5 minutes", in the reader's language. */
export function formatRelative(ms: number, nowMs: number, language: string): string {
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return rtf.format(Math.round(diff / 1000), 'second');
}
