/**
 * Command to replay S1 signal detection on historical bars.
 * Used by admin endpoint for retroactive signal detection.
 */
export class ReplayS1SignalsCommand {
  constructor(public readonly symbol: string) {}
}
