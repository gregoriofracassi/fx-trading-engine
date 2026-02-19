import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { ReplayAsiaRangeCommand } from '../impl/replay-asia-range.command';
import { BarM15Repository } from '../../../ea-gateway/domain/repositories/bar-m15.repository';
import { AsiaRangeService } from '../../domain/services/asia-range.service';

export interface ReplayAsiaRangeResult {
  symbol: string;
  processed: number;
}

/**
 * Command handler for replaying Asia Range calculation on historical bars.
 * Processes all bars chronologically and updates Asia Range state.
 */
@CommandHandler(ReplayAsiaRangeCommand)
export class ReplayAsiaRangeHandler implements ICommandHandler<
  ReplayAsiaRangeCommand,
  ReplayAsiaRangeResult
> {
  private readonly logger = new Logger(ReplayAsiaRangeHandler.name);

  constructor(
    private readonly barM15Repository: BarM15Repository,
    private readonly asiaRangeService: AsiaRangeService,
  ) {}

  async execute(command: ReplayAsiaRangeCommand): Promise<ReplayAsiaRangeResult> {
    const { symbol } = command;

    this.logger.log(`Starting Asia Range replay for ${symbol}`);

    // Fetch all bars for symbol
    const bars = await this.barM15Repository.findAllBySymbol(symbol);

    // Process each bar chronologically
    for (const bar of bars) {
      await this.asiaRangeService.processBar(bar.symbol, bar.timeOpen, bar.high, bar.low);
    }

    this.logger.log(`Asia Range replay completed for ${symbol} | processed=${bars.length} bars`);

    return {
      symbol,
      processed: bars.length,
    };
  }
}
