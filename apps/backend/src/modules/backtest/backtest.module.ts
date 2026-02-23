import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { BacktestController } from './controllers/backtest.controller';
import { HistoricalBarRepository } from './domain/repositories/historical-bar.repository';
import { BackfillStateService } from './domain/services/backfill-state.service';
import { HistoricalBarIngestionService } from './domain/services/historical-bar-ingestion.service';
import { RequestHistoricalBackfillHandler } from './commands/handlers/request-historical-backfill.handler';
import { IngestHistoricalChunkHandler } from './commands/handlers/ingest-historical-chunk.handler';
import { CompleteHistoricalBackfillHandler } from './commands/handlers/complete-historical-backfill.handler';
import { DatabaseModule } from '../../database/database.module';

const Services = [BackfillStateService, HistoricalBarIngestionService];

const CommandHandlers = [
  RequestHistoricalBackfillHandler,
  IngestHistoricalChunkHandler,
  CompleteHistoricalBackfillHandler,
];

const Repositories = [HistoricalBarRepository];

@Module({
  imports: [DatabaseModule, CqrsModule],
  controllers: [BacktestController],
  providers: [...Services, ...CommandHandlers, ...Repositories],
  exports: [BackfillStateService],
})
export class BacktestModule {}
