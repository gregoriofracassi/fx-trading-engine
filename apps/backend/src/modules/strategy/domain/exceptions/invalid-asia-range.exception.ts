/**
 * Thrown when AsiaRange data is logically invalid (e.g., high < low).
 * This indicates data corruption or calculation errors in AsiaRangeService.
 */
export class InvalidAsiaRangeException extends Error {
  constructor(
    public readonly symbol: string,
    public readonly date: string,
    public readonly high: number,
    public readonly low: number,
  ) {
    super(`Invalid AsiaRange for ${symbol} on ${date}: high=${high} must be >= low=${low}`);
    this.name = 'InvalidAsiaRangeException';
  }
}
