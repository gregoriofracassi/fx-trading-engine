export class ProcessBarM15Command {
  constructor(
    public readonly terminalId: string,
    public readonly symbol: string,
    public readonly timeOpen: Date,
    public readonly timeClose: Date,
    public readonly open: number,
    public readonly high: number,
    public readonly low: number,
    public readonly close: number,
    public readonly tickVolume: number,
    public readonly spreadPoints: number,
    public readonly seq: number | undefined,
    public readonly sentAt: Date | undefined,
  ) {}
}
