import { BarM15, AsiaRange } from '@prisma/client';
import { InvalidBarDataException, InvalidAsiaRangeException } from '../exceptions';

/**
 * Check if a price value is valid (number, finite, positive).
 */
export function isValidPrice(price: number): boolean {
  return typeof price === 'number' && !isNaN(price) && isFinite(price) && price > 0;
}

/**
 * Validate OHLC prices are all valid numbers.
 */
function validateOHLCPrices(bar: BarM15): void {
  if (!isValidPrice(bar.open)) {
    throw new InvalidBarDataException(bar.symbol, bar.timeOpen, 'open is invalid');
  }
  if (!isValidPrice(bar.high)) {
    throw new InvalidBarDataException(bar.symbol, bar.timeOpen, 'high is invalid');
  }
  if (!isValidPrice(bar.low)) {
    throw new InvalidBarDataException(bar.symbol, bar.timeOpen, 'low is invalid');
  }
  if (!isValidPrice(bar.close)) {
    throw new InvalidBarDataException(bar.symbol, bar.timeOpen, 'close is invalid');
  }
}

/**
 * Validate high is above low.
 */
function validateHighAboveLow(bar: BarM15): void {
  if (bar.high < bar.low) {
    throw new InvalidBarDataException(
      bar.symbol,
      bar.timeOpen,
      `high=${bar.high} < low=${bar.low}`,
    );
  }
}

/**
 * Validate high is the highest point and low is the lowest.
 */
function validateHighLowBounds(bar: BarM15): void {
  if (bar.high < bar.open || bar.high < bar.close) {
    throw new InvalidBarDataException(
      bar.symbol,
      bar.timeOpen,
      `high=${bar.high} is lower than open/close`,
    );
  }
  if (bar.low > bar.open || bar.low > bar.close) {
    throw new InvalidBarDataException(
      bar.symbol,
      bar.timeOpen,
      `low=${bar.low} is higher than open/close`,
    );
  }
}

/**
 * Validate high/low relationships are logically consistent.
 */
function validateHighLowRelationships(bar: BarM15): void {
  validateHighAboveLow(bar);
  validateHighLowBounds(bar);
}

/**
 * Validate a single BarM15 has valid OHLC data.
 * Throws InvalidBarDataException if any price is invalid.
 */
export function validateBar(bar: BarM15): void {
  validateOHLCPrices(bar);
  validateHighLowRelationships(bar);
}

/**
 * Validate an array of bars.
 * Throws InvalidBarDataException if any bar is invalid.
 */
export function validateBars(bars: BarM15[]): void {
  for (const bar of bars) {
    validateBar(bar);
  }
}

/**
 * Validate AsiaRange data is logically consistent.
 * Throws InvalidAsiaRangeException if high < low.
 */
export function validateAsiaRange(asiaRange: AsiaRange): void {
  if (!isValidPrice(asiaRange.high)) {
    throw new InvalidAsiaRangeException(
      asiaRange.symbol,
      asiaRange.date,
      asiaRange.high,
      asiaRange.low,
    );
  }
  if (!isValidPrice(asiaRange.low)) {
    throw new InvalidAsiaRangeException(
      asiaRange.symbol,
      asiaRange.date,
      asiaRange.high,
      asiaRange.low,
    );
  }
  if (asiaRange.high < asiaRange.low) {
    throw new InvalidAsiaRangeException(
      asiaRange.symbol,
      asiaRange.date,
      asiaRange.high,
      asiaRange.low,
    );
  }
}
