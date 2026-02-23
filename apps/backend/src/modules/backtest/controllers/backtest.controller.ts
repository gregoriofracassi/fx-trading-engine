import { Controller, Post, Get, Body } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequestHistoricalBackfillDto } from '../dto/requests/request-historical-backfill.dto';
import { UploadHistoricalBarsDto } from '../dto/requests/upload-historical-bars.dto';
import { CompleteHistoricalBackfillDto } from '../dto/requests/complete-historical-backfill.dto';
import { RequestHistoricalBackfillCommand } from '../commands/impl/request-historical-backfill.command';
import { IngestHistoricalChunkCommand } from '../commands/impl/ingest-historical-chunk.command';
import { CompleteHistoricalBackfillCommand } from '../commands/impl/complete-historical-backfill.command';
import { BackfillStateService } from '../domain/services/backfill-state.service';
import {
  type BackfillRequest,
  type RequestHistoricalBackfillResult,
  type IngestHistoricalChunkResult,
  type CompleteHistoricalBackfillResult,
} from '../domain/types';

@ApiTags('backtest')
@Controller('backtest')
export class BacktestController {
  constructor(
    private readonly backfillStateService: BackfillStateService,
    private readonly commandBus: CommandBus,
  ) {}

  @Post('request-historical-backfill')
  @ApiOperation({ summary: 'Trigger historical data backfill from EA for a symbol' })
  async requestHistoricalBackfill(
    @Body() dto: RequestHistoricalBackfillDto,
  ): Promise<RequestHistoricalBackfillResult> {
    return this.commandBus.execute(new RequestHistoricalBackfillCommand(dto.symbol, dto.barsCount));
  }

  @Get('backfill-status')
  @ApiOperation({ summary: 'Get status of all active backfill requests' })
  async getBackfillStatus(): Promise<BackfillRequest[]> {
    return this.backfillStateService.getAllRequests();
  }

  @Post('historical-bars/chunk')
  @ApiOperation({ summary: 'Ingest a chunk of historical M15 bars from EA' })
  async ingestHistoricalChunk(
    @Body() dto: UploadHistoricalBarsDto,
  ): Promise<IngestHistoricalChunkResult> {
    return this.commandBus.execute(
      new IngestHistoricalChunkCommand(dto.symbol, dto.chunkNumber, dto.totalChunks, dto.bars),
    );
  }

  @Post('historical-backfill/complete')
  @ApiOperation({ summary: 'Mark historical backfill as complete and clear state' })
  async completeHistoricalBackfill(
    @Body() dto: CompleteHistoricalBackfillDto,
  ): Promise<CompleteHistoricalBackfillResult> {
    return this.commandBus.execute(new CompleteHistoricalBackfillCommand(dto.symbol));
  }
}
