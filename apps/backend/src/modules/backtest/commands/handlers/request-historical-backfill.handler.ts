import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { RequestHistoricalBackfillCommand } from '../impl/request-historical-backfill.command';
import { BackfillStateService } from '../../domain/services/backfill-state.service';
import { RequestHistoricalBackfillResult } from '../../domain/types';

@CommandHandler(RequestHistoricalBackfillCommand)
export class RequestHistoricalBackfillHandler implements ICommandHandler<RequestHistoricalBackfillCommand> {
  private readonly logger = new Logger(RequestHistoricalBackfillHandler.name);

  constructor(private readonly backfillStateService: BackfillStateService) {}

  async execute(
    command: RequestHistoricalBackfillCommand,
  ): Promise<RequestHistoricalBackfillResult> {
    this.logger.log(
      `[BACKFILL REQUESTED] ${command.symbol} | bars=${command.barsCount} | chunks=${Math.ceil(command.barsCount / 500)}`,
    );

    const request = this.backfillStateService.createRequest(command.symbol, command.barsCount);

    this.logger.log(
      `[BACKFILL CREATED] ${command.symbol} | totalChunks=${request.totalChunks} | waiting for EA pickup`,
    );

    return {
      message: `Historical backfill requested for ${command.symbol}`,
      barsRequested: request.barsRequested,
      totalChunks: request.totalChunks,
      note: 'EA will pick up this request on next bar close',
    };
  }
}
