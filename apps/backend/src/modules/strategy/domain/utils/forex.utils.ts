/**
 * Forex utility functions for price conversions and calculations.
 */

/**
 * Convert a price distance to pips.
 * - Most Forex pairs: 1 pip = 0.0001 (4 decimal places)
 * - JPY pairs: 1 pip = 0.01 (2 decimal places)
 *
 * @example
 * toPips(0.0005, 'EURUSD') // => 5 pips
 * toPips(0.05, 'USDJPY')   // => 5 pips
 */
export function toPips(priceDistance: number, symbol: string): number {
  const pipSize = symbol.includes('JPY') ? 0.01 : 0.0001;
  return Math.abs(priceDistance) / pipSize;
}

/**
 * Get the pip size for a given symbol.
 * Useful for converting pips back to price distance.
 *
 * @example
 * getPipSize('EURUSD') // => 0.0001
 * getPipSize('USDJPY') // => 0.01
 */
export function getPipSize(symbol: string): number {
  return symbol.includes('JPY') ? 0.01 : 0.0001;
}

/**
 * Convert pips to price distance.
 *
 * @example
 * fromPips(5, 'EURUSD') // => 0.0005
 * fromPips(5, 'USDJPY') // => 0.05
 */
export function fromPips(pips: number, symbol: string): number {
  return pips * getPipSize(symbol);
}
