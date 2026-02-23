import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { IngestHistoricalChunkCommand } from '../impl/ingest-historical-chunk.command';
import { BackfillStateService } from '../../domain/services/backfill-state.service';
import { HistoricalBarIngestionService } from '../../domain/services/historical-bar-ingestion.service';
import { IngestHistoricalChunkResult, BackfillRequest } from '../../domain/types';
import { BackfillNotFoundException, ChunkValidationException } from '../../domain/exceptions';

@CommandHandler(IngestHistoricalChunkCommand)
export class IngestHistoricalChunkHandler implements ICommandHandler<IngestHistoricalChunkCommand> {
  private readonly logger = new Logger(IngestHistoricalChunkHandler.name);

  constructor(
    private readonly backfillStateService: BackfillStateService,
    private readonly ingestionService: HistoricalBarIngestionService,
  ) {}

  async execute(command: IngestHistoricalChunkCommand): Promise<IngestHistoricalChunkResult> {
    const { symbol, chunkNumber, totalChunks, bars } = command;

    this.logger.log(
      `[CHUNK RECEIVED] ${symbol} | chunk=${chunkNumber}/${totalChunks} | bars=${bars.length}`,
    );

    const backfillRequest = this.validateChunk(symbol, chunkNumber, totalChunks);

    const startTime = Date.now();
    await this.ingestionService.ingestBars(symbol, bars);
    const duration = Date.now() - startTime;

    const updatedRequest = this.backfillStateService.incrementProgress(symbol, bars.length);

    this.logChunkCompletion(
      symbol,
      chunkNumber,
      totalChunks,
      bars.length,
      updatedRequest,
      backfillRequest,
      duration,
    );

    return {
      message: `Chunk ${chunkNumber}/${totalChunks} ingested successfully`,
      symbol,
      chunkNumber,
      totalChunks,
      barsIngested: updatedRequest?.barsIngested ?? 0,
      barsInChunk: bars.length,
    };
  }

  private validateChunk(symbol: string, chunkNumber: number, totalChunks: number): BackfillRequest {
    const backfillRequest = this.backfillStateService.getRequest(symbol);
    if (!backfillRequest) {
      this.logger.error(
        `[CHUNK REJECTED] ${symbol} | chunk=${chunkNumber}/${totalChunks} | reason=no active backfill request`,
      );
      throw new BackfillNotFoundException(symbol);
    }

    if (totalChunks !== backfillRequest.totalChunks) {
      this.logger.error(
        `[CHUNK REJECTED] ${symbol} | chunk=${chunkNumber}/${totalChunks} | reason=totalChunks mismatch | expected=${backfillRequest.totalChunks} | received=${totalChunks}`,
      );
      throw new ChunkValidationException(
        symbol,
        'totalChunks',
        backfillRequest.totalChunks,
        totalChunks,
      );
    }

    return backfillRequest;
  }

  private logChunkCompletion(
    symbol: string,
    chunkNumber: number,
    totalChunks: number,
    barsInChunk: number,
    updatedRequest: BackfillRequest | undefined,
    backfillRequest: BackfillRequest,
    duration: number,
  ): void {
    const progress = updatedRequest
      ? Math.round((updatedRequest.barsIngested / updatedRequest.barsRequested) * 100)
      : 0;

    this.logger.log(
      `[CHUNK INGESTED] ${symbol} | chunk=${chunkNumber}/${totalChunks} | bars=${barsInChunk} | total=${updatedRequest?.barsIngested ?? 0}/${backfillRequest.barsRequested} | progress=${progress}% | duration=${duration}ms`,
    );
  }
}
