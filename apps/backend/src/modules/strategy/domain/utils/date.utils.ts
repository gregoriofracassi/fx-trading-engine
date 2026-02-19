const ROME_TZ = 'Europe/Rome';

/**
 * Convert UTC date to Rome timezone date string (YYYY-MM-DD format).
 * Used for dateRome fields across the strategy module.
 */
export function toRomeDateString(utcDate: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(utcDate); // Returns "YYYY-MM-DD"
}
