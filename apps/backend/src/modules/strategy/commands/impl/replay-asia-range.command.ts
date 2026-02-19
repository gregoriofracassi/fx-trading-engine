/**
 * Command to replay Asia Range calculation on historical bars.
 * Used by admin endpoint for retroactive Asia Range generation.
 */
export class ReplayAsiaRangeCommand {
  constructor(public readonly symbol: string) {}
}
