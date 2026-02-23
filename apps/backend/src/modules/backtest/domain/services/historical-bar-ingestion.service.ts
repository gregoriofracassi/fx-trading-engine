import { Injectable, Logger } from '@nestjs/common';
import { HistoricalBarDto } from '../../dto/requests/upload-historical-bars.dto';
import { HistoricalBarRepository } from '../repositories/historical-bar.repository';

@Injectable()
export class HistoricalBarIngestionService {
  private readonly logger = new Logger(HistoricalBarIngestionService.name);

  constructor(private readonly repository: HistoricalBarRepository) {}

  async ingestBars(symbol: string, bars: HistoricalBarDto[]): Promise<void> {
    if (bars.length === 0) {
      return;
    }

    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];

    this.logger.log(
      `[DB INGESTION] ${symbol} | bars=${bars.length} | first=${firstBar.timeOpen.toISOString()} | last=${lastBar.timeOpen.toISOString()}`,
    );

    for (const bar of bars) {
      await this.repository.upsert({
        symbol,
        timeOpen: bar.timeOpen,
        timeClose: bar.timeClose,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        tickVolume: bar.tickVolume,
        spreadPoints: bar.spreadPoints,
      });
    }
  }
}
