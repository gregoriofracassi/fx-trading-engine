import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { Injectable, Logger } from '@nestjs/common';
import { BarM15ClosedEvent } from '../../../ea-gateway/events/bar-m15-closed.event';
import { AsiaRangeService } from '../../domain/services/asia-range.service';
import { S1SignalService } from '../../domain/services/s1-signal.service';
import { BarM15Repository } from '../../../ea-gateway/domain/repositories/bar-m15.repository';
import { AsiaRangeRepository } from '../../domain/repositories/asia-range.repository';
import { toRomeDateString } from '../../domain/utils/date.utils';

@Injectable()
@EventsHandler(BarM15ClosedEvent)
export class BarM15ClosedHandler implements IEventHandler<BarM15ClosedEvent> {
  private readonly logger = new Logger(BarM15ClosedHandler.name);

  constructor(
    private readonly asiaRangeService: AsiaRangeService,
    private readonly s1SignalService: S1SignalService,
    private readonly barM15Repository: BarM15Repository,
    private readonly asiaRangeRepository: AsiaRangeRepository,
  ) {}

  async handle(event: BarM15ClosedEvent): Promise<void> {
    try {
      // 1. Process Asia Range (existing logic)
      await this.asiaRangeService.processBar(event.symbol, event.timeOpen, event.high, event.low);

      // 2. Try S1 detection (returns early if conditions not met)
      await this.tryDetectS1Signal(event);
    } catch (error) {
      this.logger.error(
        `Failed to process bar for ${event.symbol} at ${event.timeClose.toISOString()}`,
        (error as Error).stack,
      );
      // Handler exits gracefully, next event will still be processed
    }
  }

  private async tryDetectS1Signal(event: BarM15ClosedEvent): Promise<void> {
    // Fetch recent bars for pattern analysis (last 10 bars)
    const recentBars = await this.barM15Repository.findRecentBars(
      event.symbol,
      event.timeClose,
      10,
    );

    if (recentBars.length < 2) {
      return; // Need at least 2 bars for S1 detection
    }

    // Get Asia Range for today (Rome timezone)
    const dateRome = toRomeDateString(event.timeOpen);
    const asiaRange = await this.asiaRangeRepository.findByDateAndSymbol(dateRome, event.symbol);

    if (!asiaRange || !asiaRange.finalized) {
      return; // Need finalized Asia Range for S1 detection
    }

    // Detect and save signal (delegates to shared service)
    await this.s1SignalService.detectAndSaveSignal(
      event.symbol,
      event.timeClose,
      dateRome,
      recentBars,
      asiaRange,
    );
  }
}
