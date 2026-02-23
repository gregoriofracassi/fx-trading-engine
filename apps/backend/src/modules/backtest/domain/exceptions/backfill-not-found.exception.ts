/**
 * Thrown when attempting to operate on a backfill request that doesn't exist.
 * This indicates the EA is trying to upload chunks or complete a backfill
 * that was never triggered or already completed.
 */
export class BackfillNotFoundException extends Error {
  constructor(public readonly symbol: string) {
    super(
      `No active backfill request found for ${symbol}. Please trigger a backfill request first.`,
    );
    this.name = 'BackfillNotFoundException';
  }
}
