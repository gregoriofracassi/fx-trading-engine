import { Transform } from 'class-transformer';
import { parseMT5Date } from '../utils/date';

/**
 * class-transformer decorator that converts an MT5 date string
 * ("2026.02.17 15:00:00") to a UTC Date object during DTO deserialization.
 *
 * Apply on any DTO field that receives MT5-formatted timestamps.
 * Requires ValidationPipe to be configured with `transform: true` (already
 * set globally in main.ts).
 *
 * Passes through null/undefined unchanged so @IsOptional() still works.
 */
export function ParseMT5Date() {
  return Transform(({ value }) => {
    if (value == null) return value;
    return parseMT5Date(value as string);
  });
}
