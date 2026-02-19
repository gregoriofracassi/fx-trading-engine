/**
 * Thrown when BarM15 data contains invalid OHLC values.
 * This indicates data corruption or upstream issues.
 */
export class InvalidBarDataException extends Error {
  constructor(
    public readonly symbol: string,
    public readonly timeOpen: Date,
    public readonly reason: string,
  ) {
    super(`Invalid bar data for ${symbol} at ${timeOpen.toISOString()}: ${reason}`);
    this.name = 'InvalidBarDataException';
  }
}
