export class RequestHistoricalBackfillCommand {
  constructor(
    public readonly symbol: string,
    public readonly barsCount: number,
  ) {}
}
