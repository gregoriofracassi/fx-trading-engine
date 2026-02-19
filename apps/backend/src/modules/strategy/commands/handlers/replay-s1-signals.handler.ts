import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { BarM15 } from '@prisma/client';
import { ReplayS1SignalsCommand } from '../impl/replay-s1-signals.command';
import { BarM15Repository } from '../../../ea-gateway/domain/repositories/bar-m15.repository';
import { AsiaRangeRepository } from '../../domain/repositories/asia-range.repository';
import { S1SignalService } from '../../domain/services/s1-signal.service';
import { toRomeDateString } from '../../domain/utils/date.utils';

export interface ReplayS1SignalsResult {
  symbol: string;
  processed: number;
  signalsDetected: number;
  valid: number;
  invalid: number;
}

/**
 * Command handler for replaying S1 signal detection on historical bars.
 * Optimized for large datasets (17,000+ bars):
 * - Fetches all AsiaRanges upfront (2 DB queries instead of N+1)
 * - Uses in-memory map for O(1) AsiaRange lookups
 * - Processes bars chronologically with sliding window
 */
@CommandHandler(ReplayS1SignalsCommand)
export class ReplayS1SignalsHandler implements ICommandHandler<
  ReplayS1SignalsCommand,
  ReplayS1SignalsResult
> {
  private readonly logger = new Logger(ReplayS1SignalsHandler.name);

  constructor(
    private readonly barM15Repository: BarM15Repository,
    private readonly asiaRangeRepository: AsiaRangeRepository,
    private readonly s1SignalService: S1SignalService,
  ) {}

  async execute(command: ReplayS1SignalsCommand): Promise<ReplayS1SignalsResult> {
    const { symbol } = command;

    this.logger.log(`Starting S1 replay for ${symbol}`);

    // Fetch all data upfront (optimization)
    const bars = await this.barM15Repository.findAllBySymbol(symbol);
    const allAsiaRanges = await this.asiaRangeRepository.findAllBySymbol(symbol);

    // Build in-memory map: date → AsiaRange (O(1) lookup)
    const asiaRangesByDate = new Map(allAsiaRanges.map((ar) => [ar.date, ar]));

    this.logger.log(
      `Loaded ${bars.length} bars and ${allAsiaRanges.length} AsiaRanges for ${symbol}`,
    );

    let signalsDetected = 0;
    let validSignals = 0;
    let invalidSignals = 0;

    // Process each bar chronologically
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];

      try {
        const result = await this.processBar(i, bars, asiaRangesByDate, symbol);

        if (result) {
          signalsDetected++;
          if (result.valid) {
            validSignals++;
          } else {
            invalidSignals++;
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to detect S1 for ${symbol} at ${bar.timeClose.toISOString()}`,
          (error as Error).stack,
        );
      }
    }

    this.logger.log(
      `S1 replay completed for ${symbol} | processed=${bars.length} detected=${signalsDetected} valid=${validSignals} invalid=${invalidSignals}`,
    );

    return {
      symbol,
      processed: bars.length,
      signalsDetected,
      valid: validSignals,
      invalid: invalidSignals,
    };
  }

  private async processBar(
    currentIndex: number,
    allBars: BarM15[],
    asiaRangesByDate: Map<
      string,
      {
        id: string;
        high: number;
        low: number;
        finalized: boolean;
        date: string;
        symbol: string;
        createdAt: Date;
        updatedAt: Date;
      }
    >,
    symbol: string,
  ): Promise<{ valid: boolean; setupType: string } | null> {
    const bar = allBars[currentIndex];

    // Get recent 10 bars (sliding window)
    const startIndex = Math.max(0, currentIndex - 9);
    const recentBars = allBars.slice(startIndex, currentIndex + 1);

    if (recentBars.length < 2) {
      return null; // Need at least 2 bars for S1
    }

    // Get Asia Range from in-memory map (no DB query)
    const dateRome = toRomeDateString(bar.timeOpen);
    const asiaRange = asiaRangesByDate.get(dateRome);

    if (!asiaRange || !asiaRange.finalized) {
      return null;
    }

    // Detect and save signal (delegates to shared service)
    return this.s1SignalService.detectAndSaveSignal(
      symbol,
      bar.timeClose,
      dateRome,
      recentBars,
      asiaRange,
    );
  }
}
