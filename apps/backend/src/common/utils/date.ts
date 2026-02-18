/**
 * Parse an MT5-formatted date string to a UTC Date.
 *
 * MT5 sends dates as "2026.02.17 15:00:00" (dots as date separators, space
 * before time). This is not valid ISO 8601, so we normalise it before parsing.
 *
 * The resulting Date is treated as UTC because MT5 server time is configured
 * as UTC on our FTMO terminal.
 */
export function parseMT5Date(raw: string): Date {
  const iso = raw.replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  return new Date(iso + 'Z');
}
