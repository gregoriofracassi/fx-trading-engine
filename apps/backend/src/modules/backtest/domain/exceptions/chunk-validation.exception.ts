/**
 * Thrown when chunk metadata doesn't match the expected backfill request.
 * This indicates EA/backend state mismatch or EA implementation error.
 */
export class ChunkValidationException extends Error {
  constructor(
    public readonly symbol: string,
    public readonly field: string,
    public readonly expected: number,
    public readonly received: number,
  ) {
    super(
      `Chunk validation failed for ${symbol}: ${field} mismatch (expected ${expected}, got ${received})`,
    );
    this.name = 'ChunkValidationException';
  }
}
