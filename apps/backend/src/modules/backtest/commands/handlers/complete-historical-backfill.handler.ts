import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { CompleteHistoricalBackfillCommand } from '../impl/complete-historical-backfill.command';
import { BackfillStateService } from '../../domain/services/backfill-state.service';
import { CompleteHistoricalBackfillResult } from '../../domain/types';
import { BackfillNotFoundException } from '../../domain/exceptions';

@CommandHandler(CompleteHistoricalBackfillCommand)
export class CompleteHistoricalBackfillHandler implements ICommandHandler<CompleteHistoricalBackfillCommand> {
  private readonly logger = new Logger(CompleteHistoricalBackfillHandler.name);

  constructor(private readonly backfillStateService: BackfillStateService) {}

  async execute(
    command: CompleteHistoricalBackfillCommand,
  ): Promise<CompleteHistoricalBackfillResult> {
    const request = this.backfillStateService.getRequest(command.symbol);

    if (!request) {
      this.logger.error(
        `[BACKFILL COMPLETE FAILED] ${command.symbol} | reason=no active backfill request`,
      );
      throw new BackfillNotFoundException(command.symbol);
    }

    this.logger.log(
      `[BACKFILL COMPLETED] ${command.symbol} | bars=${request.barsIngested}/${request.barsRequested} | chunks=${request.chunksReceived}/${request.totalChunks} | duration=${Math.round((Date.now() - request.createdAt.getTime()) / 1000)}s`,
    );

    const result: CompleteHistoricalBackfillResult = {
      message: `Historical backfill completed for ${command.symbol}`,
      symbol: command.symbol,
      barsIngested: request.barsIngested,
      chunksReceived: request.chunksReceived,
    };

    // Remove the backfill request from state
    this.backfillStateService.completeRequest(command.symbol);

    this.logger.log(`[BACKFILL STATE CLEARED] ${command.symbol} | request removed from memory`);

    return result;
  }
}
