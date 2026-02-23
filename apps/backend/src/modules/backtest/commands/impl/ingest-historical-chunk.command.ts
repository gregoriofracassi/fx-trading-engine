import { HistoricalBarDto } from '../../dto/requests/upload-historical-bars.dto';

export class IngestHistoricalChunkCommand {
  constructor(
    public readonly symbol: string,
    public readonly chunkNumber: number,
    public readonly totalChunks: number,
    public readonly bars: HistoricalBarDto[],
  ) {}
}
