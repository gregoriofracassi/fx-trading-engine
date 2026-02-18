export class BarM15ClosedEvent {
  constructor(
    public readonly symbol: string,
    public readonly timeOpen: Date, // UTC
    public readonly timeClose: Date, // UTC
    public readonly open: number,
    public readonly high: number,
    public readonly low: number,
    public readonly close: number,
  ) {}
}
