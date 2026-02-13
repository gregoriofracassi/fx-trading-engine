export class ProcessEaEventCommand {
  constructor(
    public readonly terminalId: string,
    public readonly type: string,
    public readonly sequenceNum: number | undefined,
    public readonly sentAt: Date | undefined,
    public readonly payload: Record<string, unknown>,
  ) {}
}
